import { describe, expect, it } from 'vitest';
import {
  angleOf,
  distanceToPolyline,
  distanceToSegment,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rectCenter,
  rectFromDrag,
  resizeRect,
  rotatePoints,
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

describe('rectFromDrag', () => {
  it('드래그한 두 점을 대각선으로 하는 사각형을 만든다', () => {
    expect(rectFromDrag([1, 2], [5, 6])).toEqual([[1, 2], [5, 2], [5, 6], [1, 6]]);
  });

  it('반대 방향으로 드래그해도 같은 사각형이 되고, 첫 변(0→1)은 항상 위쪽(y가 작은 쪽)이다', () => {
    // 회전 핸들은 첫 변 바깥쪽에 그려지므로, 드래그 방향에 따라 꼭짓점 순서가 달라지면
    // 핸들이 사각형 위가 아니라 아래로 어긋난다. min/max로 정규화해 항상 같은 순서가 나와야 한다.
    expect(rectFromDrag([5, 6], [1, 2])).toEqual([[1, 2], [5, 2], [5, 6], [1, 6]]);
    expect(rectFromDrag([1, 2], [5, 6])).toEqual(rectFromDrag([5, 6], [1, 2]));
  });
});

describe('rectCenter / angleOf / rotatePoints', () => {
  const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];

  it('네 점의 가운데를 구한다', () => {
    expect(rectCenter(rect)).toEqual([2, 1]);
  });

  it('중심에서 점까지의 각도를 라디안으로 구한다', () => {
    expect(angleOf([0, 0], [1, 0])).toBeCloseTo(0, 10);
    expect(angleOf([0, 0], [0, 2])).toBeCloseTo(Math.PI / 2, 10);
  });

  it('중심을 기준으로 90도 회전한다', () => {
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 2);
    expect(rotated[0][0]).toBeCloseTo(3, 10);
    expect(rotated[0][1]).toBeCloseTo(-1, 10);
    expect(rotated[2][0]).toBeCloseTo(1, 10);
    expect(rotated[2][1]).toBeCloseTo(3, 10);
    expect(polygonArea(rotated)).toBeCloseTo(8, 10);
    expect(rect).toEqual([[0, 0], [4, 0], [4, 2], [0, 2]]);
  });
});

describe('resizeRect', () => {
  it('반대쪽 모서리를 고정한 채 크기를 바꾼다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const resized = resizeRect(rect, 2, [6, 5]);
    expect(resized[0]).toEqual([0, 0]);
    expect(polygonArea(resized)).toBeCloseTo(30, 10);
    expect(resized[2][0]).toBeCloseTo(6, 10);
    expect(resized[2][1]).toBeCloseTo(5, 10);
  });

  it('회전된 사각형은 기울기를 유지한 채 크기만 바뀐다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 2);
    const resized = resizeRect(rotated, 2, rotated[2]);
    for (let i = 0; i < 4; i++) {
      expect(resized[i][0]).toBeCloseTo(rotated[i][0], 8);
      expect(resized[i][1]).toBeCloseTo(rotated[i][1], 8);
    }
  });

  it('돌려준 사각형은 입력과 같은 점 객체를 쓰지 않는다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const resized = resizeRect(rect, 2, [6, 5]);
    for (let i = 0; i < 4; i++) {
      expect(resized[i]).not.toBe(rect[i]);
    }
    resized[0][0] = 99;
    expect(rect[0]).toEqual([0, 0]);
  });
});

describe('polygonArea', () => {
  it('사각형 면적을 구하고 도는 방향과 무관하게 0 이상이다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(polygonArea(rect)).toBeCloseTo(8, 10);
    expect(polygonArea([...rect].reverse())).toBeCloseTo(8, 10);
  });

  it('점이 3개 미만이면 0', () => {
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('pointInPolygon', () => {
  const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];

  it('안쪽은 true, 바깥은 false', () => {
    expect(pointInPolygon([2, 1], rect)).toBe(true);
    expect(pointInPolygon([5, 1], rect)).toBe(false);
    expect(pointInPolygon([2, 3], rect)).toBe(false);
  });

  it('경계선 위의 점도 true', () => {
    expect(pointInPolygon([0, 1], rect)).toBe(true);
    expect(pointInPolygon([4, 2], rect)).toBe(true);
  });

  it('회전된 사각형에서도 맞는다', () => {
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 4);
    expect(pointInPolygon(rectCenter(rect), rotated)).toBe(true);
    expect(pointInPolygon([rectCenter(rect)[0] + 3, rectCenter(rect)[1] + 3], rotated)).toBe(false);
  });
});
