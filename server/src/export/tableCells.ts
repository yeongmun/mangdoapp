// 모델 공간에 놓인 손상물량표(ACAD_TABLE)의 셀을 직접 채운다. 표 엔티티의 셀 값 묶음을 바꾸고,
// 캐드가 실제로 그리는 `*T` 글자 블록에 같은 글자의 MTEXT를 넣고, 그래픽 캐시는 지운다.
// 지스타캐드 시험(2026-10-02): 셀 값만 바꾸면 보이지 않고, 글자 블록까지 넣어야 보이며 더블클릭
// 편집도 된다. 전부 DxfPair[]만 다루는 순수 함수다 — 문서에 적용하는 일은 exportDrawing.ts가 한다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 2·4장

import { formatInt, formatReal, pair, type DxfPair } from './dxfDocument.js';
import { resolvedColumnMap, type RowField, type TableRow } from './tableFill.js';
import type { TableGrid } from './tableGrid.js';

export interface CellWrite {
  /** 표 행 인덱스(0부터, 머리글 행 포함) */
  row: number;
  column: number;
  /** 문자열은 문자열 칸, 숫자는 정수 칸(번호 열)으로 쓴다 */
  value: string | number;
}

/** 번호 행 목록을 셀 쓰기로 바꾼다. 열은 머리글 키워드로 찾고(tableFill과 같다), 값이 있는 칸만 낸다. */
export function cellWritesFor(grid: TableGrid, rows: TableRow[]): CellWrite[] {
  const columnCount = grid.colBoundaries.length - 1;
  const { map } = resolvedColumnMap(grid.headers);
  const entries = Object.entries(map) as Array<[RowField, number]>;
  const writes: CellWrite[] = [];
  for (const row of rows) {
    if (row.number < 1 || row.number > grid.dataRowCount) continue;
    const rowIndex = grid.firstDataRow + row.number - 1;
    for (const [field, column] of entries) {
      if (column < 0 || column >= columnCount) continue;
      const value = row.fields[field];
      if (!value) continue;
      writes.push({ row: rowIndex, column, value });
    }
  }
  return writes;
}

/** 번호 열의 데이터 행 전부를 장 번호에 맞춰 `page·N + i`로 쓴다(복제 표용). */
export function numberColumnWrites(grid: TableGrid, page: number): CellWrite[] {
  const writes: CellWrite[] = [];
  for (let i = 1; i <= grid.dataRowCount; i++) {
    writes.push({ row: grid.firstDataRow + i - 1, column: grid.numberColumn, value: page * grid.dataRowCount + i });
  }
  return writes;
}

// 셀 값 묶음(설계 2장). 93 플래그·90 자료형·값·94·302 표시 글자·304 끝.
function valueGroup(value: string | number): DxfPair[] {
  if (typeof value === 'number') {
    return [
      pair(301, 'CELL_VALUE'),
      pair(93, '        0'),
      pair(90, '        1'),
      pair(91, formatInt(value).padStart(9, ' ')),
      pair(94, '        0'),
      pair(300, ''),
      pair(302, formatInt(value)),
      pair(304, 'ACVALUE_END'),
    ];
  }
  return [
    pair(301, 'CELL_VALUE'),
    pair(93, '        0'),
    pair(90, '        4'),
    pair(1, value),
    pair(94, '        0'),
    pair(302, value),
    pair(304, 'ACVALUE_END'),
  ];
}

/**
 * 표 엔티티 한 벌에서 지정한 셀의 CELL_VALUE 묶음(301 … 304)만 새 값으로 바꾼다. 셀은 171로
 * 시작하며 행 우선으로 늘어선다 — n번째 171이 셀 n이다. 묶음 밖의 셀 속성은 그대로 둔다.
 */
export function writeCellValues(tablePairs: DxfPair[], columnCount: number, writes: CellWrite[]): DxfPair[] {
  if (writes.length === 0) return tablePairs;
  const byCell = new Map<number, string | number>();
  for (const write of writes) byCell.set(write.row * columnCount + write.column, write.value);

  const out: DxfPair[] = [];
  let cell = -1;
  for (let i = 0; i < tablePairs.length; i++) {
    const p = tablePairs[i];
    if (p.code === 171) cell += 1;
    const value = byCell.get(cell);
    if (value !== undefined && p.code === 301 && p.value.trim() === 'CELL_VALUE') {
      let j = i;
      while (j < tablePairs.length && tablePairs[j].code !== 304) j += 1;
      for (const q of valueGroup(value)) out.push(q);
      i = j;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 표의 그래픽 캐시(160 크기, 310 바이트)를 지운다 — 바뀐 셀과 어긋난 옛 그림이 남지 않게. */
export function stripGraphicsCache(tablePairs: DxfPair[]): DxfPair[] {
  return tablePairs.filter((p) => p.code !== 160 && p.code !== 310);
}

/** 글자 블록의 칸 안 여백 = (번호 열 너비 − 번호 글자 너비) / 2. 번호 글자 너비를 모르면 0. */
export function cellMargin(grid: TableGrid): number {
  if (!(grid.textWidth > 0)) return 0;
  const width = grid.colBoundaries[grid.numberColumn + 1] - grid.colBoundaries[grid.numberColumn];
  return Math.max(0, (width - grid.textWidth) / 2);
}

/**
 * 글자 블록(`*T`)에 넣을 MTEXT 한 벌(표 로컬 좌표, 칸 가운데). 모양은 원본 블록의 인쇄된 번호
 * 글자를 따른다 — 가운데 정렬(71 5), 글자 높이는 격자에서 읽은 값, 너비는 열 너비에서 여백을 뺀 값.
 */
export function cellMtextPairs(grid: TableGrid, write: CellWrite, handle: string, recordHandle: string): DxfPair[] {
  const left = grid.colBoundaries[write.column];
  const right = grid.colBoundaries[write.column + 1];
  const top = grid.rowBoundaries[write.row];
  const bottom = grid.rowBoundaries[write.row + 1];
  const width = Math.max(0, right - left - 2 * cellMargin(grid));
  const text = typeof write.value === 'number' ? formatInt(write.value) : write.value;
  return [
    pair(0, 'MTEXT'),
    pair(5, handle),
    pair(330, recordHandle),
    pair(100, 'AcDbEntity'),
    pair(8, '0'),
    pair(62, '     0'),
    pair(100, 'AcDbMText'),
    pair(10, formatReal((left + right) / 2)),
    pair(20, formatReal((top + bottom) / 2)),
    pair(30, '0.0'),
    pair(40, formatReal(grid.textHeight)),
    pair(41, formatReal(width)),
    pair(46, '0.0'),
    pair(71, '     5'),
    pair(72, '     5'),
    pair(1, text),
    pair(73, '     1'),
    pair(44, '1.0'),
  ];
}

/** BLOCK … ENDBLK 한 벌에서 (0, ENDBLK) 바로 앞에 엔티티들을 끼운다. */
export function appendBeforeEndblk(blockPairs: DxfPair[], extra: DxfPair[]): DxfPair[] {
  const at = blockPairs.findIndex((p) => p.code === 0 && p.value === 'ENDBLK');
  if (at < 0) throw new Error('블록에 ENDBLK가 없습니다');
  return blockPairs.slice(0, at).concat(extra, blockPairs.slice(at));
}
