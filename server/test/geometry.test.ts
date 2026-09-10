import { describe, expect, it } from 'vitest';
import {
  distanceToPolyline,
  distanceToSegment,
  polylineLength,
  simplifyPolyline,
} from '../public/viewer/geometry.js';

type Pt = [number, number];

describe('distanceToSegment', () => {
  it('선분 안쪽으로 수직 거리를 잰다', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3);
  });
  it('선분 밖이면 가까운 끝점까지 거리', () => {
    expect(distanceToSegment([13, 4], [0, 0], [10, 0])).toBeCloseTo(5);
  });
  it('길이 0 선분은 점까지 거리', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBeCloseTo(5);
  });
});

describe('distanceToPolyline', () => {
  it('가장 가까운 선분까지 거리', () => {
    const line: Pt[] = [[0, 0], [10, 0], [10, 10]];
    expect(distanceToPolyline([12, 5], line)).toBeCloseTo(2);
  });
  it('빈 폴리라인은 Infinity, 점 하나는 그 점까지 거리', () => {
    expect(distanceToPolyline([1, 1], [])).toBe(Infinity);
    expect(distanceToPolyline([3, 4], [[0, 0]])).toBeCloseTo(5);
  });
});

describe('simplifyPolyline', () => {
  it('허용 오차 안의 흔들림이 있는 직선은 양 끝점만 남긴다', () => {
    const jittery: Pt[] = [];
    for (let i = 0; i <= 100; i++) jittery.push([i, i % 2 === 0 ? 0.4 : -0.4]);
    const result = simplifyPolyline(jittery, 1);
    expect(result).toEqual([jittery[0], jittery[100]]);
  });

  it('꺾이는 점은 유지한다', () => {
    const lShape: Pt[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    expect(simplifyPolyline(lShape, 0.5)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('원래 모든 점이 결과 폴리라인에서 허용 오차 이내에 있다', () => {
    const curve: Pt[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = (i / 200) * Math.PI * 2;
      curve.push([t * 50, Math.sin(t) * 30 + Math.sin(i * 1.7) * 0.3]);
    }
    const tolerance = 1.5;
    const result = simplifyPolyline(curve, tolerance);
    expect(result.length).toBeLessThan(curve.length / 3);
    for (const p of curve) {
      expect(distanceToPolyline(p, result)).toBeLessThanOrEqual(tolerance + 1e-9);
    }
  });

  it('점이 2개 이하이면 복사본을 그대로 돌려준다', () => {
    const two: Pt[] = [[0, 0], [1, 1]];
    const result = simplifyPolyline(two, 1);
    expect(result).toEqual(two);
    expect(result).not.toBe(two);
  });
});

describe('polylineLength', () => {
  it('구간 길이의 합', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 10]])).toBeCloseTo(11);
  });
  it('점이 2개 미만이면 0', () => {
    expect(polylineLength([[1, 1]])).toBe(0);
    expect(polylineLength([])).toBe(0);
  });
});
