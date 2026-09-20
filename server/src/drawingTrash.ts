// 도면 삭제는 **휴지통으로 옮기기**다(2026-09-18 사용자 결정: "복구할 수 있게 해줘"). 점검 데이터
// (손상 기록·사진)는 다시 만들 수 없으므로 서버는 스스로 아무것도 영구 삭제하지 않는다.
//
//   data/trash/<drawingId>/
//     record.json            { record, deletedAt }   ← 목록(drawings.json)에서 뺀 레코드
//     <objectKey>            원본 DXF/DWG            ← data/drawings/<objectKey>
//     damages.json           손상 기록               ← data/damages/<drawingId>.json
//     photos/                사진 폴더(썸네일 포함)   ← data/photos/<drawingId>/
//
// 도면 id는 UUID라 겹치지 않으므로 휴지통 폴더 이름으로 그대로 쓴다. 복구하면 폴더가 없어지므로
// 같은 도면을 다시 지워도 부딪히지 않는다. 영구 삭제 기능은 없다 — 디스크를 비우려면 사람이
// data/trash 아래 폴더를 직접 지운다.
//
// 순서가 중요하다(중간에 서버가 죽어도 데이터를 잃지 않게):
//   지우기: record.json 쓰기 → 목록에서 빼기 → 파일 옮기기. 목록에서 뺀 뒤 죽으면 파일 일부가 제자리에
//           남지만, 복구가 "휴지통에 없는 파일은 건너뛰기"라서 그대로 되살아난다.
//   복구:   파일 되돌리기 → 목록에 넣기 → 휴지통 폴더 지우기.

import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDrawingId, type DrawingRecord, type DrawingsStore } from './drawingsStore.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

// OriginalsStore와 같은 규칙. 경로 조각이 섞인 objectKey로 파일을 옮기지 않는다.
const OBJECT_KEY_PATTERN = /^d_[0-9a-f]{32}\.(dwg|dxf)$/;

export interface TrashedDrawing {
  id: string;
  name: string;
  uploadedAt: string;
  deletedAt: string;
}

interface TrashRecordFile {
  record: DrawingRecord;
  deletedAt: string;
}

export interface DrawingTrashDirs {
  trashDir: string;
  originalsDir: string;
  damagesDir: string;
  photosDir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

// from이 없으면 아무것도 안 한다(사진이 없는 도면, 손상을 한 번도 저장하지 않은 도면). to가 이미 있으면
// 덮어쓰지 않고 그대로 둔다 — 제자리에 있는 쪽이 최신이다(위 "순서" 참고).
async function moveIfPresent(from: string, to: string): Promise<void> {
  if (!(await exists(from)) || (await exists(to))) return;
  await rename(from, to);
}

export class DrawingTrash {
  constructor(
    private readonly dirs: DrawingTrashDirs,
    private readonly drawings: DrawingsStore,
  ) {}

  /** 도면을 휴지통으로 옮긴다. 없는 도면이면 null. */
  async moveToTrash(drawingId: string, deletedAt: string): Promise<TrashedDrawing | null> {
    const record = isDrawingId(drawingId) ? await this.drawings.get(drawingId) : null;
    if (!record) return null;
    const folder = this.folderFor(record.id);
    await mkdir(folder, { recursive: true });
    await writeJsonFileAtomic(join(folder, 'record.json'), { record, deletedAt } satisfies TrashRecordFile);
    await this.drawings.remove(record.id);

    if (OBJECT_KEY_PATTERN.test(record.objectKey)) {
      await moveIfPresent(join(this.dirs.originalsDir, record.objectKey), join(folder, record.objectKey));
    }
    await moveIfPresent(join(this.dirs.damagesDir, `${record.id}.json`), join(folder, 'damages.json'));
    await moveIfPresent(join(this.dirs.photosDir, record.id), join(folder, 'photos'));
    return { id: record.id, name: record.name, uploadedAt: record.uploadedAt, deletedAt };
  }

  /** 휴지통 목록. 최근에 지운 것이 위. record.json이 없는·깨진 폴더는 뺀다. */
  async list(): Promise<TrashedDrawing[]> {
    let names: string[];
    try {
      names = await readdir(this.dirs.trashDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const result: TrashedDrawing[] = [];
    for (const name of names.filter(isDrawingId)) {
      const saved = await this.readRecord(name);
      if (saved) {
        result.push({
          id: saved.record.id,
          name: saved.record.name,
          uploadedAt: saved.record.uploadedAt,
          deletedAt: saved.deletedAt,
        });
      }
    }
    return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  /** 휴지통의 도면을 되살린다. 휴지통에 없으면 null. */
  async restore(drawingId: string): Promise<DrawingRecord | null> {
    if (!isDrawingId(drawingId)) return null;
    const saved = await this.readRecord(drawingId);
    if (!saved) return null;
    const { record } = saved;
    const folder = this.folderFor(record.id);

    if (OBJECT_KEY_PATTERN.test(record.objectKey)) {
      await mkdir(this.dirs.originalsDir, { recursive: true });
      await moveIfPresent(join(folder, record.objectKey), join(this.dirs.originalsDir, record.objectKey));
    }
    await mkdir(this.dirs.damagesDir, { recursive: true });
    await moveIfPresent(join(folder, 'damages.json'), join(this.dirs.damagesDir, `${record.id}.json`));
    await mkdir(this.dirs.photosDir, { recursive: true });
    await moveIfPresent(join(folder, 'photos'), join(this.dirs.photosDir, record.id));

    if (!(await this.drawings.get(record.id))) await this.drawings.add(record);
    // 되돌릴 것을 다 되돌린 뒤에만 지운다. 남은 것은 record.json과(제자리 파일이 이겨서) 안 옮긴 사본뿐이다.
    await rm(folder, { recursive: true, force: true });
    return record;
  }

  private async readRecord(drawingId: string): Promise<TrashRecordFile | null> {
    const saved = await readJsonFile<TrashRecordFile>(join(this.folderFor(drawingId), 'record.json')).catch(
      () => null,
    );
    if (!saved || typeof saved.deletedAt !== 'string' || !saved.record || saved.record.id !== drawingId) return null;
    return saved;
  }

  private folderFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dirs.trashDir, drawingId);
  }
}
