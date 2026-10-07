import { describe, expect, it } from 'vitest';
import { createHandleAllocator, findBlock, parseDxf, symbolTableInfo, type DxfPair } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import { cloneTable, nextTableName, usedTableNames } from '../src/export/tableClone.js';
import { buildGrid, modelSpaceRanges } from '../src/export/tableGrid.js';
import { modelSpaceTemplate } from './fixtureDocs.js';

async function setup() {
  const doc = parseDxf(await modelSpaceTemplate());
  const frame = findFrames(doc)[0];
  const grid = buildGrid(doc, frame.table)!;
  const range = modelSpaceRanges(doc)[frame.tableEntityIndex!];
  const alloc = createHandleAllocator(doc);
  const info = symbolTableInfo(doc, 'BLOCK_RECORD')!;
  const clone = cloneTable(doc, doc.pairs.slice(range.start, range.end), grid, { dx: 50000, page: 1, name: '*T7', alloc, recordTableHandle: info.handle })!;
  return { doc, grid, clone, alloc, original: doc.pairs.slice(range.start, range.end) };
}
const at = (pairs: DxfPair[], code: number) => pairs.filter((p) => p.code === code).map((p) => p.value);
function handlesOf(pairs: DxfPair[]): string[] {
  return at(pairs, 5).map((v) => v.trim());
}

describe('usedTableNames · nextTableName', () => {
  it('문서의 *T<숫자> 이름을 모으고 다음 번호를 낸다', async () => {
    const doc = parseDxf(await modelSpaceTemplate());
    const used = usedTableNames(doc); // 픽스처는 *TX라 비어 있다
    expect(used.size).toBe(0);
    expect(nextTableName(used)).toBe('*T1');
    expect(nextTableName(used)).toBe('*T2');
    used.add('*T19');
    expect(nextTableName(used)).toBe('*T20');
  });
});

describe('cloneTable', () => {
  it('새 레코드·블록·표가 서로를 가리키고 핸들이 전부 새 것이다', async () => {
    const { clone, original, doc } = await setup();
    expect(clone.blockName).toBe('*T7');
    expect(at(clone.recordPairs, 0)).toEqual(['BLOCK_RECORD']);
    expect(at(clone.recordPairs, 2)).toEqual(['*T7']);
    expect(at(clone.recordPairs, 331)).toEqual([clone.tableHandle]);
    expect(at(clone.recordPairs, 330)).toEqual(['1']);
    expect(handlesOf(clone.recordPairs)).toEqual([clone.recordHandle]);

    expect(clone.blockPairs[0].value).toBe('BLOCK');
    expect(clone.blockPairs[clone.blockPairs.length - 1].code).not.toBe(0);
    expect(at(clone.blockPairs, 2)).toEqual(['*T7']);
    expect(at(clone.blockPairs, 3)).toEqual(['*T7']);
    expect(new Set(at(clone.blockPairs, 330))).toEqual(new Set([clone.recordHandle]));
    const originalBlock = findBlock(doc, '*TX')!;
    const originalHandles = handlesOf(doc.pairs.slice(originalBlock.start, originalBlock.end));
    for (const h of handlesOf(clone.blockPairs)) expect(originalHandles).not.toContain(h);
    expect(new Set(handlesOf(clone.blockPairs)).size).toBe(handlesOf(clone.blockPairs).length);

    expect(at(clone.tablePairs, 2)).toEqual(['*T7']);
    expect(at(clone.tablePairs, 343)).toEqual([clone.recordHandle]);
    expect(handlesOf(clone.tablePairs)).toEqual([clone.tableHandle]);
    expect(clone.tableHandle).not.toBe(handlesOf(original)[0]);
    expect(at(clone.tablePairs, 330)).toEqual(['1F']); // 소유자는 모델 공간 그대로
  });

  it('삽입점은 dx만큼 옮기고 방향 벡터·캐시·확장 사전은 없거나 그대로다', async () => {
    const { clone } = await setup();
    expect(at(clone.tablePairs, 10)).toEqual(['52000.0']);
    expect(at(clone.tablePairs, 20)).toEqual(['3400.0']);
    expect(at(clone.tablePairs, 11)).toEqual(['1.0']);
    expect(clone.tablePairs.some((p) => p.code === 160 || p.code === 310 || p.code === 360)).toBe(false);
    expect(clone.tablePairs.some((p) => p.code === 102)).toBe(false);
  });

  it('번호 열 데이터 행은 셀 값과 글자 블록 둘 다 page·N + i다', async () => {
    const { clone } = await setup(); // page 1, N 3 → 4·5·6
    expect(at(clone.tablePairs, 302).filter((v) => /^\d+$/.test(v))).toEqual(['4', '5', '6']);
    // 90은 자료형 플래그(문자열 칸은 4, 정수 칸은 1)라 표 머리의 "91 5"(행 수)와 '5'가 겹친다.
    // 그래서 91만 걸러서는 안 되고, 번호 칸을 나타내는 (90, '1') 바로 다음에 오는 91 값만 본다.
    const tablePairs = clone.tablePairs;
    const numberCellValues: string[] = [];
    for (let i = 0; i < tablePairs.length - 1; i++) {
      if (tablePairs[i].code === 90 && tablePairs[i].value.trim() === '1') {
        numberCellValues.push(tablePairs[i + 1].value.trim());
      }
    }
    expect(numberCellValues).toEqual(['4', '5', '6']);
    const blockTexts = at(clone.blockPairs, 1);
    expect(blockTexts).toContain('4');
    expect(blockTexts).toContain('6');
    expect(blockTexts).not.toContain('1');
    expect(blockTexts).toContain('가로/폭'); // 머리글은 그대로
  });

  it('글자 블록이 없으면 null', async () => {
    const { doc, grid, original, alloc } = await setup();
    expect(cloneTable(doc, original, { ...grid, blockName: '*NOPE' }, { dx: 0, page: 1, name: '*T8', alloc, recordTableHandle: '1' })).toBeNull();
  });
});
