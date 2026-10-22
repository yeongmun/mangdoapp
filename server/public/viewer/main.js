import {
  addDamage,
  canUndo,
  createEditor,
  duplicateShape,
  migrateDoc,
  removeShape,
  shapeCountOf,
  shapesOf,
  undo,
  updateDamage,
  updateShape,
  validateDamageDoc,
} from './damageDoc.js';
import { DAMAGE_TYPES, DEFAULT_DAMAGE_TYPE_ID, getDamageType } from './damageTypes.js';
import { createCoordinateMapper } from './coords.js';
import { createCrackInput, finalizeRect, finalizeStroke, isFinitePoint, offsetShape, pickDamage } from './crackTool.js';
import { createOverlay } from './overlay.js';
import { chooseInitialDoc, createSyncer } from './sync.js';
import {
  formatQuantity,
  photoNumberFromFilename,
  quantityOf,
  statusTextOf,
  unitOf,
  widthUnitOf,
  withPhotoNumber,
} from './quantities.js';
import { blocksDrawing, photoStripItems } from './photoStrip.js';
import { createOfflineApi, isOfflineMode, OFFLINE_STATUS_LABELS } from './offlineApi.js';
import { clampPage, frameWorldBox, pageCount, pageLabel } from './pageView.js';
import { statusTableRows, statusTableTotals } from './statusTable.js';
import { createInkInput, strokesToPngBase64 } from './ink.js';
import { pendingInkDamages } from './inkAttach.js';
import { simplifyPolyline } from './geometry.js';

const $ = (id) => document.getElementById(id);
// 오프라인(설계 3.4장)은 `?offline=1`로 온다 — 앱이 file://로 이 페이지를 열 때 붙인다. 어떤 WebView가
// file:// 주소의 질의 문자열을 떼어내더라도 앱이 주입한 window.mangdoOffline이 있으면 오프라인이다
// (최종 검토 Important 4). 도면 id도 같은 순서로 찾는다.
const injectedOffline = typeof window.mangdoOffline === 'object' && window.mangdoOffline !== null ? window.mangdoOffline : null;
const offline = isOfflineMode(location.search) || injectedOffline !== null;
const drawingId = new URLSearchParams(location.search).get('id') || injectedOffline?.drawing?.id || '';
const accessKey = new URLSearchParams(location.hash.slice(1)).get('key') ?? '';
const STATUS_LABELS = offline
  ? OFFLINE_STATUS_LABELS
  : { saved: '저장됨', saving: '저장 중', pending: '저장 대기', error: '저장 실패' };

function errorMessage(status, body) {
  if (status === 401) return '접근키를 확인하세요.';
  if (body.error === undefined || body.error === null) return `요청에 실패했습니다 (${status}).`;
  return Array.isArray(body.details) ? `${body.error} (${body.details.join(' / ')})` : body.error;
}

// 응답 오류는 status와 retryable(4xx는 다시 보내도 같으므로 false)을 붙여 던진다.
// fetch 자체가 실패한 네트워크 오류에는 retryable이 없으므로 재시도 대상이다.
async function onlineApi(path, options = {}) {
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

// 오프라인이면 서버를 전혀 부르지 않는다 — 앱이 미리 주입한 window.mangdoOffline과
// postToApp('offlineSave')/window.mangdoOfflineSaved 왕복만으로 답한다(설계 3.3~3.4장).
const api = offline
  ? createOfflineApi(window.mangdoOffline, {
      post: postToApp,
      onSaved: (cb) => {
        window.mangdoOfflineSaved = cb;
      },
    })
  : onlineApi;

// 앱(React Native WebView)으로 메시지를 보낸다. 브라우저에서 직접 열면 아무것도 하지 않는다.
function postToApp(message) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

// 오프라인 진단(2026-09-23 실기기: 아이폰에서 '도면을 불러오는 중'에서 멈춤). 어느 단계까지 갔는지를
// 앱(Metro 콘솔)으로 보내고, 45초 안에 도면이 안 뜨면 마지막 단계와 함께 오류를 보인다.
let lastOfflineStep = '시작';
function offlineStep(step, detail) {
  if (!offline) return;
  lastOfflineStep = step;
  postToApp({ type: 'offlineLog', step, detail: detail === undefined ? '' : String(detail) });
}
if (offline) {
  window.addEventListener('error', (event) => {
    offlineStep('스크립트 오류', `${event.message} @ ${event.filename ?? ''}:${event.lineno ?? ''}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    offlineStep('약속 거부', reason instanceof Error ? `${reason.message}
${reason.stack ?? ''}` : String(reason));
  });
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
    // 오프라인은 로컬 파일만 읽으므로 토큰이 필요 없다(설계 3.4장). 뷰어 버전은 viewer.html이
    // 온라인·오프라인 모두 같은 것을 쓰므로(3.1장) 코드 경로는 여기서만 갈린다.
    if (offline) {
      offlineStep('뷰어 초기화 요청', typeof Autodesk === 'undefined' ? 'Autodesk 전역 없음' : Autodesk.Viewing?.Private?.LMV_VIEWER_VERSION);
      Autodesk.Viewing.Initializer({ env: 'Local', useADP: false, language: 'ko' }, () => {
        offlineStep('뷰어 초기화 완료');
        resolve();
      });
      return;
    }
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

// 오프라인은 Document.load 없이 파생 파일(f2d)을 바로 연다(설계 3.2·3.4장). modelUrl은 앱이
// 주입한 file:// 경로다.
function loadOfflineModel(viewer, modelUrl) {
  offlineStep('도면 파일 요청', modelUrl);
  return new Promise((resolve, reject) => {
    viewer.loadModel(
      modelUrl,
      {},
      (model) => {
        offlineStep('도면 파일 읽음', `is2d=${model?.is2d?.()}`);
        resolve(model);
      },
      (code, message) => {
        offlineStep('도면 파일 실패', `${code} ${message ?? ''}`);
        reject(new Error(`도면을 불러오지 못했습니다 (오류 ${code}) ${message ?? ''}`));
      },
    );
  });
}

// DWG의 모델 공간 2D 뷰는 이름이 "Model"이다. 없으면 첫 2D 뷰를 쓴다.
function pick2dViewable(doc) {
  const views = doc.getRoot().search({ type: 'geometry', role: '2d' });
  return views.find((node) => node.name() === 'Model') ?? views[0] ?? null;
}

// model은 오프라인 경로에서 loadOfflineModel이 돌려준 모델이다 — viewer.loadDocumentNode를 거치지
// 않으므로 이 시점엔 viewer.model이 아직 안 채워져 있을 수 있어 직접 받아 쓴다(설계 3.4장).
function waitForGeometry(viewer, model) {
  return new Promise((resolve) => {
    const target = model ?? viewer.model;
    if (target?.isLoadDone()) {
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
  // 접근키는 서버 API를 부를 때만 쓴다 — 오프라인은 서버를 부르지 않으므로 없어도 된다.
  if (!offline && !accessKey) throw new Error('접근키가 없습니다. 앱 설정을 확인하세요.');

  const [drawings, serverDoc] = await Promise.all([api('/drawings'), api(`/drawings/${drawingId}/damages`)]);
  const serverDocV3 = migrateDoc(serverDoc, drawingId) ?? serverDoc;
  const drawing = drawings.find((d) => d.id === drawingId);
  if (!drawing) throw new Error('도면을 찾을 수 없습니다.');
  if (drawing.status !== 'success') throw new Error('아직 변환이 끝나지 않은 도면입니다.');

  offlineStep('데이터 준비', `damages=${serverDocV3?.damages?.length ?? '?'}`);
  await initializeViewer();
  const viewer = new Autodesk.Viewing.Viewer3D($('viewer'));
  const startCode = viewer.start();
  offlineStep('viewer.start', startCode);
  if (startCode > 0) throw new Error('이 기기에서 WebGL을 사용할 수 없습니다.');
  // 오프라인 감시: 45초 안에 도면이 안 그려지면 마지막 단계와 함께 오류를 보인다(무한 로딩 방지).
  const watchdog = offline
    ? setTimeout(() => showError(`도면을 불러오지 못했습니다 (오프라인, 마지막 단계: ${lastOfflineStep})`), 45000)
    : null;
  let offlineModel = null;
  if (offline) {
    offlineModel = await loadOfflineModel(viewer, window.mangdoOffline.modelUrl);
  } else {
    const doc = await loadDocument(drawing.urn);
    const viewable = pick2dViewable(doc);
    if (!viewable) throw new Error('이 도면에는 2D 뷰가 없습니다.');
    await viewer.loadDocumentNode(doc, viewable);
  }
  await waitForGeometry(viewer, offlineModel);
  if (watchdog !== null) clearTimeout(watchdog);
  offlineStep('도형 로드 완료');

  const mapper = createCoordinateMapper(viewer);
  console.info('[mangdo] DWG 좌표 변환:', mapper.dwgStatus.reason);
  if (!mapper.dwgStatus.matrix) {
    $('warning').textContent = `DWG 좌표 변환 불가: ${mapper.dwgStatus.reason} (뷰어 좌표만 저장됩니다)`;
    $('warning').hidden = false;
  }

  const overlay = createOverlay($('overlay'), mapper);
  // 레코드에 frames가 없으면(옛 도면·DWG) 빈 배열이고, 그때는 도면 전체에서 1번부터 매긴다.
  const frames = Array.isArray(drawing.frames) ? drawing.frames : [];
  overlay.setFrames(frames);
  viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => overlay.requestRender());
  window.addEventListener('resize', () => overlay.requestRender());

  const syncer = createSyncer({
    drawingId,
    // file://의 localStorage는 iOS에서 못 믿는다(설계 8장) — 오프라인은 백업을 아예 쓰지 않는다.
    // 앱이 device의 damages.json을 곧 백업으로 갖고 있다.
    storage: offline ? { getItem: () => null, setItem: () => undefined } : safeStorage(),
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
  // 서버 문서와 같은 방식으로 백업도 먼저 v3로 옮긴 뒤 검증한다. v1·v2 백업을 그대로 검증하면
  // schemaVersion만으로 거부되어, 아직 서버에 못 올린 손상이 조용히 버려진다.
  const migratedBackup = backup ? (migrateDoc(backup, drawingId) ?? backup) : null;
  const usableBackup =
    migratedBackup && validateDamageDoc(migratedBackup, drawingId).length === 0 ? migratedBackup : null;
  const initial = chooseInitialDoc(serverDocV3, usableBackup);
  let editor = createEditor(initial.doc);
  // 선택은 (손상 id, 도형 번호)다. 0이 geometry, 1부터 copies[i-1](설계 3.3).
  let selectedId = null;
  // 페이지 모드가 정해지는 아래쪽(showPage)에서 채운다 — 현황표 패널이 지금 틀을 묻는다.
  let currentPageIndex = null;
  let selectedShape = 0;
  // 손글씨 인식이 돌고 있는가(도구막대 버튼 잠금). 아래 손글씨 블록이 쓴다.
  let inkBusy = false;
  const nowIso = () => new Date().toISOString();

  // 그리기 도구는 모양(선/네모)만 고른다(2026-10-09 사용자 결정, 인프라스마트 태블릿 Pro 방식). 손상
  // 유형은 그린 뒤 속성창에서 고른다. 새 손상은 그 모양으로 마지막에 고른 유형으로 시작한다
  // (처음엔 선=균열, 네모=박락).
  // 선/네모/손글씨는 토글이다(2026-10-17): 선·네모를 켜면 펜·손가락 모두 그 모양을 그리고, 손글씨를 켜면 손가락도
  // 글씨를 쓴다. 다 꺼지면 **이동 모드**(손가락은 팬·줌, 펜·손가락 탭은 선택, 선택한 손상은 끌어 옮김, 펜은 글씨).
  // 처음은 이동 모드. activeKind: null | 'line' | 'area' | 'ink'
  let activeKind = null;
  const lastTypeFor = { line: DEFAULT_DAMAGE_TYPE_ID, area: 'spalling' };
  const activeTypeIdOf = () => lastTypeFor[activeKind ?? 'line'];
  function setActiveKind(kind) {
    activeKind = kind;
    $('toolLine').setAttribute('aria-pressed', String(kind === 'line'));
    $('toolRect').setAttribute('aria-pressed', String(kind === 'area'));
    $('toolInk').setAttribute('aria-pressed', String(kind === 'ink'));
  }
  const isDrawKind = () => activeKind === 'line' || activeKind === 'area';
  $('toolLine').addEventListener('click', () => setActiveKind(activeKind === 'line' ? null : 'line'));
  $('toolRect').addEventListener('click', () => setActiveKind(activeKind === 'area' ? null : 'area'));
  $('toolInk').addEventListener('click', () => setActiveKind(activeKind === 'ink' ? null : 'ink'));

  // 속성창의 유형 목록: 그 손상의 모양(선 ↔ line 유형, 네모 ↔ area 유형)에 맞는 유형만 보인다.
  function fillTypeSelect(damage) {
    const kind = damage.geometry.kind === 'polyline' ? 'line' : 'area';
    const select = $('typeSelect');
    select.textContent = '';
    for (const type of DAMAGE_TYPES) {
      if (type.kind !== kind) continue;
      const option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.label;
      select.append(option);
    }
    select.value = damage.type;
    // 저장된 유형이 목록에 없으면(옛 데이터·모양 불일치) 첫 항목을 보여 주되 바꾸진 않는다.
    if (select.value !== damage.type) select.value = '';
  }

  const selectedDamage = () => editor.doc.damages.find((damage) => damage.id === selectedId) ?? null;

  // 선택된 **도형**의 화면 좌표. crackTool의 getSelectedScreenShape로 넘긴다 — 모서리·회전 핸들
  // 판정은 kind === 'rect'일 때만 하고, 몸통을 끌어 옮기는 판정(hitSelectedShape)은 선·사각형
  // 모두에서 한다(설계 §4 "선택한 손상 이동"). 복제본도 첫 도형과 똑같이 끌 수 있다.
  function selectedDamageScreenShapes() {
    const damage = selectedDamage();
    if (!damage) return [];
    return shapesOf(damage).map((shape, shapeIndex) => ({
      shapeIndex,
      kind: damage.geometry.kind,
      points: shape.world.map((point) => mapper.worldToClient(point)),
    }));
  }

  function selectedScreenShape() {
    const damage = selectedDamage();
    if (!damage) return null;
    const shape = shapesOf(damage)[selectedShape];
    if (!shape) return null;
    return { kind: damage.geometry.kind, points: shape.world.map((point) => mapper.worldToClient(point)) };
  }

  // 선택 상태를 바꾸는 유일한 곳. 속성창은 선택이 바뀔 때마다 닫는다(다른 손상의 값이 남아있지
  // 않도록). 선택 자체가 속성창을 여는 일은 없다 — 여는 것은 사용자가 "속성"을 눌렀을 때와,
  // 새 손상을 그렸을 때(addNewDamage)뿐이다.
  function setSelection(id, shapeIndex = 0) {
    selectedId = id;
    selectedShape = shapeIndex;
    $('propsPanel').hidden = true;
    closePhotoStrip();
  }

  // 속성 패널이 열려 있는지. 그리기 입력(crackTool)이 패널이 열린 동안 제스처를 시작하지 않도록
  // 이 값을 그대로 물어본다(R3) — 패널은 #viewer 밖에 있어 inViewer() 검사로는 보호되지 않는다.
  function isPropsOpen() {
    return !$('propsPanel').hidden;
  }

  function refresh() {
    overlay.setDamages(editor.doc.damages);
    overlay.setSelected(selectedId, selectedShape);
    $('undo').disabled = !canUndo(editor);
    $('delete').disabled = selectedId === null;
    $('duplicate').disabled = selectedId === null;
    $('props').disabled = selectedId === null;
    // 망도틀 밖에 그린 손상은 번호를 받지 못한다 — 개수를 저장 배지 옆에 알린다(설계 5장).
    const outside = overlay.outsideFrameCount();
    $('frameWarning').textContent = `망도틀 밖 손상 ${outside}개 — 번호 없음`;
    $('frameWarning').hidden = outside === 0;
    const pendingInk = pendingInkDamages(editor.doc.damages).length;
    $('inkRecognizeAll').textContent = pendingInk > 0 ? `손글씨 인식 (${pendingInk})` : '손글씨 인식';
    $('inkRecognizeAll').disabled = pendingInk === 0 || inkBusy;
    renderStatusTable();
  }

  // 손상현황표 패널(2026-10-07): 지금 보는 틀의 행(기존 + 신규). 행 계산은 statusTable.js(순수)가 하고
  // 여기서는 표만 그린다. 패널이 닫혀 있으면 그리지 않는다. 신규 행을 누르면 그 손상을 선택한다.
  const STATUS_HEAD = ['번호', '손상위치', '손상현황', '폭', '길이', '개소', '물량', '단위', '사진', '비고'];
  function renderStatusTable() {
    const panel = $('statusPanel');
    if (panel.hidden) return;
    const page = typeof currentPageIndex === 'function' ? currentPageIndex() : 0;
    const rows = statusTableRows(editor.doc.damages, frames, page);
    const count = pageCount(frames);
    $('statusTitle').textContent = count > 0 ? `손상현황표 — 틀 ${page + 1} / ${count}` : '손상현황표';
    const body = $('statusBody');
    body.textContent = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '이 틀에 손상이 없습니다';
      body.appendChild(empty);
    } else {
      const table = document.createElement('table');
      const thead = table.createTHead().insertRow();
      for (const name of STATUS_HEAD) {
        const th = document.createElement('th');
        th.textContent = name;
        thead.appendChild(th);
      }
      const tbody = table.createTBody();
      for (const r of rows) {
        const tr = tbody.insertRow();
        tr.className = r.source + (r.id !== null && r.id === selectedId ? ' selected' : '');
        const cells = [r.no ?? '', r.location, r.status, r.width, r.length, r.count, r.quantity, r.unit, r.photos, r.note];
        cells.forEach((value, i) => {
          const td = tr.insertCell();
          td.textContent = String(value);
          if (i === 1 || i === 2 || i === 9) td.className = 'left';
        });
        if (r.source === 'app') {
          tr.addEventListener('click', () => {
            setSelection(r.id, 0);
            refresh();
          });
        }
      }
      body.appendChild(table);
    }
    const totals = statusTableTotals(rows);
    $('statusTotals').textContent = totals.length === 0 ? '' : '합계  ' + totals.map((t) => `${t.status} ${t.quantity}${t.unit} (${t.count}건)`).join(' · ');
  }
  function toggleStatusTable(open = $('statusPanel').hidden) {
    $('statusPanel').hidden = !open;
    $('statusTable').setAttribute('aria-pressed', String(open));
    if (open) {
      $('propsPanel').hidden = true;
      renderStatusTable();
    }
  }
  $('statusTable').addEventListener('click', () => toggleStatusTable());
  $('statusClose').addEventListener('click', () => toggleStatusTable(false));

  function apply(nextEditor) {
    if (nextEditor !== editor) {
      editor = nextEditor;
      syncer.change(editor.doc);
    }
    refresh();
  }

  // 짧은 안내 문구(좌표 확인 패널 자리를 그대로 쓴다). 몇 초 뒤 스스로 사라진다.
  let noticeTimer = null;
  function showNotice(text, ms = 4000) {
    $('coordPanel').textContent = text;
    $('coordPanel').hidden = false;
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      $('coordPanel').hidden = true;
      noticeTimer = null;
    }, ms);
  }

  // 글씨를 쓰는 중의 짧은 터치는 소수점·마침표다(2026-10-19: "0.2"의 점이 탭으로 먹혀 "02"가 됐다). 선택한 손상에
  // 바로 전 획을 쓴 지 얼마 안 됐으면(INK_DOT_GAP_MS) 점으로 붙이고, 아니면 평소처럼 선택 탭이다.
  // 선택한 손상의 아직 안 읽은 글씨가 화면에서 point 가까이(INK_DOT_NEAR_PX) 있는가 — 그 옆의 찍기는 소수점이다.
  function nearPendingInk(selected, point) {
    const h = selected?.attrs?.handwriting;
    if (!h || typeof h.text === 'string' || !Array.isArray(h.strokes) || !mapper.dwgStatus?.matrix) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of h.strokes) {
      for (const p of s) {
        const world = mapper.dwgToWorld(p);
        if (!world) continue;
        const [x, y] = mapper.worldToClient(world);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) return false;
    const gap = Math.hypot(Math.max(0, point[0] - maxX, minX - point[0]), Math.max(0, point[1] - maxY, minY - point[1]));
    return gap <= INK_DOT_NEAR_PX;
  }

  // 찍기(아주 짧은 터치)가 소수점인지 선택 탭인지(2026-10-22: 시간만으로 가르니 조금만 뜸 들여도 선택이 풀렸다).
  //   ① 다른 손상 위를 찍었으면 → 그 손상 선택
  //   ② 「손글씨」 모드(손가락)이고 손상이 선택돼 있으면 → 무조건 점
  //   ③ 선택한 손상의 안 읽은 글씨 바로 옆(INK_DOT_NEAR_PX)이거나 방금(INK_DOT_GAP_MS) 쓴 뒤면 → 점
  //   ④ 그 밖에는 선택 탭(빈 곳이면 선택 해제)
  function handleInkTap(point, stroke) {
    const selected = selectedDamage();
    if (!selected || !stroke) return handleTap(point);
    const picked = pickDamage(editor.doc.damages, point, mapper);
    if (picked && picked.id !== selected.id) return handleTap(point);
    const recent = previousInk && previousInk.damageId === selected.id && Date.now() - previousInk.at <= INK_DOT_GAP_MS;
    if (activeKind === 'ink' || recent || nearPendingInk(selected, point)) {
      attachInkStroke(stroke);
      return true;
    }
    return handleTap(point);
  }

  function handleTap(point) {
    const picked = pickDamage(editor.doc.damages, point, mapper);
    setSelection(picked ? picked.id : null, picked ? picked.shapeIndex : 0);
    refresh();
    return selectedId !== null;
  }

  // 새 손상을 문서에 넣고 바로 선택해 속성창을 연다(설계 3.1, 2026-09-17 사용자 정정: 처음 한 번이
  // 아니라 그릴 때마다). 복제·이동·탭은 속성창을 열지 않는다.
  function addNewDamage(damage) {
    setSelection(damage.id, 0);
    apply(addDamage(editor, damage, nowIso()));
    // apply → refresh가 overlay.setDamages로 번호를 다시 계산한 뒤라야 요약줄의 번호가 맞는다.
    openProps();
  }

  createCrackInput({
    viewer,
    container: $('viewer'),
    isDrawEnabled: isDrawKind,
    isInkEnabled: () => activeKind === 'ink',
    onInkDraft: (points) => ink.draft(points),
    onInkStroke: (points) => attachInkStroke(points),
    onInkTap: handleInkTap,
    // 사진 오버레이가 열린 동안도 그리기·탭을 막는다(설계 5장). 판정은 순수 함수가 갖는다.
    isPropsOpen: () => blocksDrawing(isPropsOpen(), isPhotoViewOpen()),
    getActiveTypeKind: () => (isDrawKind() ? activeKind : null),
    getSelectedScreenShape: selectedScreenShape,
    // 선택된 손상의 모든 도형(원본 + 복제본). 선택된 도형이 아니어도 같은 손상의 도형을 끌면 그 도형을
    // 옮긴다(2026-09-30 사용자 요청: 복제한 뒤 원본도 바로 옮길 수 있게). 다른 손상의 도형은 그대로
    // 새로 그리기다 — 기존 손상 위에 겹쳐 그리려다 실수로 옮기지 않게.
    getSelectedDamageScreenShapes: selectedDamageScreenShapes,
    onPickShape: (shapeIndex) => {
      if (selectedId === null) return;
      selectedShape = shapeIndex;
      refresh();
    },
    onDraft: (draft) => overlay.setDraft(draft),
    onTap: handleTap,
    onStroke: (points) => {
      overlay.setDraft(null);
      const lastPoint = points[points.length - 1];
      const damage = finalizeStroke(points, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeIdOf() });
      if (!damage) {
        // 너무 짧은 획은 탭으로 보고 손상 선택에 쓴다.
        handleTap(lastPoint);
        return;
      }
      addNewDamage(damage);
    },
    onRect: (start, end) => {
      overlay.setDraft(null);
      const damage = finalizeRect(start, end, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeIdOf() });
      if (!damage) {
        handleTap(end);
        return;
      }
      addNewDamage(damage);
    },
    // screenPoints: 화면 좌표 점들. 크기 조절·회전은 항상 사각형(네 점)이고, 이동은 선택된 손상의
    // geometry.kind를 그대로 따른다(선이면 여러 점, 사각형이면 네 점) — 점 개수를 가정하지 않는다.
    onTransform: (screenPoints, status) => {
      const damage = selectedDamage();
      if (status === 'preview') {
        // activeId·activeShape를 같이 넘겨, 움직이는 draft 밑에 손 떼기 전 원래 도형·핸들이
        // 겹쳐 보이지 않게 한다. 같은 손상의 다른 도형은 그대로 보인다.
        const kind = damage ? damage.geometry.kind : 'rect';
        overlay.setDraft({ kind, points: screenPoints, activeId: selectedId, activeShape: selectedShape });
        return;
      }
      overlay.setDraft(null);
      // 취소는 아무것도 저장하지 않는다 — draft를 지운 것만으로 원래 문서 그대로 복원된다.
      if (status === 'cancel') return;
      if (!damage) return;
      const world = screenPoints.map(([x, y]) => mapper.clientToWorld(x, y));
      if (world.some((point) => point === null || !isFinitePoint(point))) return;
      const dwgPoints = world.map((point) => mapper.worldToDwg(point));
      const dwg = dwgPoints.every((point) => point !== null && isFinitePoint(point)) ? dwgPoints : null;
      // measured(사용자가 입력한 물량)는 건드리지 않는다 — 도형 수가 변하지 않으므로 개소도 그대로다.
      // computed는 damageDoc.updateShape가 첫 도형(shapeIndex 0)일 때만 다시 센다 — 여기서 하면
      // 복제본을 옮겨도 첫 도형 기준 값이 덮여 버린다.
      apply(updateShape(editor, damage.id, selectedShape, { world, dwg }, nowIso()));
    },
  });

  function openProps() {
    const damage = selectedDamage();
    if (!damage) return;
    // 속성창과 현황표는 같은 자리(오른쪽)라 하나만 연다.
    toggleStatusTable(false);
    // 속성창을 새로 열 때마다 📷 버튼을 되살린다 — 앱이 답을 못 준 채 창을 닫았던 경우의 탈출구다.
    // (photoRequestId·resetPhotoButton은 아래에서 정의되지만 이 함수는 초기화가 끝난 뒤에만 불린다.)
    photoRequestId = null;
    resetPhotoButton();
    $('inkHint').hidden = true;
    const handwriting = damage.attrs.handwriting;
    const hasStrokes = Array.isArray(handwriting?.strokes) && handwriting.strokes.length > 0;
    $('inkErase').hidden = !handwriting;
    if (handwriting && typeof handwriting.text === 'string') {
      $('inkHint').hidden = false;
      $('inkHint').textContent = `손글씨로 읽음: "${handwriting.text}" — 틀렸으면 지우고 옆에 다시 쓰세요`;
    } else if (handwriting && typeof handwriting.image === 'string') {
      $('inkHint').hidden = false;
      $('inkHint').textContent = '손글씨 대기 중 — 전송되면 서버가 읽어 빈 칸을 채웁니다';
    } else if (hasStrokes) {
      $('inkHint').hidden = false;
      $('inkHint').textContent = '손글씨 있음(아직 안 읽음) — 도구막대 「손글씨 인식」을 누르세요';
    }
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    $('propsTitle').textContent = `${type.label} 속성`;
    fillTypeSelect(damage);
    // 치수(폭·길이·개소)·비고 칸은 없다(2026-10-17 단순화) — 손글씨(AI)로 넣고 요약줄로 확인한다.
    $('propsError').hidden = true;
    updateSummary();
    // 사진 줄은 서버에 물어봐야 하므로 기다리지 않고 채운다 — 속성창은 바로 열린다.
    void refreshPhotoStrip(damage.id);
    $('propsPanel').hidden = false;
  }

  // 번호·손상현황·물량은 저장하지 않는다. 보여줄 때마다 다시 계산한다.
  function updateSummary() {
    const damage = selectedDamage();
    if (!damage) return;
    const draft = damage;
    // overlay가 setDamages에서 이미 계산해 둔 번호를 그대로 읽는다 — 여기서 computeNumbers를
    // 다시 부르면 같은 값을 두 번 계산하는 셈이라 캐시를 둔 의미가 없다.
    const number = overlay.numberOf(damage.id);
    const quantity = quantityOf(draft);
    const quantityText = quantity === null ? '-' : `${formatQuantity(quantity)} ${unitOf(draft)}`;
    const m = draft.measured ?? {};
    const dims = [m.width, m.length, m.count].map((v) => (Number.isFinite(v) ? String(v) : '-'));
    const photos = Array.isArray(draft.attrs?.photoNumbers) && draft.attrs.photoNumbers.length > 0 ? ` · 사진 ${draft.attrs.photoNumbers.join(', ')}` : '';
    $('propsSummary').textContent = `번호 ${number ?? '-'} · ${statusTextOf(draft)} · 폭 ${dims[0]}(${widthUnitOf(getDamageType(draft.type))}) 길이 ${dims[1]}m 개소 ${dims[2]} · 물량 ${quantityText}${photos}`;
  }

  // 속성 패널 자신의 검증 메시지. #saveError는 동기화 상태 전용이라 여기서 건드리지 않는다 —
  // 같은 요소를 같이 쓰면 저장 실패 배지와 패널 메시지가 서로를 지운다(A3).
  function showPropsError(message) {
    $('propsError').textContent = message;
    $('propsError').hidden = false;
  }

  // 사진 썸네일 ────────────────────────────────────────────────────────────
  // 사진 API도 x-access-key 헤더를 요구하는데 <img src>에는 헤더를 붙일 수 없다. 그래서 fetch로
  // 받아 blob: 주소를 만들어 쓰고, 다시 그릴 때·닫을 때 거둔다(안 거두면 사진만큼 메모리가 쌓인다).
  // 사진 줄은 서버가 만든 320px 썸네일(thumbUrl)만 받고, 누르면 본 사진(1600px)을 따로 받는다(2026-09-18).
  let photoObjectUrls = [];
  // 지금 사진 줄이 보여주는 손상. 늦게 도착한 목록 응답과 전송 알림을 가려내는 데 쓴다.
  let photoStripDamageId = null;
  // refreshPhotoStrip을 부를 때마다 하나씩 늘어나는 세대 번호(리뷰 Important #1). damageId 가드만으로는
  // "같은 손상에 대해 겹쳐 불린 두 번째 호출"을 구분하지 못한다 — 예를 들어 대기열이 같은 손상의 사진을
  // 연달아 올려 mangdoPhotoUploaded가 겹쳐 오면 photoStripDamageId는 두 호출 내내 같다. 호출마다 세대를
  // 올려 자기 번호를 기억해 두면, 먼저 시작된 호출이 나중 호출보다 늦게 깨어나도 "내가 가장 최근 호출이
  // 아니다"를 알 수 있다.
  let photoStripGeneration = 0;

  // 이 refreshPhotoStrip 호출(damageId·generation으로 식별)이 더 이상 최신이 아닌지. 손상이 바뀌거나
  // (damageId 가드 — closePhotoStrip을 단독으로 부르는 propsClose·setSelection은 generation을
  // 올리지 않으므로 이 가드가 여전히 필요하다) 같은 손상에 대한 더 최근 refreshPhotoStrip이 시작됐으면
  // (generation 가드) true다. 손상이 바뀌는 경우는 새 refreshPhotoStrip 호출이 generation도 함께 올리므로
  // 두 가드가 같이 걸린다.
  function isStalePhotoStrip(damageId, generation) {
    return photoStripDamageId !== damageId || generation !== photoStripGeneration;
  }

  function revokePhotoUrls() {
    for (const url of photoObjectUrls) URL.revokeObjectURL(url);
    photoObjectUrls = [];
  }

  async function loadPhotoBlobUrl(url) {
    const res = await fetch(url, { headers: { 'x-access-key': accessKey } });
    if (!res.ok) throw new Error(`사진을 불러오지 못했습니다 (${res.status})`);
    const objectUrl = URL.createObjectURL(await res.blob());
    photoObjectUrls.push(objectUrl);
    return objectUrl;
  }

  function closePhotoStrip() {
    photoStripDamageId = null;
    // 오버레이가 보여주는 blob 주소는 사진 줄이 만든 것이다. 거두기 전에 먼저 닫는다 —
    // 안 그러면 사진이 사라진 빈 검은 화면이 남는다.
    closePhotoView();
    revokePhotoUrls();
    $('photoStrip').replaceChildren();
    $('photoStrip').hidden = true;
  }

  function chip(text) {
    const span = document.createElement('span');
    span.className = 'photoChip';
    span.textContent = text;
    return span;
  }

  async function refreshPhotoStrip(damageId) {
    const strip = $('photoStrip');
    closePhotoStrip();
    photoStripDamageId = damageId;
    const generation = ++photoStripGeneration;
    if (offline) {
      // 오프라인은 서버 사진 목록을 모른다 — 칸에 적힌 번호마다 자리표시 칩만 보인다(설계 3.4장).
      // 📷 촬영은 지금처럼 앱의 대기열에 맡기고, 연결되면 mangdoPhotoUploaded가 다시 부른다.
      const numbers = selectedDamage()?.attrs?.photoNumbers ?? [];
      for (const number of numbers) strip.append(chip(`${number} (연결되면 보임)`));
      strip.hidden = numbers.length === 0;
      return;
    }
    let list = [];
    try {
      list = await api(`/drawings/${drawingId}/damages/${damageId}/photos`);
    } catch (err) {
      // 목록을 못 읽어도 속성창은 그대로 쓴다 — 사진번호 글자는 이미 칸에 있다.
      console.error('[photos]', damageId, err);
      return;
    }
    // 기다리는 동안 더 최신 호출이 생겼으면(손상 전환이든, 같은 손상에 대한 겹친 호출이든) 버린다.
    if (isStalePhotoStrip(damageId, generation)) return;
    const items = photoStripItems(selectedDamage()?.attrs?.photoNumbers ?? [], list);
    if (items.length === 0) return;
    for (const item of items) {
      if (item.kind === 'missing') {
        strip.append(chip(`${item.number} (서버에 없음)`));
        continue;
      }
      const img = document.createElement('img');
      img.className = 'photoThumb';
      img.alt = `사진 ${item.number}`;
      // 본 사진(1600px)의 blob 주소. 한 번 받으면 이 사진 줄이 닫힐 때까지 다시 받지 않는다 —
      // 누를 때마다 받으면 20번 누르면 20번 내려받고 blob이 20개 쌓인다(검토 Important 2).
      // 썸네일 요청이 404라 본 사진을 줄에 넣은 경우도 여기에 담아 두 번 받지 않는다(Important 3).
      let fullPhoto = null;
      img.addEventListener('click', () => {
        // 줄에는 320px 썸네일만 들어 있다. 누르면 그것을 먼저 크게 띄우고, 본 사진을 받아 도착하면
        // 바꿔 끼운다 — 그 사이 다른 사진을 눌렀거나 닫았으면 버린다.
        if (!img.src) return;
        openPhotoView(img.src, item.number);
        if (item.url === item.thumbUrl) return;
        fullPhoto ??= loadPhotoBlobUrl(item.url);
        fullPhoto.then(
          (objectUrl) => {
            // 기다리는 동안 사진 줄이 바뀌었으면(closePhotoStrip이 먼저 거둔 뒤 도착) 지금 거둔다.
            if (isStalePhotoStrip(damageId, generation)) {
              URL.revokeObjectURL(objectUrl);
              photoObjectUrls = photoObjectUrls.filter((url) => url !== objectUrl);
              return;
            }
            // 다른 사진을 보고 있거나 닫았으면 끼우지 않는다. blob은 다음 누름을 위해 남긴다.
            if (!isPhotoViewShowing(item.number)) return;
            $('photoViewImage').src = objectUrl;
          },
          (err) => {
            fullPhoto = null;
            console.error('[photos]', item.number, err);
          },
        );
      });
      strip.append(img);
      // 썸네일 주소가 404면(서버가 못 만든 사진) 본 사진으로 대신한다.
      loadPhotoBlobUrl(item.thumbUrl)
        .catch((err) => {
          if (item.thumbUrl === item.url) throw err;
          fullPhoto = loadPhotoBlobUrl(item.url);
          return fullPhoto;
        })
        .then(
        (objectUrl) => {
          // 이 blob을 기다리는 동안 더 최신 호출이 생겼으면 이미 지워졌거나 다른 손상의 <img>에
          // 붙이지 않는다 — 방금 받은 사진도 쓰지 않고 바로 거둔다(리뷰 Important #1: 안 거두면
          // 다음 close까지 blob 주소가 누수된다).
          if (isStalePhotoStrip(damageId, generation)) {
            URL.revokeObjectURL(objectUrl);
            photoObjectUrls = photoObjectUrls.filter((url) => url !== objectUrl);
            return;
          }
          img.src = objectUrl;
        },
        (err) => {
          if (isStalePhotoStrip(damageId, generation)) return;
          console.error('[photos]', item.number, err);
          img.replaceWith(chip(`${item.number} (읽기 실패)`));
        },
      );
    }
    strip.hidden = false;
  }

  // 오버레이가 지금 보여주는 사진번호. 본 사진이 늦게 도착했을 때 아직 그 사진을 보고 있는지 가린다.
  let photoViewNumber = null;

  function openPhotoView(objectUrl, number) {
    photoViewNumber = number;
    $('photoViewImage').src = objectUrl;
    $('photoViewImage').alt = `사진 ${number}`;
    $('photoView').hidden = false;
  }

  function isPhotoViewShowing(number) {
    return isPhotoViewOpen() && photoViewNumber === number;
  }

  function closePhotoView() {
    photoViewNumber = null;
    $('photoView').hidden = true;
    // blob: 주소는 사진 줄이 갖고 있으므로 여기서 거두지 않는다 — src만 뗀다.
    $('photoViewImage').removeAttribute('src');
  }

  function isPhotoViewOpen() {
    return !$('photoView').hidden;
  }

  $('photoView').addEventListener('click', closePhotoView);

  $('props').addEventListener('click', openProps);
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
    closePhotoStrip();
  });
  $('typeSelect').addEventListener('change', () => {
    const damage = selectedDamage();
    const type = getDamageType($('typeSelect').value);
    if (!damage || !type) return;
    lastTypeFor[type.kind] = type.id;
    // 기타가 아닌 유형으로 바꾸면 직접 적은 손상현황은 지운다(검증 규칙: 기타에서만 허용).
    apply(updateDamage(editor, damage.id, { type: type.id, attrs: { statusText: type.id === 'etc' ? damage.attrs.statusText : '' } }, nowIso()));
    // 제목·폭 단위·기타 줄을 새 유형에 맞춘다. 입력 중인 값은 그대로 둔다.
    $('propsTitle').textContent = `${type.label} 속성`;
    updateSummary();
  });

  // ── 손글씨(2026-10-17 방식 C) ──────────────────────────────────────────────────────────
  // 이동 모드(선·네모 꺼짐)에서 펜으로 쓴 획은 전부 손글씨다. 획이 끝나면 도면 좌표로 바꿔 **선택한 손상**에
  // 붙여 문서에 저장한다(attrs.handwriting.strokes). 읽기는 도구막대 「손글씨 인식」으로 한 번에: 손상마다 획을 PNG로 그려
  // 앱(→서버→AI)에 보내고 결과를 폭/길이/개소에 넣는다. 인터넷이 없으면 그림을 손상에 붙여 두고
  // 전송될 때 서버가 읽는다. 다 읽은 획은 회색으로 남는다.
  const INK_DOT_GAP_MS = 2500;
  const INK_DOT_NEAR_PX = 80;
  let previousInk = null; // { damageId, at } — 바로 전 획(점 판정용)

  function toDwgPoints(clientPoints) {
    if (!mapper.dwgStatus?.matrix) return null;
    const out = [];
    for (const [x, y] of clientPoints) {
      const world = mapper.clientToWorld(x, y);
      const dwg = world ? mapper.worldToDwg(world) : null;
      if (!dwg || !isFinitePoint(dwg)) return null;
      out.push([Number(dwg[0].toFixed(2)), Number(dwg[1].toFixed(2))]);
    }
    return out;
  }

  // 글씨는 **선택한 손상**에만 붙는다(2026-10-19 사용자 결정: 거리로 맞추면 빽빽한 틀에서 틀린다). 손상을 그리면
  // 자동으로 선택되니 "그리고 → 옆에 쓰고"는 그대로고, 나중에 쓸 때는 그 손상을 탭한 뒤 쓴다. 선택이 없으면 막는다.
  function attachInkStroke(clientPoints) {
    const target = selectedDamage();
    if (!target) {
      showNotice('손상을 먼저 탭해서 선택한 뒤에 쓰세요 — 글씨는 선택한(빨간) 손상에 붙습니다');
      previousInk = null;
      return;
    }
    // 글씨는 작게 쓰므로(높이 20px쯤) 1.5px로 단순화하면 '0'이 팔각형이 된다(2026-10-20 디버그 PNG) — 거의 그대로 둔다.
    const simplified = simplifyPolyline(clientPoints, 0.25);
    const dwg = toDwgPoints(simplified);
    if (!dwg) {
      showNotice('이 도면은 좌표 변환이 없어 손글씨를 붙일 수 없습니다');
      return;
    }
    const current = target.attrs?.handwriting;
    // 이미 읽은 손상에 다시 쓰면 새 글씨로 시작한다(옛 획·읽은 글은 버린다). 안 읽은 글씨면 이어 쓴다.
    const strokes = current && !('text' in current) && Array.isArray(current.strokes) ? [...current.strokes, dwg] : [dwg];
    apply(updateDamage(editor, target.id, { attrs: { handwriting: { strokes } } }, nowIso()));
    previousInk = { damageId: target.id, at: Date.now() };
  }

  const ink = createInkInput({
    svg: $('ink'),
    container: $('viewer'),
    // 이동·손글씨 모드이고 어떤 창도 열려 있지 않을 때만 펜 획을 받는다. 선택한 손상을 끌 때는 crackTool이 먼저 삼킨다.
    isActive: () => !isDrawKind() && !isPropsOpen() && !isPhotoViewOpen() && $('statusPanel').hidden,
    // 마우스(PC 브라우저)는 손글씨 모드에서만. 손가락은 뷰어 도구(crackTool)가 받는다.
    isFingerDrawEnabled: () => activeKind === 'ink',
    onStroke: attachInkStroke,
    onTap: handleInkTap,
  });

  $('inkErase').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    apply(updateDamage(editor, damage.id, { attrs: { handwriting: undefined } }, nowIso()));
    $('inkErase').hidden = true;
    $('inkHint').hidden = true;
    previousInk = null;
  });

  // 인식 요청 한 건: 앱이 있으면 앱에 보내고(window.mangdoHandwritingResult로 회신), 아니면 서버를 직접 부른다.
  const inkWaiters = new Map(); // requestId → resolve
  function recognizeImage(image) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      inkWaiters.set(requestId, resolve);
      if (window.ReactNativeWebView) {
        postToApp({ type: 'handwriting', requestId, drawingId, image });
        return;
      }
      api(`/drawings/${drawingId}/handwriting`, { method: 'POST', body: JSON.stringify({ image }) })
        .then((result) => window.mangdoHandwritingResult({ requestId, ok: true, ...result }))
        .catch((err) => window.mangdoHandwritingResult({ requestId, ok: false, reason: err instanceof Error ? err.message : String(err) }));
    });
  }
  window.mangdoHandwritingResult = (result) => {
    const resolve = result && inkWaiters.get(result.requestId);
    if (!resolve) return;
    inkWaiters.delete(result.requestId);
    resolve(result);
  };

  // 도면 좌표는 y가 위로 자라므로 그림으로 그릴 때 뒤집는다.
  const flipY = (strokes) => strokes.map((stroke) => stroke.map(([x, y]) => [x, -y]));

  $('inkRecognizeAll').addEventListener('click', async () => {
    if (inkBusy) return;
    const targets = pendingInkDamages(editor.doc.damages);
    if (targets.length === 0) return;
    inkBusy = true;
    refresh();
    showNotice(`손글씨 ${targets.length}개 읽는 중…`, 60000);
    let read = 0;
    let deferred = 0;
    let failed = [];
    let unparsed = [];
    for (const target of targets) {
      const latest = editor.doc.damages.find((d) => d.id === target.id);
      const strokes = latest?.attrs?.handwriting?.strokes;
      if (!Array.isArray(strokes) || strokes.length === 0) continue;
      const image = strokesToPngBase64(flipY(strokes));
      if (!image) continue;
      const result = await recognizeImage(image);
      const again = editor.doc.damages.find((d) => d.id === target.id);
      if (!again || again.attrs?.handwriting?.strokes !== strokes) continue; // 읽는 동안 바뀜
      if (result.ok) {
        const measured = {};
        if (result.width != null) measured.width = result.width;
        if (result.length != null) measured.length = result.length;
        if (result.count != null) measured.count = result.count;
        apply(updateDamage(editor, target.id, { measured, attrs: { handwriting: { strokes, text: result.text } } }, nowIso()));
        if (Object.keys(measured).length > 0) read += 1;
        else unparsed.push(result.text || '(빈 글)');
      } else if (/연결|오프라인/.test(String(result.reason))) {
        // 인터넷 없음: 그림을 붙여 두면 전송될 때 서버가 읽는다
        apply(updateDamage(editor, target.id, { attrs: { handwriting: { strokes, image } } }, nowIso()));
        deferred += 1;
      } else {
        failed.push(result.reason);
      }
    }
    inkBusy = false;
    refresh();
    const parts = [];
    if (read > 0) parts.push(`${read}개 읽어 넣음`);
    if (deferred > 0) parts.push(`${deferred}개는 인터넷 되면 서버가 읽음`);
    if (unparsed.length > 0) parts.push(`${unparsed.length}개는 숫자를 못 찾음(읽은 글: ${unparsed.map((u) => `"${u}"`).join(', ')})`);
    if (failed.length > 0) parts.push(`${failed.length}개 실패: ${failed[0]}`);
    showNotice(parts.join(' · ') || '읽을 손글씨가 없습니다', unparsed.length > 0 ? 15000 : 6000);
    if (isPropsOpen()) openProps();
  });

  // 📷 버튼(2026-09-17 카메라 버튼 설계 6장). 앱에 takePhoto를 보내고 window.mangdoPhotoResult로
  // 회신을 받는다 — mangdoFlush(170행)와 같은 방식. requestId로 다른 요청의 답을 가려낸다.
  // 시간제한은 두지 않는다 — 카메라가 앱 위에 떠 있는 동안(사진 구도 잡기, 권한 대화상자) 얼마나
  // 걸릴지 모르고, 앱은 취소·오류를 포함해 언제나 답을 보낸다. 답이 영영 안 오는 경우(앱 오류)는
  // 속성창을 다시 열면(openProps) 버튼이 되살아난다.
  let photoRequestId = null;

  function resetPhotoButton() {
    $('photoCamera').disabled = false;
    $('photoCamera').textContent = '📷';
  }

  $('photoCamera').addEventListener('click', () => {
    // PC 브라우저 등 앱 밖에서 열었을 때는 ReactNativeWebView가 없다 — 앱에 보내지 않고 바로 알린다.
    if (!window.ReactNativeWebView) {
      showPropsError('이 환경에서는 카메라를 쓸 수 없습니다');
      return;
    }
    const damage = selectedDamage();
    if (!damage) return;
    const requestId = crypto.randomUUID();
    photoRequestId = requestId;
    $('photoCamera').disabled = true;
    $('photoCamera').textContent = '⏳';
    // 앱이 사진을 어느 손상 폴더에 넣을지는 뷰어만 안다(2026-09-18 설계 4장).
    postToApp({ type: 'takePhoto', requestId, drawingId, damageId: damage.id });
  });

  // 앱(ViewerScreen.handleMessage)이 촬영 결과를 injectJavaScript로 회신할 때 부른다.
  window.mangdoPhotoResult = (result) => {
    // requestId가 다르면(속성창을 닫았다 다시 연 뒤 온 옛 답 등) 무시한다.
    if (!result || result.requestId !== photoRequestId) return;
    photoRequestId = null;
    resetPhotoButton();
    // 찍는 동안 속성창이 닫혔으면(다른 손상 선택 등) 결과를 버린다 — 잘못된 손상에 번호가 붙지 않게.
    if (!isPropsOpen()) return;
    if (result.ok) {
      const number = photoNumberFromFilename(result.filename);
      // 찍은 번호는 **바로 손상에 저장한다**. 사진은 곧 서버로 올라가는데 번호가 손상에 없으면 zip에서
      // `미연결_`이 된다(2026-09-21 현장).
      const target = selectedDamage();
      if (target) {
        const saved = target.attrs?.photoNumbers;
        const next = withPhotoNumber(saved, number);
        if (next !== saved) apply(updateDamage(editor, target.id, { attrs: { photoNumbers: next } }, nowIso()));
      }
      updateSummary();
      // 방금 붙인 번호는 아직 서버에 없다 — 칩으로 보인다. 전송이 끝나면 mangdoPhotoUploaded가
      // 다시 읽어 썸네일로 바뀐다.
      const shown = selectedDamage();
      if (shown) void refreshPhotoStrip(shown.id);
    } else {
      showPropsError(result.reason);
    }
  };

  // 앱이 서버 전송을 마쳤을 때(설계 4.2). 지금 사진 줄이 보여주는 손상이면 목록을 다시 읽는다.
  // requestId는 보기용이다 — 대기열에 남아 있던 옛 항목은 null로 온다.
  window.mangdoPhotoUploaded = (result) => {
    if (!result || result.damageId !== photoStripDamageId) return;
    void refreshPhotoStrip(result.damageId);
  };

  window.mangdoPhotoUploadFailed = (result) => {
    if (!result || !isPropsOpen() || result.damageId !== photoStripDamageId) return;
    // 다시 시도하는 경우(설계 5장)는 정해진 문구, 더 시도하지 않는 경우(willRetry:false — 서버가 거절해
    // 대기열에서 뺀 경우)는 "앨범엔 남았다"를 앞에 붙이고 서버 사유를 잇는다(README 문제 해결 표와 같은 문구).
    showPropsError(
      result.willRetry
        ? `사진은 앨범에 저장됐고 서버 전송은 다시 시도합니다 (${result.reason})`
        : `사진은 앨범에 저장됐지만 서버가 받지 않았습니다: ${result.reason}`,
    );
  };

  // 번호는 이미 추가·삭제 때마다 자동으로 다시 계산된다(overlay.setDamages). 이 버튼은 문서를
  // 바꾸지 않고 같은 계산을 강제로 다시 돌려 화면에 확인시켜 주는 용도일 뿐이다 — 저장도,
  // updatedAt 변경도, 서버 요청도 하지 않는다. 도구막대에 있으므로 속성 패널이 열려 있어도
  // 동작한다(R3는 도면 입력에만 적용된다).
  // 메시지 자리는 #coordPanel을 재사용한다: #propsError(속성 패널 전용)·#saveError(동기화 상태)는
  // 각자 주인이 있어 건드리지 않는다. #coordPanel은 좌표 확인 모드에서 탭할 때만 채워지는,
  // 이미 hidden/표시를 토글하는 임시 텍스트 자리라 다른 기능과 부딪히지 않는다.
  // 좌표 확인 패널은 좌표 확인을 끌 때만 닫히므로, 이 메시지를 그냥 두면 좌표와 무관한 문구가
  // 화면에 계속 남는다. 잠깐 보여 주고 스스로 지운다.
  $('undo').addEventListener('click', () => {
    setSelection(null);
    apply(undo(editor, nowIso()));
  });
  // 선택된 도형을 오른쪽으로 옮긴 자리에 복제한다(설계 3.2). 새 복제본을 선택해 두므로 사용자는
  // 바로 끌어서 제자리로 옮길 수 있다. 개소는 duplicateShape가 도형 수로 맞춘다.
  $('duplicate').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const shape = shapesOf(damage)[selectedShape];
    if (!shape) return;
    const copy = offsetShape(shape.world, mapper);
    // 크기가 0인 도형은 옮길 자리를 정할 수 없다 — 아무 일도 하지 않는다.
    if (!copy) return;
    // 복제본은 맨 뒤에 붙으므로 새 도형 번호는 지금 도형 수와 같다.
    setSelection(damage.id, shapeCountOf(damage));
    apply(duplicateShape(editor, damage.id, copy, nowIso()));
  });
  $('delete').addEventListener('click', () => {
    if (selectedId === null) return;
    const damage = selectedDamage();
    const id = selectedId;
    const shapeIndex = selectedShape;
    // 선택된 도형만 지운다. 마지막 남은 도형이면 손상 자체가 사라지므로 선택도 지운다. 그 외에는
    // 첫 도형을 지운 경우 복제본이 승격되고, 복제본을 지운 경우 첫 도형이 그대로 남으므로 두
    // 경우 모두 첫 도형(0번)을 선택해 둔다 — 단순하고 예측 가능한 규칙이다(컨트롤러 지시).
    const wasLast = !damage || shapeCountOf(damage) === 1;
    setSelection(wasLast ? null : id, 0);
    apply(removeShape(editor, id, shapeIndex, nowIso()));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void syncer.flushNow();
  });

  // 망도틀 한 페이지씩 보기(2026-09-28 설계 2장) ─────────────────────────────
  // 카메라만 옮긴다 — 그 뒤는 CAMERA_CHANGE_EVENT → overlay.requestRender 흐름이 그대로 다시 그린다.
  // 틀이 없거나 첫 틀조차 뷰어 좌표로 못 바꾸면(DWG 좌표 변환 불가) 페이지 모드를 끈다.
  // 2026-09-30 사용자 결정: 전체/페이지를 나눌 필요 없이 **페이지가 기본이자 유일한 방식**이다. 틀이 없는
  // 도면(또는 좌표 변환 불가)만 예전처럼 도면 전체를 보인다.
  const pagesAvailable = pageCount(frames) > 0 && frameWorldBox(frames[0], mapper.dwgToWorld) !== null;
  const viewMode = pagesAvailable ? 'page' : 'all';
  let pageIndex = clampPage(injectedOffline?.pageIndex ?? 0, frames);
  currentPageIndex = () => pageIndex;

  function fitPage(index) {
    const box = frameWorldBox(frames[index], mapper.dwgToWorld);
    if (!box) return false;
    const bounds = new THREE.Box3(new THREE.Vector3(box.minX, box.minY, 0), new THREE.Vector3(box.maxX, box.maxY, 0));
    viewer.navigation.fitBounds(false, bounds);
    return true;
  }

  function renderPageControls() {
    const count = pageCount(frames);
    $('pageNav').hidden = viewMode !== 'page';
    $('pageLabel').textContent = count > 0 ? pageLabel(pageIndex, count) : '';
    $('pagePrev').disabled = pageIndex <= 0;
    $('pageNext').disabled = pageIndex >= count - 1;
  }

  function postViewPrefs() {
    postToApp({ type: 'viewPrefs', viewMode, pageIndex });
  }

  function showPage(index) {
    pageIndex = clampPage(index, frames);
    fitPage(pageIndex);
    renderPageControls();
    renderStatusTable();
    postViewPrefs();
  }

  $('pagePrev').addEventListener('click', () => showPage(pageIndex - 1));
  $('pageNext').addEventListener('click', () => showPage(pageIndex + 1));

  // 폰 세로에서 도구막대가 두 줄로 감기면 높이가 바뀐다 — 페이지 이동 줄이 그 바로 위에 오도록 알린다.
  const syncToolbarHeight = () =>
    document.documentElement.style.setProperty('--toolbar-h', `${$('toolbar').offsetHeight}px`);
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncToolbarHeight).observe($('toolbar'));
  window.addEventListener('resize', syncToolbarHeight);

  if (initial.needsUpload) syncer.change(initial.doc);
  refresh();
  $('loading').hidden = true;
  $('toolbar').hidden = false;
  syncToolbarHeight();
  renderPageControls();
  // 페이지로 시작하면 뷰어가 도형을 다 그린 다음 틀에 맞춘다(첫 fitToView 뒤에 오도록 한 박자 늦춘다).
  if (viewMode === 'page') {
    // 뷰어가 처음 도면 전체로 맞추는 동작이 기기에 따라 늦게 끝날 수 있다 — 한 프레임 뒤에 한 번,
    // 그리고 조금 뒤에 한 번 더 맞춘다. 그 사이 사용자가 페이지를 바꿨으면 두 번째는 하지 않는다.
    const startPage = pageIndex;
    requestAnimationFrame(() => fitPage(startPage));
    setTimeout(() => {
      if (pageIndex === startPage) fitPage(startPage);
    }, 600);
  }
  postToApp({ type: 'ready' });
}

$('retry').addEventListener('click', () => location.reload());

start().catch((err) => {
  console.error(err);
  showError(err instanceof Error ? err.message : String(err));
});
