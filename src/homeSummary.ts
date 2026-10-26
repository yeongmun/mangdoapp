// 과업 목록 카드의 사진 진행·「이어서 찍기」 대상·「최근 찍은 사진」(2026-10-25 농농 폰 시안).
// 순수, import 없음 — vitest가 server/test/homeSummary.test.ts에서 상대 경로로 읽는다.
// 입력은 기기 저장(shots/<projectId>.json, shotsLocal.ts)이라 오프라인에서도 보이지만, 마지막으로 받은 때 기준이다.

export interface CachedShot {
  id: string;
  kind: 'required' | 'previous';
  member: string;
  label: string;
  number: string;
  photo?: { savedAt: string };
  thumbUrl: string | null;
  trashed?: true;
}

export interface ShotCache {
  list: { shots: CachedShot[] } | null;
  local: Record<string, { uri: string; takenAt: number }>;
}

function active(cache: ShotCache): CachedShot[] {
  return (cache.list?.shots ?? []).filter((s) => s.trashed !== true);
}

/** 찍어야 할 것: 전차 사진이 있으면 전차 사진만(그것만 찍어도 된다 — 설계 사용자 결정), 없으면 필수 사진 */
function toShoot(cache: ShotCache): CachedShot[] {
  const all = active(cache);
  const previous = all.filter((s) => s.kind === 'previous');
  return previous.length > 0 ? previous : all.filter((s) => s.kind === 'required');
}

function isTaken(cache: ShotCache, shot: CachedShot): boolean {
  return shot.photo !== undefined || cache.local[shot.id] !== undefined;
}

/** 구조물들의 찍은 수/전체 수(휴지통 제외, toShoot 기준). 하나도 목록을 못 받았으면 null */
export function photoProgress(caches: ShotCache[]): { taken: number; total: number } | null {
  if (!caches.some((c) => c.list !== null)) return null;
  let taken = 0;
  let total = 0;
  for (const cache of caches) {
    for (const shot of toShoot(cache)) {
      total += 1;
      if (isTaken(cache, shot)) taken += 1;
    }
  }
  return { taken, total };
}

/** 「이어서 찍기」: 남은 사진이 있는 첫 구조물(기기에 목록이 없는 = 한 번도 안 연 구조물도 남은 것). 다 찍었으면 첫 구조물, 구조물이 없으면 null */
export function nextStructure(children: { id: string }[], caches: Record<string, ShotCache>): string | null {
  for (const child of children) {
    const cache = caches[child.id];
    if (!cache || cache.list === null) return child.id;
    if (toShoot(cache).some((s) => !isTaken(cache, s))) return child.id;
  }
  return children[0]?.id ?? null;
}

export interface RecentPhoto {
  projectId: string;
  projectName: string;
  shot: CachedShot;
  at: number;
  /** 아직 서버에 없을 때 기기 사본 */
  localUri?: string;
}

/** 찍은 사진을 시간 역순으로 limit개(기기 사본은 찍은 때, 서버 사진은 저장된 때). 휴지통 제외 */
export function recentPhotos(items: { projectId: string; projectName: string; cache: ShotCache }[], limit: number): RecentPhoto[] {
  const out: RecentPhoto[] = [];
  for (const { projectId, projectName, cache } of items) {
    for (const shot of active(cache)) {
      const local = cache.local[shot.id];
      if (local) out.push({ projectId, projectName, shot, at: local.takenAt, localUri: local.uri });
      else if (shot.photo) out.push({ projectId, projectName, shot, at: Date.parse(shot.photo.savedAt) || 0 });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

// 과업 목록 필터(2026-10-26): 웹 과업구분(taskType, 웹이 넣음), 없으면 앱에서 고른 점검 종류
export const TASK_TYPE_ORDER = ['정밀안전점검', '정기안전점검', '정밀안전진단', '옹벽(사급)'];
export const UNSET_TASK_TYPE = '미지정';

export function taskTypeOf(project: { taskType?: string; inspectionType?: string }): string | null {
  return project.taskType ?? project.inspectionType ?? null;
}

/** 칩 보기: 목록에 있는 구분만 정해진 순서로, 구분 없는 과업이 있으면 「미지정」을 끝에. 구분이 하나도 없으면 빈 배열(칩 안 보임) */
export function taskTypeOptions(projects: { taskType?: string; inspectionType?: string }[]): string[] {
  const present = new Set(projects.map(taskTypeOf));
  const known = TASK_TYPE_ORDER.filter((t) => present.has(t));
  const others = [...present].filter((t): t is string => t !== null && !TASK_TYPE_ORDER.includes(t));
  if (known.length + others.length === 0) return [];
  return [...known, ...others, ...(present.has(null) ? [UNSET_TASK_TYPE] : [])];
}
