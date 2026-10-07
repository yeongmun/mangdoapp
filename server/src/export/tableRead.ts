// 올린 도면의 손상물량표(ACAD_TABLE)에 **이미 적혀 있는 행**(전차 점검의 기존 손상)을 읽는다.
// 신규 손상 번호는 이 행들 다음부터 이어 붙이고(startNumber), 산출 DXF는 이 행들을 건드리지 않으며,
// 원장(ledger)에는 '기존' 행으로 같이 나간다(2026-10-07 결정 — 보수 여부는 다루지 않는다).
//
// 셀은 171마다 하나씩 행 우선으로 늘어서고, 값은 301 CELL_VALUE … 304 묶음 안의 302(표시 글자) →
// 1(문자열) 순으로 본다. 묶음이 없는 옛 형식은 셀의 1/3 글자다(tableCells.ts의 쓰기 규칙과 대칭).
// 글자 블록(*T)의 MTEXT는 보지 않는다 — 값의 진실은 셀이다(지스타캐드 /table도 셀에 값을 둔다).

import type { DxfPair } from './dxfDocument.js';
import { resolvedColumnMap, type RowField } from './tableFill.js';
import type { RawEntity } from './tableGrid.js';

export interface ExistingRow {
  /** 표의 행 순서로 매긴 번호(데이터 1행 = 1). 셀의 번호 글자가 아니라 자리다 */
  number: number;
  location: string;
  status: string;
  width: string;
  length: string;
  count: string;
  quantity: string;
  unit: string;
  note: string;
}

export interface ExistingTable {
  /** 머리글 행 인덱스(0부터). 데이터는 그 다음 행부터 */
  headerRow: number;
  rows: ExistingRow[];
  /** 마지막으로 채워진 행의 번호. 신규 손상은 startNumber + 1부터. 채워진 행이 없으면 0 */
  startNumber: number;
}

/** MTEXT 서식({\f…;, \P, \~)과 이스케이프(\\, \{, \})를 걷어낸 글자 */
export function cleanCellText(raw: string): string {
  return raw
    .replace(/\\\\/g, '\u0000')
    .replace(/\\\{/g, '\u0001')
    .replace(/\\\}/g, '\u0002')
    .replace(/\\P/g, ' ')
    .replace(/\\~/g, ' ')
    .replace(/\{\\[^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\u0000/g, '\\')
    .replace(/\u0001/g, '{')
    .replace(/\u0002/g, '}')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellTextOf(pairs: DxfPair[]): string {
  let display: string | null = null;
  let str: string | null = null;
  let legacy = '';
  let inValue = false;
  for (const p of pairs) {
    if (p.code === 301 && p.value.trim() === 'CELL_VALUE') inValue = true;
    else if (p.code === 304) inValue = false;
    else if (inValue && p.code === 302) display = p.value;
    else if (inValue && p.code === 1) str = p.value;
    else if (!inValue && (p.code === 1 || p.code === 3)) legacy += p.value;
  }
  return cleanCellText(display ?? str ?? legacy);
}

/**
 * ACAD_TABLE 엔티티의 셀 글자를 cells[row][col]로. 행·열 수는 셀 앞의 91·92(없으면 141·142 개수).
 * 셀이 하나도 없는 표(옛 템플릿처럼 글자 블록에만 글자가 있는 것)는 null — 읽을 값이 없다.
 */
export function readTableCells(pairs: DxfPair[], entity: RawEntity): string[][] | null {
  if (entity.type !== 'ACAD_TABLE') return null;
  const body = pairs.slice(entity.range.start + 1, entity.range.end);
  let rows = 0;
  let cols = 0;
  let rowHeights = 0;
  let colWidths = 0;
  let firstCell = -1;
  for (let i = 0; i < body.length; i++) {
    const p = body[i];
    if (p.code === 171) {
      firstCell = i;
      break;
    }
    if (p.code === 91 && rows === 0) rows = Number(p.value);
    else if (p.code === 92 && cols === 0) cols = Number(p.value);
    else if (p.code === 141) rowHeights += 1;
    else if (p.code === 142) colWidths += 1;
  }
  if (!(rows > 0)) rows = rowHeights;
  if (!(cols > 0)) cols = colWidths;
  if (!(rows > 0 && cols > 0) || firstCell < 0) return null;

  const starts: number[] = [];
  for (let i = firstCell; i < body.length; i++) if (body[i].code === 171) starts.push(i);
  const texts = starts.map((start, n) => cellTextOf(body.slice(start, starts[n + 1] ?? body.length)));
  const cells: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) row.push(texts[r * cols + c] ?? '');
    cells.push(row);
  }
  return cells;
}

const VALUE_FIELDS: RowField[] = ['status', 'width', 'length', 'count', 'quantity', 'unit'];

/**
 * 셀 글자에서 기존 손상 행을 뽑는다. 머리글 행은 손상물량표 머리글 키워드(tableFill과 같은 규칙)가
 * 값 열 3개 이상 맞는 첫 행이다. 그 아래에서 손상현황·치수·물량 중 하나라도 적힌 행이 기존 손상이다.
 * 머리글을 못 찾으면 null.
 */
export function existingRowsOf(cells: string[][]): ExistingTable | null {
  for (let headerRow = 0; headerRow < cells.length; headerRow++) {
    const { map, usedFallback } = resolvedColumnMap(cells[headerRow]);
    if (usedFallback) continue;
    const at = (row: string[], field: RowField): string => {
      const column = map[field];
      return column === undefined ? '' : (row[column] ?? '').trim();
    };
    const rows: ExistingRow[] = [];
    for (let r = headerRow + 1; r < cells.length; r++) {
      const row = cells[r];
      if (!VALUE_FIELDS.some((field) => at(row, field) !== '')) continue;
      rows.push({
        number: r - headerRow,
        location: at(row, 'location'),
        status: at(row, 'status'),
        width: at(row, 'width'),
        length: at(row, 'length'),
        count: at(row, 'count'),
        quantity: at(row, 'quantity'),
        unit: at(row, 'unit'),
        note: at(row, 'note'),
      });
    }
    const startNumber = rows.length > 0 ? rows[rows.length - 1].number : 0;
    return { headerRow, rows, startNumber };
  }
  return null;
}

/** 표 엔티티 하나에서 기존 손상 표를 읽는다. 셀이 없거나 머리글을 못 찾으면 null */
export function existingTableOf(pairs: DxfPair[], entity: RawEntity): ExistingTable | null {
  const cells = readTableCells(pairs, entity);
  return cells ? existingRowsOf(cells) : null;
}
