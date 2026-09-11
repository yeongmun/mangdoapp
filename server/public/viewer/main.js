import { addDamage, canUndo, createEditor, removeDamage, undo, validateDamageDoc } from './damageDoc.js';
import { createCoordinateMapper } from './coords.js';
import { createCrackInput, finalizeStroke, pickDamage } from './crackTool.js';
import { createOverlay } from './overlay.js';
import { chooseInitialDoc, createSyncer } from './sync.js';

const $ = (id) => document.getElementById(id);
const drawingId = new URLSearchParams(location.search).get('id') ?? '';
const accessKey = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const STATUS_LABELS = { saved: '저장됨', saving: '저장 중', pending: '저장 대기', error: '저장 실패' };

function errorMessage(status, body) {
  if (status === 401) return '접근키를 확인하세요.';
  if (body.error === undefined || body.error === null) return `요청에 실패했습니다 (${status}).`;
  return Array.isArray(body.details) ? `${body.error} (${body.details.join(' / ')})` : body.error;
}

// 응답 오류는 status와 retryable(4xx는 다시 보내도 같으므로 false)을 붙여 던진다.
// fetch 자체가 실패한 네트워크 오류에는 retryable이 없으므로 재시도 대상이다.
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}), 'x-access-key': accessKey },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(errorMessage(res.status, body)), {
      status: res.status,
      retryable: !(res.status >= 400 && res.status < 500),
    });
  }
  return body;
}

// 앱(React Native WebView)으로 메시지를 보낸다. 브라우저에서 직접 열면 아무것도 하지 않는다.
function postToApp(message) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

function showError(message) {
  $('loading').hidden = true;
  $('toolbar').hidden = true;
  $('errorText').textContent = message;
  $('error').hidden = false;
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

function initializeViewer() {
  return new Promise((resolve) => {
    Autodesk.Viewing.Initializer(
      {
        env: 'AutodeskProduction2',
        api: 'streamingV2',
        getAccessToken: (onToken) => {
          api('/viewer-token')
            .then((token) => onToken(token.accessToken, token.expiresIn))
            .catch((err) => showError(`뷰어 토큰을 받지 못했습니다: ${err.message}`));
        },
      },
      resolve,
    );
  });
}

function loadDocument(urn) {
  return new Promise((resolve, reject) => {
    Autodesk.Viewing.Document.load(`urn:${urn}`, resolve, (code, message) =>
      reject(new Error(`도면을 불러오지 못했습니다 (오류 ${code}) ${message ?? ''}`)),
    );
  });
}

// DWG의 모델 공간 2D 뷰는 이름이 "Model"이다. 없으면 첫 2D 뷰를 쓴다.
function pick2dViewable(doc) {
  const views = doc.getRoot().search({ type: 'geometry', role: '2d' });
  return views.find((node) => node.name() === 'Model') ?? views[0] ?? null;
}

function waitForGeometry(viewer) {
  return new Promise((resolve) => {
    if (viewer.model?.isLoadDone()) {
      resolve();
      return;
    }
    const onLoaded = () => {
      viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
      resolve();
    };
    viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
  });
}

async function start() {
  if (!/^d_[0-9a-f]{32}$/.test(drawingId)) throw new Error('도면 id가 올바르지 않습니다.');
  if (!accessKey) throw new Error('접근키가 없습니다. 앱 설정을 확인하세요.');

  const [drawings, serverDoc] = await Promise.all([api('/drawings'), api(`/drawings/${drawingId}/damages`)]);
  const drawing = drawings.find((d) => d.id === drawingId);
  if (!drawing) throw new Error('도면을 찾을 수 없습니다.');
  if (drawing.status !== 'success') throw new Error('아직 변환이 끝나지 않은 도면입니다.');

  await initializeViewer();
  const viewer = new Autodesk.Viewing.Viewer3D($('viewer'));
  if (viewer.start() > 0) throw new Error('이 기기에서 WebGL을 사용할 수 없습니다.');
  const doc = await loadDocument(drawing.urn);
  const viewable = pick2dViewable(doc);
  if (!viewable) throw new Error('이 도면에는 2D 뷰가 없습니다.');
  await viewer.loadDocumentNode(doc, viewable);
  await waitForGeometry(viewer);

  const mapper = createCoordinateMapper(viewer);
  console.info('[mangdo] DWG 좌표 변환:', mapper.dwgStatus.reason);
  if (!mapper.dwgStatus.matrix) {
    $('warning').textContent = `DWG 좌표 변환 불가: ${mapper.dwgStatus.reason} (뷰어 좌표만 저장됩니다)`;
    $('warning').hidden = false;
  }

  const overlay = createOverlay($('overlay'), mapper);
  viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => overlay.requestRender());
  window.addEventListener('resize', () => overlay.requestRender());

  const syncer = createSyncer({
    drawingId,
    storage: safeStorage(),
    save: (d) => {
      const errors = validateDamageDoc(d, drawingId);
      if (errors.length > 0) {
        throw Object.assign(new Error(`손상 데이터 형식 오류: ${errors.join(' / ')}`), { retryable: false });
      }
      const body = JSON.stringify(d);
      // keepalive는 페이지가 닫혀도 요청을 끝까지 보내지만 본문 크기 제한(약 64KB)이 있다.
      return api(`/drawings/${drawingId}/damages`, { method: 'PUT', body, keepalive: body.length < 60000 });
    },
    onStatus: (status, detail) => {
      $('saveStatus').textContent = STATUS_LABELS[status];
      $('saveStatus').className = `status ${status}`;
      if (status === 'error') {
        $('saveError').textContent = `저장 실패: ${detail}`;
        $('saveError').hidden = false;
      } else {
        $('saveError').hidden = true;
      }
    },
  });
  window.mangdoFlush = async () => {
    const saved = await syncer.flushNow();
    postToApp({ type: 'flushResult', saved });
  };

  const backup = syncer.readBackup();
  const usableBackup = backup && validateDamageDoc(backup, drawingId).length === 0 ? backup : null;
  const initial = chooseInitialDoc(serverDoc, usableBackup);
  let editor = createEditor(initial.doc);
  let selectedId = null;
  let fingerDraw = false;
  let coordCheck = false;
  const nowIso = () => new Date().toISOString();

  function refresh() {
    overlay.setDamages(editor.doc.damages);
    overlay.setSelected(selectedId);
    $('undo').disabled = !canUndo(editor);
    $('delete').disabled = selectedId === null;
  }

  function apply(nextEditor) {
    if (nextEditor !== editor) {
      editor = nextEditor;
      syncer.change(editor.doc);
    }
    refresh();
  }

  function showCoordinates([x, y]) {
    const world = mapper.clientToWorld(x, y);
    if (!world) return;
    const dwg = mapper.worldToDwg(world);
    const dwgText = dwg ? `X ${dwg[0].toFixed(3)}  Y ${dwg[1].toFixed(3)}` : '변환 불가';
    $('coordPanel').textContent = `뷰어  X ${world[0].toFixed(6)}  Y ${world[1].toFixed(6)}\nDWG   ${dwgText}`;
    $('coordPanel').hidden = false;
  }

  function handleTap(point) {
    if (coordCheck) {
      showCoordinates(point);
      return true;
    }
    selectedId = pickDamage(editor.doc.damages, point, mapper);
    refresh();
    return selectedId !== null;
  }

  createCrackInput({
    viewer,
    container: $('viewer'),
    isFingerDrawEnabled: () => fingerDraw,
    onDraft: (points) => overlay.setDraft(points),
    onTap: handleTap,
    onStroke: (points) => {
      overlay.setDraft(null);
      const lastPoint = points[points.length - 1];
      if (coordCheck) {
        handleTap(lastPoint);
        return;
      }
      const damage = finalizeStroke(points, mapper, { now: nowIso(), newId: () => crypto.randomUUID() });
      if (!damage) {
        // 너무 짧은 획은 탭으로 보고 균열 선택에 쓴다.
        handleTap(lastPoint);
        return;
      }
      selectedId = null;
      apply(addDamage(editor, damage, nowIso()));
    },
  });

  $('fingerDraw').addEventListener('click', () => {
    fingerDraw = !fingerDraw;
    $('fingerDraw').setAttribute('aria-pressed', String(fingerDraw));
  });
  $('coordCheck').addEventListener('click', () => {
    coordCheck = !coordCheck;
    $('coordCheck').setAttribute('aria-pressed', String(coordCheck));
    if (!coordCheck) $('coordPanel').hidden = true;
  });
  $('undo').addEventListener('click', () => {
    selectedId = null;
    apply(undo(editor, nowIso()));
  });
  $('delete').addEventListener('click', () => {
    if (selectedId === null) return;
    const id = selectedId;
    selectedId = null;
    apply(removeDamage(editor, id, nowIso()));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncer.flushNow();
  });

  if (initial.needsUpload) syncer.change(initial.doc);
  refresh();
  $('loading').hidden = true;
  $('toolbar').hidden = false;
  postToApp({ type: 'ready' });
}

$('retry').addEventListener('click', () => location.reload());

start().catch((err) => {
  console.error(err);
  showError(err instanceof Error ? err.message : String(err));
});
