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

function isFinitePoint(point) {
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
    measured: { lengthM: null, areaM2: null },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { widthMm: null, member: '', note: '' },
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
  if (Math.abs(endClient[0] - startClient[0]) < MIN_RECT_PX && Math.abs(endClient[1] - startClient[1]) < MIN_RECT_PX) {
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
  getActiveTypeKind,
  getSelectedScreenRect,
  onDraft,
  onStroke,
  onRect,
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
      onTransform(resizeRect(gesture.rect, gesture.index, point), false);
      return;
    }
    onTransform(rotatePoints(gesture.rect, gesture.center, angleOf(gesture.center, point) - gesture.startAngle), false);
  }

  function endGesture(point, cancelled) {
    const current = gesture;
    gesture = null;
    const stroke = points;
    points = [];
    if (!current) return;
    if (cancelled) {
      onDraft(null);
      if (current.kind === 'resize' || current.kind === 'rotate') onTransform(current.rect, true);
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
      onTransform(resizeRect(current.rect, current.index, point), true);
      return;
    }
    onTransform(rotatePoints(current.rect, current.center, angleOf(current.center, point) - current.startAngle), true);
  }

  function onPointerDown(event) {
    if (activePointerId !== null) {
      // 펜으로 그리는 중 닿은 손바닥·다른 손가락은 무시한다 (팜 리젝션).
      swallowedPointers.add(event.pointerId);
      swallow(event);
      return;
    }
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
  tool.handleSingleTap = (event) => onTap([event.canvasX, event.canvasY]);
  tool.handleSingleClick = (event, button) => {
    if (button !== 0) return false;
    const point = typeof event.canvasX === 'number' ? [event.canvasX, event.canvasY] : toCanvas(event);
    return onTap(point);
  };
  viewer.toolController.registerTool(tool);
  viewer.toolController.activateTool(TOOL_NAME);
}
