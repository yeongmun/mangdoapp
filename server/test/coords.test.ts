import { describe, expect, it } from 'vitest';
import { applyMatrixToPoint, matricesEqual, resolvePageToModelMatrix } from '../public/viewer/coords.js';

// THREE.Matrix4와 같은 열 우선(column-major) 배열
function matrix(scale: number, tx: number, ty: number) {
  return { elements: [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1] };
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
