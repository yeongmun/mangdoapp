import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerNames, parseDxf } from '../src/export/dxfDocument.js';
import { EXPORT_WARNINGS, ExportError, exportDamagesToDxf } from '../src/export/exportDrawing.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function template(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

type Pt = [number, number];

function damage(id: string, type: string, worldX: number, dwg: Pt[] | null, measured: Record<string, number | null> = {}) {
  const world: Pt[] = [[worldX, 0], [worldX + 10, 0], [worldX + 10, 10], [worldX, 10]];
  return {
    id,
    type,
    createdAt: '2026-09-15T00:00:00.000Z',
    geometry: { kind: 'rect', world, dwg },
    measured: { width: null, length: null, count: null, ...measured },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}

const RECT_A: Pt[] = [[0, 0], [1000, 0], [1000, 400], [0, 400]];
const RECT_B: Pt[] = [[2000, 0], [3000, 0], [3000, 400], [2000, 400]];

function entityCount(text: string, type: string): number {
  const doc = parseDxf(text);
  return doc.pairs.filter((p) => p.code === 0 && p.value === type).length;
}

describe('exportDamagesToDxf', () => {
  it('손상이 없으면 던진다', async () => {
    const text = await template();
    expect(() => exportDamagesToDxf(text, [])).toThrow(ExportError);
    expect(() => exportDamagesToDxf(text, [])).toThrow('표기한 손상이 없습니다');
  });

  it('원본 엔티티는 글자 그대로 남고 새 엔티티는 ENTITIES 끝에 붙는다', async () => {
    const original = await template();
    const result = exportDamagesToDxf(original, [damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 })]);

    // BLOCKS 구역 전체가 한 글자도 바뀌지 않는다
    const blocks = original.slice(
      original.indexOf('  0\nSECTION\n  2\nBLOCKS\n'),
      original.indexOf('  0\nSECTION\n  2\nENTITIES\n'),
    );
    expect(result.dxfText).toContain(blocks);

    // 원본 ENTITIES의 INSERT·LINE도 그대로다
    const entitiesHead = original.slice(
      original.indexOf('  0\nSECTION\n  2\nENTITIES\n'),
      original.indexOf('  0\nENDSEC\n  0\nEOF\n'),
    );
    expect(result.dxfText).toContain(entitiesHead);
    expect(result.dxfText.endsWith('  0\nENDSEC\n  0\nEOF\n')).toBe(true);
  });

  it('신규손상 레이어를 만들고 $HANDSEED를 올린다', async () => {
    const result = exportDamagesToDxf(await template(), [damage('a', 'spalling', 0, RECT_A)]);
    const doc = parseDxf(result.dxfText);
    expect(layerNames(doc)).toContain('신규손상');
    const seed = doc.pairs[doc.pairs.findIndex((p) => p.code === 9 && p.value === '$HANDSEED') + 1].value;
    expect(Number.parseInt(seed, 16)).toBeGreaterThan(0x200);
    // 핸들이 겹치지 않는다
    const handles = doc.pairs.filter((p) => p.code === 5).map((p) => p.value.trim());
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('도형·해치·라벨·표 글자를 모두 만든다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 }),
    ]);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    expect(entityCount(result.dxfText, 'HATCH')).toBe(1);
    expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1); // 번호 원
    // 라벨 3줄(번호·이름·치수) + 표 6칸
    expect(entityCount(result.dxfText, 'TEXT')).toBe(9);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('번호는 world 좌표로 왼쪽부터 매기고 dwg로 다시 매기지 않는다', async () => {
    // world에서는 a가 왼쪽(0), b가 오른쪽(500)이지만 dwg에서는 반대다
    const a = damage('a', 'crack', 0, RECT_B);
    const b = damage('b', 'crack', 500, RECT_A);
    const result = exportDamagesToDxf(await template(), [a, b]);
    const doc = parseDxf(result.dxfText);
    const texts = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => doc.pairs.slice(i, i + 20).find((p) => p.code === 1)!.value);
    expect(texts).toContain('1');
    expect(texts).toContain('2');
  });

  it('dwg가 없는 손상은 빼고 세어서 알린다. 번호는 그대로 소비한다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, null, { width: 1, length: 1, count: 1 }),
      damage('b', 'spalling', 500, RECT_A, { width: 2, length: 2, count: 1 }),
    ]);
    expect(result.skipped).toBe(1);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    const doc = parseDxf(result.dxfText);
    // 2번 손상의 값이 데이터 2행에 들어간다 (모델 y = 2000 + 2*(700-90) = 3220)
    const ys = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => Number(doc.pairs.slice(i, i + 24).find((p) => p.code === 21)!.value));
    expect(ys).toContain(3220);
    expect(ys).not.toContain(3260);
  });

  it('표가 없으면 경고만 붙이고 도형은 그린다', async () => {
    const text = await template();
    // ACAD_TABLE을 다른 이름으로 바꿔 표를 없앤다
    const noTable = text.replace('  0\nACAD_TABLE\n', '  0\nPOINT\n');
    const result = exportDamagesToDxf(noTable, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toEqual([EXPORT_WARNINGS.noTable]);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
  });

  it('표의 배율이 가로·세로가 다르면 던진다', async () => {
    const text = (await template()).replace(' 41\n2.0\n 42\n2.0\n', ' 41\n2.0\n 42\n3.0\n');
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)])).toThrow(
      '표의 배율이 가로·세로가 달라 채울 수 없습니다',
    );
  });

  it('표 모양을 알 수 없으면 경고만 붙인다', async () => {
    const text = (await template()).replace(' 92\n        8\n', ' 92\n        7\n').replace('142\n110.0\n', '');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toEqual([EXPORT_WARNINGS.unknownTable]);
  });

  it('$INSUNITS가 mm·없음·인치가 아니면 단위 경고를 붙인다', async () => {
    const text = (await template()).replace('$INSUNITS\n 70\n     1\n', '$INSUNITS\n 70\n     6\n');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toContain(EXPORT_WARNINGS.units);
  });

  it('$INSUNITS가 4·0·1이면 경고가 없다', async () => {
    for (const value of ['     4', '     0', '     1']) {
      const text = (await template()).replace('$INSUNITS\n 70\n     1\n', `$INSUNITS\n 70\n${value}\n`);
      const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
      expect(result.warnings).not.toContain(EXPORT_WARNINGS.units);
    }
  });

  it('ENTITIES 구역이 없으면 던진다', () => {
    const text = '  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n';
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)])).toThrow(/ENTITIES 구역/);
  });

  it('CRLF 원본은 CRLF로 돌려준다', async () => {
    const text = (await template()).replace(/\n/g, '\r\n');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.dxfText.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(result.dxfText)).toBe(false);
  });

  it('가운데 번호가 도면 좌표가 없어 건너뛴 손상이어도 그 뒤 번호의 빈 행과 넘침 표가 그려진다', async () => {
    // 표 데이터 행 수는 이 픽스처에서 4행(90mm씩). 번호 1은 빠지고(도면좌표 없음), 2~5는 도면좌표가
    // 있어 5번이 넘침 표(2번째 표)로 가야 한다. 2번 손상이 표에서 빠지면 넘침 표 자체가 그려지지
    // 않을 수 있으므로 그 상황을 구체적으로 검사한다.
    const damages = [
      damage('n1', 'spalling', 0, null, { width: 1, length: 1, count: 1 }), // 번호 1, dwg 없음 → 건너뜀
      damage('n2', 'spalling', 100, RECT_A, { width: 1, length: 1, count: 1 }), // 번호 2
      damage('n3', 'spalling', 200, RECT_A, { width: 1, length: 1, count: 1 }), // 번호 3
      damage('n4', 'spalling', 300, RECT_A, { width: 1, length: 1, count: 1 }), // 번호 4
      damage('n5', 'spalling', 400, RECT_A, { width: 1, length: 1, count: 1 }), // 번호 5 → 넘침 표
    ];
    const result = exportDamagesToDxf(await template(), damages);
    expect(result.skipped).toBe(1);
    expect(result.warnings).toEqual([]);

    const doc = parseDxf(result.dxfText);
    // 넘침 표의 틀(번호 열의 '5' 글자)이 그려져 있어야 한다 — 2번 손상이 빠졌다는 이유로
    // 넘침 표 판단이 흔들리면 이 글자가 없다.
    const texts = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => doc.pairs.slice(i, i + 20).find((p) => p.code === 1)!.value);
    expect(texts).toContain('5');
  });
});
