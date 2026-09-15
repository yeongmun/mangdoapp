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

// applyMatrixToPoint가 실제로 쓰는 부분(e0,e1,e3,e4,e5,e7,e12,e13,e15)만으로 만든 x/y 역행렬.
// world→dwg(worldToDwg)의 역, 즉 dwg→world(dwgToWorld)를 만드는 데 쓴다.
//
// applyMatrixToPoint는 [x, y, z=0, 1]에 대해 px = (e0 x + e4 y + e12) / w, w = e3 x + e7 y + e15로
// 계산한다 — z를 안 받으므로 행렬의 세 번째 열(z 기여분)은 절대 안 쓰인다. 아래 두 조건 중
// 하나라도 있으면 이 x/y 부분 행렬은 평행이동+선형(아핀)이 아니라 진짜 원근(투영)이라 2D 아핀
// 역행렬로 되돌릴 수 없어 null:
//   - e15 ≠ 1이면 먼저 e15로 정규화한다(스케일 인자를 걷어낸다). e15가 유한하지 않거나 0이면
//     정규화 자체가 안 되므로 null (isFiniteMatrix가 이미 유한함은 보장하므로 남는 경우는 0뿐).
//   - 정규화한 뒤에도 e3나 e7이 0이 아니면(= w가 x, y에 따라 실제로 변한다) 진짜 원근이라 null.
// 그 외에는 2×2 선형부 A = [[e0,e4],[e1,e5]] + 이동 t = [e12,e13]의 아핀 역행렬을 구한다.
// 행렬식이 (상대적으로) 0에 가까우면(특이) 역행렬이 없으므로 null.
export function invertPointMatrix(matrix) {
  if (!isFiniteMatrix(matrix)) return null;
  const src = matrix.elements;
  let e0 = src[0];
  let e1 = src[1];
  let e3 = src[3];
  let e4 = src[4];
  let e5 = src[5];
  let e7 = src[7];
  let e12 = src[12];
  let e13 = src[13];
  const e15 = src[15];

  if (e15 !== 1) {
    if (e15 === 0) return null; // 0으로 나눌 수 없으므로 정규화 불가
    e0 /= e15;
    e1 /= e15;
    e3 /= e15;
    e4 /= e15;
    e5 /= e15;
    e7 /= e15;
    e12 /= e15;
    e13 /= e15;
  }
  if (e3 !== 0 || e7 !== 0) return null; // x, y에 따라 w가 변하는 진짜 원근 — 아핀 역행렬 없음

  const det = e0 * e5 - e4 * e1;
  // 상대 오차: 선형부 성분 크기에 비례한 문턱값보다 행렬식이 작으면 특이로 본다.
  const scale = Math.max(1, Math.abs(e0), Math.abs(e1), Math.abs(e4), Math.abs(e5));
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12 * scale * scale) return null;

  const invDet = 1 / det;
  const a = e5 * invDet; // 새 e0
  const b = -e1 * invDet; // 새 e1
  const c = -e4 * invDet; // 새 e4
  const d = e0 * invDet; // 새 e5
  const tx = -(a * e12 + c * e13); // 새 e12
  const ty = -(b * e12 + d * e13); // 새 e13

  const inverse = { elements: [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, tx, ty, 0, 1] };
  return isFiniteMatrix(inverse) ? inverse : null;
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
  // 한 번만 구해 둔다(뷰마다 dwgStatus.matrix는 안 바뀐다) — dwgToWorld를 프레임마다 부를 일은
  // 없지만(라벨 자리는 손상 목록이 바뀔 때만 다시 계산한다), 매번 새로 역행렬을 구할 이유도 없다.
  const inverseMatrix = dwgStatus.matrix ? invertPointMatrix(dwgStatus.matrix) : null;
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
    // worldToDwg의 역. 행렬이 없거나(dwgStatus.matrix가 null) 역행렬을 구할 수 없으면(특이·원근)
    // null이다. 라벨 배치를 dwg mm 단위로 계산한 뒤 화면(world)으로 되돌리는 데 쓴다
    // (overlay.js computeLabelPlacements) — 그래야 화면과 DXF가 회전·반전에서도 같은 자리를 고른다.
    dwgToWorld(point) {
      return inverseMatrix ? applyMatrixToPoint(inverseMatrix, point) : null;
    },
  };
}
