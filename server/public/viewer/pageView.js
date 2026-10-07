// 망도틀 한 페이지씩 보기의 순수 규칙. DOM·뷰어를 건드리지 않으므로 vitest가 그대로 검사한다.
// 근거: docs/superpowers/specs/2026-09-28-device-only-and-pages-design.md 2장

/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Box
 * @typedef {(point: [number, number]) => ([number, number] | null)} DwgToWorld
 */

/**
 * 페이지 수 = 틀 수. 배열이 아니면(옛 도면 레코드) 0이다.
 * @param {unknown} frames
 * @returns {number}
 */
export function pageCount(frames) {
  return Array.isArray(frames) ? frames.length : 0;
}

/**
 * 저장해 둔 페이지 번호를 지금 도면의 틀 범위(0 ~ 수-1)로 맞춘다. 숫자가 아니거나 NaN이면 0,
 * 소수는 버린다. 틀이 없으면 언제나 0.
 * @param {unknown} index
 * @param {unknown} frames
 * @returns {number}
 */
export function clampPage(index, frames) {
  const count = pageCount(frames);
  if (count === 0 || typeof index !== 'number' || !Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(index)));
}

/** @param {unknown} v */
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 틀(도면좌표, mm)의 네 모서리를 뷰어 좌표로 바꿔 경계상자를 잡고, 폭·높이의 marginRatio만큼
 * 사방에 여백을 더한다. 모서리 하나라도 변환할 수 없거나 틀이 비었으면(폭·높이 0) null.
 * @param {unknown} frame
 * @param {DwgToWorld} dwgToWorld
 * @param {number} [marginRatio]
 * @returns {Box | null}
 */
export function frameWorldBox(frame, dwgToWorld, marginRatio = 0.03) {
  if (typeof frame !== 'object' || frame === null) return null;
  const { minX, minY, maxX, maxY } = /** @type {Record<string, unknown>} */ (frame);
  if (!isNum(minX) || !isNum(minY) || !isNum(maxX) || !isNum(maxY)) return null;
  const x0 = /** @type {number} */ (minX);
  const y0 = /** @type {number} */ (minY);
  const x1 = /** @type {number} */ (maxX);
  const y1 = /** @type {number} */ (maxY);
  if (!(x1 > x0) || !(y1 > y0)) return null;
  /** @type {[number, number][]} */
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const world = [];
  for (const corner of corners) {
    const p = dwgToWorld(corner);
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) return null;
    world.push(p);
  }
  const xs = world.map((p) => p[0]);
  const ys = world.map((p) => p[1]);
  const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (!(width > 0) || !(height > 0)) return null;
  const mx = width * marginRatio;
  const my = height * marginRatio;
  return { minX: box.minX - mx, minY: box.minY - my, maxX: box.maxX + mx, maxY: box.maxY + my };
}

/**
 * 화면 아래 표시: 0부터 센 번호를 1부터 세어 `3 / 7`.
 * @param {number} index
 * @param {number} count
 * @returns {string}
 */
export function pageLabel(index, count) {
  return `${index + 1} / ${count}`;
}
