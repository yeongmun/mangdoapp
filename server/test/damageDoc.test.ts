import { describe, expect, it } from 'vitest';
import {
  addDamage,
  canUndo,
  createEditor,
  createEmptyDoc,
  MAX_HISTORY,
  removeDamage,
  undo,
  validateDamageDoc,
} from '../public/viewer/damageDoc.js';

const DRAWING = 'd_0123456789abcdef0123456789abcdef';
const T0 = '2026-09-10T00:00:00.000Z';
const T1 = '2026-09-10T00:00:01.000Z';
const T2 = '2026-09-10T00:00:02.000Z';

function crack(id: string, dwg: boolean = true): any {
  return {
    id,
    type: 'crack' as const,
    createdAt: T0,
    geometry: {
      kind: 'polyline' as const,
      world: [[0, 0], [3, 4]],
      dwg: dwg ? [[100, 100], [103, 104]] : null,
    },
    lengthDwg: dwg ? 5 : null,
  };
}

describe('validateDamageDoc', () => {
  it('빈 문서와 정상 균열은 유효', () => {
    expect(validateDamageDoc(createEmptyDoc(DRAWING, T0), DRAWING)).toEqual([]);
    const doc = { ...createEmptyDoc(DRAWING, T0), damages: [crack('a'), crack('b', false)] };
    expect(validateDamageDoc(doc, DRAWING)).toEqual([]);
  });

  it('객체가 아니면 거부', () => {
    expect(validateDamageDoc(null, DRAWING)).toEqual(['문서가 객체가 아닙니다.']);
  });

  it('schemaVersion·drawingId·updatedAt·damages 오류를 알려준다', () => {
    const errors = validateDamageDoc(
      { schemaVersion: 2, drawingId: 'd_other', updatedAt: 'nope', damages: 'x' },
      DRAWING,
    );
    expect(errors).toEqual([
      'schemaVersion은 1이어야 합니다.',
      'drawingId가 주소와 다릅니다.',
      'updatedAt이 올바른 날짜가 아닙니다.',
      'damages는 배열이어야 합니다.',
    ]);
  });

  it('균열 필드 오류를 위치와 함께 알려준다', () => {
    const bad = {
      id: '',
      type: 'spall',
      createdAt: 3,
      geometry: { kind: 'area', world: [[0, 0]], dwg: [[1, 1], [2, 2]] },
      lengthDwg: 'x',
    };
    const errors = validateDamageDoc({ ...createEmptyDoc(DRAWING, T0), damages: [bad] }, DRAWING);
    expect(errors).toEqual([
      'damages[0].id가 비어 있습니다.',
      'damages[0].type은 crack이어야 합니다.',
      'damages[0].createdAt이 올바른 날짜가 아닙니다.',
      'damages[0].geometry.kind는 polyline이어야 합니다.',
      'damages[0].geometry.world는 유효한 점 2개 이상이어야 합니다.',
      'damages[0].geometry.dwg는 world와 점 개수가 같아야 합니다.',
      'damages[0].lengthDwg는 0 이상의 숫자여야 합니다.',
    ]);
  });

  it('숫자가 아닌 좌표와 NaN을 거부', () => {
    const bad = crack('a');
    bad.geometry.world = [[0, 0], [Number.NaN, 1]] as number[][];
    const errors = validateDamageDoc({ ...createEmptyDoc(DRAWING, T0), damages: [bad] }, DRAWING);
    expect(errors).toContain('damages[0].geometry.world는 유효한 점 2개 이상이어야 합니다.');
  });

  it('dwg가 null이면 lengthDwg도 null이어야 한다', () => {
    const bad = { ...crack('a', false), lengthDwg: 5 };
    const errors = validateDamageDoc({ ...createEmptyDoc(DRAWING, T0), damages: [bad] }, DRAWING);
    expect(errors).toEqual(['damages[0].lengthDwg는 dwg가 없으면 null이어야 합니다.']);
  });

  it('중복 id를 거부', () => {
    const doc = { ...createEmptyDoc(DRAWING, T0), damages: [crack('a'), crack('a')] };
    expect(validateDamageDoc(doc, DRAWING)).toEqual(['damages[1].id가 중복됩니다: a']);
  });
});

describe('editor', () => {
  it('추가·삭제·undo가 문서와 updatedAt을 바꾼다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(canUndo(editor)).toBe(false);

    editor = addDamage(editor, crack('a'), T1);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T1);
    expect(canUndo(editor)).toBe(true);

    editor = removeDamage(editor, 'a', T2);
    expect(editor.doc.damages).toEqual([]);

    editor = undo(editor, T2);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T2);

    editor = undo(editor, T2);
    expect(editor.doc.damages).toEqual([]);
    expect(canUndo(editor)).toBe(false);
  });

  it('원본 editor를 변경하지 않는다', () => {
    const original = createEditor(createEmptyDoc(DRAWING, T0));
    addDamage(original, crack('a'), T1);
    expect(original.doc.damages).toEqual([]);
    expect(original.history).toEqual([]);
  });

  it('없는 id 삭제와 기록 없는 undo는 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(removeDamage(editor, 'nope', T1)).toBe(editor);
    expect(undo(editor, T1)).toBe(editor);
  });

  it('undo 기록은 최대 MAX_HISTORY개', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    for (let i = 0; i < MAX_HISTORY + 10; i++) editor = addDamage(editor, crack(`c${i}`), T1);
    expect(editor.history.length).toBe(MAX_HISTORY);
  });
});
