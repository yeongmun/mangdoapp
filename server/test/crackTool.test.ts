import { describe, expect, it } from 'vitest';
import { finalizeStroke, MIN_STROKE_PX, pickDamage } from '../public/viewer/crackTool.js';

type Pt = [number, number];

// 화면 10px = world 1, y축 반전. DWG = world + (1000, 2000)
const mapper = {
  clientToWorld: (x: number, y: number): Pt => [x / 10, -y / 10],
  worldToClient: ([x, y]: Pt): Pt => [x * 10, -y * 10],
  worldToDwg: ([x, y]: Pt): Pt => [x + 1000, y + 2000],
};

const options = { now: '2026-09-10T03:00:00.000Z', newId: () => 'new-id' };

describe('finalizeStroke', () => {
  it('화면 길이가 10px 미만이면 버린다', () => {
    expect(MIN_STROKE_PX).toBe(10);
    expect(finalizeStroke([[0, 50], [9, 50]], mapper, options)).toBeNull();
    expect(finalizeStroke([[0, 50]], mapper, options)).toBeNull();
  });

  it('흔들린 직선은 양 끝점만 남기고 world·dwg·길이를 채운다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    expect(finalizeStroke(stroke, mapper, options)).toEqual({
      id: 'new-id',
      type: 'crack',
      createdAt: '2026-09-10T03:00:00.000Z',
      geometry: {
        kind: 'polyline',
        world: [[0, -5], [10, -5]],
        dwg: [[1000, 1995], [1010, 1995]],
      },
      lengthDwg: 10,
    });
  });

  it('화면 좌표를 world로 못 바꾸면 버린다', () => {
    const noWorld = { ...mapper, clientToWorld: () => null };
    expect(finalizeStroke([[0, 50], [100, 50]], noWorld, options)).toBeNull();
  });

  it('DWG 변환이 불가하면 dwg와 lengthDwg는 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeStroke([[0, 50], [100, 50]], noDwg, options);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.lengthDwg).toBeNull();
    expect(damage?.geometry.world).toEqual([[0, -5], [10, -5]]);
  });
});

describe('pickDamage', () => {
  const damages = [
    { id: 'a', geometry: { world: [[0, -5], [10, -5]] as Pt[] } },
    { id: 'b', geometry: { world: [[0, -8], [10, -8]] as Pt[] } },
  ];

  it('반경 12px 안에서 가장 가까운 균열을 고른다', () => {
    expect(pickDamage(damages, [50, 55], mapper)).toBe('a');
    expect(pickDamage(damages, [50, 72], mapper)).toBe('b');
  });

  it('반경 밖이면 null', () => {
    expect(pickDamage(damages, [50, 20], mapper)).toBeNull();
    expect(pickDamage([], [0, 0], mapper)).toBeNull();
  });
});
