// 손상 입력. 펜은 항상 그리기, 손가락은 기본적으로 뷰어 줌·팬.
// "손가락 그리기"를 켜면 한 손가락 드래그와 마우스 드래그로 그리고, 두 손가락 핀치·회전은 뷰어에 넘긴다.

import { getDamageType } from './damageTypes.js';
import { HANDLE_SIZE_PX, rectHandlePositions } from './overlay.js';
import {
  angleOf,
  distanceToPolyline,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rectCenter,
  rectFromDrag,
  resizeRect,
  rotatePoints,
  simplifyPolyline,
} from './geometry.js';

export const SIMPLIFY_TOLERANCE_PX = 1.5;
export const MIN_STROKE_PX = 10;
export const MIN_RECT_PX = 10;
export const PICK_RADIUS_PX = 12;
export const TOOL_NAME = 'mangdo-finger-draw';

export function isFinitePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

// world 점들을 DWG로 바꾼다. 하나라도 못 바꾸면 null.
function toDwg(worldPoints, mapper) {
  const dwg = worldPoints.map((point) => mapper.worldToDwg(point));
  return dwg.every((point) => point !== null && isFinitePoint(point)) ? dwg : null;
}

function normalizeCoordinate(value) {
  // Convert -0 to 0 to match test expectations
  return Object.is(value, -0) ? 0 : value;
}

function normalizePoint(point) {
  return [normalizeCoordinate(point[0]), normalizeCoordinate(point[1])];
}

function normalizePoints(points) {
  return points.map(normalizePoint);
}

function emptyDamage(typeId, worldPoints, dwgPoints, kind, options) {
  return {
    id: options.newId(),
    type: typeId,
    createdAt: options.now,
    geometry: { kind, world: normalizePoints(worldPoints), dwg: dwgPoints ? normalizePoints(dwgPoints) : null },
    // 측정값은 아직 없음(null)이다. 0과 구분한다 — 0은 "재 보니 0"이라는 뜻이다.
    measured: { width: null, length: null, count: null },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '' },
  };
}

export function finalizeStroke(clientPoints, mapper, options) {
  const type = getDamageType(options.typeId);
  if (!type || type.kind !== 'line') return null;
  if (clientPoints.length < 2) return null;
  // 화면과 world는 닮은꼴 변환이므로 화면 1.5px로 단순화하면 world에서도 같은 비율의 허용 오차가 된다.
  const simplified = simplifyPolyline(clientPoints, SIMPLIFY_TOLERANCE_PX);
  if (simplified.length < 2 || polylineLength(simplified) < MIN_STROKE_PX) return null;

  const world = simplified.map(([x, y]) => mapper.clientToWorld(x, y));
  if (!world.every((point) => point !== null && isFinitePoint(point))) return null;

  const dwg = toDwg(world, mapper);
  const damage = emptyDamage(options.typeId, world, dwg, 'polyline', options);
  if (dwg) damage.computed.lengthDwg = polylineLength(dwg);
  return damage;
}

export function finalizeRect(startClient, endClient, mapper, options) {
  const type = getDamageType(options.typeId);
  if (!type || type.kind !== 'area') return null;
  // 두 축 모두 최소 크기를 넘어야 한다. 한 축만 통과시키면(예: 가로 300px·세로 1px) 선에 가까운
  // 사각형이 만들어지고, resizeRect의 기저(0-폭 방향) 계산이 무너져 다시 키울 수도 없게 된다.
  if (Math.abs(endClient[0] - startClient[0]) < MIN_RECT_PX || Math.abs(endClient[1] - startClient[1]) < MIN_RECT_PX) {
    return null;
  }

  const clientRect = rectFromDrag(startClient, endClient);
  const world = clientRect.map(([x, y]) => mapper.clientToWorld(x, y));
  if (!world.every((point) => point !== null && isFinitePoint(point))) return null;

  const dwg = toDwg(world, mapper);
  const damage = emptyDamage(options.typeId, world, dwg, 'rect', options);
  if (dwg) damage.computed.areaDwg = polygonArea(dwg);
  return damage;
}

export function pickDamage(damages, clientPoint, mapper, radiusPx = PICK_RADIUS_PX) {
  let bestId = null;
  let bestDistance = radiusPx;
  for (const damage of damages) {
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));
    if (damage.geometry.kind === 'rect' && pointInPolygon(clientPoint, screen)) return damage.id;
    const distance =
      damage.geometry.kind === 'rect'
        ? distanceToPolyline(clientPoint, [...screen, screen[0]])
        : distanceToPolyline(clientPoint, screen);
    if (distance <= bestDistance) {
      bestId = damage.id;
      bestDistance = distance;
    }
  }
  return bestId;
}

export function hitHandle(clientPoint, screenRect, sizePx = HANDLE_SIZE_PX) {
  if (!screenRect) return null;
  const { corners, rotate } = rectHandlePositions(screenRect);
  const near = (point) => Math.hypot(clientPoint[0] - point[0], clientPoint[1] - point[1]) <= sizePx;
  for (let index = 0; index < corners.length; index++) {
    if (near(corners[index])) return { kind: 'corner', index };
  }
  return near(rotate) ? { kind: 'rotate' } : null;
}

export function createCrackInput({
  viewer,
  container,
  isFingerDrawEnabled,
  // 속성 패널이 열려 있는 동안은 그리기 제스처를 아예 시작하지 않는다(R3). 패널은 #viewer 밖의
  // 240px 모서리 오버레이라 inViewer() 검사로는 막히지 않으므로, 패널이 열려 있으면 펜이 도면에
  // 닿아도 새 손상이 생기거나 선택한 사각형이 움직이지 않아야 한다. 줌·팬은 뷰어 자신의 제스처이므로
  // 여기서 이벤트를 삼키지 않고(스크롤/네비게이션 이벤트는 그대로 두고) false를 돌려주는 방식으로 넘긴다.
  isPropsOpen,
  getActiveTypeKind,
  getSelectedScreenRect,
  onDraft,
  onStroke,
  onRect,
  // onTransform(screenRect, status) — status:
  //   'preview' 드래그 중, 미리보기만(저장하지 않는다)
  //   'commit'  손을 떼 확정(저장한다)
  //   'cancel'  중단(펜 끼어들기, 두 손가락 제스처, pointercancel 등) — 아무것도 저장하지 않는다.
  //             화면은 onDraft(null)로 draft를 지우는 것만으로 원래 문서 그대로 복원된다.
  onTransform,
  onTap,
}) {
  let activePointerId = null;
  let points = [];
  const swallowedPointers = new Set();
  // 지금 진행 중인 동작: null | { kind: 'stroke' } | { kind: 'rect', start }
  //   | { kind: 'resize', index, rect } | { kind: 'rotate', rect, center, startAngle }
  let gesture = null;

  function toCanvas(event) {
    const rect = viewer.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  // window 캡처 단계에서 막으면 뷰어(캔버스 mousedown, Hammer 포인터 입력)가 이벤트를 받지 못한다.
  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function inViewer(event) {
    return event.target instanceof Node && container.contains(event.target);
  }

  function wantsDrawing(event) {
    if (event.pointerType === 'pen') return true;
    return event.pointerType === 'mouse' && event.button === 0 && isFingerDrawEnabled();
  }

  function startGesture(point) {
    const selectedRect = getSelectedScreenRect();
    const handle = hitHandle(point, selectedRect);
    if (handle) {
      gesture =
        handle.kind === 'corner'
          ? { kind: 'resize', index: handle.index, rect: selectedRect }
          : { kind: 'rotate', rect: selectedRect, center: rectCenter(selectedRect), startAngle: angleOf(rectCenter(selectedRect), point) };
      return;
    }
    if (getActiveTypeKind() === 'area') {
      gesture = { kind: 'rect', start: point };
      onDraft({ kind: 'rect', points: rectFromDrag(point, point) });
      return;
    }
    gesture = { kind: 'stroke' };
    points = [point];
    onDraft({ kind: 'polyline', points });
  }

  function moveGesture(point, samples) {
    if (!gesture) return;
    if (gesture.kind === 'stroke') {
      for (const sample of samples) points.push(sample);
      onDraft({ kind: 'polyline', points });
      return;
    }
    if (gesture.kind === 'rect') {
      onDraft({ kind: 'rect', points: rectFromDrag(gesture.start, point) });
      return;
    }
    if (gesture.kind === 'resize') {
      onTransform(resizeRect(gesture.rect, gesture.index, point), 'preview');
      return;
    }
    onTransform(rotatePoints(gesture.rect, gesture.center, angleOf(gesture.center, point) - gesture.startAngle), 'preview');
  }

  function endGesture(point, cancelled) {
    const current = gesture;
    gesture = null;
    const stroke = points;
    points = [];
    if (!current) return;
    if (cancelled) {
      onDraft(null);
      // 취소는 저장하지 않는다 — draft를 지우는 것만으로 화면이 원래 문서로 복원된다.
      if (current.kind === 'resize' || current.kind === 'rotate') onTransform(current.rect, 'cancel');
      return;
    }
    if (current.kind === 'stroke') {
      onDraft(null);
      onStroke(stroke);
      return;
    }
    if (current.kind === 'rect') {
      onDraft(null);
      onRect(current.start, point);
      return;
    }
    if (current.kind === 'resize') {
      onTransform(resizeRect(current.rect, current.index, point), 'commit');
      return;
    }
    onTransform(rotatePoints(current.rect, current.center, angleOf(current.center, point) - current.startAngle), 'commit');
  }

  function onPointerDown(event) {
    if (activePointerId !== null) {
      // 펜으로 그리는 중 닿은 손바닥·다른 손가락은 무시한다 (팜 리젝션).
      swallowedPointers.add(event.pointerId);
      swallow(event);
      return;
    }
    // 속성 패널이 열려 있으면 그리기를 시작하지 않는다. swallow()를 호출하지 않고 그냥 돌아가
    // 이벤트가 뷰어에 그대로 전달되게 한다 — 두 손가락 줌·팬 등 뷰어 자신의 제스처가 막히지 않는다.
    if (isPropsOpen()) return;
    if (!inViewer(event) || !wantsDrawing(event)) return;
    // 손가락 드래그 중 펜이 터치되면 손가락 제스처를 취소하고 펜을 우선한다.
    if (gesture !== null) {
      endGesture(toCanvas(event), true);
    }
    swallow(event);
    swallowedPointers.add(event.pointerId);
    activePointerId = event.pointerId;
    startGesture(toCanvas(event));
  }

  function onPointerMove(event) {
    if (activePointerId === null) return;
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = (coalesced.length > 0 ? coalesced : [event]).map((sample) => toCanvas(sample));
    moveGesture(samples[samples.length - 1], samples);
  }

  function onPointerEnd(event) {
    // 펜보다 먼저 닿아 있던 접촉은 뷰어가 down을 이미 받았으므로 up/cancel을 그대로 넘긴다.
    if (!swallowedPointers.has(event.pointerId)) return;
    swallowedPointers.delete(event.pointerId);
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    endGesture(toCanvas(event), event.type === 'pointercancel');
  }

  // iOS는 Apple Pencil에 대해 touch 이벤트도 보낸다. 펜 터치와 그리는 중의 터치는 뷰어에 넘기지 않는다.
  function onTouch(event) {
    const hasStylus = Array.from(event.changedTouches).some((touch) => touch.touchType === 'stylus');
    if (activePointerId !== null || (hasStylus && inViewer(event))) swallow(event);
  }

  const listenerOptions = { capture: true, passive: false };
  window.addEventListener('pointerdown', onPointerDown, listenerOptions);
  window.addEventListener('pointermove', onPointerMove, listenerOptions);
  window.addEventListener('pointerup', onPointerEnd, listenerOptions);
  window.addEventListener('pointercancel', onPointerEnd, listenerOptions);
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    window.addEventListener(type, onTouch, listenerOptions);
  }

  // 손가락 그리기: 뷰어 도구로 등록해 한 손가락 드래그(drag*)만 가져간다.
  const tool = new Autodesk.Viewing.ToolInterface();
  tool.names = [TOOL_NAME];
  tool.getPriority = () => 100;
  tool.handleGesture = (event) => {
    if (activePointerId !== null) return false;
    if (!isFingerDrawEnabled()) return false;
    const point = [event.canvasX, event.canvasY];
    // 속성 패널이 열려 있으면 손가락 제스처를 받지 않는다. false를 돌려주면 툴 컨트롤러가 다음
    // 우선순위 도구(뷰어의 기본 줌·팬)에 넘기므로 핀치·회전 같은 뷰어 제스처는 그대로 동작한다.
    // 패널이 열리기 전부터 진행 중이던 제스처가 있으면(예: 한 손가락으로 크기 조절 중 다른 손가락이
    // 속성 버튼을 누른 경우) 먼저 취소한다 — 그냥 false만 돌려주면 이후의 dragmove/dragend도 계속
    // false를 돌려줘 endGesture가 영영 불리지 않고, 마지막 미리보기(draft)가 실제 위치 대신 화면에
    // 남는다.
    if (isPropsOpen()) {
      if (gesture) endGesture(point, true);
      return false;
    }
    switch (event.type) {
      case 'dragstart':
        startGesture(point);
        return true;
      case 'dragmove':
        if (!gesture) return false;
        moveGesture(point, [point]);
        return true;
      case 'dragend':
        if (!gesture) return false;
        endGesture(point, false);
        return true;
      default:
        // 두 손가락 핀치·회전이 시작되면 그리던 것을 버리고 뷰어가 줌·팬하도록 넘긴다.
        if (gesture) endGesture(point, true);
        return false;
    }
  };
  // 속성 패널이 열려 있으면 탭도 받지 않는다(R6). 탭이 선택을 바꾸면 setSelection이 패널을 닫아
  // 입력하던 값을 지우므로, 그리기 제스처와 똑같이 막아야 한다. false는 이 두 핸들러가 "처리 안 함"을
  // 나타낼 때 이미 쓰는 값이라 그대로 돌려주면 뷰어 자신의 탭 처리(선택 해제 등)로 넘어간다.
  tool.handleSingleTap = (event) => {
    if (isPropsOpen()) return false;
    return onTap([event.canvasX, event.canvasY]);
  };
  tool.handleSingleClick = (event, button) => {
    if (button !== 0) return false;
    if (isPropsOpen()) return false;
    const point = typeof event.canvasX === 'number' ? [event.canvasX, event.canvasY] : toCanvas(event);
    return onTap(point);
  };
  viewer.toolController.registerTool(tool);
  viewer.toolController.activateTool(TOOL_NAME);
}
