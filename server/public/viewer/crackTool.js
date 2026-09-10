// 균열 입력. 펜은 항상 그리기, 손가락은 기본적으로 뷰어 줌·팬.
// "손가락 그리기"를 켜면 한 손가락 드래그와 마우스 드래그로 그리고, 두 손가락 핀치·회전은 뷰어에 넘긴다.

import { distanceToPolyline, polylineLength, simplifyPolyline } from './geometry.js';

export const SIMPLIFY_TOLERANCE_PX = 1.5;
export const MIN_STROKE_PX = 10;
export const PICK_RADIUS_PX = 12;
const TOOL_NAME = 'mangdo-finger-draw';

function isFinitePoint(p) {
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

export function finalizeStroke(clientPoints, mapper, { now, newId }) {
  if (clientPoints.length < 2) return null;
  // 화면과 world는 닮은꼴 변환이므로 화면 1.5px로 단순화하면 world에서도 같은 비율의 허용 오차가 된다.
  // 펜을 가만히 대고 있을 때 들어오는 미세 떨림(240Hz 좌표 샘플)은 원본 길이는 10px을 넘길 수 있으므로,
  // 단순화한 뒤의 길이로 판정해야 실제로 움직이지 않은 획을 걸러낼 수 있다.
  const simplified = simplifyPolyline(clientPoints, SIMPLIFY_TOLERANCE_PX);
  if (simplified.length < 2 || polylineLength(simplified) < MIN_STROKE_PX) return null;

  const world = simplified.map(([x, y]) => mapper.clientToWorld(x, y));
  if (!world.every(isFinitePoint)) return null;

  const dwgPoints = world.map((p) => mapper.worldToDwg(p));
  const dwg = dwgPoints.every(isFinitePoint) ? dwgPoints : null;

  return {
    id: newId(),
    type: 'crack',
    createdAt: now,
    geometry: { kind: 'polyline', world, dwg },
    lengthDwg: dwg ? polylineLength(dwg) : null,
  };
}

export function pickDamage(damages, clientPoint, mapper, radiusPx = PICK_RADIUS_PX) {
  let bestId = null;
  let bestDistance = radiusPx;
  for (const damage of damages) {
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));
    const distance = distanceToPolyline(clientPoint, screen);
    if (distance <= bestDistance) {
      bestId = damage.id;
      bestDistance = distance;
    }
  }
  return bestId;
}

export function createCrackInput({ viewer, container, isFingerDrawEnabled, onDraft, onStroke, onTap }) {
  let activePointerId = null;
  let points = [];
  const swallowedPointers = new Set();

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

  function onPointerDown(event) {
    if (activePointerId !== null) {
      // 펜으로 그리는 중 닿은 손바닥·다른 손가락은 무시한다 (팜 리젝션).
      swallowedPointers.add(event.pointerId);
      swallow(event);
      return;
    }
    if (!inViewer(event) || !wantsDrawing(event)) return;
    swallowedPointers.add(event.pointerId);
    swallow(event);
    activePointerId = event.pointerId;
    points = [toCanvas(event)];
    onDraft(points);
  }

  function onPointerMove(event) {
    if (activePointerId === null) return;
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of samples.length > 0 ? samples : [event]) points.push(toCanvas(sample));
    onDraft(points);
  }

  function onPointerEnd(event) {
    // 펜이 눌리기 전부터 이미 뷰어(Hammer 포인터 입력)가 받은 접촉은 up·cancel도 뷰어로 보내야
    // Hammer에 지워지지 않은 포인터가 남지 않는다.
    if (!swallowedPointers.has(event.pointerId)) return;
    swallowedPointers.delete(event.pointerId);
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    const stroke = points;
    points = [];
    if (event.type === 'pointercancel') {
      onDraft(null);
      return;
    }
    onStroke(stroke);
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
  let fingerPoints = null;
  const tool = new Autodesk.Viewing.ToolInterface();
  tool.names = [TOOL_NAME];
  tool.getPriority = () => 100;
  tool.handleGesture = (event) => {
    if (!isFingerDrawEnabled()) return false;
    const point = [event.canvasX, event.canvasY];
    switch (event.type) {
      case 'dragstart':
        fingerPoints = [point];
        onDraft(fingerPoints);
        return true;
      case 'dragmove':
        if (!fingerPoints) return false;
        fingerPoints.push(point);
        onDraft(fingerPoints);
        return true;
      case 'dragend': {
        if (!fingerPoints) return false;
        const stroke = fingerPoints;
        fingerPoints = null;
        onStroke(stroke);
        return true;
      }
      default:
        // 두 손가락 핀치·회전이 시작되면 그리던 선을 버리고 뷰어가 줌·팬하도록 넘긴다.
        if (fingerPoints) {
          fingerPoints = null;
          onDraft(null);
        }
        return false;
    }
  };
  tool.handleSingleTap = (event) => onTap([event.canvasX, event.canvasY]);
  // PC 마우스 클릭은 뷰어 도구에 handleSingleTap이 아니라 handleSingleClick으로 들어온다.
  tool.handleSingleClick = (event, button) => {
    if (button !== 0) return false;
    const point = typeof event.canvasX === 'number' ? [event.canvasX, event.canvasY] : toCanvas(event);
    return onTap(point);
  };
  viewer.toolController.registerTool(tool);
  viewer.toolController.activateTool(TOOL_NAME);
}
