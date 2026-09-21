// 프로젝트 단위 묶음 내려받기(사진 zip·DXF zip)의 이름 짓기. 파일 I/O가 없는 순수 함수라
// 손으로 계산한 값으로 검사할 수 있다. 근거: docs/superpowers/specs/2026-09-21-projects-design.md 4장

import type { DrawingRecord } from './drawingsStore.js';
import { sanitizeEntryName } from './photoZip.js';
import type { ProjectRecord } from './projectsStore.js';
import { effectiveProjectId } from './projectTree.js';

export interface DrawingFolder {
  drawing: DrawingRecord;
  /** '' (고른 프로젝트에 바로 든 도면) | '<하위 이름>/' (하위 프로젝트의 도면) */
  folder: string;
}

function byKoName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'ko');
}

// 확장자를 뗀 뒤 zip 항목 이름으로 안전하게 고친다. photoZip.ts의 sanitizeEntryName과 같은
// 규칙을 쓴다 — 항목 이름 규칙이 zip 종류마다 갈리지 않는다.
export function baseNameOf(drawingName: string): string {
  return sanitizeEntryName(String(drawingName).replace(/\.[^.]*$/, ''));
}

/**
 * 이름이 겹치면 확장자 앞에 ` (2)`, ` (3)`…을 붙인다(확장자가 없으면 끝에). photoZip.ts의
 * 겹침 처리(zipEntryNamesFor)와 같은 규칙이다.
 */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = String(raw);
    const dot = name.lastIndexOf('.');
    const base = dot <= 0 ? name : name.slice(0, dot);
    const ext = dot <= 0 ? '' : name.slice(dot);
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate);
    result.push(candidate);
  }
  return result;
}

/**
 * 고른 프로젝트에 바로 든 도면(folder '') 먼저, 이어서 하위 프로젝트(이름순)의 도면
 * (folder '<sanitize(하위 이름)>/'). 각 묶음 안은 도면 이름순. 다른 프로젝트·미분류 도면,
 * 없는 projectId는 빠진다. 하위 프로젝트 이름이 sanitize 후 겹치면 uniqueNames로 가른다.
 */
export function drawingFoldersFor(
  projectId: string,
  projects: ProjectRecord[],
  drawings: DrawingRecord[],
): DrawingFolder[] {
  const project = projects.find((p) => p.id === projectId);
  if (!project) return [];

  const result: DrawingFolder[] = [];
  const own = drawings.filter((d) => effectiveProjectId(d.projectId, projects) === projectId).sort(byKoName);
  for (const drawing of own) result.push({ drawing, folder: '' });

  const children = projects.filter((p) => p.parentId === projectId).sort(byKoName);
  const folderNames = uniqueNames(children.map((c) => sanitizeEntryName(c.name)));
  children.forEach((child, index) => {
    const folder = `${folderNames[index]}/`;
    const bucket = drawings.filter((d) => effectiveProjectId(d.projectId, projects) === child.id).sort(byKoName);
    for (const drawing of bucket) result.push({ drawing, folder });
  });

  return result;
}
