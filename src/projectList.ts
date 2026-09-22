// 목록 화면이 "무엇을 보여줄지"만 정하는 순수 모듈이다. vitest(server/test/projectList.test.ts)가
// 상대 경로로 가져가 검사한다(photoQueue.ts와 같은 방식). 그래서 이 파일은 **아무것도
// import하지 않는다** — expo·react-native를 하나라도 가져오면 서버 테스트가 깨진다.
// 근거: docs/superpowers/specs/2026-09-21-projects-design.md 6장

/** 지금 보고 있는 자리. null = 맨 위, 'unfiled' = 미분류 도면 목록, 그 밖은 프로젝트 id. */
export type ListLocation = null | 'unfiled' | string;

export type ListItem<P, D> =
  | { kind: 'project'; project: P }
  | { kind: 'unfiled'; count: number }
  | { kind: 'drawing'; drawing: D };

function isUnfiledDrawing<D extends { projectId?: string | null }>(drawing: D, knownIds: Set<string>): boolean {
  const pid = drawing.projectId;
  return typeof pid !== 'string' || !knownIds.has(pid);
}

// location에서 보여줄 항목들. 프로젝트가 하나도 없으면(스펙 6장) location과 상관없이 모든
// 도면을 그대로 준다 — 미분류 단계를 거치지 않는다.
export function listItemsFor<P extends { id: string; parentId: string | null }, D extends { projectId?: string | null }>(
  projects: P[],
  drawings: D[],
  location: ListLocation,
): ListItem<P, D>[] {
  const allProjects = Array.isArray(projects) ? projects : [];
  const allDrawings = Array.isArray(drawings) ? drawings : [];

  if (allProjects.length === 0) {
    return allDrawings.map((drawing) => ({ kind: 'drawing', drawing }));
  }

  const knownIds = new Set(allProjects.map((p) => p.id));

  if (location === 'unfiled') {
    return allDrawings
      .filter((d) => isUnfiledDrawing(d, knownIds))
      .map((drawing) => ({ kind: 'drawing', drawing }));
  }

  if (location === null) {
    const items: ListItem<P, D>[] = allProjects
      .filter((p) => p.parentId === null)
      .map((project) => ({ kind: 'project', project }));
    const unfiledCount = allDrawings.filter((d) => isUnfiledDrawing(d, knownIds)).length;
    if (unfiledCount > 0) items.push({ kind: 'unfiled', count: unfiledCount });
    return items;
  }

  // location은 프로젝트 id다 — 그 하위 프로젝트들이 먼저, 이어서 바로 든 도면들.
  const items: ListItem<P, D>[] = allProjects
    .filter((p) => p.parentId === location)
    .map((project) => ({ kind: 'project', project }));
  for (const drawing of allDrawings) {
    if (drawing.projectId === location) items.push({ kind: 'drawing', drawing });
  }
  return items;
}

// 없어진 프로젝트를 가리키던 위치는 맨 위로 되돌린다.
export function normalizeLocation(projects: { id: string }[], location: ListLocation): ListLocation {
  if (location === null || location === 'unfiled') return location;
  const list = Array.isArray(projects) ? projects : [];
  return list.some((p) => p.id === location) ? location : null;
}

// 뒤로 갈 때 한 단계 위 자리. 하위 프로젝트 → 그 상위, 최상위 → 맨 위(null), 'unfiled'·null → null.
export function parentLocation(
  projects: { id: string; parentId: string | null }[],
  location: ListLocation,
): ListLocation {
  if (location === null || location === 'unfiled') return null;
  const list = Array.isArray(projects) ? projects : [];
  const project = list.find((p) => p.id === location);
  return project ? project.parentId : null;
}
