import { describe, expect, it } from 'vitest';
import {
  applyMatrixToPoint,
  createCoordinateMapper,
  invertPointMatrix,
  matricesEqual,
  resolvePageToModelMatrix,
} from '../public/viewer/coords.js';

// THREE.Matrix4와 같은 열 우선(column-major) 배열
function matrix(scale: number, tx: number, ty: number) {
  return { elements: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1] };
}

// 임의의 2×2 선형부 + 이동으로 열 우선 4×4를 만든다. [[a,c],[b,d]]가 선형부, [tx,ty]가 이동이다
// (applyMatrixToPoint 기준: px = e0 x + e4 y + e12, py = e1 x + e5 y + e13).
function affine(a: number, b: number, c: number, d: number, tx: number, ty: number) {
  return { elements: [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1] };
}

function rotation90(tx: number, ty: number) {
  // 반시계 90°: (x, y) -> (-y, x)
  return affine(0, 1, -1, 0, tx, ty);
}

function yFlip(tx: number, ty: number) {
  return affine(1, 0, 0, -1, tx, ty);
}

function fakeModel(data: Record<string, unknown>, transforms: Record<number, { elements: number[] }> = {}) {
  return {
    getData: () => data,
    getPageToModelTransform: (vpId: number) => transforms[vpId] ?? matrix(1, 0, 0),
  };
}

describe('applyMatrixToPoint', () => {
  it('축척과 이동을 적용한다', () => {
    expect(applyMatrixToPoint(matrix(2, 100, 50), [3, 4])).toEqual([106, 58]);
  });

  it('w가 0이면 null', () => {
    const m = matrix(2, 100, 50);
    m.elements[3] = 0;
    m.elements[7] = 0;
    m.elements[15] = 0;
    expect(applyMatrixToPoint(m, [3, 4])).toBeNull();
  });
});

describe('matricesEqual', () => {
  it('상대 오차 안이면 같다고 본다', () => {
    expect(matricesEqual(matrix(2, 100, 50), matrix(2, 100 + 1e-12, 50))).toBe(true);
    expect(matricesEqual(matrix(2, 100, 50), matrix(2, 101, 50))).toBe(false);
  });
});

describe('invertPointMatrix', () => {
  function roundTrip(m: { elements: number[] }, points: Array<[number, number]>) {
    const inv = invertPointMatrix(m);
    expect(inv).not.toBeNull();
    for (const p of points) {
      const forward = applyMatrixToPoint(m, p)! as [number, number];
      const back = applyMatrixToPoint(inv!, forward)!;
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    }
  }

  const points: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [3.5, -2.25], [-100, 250]];

  it('항등 행렬', () => {
    roundTrip(affine(1, 0, 0, 1, 0, 0), points);
  });

  it('축척 + 이동', () => {
    roundTrip(matrix(2, 100, 50), points);
  });

  it('90도 회전', () => {
    roundTrip(rotation90(10, -20), points);
  });

  it('y축 반전', () => {
    roundTrip(yFlip(5, 5), points);
  });

  it('행렬이 없으면(worldToDwg가 null) dwgToWorld도 null 근거 — 역행렬도 그와 같이 취급한다', () => {
    // 특이(비가역) 행렬: 선형부가 모두 0이라 어떤 점도 되돌릴 수 없다.
    expect(invertPointMatrix(affine(0, 0, 0, 0, 0, 0))).toBeNull();
  });

  it('행렬식이 0에 가까운(거의 특이) 행렬도 null', () => {
    // 선형부의 두 행이 거의 평행 — det ≈ 0.
    expect(invertPointMatrix(affine(1, 1, 1, 1 + 1e-15, 0, 0))).toBeNull();
  });

  it('진짜 원근(e3 또는 e7이 0이 아님)이면 null', () => {
    const m = affine(1, 0, 0, 1, 0, 0);
    m.elements[3] = 0.001;
    expect(invertPointMatrix(m)).toBeNull();

    const m2 = affine(1, 0, 0, 1, 0, 0);
    m2.elements[7] = 0.001;
    expect(invertPointMatrix(m2)).toBeNull();
  });

  it('e15가 1이 아니어도 유한하고 0이 아니면 정규화해서 되돌린다', () => {
    const m = matrix(2, 100, 50);
    m.elements[15] = 2; // 모든 성분이 실질적으로 절반 스케일된 것과 같다 — 정규화하면 원래 축척+이동이다
    m.elements[0] *= 2;
    m.elements[5] *= 2;
    m.elements[12] *= 2;
    m.elements[13] *= 2;
    roundTrip(m, points);
  });

  it('e15가 0이면 정규화할 수 없으므로 null', () => {
    const m = matrix(2, 100, 50);
    m.elements[15] = 0;
    expect(invertPointMatrix(m)).toBeNull();
  });

  it('유한하지 않은 값이 있으면 null', () => {
    const m = matrix(2, 100, 50);
    m.elements[0] = NaN;
    expect(invertPointMatrix(m)).toBeNull();
  });

  it('null·undefined 행렬 입력도 null', () => {
    expect(invertPointMatrix({ elements: null as unknown as number[] })).toBeNull();
  });
});

describe('createCoordinateMapper의 dwgToWorld', () => {
  function fakeViewer(data: Record<string, unknown>) {
    return { model: fakeModel(data) };
  }

  it('행렬이 없으면 null', () => {
    const mapper = createCoordinateMapper(fakeViewer({ viewports: [] }) as any);
    expect(mapper.dwgToWorld([1, 2])).toBeNull();
  });

  it('worldToDwg의 역을 준다 (회전 포함)', () => {
    const mapper = createCoordinateMapper(fakeViewer({ pageToModelTransform: rotation90(10, -20) }) as any);
    const world: [number, number] = [3.5, -2.25];
    const dwg = mapper.worldToDwg(world)!;
    const back = mapper.dwgToWorld(dwg)!;
    expect(back[0]).toBeCloseTo(world[0], 6);
    expect(back[1]).toBeCloseTo(world[1], 6);
  });
});

describe('resolvePageToModelMatrix', () => {
  it('data.pageToModelTransform이 있으면 그것을 쓴다', () => {
    const m = matrix(3, 1, 1);
    const result = resolvePageToModelMatrix(fakeModel({ pageToModelTransform: m }));
    expect(result.matrix).toBe(m);
  });

  it('뷰포트가 없으면 변환 불가', () => {
    expect(resolvePageToModelMatrix(fakeModel({ viewports: [] }))).toEqual({
      matrix: null,
      reason: '뷰포트 정보가 없습니다.',
    });
    expect(resolvePageToModelMatrix(fakeModel({})).matrix).toBeNull();
  });

  it('모든 뷰포트의 변환이 같으면 그 행렬을 쓴다 (빈 칸은 건너뜀)', () => {
    const m = matrix(2, 10, 20);
    const model = fakeModel({ viewports: [undefined, { transform: [] }, { transform: [] }] }, { 1: m, 2: matrix(2, 10, 20) });
    const result = resolvePageToModelMatrix(model);
    expect(result.matrix).toBe(m);
    expect(result.reason).toBe('뷰포트 2개의 변환이 같습니다.');
  });

  it('뷰포트마다 변환이 다르면 변환 불가', () => {
    const model = fakeModel({ viewports: [{}, {}] }, { 0: matrix(1, 0, 0), 1: matrix(50, 0, 0) });
    expect(resolvePageToModelMatrix(model)).toEqual({
      matrix: null,
      reason: '뷰포트 2개의 좌표 변환이 서로 다릅니다.',
    });
  });

  it('선·도형이 없는 빈 뷰포트는 빼고 남은 뷰포트의 변환을 쓴다 (실제 망도 데이터)', () => {
    // 사용자 도면(2D View): 0번은 변환 정보·도형이 없는 기본 뷰포트, 1번에 도면 전체가 들어 있다.
    const emptyMetrics = { arcs: 0, circles: 0, circ_arcs: 0, dots: 0, fills: 0, plines: 0, ptris: 0, rasters: 0, texts: 0, line_caps: 1, line_joins: 1, line_weights: 1 };
    const drawingMetrics = { arcs: 0, circles: 258, circ_arcs: 556, dots: 74, fills: 0, plines: 8322, ptris: 1211, rasters: 0, texts: 0, layers: 445 };
    const viewport1 = { elements: [67504.481665, 0, 0, 0, 0, 67504.362184, 0, 0, 0, 0, 1, 0, 95804.04799, -473.70707, 0, 1] };
    const model = fakeModel(
      { viewports: [{ geom_metrics: emptyMetrics }, { units: 'inches', transform: [], geom_metrics: drawingMetrics }] },
      { 0: { elements: [40000, 0, 0, 0, 0, 40000, 0, 0, 0, 0, 1, 0, 2147043647, 0, 0, 1] }, 1: viewport1 },
    );

    const result = resolvePageToModelMatrix(model);

    expect(result.matrix).toBe(viewport1);
    expect(result.reason).toBe('도형이 있는 뷰포트 1개의 변환을 사용합니다 (빈 뷰포트 1개 제외).');
    const [x, y] = applyMatrixToPoint(result.matrix, [2.041, 8.175])!;
    expect(x).toBeCloseTo(233580.695, 2);
    expect(y).toBeCloseTo(551374.454, 2);
  });

  it('도형이 있는 뷰포트끼리 변환이 다르면 여전히 변환 불가', () => {
    const metrics = { plines: 10 };
    const model = fakeModel(
      { viewports: [{ geom_metrics: metrics }, { geom_metrics: metrics }] },
      { 0: matrix(1, 0, 0), 1: matrix(50, 0, 0) },
    );
    expect(resolvePageToModelMatrix(model)).toEqual({
      matrix: null,
      reason: '뷰포트 2개의 좌표 변환이 서로 다릅니다.',
    });
  });

  it('pageToModelTransform에 NaN이 있으면 변환 불가', () => {
    const m = matrix(3, 1, 1);
    m.elements[12] = NaN;
    expect(resolvePageToModelMatrix(fakeModel({ pageToModelTransform: m }))).toEqual({
      matrix: null,
      reason: '좌표 변환 행렬에 유효하지 않은 값이 있습니다.',
    });
  });

  it('뷰포트 행렬에 NaN이 있으면 서로 같아 보여도 변환 불가', () => {
    const nan = () => {
      const m = matrix(2, 10, 20);
      m.elements[0] = NaN;
      return m;
    };
    const model = fakeModel({ viewports: [{}, {}] }, { 0: nan(), 1: nan() });
    expect(resolvePageToModelMatrix(model)).toEqual({
      matrix: null,
      reason: '좌표 변환 행렬에 유효하지 않은 값이 있습니다.',
    });
  });
});
