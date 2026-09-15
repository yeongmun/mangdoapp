// 엔티티 한 벌의 (코드, 값) 쌍을 옮기거나(이동) 변환한다(삽입 변환 펼치기), 복사한다.
// 쌍 배열만 다루는 순수 모듈이다 — 문서·핸들 표·틀을 모른다. 건드리지 않은 쌍은 원본 객체를
// 그대로 돌려줘 rawCode(원본 바이트)가 보존된다.
//
// 어떤 그룹 코드가 절대 점이고 어떤 것이 방향·크기인지는 실측 조사표를 그대로 옮긴 것이다.
// 근거: docs/superpowers/specs/2026-09-16-sheet-overflow-design.md 5.1·5.2,
//       .superpowers/sdd/2026-09-16-frame-numbering/sheet-overflow-probe.md 6장

import { formatInt, formatReal, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { applyTransform, type Transform } from './tableGrid.js';

export interface EntityBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 종류별 그룹 코드의 역할.
 * - points: 절대 점 (x코드, y코드) — 이동량을 더하고 변환을 적용한다
 * - vectors: 방향 벡터 (x코드, y코드) — 회전만 적용하고 이동하지 않는다
 * - lengths: 길이·높이·반지름 — 배율만 곱한다
 * - angles: 도(度) 단위 각도 — 회전각을 더한다
 */
interface CodeRoles {
  points: ReadonlyArray<readonly [number, number]>;
  vectors: ReadonlyArray<readonly [number, number]>;
  lengths: readonly number[];
  angles: readonly number[];
}

const NONE: CodeRoles = { points: [], vectors: [], lengths: [], angles: [] };

// 여기 없는 종류는 복사하지 않는다(허용 목록). DIMENSION·LEADER·MLEADER·VIEWPORT처럼 다른
// 객체를 가리키는 엔티티, ATTRIB/SEQEND처럼 여러 엔티티가 한 벌을 이루는 것이 모두 빠진다.
// 실제 사내 도면에서 관찰된 종류는 전부 들어 있다(조사 2장).
const ROLES: ReadonlyMap<string, CodeRoles> = new Map([
  ['LINE', { ...NONE, points: [[10, 20], [11, 21]] }],
  ['POINT', { ...NONE, points: [[10, 20]] }],
  ['LWPOLYLINE', { ...NONE, points: [[10, 20]], lengths: [40, 41, 43] }],
  ['CIRCLE', { ...NONE, points: [[10, 20]], lengths: [40] }],
  ['ARC', { ...NONE, points: [[10, 20]], lengths: [40], angles: [50, 51] }],
  ['SOLID', { ...NONE, points: [[10, 20], [11, 21], [12, 22], [13, 23]] }],
  ['TEXT', { ...NONE, points: [[10, 20], [11, 21]], lengths: [40], angles: [50] }],
  // MTEXT의 11/21은 글자 방향 벡터다 — 옮기면 글자가 날아간다(조사 6장).
  ['MTEXT', { ...NONE, points: [[10, 20]], vectors: [[11, 21]], lengths: [40, 41, 42, 43], angles: [50] }],
  // INSERT의 41/42/43은 배율이라 이동에서는 그대로, 변환에서는 곱한다.
  ['INSERT', { ...NONE, points: [[10, 20]], lengths: [41, 42, 43], angles: [50] }],
  // HATCH의 10/20·11/21은 아래 xyRoleOf가 따로 판단한다(첫 10/20은 고도 기준점이라 뺀다).
  ['HATCH', { ...NONE, points: [[43, 44]], vectors: [[45, 46]], lengths: [41, 47, 49], angles: [52, 53] }],
]);

function typeOf(pairs: DxfPair[]): string {
  return pairs.length > 0 && pairs[0].code === 0 ? pairs[0].value : '';
}

// 나란한 두 쌍이 점인지 벡터인지 판단한다. HATCH만 특별 규칙이다.
function xyRoleOf(
  type: string,
  roles: CodeRoles,
  x: number,
  y: number,
  hatchElevationSeen: boolean,
): 'point' | 'vector' | null {
  if (type === 'HATCH') {
    // 첫 (10,20)은 고도 기준점 — 규격상 x·y가 늘 0이라 옮기면 안 된다.
    if (x === 10 && y === 20) return hatchElevationSeen ? 'point' : null;
    // 경계 경로의 점들(10/20 반복)과 호 경계의 '다른 점'(11/21), 마지막 씨앗점이 모두 절대 점이다.
    if (x === 11 && y === 21) return 'point';
  }
  for (const [px, py] of roles.points) if (px === x && py === y) return 'point';
  for (const [vx, vy] of roles.vectors) if (vx === x && vy === y) return 'vector';
  return null;
}

interface Mapper {
  point(x: number, y: number): Point;
  vector(x: number, y: number): Point;
  length(value: number): number;
  angle(degrees: number): number;
}

// 값이 수치적으로 그대로면 쌍을 고치지 않는다 — 원본 바이트를 살리기 위해서다.
// ('3200.00'을 formatReal(3200) = '3200.0'으로 다시 쓰면 안 건드린 엔티티가 바뀐다.)
function put(out: DxfPair[], index: number, source: DxfPair, value: number): boolean {
  const parsed = Number(source.value.trim());
  if (!Number.isFinite(value) || parsed === value) return false;
  out[index] = { ...source, value: formatReal(value) };
  return true;
}

function mapPairs(pairs: DxfPair[], m: Mapper): DxfPair[] {
  const type = typeOf(pairs);
  const roles = ROLES.get(type);
  if (!roles) return pairs;

  const out = pairs.slice();
  let changed = false;
  let hatchElevationSeen = false;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (next) {
      if (type === 'HATCH' && p.code === 10 && next.code === 20 && !hatchElevationSeen) {
        hatchElevationSeen = true;
        i += 1; // 고도 기준점은 두 쌍 모두 건너뛴다
        continue;
      }
      const role = xyRoleOf(type, roles, p.code, next.code, hatchElevationSeen);
      if (role) {
        const x = Number(p.value.trim());
        const y = Number(next.value.trim());
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const [nx, ny] = role === 'point' ? m.point(x, y) : m.vector(x, y);
          if (put(out, i, p, nx)) changed = true;
          if (put(out, i + 1, next, ny)) changed = true;
          i += 1;
          continue;
        }
      }
    }
    if (roles.lengths.includes(p.code)) {
      const value = Number(p.value.trim());
      if (Number.isFinite(value) && put(out, i, p, m.length(value))) changed = true;
      continue;
    }
    if (roles.angles.includes(p.code)) {
      const value = Number(p.value.trim());
      if (Number.isFinite(value) && put(out, i, p, m.angle(value))) changed = true;
    }
  }
  return changed ? out : pairs;
}

/** 엔티티 한 벌을 (dx, dy)만큼 옮긴다. 이동량이 0이면 입력 배열을 그대로 돌려준다. */
export function translateEntityPairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[] {
  if (dx === 0 && dy === 0) return pairs;
  return mapPairs(pairs, {
    point: (x, y) => [x + dx, y + dy],
    vector: (x, y) => [x, y],
    length: (value) => value,
    angle: (degrees) => degrees,
  });
}

/** 엔티티 여러 벌이 이어진 쌍 배열을 옮긴다((0, 타입)마다 잘라 translateEntityPairs에 넘긴다). */
export function translatePairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[] {
  if (dx === 0 && dy === 0) return pairs;
  const out: DxfPair[] = [];
  let start = 0;
  // 첫 (0, 타입) 앞에 붙은 쌍은 그대로 둔다(정상 입력에는 없다).
  while (start < pairs.length && pairs[start].code !== 0) out.push(pairs[start++]);
  for (let i = start; i < pairs.length; ) {
    let end = i + 1;
    while (end < pairs.length && pairs[end].code !== 0) end += 1;
    for (const p of translateEntityPairs(pairs.slice(i, end), dx, dy)) out.push(p);
    i = end;
  }
  return out;
}

/** 엔티티가 가진 절대 점을 전부 모은다(INSERT는 삽입점 하나만 — 블록 안은 여기서 모른다). */
export function entityPointsOf(pairs: DxfPair[]): Point[] {
  const type = typeOf(pairs);
  const roles = ROLES.get(type);
  if (!roles) return [];
  const points: Point[] = [];
  let hatchElevationSeen = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (!next) break;
    if (type === 'HATCH' && p.code === 10 && next.code === 20 && !hatchElevationSeen) {
      hatchElevationSeen = true;
      i += 1;
      continue;
    }
    if (xyRoleOf(type, roles, p.code, next.code, hatchElevationSeen) !== 'point') continue;
    const x = Number(p.value.trim());
    const y = Number(next.value.trim());
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    i += 1;
  }
  return points;
}

export function entityBoundsOf(pairs: DxfPair[]): EntityBounds | null {
  const points = entityPointsOf(pairs);
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function intAt(pairs: DxfPair[], code: number): number | null {
  const p = pairs.find((entry) => entry.code === code);
  if (!p) return null;
  const value = Number(p.value.trim());
  return Number.isFinite(value) ? value : null;
}

// 경계 경로 종류 플래그(92)의 2번 비트가 폴리라인이다. 그 비트가 없는 경로(선·호·타원호
// 조각으로 이뤄진 경계)는 11/21이 '중심 기준 상대 벡터'로 쓰이는 자리가 있어 단순 이동으로는
// 옳게 옮길 수 없다 — 복사하지 않고 경고로 센다(설계 5.1 마지막 항목과 같은 취급).
const HATCH_POLYLINE_BIT = 2;

export function isCopyable(pairs: DxfPair[]): boolean {
  const type = typeOf(pairs);
  if (!ROLES.has(type)) return false;
  // 속성(ATTRIB)이 따라오는 INSERT는 ATTRIB…SEQEND까지 한 벌이라 이 모듈이 다루지 못한다.
  if (type === 'INSERT' && intAt(pairs, 66) === 1) return false;
  if (type === 'HATCH') {
    for (const p of pairs) {
      if (p.code !== 92) continue;
      const flags = Number(p.value.trim());
      if (!Number.isFinite(flags) || (flags & HATCH_POLYLINE_BIT) === 0) return false;
    }
  }
  return true;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * 블록 안 엔티티를 삽입 변환으로 모델 좌표로 펼친다. 배율은 가로·세로가 같아야 한다
 * (`isFlattenable`로 미리 거른다 — 비균일 배율에서는 각도가 보존되지 않는다).
 */
export function transformEntityPairs(pairs: DxfPair[], t: Transform): DxfPair[] {
  const scale = t.scaleX;
  const degrees = (t.rotationRad * 180) / Math.PI;
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return mapPairs(pairs, {
    point: (x, y) => applyTransform(t, [x, y]),
    // 방향 벡터는 회전만 한다(배율을 곱해도 뜻이 같고, 캐드가 어차피 정규화한다).
    vector: (x, y) => [x * cos - y * sin, x * sin + y * cos],
    length: (value) => value * scale,
    angle: (value) => normalizeDegrees(value + degrees),
  });
}

// 원래 값의 글자 길이에 맞춰 정수를 다시 쓴다('     1' → '     0').
function paddedInt(source: string, value: number): string {
  return formatInt(value).padStart(source.length, ' ');
}

/**
 * 엔티티 한 벌을 복사본으로 만든다 — 새 핸들(5), 새 소유자(330), 원본을 가리키는 참조 제거.
 * 좌표는 건드리지 않는다(옮기는 것은 호출부가 translate/transform으로 한다).
 *
 * - `102 {...} … 102 }` 묶음은 통째로 뺀다. ACAD_REACTORS(연관 해치가 되가리키는 반응자)와
 *   ACAD_XDICTIONARY(주석 축척용 확장 사전)가 여기 들어 있는데 둘 다 **원본 엔티티**를 가리켜
 *   복사본에서는 뜻이 없다(조사 3장).
 * - 연관 해치(71=1)는 비연관(71=0)으로 바꾸고 경계 경로의 원본 객체 수(97)를 0으로 만든 뒤
 *   그 뒤에 이어지는 330들을 지운다. 경계 점은 해치 안에 이미 있으므로 모양은 같다.
 */
export function copyEntityPairs(pairs: DxfPair[], alloc: HandleAllocator, owner?: string): DxfPair[] {
  const isHatch = typeOf(pairs) === 'HATCH';
  const associative = isHatch && intAt(pairs, 71) === 1;

  const out: DxfPair[] = [];
  let handleDone = false;
  let ownerDone = false;
  let dropReferences = 0;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];

    // 102 { … 102 } 묶음 건너뛰기
    if (p.code === 102 && p.value.startsWith('{')) {
      let j = i + 1;
      while (j < pairs.length && !(pairs[j].code === 102 && pairs[j].value.trim() === '}')) j += 1;
      i = j;
      continue;
    }

    if (dropReferences > 0 && p.code === 330) {
      dropReferences -= 1;
      continue;
    }

    if (p.code === 5 && !handleDone) {
      out.push({ ...p, value: alloc.next() });
      handleDone = true;
      continue;
    }
    if (p.code === 330 && handleDone && !ownerDone) {
      ownerDone = true;
      out.push(owner === undefined ? p : { ...p, value: owner });
      continue;
    }
    if (associative && p.code === 71) {
      out.push({ ...p, value: paddedInt(p.value, 0) });
      continue;
    }
    if (associative && p.code === 97) {
      const count = Number(p.value.trim());
      if (Number.isFinite(count) && count > 0) dropReferences = count;
      out.push({ ...p, value: paddedInt(p.value, 0) });
      continue;
    }
    out.push(p);
  }
  return out;
}
