import { describe, expect, it } from 'vitest';
import { polylineLength } from '../public/viewer/geometry.js';
import { finalizeRect, finalizeStroke, MIN_RECT_PX, MIN_STROKE_PX, pickDamage } from '../public/viewer/crackTool.js';

type Pt = [number, number];

// 화면 10px = world 1, y축 반전. DWG = world + (1000, 2000)
const mapper = {
  clientToWorld: (x: number, y: number): Pt => [x / 10, -y / 10],
  worldToClient: ([x, y]: Pt): Pt => [x * 10, -y * 10],
  worldToDwg: ([x, y]: Pt): Pt => [x + 1000, y + 2000],
};

const options = { now: '2026-09-12T03:00:00.000Z', newId: () => 'new-id', typeId: 'crack' };
const areaOptions = { ...options, typeId: 'spalling' };

describe('finalizeStroke', () => {
  it('화면 길이가 10px 미만이면 버린다', () => {
    expect(MIN_STROKE_PX).toBe(10);
    expect(finalizeStroke([[0, 50], [9, 50]], mapper, options)).toBeNull();
    expect(finalizeStroke([[0, 50]], mapper, options)).toBeNull();
  });

  it('제자리에서 떨린 획은 단순화 후 길이가 10px 미만이면 버린다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i < 120; i++) stroke.push([100 + (i / 119) * 4, 100 + (i % 2 === 0 ? 0.3 : -0.3)]);
    expect(polylineLength(stroke)).toBeGreaterThan(MIN_STROKE_PX);
    expect(finalizeStroke(stroke, mapper, options)).toBeNull();
  });

  it('선형 손상을 v2 형태로 만든다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    expect(finalizeStroke(stroke, mapper, options)).toEqual({
      id: 'new-id',
      type: 'crack',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, -5], [10, -5]], dwg: [[1000, 1995], [1010, 1995]] },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: 10, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    });
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeStroke([[0, 50], [100, 50]], noDwg, options);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });

  it('면형 유형으로는 만들지 않는다', () => {
    expect(finalizeStroke([[0, 50], [100, 50]], mapper, areaOptions)).toBeNull();
  });
});

describe('finalizeRect', () => {
  it('드래그한 두 점으로 네 꼭짓점 사각형을 만든다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, areaOptions)).toEqual({
      id: 'new-id',
      type: 'spalling',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, -1], [0, -1]],
        dwg: [[1000, 2000], [1002, 2000], [1002, 1999], [1000, 1999]],
      },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { widthMm: null, member: '', note: '' },
    });
  });

  it('너무 작은 사각형은 버린다', () => {
    expect(MIN_RECT_PX).toBe(10);
    expect(finalizeRect([0, 0], [9, 9], mapper, areaOptions)).toBeNull();
  });

  it('선형 유형으로는 만들지 않는다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, options)).toBeNull();
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeRect([0, 0], [20, 10], noDwg, areaOptions);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });
});

describe('pickDamage', () => {
  const line = {
    id: 'a',
    type: 'crack',
    geometry: { kind: 'polyline', world: [[0, -5], [10, -5]] as Pt[] },
  };
  const area = {
    id: 'b',
    type: 'spalling',
    geometry: { kind: 'rect', world: [[0, -10], [10, -10], [10, -20], [0, -20]] as Pt[] },
  };

  it('선형은 선 가까이를 누르면 선택된다', () => {
    expect(pickDamage([line, area], [50, 55], mapper)).toBe('a');
    expect(pickDamage([line, area], [50, 20], mapper)).toBeNull();
  });

  it('면형은 안쪽을 눌러도 선택된다', () => {
    expect(pickDamage([line, area], [50, 150], mapper)).toBe('b');
  });

  it('면형 테두리 근처도 선택된다', () => {
    expect(pickDamage([line, area], [50, 95], mapper)).toBe('b');
  });

  it('아무것도 없으면 null', () => {
    expect(pickDamage([], [0, 0], mapper)).toBeNull();
  });
});
