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

  // R16(미룬 항목): ExportError 가드 3종이 실제로 검증되지 않았다. 손으로 쓴 최소 DXF가 아니라
  // 픽스처에서 해당 구역·표·레코드만 들어낸 파생 픽스처로, 정확한 한글 문구까지 확인한다.
  describe('ExportError 가드 3종 (픽스처에서 해당 부분을 들어낸 파생 픽스처)', () => {
    it('ENTITIES 구역이 없으면 정확한 문구로 던진다', async () => {
      const text = await template();
      const start = text.indexOf('  0\nSECTION\n  2\nENTITIES\n');
      const end = text.indexOf('  0\nENDSEC\n  0\nEOF\n');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const withoutEntities = text.slice(0, start) + text.slice(end + '  0\nENDSEC\n'.length);
      expect(() => exportDamagesToDxf(withoutEntities, [damage('a', 'crack', 0, RECT_A)])).toThrow(
        'DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다',
      );
    });

    it('LAYER 표가 없으면 정확한 문구로 던진다', async () => {
      const text = await template();
      const start = text.indexOf('  0\nTABLE\n  2\nLAYER\n');
      const endtab = text.indexOf('  0\nENDTAB\n', start);
      expect(start).toBeGreaterThan(0);
      expect(endtab).toBeGreaterThan(start);
      const withoutLayer = text.slice(0, start) + text.slice(endtab + '  0\nENDTAB\n'.length);
      expect(() => exportDamagesToDxf(withoutLayer, [damage('a', 'crack', 0, RECT_A)])).toThrow(
        'DXF 파일에서 LAYER 표를 찾을 수 없습니다',
      );
    });

    it('모델 공간 블록 레코드(*Model_Space)가 없으면 정확한 문구로 던진다', async () => {
      const text = await template();
      const start = text.indexOf('  0\nBLOCK_RECORD\n  5\n1F\n');
      const end = text.indexOf('  0\nBLOCK_RECORD\n  5\n30\n');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const withoutModelSpace = text.slice(0, start) + text.slice(end);
      expect(() => exportDamagesToDxf(withoutModelSpace, [damage('a', 'crack', 0, RECT_A)])).toThrow(
        'DXF 파일에서 모델 공간 블록 레코드를 찾을 수 없습니다',
      );
    });
  });

  it('CRLF 원본은 CRLF로 돌려준다', async () => {
    const text = (await template()).replace(/\n/g, '\r\n');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.dxfText.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(result.dxfText)).toBe(false);
  });

  // R13: statusText(기타 유형)의 줄바꿈이 표 칸의 TEXT 코드 1에 그대로 실리면 그 줄이 갈라져
  // 이후 모든 코드·값 쌍이 밀린다. textEntity에서 줄바꿈을 공백으로 바꾸므로 다시 읽힌다.
  it('손상현황에 줄바꿈이 있어도(옛 문서·API를 직접 호출한 경우) 다시 읽히는 DXF가 나온다', async () => {
    const withNewline = damage('a', 'etc', 0, RECT_A, { width: 1, length: 1, count: 1 });
    withNewline.attrs.statusText = '들뜸\n파손';
    const result = exportDamagesToDxf(await template(), [withNewline]);
    expect(() => parseDxf(result.dxfText)).not.toThrow();
    expect(result.dxfText).toContain('들뜸 파손');
    expect(result.dxfText).not.toContain('들뜸\n파손');
  });

  // R9(미룬 항목): 이전 테스트(번호 하나만 건너뜀)는 "rows에 실제로 있는 번호로만 넘침 표를
  // 그리는" 잘못된 구현도 우연히 통과시킨다 — 건너뛴 번호의 앞뒤에 같은 표에 속한 번호가 남아
  // 있으면 그 표는 어차피 그려지기 때문이다. 구별되는 시나리오는 표 하나(3행, tableFill.test.ts
  // 실측) 전체의 번호가 통째로 건너뛰는 경우다: 1~3(있음) / 4~6(전부 건너뜀=두 번째 표 전체) /
  // 7~9(있음). 두 번째 표의 번호가 하나도 rows에 "있는" 채로 안 들어오면(잘못된 구현) 그 표의
  // 틀 자체가 안 그려지고, 세 번째 표(7~9)는 원래 자리(tableIndex=2)에 그대로 남는다 — 즉
  // 세 번째 표 위치는 이 버그로는 흔들리지 않으므로, 반드시 두 번째 표 틀 자체를 검사해야 한다.
  it('넘침 표 하나 전체의 번호가 통째로 건너뛰어도 그 표의 틀이 그려진다', async () => {
    const damages = [
      ...[1, 2, 3].map((n) => damage(`p${n}`, 'spalling', n * 10, RECT_A, { width: 1, length: 1, count: 1 })),
      ...[4, 5, 6].map((n) => damage(`s${n}`, 'spalling', n * 10, null, { width: 1, length: 1, count: 1 })),
      ...[7, 8, 9].map((n) => damage(`q${n}`, 'spalling', n * 10, RECT_A, { width: 1, length: 1, count: 1 })),
    ];
    const result = exportDamagesToDxf(await template(), damages);
    expect(result.skipped).toBe(3);
    expect(result.warnings).toEqual([]);

    const doc = parseDxf(result.dxfText);
    const numberTexts = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => doc.pairs.slice(i, i + 20).find((p) => p.code === 1)!.value)
      .filter((t) => /^\d+$/.test(t));

    // 두 번째 표(4~6)는 손상이 전부 건너뛰었어도 번호 칸은 표 틀과 함께 인쇄된다.
    expect(numberTexts).toEqual(expect.arrayContaining(['4', '5', '6']));
    // 세 번째 표(7~9)도 제자리에 그려진다.
    expect(numberTexts).toEqual(expect.arrayContaining(['7', '8', '9']));
  });
});
