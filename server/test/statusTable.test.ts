import { describe, expect, it } from 'vitest';
import { statusTableRows, statusTableTotals } from '../public/viewer/statusTable.js';

const FRAMES = [
  { minX: 0, minY: 0, maxX: 1000, maxY: 1000, startNumber: 2, existing: [
    { number: 1, location: '교대 A1', status: '균열(0.3mm미만)', width: '0.20', length: '5.00', count: '1', quantity: '5.00', unit: 'm', note: '' },
    { number: 2, location: '교대 A1', status: '박락', width: '0.50', length: '2.00', count: '3', quantity: '3.00', unit: '㎡', note: '동측' },
  ] },
  { minX: 2000, minY: 0, maxX: 3000, maxY: 1000 },
];

function damage(id: string, type: string, dwg: [number, number][], measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id, type, createdAt: '2026-10-07T00:00:00.000Z',
    geometry: { kind: type === 'crack' ? 'polyline' : 'rect', world: dwg, dwg }, copies: [],
    measured: { width: null, length: null, count: null, ...measured }, computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}
const LEFT: [number, number][] = [[100, 100], [200, 100], [200, 200], [100, 200]];
const LEFT_2: [number, number][] = [[500, 100], [600, 100], [600, 200], [500, 200]];
const RIGHT: [number, number][] = [[2100, 100], [2200, 100], [2200, 200], [2100, 200]];
const OUTSIDE: [number, number][] = [[1500, 100], [1600, 100], [1600, 200], [1500, 200]];

describe('statusTableRows', () => {
  const damages = [
    damage('b', 'spalling', LEFT_2, { width: 0.5, length: 2, count: 3 }, { photoNumbers: ['12'], note: '서측' }),
    damage('a', 'spalling', LEFT, { width: 1, length: 1, count: 1 }),
    damage('r', 'crack', [[2100, 100], [2300, 100]], { width: 0.2, length: 4, count: 1 }),
    damage('x', 'spalling', OUTSIDE, { width: 1, length: 1, count: 1 }),
  ];

  it('페이지(틀)마다 기존 행 먼저, 신규는 그 다음 번호부터 번호 순', () => {
    const rows = statusTableRows(damages, FRAMES, 0);
    expect(rows.map((r) => [r.source, r.no, r.id, r.status, r.location])).toEqual([
      ['existing', 1, null, '균열(0.3mm미만)', '교대 A1'],
      ['existing', 2, null, '박락', '교대 A1'],
      ['app', 3, 'a', '박락', ''],
      ['app', 4, 'b', '박락', ''],
    ]);
    expect(rows[3]).toMatchObject({ width: '0.5', length: '2.0', count: '3', quantity: '3.0', unit: '㎡', photos: '12', note: '서측' });
  });

  it('다른 틀의 손상과 틀 밖 손상은 나오지 않는다', () => {
    const rows = statusTableRows(damages, FRAMES, 1);
    expect(rows.map((r) => [r.source, r.no, r.id])).toEqual([['app', 1, 'r']]);
    expect(rows[0]).toMatchObject({ status: '균열(0.3mm미만)', quantity: '4.0', unit: 'm' });
  });

  it('틀이 없는 도면은 전체가 한 표', () => {
    const rows = statusTableRows(damages, [], 0);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'x', 'r']);
  });

  it('값이 비면 빈 칸', () => {
    const rows = statusTableRows([damage('e', 'spalling', LEFT, {})], [], 0);
    expect(rows[0]).toMatchObject({ width: '', length: '', count: '', quantity: '' });
  });
});

describe('statusTableTotals', () => {
  it('손상현황·단위별 물량 합, 빈 물량은 뺀다', () => {
    const rows = statusTableRows(
      [damage('a', 'spalling', LEFT, { width: 1, length: 1, count: 1 }), damage('b', 'spalling', LEFT_2, { width: 0.5, length: 2, count: 3 }), damage('e', 'spalling', RIGHT, {})],
      [],
      0,
    );
    expect(statusTableTotals(rows)).toEqual([{ status: '박락', unit: '㎡', quantity: '4.0', count: 2 }]);
  });

  it('기존 행의 물량도 합친다', () => {
    const rows = statusTableRows([damage('a', 'spalling', LEFT, { width: 1, length: 1, count: 1 })], FRAMES, 0);
    expect(statusTableTotals(rows)).toEqual([
      { status: '균열(0.3mm미만)', unit: 'm', quantity: '5.0', count: 1 },
      { status: '박락', unit: '㎡', quantity: '4.0', count: 2 },
    ]);
  });
});
