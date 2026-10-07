import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeNumbers } from '../public/viewer/quantities.js';
import { parseDxf } from '../src/export/dxfDocument.js';
import { exportDamagesToDxf } from '../src/export/exportDrawing.js';
import { findFrames } from '../src/export/frames.js';
import { cleanCellText, existingRowsOf, readTableCells } from '../src/export/tableRead.js';
import { readModelSpace } from '../src/export/tableGrid.js';
import { modelSpaceTemplate, templateText } from './fixtureDocs.js';

// 모델 공간 /table 표에 손상 3건(균열·박락·균열/백태)이 채워진 산출 DXF — 전차 점검 도면 역할.
const withRowsPath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'model-table-3rows.dxf');

type Pt = [number, number];
function rectAt(x: number, y: number): Pt[] {
  return [[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100]];
}
function damage(id: string, dwg: Pt[]) {
  return {
    id, type: 'spalling', createdAt: '2026-10-07T00:00:00.000Z',
    geometry: { kind: 'rect', world: dwg, dwg }, copies: [],
    measured: { width: 1, length: 2, count: 1 }, computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}

describe('cleanCellText', () => {
  it('서식·이스케이프를 걷어낸다', () => {
    expect(cleanCellText('{\\f굴림|b0|i0|c129|p2;손상물량}표')).toBe('손상물량표');
    expect(cleanCellText('a\\{b\\}c\\\\d')).toBe('a{b}c\\d');
  });
});

describe('readTableCells / existingRowsOf', () => {
  it('채워진 셀을 행×열로 읽고 기존 손상 행과 startNumber를 낸다', async () => {
    const doc = parseDxf(await readFile(withRowsPath, 'utf8'));
    const model = readModelSpace(doc)!;
    const table = model.entities.find((e) => e.type === 'ACAD_TABLE')!;
    const cells = readTableCells(doc.pairs, table)!;
    expect(cells[1]).toEqual(['번호', '손상위치', '손상현황', '가로/폭', '세로/길이', '개소', '면적/연장', '단위']);
    expect(cells[2]).toEqual(['1', '', '균열(0.3mm미만)', '0.20', '5.00', '1', '5.00', 'm']);

    const existing = existingRowsOf(cells)!;
    expect(existing.headerRow).toBe(1);
    expect(existing.startNumber).toBe(3);
    expect(existing.rows.map((r) => [r.number, r.status, r.width, r.unit])).toEqual([
      [1, '균열(0.3mm미만)', '0.20', 'm'],
      [2, '박락', '0.50', '㎡'],
      [3, '균열/백태(0.3mm이상)', '0.40', 'm'],
    ]);
  });

  it('셀이 없는 옛 템플릿 표는 null', async () => {
    const doc = parseDxf(await templateText());
    const inBlockTable = [...readModelSpace(doc)!.blocks.values()].flat().find((e) => e.type === 'ACAD_TABLE')!;
    expect(readTableCells(doc.pairs, inBlockTable)).toBeNull();
  });

  it('값이 없는 빈 표(머리글만)는 startNumber 0', async () => {
    const doc = parseDxf(await modelSpaceTemplate(1));
    const table = readModelSpace(doc)!.entities.find((e) => e.type === 'ACAD_TABLE')!;
    const existing = existingRowsOf(readTableCells(doc.pairs, table)!)!;
    expect(existing.rows).toEqual([]);
    expect(existing.startNumber).toBe(0);
  });
});

describe('findFrames + 기존 손상', () => {
  it('틀의 bounds에 startNumber가 실리고, 화면 번호는 그 다음부터', async () => {
    const doc = parseDxf(await readFile(withRowsPath, 'utf8'));
    const [frame] = findFrames(doc);
    expect(frame.existing?.startNumber).toBe(3);
    expect(frame.bounds.startNumber).toBe(3);
    // 기존 행 자체도 bounds에 실린다 — 저장된 틀만으로 뷰어 현황표·원장이 기존 행을 낸다(2026-10-07)
    expect(frame.bounds.existing?.map((r) => r.status)).toEqual(['균열(0.3mm미만)', '박락', '균열/백태(0.3mm이상)']);
    const numbers = computeNumbers([damage('n1', rectAt(3000, 3000))], [frame.bounds]);
    expect(numbers.get('n1')).toBe(4);
  });

  it('기존 행이 없는 틀의 bounds에는 startNumber가 없다(옛 모양 그대로)', async () => {
    const [frame] = findFrames(parseDxf(await modelSpaceTemplate(1)));
    expect(frame.bounds).toEqual({ minX: 1000, minY: 2000, maxX: 5000, maxY: 6000 });
  });
});

describe('산출 — 기존 행은 그대로 두고 그 다음 행에 쓴다', () => {
  // 이 표는 데이터 행이 3개뿐이라 기존 3행으로 꽉 차 있다 → 신규 4번은 둘째 장(복제 표)으로 간다.
  it('신규 손상은 4번이 되어 둘째 장 1행에 들어가고, 원본 1~3행은 그대로, 복제 장에 기존 행이 따라오지 않는다', async () => {
    const source = await readFile(withRowsPath, 'utf8');
    const result = exportDamagesToDxf(source, [damage('n1', rectAt(3000, 3000))]);
    const doc = parseDxf(result.dxfText);
    const tables = readModelSpace(doc)!.entities.filter((e) => e.type === 'ACAD_TABLE').map((e) => readTableCells(doc.pairs, e)!);
    expect(tables).toHaveLength(2);
    const [first, second] = tables;
    expect(first[2].slice(2)).toEqual(['균열(0.3mm미만)', '0.20', '5.00', '1', '5.00', 'm']);
    expect(first[4].slice(2)).toEqual(['균열/백태(0.3mm이상)', '0.40', '1.50', '2', '3.00', 'm']);
    expect(second[2]).toEqual(['4', '', '박락', '1.00', '2.00', '1', '2.00', '㎡']);
    expect(second[3]).toEqual(['5', '', '', '', '', '', '', '']);
    expect(second[4]).toEqual(['6', '', '', '', '', '', '', '']);
    expect(result.warnings.some((w) => w.includes('2장'))).toBe(true);
  });
});
