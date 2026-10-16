// 손글씨 획을 어느 손상에 붙일지 정하는 순수 규칙(2026-10-17, 방식 C: 다 쓰고 한 번에 인식).
// 이동 모드에서 펜으로 쓴 획(도면 좌표)은 **가장 가까운 손상**(도형 변까지의 거리)에 붙는다. 단, 바로 전 획을
// 쓴 지 얼마 안 됐고(groupGapMs) 자리도 그 옆이면(groupGapDwg) 같은 글씨 덩어리로 보고 **전 획과 같은 손상**에
// 붙인다 — "0.2/0.3 3EA"의 뒷부분이 옆 손상에 더 가까워도 갈라지지 않게. 너무 먼 획(maxDistance)은 붙이지 않는다.
// DOM이 없어 vitest(server/test/inkAttach.test.ts)가 검사한다.

/** @typedef {number[][]} Points */

export function pointsBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 점에서 도형(선이면 꺾인 선, 네모면 닫힌 둘레)까지의 거리 */
export function shapeDistance(point, shapePoints, closed) {
  if (!Array.isArray(shapePoints) || shapePoints.length === 0) return Infinity;
  if (shapePoints.length === 1) return Math.hypot(point[0] - shapePoints[0][0], point[1] - shapePoints[0][1]);
  let best = Infinity;
  const n = shapePoints.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const d = segmentDistance(point, shapePoints[i], shapePoints[(i + 1) % n]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 획의 중심에서 가장 가까운 손상. shapesOf(damage)는 [{ dwg }] (damageDoc.shapesOf와 같은 모양).
 * dwg가 없는 손상은 뺀다. 없으면 null.
 * @returns {{ id: string, distance: number } | null}
 */
export function nearestDamage(strokeDwg, damages, shapesOf) {
  const bounds = pointsBounds(strokeDwg);
  if (!bounds) return null;
  const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  let best = null;
  for (const damage of Array.isArray(damages) ? damages : []) {
    const closed = damage?.geometry?.kind === 'rect';
    for (const shape of shapesOf(damage)) {
      if (!Array.isArray(shape?.dwg)) continue;
      const d = shapeDistance(center, shape.dwg, closed);
      if (best === null || d < best.distance) best = { id: String(damage.id), distance: d };
    }
  }
  return best;
}

/**
 * 이 획을 어느 손상에 붙일지. previous는 바로 전 획의 { damageId, at(ms), bounds }.
 * @returns {{ damageId: string, reason: 'group' | 'nearest' } | null}
 */
export function chooseTarget({ strokeDwg, damages, shapesOf, previous, now, maxDistance, groupGapMs, groupGapDwg }) {
  const bounds = pointsBounds(strokeDwg);
  if (!bounds) return null;
  if (previous && previous.damageId && now - previous.at <= groupGapMs && previous.bounds) {
    const b = previous.bounds;
    const gapX = Math.max(0, bounds.minX - b.maxX, b.minX - bounds.maxX);
    const gapY = Math.max(0, bounds.minY - b.maxY, b.minY - bounds.maxY);
    if (Math.hypot(gapX, gapY) <= groupGapDwg && damages.some((d) => String(d.id) === previous.damageId)) {
      return { damageId: previous.damageId, reason: 'group' };
    }
  }
  const nearest = nearestDamage(strokeDwg, damages, shapesOf);
  if (!nearest || nearest.distance > maxDistance) return null;
  return { damageId: nearest.id, reason: 'nearest' };
}

/** 두 덩어리 bounds의 합 */
export function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

/** 아직 안 읽은 손글씨(획은 있고 text는 없음)가 붙은 손상 */
export function pendingInkDamages(damages) {
  return (Array.isArray(damages) ? damages : []).filter((d) => {
    const h = d?.attrs?.handwriting;
    return h && Array.isArray(h.strokes) && h.strokes.length > 0 && typeof h.text !== 'string';
  });
}
