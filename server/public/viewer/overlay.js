// 손상을 SVG로 그린다. 저장은 world 좌표로 하고, 그릴 때마다 현재 카메라 기준 화면 좌표로 바꾼다.

import { getDamageType } from './damageTypes.js';
import { rectCenter } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CRACK_COLOR = '#e53935';
export const SELECTED_COLOR = '#fb8c00';
// 화면 기준 선 굵기(px). 줌과 무관하게 일정하다. 굵기를 바꾸려면 이 값만 고치면 된다.
export const CRACK_WIDTH_PX = 1;
export const SELECTED_WIDTH_PX = 2;
export const HANDLE_SIZE_PX = 12;
export const ROTATE_HANDLE_OFFSET_PX = 28;

// 해치 패턴의 화면 표현. 캐드 패턴을 그대로 그리는 것이 아니라 구분이 되도록 흉내 낸다.
// 간격 단위는 화면 픽셀이라 도면을 확대해도 촘촘해지지 않는다.
function patternElement(id, size, drawChildren) {
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', String(size));
  pattern.setAttribute('height', String(size));
  for (const child of drawChildren(size)) pattern.append(child);
  return pattern;
}

function line(x1, y1, x2, y2) {
  const el = document.createElementNS(SVG_NS, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('stroke', CRACK_COLOR);
  el.setAttribute('stroke-width', '1');
  return el;
}

function dot(cx, cy, r) {
  const el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', String(cx));
  el.setAttribute('cy', String(cy));
  el.setAttribute('r', String(r));
  el.setAttribute('fill', CRACK_COLOR);
  return el;
}

export const HATCH_PATTERNS = {
  ANSI31: (size) => [line(0, size, size, 0)],
  ANSI33: (size) => [line(0, size, size, 0), line(0, size / 2, size / 2, 0)],
  ANSI37: (size) => [line(0, size, size, 0), line(0, 0, size, size)],
  NET: (size) => [line(0, 0, size, 0), line(0, 0, 0, size)],
  CORK: (size) => [line(0, size, size, 0), dot(size / 2, size / 2, 1)],
  TRIANG: (size) => [line(0, size, size / 2, 0), line(size / 2, 0, size, size), line(0, size, size, size)],
};

const PATTERN_SIZE_PX = 10;

function ensurePatternDefs(svg) {
  if (svg.querySelector('defs[data-mangdo-patterns]')) return;
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-mangdo-patterns', '');
  for (const [name, draw] of Object.entries(HATCH_PATTERNS)) {
    defs.append(patternElement(`mangdo-hatch-${name}`, PATTERN_SIZE_PX, draw));
  }
  svg.append(defs);
}

// 첫 변(0→1)의 중점에서 사각형 바깥쪽으로 떨어진 지점이 회전 핸들이다.
export function rectHandlePositions(screenRect) {
  const center = rectCenter(screenRect);
  const mid = [(screenRect[0][0] + screenRect[1][0]) / 2, (screenRect[0][1] + screenRect[1][1]) / 2];
  const away = [mid[0] - center[0], mid[1] - center[1]];
  const length = Math.hypot(away[0], away[1]) || 1;
  return {
    corners: screenRect.map((p) => [p[0], p[1]]),
    rotate: [mid[0] + (away[0] / length) * ROTATE_HANDLE_OFFSET_PX, mid[1] + (away[1] / length) * ROTATE_HANDLE_OFFSET_PX],
  };
}

function pointsAttr(points) {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function polylineElement(points, color, width, opacity) {
  const el = document.createElementNS(SVG_NS, 'polyline');
  el.setAttribute('points', pointsAttr(points));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('opacity', String(opacity));
  return el;
}

function polygonElement(points, color, width, fillPattern, opacity) {
  const el = document.createElementNS(SVG_NS, 'polygon');
  el.setAttribute('points', pointsAttr(points));
  el.setAttribute('fill', fillPattern ? `url(#mangdo-hatch-${fillPattern})` : 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('opacity', String(opacity));
  return el;
}

function labelElement(point, text) {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', point[0].toFixed(1));
  el.setAttribute('y', point[1].toFixed(1));
  el.setAttribute('fill', CRACK_COLOR);
  el.setAttribute('font-size', '11');
  el.setAttribute('text-anchor', 'middle');
  el.textContent = text;
  return el;
}

function handleElement(point, shape) {
  const half = HANDLE_SIZE_PX / 2;
  const el = document.createElementNS(SVG_NS, shape === 'circle' ? 'circle' : 'rect');
  if (shape === 'circle') {
    el.setAttribute('cx', point[0].toFixed(1));
    el.setAttribute('cy', point[1].toFixed(1));
    el.setAttribute('r', String(half));
  } else {
    el.setAttribute('x', (point[0] - half).toFixed(1));
    el.setAttribute('y', (point[1] - half).toFixed(1));
    el.setAttribute('width', String(HANDLE_SIZE_PX));
    el.setAttribute('height', String(HANDLE_SIZE_PX));
  }
  el.setAttribute('fill', '#fff');
  el.setAttribute('stroke', SELECTED_COLOR);
  el.setAttribute('stroke-width', '2');
  return el;
}

export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;

  ensurePatternDefs(svg);

  function renderDamage(damage, elements) {
    const type = getDamageType(damage.type);
    if (!type) return;
    const selected = damage.id === selectedId;
    const color = selected ? SELECTED_COLOR : CRACK_COLOR;
    const width = selected ? SELECTED_WIDTH_PX : CRACK_WIDTH_PX;
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));

    if (damage.geometry.kind === 'polyline') {
      elements.push(polylineElement(screen, color, width, 1));
      return;
    }

    elements.push(polygonElement(screen, color, width, type.fill ? type.fill.pattern : null, 1));
    if (!type.fill) elements.push(labelElement(rectCenter(screen), type.label));
    if (!selected) return;

    const handles = rectHandlePositions(screen);
    for (const corner of handles.corners) elements.push(handleElement(corner, 'rect'));
    elements.push(handleElement(handles.rotate, 'circle'));
  }

  function render() {
    frame = 0;
    const elements = [];
    for (const damage of damages) renderDamage(damage, elements);
    if (draft && draft.points.length > 1) {
      elements.push(
        draft.kind === 'rect'
          ? polygonElement(draft.points, CRACK_COLOR, CRACK_WIDTH_PX, null, 0.6)
          : polylineElement(draft.points, CRACK_COLOR, CRACK_WIDTH_PX, 0.6),
      );
    }
    const defs = svg.querySelector('defs[data-mangdo-patterns]');
    svg.replaceChildren(defs, ...elements);
  }

  function requestRender() {
    if (frame === 0) frame = requestAnimationFrame(render);
  }

  return {
    setDamages(list) {
      damages = list;
      requestRender();
    },
    setSelected(id) {
      selectedId = id;
      requestRender();
    },
    setDraft(value) {
      draft = value;
      requestRender();
    },
    requestRender,
  };
}
