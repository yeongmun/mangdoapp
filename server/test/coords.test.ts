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
});
