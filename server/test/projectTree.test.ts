// projectTree는 순수 함수 — 서버가 트리를 계산해 클라이언트(PC 페이지·앱)가 같은 계산을
// 따로 갖지 않게 한다. 스펙: docs/superpowers/specs/2026-09-21-projects-design.md 3.1
import { describe, expect, it } from 'vitest';
import {
  buildProjectViews,
  descendantIds,
  effectiveProjectId,
  PATH_SEPARATOR,
  type ProjectView,
} from '../src/projectTree.js';
import type { ProjectRecord } from '../src/projectsStore.js';

function project(id: string, name: string, parentId: string | null = null): ProjectRecord {
  return { id, name, memo: '', parentId, createdAt: '2026-09-21T00:00:00.000Z' };
}

describe('buildProjectViews', () => {
  it('최상위는 이름순, 각 최상위 바로 뒤에 그 하위가 이름순으로 온다', () => {
    // 한글 로케일 정렬: '나'현장 < '다'현장 < '가'현장 순서 주의 — localeCompare('ko') 기준으로만 확인
    const projects = [
      project('p2', '나현장'),
      project('p1', '가현장'),
      project('c2', '나구조물', 'p1'),
      project('c1', '가구조물', 'p1'),
    ];
    const views = buildProjectViews(projects, []);
    expect(views.map((v) => v.id)).toEqual(['p1', 'c1', 'c2', 'p2']);
    expect(views.map((v) => v.depth)).toEqual([0, 1, 1, 0]);
  });

  it('path는 최상위는 이름 그대로, 하위는 상위 이름 뒤에 구분자와 이어붙인다', () => {
    const projects = [project('p1', 'OO용역 2026'), project('c1', 'A교', 'p1')];
    const views = buildProjectViews(projects, []);
    const top = views.find((v) => v.id === 'p1')!;
    const child = views.find((v) => v.id === 'c1')!;
    expect(top.path).toBe('OO용역 2026');
    expect(child.path).toBe(`OO용역 2026${PATH_SEPARATOR}A교`);
    expect(PATH_SEPARATOR).toBe(' › ');
  });

  it('drawingCount·totalDrawingCount·childCount를 계산한다', () => {
    const projects = [
      project('p1', 'OO용역'),
      project('c1', 'A교', 'p1'),
      project('c2', 'B교', 'p1'),
      project('p2', '단일현장'),
    ];
    const drawings = [
      { projectId: 'p1' }, // OO용역에 바로 든 도면
      { projectId: 'c1' },
      { projectId: 'c1' },
      { projectId: 'p2' },
    ];
    const views = buildProjectViews(projects, drawings);
    const byId = new Map(views.map((v) => [v.id, v]));
    expect(byId.get('p1')).toMatchObject({ drawingCount: 1, totalDrawingCount: 3, childCount: 2 });
    expect(byId.get('c1')).toMatchObject({ drawingCount: 2, totalDrawingCount: 2, childCount: 0 });
    expect(byId.get('c2')).toMatchObject({ drawingCount: 0, totalDrawingCount: 0, childCount: 0 });
    expect(byId.get('p2')).toMatchObject({ drawingCount: 1, totalDrawingCount: 1, childCount: 0 });
  });

  it('모르는 projectId를 가진 도면은 어디에도 세지 않는다', () => {
    const projects = [project('p1', 'OO용역')];
    const drawings = [{ projectId: 'p_unknown0000000000000000000000' }, { projectId: null }, {}];
    const views = buildProjectViews(projects, drawings);
    expect(views[0]).toMatchObject({ drawingCount: 0, totalDrawingCount: 0 });
  });

  it('상위가 없어진(파일 손상) 레코드는 최상위로 취급한다', () => {
    const projects = [project('c1', '고아구조물', 'p_없어진id000000000000000000000')];
    const views = buildProjectViews(projects, []);
    expect(views).toEqual<ProjectView[]>([
      {
        id: 'c1',
        name: '고아구조물',
        memo: '',
        parentId: 'p_없어진id000000000000000000000',
        createdAt: '2026-09-21T00:00:00.000Z',
        depth: 0,
        path: '고아구조물',
        drawingCount: 0,
        totalDrawingCount: 0,
        childCount: 0,
      },
    ]);
  });

  it('빈 목록은 빈 배열', () => {
    expect(buildProjectViews([], [])).toEqual([]);
  });
});

describe('effectiveProjectId', () => {
  const projects = [project('p1', 'OO용역')];

  it('아는 id는 그대로 돌려준다', () => {
    expect(effectiveProjectId('p1', projects)).toBe('p1');
  });

  it('없거나 모르는 id면 null', () => {
    expect(effectiveProjectId(undefined, projects)).toBeNull();
    expect(effectiveProjectId(null, projects)).toBeNull();
    expect(effectiveProjectId('', projects)).toBeNull();
    expect(effectiveProjectId('p_없는id', projects)).toBeNull();
    expect(effectiveProjectId(123, projects)).toBeNull();
  });
});

describe('descendantIds', () => {
  it('자기 자신이 먼저, 이어서 하위가 이름순으로 온다', () => {
    const projects = [
      project('p1', 'OO용역'),
      project('c2', '나구조물', 'p1'),
      project('c1', '가구조물', 'p1'),
      project('p2', '다른현장'),
    ];
    expect(descendantIds('p1', projects)).toEqual(['p1', 'c1', 'c2']);
  });

  it('하위가 없으면 자기 자신만', () => {
    const projects = [project('p1', 'OO용역')];
    expect(descendantIds('p1', projects)).toEqual(['p1']);
  });

  it('하위 프로젝트 자신을 넣으면 자기 자신만(손자는 없음)', () => {
    const projects = [project('p1', 'OO용역'), project('c1', 'A교', 'p1')];
    expect(descendantIds('c1', projects)).toEqual(['c1']);
  });
});
