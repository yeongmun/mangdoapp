// 좌표계: client(캔버스 기준 픽셀) ↔ world(뷰어 2D 페이지 좌표) ↔ dwg(원본 DWG 모델 공간 좌표)

export function matricesEqual(a, b, epsilon = 1e-9) {
  for (let i = 0; i < 16; i++) {
    const x = a.elements[i];
    const y = b.elements[i];
    if (Math.abs(x - y) > epsilon * Math.max(1, Math.abs(x), Math.abs(y))) return false;
  }
  return true;
}

export function isFiniteMatrix(matrix) {
  const elements = matrix?.elements;
  if (elements === null || elements === undefined || elements.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(elements[i])) return false;
  }
  return true;
}

const INVALID_MATRIX_REASON = '좌표 변환 행렬에 유효하지 않은 값이 있습니다.';

// THREE.Matrix4 / LmvMatrix4의 elements는 열 우선 배열이다. z = 0인 2D 점에 적용한다.
// 결과가 유한한 좌표가 아니면 null (w = 0 등).
export function applyMatrixToPoint(matrix, [x, y]) {
  const e = matrix.elements;
  const w = e[3] * x + e[7] * y + e[15];
  if (!Number.isFinite(w) || w === 0) return null;
  const px = (e[0] * x + e[4] * y + e[12]) / w;
  const py = (e[1] * x + e[5] * y + e[13]) / w;
  return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : null;
}

// 실제로 그려지는 도형 수. line_caps·line_weights 같은 스타일 설정이나 layers 개수는 도형이 아니다.
const GEOMETRY_METRIC_KEYS = ['arcs', 'circles', 'circ_arcs', 'dots', 'fills', 'plines', 'ptris', 'rasters', 'texts'];

// 뷰어가 도형 통계(geom_metrics)를 주지 않으면 판단할 수 없으므로 도형이 있다고 본다.
function viewportHasGeometry(viewport) {
  const metrics = viewport.geom_metrics;
  if (!metrics || typeof metrics !== 'object') return true;
  return GEOMETRY_METRIC_KEYS.some((key) => Number(metrics[key]) > 0);
}

// 뷰어의 model.getPageToModelTransform(vpId)는 뷰포트마다 행렬을 준다. 펜으로 찍은 임의의 점이 어느
// 뷰포트에 속하는지는 알 수 없으므로, 도형이 있는 뷰포트들의 행렬이 모두 같을 때만 DWG 좌표로 변환한다.
// 도형이 하나도 없는 뷰포트(변환 정보 없는 기본 뷰포트 등)에는 점이 속할 수 없으므로 비교에서 뺀다.
export function resolvePageToModelMatrix(model) {
  const data = model.getData();
  if (data.pageToModelTransform) {
    if (!isFiniteMatrix(data.pageToModelTransform)) return { matrix: null, reason: INVALID_MATRIX_REASON };
    return { matrix: data.pageToModelTransform, reason: '도면 전체 변환(pageToModelTransform)을 사용합니다.' };
  }
  const viewports = Array.isArray(data.viewports) ? data.viewports : [];
  const present = [];
  viewports.forEach((viewport, vpId) => {
    if (viewport) present.push({ viewport, vpId });
  });
  if (present.length === 0) return { matrix: null, reason: '뷰포트 정보가 없습니다.' };
  // 모든 뷰포트가 비어 있으면 뺄 근거가 없으므로 전체를 그대로 비교한다.
  const withGeometry = present.filter(({ viewport }) => viewportHasGeometry(viewport));
  const candidates = withGeometry.length > 0 ? withGeometry : present;
  const excluded = present.length - candidates.length;
  const matrices = candidates.map(({ vpId }) => model.getPageToModelTransform(vpId));
  // NaN끼리의 비교는 matricesEqual에서 "같다"로 통과하므로 먼저 걸러낸다.
  if (!matrices.every(isFiniteMatrix)) return { matrix: null, reason: INVALID_MATRIX_REASON };
  if (!matrices.every((m) => matricesEqual(m, matrices[0]))) {
    return { matrix: null, reason: `뷰포트 ${matrices.length}개의 좌표 변환이 서로 다릅니다.` };
  }
  if (excluded > 0) {
    return {
      matrix: matrices[0],
      reason: `도형이 있는 뷰포트 ${matrices.length}개의 변환을 사용합니다 (빈 뷰포트 ${excluded}개 제외).`,
    };
  }
  return { matrix: matrices[0], reason: `뷰포트 ${matrices.length}개의 변환이 같습니다.` };
}

export function createCoordinateMapper(viewer) {
  const dwgStatus = resolvePageToModelMatrix(viewer.model);
  return {
    dwgStatus,
    clientToWorld(x, y) {
      // 네 번째 인자 true: 도면 경계 밖을 찍어도 좌표를 돌려받는다.
      const hit = viewer.clientToWorld(x, y, false, true);
      return hit ? [hit.point.x, hit.point.y] : null;
    },
    worldToClient([x, y]) {
      const p = viewer.worldToClient(new THREE.Vector3(x, y, 0));
      return [p.x, p.y];
    },
    worldToDwg(point) {
      return dwgStatus.matrix ? applyMatrixToPoint(dwgStatus.matrix, point) : null;
    },
  };
}
