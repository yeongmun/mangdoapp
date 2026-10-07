import { describe, expect, it } from 'vitest';
import type { FrameBounds } from '../src/export/frames.js';
import { buildDrawingLedger, frameLocationsFor } from '../src/ledger.js';

// 왼쪽 틀(x 0~1000)과 오른쪽 틀(x 2000~3000).
const FRAMES: FrameBounds[] = [
  { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  { minX: 2000, minY: 0, maxX: 3000, maxY: 1000 },
];

function damage(id: string, type: string, dwg: [number, number][], measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id,
    type,
    createdAt: '2026-10-07T00:00:00.000Z',
    geometry: { kind: type === 'crack' ? 'polyline' : 'rect', world: dwg, dwg },
    copies: [],
    measured: { width: null, length: null, count: null, ...measured },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}

const RECT_LEFT: [number, number][] = [[100, 100], [200, 100], [200, 200], [100, 200]];
const RECT_LEFT_2: [number, number][] = [[500, 100], [600, 100], [600, 200], [500, 200]];
const RECT_RIGHT: [number, number][] = [[2100, 100], [2200, 100], [2200, 200], [2100, 200]];
const OUTSIDE: [number, number][] = [[1500, 100], [1600, 100], [1600, 200], [1500, 200]];

describe('frameLocationsFor', () => {
  it('틀 수에 맞춰 빈 칸은 ""로 채우고 넘치는 값은 버린다', () => {
    expect(frameLocationsFor(FRAMES, ['교대', ' 거더 ', '남는값'])).toEqual(['교대', '거더']);
    expect(frameLocationsFor(FRAMES, ['교대'])).toEqual(['교대', '']);
    expect(frameLocationsFor(FRAMES, undefined)).toEqual(['', '']);
    expect(frameLocationsFor(FRAMES, 'x')).toEqual(['', '']);
  });
});

describe('buildDrawingLedger', () => {
  it('번호는 틀마다 1부터, 위치는 틀의 frameLocations, 손상현황·물량·단위는 화면과 같은 규칙', () => {
    const ledger = buildDrawingLedger(
      { id: 'd_1', name: '교량.dxf', frameLocations: ['교대', '거더'] },
      [
        damage('b', 'spalling', RECT_LEFT_2, { width: 0.5, length: 2, count: 3 }, { photoNumbers: ['101530'], note: '동측' }),
        damage('a', 'crack', [[100, 100], [300, 100]], { width: 0.2, length: 5, count: 1 }),
        damage('c', 'crack', [[2100, 100], [2300, 100]], { width: 0.4, length: 1.5, count: 2 }),
      ],
      FRAMES,
    );

    expect(ledger.drawingId).toBe('d_1');
    expect(ledger.frameLocations).toEqual(['교대', '거더']);
    expect(ledger.outsideFrames).toBe(0);
    expect(ledger.rows.map((r) => [r.frameIndex, r.no, r.damageId, r.location])).toEqual([
      [0, 1, 'a', '교대'],
      [0, 2, 'b', '교대'],
      [1, 1, 'c', '거더'],
    ]);

    const [a, b, c] = ledger.rows;
    expect(a).toMatchObject({ statusText: '균열(0.3mm미만)', widthUnit: 'mm', width: 0.2, length: 5, count: 1, quantity: 5, unit: 'm' });
    expect(b).toMatchObject({ statusText: '박락', widthUnit: 'm', quantity: 3, unit: '㎡', photoNumbers: ['101530'], note: '동측' });
    expect(c).toMatchObject({ statusText: '균열(0.3mm이상)', quantity: 3, unit: 'm' });
  });

  it('틀 밖 손상은 번호·위치 없이 맨 뒤에 오고 outsideFrames에 센다', () => {
    const ledger = buildDrawingLedger(
      { id: 'd_1', name: '교량.dxf', frameLocations: ['교대', '거더'] },
      [damage('x', 'spalling', OUTSIDE, { width: 1, length: 1, count: 1 }), damage('r', 'spalling', RECT_RIGHT, { width: 1, length: 1, count: 1 })],
      FRAMES,
    );
    expect(ledger.outsideFrames).toBe(1);
    expect(ledger.rows.map((r) => [r.damageId, r.frameIndex, r.no, r.location])).toEqual([
      ['r', 1, 1, '거더'],
      ['x', null, null, ''],
    ]);
  });

  it('틀이 없는 도면은 전체가 0번 틀이고 번호는 1부터 이어진다', () => {
    const ledger = buildDrawingLedger(
      { id: 'd_1', name: '교량.dwg' },
      [damage('p', 'spalling', RECT_LEFT, { width: 1, length: 1, count: 1 }), damage('q', 'spalling', RECT_RIGHT, { width: 1, length: 1, count: 1 })],
      [],
    );
    expect(ledger.frameLocations).toEqual([]);
    expect(ledger.rows.map((r) => [r.damageId, r.frameIndex, r.no, r.location])).toEqual([
      ['p', 0, 1, ''],
      ['q', 0, 2, ''],
    ]);
  });

  it('값이 비어 있으면 null이고 물량도 null이다(0과 다르다)', () => {
    const ledger = buildDrawingLedger({ id: 'd_1', name: 'x.dxf' }, [damage('a', 'spalling', RECT_LEFT, { width: 0, length: 2, count: 1 }), damage('b', 'spalling', RECT_LEFT_2, {})], FRAMES);
    expect(ledger.rows[0]).toMatchObject({ width: 0, quantity: 0 });
    expect(ledger.rows[1]).toMatchObject({ width: null, length: null, count: null, quantity: null });
  });
});
