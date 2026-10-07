// 오프라인 모드의 순수 API 대역. DOM·네트워크를 건드리지 않으므로 vitest가 그대로 검사한다.
// 근거: docs/superpowers/specs/2026-09-23-offline-design.md 3.4장

/** @typedef {{ drawing: any, doc: any, modelUrl: string }} OfflineData */
/**
 * @typedef {{
 *   post: (message: any) => void,
 *   onSaved: (cb: (result: { updatedAt: string }) => void) => void,
 *   now?: () => number,
 *   timeoutMs?: number,
 * }} OfflineBridge
 * post는 앱(WebView 밖)으로 메시지를 보낸다. onSaved는 앱의 회신을 받을 콜백을 등록한다
 * (main.js에서는 `window.mangdoOfflineSaved = cb`로 잇는다). timeoutMs는 테스트에서
 * vitest 가짜 타이머와 함께 대기 시간을 조절하는 용도이며 기본값은 3000이다.
 */

const DAMAGES_PATH = /^\/drawings\/([^/]+)\/damages$/;
const PHOTOS_PATH = /^\/drawings\/([^/]+)\/damages\/([^/]+)\/photos$/;
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * 뷰어 페이지가 오프라인으로 열렸는지. `?offline=1`일 때만 true.
 * @param {string} search location.search
 * @returns {boolean}
 */
export function isOfflineMode(search) {
  return new URLSearchParams(search).get('offline') === '1';
}

// 온라인의 STATUS_LABELS에 대응하는 오프라인 문구(설계 3.4장).
export const OFFLINE_STATUS_LABELS = {
  saved: '기기에 저장됨',
  saving: '기기에 저장 중',
  pending: '기기 저장 대기',
  error: '기기 저장 실패',
};

function unsupported() {
  return Object.assign(new Error('오프라인에서는 쓸 수 없습니다'), { retryable: false });
}

// PUT을 앱에 보내고 window.mangdoOfflineSaved 회신을 기다린다. timeoutMs 안에 답이 없으면
// 재시도 가능한 오류로 거부한다 — syncer가 온라인과 같은 재시도 규칙(5초부터 두 배씩)으로 다시 보낸다.
function putDamages(doc, bridge) {
  const timeoutMs = bridge.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('기기에 저장하지 못했습니다'), { retryable: true }));
    }, timeoutMs);
    bridge.onSaved((result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ updatedAt: result.updatedAt });
    });
    bridge.post({ type: 'offlineSave', doc });
  });
}

/**
 * main.js의 `api()`를 오프라인에서 대신하는 함수를 만든다. 서버에 아무것도 묻지 않고
 * 앱이 미리 주입한 데이터(`window.mangdoOffline`)와 앱과의 메시지 왕복만으로 답한다.
 * @param {OfflineData} data
 * @param {OfflineBridge} bridge
 * @returns {(path: string, options?: { method?: string, body?: string }) => Promise<any>}
 */
export function createOfflineApi(data, bridge) {
  return async function offlineApi(path, options = {}) {
    if (path === '/drawings') return [data.drawing];

    const damagesMatch = path.match(DAMAGES_PATH);
    if (damagesMatch) {
      const method = (options.method ?? 'GET').toUpperCase();
      if (method === 'GET') return data.doc;
      if (method === 'PUT') return putDamages(JSON.parse(options.body), bridge);
    }

    const photosMatch = path.match(PHOTOS_PATH);
    if (photosMatch && (options.method ?? 'GET').toUpperCase() === 'GET') return [];

    throw unsupported();
  };
}
