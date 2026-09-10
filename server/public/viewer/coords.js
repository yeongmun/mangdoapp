// 좌표계: client(캔버스 기준 픽셀) ↔ world(뷰어 2D 페이지 좌표) ↔ dwg(원본 DWG 모델 공간 좌표)

export function matricesEqual(a, b, epsilon = 1e-9) {
  for (let i = 0; i < 16; i++) {
    const x = a.elements[i];
    const y = b.elements[i];
    if (Math.abs(x - y) > epsilon * Math.max(1, Math.abs(x), Math.abs(y))) return false;
  }
  return true;
}

// THREE.Matrix4 / LmvMatrix4의 elements는 열 우선 배열이다. z = 0인 2D 점에 적용한다.
export function applyMatrixToPoint(matrix, [x, y]) {
  const e = matrix.elements;
  const w = e[3] * x + e[7] * y + e[15];
  return [(e[0] * x + e[4] * y + e[12]) / w, (e[1] * x + e[5] * y + e[13]) / w];
}

// 뷰어의 model.getPageToModelTransform(vpId)는 뷰포트마다 행렬을 준다. 펜으로 찍은 임의의 점이 어느
// 뷰포트에 속하는지는 알 수 없으므로, 모든 뷰포트의 행렬이 같을 때만 DWG 좌표로 변환한다.
export function resolvePageToModelMatrix(model) {
  const data = model.getData();
  if (data.pageToModelTransform) {
    return { matrix: data.pageToModelTransform, reason: '도면 전체 변환(pageToModelTransform)을 사용합니다.' };
  }
  const viewports = Array.isArray(data.viewports) ? data.viewports : [];
  const matrices = [];
  viewports.forEach((viewport, vpId) => {
    if (viewport) matrices.push(model.getPageToModelTransform(vpId));
  });
  if (matrices.length === 0) return { matrix: null, reason: '뷰포트 정보가 없습니다.' };
  if (!matrices.every((m) => matricesEqual(m, matrices[0]))) {
    return { matrix: null, reason: `뷰포트 ${matrices.length}개의 좌표 변환이 서로 다릅니다.` };
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
