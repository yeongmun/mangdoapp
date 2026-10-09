// 손글씨 입력(2026-10-09, 인프라스마트 태블릿 Pro의 "펜으로 치수 쓰기"). 속성창의 「손글씨로 입력」이 켜진 동안
// 펜 획을 화면 좌표로 모아 두고(#ink svg에 파랗게 보여 준다), 「인식하기」를 누르면 획을 작은 흑백 PNG로
// 그려 앱(→ 서버 → AI)에 보낸다. 인식 결과를 칸에 넣고 저장하는 건 main.js의 속성창이 한다.
// 획 → 그림 변환(rasterizeStrokes)은 DOM 없이 canvas 비슷한 것만 받아 테스트할 수 있게 떼어 둔다.

const INK_COLOR = '#1e66f5';
const INK_WIDTH_PX = 3;
/** 인식용 그림: 획 둘레 여백과 최소 높이(px). 너무 작으면 모델이 못 읽고, 너무 크면 느리다 */
const RASTER_PADDING = 24;
const RASTER_MIN_HEIGHT = 160;
const RASTER_MAX_WIDTH = 1200;

/** @typedef {number[][]} Stroke */

/**
 * 획들의 둘레 상자. 획이 없으면 null.
 * @param {Stroke[]} strokes
 */
export function strokesBounds(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * 인식용 그림의 크기·배율. 글자 높이가 최소 RASTER_MIN_HEIGHT가 되게 키우되 너비는 RASTER_MAX_WIDTH까지.
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} bounds
 */
export function rasterPlan(bounds) {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  let scale = Math.max(1, RASTER_MIN_HEIGHT / h);
  if ((w + RASTER_PADDING * 2) * scale > RASTER_MAX_WIDTH) scale = RASTER_MAX_WIDTH / (w + RASTER_PADDING * 2);
  return {
    scale,
    width: Math.ceil((w + RASTER_PADDING * 2) * scale),
    height: Math.ceil((h + RASTER_PADDING * 2) * scale),
    offsetX: bounds.minX - RASTER_PADDING,
    offsetY: bounds.minY - RASTER_PADDING,
  };
}

/**
 * 획을 흰 바탕·검은 선 그림으로 그린다. canvas는 document.createElement('canvas')(테스트에서는 가짜).
 * @param {Stroke[]} strokes
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement | null} 획이 없으면 null
 */
export function rasterizeStrokes(strokes, canvas) {
  const bounds = strokesBounds(strokes);
  if (!bounds) return null;
  const plan = rasterPlan(bounds);
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(3, INK_WIDTH_PX * plan.scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    stroke.forEach(([x, y], i) => {
      const px = (x - plan.offsetX) * plan.scale;
      const py = (y - plan.offsetY) * plan.scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    // 점 하나짜리 획(마침표)도 보이게
    if (stroke.length === 1) ctx.lineTo((stroke[0][0] - plan.offsetX) * plan.scale + 0.1, (stroke[0][1] - plan.offsetY) * plan.scale);
    ctx.stroke();
  }
  return canvas;
}

/**
 * 펜 획을 모으는 입력기. 켜진 동안(isActive) 펜(또는 손가락 그리기가 켜졌으면 마우스/손가락) 획을
 * 삼켜 뷰어가 팬하지 않게 하고, 화면에 파랗게 그린다. crackTool과 같은 window 캡처 방식이다 —
 * crackTool은 속성창이 열려 있으면 먼저 손을 떼므로(isPropsOpen) 여기까지 이벤트가 온다.
 * @param {{ svg: SVGSVGElement, container: Element, isActive: () => boolean, isFingerDrawEnabled: () => boolean }} deps
 */
export function createInkInput({ svg, container, isActive, isFingerDrawEnabled }) {
  /** @type {Stroke[]} */
  let strokes = [];
  let current = null;
  let activePointerId = null;

  function toCanvas(event) {
    const rect = container.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function wantsInk(event) {
    if (event.pointerType === 'pen') return true;
    return (event.pointerType === 'mouse' || event.pointerType === 'touch') && isFingerDrawEnabled();
  }

  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function render() {
    const elements = [];
    for (const stroke of current ? [...strokes, current] : strokes) {
      if (stroke.length === 0) continue;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      el.setAttribute('points', stroke.map(([x, y]) => `${x},${y}`).join(' '));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', INK_COLOR);
      el.setAttribute('stroke-width', String(INK_WIDTH_PX));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      elements.push(el);
    }
    svg.replaceChildren(...elements);
  }

  function onDown(event) {
    if (!isActive() || activePointerId !== null) return;
    if (!(event.target instanceof Node && container.contains(event.target)) || !wantsInk(event)) return;
    swallow(event);
    activePointerId = event.pointerId;
    current = [toCanvas(event)];
    render();
  }
  function onMove(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    swallow(event);
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of coalesced.length > 0 ? coalesced : [event]) current.push(toCanvas(sample));
    render();
  }
  function onEnd(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    swallow(event);
    activePointerId = null;
    if (current && current.length > 0) strokes.push(current);
    current = null;
    render();
  }

  const options = { capture: true, passive: false };
  window.addEventListener('pointerdown', onDown, options);
  window.addEventListener('pointermove', onMove, options);
  window.addEventListener('pointerup', onEnd, options);
  window.addEventListener('pointercancel', onEnd, options);

  return {
    strokes: () => strokes,
    hasInk: () => strokes.length > 0,
    clear() {
      strokes = [];
      current = null;
      activePointerId = null;
      render();
    },
    /** 인식용 PNG(base64, data: 머리 없음). 획이 없으면 null */
    toPngBase64() {
      const canvas = rasterizeStrokes(strokes, document.createElement('canvas'));
      if (!canvas) return null;
      return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    },
  };
}
