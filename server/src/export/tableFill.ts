// 손상물량표를 채운다. 표 객체를 고치지 않고 칸 가운데에 글자를 얹는다.
// 데이터 행 수를 넘으면 오른쪽에 같은 모양의 표를 LINE·TEXT로 직접 그린다.
// 문구는 앱 화면과 같은 quantities.js 함수로 만든다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 7장

import { formatQuantity, quantityOf, statusTextOf, unitOf } from '../../public/viewer/quantities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { lineEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';
import { applyTransform, cellCenter, modelTextHeight, type TableGrid } from './tableGrid.js';

export const TABLE_COLUMN = {
  number: 0,
  place: 1,
  status: 2,
  width: 3,
  length: 4,
  count: 5,
  quantity: 6,
  unit: 7,
} as const;

export const COLUMN_COUNT = 8;

export interface TableRow {
  number: number;
  /** 길이 8. 비울 칸은 빈 문자열 */
  cells: string[];
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
  const cells = new Array<string>(COLUMN_COUNT).fill('');
  // 번호(0)는 표에 이미 인쇄돼 있고 손상위치(1)는 비워 둔다.
  cells[TABLE_COLUMN.status] = statusTextOf(damage);
  cells[TABLE_COLUMN.width] = amountText(measured.width);
  cells[TABLE_COLUMN.length] = amountText(measured.length);
  cells[TABLE_COLUMN.count] = countText(measured.count);
  cells[TABLE_COLUMN.quantity] = quantity === null ? '' : formatQuantity(quantity);
  cells[TABLE_COLUMN.unit] = unitOf(damage) ?? '';
  return { number, cells };
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

// 넘침 표 k장째(k ≥ 1)가 원본에서 오른쪽으로 얼마나 떨어지는지(표 로컬 단위).
// 원본 표 오른쪽 끝에서 번호 열 너비만큼 띄운다. (번호 열이 항상 첫 열이라 지금은
// colBoundaries[1]과 값이 같지만, grid.numberColumn을 직접 써서 뜻을 분명히 한다.)
function offsetOf(grid: TableGrid, tableIndex: number): number {
  const width = grid.colBoundaries[grid.colBoundaries.length - 1];
  const numberColumnWidth = grid.colBoundaries[grid.numberColumn + 1] - grid.colBoundaries[grid.numberColumn];
  return tableIndex * (width + numberColumnWidth);
}

function localToModel(grid: TableGrid, local: Point, dx: number): Point {
  return applyTransform(grid.transform, [grid.position[0] + local[0] + dx, grid.position[1] + local[1]]);
}

function textAt(grid: TableGrid, local: Point, dx: number, value: string, alloc: HandleAllocator, owner: string): DxfPair[] {
  return textEntity(baseFor(alloc, owner), localToModel(grid, local, dx), modelTextHeight(grid), value, 'center');
}

function lineAt(grid: TableGrid, from: Point, to: Point, dx: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  return lineEntity(baseFor(alloc, owner), localToModel(grid, from, dx), localToModel(grid, to, dx));
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
  const dx = offsetOf(grid, tableIndex);
  const pairs: DxfPair[] = [];

  for (const line of grid.headerLines) pairs.push(...lineAt(grid, line.from, line.to, dx, alloc, owner));
  // 머리글 글자는 각자 원래 높이(BlockText.height × 배율)로 그린다 — 데이터 칸의 글자 높이
  // (grid.textHeight)를 그대로 쓰면 원본에서 머리글과 데이터 칸의 글자 크기가 다를 때 어긋난다.
  for (const text of grid.headerTexts) {
    const height = text.height * Math.abs(grid.transform.scaleX);
    pairs.push(...textEntity(baseFor(alloc, owner), localToModel(grid, text.position, dx), height, text.text, 'center'));
  }

  const left = grid.colBoundaries[0];
  const right = grid.colBoundaries[grid.colBoundaries.length - 1];
  const top = grid.rowBoundaries[grid.firstDataRow];
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];

  // 가로선: 데이터 행 경계. 데이터 시작선은 머리글 선이 이미 그었다.
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const y = grid.rowBoundaries[grid.firstDataRow + row];
    pairs.push(...lineAt(grid, [left, y], [right, y], dx, alloc, owner));
  }
  // 세로선: 모든 열 경계를 데이터 영역만큼
  for (const x of grid.colBoundaries) {
    pairs.push(...lineAt(grid, [x, top], [x, bottom], dx, alloc, owner));
  }
  // 번호 열
  const numberX = columnCenter(grid, grid.numberColumn);
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const number = tableIndex * grid.dataRowCount + row;
    pairs.push(...textAt(grid, [numberX, rowCenter(grid, row)], dx, String(number), alloc, owner));
  }
  return pairs;
}

/**
 * 표를 채운다. 원본 표는 인쇄된 번호 칸을 건드리지 않고 값 칸만 쓰고, 용량을 넘는 번호는 오른쪽 넘침 표에 넣는다.
 *
 * **호출 규칙 — 반드시 지킬 것:** `rows`에는 **1부터 마지막 번호까지 모든 번호의 행**을 넘겨야 한다. 도면 좌표가
 * 없어 건너뛴 손상도 번호는 그대로 갖고(설계 8장), 그 번호의 행은 칸이 전부 빈 문자열인 채로 넘긴다.
 * 넘침 표의 틀(격자·머리글·번호 칸)은 `rows`에 실제로 있는 번호로만 판단해 그리므로, 어떤 넘침 표에 속한 번호가
 * 전부 빠져 있으면 그 표 자체가 그려지지 않은 채 다음 표가 제 자리에 놓인다.
 */
export function fillTable(grid: TableGrid, rows: TableRow[], alloc: HandleAllocator, owner: string): DxfPair[] {
  const capacity = grid.dataRowCount;
  if (capacity <= 0) return [];

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
    const dx = offsetOf(grid, tableIndex);
    const y = rowCenter(grid, dataRow);
    for (let column = 0; column < COLUMN_COUNT; column++) {
      const value = row.cells[column];
      if (!value) continue;
      if (tableIndex === 0) {
        pairs.push(...textEntity(baseFor(alloc, owner), cellCenter(grid, dataRow, column), modelTextHeight(grid), value, 'center'));
      } else {
        pairs.push(...textAt(grid, [columnCenter(grid, column), y], dx, value, alloc, owner));
      }
    }
  }
  return pairs;
}
