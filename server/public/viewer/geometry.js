// 순수 기하 함수. 점은 [x, y] 배열이다.

export function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distanceToPolyline(p, points) {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p[0] - points[0][0], p[1] - points[0][1]);
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    min = Math.min(min, distanceToSegment(p, points[i - 1], points[i]));
  }
  return min;
}

// Ramer–Douglas–Peucker. 재귀 대신 스택을 써서 긴 획에서도 호출 깊이 문제가 없다.
export function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    let maxDistance = -1;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

// 면형 손상은 회전 가능한 사각형을 네 꼭짓점으로 저장한다. 아래 함수들은 그 네 점을 다룬다.

// 꼭짓점 순서를 드래그 방향과 무관하게 정한다(min/max 기준) — 그래야 첫 변(0→1)이 항상
// 시각적으로 위쪽 변이 되어, 그 바깥에 그리는 회전 핸들이 사각형 아래쪽으로 어긋나지 않는다.
export function rectFromDrag(start, end) {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

export function rectCenter(points) {
  const sum = points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

export function angleOf(center, point) {
  return Math.atan2(point[1] - center[1], point[0] - center[0]);
}

export function rotatePoints(points, center, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
  });
}

// 끄는 모서리의 대각선 반대 모서리를 고정하고, 사각형이 기울어진 방향(변 방향)을 유지한 채 크기를 바꾼다.
export function resizeRect(points, cornerIndex, newPoint) {
  const fixed = points[(cornerIndex + 2) % 4];
  const next = points[(cornerIndex + 1) % 4];
  const previous = points[(cornerIndex + 3) % 4];

  const uRaw = [next[0] - fixed[0], next[1] - fixed[1]];
  const vRaw = [previous[0] - fixed[0], previous[1] - fixed[1]];
  const uLength = Math.hypot(uRaw[0], uRaw[1]) || 1;
  const vLength = Math.hypot(vRaw[0], vRaw[1]) || 1;
  const u = [uRaw[0] / uLength, uRaw[1] / uLength];
  const v = [vRaw[0] / vLength, vRaw[1] / vLength];

  const d = [newPoint[0] - fixed[0], newPoint[1] - fixed[1]];
  const width = d[0] * u[0] + d[1] * u[1];
  const height = d[0] * v[0] + d[1] * v[1];

  const alongU = [fixed[0] + u[0] * width, fixed[1] + u[1] * width];
  const alongV = [fixed[0] + v[0] * height, fixed[1] + v[1] * height];
  const opposite = [fixed[0] + u[0] * width + v[0] * height, fixed[1] + u[1] * width + v[1] * height];

  const result = [];
  result[(cornerIndex + 2) % 4] = [fixed[0], fixed[1]];
  result[(cornerIndex + 1) % 4] = alongU;
  result[cornerIndex] = opposite;
  result[(cornerIndex + 3) % 4] = alongV;
  return result;
}

export function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// 광선 교차 방식. 경계선 위의 점은 안쪽으로 본다(탭으로 고를 때 가장자리를 놓치지 않도록).
export function pointInPolygon(point, polygon) {
  const [px, py] = point;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (distanceToSegment(point, a, b) <= 1e-9) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
