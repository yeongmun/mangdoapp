import { addDamage, canUndo, createEditor, migrateDoc, removeDamage, undo, updateDamage, validateDamageDoc } from './damageDoc.js';
import { DAMAGE_TYPES, DEFAULT_DAMAGE_TYPE_ID, getDamageType } from './damageTypes.js';
import { polygonArea } from './geometry.js';
import { createCoordinateMapper } from './coords.js';
import { createCrackInput, finalizeRect, finalizeStroke, isFinitePoint, pickDamage } from './crackTool.js';
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
  const serverDocV2 = migrateDoc(serverDoc, drawingId) ?? serverDoc;
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
  // 서버 문서와 같은 방식으로 백업도 먼저 v2로 옮긴 뒤 검증한다. v1 백업을 그대로 검증하면
  // schemaVersion만으로 거부되어, 아직 서버에 못 올린 손상이 조용히 버려진다.
  const migratedBackup = backup ? (migrateDoc(backup, drawingId) ?? backup) : null;
  const usableBackup =
    migratedBackup && validateDamageDoc(migratedBackup, drawingId).length === 0 ? migratedBackup : null;
  const initial = chooseInitialDoc(serverDocV2, usableBackup);
  let editor = createEditor(initial.doc);
  let selectedId = null;
  let fingerDraw = false;
  let coordCheck = false;
  let activeTypeId = DEFAULT_DAMAGE_TYPE_ID;
  const nowIso = () => new Date().toISOString();

  for (const type of DAMAGE_TYPES) {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.label;
    $('damageType').append(option);
  }
  $('damageType').value = activeTypeId;
  $('damageType').addEventListener('change', () => {
    activeTypeId = $('damageType').value;
  });

  const selectedDamage = () => editor.doc.damages.find((damage) => damage.id === selectedId) ?? null;

  function selectedScreenRect() {
    const damage = selectedDamage();
    if (!damage || damage.geometry.kind !== 'rect') return null;
    return damage.geometry.world.map((point) => mapper.worldToClient(point));
  }

  // 선택 상태를 바꾸는 유일한 곳. 속성창은 선택이 바뀔 때마다 닫는다(다른 손상의 값이 남아있지 않도록).
  // 선택 자체가 속성창을 여는 일은 없다 — 여는 것은 사용자가 "속성" 버튼을 눌렀을 때뿐이다.
  function setSelection(id) {
    selectedId = id;
    $('propsPanel').hidden = true;
  }

  function refresh() {
    overlay.setDamages(editor.doc.damages);
    overlay.setSelected(selectedId);
    $('undo').disabled = !canUndo(editor);
    $('delete').disabled = selectedId === null;
    $('props').disabled = selectedId === null;
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
    setSelection(pickDamage(editor.doc.damages, point, mapper));
    refresh();
    return selectedId !== null;
  }

  createCrackInput({
    viewer,
    container: $('viewer'),
    isFingerDrawEnabled: () => fingerDraw,
    getActiveTypeKind: () => getDamageType(activeTypeId)?.kind ?? 'line',
    getSelectedScreenRect: selectedScreenRect,
    onDraft: (draft) => overlay.setDraft(draft),
    onTap: handleTap,
    onStroke: (points) => {
      overlay.setDraft(null);
      const lastPoint = points[points.length - 1];
      if (coordCheck) {
        handleTap(lastPoint);
        return;
      }
      const damage = finalizeStroke(points, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeId });
      if (!damage) {
        // 너무 짧은 획은 탭으로 보고 손상 선택에 쓴다.
        handleTap(lastPoint);
        return;
      }
      setSelection(null);
      apply(addDamage(editor, damage, nowIso()));
    },
    onRect: (start, end) => {
      overlay.setDraft(null);
      if (coordCheck) {
        handleTap(end);
        return;
      }
      const damage = finalizeRect(start, end, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeId });
      if (!damage) {
        handleTap(end);
        return;
      }
      setSelection(null);
      apply(addDamage(editor, damage, nowIso()));
    },
    onTransform: (screenRect, status) => {
      if (status === 'preview') {
        // activeId를 같이 넘겨, 움직이는 draft 밑에 손 떼기 전 원래 사각형·핸들이 겹쳐 보이지 않게 한다.
        overlay.setDraft({ kind: 'rect', points: screenRect, activeId: selectedId });
        return;
      }
      overlay.setDraft(null);
      // 취소는 아무것도 저장하지 않는다 — draft를 지운 것만으로 원래 문서 그대로 복원된다.
      if (status === 'cancel') return;
      const damage = selectedDamage();
      if (!damage) return;
      const world = screenRect.map(([x, y]) => mapper.clientToWorld(x, y));
      if (world.some((point) => point === null || !isFinitePoint(point))) return;
      const dwgPoints = world.map((point) => mapper.worldToDwg(point));
      const dwg = dwgPoints.every((point) => point !== null && isFinitePoint(point)) ? dwgPoints : null;
      apply(
        updateDamage(
          editor,
          damage.id,
          { geometry: { world, dwg }, computed: { lengthDwg: null, areaDwg: dwg ? polygonArea(dwg) : null } },
          nowIso(),
        ),
      );
    },
  });

  // 균열류(선형 손상: 균열, 균열/백태) — 폭 입력이 의미 있는 유형. quantityUnit이 'm'인 유형과 같다
  // (kind: 'line'과 동치), lengthRow를 보여주는 조건과 같은 기준이다.
  const isCrackLikeType = (type) => type.quantityUnit === 'm';

  function openProps() {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    $('propsTitle').textContent = `${type.label} 속성`;
    $('lengthRow').hidden = type.quantityUnit !== 'm';
    $('areaRow').hidden = type.quantityUnit !== 'm2';
    $('widthRow').hidden = !isCrackLikeType(type);
    $('lengthInput').value = damage.measured.lengthM ?? '';
    $('areaInput').value = damage.measured.areaM2 ?? '';
    $('widthInput').value = damage.attrs.widthMm ?? '';
    $('memberInput').value = damage.attrs.member;
    $('noteInput').value = damage.attrs.note;
    // 참고값은 도면 단위(9장 미확정)가 정해질 때까지 숨긴다. 도면 단위를 모르는 채 그대로 보여주면
    // (예: mm 도면의 1.8㎡가 1800000.0으로) 실제 크기와 자릿수가 크게 달라 보여 오히려 오해를 준다.
    $('computedHint').hidden = true;
    $('propsPanel').hidden = false;
  }

  // 빈 입력은 null(측정 안 함)로 본다. 그 외에는 0 이상의 유한한 숫자여야 하며, 아니면 거부한다.
  function parseAmount(value) {
    const text = value.trim();
    if (text === '') return { ok: true, value: null };
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
  }

  function showSaveError(message) {
    $('saveError').textContent = message;
    $('saveError').hidden = false;
  }

  $('props').addEventListener('click', openProps);
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
  });
  $('propsSave').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    const length = type.quantityUnit === 'm' ? parseAmount($('lengthInput').value) : { ok: true, value: null };
    const area = type.quantityUnit === 'm2' ? parseAmount($('areaInput').value) : { ok: true, value: null };
    const width = isCrackLikeType(type) ? parseAmount($('widthInput').value) : { ok: true, value: null };
    if (!length.ok || !area.ok || !width.ok) {
      // 범위를 벗어난 값을 조용히 null로 바꿔 저장하면(예: -3 입력) 사용자가 적은 값이 사라진 채
      // 패널이 닫혀 저장된 것처럼 보인다. 대신 패널을 열어둔 채 알리고 다시 고치게 한다.
      showSaveError('저장하지 못했습니다: 0 이상의 숫자를 입력하세요.');
      return;
    }
    apply(
      updateDamage(
        editor,
        damage.id,
        {
          measured: { lengthM: length.value, areaM2: area.value },
          attrs: {
            widthMm: width.value,
            member: $('memberInput').value.trim(),
            note: $('noteInput').value.trim(),
          },
        },
        nowIso(),
      ),
    );
    $('saveError').hidden = true;
    $('propsPanel').hidden = true;
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
    setSelection(null);
    apply(undo(editor, nowIso()));
  });
  $('delete').addEventListener('click', () => {
    if (selectedId === null) return;
    const id = selectedId;
    setSelection(null);
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
