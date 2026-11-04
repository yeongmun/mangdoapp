// 촬영 항목(shot) — 구조물(하위 프로젝트)마다 "찍을 사진" 목록과 찍은 사진 파일(2026-10-24).
// required = 시설물 종류별 필수 사진(config/requiredShots.json), previous = 전차보고서에서 뽑은 사진(3단계).
// 망도 손상 사진(photosStore.ts)과는 별개다. 저장: data/shots/<projectId>.json + data/shots/<projectId>/<번호>.jpg
// 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 3·서버(앱)

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { memberOfCaption, type PhotoBlock } from './hwpxPhotos.js';
import { readJsonFile, writeFileAtomic, writeJsonFileAtomic } from './jsonFile.js';
import { parseFacilityTemplate, type FacilityTemplate } from './requiredShots.js';

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
  /** 대표 사진(= photos[0]). 옛 기록·웹(daenong)이 이것만 읽는다 */
  photo?: { file: string; savedAt: string };
  /** 이 칸의 사진 전부(2026-11-05, 한 칸 여러 장). 첫 장이 대표. 옛 기록엔 없다 — photosOf()로 읽는다 */
  photos?: ShotPhoto[];
  /** required만: 템플릿 항목 이름표("부재|설명", 위치 붙기 전) — 예시 사진을 찾는 열쇠 */
  templateKey?: string;
  /** previous만: 보고서 페이지 id(pg_001…). 휴지통은 이 단위로 */
  group?: string;
  /** previous만: 보고서 캡션 원문 */
  caption?: string;
  /** previous만: 참조 이미지(보고서에서 뽑은 그림), ref/ 아래 파일명 */
  ref?: { file: string };
  /** 페이지 휴지통. 복구하면 키를 지운다 */
  trashed?: true;
  /** required만: 점검 포인트(세부지침 1.2.1). 앱 칸에 작게 보인다 */
  hint?: string;
}

export interface ShotPhoto {
  /** 기기가 만든 id(재전송해도 같은 사진으로 덮어쓴다). 옛 사진은 'p0' */
  id: string;
  file: string;
  savedAt: string;
}

export const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;

/** 칸의 사진 목록(옛 기록은 photo 하나를 'p0'으로) */
export function photosOf(shot: Shot): ShotPhoto[] {
  if (Array.isArray(shot.photos) && shot.photos.length > 0) return shot.photos;
  return shot.photo ? [{ id: 'p0', file: shot.photo.file, savedAt: shot.photo.savedAt }] : [];
}

/** 사진 목록을 칸에 넣는다 — 대표(photo)는 첫 장, 비면 둘 다 지운다 */
function withPhotos(shot: Shot, photos: ShotPhoto[]): Shot {
  const { photo: _p, photos: _ps, ...rest } = shot;
  void _p;
  void _ps;
  if (photos.length === 0) return rest as Shot;
  return { ...rest, photo: { file: photos[0].file, savedAt: photos[0].savedAt }, photos } as Shot;
}

/** 펼친 뒤의 촬영 칸 하나(requiredShots.ts expandRequired의 결과) */
export interface ShotTemplateItem {
  member: string;
  label: string;
  hint?: string;
  /** 예전 설명 — 이 이름으로 이미 만든(찍은) 칸은 새 설명으로 옮긴다(이름을 바꿔도 칸이 둘이 되지 않게, 11-03) */
  aliases?: string[];
  /** 템플릿 항목 이름표(예시 사진 열쇠). expandRequired가 채운다 */
  key?: string;
}

export const THUMB_SUFFIX = '.thumb.jpg';
export const SHOT_MEMBER_MAX = 40;
export const SHOT_LABEL_MAX = 120;

/** 입력값 규칙 위반(부재명·설명). 라우트는 400으로 답한다 */
export class ShotRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShotRuleError';
  }
}

function validateShotText(value: unknown, what: string, max: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || trimmed.length < 1 || trimmed.length > max) {
    throw new ShotRuleError(`${what}은(는) 1~${max}자로 적어 주세요.`);
  }
  return trimmed;
}

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
export function shotFileName(projectName: string, shot: Shot, photo?: ShotPhoto): string {
  // 둘째 장부터는 디스크 이름의 "-2"를 그대로 붙인다: A교_교각(P1)_017-2.jpg
  const suffix = photo ? (/^\d+(-\d+)\./.exec(photo.file)?.[1] ?? '') : '';
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}${suffix}.jpg`;
}

/**
 * 시설물 종류의 필수 목록(template)을 기존 항목에 맞춰 넣는다. 순수 함수.
 * - previous 항목과 찍은(required) 항목은 그대로 남긴다.
 * - 안 찍은 required 항목은 template 순서대로 다시 만든다. 같은 member+label이 이미 있으면 id·번호를 유지한다.
 * - 새 번호는 남은 항목의 최대 번호 다음부터.
 */
export function mergeRequired(existingRaw: Shot[], template: ShotTemplateItem[]): Shot[] {
  const existing = renameAliased(existingRaw, template);
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
      out.push(withHint(reuse, item.hint));
      continue;
    }
    next += 1;
    out.push(withHint({ id: newShotId(), kind: 'required', member: item.member, label: item.label, number: pad3(next) }, item.hint));
  }
  // 템플릿 이름표(예시 사진 열쇠)를 칸에 적는다 — 찍은 칸도 같은 부재·설명이면
  const keys = new Map(template.filter((i) => i.key).map((i) => [keyOf(i), i.key!]));
  return out.map((shot) => {
    if (shot.kind !== 'required') return shot;
    const k = keys.get(keyOf(shot));
    return k && shot.templateKey !== k ? { ...shot, templateKey: k } : shot;
  });
}

/** 템플릿 항목의 예전 설명(aliases)으로 된 required 칸을 새 설명으로 바꾼다. 새 이름 칸이 이미 있으면 그대로 둔다 */
export function renameAliased(existing: Shot[], template: ShotTemplateItem[]): Shot[] {
  const rename = new Map<string, string>();
  for (const item of template) for (const old of item.aliases ?? []) rename.set(`${item.member}\u0000${old}`, item.label);
  if (rename.size === 0) return existing;
  const present = new Set(existing.filter((s) => s.kind === 'required').map((s) => `${s.member}\u0000${s.label}`));
  return existing.map((s) => {
    if (s.kind !== 'required') return s;
    const to = rename.get(`${s.member}\u0000${s.label}`);
    if (to === undefined || present.has(`${s.member}\u0000${to}`)) return s;
    present.add(`${s.member}\u0000${to}`);
    return { ...s, label: to };
  });
}

/** 안 찍은 칸의 점검 포인트는 템플릿을 따른다(템플릿에서 지우면 칸에서도 지운다) */
function withHint(shot: Shot, hint: string | undefined): Shot {
  const { hint: _old, ...rest } = shot;
  void _old;
  return hint ? { ...rest, hint } : rest;
}

/** 설정 파일이 없거나 JSON이 깨져도 서버는 떠야 한다(리뷰 3) — 로그만 남기고 빈 목록으로 간다. 고치면 재시작.
 *  "_"로 시작하는 키(_설명 등)는 시설물 종류가 아니다. */
export async function loadRequiredTemplate(configPath: string): Promise<Record<string, FacilityTemplate>> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    console.error('[shots] 필수 사진 목록을 읽지 못했습니다 — 빈 목록으로 시작합니다:', configPath, err instanceof Error ? err.message : String(err));
    return {};
  }
  const out: Record<string, FacilityTemplate> = {};
  for (const [type, value] of Object.entries(parsed)) {
    if (type.startsWith('_')) continue;
    out[type] = parseFacilityTemplate(value);
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
   * 전차보고서 블록을 previous shot으로 넣는다. 전에 올린 previous 중 안 찍은 것은 **지우지 않고 휴지통**으로
   * 보낸다 — 오프라인에서 찍어 아직 대기열에 있는 사진이 나중에 올라올 자리를 남기기 위해(리뷰 3). 찍은
   * previous와 required는 그대로. 페이지 id는 올린 회차 접두사(r1_, r2_…)를 붙여 회차끼리 섞이지 않게 한다(리뷰 2).
   * 번호는 남은 항목 최대 다음부터. 참조 이미지는 ref/<shotId><ext>로 저장(썸네일은 라우트가 만든다).
   */
  importPrevious(projectId: string, blocks: PhotoBlock[], savedAt: string): Promise<{ shots: Shot[]; added: number }> {
    return this.serialize(async () => {
      const current = await this.list(projectId);
      const kept = current.map((s) => (s.kind === 'previous' && s.photo === undefined && s.trashed !== true ? ({ ...s, trashed: true } as Shot) : s));
      const round =
        kept.reduce((max, s) => {
          const m = /^r(\d+)_/.exec(s.group ?? '');
          return m ? Math.max(max, Number(m[1])) : max;
        }, 0) + 1;
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
            group: `r${round}_${block.page}`,
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

  /** 부재명·설명 수정(웹 과업 상세). 준 키만 바꾼다. 없는 shot이면 null, 값이 틀리면 ShotRuleError */
  update(projectId: string, shotId: string, patch: { member?: unknown; label?: unknown }): Promise<Shot | null> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      const index = shots.findIndex((s) => s.id === shotId);
      if (index === -1) return null;
      const next: Shot = { ...shots[index] };
      if ('member' in patch) next.member = validateShotText(patch.member, '부재명', SHOT_MEMBER_MAX);
      if ('label' in patch) next.label = validateShotText(patch.label, '설명', SHOT_LABEL_MAX);
      shots[index] = next;
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      return next;
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

  /** 디스크의 대표 사진 경로. photo가 없으면 번호 기준 이름(없을 수 있다) */
  pathOf(projectId: string, shot: Shot): string {
    return join(this.dirOf(projectId), shot.photo?.file ?? `${shot.number}.jpg`);
  }

  photoPathOf(projectId: string, photo: ShotPhoto): string {
    return join(this.dirOf(projectId), photo.file);
  }

  /** 사진별 썸네일: <파일 이름에서 확장자 뺀 것>.thumb.jpg — 대표 첫 장(017.jpg)은 옛 이름 017.thumb.jpg와 같다 */
  photoThumbPathOf(projectId: string, photo: ShotPhoto): string {
    return join(this.dirOf(projectId), `${photo.file.replace(/\.[^.]+$/, '')}${THUMB_SUFFIX}`);
  }

  thumbPathOf(projectId: string, shot: Shot): string {
    const first = photosOf(shot)[0];
    return first ? this.photoThumbPathOf(projectId, first) : join(this.dirOf(projectId), `${shot.number}${THUMB_SUFFIX}`);
  }

  /**
   * 사진을 쓴다(2026-11-05 한 칸 여러 장).
   * - photoId가 이미 있으면 그 사진을 덮어쓴다(대기열 재전송이 두 장을 만들지 않게)
   * - 새 photoId면 뒤에 덧붙인다: 첫 장 <번호>.jpg, 그다음 <번호>-2.jpg …
   * - photoId 없이 오면(옛 앱) 예전처럼 대표 사진을 바꾼다
   * 없는 shot이면 null
   */
  savePhoto(projectId: string, shotId: string, extension: string, data: Buffer, savedAt: string, photoId?: string): Promise<{ shot: Shot; photo: ShotPhoto } | null> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      const index = shots.findIndex((s) => s.id === shotId);
      if (index === -1) return null;
      const shot = shots[index];
      const photos = [...photosOf(shot)];
      const number = shot.number;
      let at = photoId ? photos.findIndex((p) => p.id === photoId) : photos.length > 0 ? 0 : -1;
      let base: string;
      if (at >= 0) {
        base = photos[at].file.replace(/\.[^.]+$/, '');
      } else {
        const used = photos.map((p) => Number(/^\d+-(\d+)\./.exec(p.file)?.[1] ?? 1));
        const n = photos.length === 0 ? 1 : Math.max(1, ...used) + 1;
        base = n === 1 ? number : `${number}-${n}`;
      }
      const file = `${base}${extension}`;
      await mkdir(this.dirOf(projectId), { recursive: true });
      await writeFileAtomic(join(this.dirOf(projectId), file), data);
      const photo: ShotPhoto = { id: photoId ?? (at >= 0 ? photos[at].id : 'p0'), file, savedAt };
      if (at >= 0) {
        // 확장자가 바뀌었으면 옛 파일은 지운다
        if (photos[at].file !== file) await rm(join(this.dirOf(projectId), photos[at].file), { force: true });
        photos[at] = photo;
      } else {
        photos.push(photo);
        at = photos.length - 1;
      }
      const updated = withPhotos(shot, photos);
      shots[index] = updated;
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      return { shot: updated, photo };
    });
  }

  /** 사진 한 장 지우기(파일·썸네일도). 대표를 지우면 다음 장이 대표. 없으면 null */
  deletePhoto(projectId: string, shotId: string, photoId: string): Promise<Shot | null> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      const index = shots.findIndex((s) => s.id === shotId);
      if (index === -1) return null;
      const photos = photosOf(shots[index]);
      const gone = photos.find((p) => p.id === photoId);
      if (!gone) return null;
      await rm(this.photoPathOf(projectId, gone), { force: true });
      await rm(this.photoThumbPathOf(projectId, gone), { force: true });
      const updated = withPhotos(shots[index], photos.filter((p) => p.id !== photoId));
      shots[index] = updated;
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      return updated;
    });
  }

  /** 대표 사진 바꾸기(그 사진을 맨 앞으로). 없으면 null */
  setPrimaryPhoto(projectId: string, shotId: string, photoId: string): Promise<Shot | null> {
    return this.serialize(async () => {
      const shots = await this.list(projectId);
      const index = shots.findIndex((s) => s.id === shotId);
      if (index === -1) return null;
      const photos = photosOf(shots[index]);
      const chosen = photos.find((p) => p.id === photoId);
      if (!chosen) return null;
      const updated = withPhotos(shots[index], [chosen, ...photos.filter((p) => p.id !== photoId)]);
      shots[index] = updated;
      await writeJsonFileAtomic(this.jsonPath(projectId), { projectId, shots });
      return updated;
    });
  }

  async savePhotoThumb(projectId: string, photo: ShotPhoto, thumb: Buffer): Promise<void> {
    await mkdir(this.dirOf(projectId), { recursive: true });
    await writeFileAtomic(this.photoThumbPathOf(projectId, photo), thumb);
  }

  async readPhotoThumb(projectId: string, photo: ShotPhoto): Promise<Buffer | null> {
    try {
      return await readFile(this.photoThumbPathOf(projectId, photo));
    } catch {
      return null;
    }
  }

  async readPhotoFile(projectId: string, photo: ShotPhoto): Promise<Buffer | null> {
    try {
      return await readFile(this.photoPathOf(projectId, photo));
    } catch {
      return null;
    }
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
