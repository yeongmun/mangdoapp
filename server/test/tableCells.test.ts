import { describe, expect, it } from 'vitest';
import { pair, parseDxf, type DxfPair } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import {
  appendBeforeEndblk,
  cellMargin,
  cellMtextPairs,
  cellWritesFor,
  escapeMtext,
  numberColumnWrites,
  stripGraphicsCache,
  writeCellValues,
} from '../src/export/tableCells.js';
import { rowValuesOf } from '../src/export/tableFill.js';
import { buildGrid, modelSpaceRanges, type TableGrid } from '../src/export/tableGrid.js';
import { modelSpaceTemplate } from './fixtureDocs.js';

async function setup() {
  const doc = parseDxf(await modelSpaceTemplate());
  const frame = findFrames(doc)[0];
  const grid = buildGrid(doc, frame.table)!;
  const range = modelSpaceRanges(doc)[frame.tableEntityIndex!];
  return { doc, grid, tablePairs: doc.pairs.slice(range.start, range.end) };
}

// 셀 순번 n(행 우선)의 CELL_VALUE 묶음(301~304)을 돌려준다.
function cellGroup(pairs: DxfPair[], n: number): DxfPair[] {
  let index = -1;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 171) index += 1;
    if (index === n && pairs[i].code === 301) {
      const end = pairs.findIndex((p, j) => j > i && p.code === 304);
      return pairs.slice(i, end + 1);
    }
  }
  throw new Error(`셀 ${n} 없음`);
}

const DAMAGE = {
  id: 'd1', type: 'spalling', geometry: { kind: 'rect', world: [], dwg: [] }, copies: [],
  measured: { width: 1.2, length: 1.5, count: 2 }, computed: {}, attrs: { note: '', statusText: '', photoNumbers: [] },
};

describe('cellWritesFor · numberColumnWrites', () => {
  it('번호 행을 표 행 인덱스로 옮기고 값이 있는 열만 낸다', async () => {
    const { grid } = await setup();
    const writes = cellWritesFor(grid, [rowValuesOf(DAMAGE, 2)]);
    // firstDataRow 2 → 번호 2는 행 3. 손상현황(2)·가로(3)·세로(4)·개소(5)·면적(6)·단위(7)
    expect(writes.map((w) => [w.row, w.column])).toEqual([[3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7]]);
    expect(writes.find((w) => w.column === 5)!.value).toBe('2');
    expect(writes.every((w) => typeof w.value === 'string' && w.value !== '')).toBe(true);
  });

  it('빈 행(필드 없음)은 아무 것도 내지 않는다', async () => {
    const { grid } = await setup();
    expect(cellWritesFor(grid, [{ number: 1, fields: {} }])).toEqual([]);
  });

  it('번호 열은 장 번호에 맞춰 정수로 낸다', async () => {
    const { grid } = await setup();
    expect(numberColumnWrites(grid, 1)).toEqual([
      { row: 2, column: 0, value: 4 }, { row: 3, column: 0, value: 5 }, { row: 4, column: 0, value: 6 },
    ]);
  });
});

describe('writeCellValues · stripGraphicsCache', () => {
  it('문자열 칸은 93 0 / 90 4 / 1 / 94 / 302 형식으로, 정수 칸은 90 1 / 91 / 300 / 302 형식으로 바뀐다', async () => {
    const { tablePairs } = await setup();
    const out = writeCellValues(tablePairs, 8, [{ row: 2, column: 2, value: '박락' }, { row: 3, column: 0, value: 36 }]);
    const text = cellGroup(out, 2 * 8 + 2).map((p) => [p.code, p.value]);
    expect(text).toEqual([[301, 'CELL_VALUE'], [93, '        0'], [90, '        4'], [1, '박락'], [94, '        0'], [302, '박락'], [304, 'ACVALUE_END']]);
    const num = cellGroup(out, 3 * 8 + 0).map((p) => [p.code, p.value]);
    expect(num).toEqual([[301, 'CELL_VALUE'], [93, '        0'], [90, '        1'], [91, '       36'], [94, '        0'], [300, ''], [302, '36'], [304, 'ACVALUE_END']]);
  });

  it('쓰지 않은 칸과 셀 속성(171~178)은 그대로다 — 쌍 수가 묶음 교체분만큼만 바뀐다', async () => {
    const { tablePairs } = await setup();
    const out = writeCellValues(tablePairs, 8, [{ row: 2, column: 2, value: '박락' }]);
    // 빈 칸 묶음 8쌍 → 문자열 묶음 7쌍: 길이가 하나 줄어든다
    expect(out).toHaveLength(tablePairs.length - 1);
    expect(cellGroup(out, 2 * 8 + 3)).toEqual(cellGroup(tablePairs, 2 * 8 + 3));
    expect(out.filter((p) => p.code === 171)).toHaveLength(40);
    expect(out).not.toBe(tablePairs);
  });

  it('stripGraphicsCache는 160·310을 지우고 나머지는 둔다', async () => {
    const { tablePairs } = await setup();
    const out = stripGraphicsCache(tablePairs);
    expect(out.some((p) => p.code === 160 || p.code === 310)).toBe(false);
    expect(out).toHaveLength(tablePairs.length - 2);
  });
});

describe('cellMargin · cellMtextPairs · appendBeforeEndblk', () => {
  it('번호 글자의 41이 없으면 여백은 0, 있으면 (열 너비 − 41) / 2', async () => {
    const { grid } = await setup();
    expect(cellMargin(grid)).toBe(0);
    expect(cellMargin({ ...grid, textWidth: 80 })).toBe(10); // 번호 열 너비 100
  });

  it('칸 가운데에 MTEXT를 만든다(표 로컬 좌표)', async () => {
    const { grid } = await setup();
    const pairs = cellMtextPairs({ ...grid, textWidth: 80 }, { row: 2, column: 2, value: '박락' }, '1A2', '31');
    const at = (code: number) => pairs.find((p) => p.code === code)!.value;
    expect(pairs[0]).toEqual(pair(0, 'MTEXT'));
    expect(at(5)).toBe('1A2');
    expect(at(330)).toBe('31');
    expect(at(8)).toBe('0');
    expect(at(10)).toBe('400.0'); // (250 + 550) / 2
    expect(at(20)).toBe('-70.0'); // (−60 + −80) / 2
    expect(at(40)).toBe('10.0');
    expect(at(41)).toBe('280.0'); // 300 − 2 × 10
    expect(at(71).trim()).toBe('5');
    expect(at(72).trim()).toBe('5');
    expect(at(1)).toBe('박락');
    expect(at(73).trim()).toBe('1');
    expect(at(44)).toBe('1.0');
    // 정수 값은 글자로
    expect(cellMtextPairs(grid, { row: 2, column: 0, value: 36 }, '1A3', '31').find((p) => p.code === 1)!.value).toBe('36');
  });

  it('appendBeforeEndblk는 (0, ENDBLK) 바로 앞에 끼운다', () => {
    const block = [pair(0, 'BLOCK'), pair(2, '*T1'), pair(0, 'LINE'), pair(0, 'ENDBLK'), pair(5, '9')];
    const out = appendBeforeEndblk(block, [pair(0, 'MTEXT')]);
    expect(out.map((p) => p.value)).toEqual(['BLOCK', '*T1', 'LINE', 'MTEXT', 'ENDBLK', '9']);
    expect(() => appendBeforeEndblk([pair(0, 'BLOCK')], [])).toThrow(/ENDBLK/);
  });
});

describe('escapeMtext', () => {
  // 역슬래시·중괄호는 MTEXT 서식 기호라 그대로 두면 글자가 사라지거나 서식이 깨진다.
  const RAW = 'a{b}\\c';
  const ESCAPED = 'a\\{b\\}\\\\c';

  it('역슬래시와 중괄호 앞에 역슬래시를 붙인다', () => {
    expect(escapeMtext(RAW)).toBe(ESCAPED);
    expect(escapeMtext('박락 1.2×1.5')).toBe('박락 1.2×1.5');
  });

  it('셀 값(1·302)과 글자 블록 MTEXT(1)에 이스케이프된 글자가 들어간다', async () => {
    const { grid, tablePairs } = await setup();
    const write = { row: 2, column: 2, value: RAW };
    const group = cellGroup(writeCellValues(tablePairs, 8, [write]), 2 * 8 + 2);
    expect(group.find((p) => p.code === 1)!.value).toBe(ESCAPED);
    expect(group.find((p) => p.code === 302)!.value).toBe(ESCAPED);
    expect(cellMtextPairs(grid, write, '1A4', '31').find((p) => p.code === 1)!.value).toBe(ESCAPED);
  });
});
