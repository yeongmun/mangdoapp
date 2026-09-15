// 라벨 한 덩어리(원 + 글자 줄들)가 어떻게 생겼는지 정하는 순수 함수. DOM도, 다른 손상도 모른다.
//
// 단위를 가리지 않는다 — 글자 높이·원 반지름을 넣은 단위 그대로 답한다(mm을 넣으면 mm,
// world를 넣으면 world). 좌표계는 도면 방향 하나뿐이다: y가 위로 증가한다. 앱의 world 좌표도
// 같은 방향이라 화면 계산도 그대로 쓰고, 화면 픽셀(y가 아래로 증가)로의 뒤집기는 placeBlock의
// yDir = -1 한 곳에서만 일어난다.
//
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
// (이 문서가 2026-09-13 설계 §5.2·§9.5의 라벨 배치 규칙을 대체한다)

// 브라우저에 실제 글자 폭을 물어볼 수 없어(DOM 밖에서도 계산해야 한다) 어림한다.
// 아스키 글자는 글자 높이의 0.55배, 그 밖(한글 등)은 1.0배로 본다. 어림이라 아주 긴 이름은
// 조금 겹칠 수 있고, 그 정도는 받아들인다(설계 4.5·7장).
const ASCII_CHAR_WIDTH_FACTOR = 0.55;
const WIDE_CHAR_WIDTH_FACTOR = 1.0;

export const CIRCLE_TEXT_GAP_FACTOR = 0.5; // 원과 글자 사이 간격 (원 반지름의 배수)
export const LINE_GAP_FACTOR = 1.3; // 줄 간격 (글자 높이의 배수)
// 텍스트 베이스라인에서 글자 세로 중심(= 번호 원 중심)까지 거리 (글자 높이의 배수).
// 산출 DXF는 TEXT를 중간 정렬(73=2)로 놓으므로 이 값을 그대로 쓴다 — server/src/export/labelPlacement.ts
export const BASELINE_CENTER_FACTOR = 0.35;

export function estimateTextWidth(text, font) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const isAscii = ch.charCodeAt(0) < 128;
    width += font * (isAscii ? ASCII_CHAR_WIDTH_FACTOR : WIDE_CHAR_WIDTH_FACTOR);
  }
  return width;
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

const EMPTY_BLOCK = { circle: null, lines: [], box: { dx: 0, dy: 0, width: 0, height: 0 }, height: 0 };

/**
 * @typedef {{ dx: number, dy: number, text: string, align: 'start' | 'middle', key: string }} LabelBlockLine
 * @typedef {{ dx: number, dy: number, r: number }} LabelBlockCircle
 * @typedef {{ dx: number, dy: number, width: number, height: number }} LabelBlockBox
 * @typedef {{ circle: LabelBlockCircle | null, lines: LabelBlockLine[], box: LabelBlockBox, height: number }} LabelBlock
 */

// 라벨 한 덩어리의 상대 좌표를 낸다. 기준점은 "맨 아래 줄의 베이스라인 × 블록 가로 가운데"다.
//
// 첫 줄 글자 A는 이름이 있으면 이름, 없으면 치수다 — 균열(crack)은 drawingNameOf가 빈 문자열을
// 주므로 치수가 자동으로 첫 줄로 올라오고(설계 2장 `⑰ 0.2/0.3`), 그때 치수 줄을 또 그리지 않는다.
// 둘째 줄부터는 A의 왼쪽 x에 맞춰 왼쪽 정렬한다. 가운데 정렬은 원 안의 번호 글자뿐이고,
// 블록 전체(원 + 가장 긴 줄)를 기준점 x에 가운데 맞춘다.
/**
 * @type {(params: { name: string, dimension: string, photo: string, number: number | null, font: number, circleR: number }) => LabelBlock}
 */
export function labelBlock({ name, dimension, photo, number, font, circleR }) {
  const nameText = textOf(name);
  const dimensionText = textOf(dimension);
  const photoText = textOf(photo);
  const hasNumber = number !== null && number !== undefined;

  // 위(첫 줄)에서 아래로. 없는 줄은 넣지 않아 빈 줄이 남지 않는다.
  const rows = [];
  if (nameText !== '') {
    rows.push({ key: 'name', text: nameText });
    if (dimensionText !== '') rows.push({ key: 'dimension', text: dimensionText });
  } else if (dimensionText !== '') {
    rows.push({ key: 'dimension', text: dimensionText });
  }
  if (photoText !== '') rows.push({ key: 'photo', text: photoText });
  // 글자가 하나도 없어도 번호가 있으면 원은 그린다(빈 첫 줄을 자리로 둔다).
  if (rows.length === 0) {
    if (!hasNumber) return EMPTY_BLOCK;
    rows.push({ key: 'name', text: '' });
  }

  let textWidth = 0;
  for (const row of rows) textWidth = Math.max(textWidth, estimateTextWidth(row.text, font));
  // 글자가 없으면 원 폭만으로 가운데 맞춘다(간격을 0으로 둔다) — 원 중심이 기준점과 같아진다.
  const circleGap = hasNumber && textWidth > 0 ? circleR * CIRCLE_TEXT_GAP_FACTOR : 0;
  const circleWidth = hasNumber ? circleR * 2 + circleGap : 0;
  const width = circleWidth + textWidth;
  const left = -width / 2;
  const textX = left + circleWidth; // 모든 글자 줄의 왼쪽 x = 들여쓰기 기준

  const lineGap = font * LINE_GAP_FACTOR;
  const last = rows.length - 1;
  const lines = [];
  let circle = null;
  for (let index = 0; index <= last; index++) {
    // 맨 아래 줄(index = last)이 기준점(dy = 0)이고, 위로 갈수록 한 줄 간격씩 커진다.
    const dy = (last - index) * lineGap;
    if (index === 0 && hasNumber) {
      const cx = left + circleR;
      circle = { dx: cx, dy: dy + font * BASELINE_CENTER_FACTOR, r: circleR };
      lines.push({ dx: cx, dy, text: String(number), align: 'middle', key: 'number' });
    }
    if (rows[index].text !== '') {
      lines.push({ dx: textX, dy, text: rows[index].text, align: 'start', key: rows[index].key });
    }
  }

  // 경계상자: 맨 아래 줄 베이스라인부터 첫 줄 글자 윗변까지. 번호 원이 그보다 튀어나오면 넓힌다
  // (한 줄짜리 라벨은 원이 베이스라인 아래로 내려간다).
  let top = last * lineGap + font;
  let bottom = 0;
  if (circle) {
    top = Math.max(top, circle.dy + circle.r);
    bottom = Math.min(bottom, circle.dy - circle.r);
  }
  const box = { dx: left, dy: bottom, width, height: top - bottom };
  return { circle, lines, box, height: box.height };
}

/**
 * @typedef {{ x: number, y: number, text: string, anchor: 'start' | 'middle', key: string }} PlacedLine
 * @typedef {{ cx: number, cy: number, r: number }} PlacedCircle
 * @typedef {{ x: number, y: number, width: number, height: number }} PlacedBox
 * @typedef {{ circle: PlacedCircle | null, lines: PlacedLine[], box: PlacedBox }} PlacedBlock
 */

// 상대 좌표를 기준점에 얹어 실제 좌표로 만든다.
// yDir = 1: 도면·world 좌표(y가 위로) / yDir = -1: 화면 픽셀(y가 아래로).
// **화면과 도면 사이의 y 뒤집기는 이 함수 한 곳에서만 일어난다.**
/** @type {(block: LabelBlock, anchor: [number, number], yDir?: 1 | -1) => PlacedBlock} */
export function placeBlock(block, anchor, yDir = 1) {
  const [ax, ay] = anchor;
  const circle = block.circle
    ? { cx: ax + block.circle.dx, cy: ay + yDir * block.circle.dy, r: block.circle.r }
    : null;
  const lines = block.lines.map((line) => ({
    x: ax + line.dx,
    y: ay + yDir * line.dy,
    text: line.text,
    anchor: line.align,
    key: line.key,
  }));
  // 상자의 (x, y)는 언제나 그 좌표계에서 작은 쪽 모서리다 — y가 위로면 아래 변, 아래로면 위 변.
  const y = yDir === 1 ? ay + block.box.dy : ay - (block.box.dy + block.box.height);
  return { circle, lines, box: { x: ax + block.box.dx, y, width: block.box.width, height: block.box.height } };
}

// 후보 자리를 훑을 때는 글자를 만들 필요가 없다 — 상자만 옮겨 본다(y가 위로).
/** @type {(block: LabelBlock, anchor: [number, number]) => PlacedBox} */
export function blockBoxAt(block, [ax, ay]) {
  return { x: ax + block.box.dx, y: ay + block.box.dy, width: block.box.width, height: block.box.height };
}

// blockBoxAt의 역. 상자를 놓고 싶은 자리(작은 쪽 모서리)를 주면 기준점을 돌려준다.
/** @type {(block: LabelBlock, x: number, y: number) => [number, number]} */
export function anchorForBox(block, x, y) {
  return [x - block.box.dx, y - block.box.dy];
}

// 기본 자리(설계 4.3): 손상 경계상자 바로 위, 간격 gap, 가로 가운데 맞춤. y가 위로 증가한다.
/** @type {(bounds: { minX: number, minY: number, maxX: number, maxY: number }, gap: number) => [number, number]} */
export function baseAnchor(bounds, gap) {
  return [(bounds.minX + bounds.maxX) / 2, bounds.maxY + gap];
}
