// 손상 사진 파일을 서버에 보관한다. 연결은 폴더 구조가 곧 데이터다 —
// data/photos/<drawingId>/<damageId>/<사진번호><확장자>. 손상 기록(schemaVersion 5)은
// 바꾸지 않는다. 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 2장

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { comparePhotoNumbers } from '../public/viewer/quantities.js';
import { isDrawingId } from './drawingsStore.js';
import { writeFileAtomic } from './jsonFile.js';

// 뷰어가 crypto.randomUUID()로 만드는 손상 id 형식(main.js 305·319행). 판 번호는 따지지
// 않는다 — 이 검사의 목적은 '..'·'/'·'\' 같은 경로 조각을 막는 것이다(스펙 3장).
const DAMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** 썸네일 파일 이름 꼬리. 서버가 만드는 320px JPEG(photoThumb.ts). */
export const THUMB_SUFFIX = '.thumb.jpg';

// 받는 MIME과 디스크에 쓰는 확장자. 스펙 2장의 세 가지뿐이고 내용은 바꾸지 않는다.
// 스펙 2장이 파일을 `<사진번호>.jpg`로 적은 것은 JPEG일 때의 예시로 읽는다 — 파일 응답의
// Content-Type을 '저장 시 값'으로 돌려주려면(3장) 확장자가 남아 있어야 한다.
export const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
};

export const PHOTO_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
};

export interface PhotoEntry {
  damageId: string;
  number: string;
  /** 폴더 안의 파일 이름(확장자 포함). 경로를 만들 때만 쓴다. */
  file: string;
  size: number;
  /** 파일 mtime(ISO). 따로 기록을 두지 않는다 — 파일이 곧 데이터다. */
  savedAt: string;
}

export function isDamageId(value: unknown): boolean {
  return typeof value === 'string' && DAMAGE_ID_PATTERN.test(value);
}

export function isPhotoNumber(value: unknown): boolean {
  return typeof value === 'string' && PHOTO_NUMBER_PATTERN.test(value);
}

// 파일 이름을 번호와 확장자로 가른다. 규칙에 맞지 않는 이름은 null이다 — 손으로 넣은 파일이나
// writeFileAtomic이 남긴 `.tmp` 찌꺼기가 목록·zip에 섞이지 않는다.
function parsePhotoFile(file: string): { number: string; extension: string } | null {
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  const number = file.slice(0, dot);
  const extension = file.slice(dot).toLowerCase();
  if (!isPhotoNumber(number) || PHOTO_MIME_TYPES[extension] === undefined) return null;
  return { number, extension };
}

export class PhotosStore {
  constructor(private readonly dir: string) {}

  // 같은 번호의 옛 파일은 확장자가 달라도 지우고 새로 쓴다(스펙 2장 "다시 올리면 덮어쓴다").
  // 남겨 두면 같은 번호가 목록에 둘 보인다.
  async save(drawingId: string, damageId: string, number: string, extension: string, data: Buffer): Promise<void> {
    const folder = this.folderFor(drawingId, damageId);
    if (!isPhotoNumber(number)) throw new Error(`잘못된 사진번호: ${number}`);
    if (PHOTO_MIME_TYPES[extension] === undefined) throw new Error(`잘못된 확장자: ${extension}`);
    for (const old of await this.readFolder(folder)) {
      if (old.number === number && old.extension !== extension) {
        await rm(join(folder, `${old.number}${old.extension}`), { force: true });
      }
    }
    // 옛 썸네일도 지운다 — 새 본 사진의 썸네일 생성이 실패하면 옛 사진의 썸네일이 새 사진 행세를 한다.
    await rm(join(folder, `${number}${THUMB_SUFFIX}`), { force: true });
    await writeFileAtomic(join(folder, `${number}${extension}`), data);
  }

  // 본 사진 옆에 `<번호>.thumb.jpg`로 둔다. 이름에 '.'이 들어가 parsePhotoFile이 걸러내므로
  // 목록·zip에는 섞이지 않는다. 본 사진이 없는 번호에는 두지 않는다(고아 파일 방지).
  async saveThumb(drawingId: string, damageId: string, number: string, data: Buffer): Promise<void> {
    const entry = await this.find(drawingId, damageId, number);
    if (!entry) throw new Error(`본 사진이 없는 번호: ${number}`);
    await writeFileAtomic(this.thumbPathOf(drawingId, entry), data);
  }

  /** 썸네일 바이트. 아직 없으면 null — 호출부가 본 사진에서 만들어 saveThumb로 채운다. */
  async readThumb(drawingId: string, entry: PhotoEntry): Promise<Buffer | null> {
    try {
      return await readFile(this.thumbPathOf(drawingId, entry));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  thumbPathOf(drawingId: string, entry: PhotoEntry): string {
    if (parsePhotoFile(entry.file) === null) throw new Error(`잘못된 사진 파일 이름: ${entry.file}`);
    return join(this.folderFor(drawingId, entry.damageId), `${entry.number}${THUMB_SUFFIX}`);
  }

  async list(drawingId: string, damageId: string): Promise<PhotoEntry[]> {
    const folder = this.folderFor(drawingId, damageId);
    const entries: PhotoEntry[] = [];
    for (const parsed of await this.readFolder(folder)) {
      const file = `${parsed.number}${parsed.extension}`;
      const info = await stat(join(folder, file));
      entries.push({
        damageId,
        number: parsed.number,
        file,
        size: info.size,
        savedAt: info.mtime.toISOString(),
      });
    }
    return entries.sort((a, b) => comparePhotoNumbers(a.number, b.number));
  }

  async find(drawingId: string, damageId: string, number: string): Promise<PhotoEntry | null> {
    if (!isPhotoNumber(number)) throw new Error(`잘못된 사진번호: ${number}`);
    return (await this.list(drawingId, damageId)).find((entry) => entry.number === number) ?? null;
  }

  // 도면 폴더 아래 모든 손상 폴더의 사진. 손상 기록에 없는 폴더(지운 손상)도 그대로 담는다 —
  // zip이 `삭제된손상_…`으로 넣어 사진을 버리지 않기 위해서다(스펙 3장).
  async listDrawing(drawingId: string): Promise<PhotoEntry[]> {
    const folder = this.drawingFolderFor(drawingId);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const result: PhotoEntry[] = [];
    for (const name of names.filter(isDamageId).sort()) {
      result.push(...(await this.list(drawingId, name)));
    }
    return result;
  }

  // 디스크 경로를 만드는 유일한 출구. entry는 list·find가 돌려준 것만 넣지만 그래도 이름을
  // 다시 검사한다(호출부를 믿지 않는 편이 싸다). zip(Task 3)이 이 경로를 스트림으로 읽는다.
  pathOf(drawingId: string, entry: PhotoEntry): string {
    if (parsePhotoFile(entry.file) === null) throw new Error(`잘못된 사진 파일 이름: ${entry.file}`);
    return join(this.folderFor(drawingId, entry.damageId), entry.file);
  }

  async readData(drawingId: string, entry: PhotoEntry): Promise<Buffer> {
    return readFile(this.pathOf(drawingId, entry));
  }

  private folderFor(drawingId: string, damageId: string): string {
    if (!isDamageId(damageId)) throw new Error(`잘못된 손상 id: ${damageId}`);
    return join(this.drawingFolderFor(drawingId), damageId);
  }

  private drawingFolderFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, drawingId);
  }

  private async readFolder(folder: string): Promise<{ number: string; extension: string }[]> {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const parsed: { number: string; extension: string }[] = [];
    for (const name of names) {
      const entry = parsePhotoFile(name);
      if (entry) parsed.push(entry);
    }
    return parsed;
  }
}
