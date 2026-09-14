import { describe, expect, it } from 'vitest';
import {
  addDamage,
  canUndo,
  createEditor,
  createEmptyDoc,
  MAX_HISTORY,
  migrateDoc,
  removeDamage,
  SCHEMA_VERSION,
  undo,
  updateDamage,
  validateDamageDoc,
} from '../public/viewer/damageDoc.js';

const DRAWING = 'd_0123456789abcdef0123456789abcdef';
const T0 = '2026-09-13T00:00:00.000Z';
const T1 = '2026-09-13T00:00:01.000Z';
const T2 = '2026-09-13T00:00:02.000Z';

function lineDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'crack',
    createdAt: T0,
    geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
    measured: { width: 0.3, length: 5, count: 2 },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
    ...overrides,
  };
}

function areaDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'spalling',
    createdAt: T0,
    geometry: {
      kind: 'rect',
      world: [[0, 0], [2, 0], [2, 1], [0, 1]],
      dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
    },
    measured: { width: 1.2, length: 1.5, count: 1 },
    computed: { lengthDwg: null, areaDwg: 2 },
    attrs: { note: '', statusText: '', photoNumbers: [] },
    ...overrides,
  };
}

function docWith(damages: unknown[]) {
  return { ...createEmptyDoc(DRAWING, T0), damages };
}

describe('createEmptyDoc', () => {
  it('schemaVersion 4인 빈 문서를 만든다', () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(createEmptyDoc(DRAWING, T0)).toEqual({
      schemaVersion: 4,
      drawingId: DRAWING,
      updatedAt: T0,
      damages: [],
    });
  });
});

describe('validateDamageDoc', () => {
  it('빈 문서와 선형·면형 손상은 유효', () => {
    expect(validateDamageDoc(createEmptyDoc(DRAWING, T0), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a'), areaDamage('b')]), DRAWING)).toEqual([]);
  });

  it('문서 수준 오류를 알려준다', () => {
    expect(validateDamageDoc(null, DRAWING)).toEqual(['문서가 객체가 아닙니다.']);
    expect(
      validateDamageDoc({ schemaVersion: 2, drawingId: 'd_other', updatedAt: 'nope', damages: 'x' }, DRAWING),
    ).toEqual([
      'schemaVersion은 4이어야 합니다.',
      'drawingId가 주소와 다릅니다.',
      'updatedAt이 올바른 날짜가 아닙니다.',
      'damages는 배열이어야 합니다.',
    ]);
  });

  it('유형 목록에 없는 type을 거부한다', () => {
    const errors = validateDamageDoc(docWith([lineDamage('a', { type: 'nope' })]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });

  it('유형이 잘못돼도 날짜·속성 오류를 함께 알려준다', () => {
    const broken = lineDamage('a', {
      type: 'nope',
      createdAt: 3,
      attrs: { note: 3, statusText: '', photoNumbers: [] },
    });
    const errors = validateDamageDoc(docWith([broken]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
    expect(errors).toContain('damages[0].createdAt이 올바른 날짜가 아닙니다.');
    expect(errors).toContain('damages[0].attrs.note와 statusText는 문자열이어야 합니다.');
  });

  it('선형은 polyline 2점 이상, 면형은 rect 4점이어야 한다', () => {
    const wrongKind = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(wrongKind).toContain('damages[0].geometry.kind는 선형 손상이면 polyline이어야 합니다.');

    const shortRect = validateDamageDoc(
      docWith([
        areaDamage('a', {
          geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1]], dwg: null },
          computed: { lengthDwg: null, areaDwg: null },
        }),
      ]),
      DRAWING,
    );
    expect(shortRect).toContain('damages[0].geometry.world는 유효한 점 4개여야 합니다.');

    const shortLine = validateDamageDoc(
      docWith([
        lineDamage('a', {
          geometry: { kind: 'polyline', world: [[0, 0]], dwg: null },
          computed: { lengthDwg: null, areaDwg: null },
        }),
      ]),
      DRAWING,
    );
    expect(shortLine).toContain('damages[0].geometry.world는 유효한 점 2개 이상이어야 합니다.');
  });

  it('dwg는 world와 점 개수가 같아야 하고, 없으면 computed도 모두 null이어야 한다', () => {
    const mismatch = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: [[0, 0], [1, 1]] } })]),
      DRAWING,
    );
    expect(mismatch).toContain('damages[0].geometry.dwg는 world와 점 개수가 같아야 합니다.');

    const noDwg = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(noDwg).toEqual(['damages[0].computed는 dwg가 없으면 모두 null이어야 합니다.']);
  });

  it('가로·세로는 0 이상의 숫자, 개소는 0 이상의 정수이거나 null이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: null, length: null, count: null } })]), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 0, length: 0, count: 0 } })]), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: -1, length: 1, count: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.width는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: Infinity, count: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.length는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: 1, count: 1.5 } })]), DRAWING)).toContain(
      'damages[0].measured.count는 0 이상의 정수이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: 1, count: -2 } })]), DRAWING)).toContain(
      'damages[0].measured.count는 0 이상의 정수이거나 null이어야 합니다.',
    );
  });

  it('비고와 손상현황은 문자열이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: 3, statusText: '', photoNumbers: [] } })]), DRAWING)).toContain(
      'damages[0].attrs.note와 statusText는 문자열이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: null, photoNumbers: [] } })]), DRAWING)).toContain(
      'damages[0].attrs.note와 statusText는 문자열이어야 합니다.',
    );
  });

  it('손상현황은 기타 유형에서만 채울 수 있다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '메모', photoNumbers: [] } })]), DRAWING)).toContain(
      'damages[0].attrs.statusText는 기타 유형에서만 쓸 수 있습니다.',
    );
    const etc = areaDamage('a', { type: 'etc', attrs: { note: '', statusText: '표면 오염', photoNumbers: [] } });
    expect(validateDamageDoc(docWith([etc]), DRAWING)).toEqual([]);
  });

  // R13: note·statusText·photoNumbers의 줄바꿈은 DXF 산출의 TEXT 엔티티(코드 1은 한 줄)를
  // 깨뜨린다. 저장 전에 막는다.
  it('note에 줄바꿈이 있으면 오류', () => {
    expect(
      validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '줄1\n줄2', statusText: '', photoNumbers: [] } })]), DRAWING),
    ).toContain('damages[0].attrs.note와 statusText에는 줄바꿈을 쓸 수 없습니다.');
  });

  it('statusText(기타 유형)에 줄바꿈이 있으면 오류', () => {
    const etc = areaDamage('a', { type: 'etc', attrs: { note: '', statusText: '들뜸\n파손', photoNumbers: [] } });
    expect(validateDamageDoc(docWith([etc]), DRAWING)).toContain(
      'damages[0].attrs.note와 statusText에는 줄바꿈을 쓸 수 없습니다.',
    );
  });

  it('중복 id를 거부한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a'), areaDamage('a')]), DRAWING)).toEqual([
      'damages[1].id가 중복됩니다: a',
    ]);
  });

  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 9.4
  describe('attrs.photoNumbers', () => {
    it('배열이 아니면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: '12' } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.');
    });

    it('항목이 문자열이 아니면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: [12] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.');
    });

    it('항목에 앞뒤 공백이 있으면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: [' 12'] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.');
    });

    it('항목이 빈 문자열이면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: [''] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.');
    });

    it('중복 항목이 있으면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: ['12', '12'] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.');
    });

    it('항목에 줄바꿈(\\n)이 있으면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: ['1\n2'] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers 항목에는 줄바꿈을 쓸 수 없습니다.');
    });

    it('항목에 줄바꿈(\\r)이 있으면 오류', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: ['1\r2'] } })]), DRAWING),
      ).toContain('damages[0].attrs.photoNumbers 항목에는 줄바꿈을 쓸 수 없습니다.');
    });

    it('앞자리 0과 접두어가 있는 문자열은 유효하다', () => {
      expect(
        validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: ['012', 'P-013'] } })]), DRAWING),
      ).toEqual([]);
    });

    it('빈 배열은 유효하다', () => {
      expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '', photoNumbers: [] } })]), DRAWING)).toEqual([]);
    });
  });
});

describe('migrateDoc', () => {
  const v1Doc = {
    schemaVersion: 1,
    drawingId: DRAWING,
    updatedAt: T1,
    damages: [
      {
        id: 'old-1',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
        lengthDwg: 5,
      },
      {
        id: 'old-2',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [1, 0]], dwg: null },
        lengthDwg: null,
      },
    ],
  };

  const v2Doc = {
    schemaVersion: 2,
    drawingId: DRAWING,
    updatedAt: T1,
    damages: [
      {
        id: 'v2-crack',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
        measured: { lengthM: 1.5, areaM2: null },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { widthMm: 0.2, member: '', note: '재확인' },
      },
      {
        id: 'v2-area',
        type: 'spalling',
        createdAt: T0,
        geometry: {
          kind: 'rect',
          world: [[0, 0], [2, 0], [2, 1], [0, 1]],
          dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
        },
        measured: { lengthM: null, areaM2: 1.8 },
        computed: { lengthDwg: null, areaDwg: 2 },
        attrs: { widthMm: null, member: '기둥', note: '사진 있음' },
      },
    ],
  };

  const v3Doc = {
    schemaVersion: 3,
    drawingId: DRAWING,
    updatedAt: T2,
    damages: [lineDamage('v3-crack', { attrs: { note: '기존 비고', statusText: '' } })],
  };

  it('v2의 폭·길이를 v3 측정값으로 옮기고(photoNumbers는 빈 배열) 그 결과는 검증을 통과한다', () => {
    const migrated = migrateDoc(v2Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.drawingId).toBe(DRAWING);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'v2-crack',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { width: 0.2, length: 1.5, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '재확인', statusText: '', photoNumbers: [] },
    });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  // R13: note는 화면에서 한 줄짜리 입력이라 줄바꿈을 쓸 수 없다 — carriedNote는 옮겨 적을 값이
  // 여럿이면 줄바꿈 대신 ' / '로 이어 한 줄로 남긴다.
  it('면적과 부재명은 지어내지 않고 비고에 옮겨 적는다', () => {
    const migrated = migrateDoc(v2Doc, DRAWING);
    expect(migrated.damages[1].measured).toEqual({ width: null, length: null, count: null });
    expect(migrated.damages[1].attrs).toEqual({
      note: '이전 면적 입력값: 1.8㎡ / 부재명: 기둥 / 사진 있음',
      statusText: '',
      photoNumbers: [],
    });
  });

  it('비고가 비어 있으면 옮겨 적은 줄만 남는다', () => {
    const doc = {
      ...v2Doc,
      damages: [{ ...v2Doc.damages[1], attrs: { widthMm: null, member: '', note: '' } }],
    };
    expect(migrateDoc(doc, DRAWING).damages[0].attrs.note).toBe('이전 면적 입력값: 1.8㎡');
  });

  it('면형 유형인데 widthMm이 남아있는 v2 손상(손으로 고친 파일 등)은 폭 값을 mm 그대로 옮기지 않는다', () => {
    // R2: hadArea(=areaM2 존재 여부)로 판단하면 areaM2가 null인 손상된 v2 area 손상의
    // widthMm(mm)이 그대로 measured.width(m)로 새어 들어간다. 유형을 조회해 판단해야 한다.
    const corrupted = {
      ...v2Doc,
      damages: [
        {
          id: 'corrupted-area',
          type: 'spalling',
          createdAt: T0,
          geometry: {
            kind: 'rect',
            world: [[0, 0], [2, 0], [2, 1], [0, 1]],
            dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
          },
          measured: { lengthM: null, areaM2: null },
          computed: { lengthDwg: null, areaDwg: null },
          attrs: { widthMm: 5, member: '', note: '' },
        },
      ],
    };
    const migrated = migrateDoc(corrupted, DRAWING);
    expect(migrated.damages[0].measured.width).toBeNull();
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('유형이 사라져(삭제·이름바뀜) 길이가 measured로 못 들어가면 면적과 같은 방식으로 비고에 옮겨 적는다', () => {
    // carriedNote는 areaM2는 늘 옮기면서 lengthM은 옮기지 않아 비대칭이었다: isLineType이 아닌
    // 손상(면형이거나, 이 경우처럼 유형표에 없는 손상)의 lengthM은 measured.length 자리도 못 찾고
    // 비고에도 안 남아 그대로 사라졌다.
    const doc = {
      ...v2Doc,
      damages: [
        {
          id: 'renamed-type',
          type: 'no_such_type',
          createdAt: T0,
          geometry: { kind: 'polyline', world: [[0, 0], [1, 0]], dwg: null },
          measured: { lengthM: 12, areaM2: null },
          computed: { lengthDwg: null, areaDwg: null },
          attrs: { widthMm: null, member: '', note: '' },
        },
      ],
    };
    const migrated = migrateDoc(doc, DRAWING);
    expect(migrated.damages[0].measured).toEqual({ width: null, length: null, count: null });
    expect(migrated.damages[0].attrs).toEqual({ note: '이전 길이 입력값: 12m', statusText: '', photoNumbers: [] });
  });

  it('선형 유형은 길이가 measured.length로 제대로 들어가므로 비고에 이중으로 남지 않는다', () => {
    const migrated = migrateDoc(v2Doc, DRAWING);
    expect(migrated.damages[0].measured.length).toBe(1.5);
    expect(migrated.damages[0].attrs.note).toBe('재확인');
  });

  it('v1 문서는 v2·v3를 거쳐 v4까지 변환된다', () => {
    const migrated = migrateDoc(v1Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    });
    expect(migrated.damages[1].computed).toEqual({ lengthDwg: null, areaDwg: null });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 9.3
  it('v3 문서는 각 손상에 photoNumbers = []를 채워 v4로 변환되고, 다른 값은 그대로다', () => {
    const migrated = migrateDoc(v3Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.drawingId).toBe(DRAWING);
    expect(migrated.updatedAt).toBe(T2);
    expect(migrated.damages[0]).toEqual({
      ...lineDamage('v3-crack', { attrs: { note: '기존 비고', statusText: '' } }),
      attrs: { note: '기존 비고', statusText: '', photoNumbers: [] },
    });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('v3 → v4 변환은 입력 문서와 각 손상 객체를 바꾸지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(v3Doc));
    migrateDoc(v3Doc, DRAWING);
    expect(v3Doc).toEqual(snapshot);
  });

  it('이미 v4면 그대로 돌려준다', () => {
    const doc = docWith([areaDamage('a')]);
    expect(migrateDoc(doc, DRAWING)).toBe(doc);
  });

  it('객체가 아니면 null', () => {
    expect(migrateDoc(null, DRAWING)).toBeNull();
    expect(migrateDoc('x', DRAWING)).toBeNull();
  });

  it('v1·v2·v3 백업은 그대로 검증하면 거부되지만, migrateDoc 후에는 통과한다 (로컬 백업 복구 경로)', () => {
    // 뷰어는 로컬 백업을 서버 문서와 같은 방식으로 먼저 migrateDoc에 통과시킨 뒤 validateDamageDoc으로 검사해야 한다.
    // 예전 문서를 그대로 validateDamageDoc에 넘기면 schemaVersion 검사만으로 거부되어 백업이 버려진다.
    expect(validateDamageDoc(v1Doc, DRAWING).length).toBeGreaterThan(0);
    expect(validateDamageDoc(v2Doc, DRAWING).length).toBeGreaterThan(0);
    expect(validateDamageDoc(v3Doc, DRAWING).length).toBeGreaterThan(0);
    expect(validateDamageDoc(migrateDoc(v1Doc, DRAWING), DRAWING)).toEqual([]);
    expect(validateDamageDoc(migrateDoc(v2Doc, DRAWING), DRAWING)).toEqual([]);
    expect(validateDamageDoc(migrateDoc(v3Doc, DRAWING), DRAWING)).toEqual([]);
  });
});

describe('editor', () => {
  it('추가·삭제·undo가 문서와 updatedAt을 바꾼다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(canUndo(editor)).toBe(false);

    editor = addDamage(editor, areaDamage('a'), T1);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T1);

    editor = removeDamage(editor, 'a', T2);
    expect(editor.doc.damages).toEqual([]);

    editor = undo(editor, T2);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T2);
  });

  it('원본 editor를 변경하지 않고, 없는 id 삭제와 기록 없는 undo는 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    addDamage(editor, lineDamage('a'), T1);
    expect(editor.doc.damages).toEqual([]);
    expect(removeDamage(editor, 'nope', T1)).toBe(editor);
    expect(undo(editor, T1)).toBe(editor);
  });

  it('undo 기록은 최대 MAX_HISTORY개', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    for (let i = 0; i < MAX_HISTORY + 10; i++) editor = addDamage(editor, lineDamage(`c${i}`), T1);
    expect(editor.history.length).toBe(MAX_HISTORY);
  });

  it('updateDamage는 값을 병합하고 updatedAt을 올린다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    editor = addDamage(editor, areaDamage('a'), T1);

    editor = updateDamage(editor, 'a', { measured: { count: 3 }, attrs: { note: '확인 필요' } }, T2);

    expect(editor.doc.damages[0].measured).toEqual({ width: 1.2, length: 1.5, count: 3 });
    expect(editor.doc.damages[0].attrs).toEqual({ note: '확인 필요', statusText: '', photoNumbers: [] });
    expect(editor.doc.damages[0].geometry).toEqual(areaDamage('a').geometry);
    expect(editor.doc.updatedAt).toBe(T2);
    expect(canUndo(editor)).toBe(true);
  });

  // 근거: docs/superpowers/specs/2026-09-12-damage-types-design.md §4 "선택한 손상 이동" —
  // 이동은 measured(사용자가 입력한 물량)를 건드리지 않고 geometry·computed만 다시 계산한다.
  // main.js의 onTransform(move commit)은 changes에 measured 키를 아예 넣지 않는다 — updateDamage가
  // 없는 키는 병합에서 건드리지 않는지를 이 테스트로 고정해 둔다.
  it('updateDamage는 changes에 measured가 없으면 기존 measured를 그대로 둔다(이동 제스처와 같은 패턴)', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    editor = addDamage(editor, areaDamage('a'), T1);
    const before = editor.doc.damages[0].measured;

    editor = updateDamage(
      editor,
      'a',
      { geometry: { world: [[1, 1], [3, 1], [3, 2], [1, 2]] }, computed: { lengthDwg: null, areaDwg: 99 } },
      T2,
    );

    expect(editor.doc.damages[0].measured).toEqual(before);
    expect(editor.doc.damages[0].geometry.world).toEqual([[1, 1], [3, 1], [3, 2], [1, 2]]);
    expect(editor.doc.damages[0].computed.areaDwg).toBe(99);
  });

  it('updateDamage는 없는 id면 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(updateDamage(editor, 'nope', { measured: { count: 1 } }, T1)).toBe(editor);
  });
});
