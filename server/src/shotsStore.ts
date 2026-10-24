// 촬영 항목(shot) — 구조물(하위 프로젝트)마다 "찍을 사진" 목록과 찍은 사진 파일(2026-10-24).
// required = 시설물 종류별 필수 사진(config/requiredShots.json), previous = 전차보고서에서 뽑은 사진(3단계).
// 망도 손상 사진(photosStore.ts)과는 별개다. 저장: data/shots/<projectId>.json + data/shots/<projectId>/<번호>.jpg
// 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 3·서버(앱)

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { memberOfCaption, type PhotoBlock } from './hwpxPhotos.js';
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
  /** previous만: 보고서 페이지 id(pg_001…). 휴지통은 이 단위로 */
  group?: string;
  /** previous만: 보고서 캡션 원문 */
  caption?: string;
  /** previous만: 참조 이미지(보고서에서 뽑은 그림), ref/ 아래 파일명 */
  ref?: { file: string };
  /** 페이지 휴지통. 복구하면 키를 지운다 */
  trashed?: true;
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
  // 새 번호는 남는 항목(찍은 것 + 재사용되는 것) 전부의 최대 다음부터 — 재사용 번호를 새 항목이
  // 가로채면 같은 디스크 파일을 둘이 쓰게 된다(리뷰 2).
  const reused = template.filter((item) => !keptKeys.has(keyOf(item))).map((item) => reusable.get(keyOf(item))).filter((s): s is Shot => s !== undefined);
  let next = [...kept, ...reused].reduce((max, s) => Math.max(max, Number(s.number) || 0), 0);
  const out = [...kept];
  for (const item of template) {
    if (keptKeys.has(keyOf(item))) continue;
    const reuse = reusable.get(keyOf(item));
    if (reuse) {
      out.push(reuse);
      continue;
    }
    next += 1;
    out.push({ id: newShotId(), kind: 'required', member: item.member, label: item.label, number: pad3(next) });
  }
  return out;
}

/** 설정 파일이 없거나 JSON이 깨져도 서버는 떠야 한다(리뷰 3) — 로그만 남기고 빈 목록으로 간다. 고치면 재시작. */
export async function loadRequiredTemplate(configPath: string): Promise<Record<string, ShotTemplateItem[]>> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    console.error('[shots] 필수 사진 목록을 읽지 못했습니다 — 빈 목록으로 시작합니다:', configPath, err instanceof Error ? err.message : String(err));
    return {};
  }
  const out: Record<string, ShotTemplateItem[]> = {};
  for (const [type, items] of Object.entries(parsed)) {
    out[type] = (Array.isArray(items) ? items : [])
      .filter((i): i is ShotTemplateItem => typeof i?.member === 'string' && typeof i?.label === 'string')
      .map((i) => ({ member: i.member, label: i.label }));
  }
  return out;
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

  /** 필수 목록을 맞춰 넣고 결과를 돌려준다. 읽기-합치기-쓰기를 한 줄로 세워(serialize) 동시 요청이 다른 id를 만들지 않게 한다(리뷰 4). */
  ensureRequired(projectId: string, template: ShotTemplateItem[]): Promise<Shot[]> {
    return this.serialize(async () => {
      const current = await this.list(projectId);
      const merged = mergeRequired(current, template);
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        await mkdir(this.rootDir, { recursive: true });
        await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots: merged });
      }
      return merged;
    });
  }

  replace(projectId: string, shots: Shot[]): Promise<void> {
    return this.serialize(async () => {
      await mkdir(this.rootDir, { recursive: true });
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
    });
  }

  refPathOf(projectId: string, shot: Shot): string {
    return join(this.dirOf(projectId), 'ref', shot.ref?.file ?? `${shot.id}.png`);
  }

  refThumbPathOf(projectId: string, shot: Shot): string {
    return join(this.dirOf(projectId), 'ref', `${shot.id}${THUMB_SUFFIX}`);
  }

  async readRef(projectId: string, shot: Shot): Promise<Buffer | null> {
    if (!shot.ref) return null;
    try {
      return await readFile(this.refPathOf(projectId, shot));
    } catch {
      return null;
    }
  }

  async readRefThumb(projectId: string, shot: Shot): Promise<Buffer | null> {
    try {
      return await readFile(this.refThumbPathOf(projectId, shot));
    } catch {
      return null;
    }
  }

  async saveRefThumb(projectId: string, shot: Shot, thumb: Buffer): Promise<void> {
    await mkdir(join(this.dirOf(projectId), 'ref'), { recursive: true });
    await writeFileAtomic(this.refThumbPathOf(projectId, shot), thumb);
  }

  /**
   * 전차보고서 블록을 previous shot으로 넣는다. 안 찍은 previous는 전부 교체하고, 찍은 previous와 required는
   * 남긴다. 번호는 남은 항목 최대 다음부터. 참조 이미지는 ref/<shotId><ext>로 저장(썸네일은 라우트가 만든다).
   */
  importPrevious(projectId: string, blocks: PhotoBlock[], savedAt: string): Promise<{ shots: Shot[]; added: number }> {
    return this.serialize(async () => {
      const current = await this.list(projectId);
      const kept = current.filter((s) => s.kind !== 'previous' || s.photo !== undefined);
      let next = kept.reduce((max, s) => Math.max(max, Number(s.number) || 0), 0);
      const refDir = join(this.dirOf(projectId), 'ref');
      await mkdir(refDir, { recursive: true });
      const added: Shot[] = [];
      let photoNo = 0;
      for (const block of blocks) {
        for (const image of block.images) {
          photoNo += 1;
          next += 1;
          const id = newShotId();
          const file = `${id}${image.ext}`;
          await writeFileAtomic(join(refDir, file), image.data);
          const shot: Shot = {
            id,
            kind: 'previous',
            member: memberOfCaption(image.caption),
            label: image.caption ?? `사진 ${photoNo}`,
            number: pad3(next),
            group: block.page,
            ref: { file },
          };
          if (image.caption) shot.caption = image.caption;
          added.push(shot);
        }
      }
      const shots = [...kept, ...added];
      await mkdir(this.rootDir, { recursive: true });
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      void savedAt;
      return { shots, added: added.length };
    });
  }

  /** 페이지(group) 단위 휴지통. 파일은 건드리지 않는다. 바뀐 항목 수를 돌려준다 */
  setGroupTrashed(projectId: string, group: string, trashed: boolean): Promise<number> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      let changed = 0;
      const next = shots.map((s) => {
        if (s.group !== group) return s;
        changed += 1;
        const { trashed: _old, ...rest } = s;
        void _old;
        return trashed ? ({ ...rest, trashed: true } as Shot) : (rest as Shot);
      });
      if (changed > 0) await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots: next });
      return changed;
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
