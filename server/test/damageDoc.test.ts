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
  validateDamageDoc,
} from '../public/viewer/damageDoc.js';

const DRAWING = 'd_0123456789abcdef0123456789abcdef';
const T0 = '2026-09-12T00:00:00.000Z';
const T1 = '2026-09-12T00:00:01.000Z';
const T2 = '2026-09-12T00:00:02.000Z';

function lineDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'crack',
    createdAt: T0,
    geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
    measured: { lengthM: 5, areaM2: null },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { widthMm: 0.3, member: '거더 하부', note: '' },
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
    measured: { lengthM: null, areaM2: 1.8 },
    computed: { lengthDwg: null, areaDwg: 2 },
    attrs: { widthMm: null, member: '', note: '' },
    ...overrides,
  };
}

function docWith(damages: unknown[]) {
  return { ...createEmptyDoc(DRAWING, T0), damages };
}

describe('createEmptyDoc', () => {
  it('schemaVersion 2인 빈 문서를 만든다', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(createEmptyDoc(DRAWING, T0)).toEqual({
      schemaVersion: 2,
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
      validateDamageDoc({ schemaVersion: 1, drawingId: 'd_other', updatedAt: 'nope', damages: 'x' }, DRAWING),
    ).toEqual([
      'schemaVersion은 2이어야 합니다.',
      'drawingId가 주소와 다릅니다.',
      'updatedAt이 올바른 날짜가 아닙니다.',
      'damages는 배열이어야 합니다.',
    ]);
  });

  it('유형 목록에 없는 type을 거부한다', () => {
    const errors = validateDamageDoc(docWith([lineDamage('a', { type: 'nope' })]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });

  it('선형은 polyline 2점 이상, 면형은 rect 4점이어야 한다', () => {
    const wrongKind = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(wrongKind).toContain('damages[0].geometry.kind는 선형 손상이면 polyline이어야 합니다.');

    const shortRect = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1]], dwg: null }, computed: { lengthDwg: null, areaDwg: null } })]),
      DRAWING,
    );
    expect(shortRect).toContain('damages[0].geometry.world는 유효한 점 4개여야 합니다.');

    const shortLine = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'polyline', world: [[0, 0]], dwg: null }, computed: { lengthDwg: null, areaDwg: null } })]),
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

  it('물량은 유형의 단위 쪽만 채울 수 있고 0 이상이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: null, areaM2: 2 } })]), DRAWING)).toContain(
      'damages[0].measured.areaM2는 선형 손상에서 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([areaDamage('a', { measured: { lengthM: 3, areaM2: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.lengthM은 면형 손상에서 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: -1, areaM2: null } })]), DRAWING)).toContain(
      'damages[0].measured.lengthM은 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: null, areaM2: null } })]), DRAWING)).toEqual([]);
  });

  it('속성 값 형식을 확인한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { widthMm: -2, member: '', note: '' } })]), DRAWING)).toContain(
      'damages[0].attrs.widthMm는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { widthMm: null, member: 3, note: '' } })]), DRAWING)).toContain(
      'damages[0].attrs.member와 note는 문자열이어야 합니다.',
    );
  });

  it('중복 id를 거부한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a'), areaDamage('a')]), DRAWING)).toEqual([
      'damages[1].id가 중복됩니다: a',
    ]);
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

  it('v1 문서를 v2로 바꾸고 그 결과는 검증을 통과한다', () => {
    const migrated = migrateDoc(v1Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    });
    expect(migrated.damages[1].computed).toEqual({ lengthDwg: null, areaDwg: null });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('이미 v2면 그대로 돌려준다', () => {
    const doc = docWith([areaDamage('a')]);
    expect(migrateDoc(doc, DRAWING)).toBe(doc);
  });

  it('객체가 아니면 null', () => {
    expect(migrateDoc(null, DRAWING)).toBeNull();
    expect(migrateDoc('x', DRAWING)).toBeNull();
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
});
