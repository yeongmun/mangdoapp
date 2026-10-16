import { describe, expect, it } from 'vitest';
import { chooseTarget, nearestDamage, pendingInkDamages, shapeDistance } from '../public/viewer/inkAttach.js';

const shapesOf = (d: { geometry: { dwg: number[][] } }) => [{ dwg: d.geometry.dwg }];
const crack = { id: 'c', geometry: { kind: 'polyline', dwg: [[0, 0], [100, 0]] }, attrs: {} };
const rect = { id: 'r', geometry: { kind: 'rect', dwg: [[300, 0], [400, 0], [400, 50], [300, 50]] }, attrs: {} };
const damages = [crack, rect];
const opts = { damages, shapesOf, maxDistance: 80, groupGapMs: 2500, groupGapDwg: 30 };

describe('shapeDistance / nearestDamage', () => {
  it('선은 가장 가까운 변까지, 네모는 둘레까지', () => {
    expect(shapeDistance([50, 10], [[0, 0], [100, 0]], false)).toBe(10);
    expect(shapeDistance([350, 25], rect.geometry.dwg, true)).toBe(25); // 안쪽 점도 둘레까지
    expect(shapeDistance([150, 0], [[0, 0], [100, 0]], false)).toBe(50);
  });
  it('획 중심에서 가장 가까운 손상', () => {
    expect(nearestDamage([[40, 20], [60, 30]], damages, shapesOf)).toEqual({ id: 'c', distance: 25 });
    expect(nearestDamage([[390, 70], [410, 80]], damages, shapesOf)).toEqual({ id: 'r', distance: 25 });
    expect(nearestDamage([], damages, shapesOf)).toBeNull();
  });
});

describe('chooseTarget', () => {
  it('가까운 손상에 붙고, 너무 멀면 null', () => {
    expect(chooseTarget({ ...opts, strokeDwg: [[40, 20], [60, 30]], previous: null, now: 0 })).toEqual({ damageId: 'c', reason: 'nearest' });
    expect(chooseTarget({ ...opts, strokeDwg: [[200, 500], [210, 510]], previous: null, now: 0 })).toBeNull();
  });
  it('바로 전 획 옆에 이어 쓰면 더 가까운 손상이 따로 있어도 같은 손상에 붙는다', () => {
    const previous = { damageId: 'c', at: 1000, bounds: { minX: 240, minY: 20, maxX: 270, maxY: 40 } };
    // 이 획은 r(둘레까지 ~30)에 더 가깝지만 전 획에서 10 떨어져 있고 1초 뒤다
    const next = chooseTarget({ ...opts, strokeDwg: [[280, 20], [295, 40]], previous, now: 2000 });
    expect(next).toEqual({ damageId: 'c', reason: 'group' });
    // 시간이 많이 지났으면 가까운 쪽
    expect(chooseTarget({ ...opts, strokeDwg: [[280, 20], [295, 40]], previous, now: 9000 })).toEqual({ damageId: 'r', reason: 'nearest' });
    // 전 획의 손상이 지워졌으면 가까운 쪽
    expect(chooseTarget({ ...opts, damages: [rect], strokeDwg: [[280, 20], [295, 40]], previous, now: 2000 })).toEqual({ damageId: 'r', reason: 'nearest' });
  });
});

describe('pendingInkDamages', () => {
  it('획은 있고 text가 없는 손상만', () => {
    const a = { id: 'a', attrs: { handwriting: { strokes: [[[0, 0]]] } } };
    const b = { id: 'b', attrs: { handwriting: { strokes: [[[0, 0]]], text: '0.2' } } };
    const c = { id: 'c', attrs: {} };
    expect(pendingInkDamages([a, b, c]).map((d) => d.id)).toEqual(['a']);
  });
});
