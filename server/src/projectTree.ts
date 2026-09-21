// 프로젝트 목록을 트리 순서로 펴고 개수를 센다. 순수 함수 — PC 업로드 페이지와 앱이 같은
// 계산을 따로 갖지 않도록 서버(GET /api/projects)가 이 결과를 내려준다. 근거:
// docs/superpowers/specs/2026-09-21-projects-design.md 3.1

import type { ProjectRecord } from './projectsStore.js';

export interface ProjectView extends ProjectRecord {
  depth: 0 | 1; // 0 = 최상위, 1 = 하위(구조물)
  path: string; // 'OO용역 2026' 또는 'OO용역 2026 › A교'
  drawingCount: number; // 이 프로젝트에 바로 든 도면 수
  totalDrawingCount: number; // 하위 프로젝트까지 합친 도면 수
  childCount: number; // 하위 프로젝트 수
}

export const PATH_SEPARATOR = ' › ';

// projectId가 아는 프로젝트를 가리키면 그대로, 없거나(null/undefined/그 밖의 타입) 모르는
// id면 null(=미분류)을 돌려준다.
export function effectiveProjectId(projectId: unknown, projects: ProjectRecord[]): string | null {
  if (typeof projectId !== 'string') return null;
  return projects.some((p) => p.id === projectId) ? projectId : null;
}

export function buildProjectViews(
  projects: ProjectRecord[],
  drawings: { projectId?: string | null }[],
): ProjectView[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  // parentId가 가리키는 상위가 없는 레코드(파일 손상)는 최상위로 취급한다.
  const topLevel = projects.filter((p) => p.parentId === null || !byId.has(p.parentId));
  const childrenOf = (id: string) => projects.filter((p) => p.parentId === id);

  const directCount = new Map<string, number>();
  for (const d of drawings) {
    const pid = effectiveProjectId(d.projectId, projects);
    if (pid !== null) directCount.set(pid, (directCount.get(pid) ?? 0) + 1);
  }

  const byKoName = (a: ProjectRecord, b: ProjectRecord) => a.name.localeCompare(b.name, 'ko');
  const views: ProjectView[] = [];
  for (const top of [...topLevel].sort(byKoName)) {
    const children = childrenOf(top.id).sort(byKoName);
    const childViews: ProjectView[] = children.map((child) => ({
      ...child,
      depth: 1,
      path: `${top.name}${PATH_SEPARATOR}${child.name}`,
      drawingCount: directCount.get(child.id) ?? 0,
      totalDrawingCount: directCount.get(child.id) ?? 0,
      childCount: 0,
    }));
    const topDirect = directCount.get(top.id) ?? 0;
    const topTotal = topDirect + childViews.reduce((sum, c) => sum + c.drawingCount, 0);
    views.push({
      ...top,
      depth: 0,
      path: top.name,
      drawingCount: topDirect,
      totalDrawingCount: topTotal,
      childCount: children.length,
    });
    views.push(...childViews);
  }
  return views;
}

// 자기 자신 먼저, 이어서 하위(이름순). 2단계까지만 있으므로 손자는 없다.
export function descendantIds(projectId: string, projects: ProjectRecord[]): string[] {
  const children = projects
    .filter((p) => p.parentId === projectId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return [projectId, ...children.map((c) => c.id)];
}
