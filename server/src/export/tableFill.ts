// 손상물량표를 채운다. 표 객체를 고치지 않고 칸 가운데에 글자를 얹는다.
// 데이터 행 수를 넘으면 원본 표 바로 아래에 같은 모양의 표를 LINE·TEXT로 직접 그린다.
// 문구는 앱 화면과 같은 quantities.js 함수로 만든다.
// 열은 표 머리글의 키워드로 찾는다(설계 7.2 개정, 2026-09-16 캐드 확인 2차 피드백) — 8열
// 고정 순서는 머리글을 읽지 못했을 때만 쓰는 옛 자리다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 7장

import { formatQuantity, quantityOf, statusTextOf, unitOf } from '../../public/viewer/quantities.js';
import { TABLE_COLOR, TABLE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { lineEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';
import { applyTransform, cellCenter, modelTextHeight, type TableGrid } from './tableGrid.js';

/** 표 칸 하나가 나타낼 수 있는 값의 종류. */
export type RowField = 'number' | 'location' | 'status' | 'width' | 'length' | 'count' | 'quantity' | 'unit' | 'note';

// 옛 고정 순서(스펙 7.2 초판) — 머리글을 읽지 못했을 때만 쓰는 자리다.
export const TABLE_COLUMN: Record<Exclude<RowField, 'note'>, number> = {
  number: 0,
  location: 1,
  status: 2,
  width: 3,
  length: 4,
  count: 5,
  quantity: 6,
  unit: 7,
};

/**
 * 머리글 키워드 → 열(RowField). 우선순위 순서다: 열 하나의 머리글이 여러 키워드에 걸리면
 * (예: 표 제목이 겹쳐 "가로/폭" 칸에 "물량"이라는 글자가 섞여 있어도) 먼저 오는 필드가 이긴다.
 */
const FIELD_KEYWORDS: ReadonlyArray<{ field: RowField; test: RegExp }> = [
  { field: 'number', test: /번호/ },
  { field: 'location', test: /손상위치/ },
  { field: 'status', test: /손상현황|손상명|손상종류/ },
  { field: 'width', test: /가로|폭/ },
  { field: 'length', test: /세로|길이/ },
  { field: 'count', test: /개소|수량\(개\)/ },
  { field: 'quantity', test: /면적|연장|물량/ },
  { field: 'unit', test: /단위/ },
  { field: 'note', test: /비고/ },
];

/**
 * 값이 들어가는 열(손상현황·가로·세로·개소·면적·단위) 가운데 머리글로 찾은 것이 이 수보다 적으면
 * 머리글을 못 읽은 것으로 보고 옛 고정 순서로 되돌아간다. 번호·손상위치는 값이 없는 열이라 세지
 * 않는다 — 구버전 템플릿은 그 둘과 손상현황만 읽혀 셋을 넘겼는데 나머지 열이 전부 비었다.
 */
const MIN_MATCHED_VALUE_HEADERS = 3;
const VALUE_FIELDS: readonly RowField[] = ['status', 'width', 'length', 'count', 'quantity', 'unit'];

// 표 제목·묶음 머리글은 열 이름이 아니다. "손상물량표"가 가로/폭 열 위에 걸쳐 있으면 "물량"이
// 면적/연장으로 잘못 잡히고(2026-09-16 캐드 확인 2차 — 구버전 템플릿에서 실제로 났던 문제),
// "손상규모"는 개소·면적 위에 걸친 묶음 이름이라 먼저 지운다.
const GROUP_TITLES = ['손상물량표', '손상규모'];

function normalizeHeader(text: string): string {
  let normalized = text.replace(/\s/g, '').toLowerCase();
  for (const title of GROUP_TITLES) normalized = normalized.split(title).join('');
  return normalized;
}

export interface ColumnMap {
  map: Partial<Record<RowField, number>>;
  matchedCount: number;
}

/**
 * 표 머리글 글자(`TableGrid.headers`)로 열을 찾는다(설계 7.2 개정). 왼쪽 열부터 훑어, 아직
 * 열을 못 찾은 필드 중 그 열의 머리글에 걸리는 첫 번째 필드가 그 열을 갖는다.
 */
export function columnMapOf(headers: readonly string[]): ColumnMap {
  const map: Partial<Record<RowField, number>> = {};
  for (let column = 0; column < headers.length; column++) {
    const header = normalizeHeader(headers[column] ?? '');
    if (!header) continue;
    for (const { field, test } of FIELD_KEYWORDS) {
      if (field in map) continue;
      if (test.test(header)) {
        map[field] = column;
        break;
      }
    }
  }
  return { map, matchedCount: Object.keys(map).length };
}

/**
 * fillTable이 실제로 쓸 열 지도. 값 열의 머리글 매치가 `MIN_MATCHED_VALUE_HEADERS`보다 적으면
 * (머리글을 못 읽는 표) `usedFallback: true`와 함께 옛 고정 순서(`TABLE_COLUMN`)로 되돌아간다 —
 * 호출부(exportDrawing.ts)가 이 플래그로 `headersUnknown` 경고를 낸다.
 */
export function resolvedColumnMap(headers: readonly string[]): { map: Partial<Record<RowField, number>>; usedFallback: boolean } {
  const { map } = columnMapOf(headers);
  const matchedValueFields = VALUE_FIELDS.filter((field) => field in map).length;
  if (matchedValueFields >= MIN_MATCHED_VALUE_HEADERS) return { map, usedFallback: false };
  return { map: TABLE_COLUMN, usedFallback: true };
}

export interface TableRow {
  number: number;
  /** 필드별 값. 없는 필드는 빈 칸으로 남는다(번호·손상위치는 항상 비워 둔다). */
  fields: Partial<Record<RowField, string>>;
}

function amountText(value: unknown): string {
  return Number.isFinite(value) && (value as number) >= 0 ? formatQuantity(value as number) : '';
}

function countText(value: unknown): string {
  return Number.isInteger(value) && (value as number) >= 0 ? String(value) : '';
}

export function rowValuesOf(damage: unknown, number: number): TableRow {
  const measured = (damage as { measured?: Record<string, unknown> } | null)?.measured ?? {};
  const quantity = quantityOf(damage);
  // 번호는 표에 이미 인쇄돼 있고 손상위치는 비워 둔다 — fields에 아예 넣지 않는다.
  const fields: Partial<Record<RowField, string>> = {
    status: statusTextOf(damage),
    width: amountText(measured.width),
    length: amountText(measured.length),
    count: countText(measured.count),
    quantity: quantity === null ? '' : formatQuantity(quantity),
    unit: unitOf(damage) ?? '',
  };
  return { number, fields };
}

// 표에 쓰는 글자·선(값 칸·넘침 표의 머리글·격자선·번호)은 손상 도형과 다른 레이어·색이다
// (캐드 확인 2차 피드백 2026-09-16) — 손상만 켜고 끄거나 표만 켜고 끌 수 있게 나눈다.
function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: TABLE_LAYER, colorIndex: TABLE_COLOR };
}

// 넘침 표 k장째(k ≥ 1)가 원본에서 아래로 얼마나 내려가는지(표 로컬 단위, 음수다 — 표는
// 위에서 아래로 자란다). 원본 표 아래쪽 끝에서 원본 첫 행(머리글 행) 높이만큼 더 띄운다.
// 오른쪽은 다음 망도틀 자리라 아래로 쌓는다(2026-09-16 frame-numbering 설계 6장,
// 2026-09-15 설계 7.4를 대체한다). 왼쪽 끝은 원본과 같다.
function offsetOf(grid: TableGrid, tableIndex: number): number {
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];
  const headerRowHeight = grid.rowBoundaries[0] - grid.rowBoundaries[1];
  return tableIndex * (bottom - headerRowHeight);
}

function localToModel(grid: TableGrid, local: Point, dy: number): Point {
  return applyTransform(grid.transform, [grid.position[0] + local[0], grid.position[1] + local[1] + dy]);
}

function textAt(grid: TableGrid, local: Point, dy: number, value: string, alloc: HandleAllocator, owner: string): DxfPair[] {
  return textEntity(baseFor(alloc, owner), localToModel(grid, local, dy), modelTextHeight(grid), value, 'center');
}

function lineAt(grid: TableGrid, from: Point, to: Point, dy: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  return lineEntity(baseFor(alloc, owner), localToModel(grid, from, dy), localToModel(grid, to, dy));
}

function columnCenter(grid: TableGrid, column: number): number {
  return (grid.colBoundaries[column] + grid.colBoundaries[column + 1]) / 2;
}

function rowCenter(grid: TableGrid, dataRow: number): number {
  const index = grid.firstDataRow + dataRow - 1;
  return (grid.rowBoundaries[index] + grid.rowBoundaries[index + 1]) / 2;
}

// 넘침 표 한 장의 틀: 원본 머리글(선·글자)을 그대로 옮겨 그리고, 데이터 격자를 새로 긋고,
// 번호 열에 이어지는 번호를 인쇄한다. 행 수는 원본과 같다(가득 찬 표).
function overflowFrame(grid: TableGrid, tableIndex: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  const dy = offsetOf(grid, tableIndex);
  const pairs: DxfPair[] = [];

  for (const line of grid.headerLines) pairs.push(...lineAt(grid, line.from, line.to, dy, alloc, owner));
  // 머리글 글자는 각자 원래 높이(BlockText.height × 배율)로 그린다 — 데이터 칸의 글자 높이
  // (grid.textHeight)를 그대로 쓰면 원본에서 머리글과 데이터 칸의 글자 크기가 다를 때 어긋난다.
  for (const text of grid.headerTexts) {
    const height = text.height * Math.abs(grid.transform.scaleX);
    pairs.push(...textEntity(baseFor(alloc, owner), localToModel(grid, text.position, dy), height, text.text, 'center'));
  }

  const left = grid.colBoundaries[0];
  const right = grid.colBoundaries[grid.colBoundaries.length - 1];
  const top = grid.rowBoundaries[grid.firstDataRow];
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];

  // 가로선: 데이터 행 경계. 데이터 시작선은 머리글 선이 이미 그었다.
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const y = grid.rowBoundaries[grid.firstDataRow + row];
    pairs.push(...lineAt(grid, [left, y], [right, y], dy, alloc, owner));
  }
  // 세로선: 모든 열 경계를 데이터 영역만큼
  for (const x of grid.colBoundaries) {
    pairs.push(...lineAt(grid, [x, top], [x, bottom], dy, alloc, owner));
  }
  // 번호 열
  const numberX = columnCenter(grid, grid.numberColumn);
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const number = tableIndex * grid.dataRowCount + row;
    pairs.push(...textAt(grid, [numberX, rowCenter(grid, row)], dy, String(number), alloc, owner));
  }
  return pairs;
}

/**
 * 표를 채운다. 원본 표는 인쇄된 번호 칸을 건드리지 않고 값 칸만 쓰고, 용량을 넘는 번호는 아래쪽 넘침 표에 넣는다.
 *
 * **호출 규칙 — 반드시 지킬 것:** `rows`에는 **1부터 마지막 번호까지 모든 번호의 행**을 넘겨야 한다. 도면 좌표가
 * 없어 건너뛴 손상도 번호는 그대로 갖고(설계 8장), 그 번호의 행은 칸이 전부 빈 문자열인 채로 넘긴다.
 * 넘침 표의 틀(격자·머리글·번호 칸)은 `rows`에 실제로 있는 번호로만 판단해 그리므로, 어떤 넘침 표에 속한 번호가
 * 전부 빠져 있으면 그 표 자체가 그려지지 않은 채 다음 표가 제 자리에 놓인다.
 */
export function fillTable(grid: TableGrid, rows: TableRow[], alloc: HandleAllocator, owner: string): DxfPair[] {
  const capacity = grid.dataRowCount;
  if (capacity <= 0) return [];

  const columnCount = grid.colBoundaries.length - 1;
  const { map: columnMap } = resolvedColumnMap(grid.headers);
  const entries = Object.entries(columnMap) as Array<[RowField, number]>;

  // 어느 넘침 표가 필요한지 먼저 모아 틀을 한 번씩만 그린다.
  const neededTables = new Set<number>();
  for (const row of rows) {
    const tableIndex = Math.floor((row.number - 1) / capacity);
    if (tableIndex > 0) neededTables.add(tableIndex);
  }

  const pairs: DxfPair[] = [];
  for (const tableIndex of [...neededTables].sort((a, b) => a - b)) {
    pairs.push(...overflowFrame(grid, tableIndex, alloc, owner));
  }

  for (const row of rows) {
    if (row.number < 1) continue;
    const tableIndex = Math.floor((row.number - 1) / capacity);
    const dataRow = row.number - tableIndex * capacity;
    const dy = offsetOf(grid, tableIndex);
    const y = rowCenter(grid, dataRow);
    for (const [field, column] of entries) {
      if (column < 0 || column >= columnCount) continue;
      const value = row.fields[field];
      if (!value) continue;
      if (tableIndex === 0) {
        pairs.push(...textEntity(baseFor(alloc, owner), cellCenter(grid, dataRow, column), modelTextHeight(grid), value, 'center'));
      } else {
        pairs.push(...textAt(grid, [columnCenter(grid, column), y], dy, value, alloc, owner));
      }
    }
  }
  return pairs;
}
