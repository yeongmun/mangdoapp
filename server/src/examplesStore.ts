// 예시 사진(2026-11-05) — 시설물 종류 + 템플릿 항목(templateKey "부재|설명")마다 한 장. 모든 구조물이 같이 쓴다.
// 찍은 사진에서 「이 사진을 예시로」로 지정한다(앱 크게 보기). 앱 카메라 오른쪽 위 작은 창·필수 사진 칸 「예시」 표시에 쓴다.
// 저장: data/examples/index.json + data/examples/<id>.<ext>, <id>.thumb.jpg (id = 시설물|열쇠의 sha1 앞 16자리)

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonFile, writeFileAtomic, writeJsonFileAtomic } from './jsonFile.js';

export interface ExampleRecord {
  id: string;
  facilityType: string;
  templateKey: string;
  file: string;
  savedAt: string;
  /** 어느 사진에서 지정했는지(기록용) */
  source?: { projectId: string; shotId: string; photoId: string };
}

export function exampleIdOf(facilityType: string, templateKey: string): string {
  return createHash('sha1').update(`${facilityType}\u0000${templateKey}`).digest('hex').slice(0, 16);
}

export const EXAMPLE_ID_PATTERN = /^[0-9a-f]{16}$/;

export class ExamplesStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  private indexPath(): string {
    return join(this.rootDir, 'index.json');
  }

  async all(): Promise<ExampleRecord[]> {
    const data = await readJsonFile<{ examples?: ExampleRecord[] }>(this.indexPath());
    return Array.isArray(data?.examples) ? data.examples : [];
  }

  /** 시설물 종류의 예시들(templateKey → 기록) */
  async forFacility(facilityType: string): Promise<Map<string, ExampleRecord>> {
    return new Map((await this.all()).filter((e) => e.facilityType === facilityType).map((e) => [e.templateKey, e]));
  }

  async get(id: string): Promise<ExampleRecord | null> {
    return (await this.all()).find((e) => e.id === id) ?? null;
  }

  /** 지정(있으면 바꾼다). 썸네일은 부르는 쪽이 만들어 준다 */
  set(input: { facilityType: string; templateKey: string; extension: string; data: Buffer; thumb: Buffer | null; savedAt: string; source?: ExampleRecord['source'] }): Promise<ExampleRecord> {
    return this.serialize(async () => {
      const id = exampleIdOf(input.facilityType, input.templateKey);
      const list = await this.all();
      const old = list.find((e) => e.id === id);
      await mkdir(this.rootDir, { recursive: true });
      const file = `${id}${input.extension}`;
      await writeFileAtomic(join(this.rootDir, file), input.data);
      if (old && old.file !== file) await rm(join(this.rootDir, old.file), { force: true });
      if (input.thumb) await writeFileAtomic(this.thumbPathOf(id), input.thumb);
      else await rm(this.thumbPathOf(id), { force: true });
      const record: ExampleRecord = { id, facilityType: input.facilityType, templateKey: input.templateKey, file, savedAt: input.savedAt };
      if (input.source) record.source = input.source;
      await writeJsonFileAtomic(this.indexPath(), { examples: [...list.filter((e) => e.id !== id), record] });
      return record;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const list = await this.all();
      const old = list.find((e) => e.id === id);
      if (!old) return false;
      await rm(join(this.rootDir, old.file), { force: true });
      await rm(this.thumbPathOf(id), { force: true });
      await writeJsonFileAtomic(this.indexPath(), { examples: list.filter((e) => e.id !== id) });
      return true;
    });
  }

  thumbPathOf(id: string): string {
    return join(this.rootDir, `${id}.thumb.jpg`);
  }

  async read(record: ExampleRecord): Promise<Buffer | null> {
    try {
      return await readFile(join(this.rootDir, record.file));
    } catch {
      return null;
    }
  }

  async readThumb(record: ExampleRecord): Promise<Buffer | null> {
    try {
      return await readFile(this.thumbPathOf(record.id));
    } catch {
      return null;
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
