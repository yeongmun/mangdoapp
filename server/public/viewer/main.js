import { addDamage, canUndo, createEditor, migrateDoc, removeDamage, undo, updateDamage, validateDamageDoc } from './damageDoc.js';
import { DAMAGE_TYPES, DEFAULT_DAMAGE_TYPE_ID, getDamageType } from './damageTypes.js';
import { polygonArea } from './geometry.js';
import { createCoordinateMapper } from './coords.js';
import { createCrackInput, finalizeRect, finalizeStroke, isFinitePoint, pickDamage } from './crackTool.js';
import { createOverlay } from './overlay.js';
import { chooseInitialDoc, createSyncer } from './sync.js';
import { formatQuantity, quantityOf, statusTextOf, unitOf, widthUnitOf } from './quantities.js';

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
  const serverDocV3 = migrateDoc(serverDoc, drawingId) ?? serverDoc;
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
  // 서버 문서와 같은 방식으로 백업도 먼저 v3로 옮긴 뒤 검증한다. v1·v2 백업을 그대로 검증하면
  // schemaVersion만으로 거부되어, 아직 서버에 못 올린 손상이 조용히 버려진다.
  const migratedBackup = backup ? (migrateDoc(backup, drawingId) ?? backup) : null;
  const usableBackup =
    migratedBackup && validateDamageDoc(migratedBackup, drawingId).length === 0 ? migratedBackup : null;
  const initial = chooseInitialDoc(serverDocV3, usableBackup);
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

  // 속성 패널이 열려 있는지. 그리기 입력(crackTool)이 패널이 열린 동안 제스처를 시작하지 않도록
  // 이 값을 그대로 물어본다(R3) — 패널은 #viewer 밖에 있어 inViewer() 검사로는 보호되지 않는다.
  function isPropsOpen() {
    return !$('propsPanel').hidden;
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
    isPropsOpen,
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

  function openProps() {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    $('propsTitle').textContent = `${type.label} 속성`;
    // 균열류의 가로/폭만 mm다. 0.3mm·0.5mm 경계로 손상현황이 갈리고, 물량 계산에는 쓰이지 않는다.
    // 단위 판정은 quantities.js의 widthUnitOf가 갖는다 — 2단계 물량표도 같은 판정을 써야 하므로.
    $('widthLabel').textContent = `가로/폭 (${widthUnitOf(type)})`;
    // 손상현황을 직접 적는 것은 기타뿐이다. 나머지는 유형 이름·폭 구간으로 자동으로 정해진다.
    $('statusRow').hidden = type.id !== 'etc';
    $('widthInput').value = damage.measured.width ?? '';
    $('lengthInput').value = damage.measured.length ?? '';
    $('countInput').value = damage.measured.count ?? '';
    $('noteInput').value = damage.attrs.note;
    $('statusInput').value = damage.attrs.statusText;
    // 참고값은 도면 단위(설계 8장 미해결)가 정해질 때까지 숨긴다. 도면 단위를 모르는 채 그대로 보여주면
    // (예: mm 도면의 1.8㎡가 1800000.0으로) 실제 크기와 자릿수가 크게 달라 보여 오히려 오해를 준다.
    $('computedHint').hidden = true;
    // 지난번 저장 시도에서 남은 검증 오류를 새로 열 때 지운다. 그대로 두면 이번 손상과 무관한
    // 메시지가 계속 보인다.
    $('propsError').hidden = true;
    updateSummary();
    $('propsPanel').hidden = false;
  }

  // 빈 입력은 null(측정 안 함)로 본다. 그 외에는 0 이상의 유한한 숫자여야 하며, 아니면 거부한다.
  // type="number" 칸에 `0..5`처럼 숫자로 파싱할 수 없는 글자를 치면 DOM의 value는 ''를 돌려주면서도
  // 화면에는 친 글자가 그대로 남는다. value만 보면 이것과 진짜 빈 칸을 구분할 수 없어 "측정 안 함"으로
  // 조용히 저장돼 버리므로, validity.badInput(브라우저가 판단한 "숫자로 못 읽음")을 먼저 본다.
  function parseAmount(input) {
    if (input.validity.badInput) return { ok: false, value: null };
    const text = input.value.trim();
    if (text === '') return { ok: true, value: null };
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
  }

  // 개소는 낱개를 세는 값이라 정수여야 한다. 1.5개소는 물량표에 적을 수 없다.
  function parseCount(input) {
    if (input.validity.badInput) return { ok: false, value: null };
    const text = input.value.trim();
    if (text === '') return { ok: true, value: null };
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
  }

  // 입력 중인 값으로 만든 임시 손상. 요약줄을 미리 보여주는 데만 쓰고 저장하지 않는다.
  function draftFromInputs(damage) {
    return {
      ...damage,
      measured: {
        width: parseAmount($('widthInput')).value,
        length: parseAmount($('lengthInput')).value,
        count: parseCount($('countInput')).value,
      },
      attrs: { ...damage.attrs, statusText: $('statusInput').value.trim() },
    };
  }

  // 번호·손상현황·물량은 저장하지 않는다. 보여줄 때마다 다시 계산한다.
  function updateSummary() {
    const damage = selectedDamage();
    if (!damage) return;
    const draft = draftFromInputs(damage);
    // overlay가 setDamages에서 이미 계산해 둔 번호를 그대로 읽는다 — 여기서 computeNumbers를
    // 다시 부르면 같은 값을 두 번 계산하는 셈이라 캐시를 둔 의미가 없다.
    const number = overlay.numberOf(damage.id);
    const quantity = quantityOf(draft);
    const quantityText = quantity === null ? '-' : `${formatQuantity(quantity)} ${unitOf(draft)}`;
    $('propsSummary').textContent = `번호 ${number ?? '-'} · 손상현황 ${statusTextOf(draft)} · 물량 ${quantityText}`;
  }

  // 속성 패널 자신의 검증 메시지. #saveError는 동기화 상태 전용이라 여기서 건드리지 않는다 —
  // 같은 요소를 같이 쓰면 저장 실패 배지와 패널 메시지가 서로를 지운다(A3).
  function showPropsError(message) {
    $('propsError').textContent = message;
    $('propsError').hidden = false;
  }

  $('props').addEventListener('click', openProps);
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
  });
  for (const id of ['widthInput', 'lengthInput', 'countInput', 'statusInput']) {
    $(id).addEventListener('input', updateSummary);
  }
  $('propsSave').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    const width = parseAmount($('widthInput'));
    const length = parseAmount($('lengthInput'));
    const count = parseCount($('countInput'));
    // 범위를 벗어난 값·숫자로 읽을 수 없는 글자를 조용히 null로 바꿔 저장하면(예: -3, `0..5`) 사용자가
    // 적은 값이 사라진 채 패널이 닫혀 저장된 것처럼 보인다. 대신 패널을 열어둔 채 알리고 다시 고치게 한다.
    if (!width.ok || !length.ok) {
      showPropsError('저장하지 못했습니다: 0 이상의 숫자를 입력하세요.');
      return;
    }
    if (!count.ok) {
      showPropsError('저장하지 못했습니다: 개소는 0 이상의 정수를 입력하세요.');
      return;
    }
    apply(
      updateDamage(
        editor,
        damage.id,
        {
          measured: { width: width.value, length: length.value, count: count.value },
          attrs: {
            note: $('noteInput').value.trim(),
            // 손상현황은 기타에서만 저장한다. 다른 유형에 값이 남아 있으면 검증에서 막힌다.
            statusText: type.id === 'etc' ? $('statusInput').value.trim() : '',
          },
        },
        nowIso(),
      ),
    );
    $('propsError').hidden = true;
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
  // 번호는 이미 추가·삭제 때마다 자동으로 다시 계산된다(overlay.setDamages). 이 버튼은 문서를
  // 바꾸지 않고 같은 계산을 강제로 다시 돌려 화면에 확인시켜 주는 용도일 뿐이다 — 저장도,
  // updatedAt 변경도, 서버 요청도 하지 않는다. 도구막대에 있으므로 속성 패널이 열려 있어도
  // 동작한다(R3는 도면 입력에만 적용된다).
  // 메시지 자리는 #coordPanel을 재사용한다: #propsError(속성 패널 전용)·#saveError(동기화 상태)는
  // 각자 주인이 있어 건드리지 않는다. #coordPanel은 좌표 확인 모드에서 탭할 때만 채워지는,
  // 이미 hidden/표시를 토글하는 임시 텍스트 자리라 다른 기능과 부딪히지 않는다.
  // 좌표 확인 패널은 좌표 확인을 끌 때만 닫히므로, 이 메시지를 그냥 두면 좌표와 무관한 문구가
  // 화면에 계속 남는다. 잠깐 보여 주고 스스로 지운다.
  let renumberTimer = 0;
  $('renumber').addEventListener('click', () => {
    const count = overlay.recomputeNumbers();
    $('coordPanel').textContent = count === 0 ? '손상이 없습니다' : `번호를 다시 매겼습니다 (${count}개)`;
    $('coordPanel').hidden = false;
    clearTimeout(renumberTimer);
    renumberTimer = setTimeout(() => {
      $('coordPanel').hidden = true;
      $('coordPanel').textContent = '';
    }, 3000);
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
