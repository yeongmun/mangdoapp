// 손상 하나를 도면 엔티티로 바꾼다. 유형별 규칙은 damageTypes.js의 정의를 그대로 읽는다 —
// 유형이 늘거나 해치가 바뀌어도 이 파일은 손대지 않는다.
// 좌표는 geometry.dwg(도면 모델 좌표, mm)를 그대로 쓴다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5장,
//       docs/superpowers/specs/2026-09-12-damage-types-design.md 4.1절·8장

import { getDamageType } from '../../public/viewer/damageTypes.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, hatchEntity, lineEntity, lwPolylineEntity, type EntityBase, type Point } from './dxfEntities.js';
import { hatchPatternFor } from './hatchPatterns.js';

// 아주 긴 선에 원을 무한히 찍어 파일이 폭발하는 것을 막는다.
const MAX_DECORATION_CIRCLES = 1000;

// damageTypes.js는 순수 JS라 리터럴 타입이 아닌 string으로 넓혀진다(`kind: string`).
// decoration은 두 모양의 합집합이라 `.kind === 'rebar'`만으로는 판별 유니언으로
// 좁혀지지 않는다 — 여기서만 모양을 다시 선언해 캐스팅한다.
interface RebarDecoration {
  kind: 'rebar';
  lineGapMm: number;
  crossSizeMm: number;
}
interface CirclesDecoration {
  kind: 'circles';
  diameterMm: number;
  spacingMm: number;
  offsetMm: number;
}
type Decoration = RebarDecoration | CirclesDecoration;

export function dwgPointsOf(damage: unknown): Point[] | null {
  const raw = (damage as { geometry?: { dwg?: unknown } } | null)?.geometry?.dwg;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const points: Point[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) return null;
    points.push([entry[0] as number, entry[1] as number]);
  }
  return points;
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

function unit(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

// 사각형의 긴 변 방향으로 가운데에 선 2개를 긋고 양 끝에 ✕를 둔다.
// 선 간격(lineGapMm)과 ✕ 크기(crossSizeMm)는 고정값이고 선 길이만 사각형 크기에 맞춘다.
export function rebarSymbolSegments(rect: Point[], lineGapMm: number, crossSizeMm: number): Array<[Point, Point]> {
  if (rect.length < 4) return [];
  const center: Point = [
    (rect[0][0] + rect[1][0] + rect[2][0] + rect[3][0]) / 4,
    (rect[0][1] + rect[1][1] + rect[2][1] + rect[3][1]) / 4,
  ];
  const edgeA = Math.hypot(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]);
  const edgeB = Math.hypot(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const longIsA = edgeA >= edgeB;
  const longLength = longIsA ? edgeA : edgeB;
  const along = longIsA
    ? unit(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1])
    : unit(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const across: Point = [-along[1], along[0]];

  const lineLength = longLength - crossSizeMm;
  if (!(lineLength > 0)) return [];

  const half = lineLength / 2;
  const gap = lineGapMm / 2;
  const at = (u: number, v: number): Point => [
    center[0] + along[0] * u + across[0] * v,
    center[1] + along[1] * u + across[1] * v,
  ];

  const segments: Array<[Point, Point]> = [
    [at(-half, gap), at(half, gap)],
    [at(-half, -gap), at(half, -gap)],
  ];
  const arm = crossSizeMm / 2;
  for (const u of [-half, half]) {
    segments.push([at(u - arm, -arm), at(u + arm, arm)]);
    segments.push([at(u - arm, arm), at(u + arm, -arm)]);
  }
  return segments;
}

// 그은 선을 따라 일정 간격으로 원을 반복하고 위·아래를 번갈아 둔다.
// 첫 원은 선 시작에서 간격의 절반 지점이다 — 짧은 선에도 원이 하나는 찍히게 한다.
export function decorationCircles(
  points: Point[],
  diameterMm: number,
  spacingMm: number,
  offsetMm: number,
): Array<{ center: Point; radius: number }> {
  if (points.length < 2 || !(spacingMm > 0)) return [];
  const radius = diameterMm / 2;
  const circles: Array<{ center: Point; radius: number }> = [];

  let travelled = 0;
  let nextAt = spacingMm / 2;
  let index = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const direction = unit(dx, dy);
    const normal: Point = [-direction[1], direction[0]];
    while (nextAt <= travelled + length) {
      if (circles.length >= MAX_DECORATION_CIRCLES) return circles;
      const t = nextAt - travelled;
      const sign = index % 2 === 0 ? 1 : -1;
      circles.push({
        center: [
          from[0] + direction[0] * t + normal[0] * offsetMm * sign,
          from[1] + direction[1] * t + normal[1] * offsetMm * sign,
        ],
        radius,
      });
      index += 1;
      nextAt += spacingMm;
    }
    travelled += length;
  }
  return circles;
}

export function damageEntities(damage: unknown, alloc: HandleAllocator, owner: string): DxfPair[] {
  const points = dwgPointsOf(damage);
  if (!points) return [];

  const type = getDamageType((damage as { type?: unknown }).type);
  const closed = (damage as { geometry?: { kind?: unknown } }).geometry?.kind === 'rect';
  const pairs: DxfPair[] = [...lwPolylineEntity(baseFor(alloc, owner), points, closed)];

  const fill = type?.fill;
  if (fill && fill.kind === 'hatch' && closed && points.length >= 3) {
    const pattern = hatchPatternFor(fill.pattern, fill.scale);
    // 정의에 없는 무늬는 테두리만 남긴다 — 이름만 적은 HATCH는 캐드에서 빈 채로 열린다.
    if (pattern) pairs.push(...hatchEntity(baseFor(alloc, owner), points, pattern));
  }

  const decoration = type?.decoration as Decoration | null | undefined;
  if (decoration && decoration.kind === 'rebar' && closed) {
    for (const [from, to] of rebarSymbolSegments(points, decoration.lineGapMm, decoration.crossSizeMm)) {
      pairs.push(...lineEntity(baseFor(alloc, owner), from, to));
    }
  } else if (decoration && decoration.kind === 'circles') {
    for (const { center, radius } of decorationCircles(
      points,
      decoration.diameterMm,
      decoration.spacingMm,
      decoration.offsetMm,
    )) {
      pairs.push(...circleEntity(baseFor(alloc, owner), center, radius));
    }
  }

  return pairs;
}
