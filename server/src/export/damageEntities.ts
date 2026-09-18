// 손상 하나를 도면 엔티티로 바꾼다. 유형별 규칙은 damageTypes.js의 정의를 그대로 읽는다 —
// 유형이 늘거나 해치가 바뀌어도 이 파일은 손대지 않는다.
// 좌표는 geometry.dwg(도면 모델 좌표, mm)를 그대로 쓴다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5장,
//       docs/superpowers/specs/2026-09-12-damage-types-design.md 4.1절·8장

import { getDamageType } from '../../public/viewer/damageTypes.js';
import { shapesOf } from '../../public/viewer/damageDoc.js';
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
  crossGapMm?: number;
  boxMarginMm?: number;
}
interface CirclesDecoration {
  kind: 'circles';
  diameterMm: number;
  spacingMm: number;
  offsetMm: number;
}
type Decoration = RebarDecoration | CirclesDecoration;

// 점 배열 하나를 검사해 Point[]로 바꾼다. 한 점이라도 숫자가 아니면 그 도형은 그리지 않는다.
function pointsFrom(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const points: Point[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) return null;
    points.push([entry[0] as number, entry[1] as number]);
  }
  return points;
}

/** 첫 도형(geometry.dwg)의 점. 틀 배정·라벨 자리처럼 "손상 하나의 대표 좌표"가 필요한 곳이 쓴다. */
export function dwgPointsOf(damage: unknown): Point[] | null {
  return pointsFrom((damage as { geometry?: { dwg?: unknown } } | null)?.geometry?.dwg);
}

/**
 * 손상의 모든 도형(첫 도형 + 복제본)의 도면 좌표. **도형 번호를 그대로 유지한다** — 좌표가 없는
 * 도형을 걸러 내면 번호가 밀려 복제본이 첫 도형 자리로 올라온다(라벨·장애물 계산이 어긋난다).
 */
export function dwgShapesOf(damage: unknown): Array<Point[] | null> {
  return shapesOf(damage).map((shape) => pointsFrom(shape.dwg));
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

function unit(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

// 사각형의 긴 변 방향으로 가운데에 선 2개를 긋고 양 끝에 ✕를 둔다.
// 선 간격(lineGapMm)은 고정값이다. ✕ 크기(crossSizeMm)도 고정값이지만 사각형 짧은 변보다 크면 짧은 변에
// 맞춰 줄인다 — 그러지 않으면 ✕가 사각형 밖으로 튀어나온다(2026-09-16 캐드 확인 8번). 선은 ✕ 중심이
// 아니라 ✕의 대각선과 만나는 곳에서 끝난다 — 중심까지 그으면 선이 ✕를 뚫고 나가 보인다.
// crossGapMm(✕ 중심 사이 거리, 범례 1009)을 주면 기호는 사각형이 커도 그 길이를 넘지 않는다 — 사각형은
// 기호를 감싸는 틀일 뿐이고 기호는 범례 크기다(2026-09-18). 작은 사각형에서는 지금처럼 줄어든다.
export function rebarSymbolSegments(rect: Point[], lineGapMm: number, crossSizeMm: number, crossGapMm?: number): Array<[Point, Point]> {
  if (rect.length < 4) return [];
  const center: Point = [
    (rect[0][0] + rect[1][0] + rect[2][0] + rect[3][0]) / 4,
    (rect[0][1] + rect[1][1] + rect[2][1] + rect[3][1]) / 4,
  ];
  const edgeA = Math.hypot(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]);
  const edgeB = Math.hypot(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const longIsA = edgeA >= edgeB;
  const longLength = longIsA ? edgeA : edgeB;
  const shortLength = longIsA ? edgeB : edgeA;
  const along = longIsA
    ? unit(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1])
    : unit(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const across: Point = [-along[1], along[0]];

  const fitted = longLength - crossSizeMm;
  const lineLength = crossGapMm !== undefined && crossGapMm > 0 ? Math.min(fitted, crossGapMm) : fitted;
  if (!(lineLength > 0)) return [];
  // 짧은 변이 선 간격보다 좁으면 두 선이 사각형 밖으로 나가고 ✕는 점이 된다 — 기호 없이 사각형만 남긴다.
  if (shortLength < lineGapMm) return [];

  const half = lineLength / 2;
  const gap = lineGapMm / 2;
  const at = (u: number, v: number): Point => [
    center[0] + along[0] * u + across[0] * v,
    center[1] + along[1] * u + across[1] * v,
  ];

  // ✕의 팔 길이(중심에서 끝까지). 사각형 짧은 변 안에 들어가게 줄인다.
  const arm = Math.min(crossSizeMm, shortLength) / 2;
  // 선은 ✕ 대각선(기울기 ±1)과 v = ±gap에서 만나는 u = ±(half − gap)까지만 긋는다. 팔이 gap보다
  // 짧아 대각선이 선 높이까지 오지 않으면 ✕ 안쪽 끝(half − arm)에서 끝낸다.
  const lineEnd = half - Math.min(gap, arm);
  const segments: Array<[Point, Point]> = [
    [at(-lineEnd, gap), at(lineEnd, gap)],
    [at(-lineEnd, -gap), at(lineEnd, -gap)],
  ];
  for (const u of [-half, half]) {
    segments.push([at(u - arm, -arm), at(u + arm, arm)]);
    segments.push([at(u - arm, arm), at(u + arm, -arm)]);
  }
  return segments;
}

/** decorationCircles가 MAX_DECORATION_CIRCLES에서 잘랐는지 알려주는 선택적 출력. */
export interface CircleTruncationInfo {
  truncated: boolean;
}

// 그은 선을 따라 일정 간격으로 원을 반복하고 위·아래를 번갈아 둔다.
// 첫 원은 선 시작에서 간격의 절반 지점이다 — 짧은 선에도 원이 하나는 찍히게 한다.
// info를 넘기면 상한(MAX_DECORATION_CIRCLES)에서 잘렸는지를 info.truncated에 남긴다
// (반환 배열의 모양은 그대로다 — 기존 호출부·테스트에 영향 없음).
export function decorationCircles(
  points: Point[],
  diameterMm: number,
  spacingMm: number,
  offsetMm: number,
  info?: CircleTruncationInfo,
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
      if (circles.length >= MAX_DECORATION_CIRCLES) {
        if (info) info.truncated = true;
        return circles;
      }
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

/** exportDrawing.ts가 균열/백태 원이 잘렸는지 모아 경고로 바꾸기 위한 선택적 출력. */
export interface DamageEntitiesWarnings {
  circlesTruncated: boolean;
}

export function damageEntities(
  damage: unknown,
  alloc: HandleAllocator,
  owner: string,
  warnings?: DamageEntitiesWarnings,
  shapePoints?: Point[] | null,
): DxfPair[] {
  // 도형이 여럿인 손상은 도형마다 한 번씩 부른다(설계 4장). 안 주면 첫 도형이다.
  const points = shapePoints ?? dwgPointsOf(damage);
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
    for (const [from, to] of rebarSymbolSegments(points, decoration.lineGapMm, decoration.crossSizeMm, decoration.crossGapMm)) {
      pairs.push(...lineEntity(baseFor(alloc, owner), from, to));
    }
  } else if (decoration && decoration.kind === 'circles') {
    const circleInfo: CircleTruncationInfo = { truncated: false };
    for (const { center, radius } of decorationCircles(
      points,
      decoration.diameterMm,
      decoration.spacingMm,
      decoration.offsetMm,
      circleInfo,
    )) {
      pairs.push(...circleEntity(baseFor(alloc, owner), center, radius));
    }
    if (circleInfo.truncated && warnings) warnings.circlesTruncated = true;
  } else if (decoration) {
    // damageTypes.js의 decoration은 string으로 넓혀지므로(타입 주석 참고) 새 kind가 추가되면
    // 여기서 캐스팅이 조용히 아무 것도 안 그리고 넘어갈 수 있다 — 기호가 빠진 도면을 산출해
    // 버리기 전에 알아챌 수 있도록 경고를 남긴다.
    console.warn(
      `[damageEntities] 알 수 없는 decoration.kind이라 기호를 그리지 않습니다: ${JSON.stringify((decoration as { kind?: unknown }).kind)}`,
    );
  }

  return pairs;
}
