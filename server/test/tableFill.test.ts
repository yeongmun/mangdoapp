import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import { buildGrid, findTableCandidates, type TableGrid } from '../src/export/tableGrid.js';
import { fillTable, rowValuesOf, TABLE_COLUMN } from '../src/export/tableFill.js';
import { parseDxf } from '../src/export/dxfDocument.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function grid(): Promise<TableGrid> {
  const doc = parseDxf(await readFile(fixturePath, 'utf8'));
  return buildGrid(doc, findTableCandidates(doc)[0])!;
}

function damage(type: string, measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id: `d-${type}`,
    type,
    geometry: { kind: 'rect', world: [[0, 0]], dwg: [[0, 0], [1, 1]] },
    measured: { width: null, length: null, count: null, ...measured },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}

interface TextEntity {
  text: string;
  x: number;
  y: number;
  layer: string;
  color: number;
}

// 만들어진 쌍에서 TEXT 엔티티만 뽑아 본다.
function textsOf(pairs: DxfPair[]): TextEntity[] {
  const result: TextEntity[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'TEXT') continue;
    let text = '';
    let x = Number.NaN;
    let y = Number.NaN;
    let layer = '';
    let color = Number.NaN;
    for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
      if (pairs[j].code === 1) text = pairs[j].value;
      else if (pairs[j].code === 11) x = Number(pairs[j].value);
      else if (pairs[j].code === 21) y = Number(pairs[j].value);
      else if (pairs[j].code === 8) layer = pairs[j].value;
      else if (pairs[j].code === 62) color = Number(pairs[j].value);
    }
    result.push({ text, x, y, layer, color });
  }
  return result;
}

function lineCount(pairs: DxfPair[]): number {
  return pairs.filter((p) => p.code === 0 && p.value === 'LINE').length;
}

interface LineLayerInfo {
  layer: string;
  color: number;
}

// LINE 엔티티마다 레이어·색만 뽑아 본다(넘침 표의 격자선 확인용).
function lineLayersOf(pairs: DxfPair[]): LineLayerInfo[] {
  const result: LineLayerInfo[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'LINE') continue;
    let layer = '';
    let color = Number.NaN;
    for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
      if (pairs[j].code === 8) layer = pairs[j].value;
      else if (pairs[j].code === 62) color = Number(pairs[j].value);
    }
    result.push({ layer, color });
  }
  return result;
}

describe('rowValuesOf', () => {
  it('손상현황·가로/폭·세로/길이·개소·물량·단위를 채우고 번호와 손상위치는 비운다', () => {
    const row = rowValuesOf(damage('crack', { width: 0.2, length: 1.5, count: 2 }), 7);
    expect(row.number).toBe(7);
    expect(row.cells).toEqual(['', '', '균열(0.3mm미만)', '0.2', '1.5', '2', '3.0', 'm']);
  });

  it('면형은 가로 × 세로 × 개소가 물량이고 단위가 ㎡다', () => {
    const row = rowValuesOf(damage('spalling', { width: 1.2, length: 1.5, count: 1 }), 1);
    expect(row.cells[TABLE_COLUMN.status]).toBe('박락');
    expect(row.cells[TABLE_COLUMN.quantity]).toBe('1.8');
    expect(row.cells[TABLE_COLUMN.unit]).toBe('㎡');
  });

  it('값이 없는 칸은 비워 둔다 (-를 쓰지 않는다)', () => {
    const row = rowValuesOf(damage('spalling', { width: null, length: 1.5, count: null }), 2);
    expect(row.cells).toEqual(['', '', '박락', '', '1.5', '', '', '㎡']);
  });

  it('0은 유효한 값이라 적는다', () => {
    const row = rowValuesOf(damage('spalling', { width: 0, length: 0, count: 0 }), 3);
    expect(row.cells[TABLE_COLUMN.width]).toBe('0.0');
    expect(row.cells[TABLE_COLUMN.count]).toBe('0');
    expect(row.cells[TABLE_COLUMN.quantity]).toBe('0.0');
  });

  it('기타는 사용자가 적은 손상현황을 쓴다', () => {
    const row = rowValuesOf(damage('etc', {}, { statusText: '받침 손상' }), 4);
    expect(row.cells[TABLE_COLUMN.status]).toBe('받침 손상');
  });
});

describe('fillTable — 원본 표 안', () => {
  it('번호 순서대로 데이터 행에 글자를 놓는다', async () => {
    const g = await grid();
    const pairs = fillTable(
      g,
      [
        rowValuesOf(damage('spalling', { width: 1.2, length: 1.5, count: 1 }), 1),
        rowValuesOf(damage('crack', { width: 0.2, length: 1.5, count: 2 }), 3),
      ],
      new HandleAllocator(0x400),
      '1F',
    );
    const texts = textsOf(pairs);
    // 1행: 박락 1.2 1.5 1 1.8 ㎡ (6칸), 3행: 균열(...) 0.2 1.5 2 3.0 m (6칸)
    expect(texts).toHaveLength(12);
    const first = texts.find((t) => t.text === '박락')!;
    // 2열 중앙, 데이터 1행 중앙 → 모델 (2800, 3260)
    expect(first.x).toBeCloseTo(2800, 6);
    expect(first.y).toBeCloseTo(3260, 6);
    const third = texts.find((t) => t.text.startsWith('균열'))!;
    // 데이터 3행 중앙 y = -110 → 모델 3180
    expect(third.y).toBeCloseTo(3180, 6);
  });

  it('빈 칸은 글자를 만들지 않는다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 1)], new HandleAllocator(0x400), '1F');
    expect(textsOf(pairs).map((t) => t.text)).toEqual(['박락', '1.5', '㎡']);
  });

  it('원본 표 안에 들어가면 선을 하나도 긋지 않는다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 1)], new HandleAllocator(0x400), '1F');
    expect(lineCount(pairs)).toBe(0);
  });

  // 근거: 캐드 확인 2차 피드백(2026-09-16) — 표 칸 글자는 손상 도형과 다른 레이어·색(손상물량표, 7)이다.
  it('데이터 칸 글자는 손상물량표 레이어·색 7이다 (신규손상이 아니다)', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { width: 1.2, length: 1.5, count: 1 }), 1)], new HandleAllocator(0x400), '1F');
    const texts = textsOf(pairs);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t.layer).toBe('손상물량표');
      expect(t.color).toBe(7);
    }
  });

  it('글자 높이는 셀 글자 높이 × 배율이다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 1)], new HandleAllocator(0x400), '1F');
    expect(pairs.filter((p) => p.code === 40).map((p) => p.value)).toEqual(['20.0', '20.0']);
  });
});

describe('fillTable — 넘침 표', () => {
  // 픽스처의 데이터 행 수는 3이다. 번호 4부터는 원본 표 바로 아래에 새 표가 생긴다.
  it('데이터 행 수를 넘으면 아래에 표를 한 장 더 그린다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    const texts = textsOf(pairs);

    // 머리글 9개 + 번호 3개 + 값 3개
    expect(texts.map((t) => t.text)).toEqual([
      '손상물량표', '번호', '손상위치', '손상현황', '가로/폭', '세로/길이', '개소', '면적/연장', '단위',
      '4', '5', '6',
      '박락', '1.5', '㎡',
    ]);
    // 머리글 선 5개 + 가로 3개(데이터 행 경계) + 세로 9개
    expect(lineCount(pairs)).toBe(17);
  });

  it('새 표는 원본 표 바로 아래, 머리글 행 높이만큼 띄운 자리에 있고 왼쪽 끝이 같다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    const value = textsOf(pairs).find((t) => t.text === '박락')!;
    // 왼쪽 끝은 원본과 같다 — x는 원본 표의 2열 중앙 그대로다.
    expect(value.x).toBeCloseTo(2800, 6);
    // 표 높이 120 + 머리글 행 높이 40 = 160만큼 로컬로 내려간다 → 모델에서는 배율 2를 곱해 320
    expect(value.y).toBeCloseTo(3260 - 320, 6);
  });

  it('번호 열은 원본 다음 번호부터 이어서 인쇄한다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 7)], new HandleAllocator(0x400), '1F');
    const numbers = textsOf(pairs).filter((t) => /^\d+$/.test(t.text)).map((t) => t.text);
    // 번호 7은 세 번째 표(7~9)에 들어간다
    expect(numbers).toEqual(['7', '8', '9']);
  });

  it('여러 넘침 표가 필요하면 각각 한 번씩만 그린다', async () => {
    const g = await grid();
    const pairs = fillTable(
      g,
      [rowValuesOf(damage('spalling', {}), 4), rowValuesOf(damage('crack', {}), 5), rowValuesOf(damage('etc', {}), 7)],
      new HandleAllocator(0x400),
      '1F',
    );
    // 두 번째 표 머리글 1벌 + 세 번째 표 머리글 1벌 = 머리글 글자 18개
    expect(textsOf(pairs).filter((t) => t.text === '손상물량표')).toHaveLength(2);
    expect(lineCount(pairs)).toBe(34);
  });

  // R17(minor): 넘침 표의 머리글 글자는 각자 원래 높이(BlockText.height × 배율)로 그려야
  // 한다 — 셀(데이터 칸) 글자 높이를 그대로 쓰면 원본에서 머리글과 데이터 칸의 글자 크기가
  // 다를 때 어긋난다. 픽스처는 둘 다 10.0이라 구별이 안 되므로, 머리글 하나의 높이만
  // 15.0으로 바꿔 셀 높이(10.0)와 달라지게 한다.
  it('머리글 글자는 셀 높이가 아니라 각자 원래 높이 × 배율로 그려진다', async () => {
    const original = await readFile(fixturePath, 'utf8');
    const target = ' 10\n610.0\n 20\n-50.0\n 30\n0.0\n 40\n10.0\n 71\n     5\n  1\n가로/폭\n';
    const replaced = ' 10\n610.0\n 20\n-50.0\n 30\n0.0\n 40\n15.0\n 71\n     5\n  1\n가로/폭\n';
    expect(original.includes(target)).toBe(true);
    const doc = parseDxf(original.replace(target, replaced));
    const g = buildGrid(doc, findTableCandidates(doc)[0])!;

    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');

    let index = -1;
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].code === 0 && pairs[i].value === 'TEXT') {
        const text = pairs.slice(i, i + 20).find((p) => p.code === 1)?.value;
        if (text === '가로/폭') {
          index = i;
          break;
        }
      }
    }
    expect(index).toBeGreaterThanOrEqual(0);
    const height = pairs.slice(index, index + 20).find((p) => p.code === 40)!.value;
    // 15.0(원래 높이) × 배율(2) = 30.0. 셀 높이였다면 10.0 × 2 = 20.0이 나왔을 것이다.
    expect(height).toBe('30.0');
  });

  // 근거: 캐드 확인 2차 피드백(2026-09-16) — 옛 넘침 표(아래에 한 장 더)의 LINE·TEXT도 손상물량표
  // 레이어·색 7이다.
  it('넘침 표의 선·머리글·번호·값 글자가 모두 손상물량표 레이어·색 7이다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    for (const t of textsOf(pairs)) {
      expect(t.layer).toBe('손상물량표');
      expect(t.color).toBe(7);
    }
    for (const l of lineLayersOf(pairs)) {
      expect(l.layer).toBe('손상물량표');
      expect(l.color).toBe(7);
    }
  });

  it('핸들이 겹치지 않는다', async () => {
    const g = await grid();
    const alloc = new HandleAllocator(0x400);
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], alloc, '1F');
    const handles = pairs.filter((p) => p.code === 5).map((p) => p.value);
    expect(new Set(handles).size).toBe(handles.length);
  });
});
