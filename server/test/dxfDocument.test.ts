import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createHandleAllocator,
  DAMAGE_LAYER,
  ensureLayer,
  findSection,
  findTable,
  formatInt,
  formatReal,
  HandleAllocator,
  headerValue,
  insertEntities,
  layerNames,
  pair,
  parseDxf,
  recordHandle,
  serializeDxf,
  setHeaderValue,
  type DxfPair,
} from '../src/export/dxfDocument.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function templateText(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

describe('parseDxf / serializeDxf', () => {
  it('쌍으로 나누고 원래 글자 그대로 되돌린다 (LF)', async () => {
    const text = await templateText();
    const doc = parseDxf(text);
    expect(doc.eol).toBe('\n');
    expect(doc.pairs[0]).toMatchObject({ code: 0, value: 'SECTION' });
    expect(doc.pairs[1]).toMatchObject({ code: 2, value: 'HEADER' });
    expect(serializeDxf(doc)).toBe(text);
  });

  it('CRLF 파일도 CRLF 그대로 되돌린다', async () => {
    const text = (await templateText()).replace(/\n/g, '\r\n');
    const doc = parseDxf(text);
    expect(doc.eol).toBe('\r\n');
    expect(serializeDxf(doc)).toBe(text);
  });

  it('빈 값 줄도 잃지 않는다', () => {
    const doc = parseDxf('  1\n\n  0\nEOF\n');
    expect(doc.pairs).toHaveLength(2);
    expect(doc.pairs[0].value).toBe('');
    expect(serializeDxf(doc)).toBe('  1\n\n  0\nEOF\n');
  });

  it('줄 수가 홀수면 던진다', () => {
    expect(() => parseDxf('  0\nSECTION\n  2\n')).toThrow(/짝이 맞지 않습니다/);
  });

  it('코드가 숫자가 아니면 던진다', () => {
    expect(() => parseDxf('abc\nSECTION\n')).toThrow(/코드가 숫자가 아닙니다/);
  });

  // R6: 파일에 \r\n이 하나라도 있으면 전체를 CRLF로 본다. 원래 LF였던 줄도 다시 쓰면
  // CRLF로 바뀐다(원본 바이트가 바뀌지만 캐드는 그래도 연다) — 현재 동작을 고정해 둔다.
  it('섞인 줄바꿈은 하나로 통일된다 (현재 동작을 고정)', () => {
    const mixed = '  0\nSECTION\n  2\r\nHEADER\n  0\nENDSEC\n';
    const doc = parseDxf(mixed);
    expect(doc.eol).toBe('\r\n');
    expect(serializeDxf(doc)).toBe('  0\r\nSECTION\r\n  2\r\nHEADER\r\n  0\r\nENDSEC\r\n');
  });
});

describe('formatReal / formatInt', () => {
  it('정수도 소수점을 붙인다', () => {
    expect(formatReal(1)).toBe('1.0');
    expect(formatReal(0)).toBe('0.0');
    expect(formatReal(-0)).toBe('0.0');
    expect(formatReal(-12)).toBe('-12.0');
  });

  it('소수는 그대로 쓴다', () => {
    expect(formatReal(1140.5)).toBe('1140.5');
    expect(formatReal(-112.2532015133644)).toBe('-112.2532015133644');
  });

  it('유한하지 않으면 던진다', () => {
    expect(() => formatReal(Number.NaN)).toThrow(/쓸 수 없는 숫자/);
    expect(() => formatReal(Number.POSITIVE_INFINITY)).toThrow(/쓸 수 없는 숫자/);
  });

  it('정수는 버림해서 쓴다', () => {
    expect(formatInt(5)).toBe('5');
    expect(formatInt(5.9)).toBe('5');
    expect(formatInt(-5.9)).toBe('-5');
  });
});

describe('구역과 표 찾기', () => {
  it('ENTITIES 구역의 시작과 ENDSEC을 찾는다', async () => {
    const doc = parseDxf(await templateText());
    const range = findSection(doc, 'ENTITIES');
    expect(range).not.toBeNull();
    expect(doc.pairs[range!.start]).toMatchObject({ code: 0, value: 'SECTION' });
    expect(doc.pairs[range!.start + 1]).toMatchObject({ code: 2, value: 'ENTITIES' });
    expect(doc.pairs[range!.end]).toMatchObject({ code: 0, value: 'ENDSEC' });
    const types = doc.pairs.slice(range!.start, range!.end).filter((p) => p.code === 0).map((p) => p.value);
    expect(types).toEqual(['SECTION', 'INSERT', 'LINE']);
  });

  it('없는 구역은 null', async () => {
    const doc = parseDxf(await templateText());
    expect(findSection(doc, 'OBJECTS')).toBeNull();
  });

  it('LAYER 표의 ENDTAB을 찾는다', async () => {
    const doc = parseDxf(await templateText());
    const range = findTable(doc, 'LAYER');
    expect(range).not.toBeNull();
    expect(doc.pairs[range!.end]).toMatchObject({ code: 0, value: 'ENDTAB' });
  });
});

describe('HEADER 값', () => {
  it('읽는다', async () => {
    const doc = parseDxf(await templateText());
    expect(headerValue(doc, '$HANDSEED')).toBe('200');
    expect(headerValue(doc, '$INSUNITS')).toBe('     1');
    expect(headerValue(doc, '$ACADVER')).toBe('AC1032');
    expect(headerValue(doc, '$NOPE')).toBeNull();
  });

  it('고쳐 쓴다', async () => {
    const doc = parseDxf(await templateText());
    expect(setHeaderValue(doc, '$HANDSEED', '2FF')).toBe(true);
    expect(headerValue(doc, '$HANDSEED')).toBe('2FF');
    expect(serializeDxf(doc)).toContain('$HANDSEED\n  5\n2FF\n');
  });

  it('없는 값은 false', async () => {
    const doc = parseDxf(await templateText());
    expect(setHeaderValue(doc, '$NOPE', 'x')).toBe(false);
  });
});

describe('표 레코드 핸들', () => {
  it('블록 레코드 핸들을 이름으로 찾는다', async () => {
    const doc = parseDxf(await templateText());
    expect(recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')).toBe('1F');
    expect(recordHandle(doc, 'BLOCK_RECORD', '망도틀')).toBe('30');
    expect(recordHandle(doc, 'BLOCK_RECORD', '없는블록')).toBeNull();
  });
});

describe('HandleAllocator', () => {
  it('16진 대문자로 1씩 올린다', () => {
    const alloc = new HandleAllocator(0x1fe);
    expect(alloc.next()).toBe('1FE');
    expect(alloc.next()).toBe('1FF');
    expect(alloc.next()).toBe('200');
    expect(alloc.seed).toBe('201');
  });

  it('$HANDSEED와 파일 안 최대 핸들 중 큰 값에서 시작한다', async () => {
    const doc = parseDxf(await templateText());
    // 픽스처의 $HANDSEED는 200이고 실제 최대 핸들은 81이다 → 200부터
    expect(createHandleAllocator(doc).next()).toBe('200');

    const bumped = parseDxf((await templateText()).replace('$HANDSEED\n  5\n200\n', '$HANDSEED\n  5\n10\n'));
    // $HANDSEED가 최대 핸들보다 작으면 최대 핸들 + 1에서 시작한다
    expect(createHandleAllocator(bumped).next()).toBe('82');
  });

  // R16(미룬 항목): parseInt는 '12G4' 같은 잘못된 16진 문자열을 '12'까지만 읽어 부분 파싱한다.
  // 엄격한 정규식 검사로 바꿔 이런 값은 통째로 무시해야 한다.
  function docWithHandle(handle: string, handseed = '1'): string {
    return [
      '  0', 'SECTION', '  2', 'HEADER',
      '  9', '$HANDSEED', '  5', handseed,
      '  0', 'ENDSEC',
      '  0', 'SECTION', '  2', 'ENTITIES',
      '  0', 'LINE', '  5', handle,
      '  0', 'ENDSEC',
      '  0', 'EOF',
    ].join('\n') + '\n';
  }

  it('소문자 핸들도 16진수로 읽는다 (abc → 0xABC)', () => {
    const doc = parseDxf(docWithHandle('abc', '1'));
    expect(createHandleAllocator(doc).next()).toBe('ABD');
  });

  it('앞자리 0이 있는 핸들도 16진수로 읽는다 (00A1 → 0xA1)', () => {
    const doc = parseDxf(docWithHandle('00A1', '1'));
    expect(createHandleAllocator(doc).next()).toBe('A2');
  });

  it('잘못된 16진 핸들은 부분 파싱하지 않고 통째로 무시한다', () => {
    // 옛 parseInt였다면 '12G4'를 '12'(0x12=18)까지 읽어 최댓값이 올라갔을 것이다.
    // 엄격 검사에서는 이 핸들이 무시되어 $HANDSEED(5)에서 그대로 시작한다.
    const doc = parseDxf(docWithHandle('12G4', '5'));
    expect(createHandleAllocator(doc).next()).toBe('5');
  });
});

describe('insertEntities', () => {
  it('ENTITIES의 ENDSEC 바로 앞에 넣는다', async () => {
    const doc = parseDxf(await templateText());
    insertEntities(doc, [pair(0, 'CIRCLE'), pair(5, '200'), pair(8, DAMAGE_LAYER)]);

    const range = findSection(doc, 'ENTITIES')!;
    const types = doc.pairs.slice(range.start, range.end).filter((p) => p.code === 0).map((p) => p.value);
    expect(types).toEqual(['SECTION', 'INSERT', 'LINE', 'CIRCLE']);
    expect(doc.pairs[range.end - 1]).toMatchObject({ code: 8, value: DAMAGE_LAYER });
    expect(serializeDxf(doc)).toContain('  0\nCIRCLE\n  5\n200\n  8\n신규손상\n  0\nENDSEC\n');
  });

  it('ENTITIES 구역이 없으면 던진다', () => {
    const doc = parseDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n');
    expect(() => insertEntities(doc, [pair(0, 'CIRCLE')])).toThrow(/ENTITIES 구역/);
  });

  // R14: splice(i, 0, ...pairs)의 인자 전개는 pairs가 수만 개면 콜스택 상한에 걸려
  // "Maximum call stack size exceeded"로 던진다(실측 n=450 부근). 균열/백태 하나가 원
  // 1,000개(≈11,000쌍)를 낼 수 있어 손상 수십 개로도 도달한다.
  it('아주 큰 배열도 인자 전개 없이 끼워 넣고 다시 읽힌다', async () => {
    const doc = parseDxf(await templateText());
    const many: DxfPair[] = [];
    for (let i = 0; i < 100_000; i++) {
      many.push(pair(0, 'POINT'), pair(10, '0.0'));
    }
    expect(() => insertEntities(doc, many)).not.toThrow();

    const range = findSection(doc, 'ENTITIES')!;
    const count = doc.pairs.slice(range.start, range.end).filter((p) => p.code === 0 && p.value === 'POINT').length;
    expect(count).toBe(100_000);
    expect(doc.pairs.length).toBeGreaterThanOrEqual(200_000);
    expect(() => parseDxf(serializeDxf(doc))).not.toThrow();
  });
});

describe('ensureLayer', () => {
  it('없으면 LAYER 표의 ENDTAB 앞에 추가한다', async () => {
    const doc = parseDxf(await templateText());
    expect(layerNames(doc)).toEqual(['0']);

    ensureLayer(doc, createHandleAllocator(doc), DAMAGE_LAYER, 1);

    expect(layerNames(doc)).toEqual(['0', DAMAGE_LAYER]);
    const out = serializeDxf(doc);
    expect(out).toContain('  0\nLAYER\n  5\n200\n330\n2\n');
    expect(out).toContain('  2\n신규손상\n 70\n     0\n 62\n     1\n  6\nContinuous\n');
    // 표의 항목 수(코드 70)는 손대지 않는다
    expect(out).toContain('AcDbSymbolTable\n 70\n     1\n');
  });

  it('이미 있으면 아무것도 하지 않는다', async () => {
    const doc = parseDxf(await templateText());
    ensureLayer(doc, createHandleAllocator(doc), '0', 1);
    expect(layerNames(doc)).toEqual(['0']);
    expect(serializeDxf(doc)).toBe(await templateText());
  });
});
