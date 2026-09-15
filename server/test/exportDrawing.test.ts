import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerNames, parseDxf } from '../src/export/dxfDocument.js';
import { EXPORT_WARNINGS, ExportError, exportDamagesToDxf } from '../src/export/exportDrawing.js';
import { flatTable, withSecondFrame } from './fixtureDocs.js';

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

// 픽스처의 망도틀 영역: x 2000~4280, y 3160~3400 (frames.test.ts에서 손으로 계산).
// 손상의 dwg 경계상자 **중심**이 이 안에 있어야 그 틀의 번호와 표를 받는다.
const RECT_A: Pt[] = [[2100, 3200], [3100, 3200], [3100, 3300], [2100, 3300]]; // 중심 (2600, 3250)
const RECT_B: Pt[] = [[3200, 3200], [4200, 3200], [4200, 3300], [3200, 3300]]; // 중심 (3700, 3250)

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

  it('dwg가 없는 손상은 빼고 세어서 알린다. 번호도 차지하지 않는다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, null, { width: 1, length: 1, count: 1 }),
      damage('b', 'spalling', 500, RECT_A, { width: 2, length: 2, count: 1 }),
    ]);
    expect(result.skipped).toBe(1);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    const doc = parseDxf(result.dxfText);
    // b가 1번이 되어 데이터 1행에 들어간다 (모델 y = 2000 + 2*(700-70) = 3260).
    // 예전 규칙이었다면 b는 2번이라 3220에 들어갔다.
    const ys = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => Number(doc.pairs.slice(i, i + 24).find((p) => p.code === 21)!.value));
    expect(ys).toContain(3260);
    expect(ys).not.toContain(3220);
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
    // 세로 배율 3이면 틀 영역은 y 2000+3*580=3740 ~ 2000+3*700=4100이다. 그 안에 손상을 둔다.
    const inStretched: Pt[] = [[2100, 3800], [3100, 3800], [3100, 3900], [2100, 3900]];
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, inStretched)])).toThrow(
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

  // 2,000개 손상 스트레스 확인(실제 사내 템플릿) 중 발견: pairs.push(...fillTable(...))도
  // splice(...)와 같은 인자 전개 방식이라, 넘침 표가 많아 fillTable의 반환 배열이 아주 크면
  // (이 픽스처는 데이터 행 3개라 손상 3,000개면 넘침 표가 1,000장) "Maximum call stack size
  // exceeded"로 죽는다. exportDrawing.ts는 인자 전개 없이 하나씩 옮겨 붙이도록 고쳤다.
  it('넘침 표가 아주 많아도(인자 전개 없이) 산출되고 다시 읽힌다', async () => {
    // 틀이 없는 도면(표가 최상위)이라 번호가 3,000번까지 쭉 이어지고 넘침 표가 1,000장 생긴다.
    const text = flatTable(await template());
    const damages = [];
    for (let i = 0; i < 3000; i++) {
      const x = i * 20;
      damages.push(damage(`d${i}`, 'crack', x, [[x, 0], [x + 10, 10]], { width: 0.2, length: 1.5, count: 1 }));
    }
    const result = exportDamagesToDxf(text, damages);
    expect(result.skipped).toBe(0);
    expect(() => parseDxf(result.dxfText)).not.toThrow();
  });

  // R17(minor): 균열/백태 원이 1000개에서 잘리면 경고를 붙인다.
  it('균열/백태 원이 1000개에서 잘리면 경고를 붙인다', async () => {
    const longLine = damage('a', 'crack_efflorescence', 0, [[0, 0], [1_000_000, 0]]);
    const result = exportDamagesToDxf(await template(), [longLine]);
    expect(result.warnings).toContain(EXPORT_WARNINGS.circlesTruncated);
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
    // 틀이 없는 도면에서만 "건너뛴 손상이 번호를 차지한다"는 예전 규칙이 남는다(설계 6장).
    const result = exportDamagesToDxf(flatTable(await template()), damages);
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

  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3·4장
  describe('라벨 겹침 방지와 사진번호 레이어', () => {
    // 세로 3100~3500이라 경계상자 중심 y = 3300이 틀 안(3160~3400)이다. 도형 자체는 틀보다
    // 위아래로 튀어나와도 된다 — 배정은 중심만 본다.
    function wide(id: string, x: number, photoNumbers: string[] = []) {
      const points: Pt[] = [[x, 3100], [x + 1000, 3100], [x + 1000, 3500], [x, 3500]];
      return {
        id,
        type: 'spalling',
        createdAt: '2026-09-16T00:00:00.000Z',
        geometry: { kind: 'rect', world: points, dwg: points },
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers },
      };
    }

    // TEXT 엔티티마다 값·레이어·색·정렬점을 모아 준다.
    function texts(dxfText: string) {
      const doc = parseDxf(dxfText);
      const out: Array<{ value: string; layer: string; color: number; y: number }> = [];
      for (let i = 0; i < doc.pairs.length; i++) {
        if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'TEXT') continue;
        const entry = { value: '', layer: '', color: 0, y: 0 };
        let j = i + 1;
        for (; j < doc.pairs.length && doc.pairs[j].code !== 0; j++) {
          const p = doc.pairs[j];
          if (p.code === 8) entry.layer = p.value;
          else if (p.code === 62) entry.color = Number(p.value);
          else if (p.code === 1) entry.value = p.value;
          else if (p.code === 21) entry.y = Number(p.value);
        }
        out.push(entry);
        i = j - 1;
      }
      return out;
    }

    it('나란히 붙은 손상 둘이면 2번 라벨이 위로 블록 높이만큼 어긋나고 화살표 LINE 3개가 생긴다', async () => {
      const original = await template();
      const result = exportDamagesToDxf(original, [wide('a', 2000), wide('b', 3050)]);
      const dimensions = texts(result.dxfText)
        .filter((t) => t.value === '1.2x1.5')
        .map((t) => t.y)
        .sort((x, y) => x - y);
      expect(dimensions).toHaveLength(2);
      expect(dimensions[1] - dimensions[0]).toBeCloseTo(750, 6);
      // 원본 LINE은 그대로 있고 화살표 3개만 늘어난다
      expect(entityCount(result.dxfText, 'LINE') - entityCount(original, 'LINE')).toBe(3);
      expect(result.warnings).toEqual([]);
    });

    it('사진 줄은 사진번호 레이어·색 2로 나가고 레이어가 없으면 더해진다', async () => {
      const result = exportDamagesToDxf(await template(), [wide('a', 2000, ['12', '13'])]);
      expect(layerNames(parseDxf(result.dxfText))).toContain('사진번호');
      const photo = texts(result.dxfText).find((t) => t.value === '#12, #13')!;
      expect(photo.layer).toBe('사진번호');
      expect(photo.color).toBe(2);
      // 다른 줄은 그대로 신규손상이다
      expect(texts(result.dxfText).find((t) => t.value === '박락')!.layer).toBe('신규손상');
    });

    it('사진이 없는 도면에도 사진번호 레이어는 만들어 둔다 (같은 도면이 두 번 다르게 나오지 않게)', async () => {
      const result = exportDamagesToDxf(await template(), [wide('a', 2000)]);
      expect(layerNames(parseDxf(result.dxfText))).toContain('사진번호');
    });
  });

  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 5·6장
  describe('망도틀별 번호와 표', () => {
    // 왼쪽 틀(원본, x 2000~4280)과 오른쪽 틀(x 51000~53280)이 있는 도면.
    async function twoFrames(): Promise<string> {
      return withSecondFrame(await template(), 50000);
    }

    const IN_LEFT: Pt[] = [[2100, 3200], [3100, 3200], [3100, 3300], [2100, 3300]];
    const IN_RIGHT: Pt[] = [[51100, 3200], [52100, 3200], [52100, 3300], [51100, 3300]];

    function texts(dxfText: string) {
      const doc = parseDxf(dxfText);
      const out: Array<{ value: string; x: number; y: number }> = [];
      for (let i = 0; i < doc.pairs.length; i++) {
        if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'TEXT') continue;
        const entry = { value: '', x: 0, y: 0 };
        let j = i + 1;
        for (; j < doc.pairs.length && doc.pairs[j].code !== 0; j++) {
          const p = doc.pairs[j];
          if (p.code === 1) entry.value = p.value;
          else if (p.code === 11) entry.x = Number(p.value);
          else if (p.code === 21) entry.y = Number(p.value);
        }
        out.push(entry);
        i = j - 1;
      }
      return out;
    }

    // 주의: '박락'·'1.2x1.5' 같은 글자는 **라벨에도 표에도** 나온다. 표 칸만 가리려면 라벨에
    // 없는 값을 봐야 한다 — 단위 칸('㎡'·'m')과 물량 칸이 그렇다. 개소도 1로 두면 번호 원의
    // '1'과 구별되지 않으므로 2 이상으로 둔다.
    it('틀마다 1번부터 매기고 자기 틀의 표에만 값을 넣는다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [
        damage('l', 'spalling', 0, IN_LEFT, { width: 1.2, length: 1.5, count: 2 }),
        damage('r', 'crack', 500, IN_RIGHT, { width: 0.2, length: 1.5, count: 2 }),
      ]);
      expect(result.warnings).toEqual([]);

      const all = texts(result.dxfText);
      // 번호 원 글자는 둘 다 '1'이다 — 표의 번호 칸은 원본에 인쇄돼 있어 우리가 쓰지 않는다.
      expect(all.filter((t) => t.value === '1')).toHaveLength(2);

      // 왼쪽 틀의 표: 데이터 1행 7열(단위) 중앙 → 모델 (4170, 3260)
      //   7열 중앙 로컬 x = (1030+1140)/2 = 1085 → 1000 + 2*(500+1085) = 4170
      //   데이터 1행 중앙 로컬 y = -70 → 2000 + 2*(700-70) = 3260
      const left = all.find((t) => t.value === '㎡')!;
      expect(left.x).toBeCloseTo(4170, 6);
      expect(left.y).toBeCloseTo(3260, 6);
      // 오른쪽 틀의 표: 같은 칸이 삽입점만 49000 오른쪽 → (53170, 3260)
      const right = all.find((t) => t.value === 'm')!;
      expect(right.x).toBeCloseTo(53170, 6);
      expect(right.y).toBeCloseTo(3260, 6);
    });

    it('손상이 없는 틀의 표는 건드리지 않는다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [
        damage('l', 'spalling', 0, IN_LEFT, { width: 1.2, length: 1.5, count: 2 }),
      ]);
      // 오른쪽 틀 표(x ≈ 51000~53300) 자리에는 글자가 하나도 생기지 않는다.
      expect(texts(result.dxfText).filter((t) => t.x > 40000)).toEqual([]);
    });

    it('틀 밖 손상은 번호 없이 그려지고 경고와 개수를 낸다', async () => {
      const result = exportDamagesToDxf(await template(), [
        damage('in', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 }),
        damage('out', 'spalling', 500, [[0, 0], [100, 0], [100, 100], [0, 100]], { width: 1, length: 1, count: 1 }),
      ]);
      expect(result.warnings).toEqual([EXPORT_WARNINGS.outsideFrames(1)]);
      expect(result.skipped).toBe(0);
      // 도형은 둘 다 그려지고, 번호 원은 틀 안 손상 하나에만 생긴다.
      expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(2);
      expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1);
      // 표에는 틀 안 손상만 들어간다 — 데이터 2행(y 3220)은 비어 있다.
      const ys = texts(result.dxfText).map((t) => t.y);
      expect(ys).toContain(3260);
      expect(ys).not.toContain(3220);
    });

    // 컨트롤러 판정 R1: dwg가 없어 건너뛴 손상은 skipped로 이미 알리므로 틀 밖 개수에 넣지 않는다.
    it('dwg가 없어 건너뛴 손상은 틀 밖 경고 개수에 들어가지 않는다', async () => {
      const result = exportDamagesToDxf(await template(), [
        damage('in', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 }),
        damage('out', 'spalling', 500, [[0, 0], [100, 0], [100, 100], [0, 100]], { width: 1, length: 1, count: 1 }),
        damage('nodwg', 'spalling', 900, null, { width: 1, length: 1, count: 1 }),
      ]);
      expect(result.skipped).toBe(1);
      expect(result.warnings).toEqual([EXPORT_WARNINGS.outsideFrames(1)]);
      // 건너뛴 손상은 도형도 없고, 틀이 있는 도면에서는 번호도 차지하지 않는다(빈 행 없음).
      expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(2);
      expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1);
    });

    it('경고 문구에 개수가 그대로 들어간다', () => {
      expect(EXPORT_WARNINGS.outsideFrames(3)).toBe('망도틀 밖 손상 3개는 번호 없이 그려지고 물량표에서 빠집니다');
    });

    it('틀이 없는 도면은 옛 동작 그대로다 — 전체 한 묶음 번호와 가장 가까운 표 하나', async () => {
      // 개소를 3으로 둬 개소 칸('3')이 번호 원의 '1'·'2'와 섞이지 않게 한다.
      const result = exportDamagesToDxf(flatTable(await template()), [
        damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 3 }),
        damage('b', 'spalling', 500, RECT_B, { width: 1.2, length: 1.5, count: 3 }),
      ]);
      expect(result.warnings).toEqual([]);
      const all = texts(result.dxfText);
      // 번호가 1, 2로 이어진다(틀마다 1부터가 아니다).
      expect(all.filter((t) => t.value === '1')).toHaveLength(1);
      expect(all.filter((t) => t.value === '2')).toHaveLength(1);
      // 표는 최상위에 배율·삽입점 없이 놓여 있다 — 단위 칸은 표 삽입점 (500, 700) 기준
      // 7열 중앙 1085, 데이터 1행 중앙 −70 → (1585, 630), 데이터 2행 중앙 −90 → (1585, 610)
      const units = all.filter((t) => t.value === '㎡');
      expect(units).toHaveLength(2);
      expect(units[0].x).toBeCloseTo(1585, 6);
      expect(units[0].y).toBeCloseTo(630, 6);
      expect(units[1].y).toBeCloseTo(610, 6);
    });
  });
});
