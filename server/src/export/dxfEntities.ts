// DXF 엔티티 하나를 (코드, 값) 쌍으로 만든다. 모양은 docs/exam.dxf가 실제로 담고 있는
// 형식을 그대로 따른다 — 사내 캐드에서 열리는 것이 확인된 형식이다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5·6장

import { formatInt, formatReal, pair, type DxfPair } from './dxfDocument.js';
import type { HatchPattern } from './hatchPatterns.js';

export type Point = [number, number];

export interface EntityBase {
  handle: string;
  /** 모델 공간 블록 레코드의 핸들 */
  owner: string;
  layer: string;
  colorIndex: number;
}

// 정수 값은 AutoCAD가 쓰는 자리 맞춤을 따른다(16비트 6칸, 32비트 9칸).
function int16(value: number): string {
  return formatInt(value).padStart(6, ' ');
}

function int32(value: number): string {
  return formatInt(value).padStart(9, ' ');
}

function head(base: EntityBase, type: string, subclass: string): DxfPair[] {
  return [
    pair(0, type),
    pair(5, base.handle),
    pair(330, base.owner),
    pair(100, 'AcDbEntity'),
    pair(8, base.layer),
    pair(62, int16(base.colorIndex)),
    pair(100, subclass),
  ];
}

function xy(point: Point, xCode: number, yCode: number): DxfPair[] {
  return [pair(xCode, formatReal(point[0])), pair(yCode, formatReal(point[1]))];
}

export function lwPolylineEntity(base: EntityBase, points: Point[], closed: boolean): DxfPair[] {
  if (points.length < 2) throw new Error('LWPOLYLINE은 점이 둘 이상이어야 합니다.');
  const pairs = head(base, 'LWPOLYLINE', 'AcDbPolyline');
  pairs.push(pair(90, int32(points.length))); // 90은 32비트 코드 — 회사 파일도 9칸으로 채운다
  pairs.push(pair(70, int16(closed ? 1 : 0)));
  pairs.push(pair(43, '0.0'));
  for (const point of points) pairs.push(...xy(point, 10, 20));
  return pairs;
}

export function circleEntity(base: EntityBase, center: Point, radius: number): DxfPair[] {
  const pairs = head(base, 'CIRCLE', 'AcDbCircle');
  pairs.push(...xy(center, 10, 20), pair(30, '0.0'), pair(40, formatReal(radius)));
  return pairs;
}

export function lineEntity(base: EntityBase, from: Point, to: Point): DxfPair[] {
  const pairs = head(base, 'LINE', 'AcDbLine');
  pairs.push(...xy(from, 10, 20), pair(30, '0.0'), ...xy(to, 11, 21), pair(31, '0.0'));
  return pairs;
}

// 글꼴 스타일(코드 7)은 쓰지 않는다 → Standard. docs/exam.dxf의 `균열` 글자와 같은 방식이고,
// 사내 망도에서 한글이 그대로 보이는 것이 확인됐다.
// 73(수직 정렬) = 2(중간)는 두 번째 AcDbText 표시 뒤에 와야 한다(DXF 규격).
export function textEntity(
  base: EntityBase,
  position: Point,
  height: number,
  value: string,
  align: 'center' | 'left',
): DxfPair[] {
  const pairs = head(base, 'TEXT', 'AcDbText');
  pairs.push(
    ...xy(position, 10, 20),
    pair(30, '0.0'),
    pair(40, formatReal(height)),
    pair(1, value),
    pair(72, int16(align === 'center' ? 1 : 0)),
    ...xy(position, 11, 21),
    pair(31, '0.0'),
    pair(100, 'AcDbText'),
    pair(73, int16(2)),
  );
  return pairs;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

// AutoCAD가 내보낸 픽셀 크기 값. 무늬 모양에는 영향이 없고 화면 갱신 최적화에만 쓰인다.
const HATCH_PIXEL_SIZE = '0.1152036452310892';

export function hatchEntity(base: EntityBase, boundary: Point[], pattern: HatchPattern): DxfPair[] {
  if (boundary.length < 3) throw new Error('HATCH 경계는 점이 셋 이상이어야 합니다.');
  const pairs = head(base, 'HATCH', 'AcDbHatch');
  pairs.push(
    pair(10, '0.0'),
    pair(20, '0.0'),
    pair(30, '0.0'),
    pair(210, '0.0'),
    pair(220, '0.0'),
    pair(230, '1.0'),
    pair(2, pattern.name),
    pair(70, int16(0)), // 단색 채우기 아님
    pair(71, int16(0)), // 비연관
    pair(91, int32(1)), // 경계 1개
    pair(92, int32(7)), // 바깥 경계 + 폴리라인 + 파생
    pair(72, int16(0)), // 볼록(bulge) 없음
    pair(73, int16(1)), // 닫힌 경계
    pair(93, int32(boundary.length + 1)),
  );
  for (const point of boundary) pairs.push(...xy(point, 10, 20));
  // AutoCAD는 닫힌 경계의 첫 점을 한 번 더 적는다. 같은 형식으로 맞춘다.
  pairs.push(...xy(boundary[0], 10, 20));
  pairs.push(
    pair(97, int32(0)), // 경계 원본 객체 없음 (비연관)
    pair(75, int16(0)), // 해치 방식: 보통
    pair(76, int16(1)), // 미리 정의된 패턴
    pair(52, formatReal(pattern.angle)),
    pair(41, formatReal(pattern.scale)),
    pair(77, int16(0)), // 이중 해치 아님
    pair(78, int16(pattern.lines.length)),
  );
  for (const line of pattern.lines) {
    pairs.push(
      pair(53, formatReal(line.angle)),
      pair(43, formatReal(line.baseX)),
      pair(44, formatReal(line.baseY)),
      pair(45, formatReal(line.offsetX)),
      pair(46, formatReal(line.offsetY)),
      pair(79, int16(line.dashes.length)),
    );
    for (const dash of line.dashes) pairs.push(pair(49, formatReal(dash)));
  }
  pairs.push(pair(47, HATCH_PIXEL_SIZE), pair(98, int32(1)), ...xy(centroid(boundary), 10, 20));
  return pairs;
}
