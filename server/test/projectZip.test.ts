// projectZip은 순수 함수 — 프로젝트 묶음 zip(사진·DXF)의 폴더·이름 짓기를 손으로 계산한
// 값으로 검사한다. 근거: docs/superpowers/specs/2026-09-21-projects-design.md 4장
import { describe, expect, it } from 'vitest';
import type { DrawingRecord } from '../src/drawingsStore.js';
import { baseNameOf, drawingFoldersFor, uniqueNames } from '../src/projectZip.js';
import type { ProjectRecord } from '../src/projectsStore.js';

function project(id: string, name: string, parentId: string | null = null): ProjectRecord {
  return { id, name, memo: '', parentId, createdAt: '2026-09-21T00:00:00.000Z' };
}

function drawing(id: string, name: string, projectId?: string | null): DrawingRecord {
  return {
    id,
    name,
    objectKey: `${id}.dxf`,
    urn: `urn-${id}`,
    status: 'success',
    progress: '',
    error: null,
    uploadedAt: '2026-09-21T00:00:00.000Z',
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

describe('drawingFoldersFor', () => {
  const top = project('p_top', '오봉대교');
  const childA = project('p_a', 'A교', 'p_top');
  const childB = project('p_b', 'B교', 'p_top');
  const other = project('p_other', '다른 현장');

  it('최상위를 고르면 바로 든 도면(folder \'\')이 먼저, 이어서 하위(이름순)의 도면이 온다', () => {
    const projects = [top, childA, childB, other];
    const drawings = [
      drawing('d_1', '나교량.dxf', 'p_top'),
      drawing('d_2', '가교량.dxf', 'p_top'),
      drawing('d_3', 'B교 도면.dxf', 'p_b'),
      drawing('d_4', 'A교 도면.dxf', 'p_a'),
    ];

    const result = drawingFoldersFor('p_top', projects, drawings);

    expect(result.map((r) => [r.folder, r.drawing.id])).toEqual([
      ['', 'd_2'], // 가교량 (이름순)
      ['', 'd_1'], // 나교량
      ['A교/', 'd_4'],
      ['B교/', 'd_3'],
    ]);
  });

  it('하위 프로젝트를 고르면 폴더는 도면 단계뿐이다(전부 folder \'\')', () => {
    const projects = [top, childA, childB];
    const drawings = [drawing('d_1', '도면.dxf', 'p_a')];

    const result = drawingFoldersFor('p_a', projects, drawings);

    expect(result).toEqual([{ drawing: drawings[0], folder: '' }]);
  });

  it('다른 프로젝트·미분류 도면은 빠진다', () => {
    const projects = [top, childA, other];
    const drawings = [
      drawing('d_1', '내 도면.dxf', 'p_top'),
      drawing('d_2', '남의 도면.dxf', 'p_other'),
      drawing('d_3', '미분류 도면.dxf', null),
      drawing('d_4', '미분류 도면2.dxf'), // projectId 키 자체가 없음
    ];

    const result = drawingFoldersFor('p_top', projects, drawings);

    expect(result.map((r) => r.drawing.id)).toEqual(['d_1']);
  });

  it('가리키는 프로젝트가 없어진 projectId는 미분류로 보아 빠진다', () => {
    const projects = [top];
    const drawings = [drawing('d_1', '도면.dxf', 'p_gone')];

    const result = drawingFoldersFor('p_top', projects, drawings);

    expect(result).toEqual([]);
  });

  it('하위 프로젝트 폴더 이름은 sanitize한다', () => {
    const slashChild = project('p_c', 'A/B교', 'p_top');
    const projects = [top, slashChild];
    const drawings = [drawing('d_1', '도면.dxf', 'p_c')];

    const result = drawingFoldersFor('p_top', projects, drawings);

    expect(result).toEqual([{ drawing: drawings[0], folder: 'A_B교/' }]);
  });

  it('하위 프로젝트 이름이 sanitize 후 겹치면 uniqueNames로 가른다', () => {
    const c1 = project('p_c1', 'A/B', 'p_top');
    const c2 = project('p_c2', 'A_B', 'p_top'); // sanitize 후 둘 다 'A_B'
    const projects = [top, c1, c2];
    const drawings = [drawing('d_1', '도면1.dxf', 'p_c1'), drawing('d_2', '도면2.dxf', 'p_c2')];

    const result = drawingFoldersFor('p_top', projects, drawings);

    // 이름순: 'A/B'와 'A_B'는 sanitize 전 원문 기준으로 정렬됨 — 폴더 이름이 겹치지 않는지만 확인한다.
    const folders = result.map((r) => r.folder);
    expect(new Set(folders).size).toBe(2);
    expect(folders.some((f) => f === 'A_B/')).toBe(true);
    expect(folders.some((f) => f === 'A_B (2)/')).toBe(true);
  });

  it('없는 프로젝트면 빈 배열', () => {
    expect(drawingFoldersFor('p_nope', [top], [])).toEqual([]);
  });
});

describe('baseNameOf', () => {
  it('확장자를 떼고 sanitize한다', () => {
    expect(baseNameOf('교량 A.dxf')).toBe('교량 A');
    expect(baseNameOf('교량/A.dxf')).toBe('교량_A');
  });

  it('확장자가 없어도 그대로 sanitize한다', () => {
    expect(baseNameOf('이름없음')).toBe('이름없음');
  });
});

describe('uniqueNames', () => {
  it('겹치지 않으면 그대로', () => {
    expect(uniqueNames(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('겹치면 확장자 앞에 (2), (3)을 붙인다', () => {
    expect(uniqueNames(['a.dxf', 'a.dxf', 'a.dxf'])).toEqual(['a.dxf', 'a (2).dxf', 'a (3).dxf']);
  });

  it('확장자가 없으면 끝에 붙인다', () => {
    expect(uniqueNames(['교량', '교량'])).toEqual(['교량', '교량 (2)']);
  });

  it('baseNameOf와 함께 쓰면 확장자만 다른 도면 이름도 가른다', () => {
    const names = ['교량.dxf', '교량.dwg'].map(baseNameOf);
    expect(uniqueNames(names)).toEqual(['교량', '교량 (2)']);
  });
});
