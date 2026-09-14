// 손상을 SVG로 그린다. 저장은 world 좌표로 하고, 그릴 때마다 현재 카메라 기준 화면 좌표로 바꾼다.
// 실치수(도면 mm) 기준 표시는 docs/superpowers/specs/2026-09-12-damage-types-design.md 5장,
// 두 줄 라벨은 docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2 근거.

import { getDamageType } from './damageTypes.js';
import { rectCenter } from './geometry.js';
import { computeNumbers, dimensionTextOf, drawingNameOf, photoTextOf } from './quantities.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CRACK_COLOR = '#e53935';
export const SELECTED_COLOR = '#fb8c00';
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

// 라벨 배치 어림값들. 브라우저에 실제 글자 폭을 물어볼 수 없어 근사치를 쓴다(조금 어긋나도 된다).
const ASCII_CHAR_WIDTH_FACTOR = 0.55;
const WIDE_CHAR_WIDTH_FACTOR = 1.0;
const CIRCLE_TEXT_GAP_FACTOR = 0.5; // 원과 이름 사이 간격 (원 반지름의 배수)
const LINE_GAP_FACTOR = 1.3; // 이름줄~치수줄 간격 (글자 높이의 배수)
// 텍스트 베이스라인에서 원 중심까지 거리 (글자 높이의 배수).
// 산출 DXF는 TEXT를 중간 정렬(73=2)로 놓으므로 이 값을 그대로 쓴다 — server/src/export/labelPlacement.ts
export const BASELINE_CENTER_FACTOR = 0.35;

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

// 브라우저에 실제 글자 폭을 물어볼 수 없어(DOM 밖에서도 계산해야 함) 어림한다.
// 아스키 글자는 글자 높이의 0.55배, 그 밖(한글 등)은 1.0배로 본다.
export function estimateTextWidthPx(text, fontPx) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const isAscii = ch.charCodeAt(0) < 128;
    width += fontPx * (isAscii ? ASCII_CHAR_WIDTH_FACTOR : WIDE_CHAR_WIDTH_FACTOR);
  }
  return width;
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

// 라벨(전체 두 줄 묶음)이 도형 위쪽 바깥 어디에 놓일지의 기준점. gapPx는 배율에 따라 달라지므로
// (실치수 100mm 또는 폴백 LABEL_OFFSET_PX) 호출하는 쪽이 매번 계산해 넘긴다.
export function labelAnchor(screenPoints, gapPx) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const [x, y] of screenPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
  }
  if (minX === Infinity) return [0, 0];
  return [(minX + maxX) / 2, minY - gapPx];
}

// 세 줄 라벨(첫 줄: 원+이름, 둘째 줄: 치수, 셋째 줄: 사진번호)의 배치를 정하는 순수 함수. DOM을
// 만들지 않아 테스트하기 쉽다. anchor는 labelAnchor가 돌려준, 도형에서 gapPx만큼 떨어진 기준점
// (라벨 블록에서 도형에 가장 가까운 줄의 기준선)이다.
//
// 줄 순서는 이름/치수/사진이고, 없는 줄은 건너뛰어 빈 줄을 남기지 않는다 — 예를 들어 치수가 없고
// 사진만 있으면 사진이 둘째 줄(치수가 있었다면 있었을 자리, anchor.y) 자리로 올라간다. 라벨
// 전체는 도형 위쪽 바깥에 놓이므로, 줄이 늘수록 위(작은 y)로 쌓이고 맨 아래 줄(가장 큰 y)이
// 항상 anchor.y — 도형에 가장 가까운 자리를 차지한다.
//
// 첫 줄(이름 자리)은 이름이 없어도 번호가 있으면 그린다 — 번호 원만 가운데에 놓인다(균열의 라벨
// 예외, 사내 망도 `(17) 0.2/1.5` 표기). 이름·번호가 둘 다 없을 때만 첫 줄 자체를 건너뛴다.
// 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2, §9.5
export function labelLayout({ anchor, name, dimension, photo = '', number, fontPx, circleRPx }) {
  const [ax, ay] = anchor;
  const hasName = typeof name === 'string' && name.length > 0;
  const hasDimension = typeof dimension === 'string' && dimension.length > 0;
  const hasPhoto = typeof photo === 'string' && photo.length > 0;
  const hasNumber = number !== null && number !== undefined;

  // 위(이름)에서 아래(사진)로, 실제로 있는 줄만 남긴다. 이 순서 그대로 화면에 위→아래로 그려진다.
  // 이름 줄은 이름이 있거나 번호가 있으면(번호 원만이라도) 남긴다.
  const rows = [];
  if (hasName || hasNumber) rows.push({ key: 'name', text: hasName ? name : '' });
  if (hasDimension) rows.push({ key: 'dimension', text: dimension });
  if (hasPhoto) rows.push({ key: 'photo', text: photo });

  if (rows.length === 0) return { circle: null, lines: [] };

  const lines = [];
  let circle = null;
  const lastIndex = rows.length - 1;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    // 맨 아래 줄(lastIndex)이 anchor.y 그대로다. 위로 갈수록 한 줄 간격(LINE_GAP_FACTOR)씩 뺀다.
    const y = ay - (lastIndex - index) * fontPx * LINE_GAP_FACTOR;
    if (row.key === 'name' && hasNumber) {
      // 이름이 없으면 원 폭만으로 가운데 정렬한다(간격·이름 폭을 0으로 둔다) — 원 중심이 ax와 같아진다.
      const gapPx = hasName ? circleRPx * CIRCLE_TEXT_GAP_FACTOR : 0;
      const nameWidth = hasName ? estimateTextWidthPx(row.text, fontPx) : 0;
      const totalWidth = circleRPx * 2 + gapPx + nameWidth;
      const left = ax - totalWidth / 2;
      const cx = left + circleRPx;
      const cy = y - fontPx * BASELINE_CENTER_FACTOR;
      circle = { cx, cy, r: circleRPx };
      lines.push({ x: cx, y, text: String(number), anchor: 'middle' });
      if (hasName) lines.push({ x: left + circleRPx * 2 + gapPx, y, text: row.text, anchor: 'start' });
    } else {
      lines.push({ x: ax, y, text: row.text, anchor: 'middle' });
    }
  }

  return { circle, lines };
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

export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;
  // 번호는 damages가 실제로 바뀔 때만(setDamages) 다시 계산해 여기 담아 둔다. CAMERA_CHANGE는
  // 팬·줌마다 한 번씩(때로는 초당 여러 번) requestRender를 부르므로, render()마다 다시 계산하면
  // 값은 같더라도 매 프레임 불필요한 계산이 반복된다.
  let numbers = new Map();

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

    const anchor = labelAnchor(screen, sizes.labelGapPx);
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
    for (const textLine of layout.lines) elements.push(labelTextElement(textLine, plan.color, sizes.fontPx));

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
