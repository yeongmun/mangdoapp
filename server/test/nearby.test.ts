import { describe, expect, it } from 'vitest';
import { distanceM, formatDistance, MAX_RECORD_ACCURACY_M, nearestStructures } from '../../src/nearby.js';

describe('nearby — 거리', () => {
  it('부산역↔서면 약 4.9km', () => {
    const d = distanceM({ lat: 35.115, lng: 129.0403 }, { lat: 35.1579, lng: 129.0594 });
    expect(d).toBeGreaterThan(4700);
    expect(d).toBeLessThan(5200);
  });
  it('같은 점은 0', () => {
    expect(distanceM({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(0);
  });
  it('표시: m는 10m 단위, 1km부터 km', () => {
    expect(formatDistance(216)).toBe('220m');
    expect(formatDistance(3)).toBe('10m');
    expect(formatDistance(949)).toBe('950m');
    expect(formatDistance(994)).toBe('990m');
    expect(formatDistance(995)).toBe('1.0km');
    expect(formatDistance(4870)).toBe('4.9km');
    expect(formatDistance(NaN)).toBe('');
  });
});

describe('nearby — 가까운 구조물 고르기', () => {
  const here = { lat: 35.1, lng: 129.0 };
  const items = [
    { id: 'far', location: { lat: 35.2, lng: 129.0 } }, // 약 11km
    { id: 'near', location: { lat: 35.1005, lng: 129.0 } }, // 약 56m
    { id: 'mid', location: { lat: 35.11, lng: 129.0 } }, // 약 1.1km
    { id: 'none' },
    { id: 'null', location: null },
  ];
  it('위치 없는 것과 3km 밖은 빼고 가까운 순', () => {
    expect(nearestStructures(here, items).map((n) => n.item.id)).toEqual(['near', 'mid']);
  });
  it('limit·maxM', () => {
    expect(nearestStructures(here, items, 1).map((n) => n.item.id)).toEqual(['near']);
    expect(nearestStructures(here, items, 3, 20000).map((n) => n.item.id)).toEqual(['near', 'mid', 'far']);
  });
  it('기록 허용 정확도는 100m', () => {
    expect(MAX_RECORD_ACCURACY_M).toBe(100);
  });
});
