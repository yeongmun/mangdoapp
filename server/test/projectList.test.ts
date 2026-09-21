// listItemsFor·normalizeLocation·parentLocation은 순수 함수 — 목록 화면(DrawingListScreen)이
// "무엇을 보여줄지"만 정한다. src/projectList.ts는 아무것도 import하지 않으므로 이 vitest가
// 상대 경로로 가져가 검사한다(photoQueue.ts와 같은 방식). 스펙:
// docs/superpowers/specs/2026-09-21-projects-design.md 6장
import { describe, expect, it } from 'vitest';
import { listItemsFor, normalizeLocation, parentLocation, type ListItem } from '../../src/projectList.js';

interface P {
  id: string;
  parentId: string | null;
}

interface D {
  id: string;
  projectId?: string | null;
}

function project(id: string, parentId: string | null = null): P {
  return { id, parentId };
}

function drawing(id: string, projectId?: string | null): D {
  return projectId === undefined ? { id } : { id, projectId };
}

describe('listItemsFor', () => {
  it('프로젝트가 하나도 없으면 위치와 상관없이 모든 도면을 drawing 항목으로 준다', () => {
    const drawings = [drawing('d1'), drawing('d2', 'p1')];
    const expected: ListItem<P, D>[] = drawings.map((d) => ({ kind: 'drawing', drawing: d }));
    expect(listItemsFor<P, D>([], drawings, null)).toEqual(expected);
    expect(listItemsFor<P, D>([], drawings, 'unfiled')).toEqual(expected);
    expect(listItemsFor<P, D>([], drawings, 'p1')).toEqual(expected);
  });

  it('맨 위: 최상위 프로젝트들 + 미분류 도면이 있으면 끝에 unfiled', () => {
    const projects = [project('p1'), project('p2'), project('c1', 'p1')];
    const drawings = [drawing('d1', 'p1'), drawing('d2')];
    const items = listItemsFor(projects, drawings, null);
    expect(items).toEqual([
      { kind: 'project', project: projects[0] },
      { kind: 'project', project: projects[1] },
      { kind: 'unfiled', count: 1 },
    ]);
  });

  it('맨 위: 미분류 도면이 없으면 unfiled 항목이 없다', () => {
    const projects = [project('p1')];
    const drawings = [drawing('d1', 'p1')];
    const items = listItemsFor(projects, drawings, null);
    expect(items).toEqual([{ kind: 'project', project: projects[0] }]);
  });

  it('프로젝트 안: 하위 프로젝트들이 먼저, 이어서 그 프로젝트에 바로 든 도면들', () => {
    const projects = [project('p1'), project('c1', 'p1'), project('c2', 'p1')];
    const drawings = [drawing('d1', 'p1'), drawing('d2', 'c1')];
    const items = listItemsFor(projects, drawings, 'p1');
    expect(items).toEqual([
      { kind: 'project', project: projects[1] },
      { kind: 'project', project: projects[2] },
      { kind: 'drawing', drawing: drawings[0] },
    ]);
  });

  it('하위 프로젝트 안: 하위가 없으므로 도면만', () => {
    const projects = [project('p1'), project('c1', 'p1')];
    const drawings = [drawing('d1', 'c1'), drawing('d2', 'p1')];
    const items = listItemsFor(projects, drawings, 'c1');
    expect(items).toEqual([{ kind: 'drawing', drawing: drawings[0] }]);
  });

  it("'unfiled': projectId가 없거나(undefined·null) 모르는 id인 도면", () => {
    const projects = [project('p1')];
    const drawings = [drawing('d1', 'p1'), drawing('d2'), drawing('d3', 'ghost'), drawing('d4', null)];
    const items = listItemsFor(projects, drawings, 'unfiled');
    expect(items).toEqual([
      { kind: 'drawing', drawing: drawings[1] },
      { kind: 'drawing', drawing: drawings[2] },
      { kind: 'drawing', drawing: drawings[3] },
    ]);
  });
});

describe('normalizeLocation', () => {
  const projects = [{ id: 'p1' }, { id: 'c1' }];

  it('null과 unfiled는 그대로 돌려준다', () => {
    expect(normalizeLocation(projects, null)).toBeNull();
    expect(normalizeLocation(projects, 'unfiled')).toBe('unfiled');
  });

  it('있는 프로젝트 id는 그대로 돌려준다', () => {
    expect(normalizeLocation(projects, 'p1')).toBe('p1');
  });

  it('없어진 프로젝트면 null', () => {
    expect(normalizeLocation(projects, 'ghost')).toBeNull();
  });
});

describe('parentLocation', () => {
  const projects = [
    { id: 'p1', parentId: null },
    { id: 'c1', parentId: 'p1' },
  ];

  it('하위 → 상위', () => {
    expect(parentLocation(projects, 'c1')).toBe('p1');
  });

  it('최상위 → null', () => {
    expect(parentLocation(projects, 'p1')).toBeNull();
  });

  it('unfiled → null', () => {
    expect(parentLocation(projects, 'unfiled')).toBeNull();
  });

  it('null → null', () => {
    expect(parentLocation(projects, null)).toBeNull();
  });
});
