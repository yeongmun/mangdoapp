// 손상물량표(ACAD_TABLE)를 통째로 복제한다 — 표 엔티티 + 글자 블록(*T) + 그 블록 레코드.
// 넘침 복사본의 표가 진짜 표 객체여야 캐드에서 셀 편집이 된다(사용자 결정 2026-10-02 ②).
// 지스타캐드 시험 E(2026-10-02)에서 이 세 벌을 넣은 파일이 열리고 편집·이동이 됐다.
// 전부 DxfPair[]를 만들기만 한다 — 문서에 넣는 자리는 exportDrawing.ts가 DocumentEdits로 정한다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 5.2

import { findBlock, formatReal, pair, type DxfDocument, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { numberColumnWrites, stripGraphicsCache, writeCellValues } from './tableCells.js';
import { entityRanges, indexOfBand, isPrintedNumber, numberAt, rawEntityAt, type RawEntity, type TableGrid } from './tableGrid.js';

const TABLE_BLOCK_NAME = /^\*T(\d+)$/;

/** 문서에 이미 있는 `*T<숫자>` 블록 이름. 코드 2·3 어디든 본다(BLOCK 머리·레코드·표 참조). */
export function usedTableNames(doc: DxfDocument): Set<string> {
  const used = new Set<string>();
  for (const p of doc.pairs) {
    if ((p.code === 2 || p.code === 3) && TABLE_BLOCK_NAME.test(p.value)) used.add(p.value);
  }
  return used;
}

/** 가장 큰 번호 + 1의 이름을 만들고 used에 넣는다. */
export function nextTableName(used: Set<string>): string {
  let max = 0;
  for (const name of used) {
    const n = Number(TABLE_BLOCK_NAME.exec(name)?.[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const name = `*T${max + 1}`;
  used.add(name);
  return name;
}

export interface TableClone {
  blockName: string;
  recordHandle: string;
  tableHandle: string;
  /** BLOCK_RECORD 한 벌 — BLOCK_RECORD 표의 ENDTAB 앞에 */
  recordPairs: DxfPair[];
  /** BLOCK … ENDBLK 한 벌 — 원본 글자 블록 뒤에 */
  blockPairs: DxfPair[];
  /** ACAD_TABLE 한 벌 — ENTITIES 끝에. 번호 열은 page·N + i, 캐시·확장 사전 없음 */
  tablePairs: DxfPair[];
}

export interface CloneOptions {
  /** 원본 표에서 x로 얼마나 옮기는가 */
  dx: number;
  /** 0이 원본 장. 번호 열에 page·N + i를 쓴다 */
  page: number;
  /** 새 글자 블록 이름(nextTableName) */
  name: string;
  alloc: HandleAllocator;
  /** BLOCK_RECORD 표의 핸들 = 새 레코드의 소유자 */
  recordTableHandle: string;
}

// 표 엔티티 사본: 첫 5는 새 핸들, 102 {…} 묶음 제거, 343·2는 새 블록, 첫 10은 dx만큼.
function cloneTablePairs(source: DxfPair[], options: CloneOptions, tableHandle: string, recordHandle: string): DxfPair[] {
  const out: DxfPair[] = [];
  let handleDone = false;
  let nameDone = false;
  let positionDone = false;
  for (let i = 0; i < source.length; i++) {
    const p = source[i];
    if (p.code === 102 && p.value.startsWith('{')) {
      let j = i + 1;
      while (j < source.length && !(source[j].code === 102 && source[j].value.trim() === '}')) j += 1;
      i = j;
      continue;
    }
    if (p.code === 5 && !handleDone) {
      handleDone = true;
      out.push({ ...p, value: tableHandle });
    } else if (p.code === 343) {
      out.push({ ...p, value: recordHandle });
    } else if (p.code === 2 && !nameDone) {
      nameDone = true;
      out.push({ ...p, value: options.name });
    } else if (p.code === 10 && !positionDone) {
      positionDone = true;
      const x = Number(p.value.trim());
      out.push({ ...p, value: Number.isFinite(x) ? formatReal(x + options.dx) : p.value });
    } else {
      out.push(p);
    }
  }
  return stripGraphicsCache(out);
}

// 글자 블록 사본: 모든 5는 새 핸들, 330이 원본 레코드면 새 레코드, 2·3의 이름은 새 이름,
// 번호 열 데이터 행의 MTEXT/TEXT 글자는 page·N + i.
// 글자가 데이터 행의 (번호 열이 아닌) 칸 안에 있는가.
function isDataCellText(grid: TableGrid, entity: RawEntity): boolean {
  const column = indexOfBand(grid.colBoundaries, numberAt(entity, 10, 0));
  const row = indexOfBand(grid.rowBoundaries, numberAt(entity, 20, 0));
  return column >= 0 && column !== grid.numberColumn && row >= grid.firstDataRow;
}

function cloneBlockPairs(doc: DxfDocument, grid: TableGrid, originalRecord: string, options: CloneOptions, recordHandle: string): DxfPair[] | null {
  const block = findBlock(doc, grid.blockName);
  if (!block) return null;
  const source = doc.pairs.slice(block.start, block.end);
  const out: DxfPair[] = [];
  for (const range of entityRanges(source, 0, source.length)) {
    const entity = rawEntityAt(source, range);
    const isText = range.type === 'MTEXT' || range.type === 'TEXT';
    // 데이터 행의 번호 열 밖 글자(기존 손상 행의 셀 글자)는 복제본에 넣지 않는다 — 그 장의 값은 따로 쓴다.
    if (isText && !isPrintedNumber(grid, entity) && isDataCellText(grid, entity)) continue;
    const printed = isText && isPrintedNumber(grid, entity);
    let number = 0;
    if (printed) {
      const y = Number(entity.values.get(20)?.[0]?.trim());
      const row = indexOfBand(grid.rowBoundaries, y);
      number = options.page * grid.dataRowCount + (row - grid.firstDataRow + 1);
    }
    let textDone = false;
    for (let i = range.start; i < range.end; i++) {
      const p = source[i];
      if (p.code === 5) out.push({ ...p, value: options.alloc.next() });
      else if (p.code === 330 && p.value.trim() === originalRecord) out.push({ ...p, value: recordHandle });
      else if ((p.code === 2 || p.code === 3) && p.value === grid.blockName) out.push({ ...p, value: options.name });
      else if (printed && p.code === 3) continue; // 긴 글 조각은 버린다 — 번호는 한 조각이다
      else if (printed && p.code === 1 && !textDone) {
        textDone = true;
        out.push({ ...p, value: String(number) });
      } else out.push(p);
    }
  }
  return out;
}

export function cloneTable(doc: DxfDocument, tablePairs: DxfPair[], grid: TableGrid, options: CloneOptions): TableClone | null {
  const block = findBlock(doc, grid.blockName);
  if (!block) return null;
  const recordHandle = options.alloc.next();
  const tableHandle = options.alloc.next();
  const blockPairs = cloneBlockPairs(doc, grid, block.recordHandle, options, recordHandle);
  if (!blockPairs) return null;

  const recordPairs: DxfPair[] = [
    pair(0, 'BLOCK_RECORD'),
    pair(5, recordHandle),
    pair(330, options.recordTableHandle),
    pair(100, 'AcDbSymbolTableRecord'),
    pair(100, 'AcDbBlockTableRecord'),
    pair(2, options.name),
    pair(340, '0'),
    pair(102, '{BLKREFS'),
    pair(331, tableHandle),
    pair(102, '}'),
    pair(70, '     0'),
    pair(280, '     1'),
    pair(281, '     0'),
  ];

  const columnCount = grid.colBoundaries.length - 1;
  const table = writeCellValues(cloneTablePairs(tablePairs, options, tableHandle, recordHandle), columnCount, numberColumnWrites(grid, options.page));
  return { blockName: options.name, recordHandle, tableHandle, recordPairs, blockPairs, tablePairs: table };
}
