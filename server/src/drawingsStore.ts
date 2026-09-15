import { randomUUID } from 'node:crypto';
import type { FrameBounds } from './export/frames.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export type DrawingStatus = 'pending' | 'inprogress' | 'success' | 'failed';

export interface DrawingRecord {
  id: string;
  name: string;
  objectKey: string;
  urn: string;
  status: DrawingStatus;
  progress: string;
  error: string | null;
  uploadedAt: string;
  /**
   * 망도틀 영역(mm). DXF 업로드 때 원본에서 계산한다. DWG·계산 실패는 빈 배열이다.
   * 이 필드가 **없는** 레코드는 이 기능이 생기기 전에 올린 도면이고, GET /api/drawings가
   * 한 번 계산해 채운다(설계 3장). 표는 넣지 않는다 — 앱은 영역만 쓴다.
   */
  frames?: FrameBounds[];
}

export type DrawingPatch = Partial<Pick<DrawingRecord, 'status' | 'progress' | 'error' | 'frames'>>;

const DRAWING_ID_PATTERN = /^d_[0-9a-f]{32}$/;

export function newDrawingId(): string {
  return `d_${randomUUID().replaceAll('-', '')}`;
}

export function isDrawingId(value: string): boolean {
  return DRAWING_ID_PATTERN.test(value);
}

export class DrawingsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<DrawingRecord[]> {
    const records = await this.readAll();
    return records.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  async get(id: string): Promise<DrawingRecord | null> {
    return (await this.readAll()).find((r) => r.id === id) ?? null;
  }

  add(record: DrawingRecord): Promise<void> {
    return this.serialize(async () => {
      const records = await this.readAll();
      await writeJsonFileAtomic(this.filePath, [...records, record]);
    });
  }

  update(id: string, patch: DrawingPatch): Promise<DrawingRecord | null> {
    return this.serialize(async () => {
      const records = await this.readAll();
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return null;
      const updated = { ...records[index], ...patch };
      records[index] = updated;
      await writeJsonFileAtomic(this.filePath, records);
      return updated;
    });
  }

  private async readAll(): Promise<DrawingRecord[]> {
    return (await readJsonFile<DrawingRecord[]>(this.filePath)) ?? [];
  }

  // 읽고-고치고-쓰기가 겹쳐 레코드를 잃지 않도록 쓰기 작업을 한 줄로 세운다.
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
