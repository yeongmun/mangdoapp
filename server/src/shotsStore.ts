// 촬영 항목(shot) — 구조물(하위 프로젝트)마다 "찍을 사진" 목록과 찍은 사진 파일(2026-10-24).
// required = 시설물 종류별 필수 사진(config/requiredShots.json), previous = 전차보고서에서 뽑은 사진(3단계).
// 망도 손상 사진(photosStore.ts)과는 별개다. 저장: data/shots/<projectId>.json + data/shots/<projectId>/<번호>.jpg
// 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 3·서버(앱)

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, writeFileAtomic, writeJsonFileAtomic } from './jsonFile.js';

export type ShotKind = 'required' | 'previous';

export interface Shot {
  id: string;
  kind: ShotKind;
  /** 부재(전경·교대·교각…). 파일명의 가운데 토막 */
  member: string;
  /** 설명(상류측·A1 전면…) */
  label: string;
  /** 구조물 안의 일련번호, 3자리. 파일명의 끝 토막 */
  number: string;
  photo?: { file: string; savedAt: string };
}

export interface ShotTemplateItem {
  member: string;
  label: string;
}

export const THUMB_SUFFIX = '.thumb.jpg';

function newShotId(): string {
  return `s_${randomUUID().replaceAll('-', '')}`;
}

export function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** 파일명에 못 쓰는 글자(Windows 기준)를 _ 로. 앞뒤 공백은 뗀다 */
function safe(text: string): string {
  return text.trim().replace(/[\\/:*?"<>|]/g, '_');
}

/** `<구조물이름>_<부재>_<번호>.jpg` — zip·내려받기 때의 이름. 디스크 이름은 번호뿐이다 */
export function shotFileName(projectName: string, shot: Shot): string {
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}.jpg`;
}

/**
 * 시설물 종류의 필수 목록(template)을 기존 항목에 맞춰 넣는다. 순수 함수.
 * - previous 항목과 찍은(required) 항목은 그대로 남긴다.
 * - 안 찍은 required 항목은 template 순서대로 다시 만든다. 같은 member+label이 이미 있으면 id·번호를 유지한다.
 * - 새 번호는 남은 항목의 최대 번호 다음부터.
 */
export function mergeRequired(existing: Shot[], template: ShotTemplateItem[]): Shot[] {
  const kept = existing.filter((s) => s.kind !== 'required' || s.photo !== undefined);
  const untakenRequired = existing.filter((s) => s.kind === 'required' && s.photo === undefined);
  const keyOf = (s: { member: string; label: string }) => `${s.member}\u0000${s.label}`;
  const keptKeys = new Set(kept.filter((s) => s.kind === 'required').map(keyOf));
  const reusable = new Map(untakenRequired.map((s) => [keyOf(s), s]));
  let next = kept.reduce((max, s) => Math.max(max, Number(s.number) || 0), 0);
  const out = [...kept];
  for (const item of template) {
    if (keptKeys.has(keyOf(item))) continue;
    const reuse = reusable.get(keyOf(item));
    if (reuse) {
      out.push(reuse);
      next = Math.max(next, Number(reuse.number) || 0);
      continue;
    }
    next += 1;
    out.push({ id: newShotId(), kind: 'required', member: item.member, label: item.label, number: pad3(next) });
  }
  return out;
}

export function loadRequiredTemplate(configPath: string): Promise<Record<string, ShotTemplateItem[]>> {
  return readFile(configPath, 'utf8').then((text) => {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const out: Record<string, ShotTemplateItem[]> = {};
    for (const [type, items] of Object.entries(parsed)) {
      out[type] = (Array.isArray(items) ? items : [])
        .filter((i): i is ShotTemplateItem => typeof i?.member === 'string' && typeof i?.label === 'string')
        .map((i) => ({ member: i.member, label: i.label }));
    }
    return out;
  });
}

export class ShotsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  private jsonPath(projectId: string): string {
    return join(this.rootDir, `${projectId}.json`);
  }

  private dirOf(projectId: string): string {
    return join(this.rootDir, projectId);
  }

  async list(projectId: string): Promise<Shot[]> {
    const data = await readJsonFile<{ shots?: Shot[] }>(this.jsonPath(projectId));
    return Array.isArray(data?.shots) ? data.shots : [];
  }

  replace(projectId: string, shots: Shot[]): Promise<void> {
    return this.serialize(async () => {
      await mkdir(this.rootDir, { recursive: true });
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
    });
  }

  /** 디스크의 본 사진 경로. photo가 없으면 번호 기준 이름(없을 수 있다) */
  pathOf(projectId: string, shot: Shot): string {
    return join(this.dirOf(projectId), shot.photo?.file ?? `${shot.number}.jpg`);
  }

  thumbPathOf(projectId: string, shot: Shot): string {
    return join(this.dirOf(projectId), `${shot.number}${THUMB_SUFFIX}`);
  }

  /** 사진을 쓰고 shot.photo를 채운다. 같은 shot을 다시 찍으면 덮어쓴다. 없는 shot이면 null */
  savePhoto(projectId: string, shotId: string, extension: string, data: Buffer, savedAt: string): Promise<Shot | null> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      const index = shots.findIndex((s) => s.id === shotId);
      if (index === -1) return null;
      await mkdir(this.dirOf(projectId), { recursive: true });
      const file = `${shots[index].number}${extension}`;
      await writeFileAtomic(join(this.dirOf(projectId), file), data);
      const updated: Shot = { ...shots[index], photo: { file, savedAt } };
      shots[index] = updated;
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      return updated;
    });
  }

  async saveThumb(projectId: string, shot: Shot, thumb: Buffer): Promise<void> {
    await mkdir(this.dirOf(projectId), { recursive: true });
    await writeFileAtomic(this.thumbPathOf(projectId, shot), thumb);
  }

  async readThumb(projectId: string, shot: Shot): Promise<Buffer | null> {
    try {
      return await readFile(this.thumbPathOf(projectId, shot));
    } catch {
      return null;
    }
  }

  async readPhoto(projectId: string, shot: Shot): Promise<Buffer | null> {
    if (!shot.photo) return null;
    try {
      return await readFile(this.pathOf(projectId, shot));
    } catch {
      return null;
    }
  }

  async hasPhotoFile(projectId: string, shot: Shot): Promise<boolean> {
    if (!shot.photo) return false;
    try {
      await stat(this.pathOf(projectId, shot));
      return true;
    } catch {
      return false;
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
