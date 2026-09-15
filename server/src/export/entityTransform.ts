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
 * - vectors: 방향 벡터 (x코드, y코드) — 회전만 적용하고 이동·배율은 적용하지 않는다
 *   (MTEXT 11/21처럼 캐드가 어차피 정규화하는 "방향"에 쓴다)
 * - scaledVectors: 상대 거리 벡터 (x코드, y코드) — 회전과 배율을 모두 적용하지만 이동은
 *   하지 않는다 (HATCH 45/46처럼 원점이 아니라 길이·방향이 뜻이 있는 "간격 오프셋"에 쓴다.
 *   controller ruling: "45/46 rotated AND multiplied by s")
 * - lengths: 길이·높이·반지름 — 배율만 곱한다
 * - angles: 도(度) 단위 각도 — 회전각을 더한다
 */
interface CodeRoles {
  points: ReadonlyArray<readonly [number, number]>;
  vectors: ReadonlyArray<readonly [number, number]>;
  scaledVectors: ReadonlyArray<readonly [number, number]>;
  lengths: readonly number[];
  angles: readonly number[];
}

const NONE: CodeRoles = { points: [], vectors: [], scaledVectors: [], lengths: [], angles: [] };

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
  // 45/46(패턴 선 간격 벡터)은 방향이 아니라 실제 거리다 — scaledVectors로 회전과 배율을
  // 모두 받는다(controller ruling, fix round 1). 49(대시 길이)·41(패턴 축척)은 lengths라
  // 이동에서는 그대로, 변환에서는 배율이 곱해진다(이미 그렇게 동작했다 — 테스트로 고정한다).
  ['HATCH', { ...NONE, points: [[43, 44]], scaledVectors: [[45, 46]], lengths: [41, 47, 49], angles: [52, 53] }],
]);

function typeOf(pairs: DxfPair[]): string {
  return pairs.length > 0 && pairs[0].code === 0 ? pairs[0].value : '';
}

// ROLES에 없는 타입(DIMENSION·LEADER·VIEWPORT·SPLINE·ATTRIB… — 설계 5.1 마지막 항목,
// isCopyable이 여전히 false로 막아 복사는 하지 않는다)을 위한 마지막 수단 규칙: DXF 관례대로
// 코드 10~18을 x, 바로 다음에 오는 코드(= x+10, 20~28)를 그 y로 보고 절대 점으로 다룬다.
// 이 규칙이 있어야 영역 판정(entityBoundsOf → 틀 안/밖)과 틀 이동(translateEntityPairs)이
// 이런 엔티티도 "점이 있는 것"으로 보고 제 틀과 함께 움직인다 — 그래도 복사는 하지 않는다
// (controller ruling, fix round 1, Important 항목).
//
// 예외: MLEADER/MULTILEADER는 이 규칙을 적용하지 않는다 — 10/11/12가 점과 지시선 방향이
// 뒤섞여 있어(그룹 코드가 재사용된다) 일반 규칙이 틀린 좌표를 점으로 읽는다. 그래서 아예
// 손대지 않는다: 경계상자도 없고(영역 판정에서 멤버가 되지 않는다) 이동도 하지 않는다
// (틀이 밀릴 때 제자리에 남는다 — 실제 사내 도면에서 관찰된 적 없으므로 지금은 괜찮다).
const NO_GENERIC_FALLBACK = new Set(['MLEADER', 'MULTILEADER']);

function isGenericPointPair(xCode: number, yCode: number): boolean {
  return xCode >= 10 && xCode <= 18 && yCode === xCode + 10;
}

// entityPointsOf의 ROLES 없는 타입용 대체 경로.
function genericPointsOf(pairs: DxfPair[], type: string): Point[] {
  if (NO_GENERIC_FALLBACK.has(type)) return [];
  const points: Point[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (!next || !isGenericPointPair(p.code, next.code)) continue;
    const x = Number(p.value.trim());
    const y = Number(next.value.trim());
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    i += 1;
  }
  return points;
}

// translateEntityPairs의 ROLES 없는 타입용 대체 경로. transformEntityPairs는 일부러 건드리지
// 않는다(controller ruling: "throw or skip per what the code does today — do not extend") —
// mapPairs가 이미 roles 없는 타입을 그대로 돌려주므로(스킵) 그 동작을 그대로 둔다.
function genericTranslate(pairs: DxfPair[], type: string, dx: number, dy: number): DxfPair[] {
  if (NO_GENERIC_FALLBACK.has(type)) return pairs;
  const out = pairs.slice();
  let changed = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (!next || !isGenericPointPair(p.code, next.code)) continue;
    const x = Number(p.value.trim());
    const y = Number(next.value.trim());
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (put(out, i, p, x + dx)) changed = true;
      if (put(out, i + 1, next, y + dy)) changed = true;
    }
    i += 1;
  }
  return changed ? out : pairs;
}

// 나란한 두 쌍이 점인지 벡터인지 판단한다. HATCH만 특별 규칙이다.
function xyRoleOf(
  type: string,
  roles: CodeRoles,
  x: number,
  y: number,
  hatchElevationSeen: boolean,
): 'point' | 'vector' | 'scaledVector' | null {
  if (type === 'HATCH') {
    // 첫 (10,20)은 고도 기준점 — 규격상 x·y가 늘 0이라 옮기면 안 된다.
    if (x === 10 && y === 20) return hatchElevationSeen ? 'point' : null;
    // 경계 경로의 점들(10/20 반복)과 호 경계의 '다른 점'(11/21), 마지막 씨앗점이 모두 절대 점이다.
    if (x === 11 && y === 21) return 'point';
  }
  for (const [px, py] of roles.points) if (px === x && py === y) return 'point';
  for (const [vx, vy] of roles.vectors) if (vx === x && vy === y) return 'vector';
  for (const [sx, sy] of roles.scaledVectors) if (sx === x && sy === y) return 'scaledVector';
  return null;
}

interface Mapper {
  point(x: number, y: number): Point;
  vector(x: number, y: number): Point;
  scaledVector(x: number, y: number): Point;
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
          const [nx, ny] =
            role === 'point' ? m.point(x, y) : role === 'vector' ? m.vector(x, y) : m.scaledVector(x, y);
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
  const type = typeOf(pairs);
  // ROLES에 없는 타입(복사는 여전히 안 된다)도 틀이 밀릴 때는 같이 밀려야 한다 — 일반 규칙으로
  // 옮긴다(제자리 이동, fix round 1). MLEADER류는 genericTranslate 안에서 그대로 걸러진다.
  if (!ROLES.has(type)) return genericTranslate(pairs, type, dx, dy);
  return mapPairs(pairs, {
    point: (x, y) => [x + dx, y + dy],
    vector: (x, y) => [x, y],
    // 상대 벡터라 이동량이 뜻이 없다 — vector와 마찬가지로 그대로 둔다.
    scaledVector: (x, y) => [x, y],
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
  if (!roles) return genericPointsOf(pairs, type);
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

// 소유자 칸(핸들 5 바로 뒤의 첫 330) 밖에서 다른 엔티티·객체를 가리키는 참조가 있는지 살핀다.
// 340/350/360은 예외 없이 다른 객체를 가리키는 핸들 참조다(조사 3장). 330은 소유자 한 번은
// 정상이고, 연관 HATCH의 경계 원본 참조(97 뒤에 이어지는 330들, copyEntityPairs가 정리해
// 주는 자리)도 알려진 자리라 예외로 둔다 — 그 밖의 두 번째 330은 아직 다루지 못하는 참조다.
// `102 {...} 102 }` 묶음(ACAD_REACTORS·ACAD_XDICTIONARY) 안은 copyEntityPairs가 통째로 지워
// 주므로 건너뛴다. 조사 3장이 실측한 두 사례(HATCH의 두 번째 330, TEXT의 XDICTIONARY 360)는
// 둘 다 이 예외들로 걸러지므로 기존 허용 목록의 동작은 바뀌지 않는다(fix round 1, 발견 3).
function hasUnhandledReference(pairs: DxfPair[]): boolean {
  const type = typeOf(pairs);
  const associative = type === 'HATCH' && intAt(pairs, 71) === 1;

  let handleSeen = false;
  let ownerSeen = false;
  let boundaryRefsRemaining = 0;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];

    if (p.code === 102 && p.value.startsWith('{')) {
      let j = i + 1;
      while (j < pairs.length && !(pairs[j].code === 102 && pairs[j].value.trim() === '}')) j += 1;
      i = j;
      continue;
    }

    if (p.code === 5) {
      handleSeen = true;
      continue;
    }

    if (associative && p.code === 97) {
      const count = Number(p.value.trim());
      if (Number.isFinite(count) && count > 0) boundaryRefsRemaining = count;
      continue;
    }

    if (p.code === 330) {
      if (handleSeen && !ownerSeen) {
        ownerSeen = true;
        continue;
      }
      if (boundaryRefsRemaining > 0) {
        boundaryRefsRemaining -= 1;
        continue;
      }
      return true; // 소유자도 아니고 알려진 경계 원본 참조 자리도 아닌 두 번째 330
    }

    if (p.code === 340 || p.code === 350 || p.code === 360) return true;
  }
  return false;
}

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
  if (hasUnhandledReference(pairs)) return false;
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
    // 상대 거리 벡터(HATCH 45/46)는 방향뿐 아니라 길이도 뜻이 있다 — 균일 배율을 곱한 뒤
    // 회전한다(균일 배율이라 순서가 회전 뒤 곱하기와 같다). controller ruling(fix round 1).
    scaledVector: (x, y) => {
      const sx = x * scale;
      const sy = y * scale;
      return [sx * cos - sy * sin, sx * sin + sy * cos];
    },
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
