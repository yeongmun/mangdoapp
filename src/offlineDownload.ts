// 꾸러미(뷰어)와 도면(파생 파일 3개 + 손상 기록)을 기기에 내려받는다(설계 3.2). 무엇을 내려받을지
// 고르는 판단(drawingsToDownload)은 src/offlineRules.ts가 하고, 이 파일은 실제 내려받기만 한다.
import { Directory, File } from 'expo-file-system';
import { ACCESS_KEY } from './config';
import {
  bundleFileUrl,
  fetchDamages,
  fetchOfflineListing,
  fetchViewerBundleListing,
  offlineFileUrl,
  type BundleListing,
  type Drawing,
} from './api';
import { bundleNeedsUpdate, rewriteViewerHtml } from './offlineRules';
import {
  bundleDir,
  drawingDir,
  readIndex,
  removeDrawing,
  writeDamages,
  writeIndex,
  type OfflineDrawingEntry,
  type OfflineIndex,
} from './offlineStore';

// url 하나를 base 아래의 relPath 자리에 받는다. relPath에 '/'가 있으면(예: '0ab7..._f2d/
// primaryGraphics.f2d') 그 폴더를 먼저 만든다 — 서버 경로 그대로 기기에 옮겨야 꾸러미 안의
// 상대 링크(viewer/main.js 등)가 그대로 맞는다(브리프 근거).
async function downloadTo(url: string, base: Directory, relPath: string): Promise<void> {
  const parts = relPath.split('/');
  const name = parts.pop() as string;
  const dir = parts.length > 0 ? new Directory(base, ...parts) : base;
  dir.create({ intermediates: true, idempotent: true });
  await File.downloadFileAsync(url, new File(dir, name), {
    headers: { 'x-access-key': ACCESS_KEY },
    idempotent: true,
  });
}

// 꾸러미가 없거나 서버 버전이 다르면 새로 받고 옛 버전 폴더를 지운다(설계 3.2). 이미 최신이면
// 아무 일도 하지 않는다. 실패하면(연결 없음 등) index는 그대로 돌려주고 ok:false — 도면도 열 수
// 없으므로 호출부가 전체를 실패로 본다.
async function ensureBundle(index: OfflineIndex): Promise<{ index: OfflineIndex; ok: boolean }> {
  let listing: BundleListing;
  try {
    listing = await fetchViewerBundleListing();
  } catch (err) {
    console.error('[offlineDownload] 뷰어 꾸러미 목록을 가져오지 못했습니다', err);
    return { index, ok: false };
  }
  if (!bundleNeedsUpdate(index.bundleVersion, listing.version)) {
    return { index, ok: true };
  }
  const dir = bundleDir(listing.version);
  try {
    dir.create({ intermediates: true, idempotent: true });
    for (const file of listing.files) {
      await downloadTo(bundleFileUrl(file.path), dir, file.path);
    }
    // 오토데스크 CDN 절대 URL을 내려받은 autodesk/ 상대 경로로 바꾼다(offlineRules 근거 참고).
    const htmlFile = new File(dir, 'viewer.html');
    htmlFile.write(rewriteViewerHtml(htmlFile.textSync()));
  } catch (err) {
    console.error('[offlineDownload] 뷰어 꾸러미를 내려받지 못했습니다', err);
    try {
      if (dir.exists) dir.delete();
    } catch {
      // 못 지워도 다음 시도 때 idempotent 옵션이 덮어쓴다.
    }
    return { index, ok: false };
  }
  const oldVersion = index.bundleVersion;
  const nextIndex: OfflineIndex = { ...index, bundleVersion: listing.version };
  if (!writeIndex(nextIndex)) return { index, ok: false };
  if (oldVersion && oldVersion !== listing.version) {
    try {
      const oldDir = bundleDir(oldVersion);
      if (oldDir.exists) oldDir.delete();
    } catch (err) {
      console.error('[offlineDownload] 옛 꾸러미 폴더를 지우지 못했습니다', err);
    }
  }
  return { index: nextIndex, ok: true };
}

// 도면 목록(이미 offlineReady·미보유로 걸러진 것 — src/offlineRules.ts의 drawingsToDownload를
// 호출부가 먼저 써서 넘긴다)을 차례로 내려받는다. 꾸러미 확인 → 도면마다 파생 파일 3개 →
// 손상 기록 → index 갱신. 한 도면이 실패해도 그 도면 폴더만 정리하고 나머지는 계속한다(설계 3.2).
export async function downloadDrawings(
  drawings: Drawing[],
  onProgress: (done: number, total: number, name: string) => void,
): Promise<{ ok: number; failed: string[] }> {
  let index = readIndex();
  const bundleResult = await ensureBundle(index);
  index = bundleResult.index;
  if (!bundleResult.ok) {
    // 꾸러미가 없으면 어떤 도면도 기기에서 열 수 없다 — 전부 실패로 알린다.
    return { ok: 0, failed: drawings.map((d) => d.name) };
  }

  const total = drawings.length;
  let ok = 0;
  const failed: string[] = [];
  for (let i = 0; i < drawings.length; i++) {
    const drawing = drawings[i];
    onProgress(i, total, drawing.name);
    try {
      const listing = await fetchOfflineListing(drawing.id);
      const modelDir = new Directory(drawingDir(drawing.id), 'model');
      modelDir.create({ intermediates: true, idempotent: true });
      for (const file of listing.files) {
        await downloadTo(offlineFileUrl(drawing.id, file.path), modelDir, file.path);
      }
      const doc = await fetchDamages(drawing.id);
      if (!doc) throw new Error('손상 기록을 가져오지 못했습니다 (404)');
      if (!writeDamages(drawing.id, doc)) throw new Error('손상 기록을 기기에 저장하지 못했습니다');
      const entry: OfflineDrawingEntry = {
        name: drawing.name,
        projectId: drawing.projectId ?? null,
        viewFormat: 'svf',
        model: listing.model,
        files: listing.files.map((f) => f.path),
        frames: Array.isArray(drawing.frames) ? drawing.frames : [],
        damagesUpdatedAt: doc.updatedAt,
        serverUpdatedAt: doc.updatedAt,
        downloadedAt: new Date().toISOString(),
      };
      index = { ...index, drawings: { ...index.drawings, [drawing.id]: entry } };
      if (!writeIndex(index)) throw new Error('index를 저장하지 못했습니다');
      ok++;
    } catch (err) {
      console.error('[offlineDownload] 도면을 내려받지 못했습니다', drawing.id, err);
      removeDrawing(drawing.id);
      index = readIndex();
      failed.push(drawing.name);
    }
  }
  onProgress(total, total, '');
  return { ok, failed };
}
