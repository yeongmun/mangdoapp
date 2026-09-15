// 손상을 SVG로 그린다. 저장은 world 좌표로 하고, 그릴 때마다 현재 카메라 기준 화면 좌표로 바꾼다.
// 실치수(도면 mm) 기준 표시는 docs/superpowers/specs/2026-09-12-damage-types-design.md 5장,
// 두 줄 라벨은 docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2 근거.

import { getDamageType } from './damageTypes.js';
import { boundsOf, rectCenter } from './geometry.js';
import { placeLabels } from './labelCollision.js';
import { estimateTextWidth, labelBlock, placeBlock } from './labelLayout.js';
import { computeNumbers, dimensionTextOf, drawingNameOf, photoTextOf } from './quantities.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CRACK_COLOR = '#e53935';
export const SELECTED_COLOR = '#fb8c00';
// 사진 줄은 도면의 `사진번호` 레이어(노랑, 색 2)와 같아 보이게 그린다. 선택해도 노란색 그대로다.
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
export const PHOTO_COLOR = '#f5c400';
// 화면 기준 선 굵기(px). pxPerMm을 구하지 못한 도면(좌표 변환 불가)에서 쓰는 값이기도 하다.
export const CRACK_WIDTH_PX = 1;
export const SELECTED_WIDTH_PX = 2;
export const HANDLE_SIZE_PX = 12;
export const ROTATE_HANDLE_OFFSET_PX = 28;
// 라벨-도형 간격의 화면 고정값(폴백). pxPerMm이 있으면 LABEL_GAP_MM * pxPerMm을 대신 쓴다.
export const LABEL_OFFSET_PX = 6;
// 무늬 간격의 화면 고정값(폴백). pxPerMm이 있으면 유형별 spacingMm * pxPerMm을 대신 쓴다.
export const PATTERN_SIZE_PX = 10;
// 글자 높이의 화면 고정값(폴백). pxPerMm이 있으면 FONT_HEIGHT_MM * pxPerMm을 대신 쓴다.
const FALLBACK_FONT_PX = 11;

// 도면 실치수(mm) 기준 값. 2026-09-12-damage-types-design.md 5장, 사내 망도 범례 실측값.
export const LINE_WIDTH_MM = 30;
export const FONT_HEIGHT_MM = 300;
export const CIRCLE_RADIUS_FACTOR = 0.85; // 번호 원 반지름 = 글자 높이 * 이 값
export const LABEL_GAP_MM = 100;
// 브라우저가 아예 그리지 않는(=손상이 사라지는) 굵기를 막는 최소값. 글자·무늬에는 두지 않는다
// (많이 축소하면 작아져 안 보이는 것이 캐드와 같은 의도된 동작).
export const MIN_LINE_WIDTH_PX = 0.5;
// 이보다 촘촘한 무늬는 화면을 거의 단색으로 칠하고 브라우저를 느리게 하므로 테두리만 그린다.
export const MIN_PATTERN_SPACING_PX = 1;

// 라벨 배치 규칙과 그 상수는 labelLayout.js에 있다(화면·DXF가 같은 한 벌을 쓴다).
// BASELINE_CENTER_FACTOR는 산출 DXF(server/src/export/labelPlacement.ts)와 기존 테스트가
// overlay.js에서 가져오므로 여기서 그대로 다시 내보낸다.
export { BASELINE_CENTER_FACTOR, CIRCLE_TEXT_GAP_FACTOR, LINE_GAP_FACTOR } from './labelLayout.js';

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// 렌더할 때마다 화면 배율(px/world)과 도면 배율(mm/world)을 구해, 그 비율(px/mm)을 계산한다.
// mapper.worldToDwg가 null을 주는 도면(좌표 변환을 못 구한 경우)은 pxPerMm도 null이다 —
// 기준 삼을 실치수가 없으므로 화면 고정 크기로 그려야 한다. mmPerWorld가 0에 아주 가까운(특이에
// 가까운) 변환에서는 나눗셈이 Infinity로 넘칠 수 있다 — 그 경우도 "기준 삼을 실치수가 없다"와
// 같게 보고 null로 떨어뜨린다. Infinity가 그대로 나가면 이후 크기 계산이 전부 Infinity가 되고
// labelLayout의 좌표 계산(Infinity - Infinity)이 NaN을 만들어 SVG에 잘못된 속성이 들어간다.
export function computeScale(mapper) {
  const clientOrigin = mapper.worldToClient([0, 0]);
  const clientUnit = mapper.worldToClient([1, 0]);
  const pxPerWorld = distance(clientOrigin, clientUnit);

  const dwgOrigin = mapper.worldToDwg([0, 0]);
  const dwgUnit = mapper.worldToDwg([1, 0]);
  const mmPerWorld = dwgOrigin && dwgUnit ? distance(dwgOrigin, dwgUnit) : null;

  const rawPxPerMm = mmPerWorld !== null && mmPerWorld > 0 ? pxPerWorld / mmPerWorld : null;
  const pxPerMm = rawPxPerMm !== null && Number.isFinite(rawPxPerMm) ? rawPxPerMm : null;

  return { pxPerWorld, mmPerWorld, pxPerMm };
}

// pxPerMm으로 이번 렌더에 쓸 화면 픽셀값들을 정한다. pxPerMm이 없으면(도면 좌표 변환 불가)
// 기존 화면 고정값을 그대로 쓴다. computeScale이 이미 Infinity/NaN을 null로 걸러 주지만, 이 함수를
// 다른 곳에서 직접 부를 수도 있으므로(Infinity > 0은 참이라 !(pxPerMm > 0)만으로는 못 거른다)
// 여기서도 한 번 더 막는다.
export function computeRenderSizes(pxPerMm) {
  if (pxPerMm === null || !Number.isFinite(pxPerMm) || !(pxPerMm > 0)) {
    return {
      pxPerMm: null,
      lineWidthPx: CRACK_WIDTH_PX,
      selectedLineWidthPx: SELECTED_WIDTH_PX,
      fontPx: FALLBACK_FONT_PX,
      circleRPx: FALLBACK_FONT_PX * CIRCLE_RADIUS_FACTOR,
      labelGapPx: LABEL_OFFSET_PX,
    };
  }
  const lineWidthPx = Math.max(LINE_WIDTH_MM * pxPerMm, MIN_LINE_WIDTH_PX);
  const fontPx = FONT_HEIGHT_MM * pxPerMm;
  return {
    pxPerMm,
    lineWidthPx,
    selectedLineWidthPx: lineWidthPx * 2,
    fontPx,
    circleRPx: fontPx * CIRCLE_RADIUS_FACTOR,
    labelGapPx: LABEL_GAP_MM * pxPerMm,
  };
}

// 해치 무늬 한 칸의 화면 픽셀 간격. pxPerMm이 없거나(도면 좌표 변환 불가) 유한하지 않으면(특이에
// 가까운 변환이 Infinity로 넘친 경우) 기존 화면 고정 간격을 쓴다.
export function patternSpacingPx(spacingMm, pxPerMm) {
  if (pxPerMm === null || !Number.isFinite(pxPerMm) || !(pxPerMm > 0)) return PATTERN_SIZE_PX;
  return spacingMm * pxPerMm;
}

// 배율마다 무늬 간격(px)이 달라지므로 패턴마다 고유 id가 필요하다. 반올림해 붙이면 확대·축소
// 중 사소한 소수점 차이로 매 프레임 새 id가 생기는 것을 막는다.
export function hatchPatternId(pattern, spacingPx) {
  return `mangdo-hatch-${pattern}-${Math.round(spacingPx)}`;
}

// 면형 유형의 채우기 무늬를 이번 렌더에 실제로 그릴지, 어떤 크기로 그릴지 정하는 순수 함수.
// 간격이 MIN_PATTERN_SPACING_PX(1px) 미만이면 null을 돌려줘 무늬를 건너뛰고 테두리만 그리게 한다 —
// 1px 미만 간격은 화면을 거의 단색으로 칠하고 브라우저도 느리게 만드는, 화면이 "빨갛게 뒤덮이는"
// 상황을 막는 유일한 장치라 별도 함수로 빼서 경계값을 직접 테스트한다.
export function resolveFillPattern(pattern, spacingMm, pxPerMm) {
  const spacingPx = patternSpacingPx(spacingMm, pxPerMm);
  // spacingPx가 NaN이어도(예: spacingMm이 숫자가 아님) '>= ' 비교가 거짓이 되어 안전하게 걸러진다.
  if (!(spacingPx >= MIN_PATTERN_SPACING_PX)) return null;
  const { lineWidthPx } = computeRenderSizes(pxPerMm);
  return { id: hatchPatternId(pattern, spacingPx), sizePx: Math.round(spacingPx), lineWidthPx };
}

// 이름만 다른 겉포장. 화면은 픽셀을 넣으므로 Px를 붙여 부른다(규칙은 labelLayout.js 한 벌뿐이다).
export function estimateTextWidthPx(text, fontPx) {
  return estimateTextWidth(text, fontPx);
}

// 해치 패턴의 화면 표현. 캐드 패턴을 그대로 그리는 것이 아니라 구분이 되도록 흉내 낸다.
// size·strokeWidth는 매 렌더 배율에 맞춰 다시 계산해 넘어온다(실치수 기준 표시).
function patternElement(id, size, strokeWidth, drawChildren) {
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', String(size));
  pattern.setAttribute('height', String(size));
  for (const child of drawChildren(size, strokeWidth)) pattern.append(child);
  return pattern;
}

function line(x1, y1, x2, y2, strokeWidth) {
  const el = document.createElementNS(SVG_NS, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('stroke', CRACK_COLOR);
  el.setAttribute('stroke-width', String(strokeWidth));
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
  ANSI31: (size, strokeWidth) => [line(0, size, size, 0, strokeWidth)],
  ANSI33: (size, strokeWidth) => [line(0, size, size, 0, strokeWidth), line(0, size / 2, size / 2, 0, strokeWidth)],
  ANSI37: (size, strokeWidth) => [line(0, size, size, 0, strokeWidth), line(0, 0, size, size, strokeWidth)],
  CORK: (size, strokeWidth) => [line(0, size, size, 0, strokeWidth), dot(size / 2, size / 2, 1)],
  TRIANG: (size, strokeWidth) => [
    line(0, size, size / 2, 0, strokeWidth),
    line(size / 2, 0, size, size, strokeWidth),
    line(0, size, size, size, strokeWidth),
  ],
  ANCHORLK: (size, strokeWidth) => [
    line(0, size / 2, size / 2, 0, strokeWidth),
    line(size / 2, 0, size, size / 2, strokeWidth),
    line(size, size / 2, size / 2, size, strokeWidth),
    line(size / 2, size, 0, size / 2, strokeWidth),
  ],
};

// patternsNeeded: Map<id, { pattern, sizePx, lineWidthPx }> — 이번 렌더에서 실제로 쓰인 패턴만 담는다.
function buildPatternDefs(patternsNeeded) {
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-mangdo-patterns', '');
  for (const [id, { pattern, sizePx, lineWidthPx }] of patternsNeeded) {
    const draw = HATCH_PATTERNS[pattern];
    if (!draw) continue;
    defs.append(patternElement(id, sizePx, lineWidthPx, draw));
  }
  return defs;
}

// 첫 변(0→1)의 중점에서 사각형 바깥쪽으로 떨어진 지점이 회전 핸들이다.
// 손으로 잡는 조작용이라 화면 고정 크기(ROTATE_HANDLE_OFFSET_PX)를 그대로 쓴다 — 손대지 않는다.
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

// 겹침 방지를 하지 않는 도면(mmPerWorld 없음)에서 쓰는 화면 기준 기본 자리. 화면 좌표는 y가
// 아래로 증가하므로 도형 위쪽(작은 y)으로 gapPx만큼 뗀다. 겹침 방지를 하는 도면은 대신
// labelCollision이 world 좌표로 구해 둔 기준점을 쓴다(createOverlay).
export function labelAnchor(screenPoints, gapPx) {
  const bounds = boundsOf(screenPoints);
  if (!bounds) return [0, 0];
  return [(bounds.minX + bounds.maxX) / 2, bounds.minY - gapPx];
}

// 라벨 배치의 화면 어댑터. 규칙은 labelLayout.js에 있고 여기서는 화면 픽셀(y가 아래로 증가)로
// 옮기기만 한다 — 그 뒤집기는 placeBlock(yDir = -1) 한 곳에서만 일어난다.
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
export function labelLayout({ anchor, name, dimension, photo = '', number, fontPx, circleRPx }) {
  const block = labelBlock({ name, dimension, photo, number, font: fontPx, circleR: circleRPx });
  return placeBlock(block, anchor, -1);
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

function polygonElement(points, color, width, fillPatternId, opacity) {
  const el = document.createElementNS(SVG_NS, 'polygon');
  el.setAttribute('points', pointsAttr(points));
  el.setAttribute('fill', fillPatternId ? `url(#${fillPatternId})` : 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('opacity', String(opacity));
  return el;
}

function labelTextElement(line, color, fontPx) {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', line.x.toFixed(1));
  el.setAttribute('y', line.y.toFixed(1));
  el.setAttribute('fill', color);
  el.setAttribute('font-size', String(fontPx));
  el.setAttribute('text-anchor', line.anchor);
  el.textContent = line.text;
  return el;
}

function numberCircleElement(circle, color, strokeWidth) {
  const el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', circle.cx.toFixed(1));
  el.setAttribute('cy', circle.cy.toFixed(1));
  el.setAttribute('r', circle.r.toFixed(1));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(strokeWidth));
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

// 손상 하나를 어떻게 그릴지 결정한다. DOM을 만들지 않는 순수 함수라 테스트하기 쉽다.
// type을 손상 유형 목록에서 찾지 못해도(유형이 이름 바뀌거나 삭제된 경우) 그리지 않고 건너뛰지 않는다 —
// 그러면 손상이 화면에서 사라져 선택할 수도, 지울 수도 없게 되어 저장이 영영 막힌다. 대신 테두리만
// 그리고 drawingNameOf가 돌려주는 원본 type 문자열을 이름으로 보여줘, 선택해서 `선택 삭제`로 지울 수
// 있게 한다(drawingNameOf도 유형을 못 찾으면 같은 방식으로 원본 문자열을 돌려준다).
/** @type {(damage: any, selectedId: string | null, number?: number | null) => any} */
export function describeDamageRender(damage, selectedId, number = null) {
  const type = getDamageType(damage.type);
  const selected = damage.id === selectedId;
  const isRect = damage.geometry.kind === 'rect';
  return {
    known: type !== null,
    shape: isRect ? 'polygon' : 'polyline',
    color: selected ? SELECTED_COLOR : CRACK_COLOR,
    selected,
    fillPattern: type && type.fill ? type.fill.pattern : null,
    fillSpacingMm: type && type.fill ? type.fill.spacingMm : null,
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    showHandles: selected && isRect,
  };
}

/**
 * @typedef {{ anchor: number[], box: { x: number, y: number, width: number, height: number }, displaced: boolean, leader: { from: number[], to: number[], head: number[][] } | null }} LabelPlacement
 */

// 손상 목록이 바뀔 때 한 번만 부른다(설계 4.5) — 확대·축소해도 결과가 같으므로 매 프레임 다시
// 계산하지 않는다. 계산은 world 단위로 한다: 도면 mm 치수를 mmPerWorld로 나눠 넣고, 답도
// world 좌표로 받아 그릴 때 화면 좌표로 옮긴다.
//
// mmPerWorld를 구하지 못한 도면(도면 좌표 변환 불가)은 null을 돌려준다 — 그런 도면은 화면 고정
// 크기로 그리고 겹침 방지를 하지 않는다(산출도 되지 않으므로 화면과 도면이 어긋날 일이 없다).
/** @type {(damages: any[], numbers: Map<string, number>, mmPerWorld: number | null | undefined) => Map<string, LabelPlacement> | null} */
export function computeLabelPlacements(damages, numbers, mmPerWorld) {
  if (mmPerWorld === null || mmPerWorld === undefined || !Number.isFinite(mmPerWorld) || !(mmPerWorld > 0)) return null;
  const font = FONT_HEIGHT_MM / mmPerWorld;
  const circleR = font * CIRCLE_RADIUS_FACTOR;
  const gap = LABEL_GAP_MM / mmPerWorld;

  const items = [];
  for (const damage of Array.isArray(damages) ? damages : []) {
    const bounds = boundsOf(damage?.geometry?.world);
    if (!bounds) continue;
    const id = String(damage?.id);
    const number = numbers.get(id) ?? null;
    const plan = describeDamageRender(damage, null, number);
    items.push({
      id,
      number,
      bounds,
      block: labelBlock({ name: plan.name, dimension: plan.dimension, photo: plan.photo, number, font, circleR }),
    });
  }
  return placeLabels(items, { gap, font });
}

export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;
  // 번호는 damages가 실제로 바뀔 때만(setDamages) 다시 계산해 여기 담아 둔다. CAMERA_CHANGE는
  // 팬·줌마다 한 번씩(때로는 초당 여러 번) requestRender를 부르므로, render()마다 다시 계산하면
  // 값은 같더라도 매 프레임 불필요한 계산이 반복된다.
  let numbers = new Map();
  // 라벨 자리도 번호와 같은 자리에서 한 번만 계산한다(설계 4.5). null이면 겹침 방지를 하지
  // 않는 도면이라는 뜻이고, 그때는 예전처럼 도형에서 바로 위 자리에 그린다.
  let placements = null;

  function renderDamage(damage, number, elements, sizes, patternsNeeded) {
    const plan = describeDamageRender(damage, selectedId, number);
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));
    const width = plan.selected ? sizes.selectedLineWidthPx : sizes.lineWidthPx;

    let fillPatternId = null;
    if (plan.fillPattern) {
      // resolveFillPattern이 null이면(간격이 1px 미만) 무늬를 그리지 않고 테두리만 그린다.
      const resolved = resolveFillPattern(plan.fillPattern, plan.fillSpacingMm, sizes.pxPerMm);
      if (resolved) {
        fillPatternId = resolved.id;
        if (!patternsNeeded.has(resolved.id)) {
          patternsNeeded.set(resolved.id, { pattern: plan.fillPattern, sizePx: resolved.sizePx, lineWidthPx: resolved.lineWidthPx });
        }
      }
    }

    if (plan.shape === 'polyline') {
      elements.push(polylineElement(screen, plan.color, width, 1));
    } else {
      elements.push(polygonElement(screen, plan.color, width, fillPatternId, 1));
    }

    // 겹침 방지를 한 도면은 미리 구해 둔 world 기준점을 화면 좌표로 옮겨 쓴다. 못 구한 도면은
    // 예전처럼 화면 좌표에서 도형 바로 위를 잡는다.
    const placement = placements ? placements.get(String(damage.id)) ?? null : null;
    const anchor = placement ? mapper.worldToClient(placement.anchor) : labelAnchor(screen, sizes.labelGapPx);
    const layout = labelLayout({
      anchor,
      name: plan.name,
      dimension: plan.dimension,
      photo: plan.photo,
      number: plan.number,
      fontPx: sizes.fontPx,
      circleRPx: sizes.circleRPx,
    });
    if (layout.circle) elements.push(numberCircleElement(layout.circle, plan.color, width));
    for (const textLine of layout.lines) {
      // 사진 줄만 노란색이다(도면의 `사진번호` 레이어와 같아 보이게). 선택해도 바뀌지 않는다.
      const color = textLine.key === 'photo' ? PHOTO_COLOR : plan.color;
      elements.push(labelTextElement(textLine, color, sizes.fontPx));
    }
    // 기본 자리를 벗어난 라벨에는 손상을 가리키는 화살표를 그린다(설계 4.4). 화살대와 화살촉을
    // 폴리라인 둘로 그린다 — 산출 DXF의 LINE 3개와 같은 모양이다.
    if (placement && placement.leader) {
      const from = mapper.worldToClient(placement.leader.from);
      const to = mapper.worldToClient(placement.leader.to);
      const head = placement.leader.head.map((point) => mapper.worldToClient(point));
      elements.push(polylineElement([from, to], plan.color, width, 1));
      elements.push(polylineElement([head[0], to, head[1]], plan.color, width, 1));
    }

    if (!plan.showHandles) return;

    const handles = rectHandlePositions(screen);
    for (const corner of handles.corners) elements.push(handleElement(corner, 'rect'));
    elements.push(handleElement(handles.rotate, 'circle'));
  }

  function render() {
    frame = 0;
    const scale = computeScale(mapper);
    const sizes = computeRenderSizes(scale.pxPerMm);
    const elements = [];
    const patternsNeeded = new Map();
    // 번호는 저장하지 않는다. setDamages에서 이미 계산해 둔 값을 그대로 쓴다(위 numbers 캐시).
    for (const damage of damages) {
      // 크기·회전 조절 중인 손상은 움직이는 draft가 대신 보여준다 — 그대로 두면 손 떼기 전
      // 원래 위치의 사각형·핸들과 draft가 겹쳐 두 개로 보인다.
      if (draft && draft.activeId != null && damage.id === draft.activeId) continue;
      renderDamage(damage, numbers.get(damage.id) ?? null, elements, sizes, patternsNeeded);
    }
    if (draft && draft.points.length > 1) {
      elements.push(
        draft.kind === 'rect'
          ? polygonElement(draft.points, CRACK_COLOR, sizes.lineWidthPx, null, 0.6)
          : polylineElement(draft.points, CRACK_COLOR, sizes.lineWidthPx, 0.6),
      );
    }
    // defs는 매 렌더 새로 만들어 첫 번째 자식으로 넣는다 — 무늬 간격이 배율마다 달라지므로 한 번만
    // 만들어 두던 이전 방식(ensurePatternDefs)을 쓸 수 없다. 이번 렌더에 실제로 쓰인 패턴만 담는다.
    const defs = buildPatternDefs(patternsNeeded);
    svg.replaceChildren(defs, ...elements);
  }

  function requestRender() {
    if (frame === 0) frame = requestAnimationFrame(render);
  }

  return {
    setDamages(list) {
      // 참조가 같으면(선택만 바뀌는 등) 목록 자체는 안 바뀐 것이다 — editor의 모든 변경 함수는
      // 항상 새 배열을 만들므로(damageDoc.js) 참조 비교로 충분하다.
      if (list !== damages) {
        damages = list;
        numbers = computeNumbers(damages);
        // 라벨 자리는 저장하지 않는다 — 목록이 바뀔 때마다 처음부터 다시 잡는다(설계 4.6).
        // 손상 하나를 옮기면 이웃 라벨의 자리도 바뀔 수 있고, 그게 맞는 동작이다.
        placements = computeLabelPlacements(damages, numbers, computeScale(mapper).mmPerWorld);
      }
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
    // main.js의 속성 패널 요약줄(번호 표시)이 render()와 같은 캐시를 쓰도록 내보낸다 —
    // 따로 computeNumbers를 다시 부르면 캐시를 둔 의미가 없다.
    numberOf(id) {
      return numbers.get(id) ?? null;
    },
    // "번호정렬" 버튼 전용. setDamages는 damages 배열 참조가 그대로면(문서가 안 바뀌었으면) 위
  };
}
