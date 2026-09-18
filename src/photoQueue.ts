// 사진 전송 대기열의 **판단 규칙**만 모은다. 파일·네트워크·RN을 건드리지 않는 순수 모듈이라
// vitest(server/test/photoQueue.test.ts)가 상대 경로로 가져가 검사한다.
// 그래서 이 파일은 **아무것도 import하지 않는다** — expo·react-native를 하나라도 가져오면
// 서버 테스트가 깨진다. 실제 저장·전송은 src/photoUpload.ts가 한다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 4장

export interface PhotoQueueItem {
  /** 항목 식별자. 대기열 안에서만 쓰며 서버로 보내지 않는다. */
  id: string;
  drawingId: string;
  damageId: string;
  /** 앱 문서 폴더에 둔 보관 사본의 uri. 앨범 파일은 권한 때문에 다시 읽기 어렵다(설계 4장). */
  uri: string;
  /** 서버가 사진번호를 뽑는 이름. 뷰어가 칸에 붙인 번호와 같은 이름이어야 한다. */
  filename: string;
  addedAt: number;
  tries: number;
  /** 마지막으로 보낸 시각(epoch ms). 아직 한 번도 안 보냈으면 0. */
  lastTriedAt: number;
}

export type PhotoUploadOutcome = 'ok' | 'retry' | 'drop';

/** 10번 실패한 항목은 그대로 두고 더 시도하지 않는다(설계 4장). 목록 화면 배지로 알린다. */
export const MAX_PHOTO_TRIES = 10;
export const PHOTO_RETRY_STEP_MS = 60_000;
export const PHOTO_RETRY_MAX_MS = 600_000;

// 실패한 항목을 다시 보내기까지 기다리는 시간. 실패할수록 1분씩 길어지고 10분에서 멈춘다 —
// 서버가 꺼져 있는 동안 60초마다 같은 항목을 계속 두드리지 않기 위해서다.
export function retryDelayMs(tries: number): number {
  if (!Number.isFinite(tries) || tries <= 0) return 0;
  return Math.min(PHOTO_RETRY_STEP_MS * tries, PHOTO_RETRY_MAX_MS);
}

// 지금 보낼 항목 하나. 먼저 들어온 것부터, 같으면 id 순서로. 한 번에 하나만 보낸다 —
// 현장 회선이 느릴 때 사진 여러 장을 동시에 올리면 셋 다 시간이 초과된다.
export function nextRetry(queue: PhotoQueueItem[], now: number): PhotoQueueItem | null {
  let best: PhotoQueueItem | null = null;
  for (const item of Array.isArray(queue) ? queue : []) {
    if (item.tries >= MAX_PHOTO_TRIES) continue;
    if (now - item.lastTriedAt < retryDelayMs(item.tries)) continue;
    if (best === null || item.addedAt < best.addedAt || (item.addedAt === best.addedAt && item.id < best.id)) {
      best = item;
    }
  }
  return best;
}

// 보낸 결과를 대기열에 반영한다. 성공('ok')과 서버가 400을 준 경우('drop')는 뺀다 — 형식·번호
// 오류는 다시 보내도 같은 답이 온다(설계 4.5). 그 밖의 실패('retry')는 횟수를 올린다.
export function applyResult(
  queue: PhotoQueueItem[],
  id: string,
  outcome: PhotoUploadOutcome,
  now: number,
): PhotoQueueItem[] {
  const list = Array.isArray(queue) ? queue : [];
  if (outcome === 'ok' || outcome === 'drop') return list.filter((item) => item.id !== id);
  return list.map((item) => (item.id === id ? { ...item, tries: item.tries + 1, lastTriedAt: now } : item));
}

/** 목록 화면 배지의 숫자. 10번 실패해 멈춘 항목도 "보내지 못한 사진"이므로 함께 센다. */
export function pendingCount(queue: PhotoQueueItem[]): number {
  return Array.isArray(queue) ? queue.length : 0;
}

/** 배지를 눌렀을 때. 멈춘 항목까지 처음부터 다시 보낼 수 있게 되돌린다. */
export function retryAll(queue: PhotoQueueItem[]): PhotoQueueItem[] {
  return (Array.isArray(queue) ? queue : []).map((item) => ({ ...item, tries: 0, lastTriedAt: 0 }));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// 저장 파일(photo-queue.json)을 읽을 때 쓴다. 파일이 깨졌거나 옛 모양이어도 앱이 뜨는 것이
// 사진 몇 장보다 중요하다 — 모양이 다른 항목은 조용히 버린다.
export function parseQueue(value: unknown): PhotoQueueItem[] {
  if (!Array.isArray(value)) return [];
  const result: PhotoQueueItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (!isText(entry.id) || !isText(entry.drawingId) || !isText(entry.damageId)) continue;
    if (!isText(entry.uri) || !isText(entry.filename)) continue;
    result.push({
      id: entry.id,
      drawingId: entry.drawingId,
      damageId: entry.damageId,
      uri: entry.uri,
      filename: entry.filename,
      addedAt: numberOr(entry.addedAt, 0),
      tries: numberOr(entry.tries, 0),
      lastTriedAt: numberOr(entry.lastTriedAt, 0),
    });
  }
  return result;
}
