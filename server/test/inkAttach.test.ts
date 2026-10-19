import { describe, expect, it } from 'vitest';
import { pendingInkDamages } from '../public/viewer/inkAttach.js';

describe('pendingInkDamages', () => {
  it('획은 있고 text가 없는 손상만', () => {
    const a = { id: 'a', attrs: { handwriting: { strokes: [[[0, 0]]] } } };
    const b = { id: 'b', attrs: { handwriting: { strokes: [[[0, 0]]], text: '0.2' } } };
    const c = { id: 'c', attrs: {} };
    expect(pendingInkDamages([a, b, c]).map((d) => d.id)).toEqual(['a']);
  });
});
