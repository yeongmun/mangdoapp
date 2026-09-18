// 찍은 사진을 서버로 보낸다. 실패하면 앱 문서 폴더의 대기열(photo-queue.json)에 넣고 나중에 다시
// 보낸다. **언제 무엇을 보낼지**는 순수 모듈 src/photoQueue.ts가 정하고(테스트 있음), 이 파일은
// 파일·네트워크만 다룬다. 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 4장
import { Directory, File, Paths, UploadType, type UploadResult } from 'expo-file-system';
import { ACCESS_KEY, API_URL } from './config';
import { applyResult, nextRetry, parseQueue, pendingCount, retryAll, type PhotoQueueItem } from './photoQueue';

/** 뷰어 화면에 머무는 동안 이 간격으로 다시 시도한다(설계 4.4). */
export const PHOTO_FLUSH_INTERVAL_MS = 60_000;

// 리뷰 Fix round 1 — Important: 연결은 됐지만 서버·중간 장비가 응답을 주지 않는 "죽은 연결"에서
// RN의 fetch가 무한정 대기할 수 있다. 그러면 flushPhotoQueue의 단일 실행 잠금(flushing)이 영원히
// 풀리지 않아 마운트·60초 타이머·촬영 직후·배지 탭이 모두 조용히 무시된다. 60초에서 스스로 끊는다
// (현장 LTE가 느리면 5MB 사진에 40초쯤 걸릴 수 있어 30초는 빠듯하다 — 재검토 지적).
export const PHOTO_UPLOAD_TIMEOUT_MS = 60_000;

const QUEUE_FILE_NAME = 'photo-queue.json';
const QUEUE_TMP_FILE_NAME = 'photo-queue.json.tmp';
const KEEP_DIR_NAME = 'photo-queue';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.heif': 'image/heic',
};

export type UploadNotice =
  | { id: string; ok: true; damageId: string; number: string }
  // willRetry: 나중에 다시 보낼 항목인지. 뷰어 문구가 '다시 시도합니다'와 '서버가 받지
  // 않았습니다'로 갈린다(설계 4.2·4.5).
  | { id: string; ok: false; damageId: string; reason: string; willRetry: boolean };

function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(filename);
  return match ? match[0].toLowerCase() : '.jpg';
}

function mimeOf(filename: string): string {
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? 'image/jpeg';
}

function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE_NAME);
}

// 읽기·쓰기는 모두 실패를 삼킨다. 사진 몇 장보다 앱이 뜨는 것이 중요하다.
function readQueue(): PhotoQueueItem[] {
  try {
    const file = queueFile();
    if (!file.exists) return [];
    return parseQueue(JSON.parse(file.textSync()) as unknown);
  } catch {
    return [];
  }
}

// 통제관 규칙 R3: 대기열 파일 쓰기는 원자적이어야 한다. photo-queue.json.tmp에 새 내용을 다
// 쓴 뒤에야 photo-queue.json 자리로 옮긴다 — 쓰는 도중에 앱이 죽거나 기기가 꺼져도 기존
// photo-queue.json은 온전하게 남는다(빈 파일이나 반쯤 쓰인 JSON이 남지 않는다).
// File.moveSync(dest, { overwrite: true })는 안드로이드에서 File.moveTo(..., overwrite)로
// 구현되어 있어(코틀린 java.nio Path.moveTo) 대상이 있어도 그대로 옮겨 쓴다 — 그래서 별도의
// "지우고 옮기기" 폴백은 쓰지 않는다. 그래도 만에 하나 그 자리 옮기기가 실패하면(예: 구버전
// 파일시스템) 대상을 먼저 지우고 다시 옮기는 것으로 한 번 더 시도한다.
function writeQueue(queue: PhotoQueueItem[]): boolean {
  const tmp = new File(Paths.document, QUEUE_TMP_FILE_NAME);
  try {
    tmp.write(JSON.stringify(queue));
  } catch (err) {
    console.error('[photoUpload] 대기열 임시 파일을 쓰지 못했습니다', err);
    return false;
  }
  try {
    tmp.moveSync(queueFile(), { overwrite: true });
    return true;
  } catch (err) {
    // 자리 옮기기(overwrite)가 안 되는 드문 경우의 폴백: 대상을 먼저 지우고 다시 옮긴다.
    // 두 단계 사이의 아주 짧은 순간에는 photo-queue.json이 없을 수 있다(R3 명시).
    try {
      const target = queueFile();
      if (target.exists) target.delete();
      tmp.moveSync(target, {});
      return true;
    } catch (fallbackErr) {
      console.error('[photoUpload] 대기열을 저장하지 못했습니다', err, fallbackErr);
      return false;
    }
  }
}

function newItemId(): string {
  // crypto.randomUUID은 RN에 없을 수 있다. 대기열 안에서만 구분되면 되므로 시각 + 임의 글자로 짓는다.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function removeFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 지우지 못해도 대기열에서는 빠졌다. 문서 폴더에 사본 하나가 남을 뿐이다.
  }
}

// 앨범 파일은 권한 때문에 나중에 다시 읽기 어렵고, 캐시 사본은 시스템이 언제든 지운다.
// 그래서 문서 폴더(Paths.document)에 사본을 하나 더 둔다 — 전송이 끝나면 지운다(설계 4.3).
export async function keepCopy(sourceUri: string, filename: string): Promise<string | null> {
  try {
    const folder = new Directory(Paths.document, KEEP_DIR_NAME);
    folder.create({ intermediates: true, idempotent: true });
    const destination = new File(folder, `${newItemId()}${extensionOf(filename)}`);
    await new File(sourceUri).copy(destination, { overwrite: true });
    return destination.uri;
  } catch (err) {
    console.error('[photoUpload] 보관 사본을 만들지 못했습니다', err);
    return null;
  }
}

// 대기열에 넣는다. 저장까지 실패하면(디스크 꽉 참 등) 방금 만든 보관 사본을 지우고 null을
// 돌려준다 — 사진은 앨범에 남아 있으니 호출부(ViewerScreen)는 willRetry:false로 알린다
// (통제관 규칙 R3).
export function enqueuePhoto(input: {
  drawingId: string;
  damageId: string;
  filename: string;
  uploadUri: string;
}): PhotoQueueItem | null {
  const item: PhotoQueueItem = {
    id: newItemId(),
    drawingId: input.drawingId,
    damageId: input.damageId,
    uri: input.uploadUri,
    filename: input.filename,
    addedAt: Date.now(),
    tries: 0,
    lastTriedAt: 0,
  };
  if (!writeQueue([...readQueue(), item])) {
    removeFile(input.uploadUri);
    return null;
  }
  return item;
}

type Attempt =
  | { outcome: 'ok'; number: string }
  | { outcome: 'retry'; reason: string }
  | { outcome: 'drop'; reason: string };

async function uploadOne(item: PhotoQueueItem): Promise<Attempt> {
  // 2026-09-18 현장 진단: Expo SDK 57의 fetch는 FormData에 넣은 { uri, name, type } 파일 파트를
  // 거절한다("Unsupported FormDataPart implementation") — 웹 Blob만 받는다. 그래서 fetch 대신
  // expo-file-system의 네이티브 multipart 업로드를 쓴다. 파일을 JS로 읽지 않고 디스크에서 바로
  // 흘려보내며(5MB 사진도 메모리 부담 없음), iOS·Android 모두 parameters를 file 파트보다 **앞에**
  // 쓰므로 서버(multer)의 req.body.filename에 앨범 파일 이름이 담긴다 — 서버가 뽑는 사진번호가
  // 뷰어가 칸에 붙인 번호와 같아진다. 파트의 filename은 대기열 사본 이름(<id>.jpg)이라 서버는
  // 반드시 filename 필드를 먼저 본다(app.ts).
  const url = `${API_URL}/api/drawings/${item.drawingId}/damages/${item.damageId}/photos`;

  // 죽은 연결(응답이 영영 안 옴)에서 업로드가 멈추지 않도록 스스로 끊는다 — 타임아웃도 네트워크
  // 오류와 같이 일시적 실패(retry)로 다룬다(서버가 늦게라도 살아나면 다음 시도는 성공할 수 있다).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PHOTO_UPLOAD_TIMEOUT_MS);
  let res: UploadResult;
  try {
    // Content-Type(multipart 경계 문자열)은 네이티브가 스스로 붙인다.
    res = await new File(item.uri).upload(url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: mimeOf(item.filename),
      parameters: { filename: item.filename },
      headers: { 'x-access-key': ACCESS_KEY },
      // 앱이 잠깐 뒤로 가도 이어지는 background 세션은 60초 타임아웃·재시도 대기열과 어긋난다.
      sessionType: 'foreground',
      signal: controller.signal,
    });
  } catch (err) {
    // 실기기에서 원인을 볼 수 있게 Metro 콘솔에 남기고 사유에도 오류 문구를 붙인다(2026-09-18 현장 진단).
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[photo-upload] 업로드 실패', { url, uri: item.uri, filename: item.filename, detail });
    if (controller.signal.aborted) return { outcome: 'retry', reason: '업로드 시간이 초과됐습니다' };
    return { outcome: 'retry', reason: `서버에 연결할 수 없습니다 (${detail})` };
  } finally {
    clearTimeout(timeoutId);
  }

  let body: { number?: string; error?: string } = {};
  try {
    body = JSON.parse(res.body) as { number?: string; error?: string };
  } catch {
    // 본문이 JSON이 아니면(프록시 오류 페이지 등) 상태 코드만으로 판단한다.
  }
  if (res.status === 201) return { outcome: 'ok', number: typeof body.number === 'string' ? body.number : '' };
  const reason = body.error ?? `서버가 거절했습니다 (${res.status})`;
  // 400(형식·번호)·404(도면이 없어짐)·413(너무 큼)은 다시 보내도 같은 답이 온다 → 뺀다(설계 4.5).
  // 401(접근키 오류)·5xx·그 밖은 접근키를 고치거나 서버가 살아나면 되므로 남긴다.
  if (res.status === 400 || res.status === 404 || res.status === 413) return { outcome: 'drop', reason };
  return { outcome: 'retry', reason };
}

let flushing = false;

// 보낼 수 있는 항목을 하나씩 끝까지 보낸다. 겹쳐 불려도(화면 진입 + 60초 타이머 + 촬영 직후)
// 한 번만 돈다. 매번 파일에서 다시 읽는다 — 보내는 동안 새로 찍은 사진을 잃지 않는다.
export async function flushPhotoQueue(notify: (notice: UploadNotice) => void): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const item = nextRetry(readQueue(), Date.now());
      if (!item) return;
      // 방어적 이중 조치: uploadOne이 던지더라도(현재는 fetch·json 파싱 실패를 모두 안에서
      // 잡아 던지지 않지만, 앞으로 바뀔 수 있다) 이 루프의 바깥 try/finally가 flushing을 풀어
      // 주지만, 여기서도 잡아 'retry'로 넘겨 이 항목만 다음 차례로 미루고 나머지 항목·다음
      // 호출은 계속 처리되게 한다(리뷰 Fix round 1).
      let attempt: Attempt;
      try {
        attempt = await uploadOne(item);
      } catch (err) {
        attempt = { outcome: 'retry', reason: `업로드 중 예상치 못한 오류: ${err instanceof Error ? err.message : String(err)}` };
      }
      // 대기열 파일을 못 쓰면(저장 공간 꽉 참 등) tries가 안 올라가 nextRetry가 같은 항목을 계속
      // 돌려준다 — 같은 사진을 끝없이 다시 올리고 flushing이 영영 안 풀린다(최종 검토 Important 1).
      // 이번 회차는 여기서 멈추고, 다음 계기(60초 타이머 등)에 다시 시도한다. 성공한 업로드는
      // 서버에 이미 있으므로 다음 회차에 다시 올리더라도 같은 번호로 덮어쓸 뿐이다.
      const saved = writeQueue(applyResult(readQueue(), item.id, attempt.outcome, Date.now()));
      if (!saved) {
        notify({ id: item.id, ok: false, damageId: item.damageId, reason: '전송 대기열을 저장하지 못했습니다', willRetry: true });
        return;
      }
      if (attempt.outcome !== 'retry') removeFile(item.uri);
      if (attempt.outcome === 'ok') {
        notify({ id: item.id, ok: true, damageId: item.damageId, number: attempt.number });
      } else {
        notify({
          id: item.id,
          ok: false,
          damageId: item.damageId,
          reason: attempt.reason,
          willRetry: attempt.outcome === 'retry',
        });
      }
    }
  } finally {
    flushing = false;
  }
}

/** 목록 화면 배지의 숫자. */
export function pendingPhotoCount(): number {
  return pendingCount(readQueue());
}

/** 배지를 눌렀을 때. 10번 실패해 멈춘 항목까지 되돌린다 — 이어서 flushPhotoQueue를 부른다. */
export function retryPendingPhotos(): void {
  writeQueue(retryAll(readQueue()));
}
