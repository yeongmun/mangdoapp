// 오프라인 모드의 **판단 규칙**만 모은다. 순수 모듈이라 vitest(server/test/offlineRules.test.ts)가
// 상대 경로로 가져가 검사한다. 그래서 이 파일은 **아무것도 import하지 않는다** — expo·react-native를
// 하나라도 가져오면 서버 테스트가 깨진다. 실제 파일·네트워크는 src/offlineStore.ts·offlineDownload.ts·
// offlineSync.ts가 한다.
// 근거: docs/superpowers/specs/2026-09-23-offline-design.md 3장, .superpowers/sdd/2026-09-23-offline/task-4-brief.md

export type SyncDecision = 'push' | 'pull' | 'none';

// ISO 문자열을 시각(ms)으로 바꾼다. 파싱할 수 없으면(빈 문자열·깨진 값) null — "값 없음"과 같이
// 다룬다(설계 3.5: "시각은 ISO 문자열 비교가 아니라 Date.parse").
function parseTime(value: string | null): number | null {
  if (value === null) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// 도면 하나의 로컬·서버 손상 기록 중 어느 쪽을 따를지 정한다(설계 3.5). 로컬이 없으면 서버 것을
// 받고(pull), 서버에 없으면(또는 못 읽으면) 로컬 것을 올린다(push). 둘 다 없거나 같은 시각이면
// 할 일이 없다(none).
export function syncDecision(localUpdatedAt: string | null, serverUpdatedAt: string | null): SyncDecision {
  const local = parseTime(localUpdatedAt);
  const server = parseTime(serverUpdatedAt);
  if (local === null && server === null) return 'none';
  if (local === null) return 'pull';
  if (server === null) return 'push';
  if (local > server) return 'push';
  if (server > local) return 'pull';
  return 'none';
}

// offlineReady인데 아직 기기(index)에 없는 도면만, 원래 순서를 지켜 고른다(설계 3.2 "이 목록
// 내려받기 (N장)"). indexIds는 지금 offline/index.json에 있는 도면 id들이다.
export function drawingsToDownload<D extends { id: string; offlineReady?: boolean }>(
  drawings: D[],
  indexIds: string[],
): D[] {
  const have = new Set(indexIds);
  return drawings.filter((d) => d.offlineReady === true && !have.has(d.id));
}

// 기기의 뷰어 꾸러미 버전이 서버와 다르면(처음 내려받거나 서버가 새 버전을 냈으면) 새로 받아야
// 한다(설계 3.2 "꾸러미 버전이 바뀌면").
export function bundleNeedsUpdate(localVersion: string | null, serverVersion: string): boolean {
  return localVersion !== serverVersion;
}

// 목록 화면 배지 "서버에 올리지 못한 손상 기록 N개"(설계 3.5) — push가 필요한(로컬이 더 새것인)
// 도면 수.
export function pendingPushCount(entries: { localUpdatedAt: string; serverUpdatedAt: string | null }[]): number {
  return entries.filter((e) => syncDecision(e.localUpdatedAt, e.serverUpdatedAt) === 'push').length;
}

// 오프라인 꾸러미의 viewer.html은 서버가 오토데스크 CDN 절대 URL로 style.min.css·viewer3D.min.js를
// 부른다(server/public/viewer.html) — 기기는 인터넷이 없을 수 있으므로 그대로 두면 열리지 않는다.
// offlineDownload.ts가 꾸러미를 받은 직후 이 함수로 그 두 줄만 내려받은 상대 경로(autodesk/...)로
// 바꿔 저장한다. 오토데스크 뷰어 JS는 자신의 <script src> 위치를 리소스 루트로 삼으므로(브리프
// 근거), lmvworker.min.js·res/locales/... 같은 나머지 오토데스크 파일도 이 한 줄 치환만으로 함께
// 풀린다 — 온라인 뷰어(server/public/viewer.html)는 그대로 두고, 앱이 내려받은 사본만 고친다.
// 버전 조각은 무엇이든 받는다 — 서버가 뷰어 버전을 올려도 이 치환이 조용히 비켜가지 않게(최종 검토
// Important 2: 그러면 기기 페이지가 인터넷의 JS를 부르려다 현장에서만 죽는다).
const AUTODESK_CDN_PREFIX = /https:\/\/developer\.api\.autodesk\.com\/modelderivative\/v2\/viewers\/[^/"']+\//g;
const AUTODESK_LOCAL_PREFIX = 'autodesk/';

export function rewriteViewerHtml(html: string): string {
  return html.replace(AUTODESK_CDN_PREFIX, AUTODESK_LOCAL_PREFIX);
}
