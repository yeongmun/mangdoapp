import { join } from 'node:path';
import { createEmptyDoc, migrateDoc } from '../public/viewer/damageDoc.js';
import { isDrawingId } from './drawingsStore.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export interface DamageDoc {
  schemaVersion: number;
  drawingId: string;
  updatedAt: string;
  damages: unknown[];
}

const NEVER_SAVED = new Date(0).toISOString();

export class DamagesStore {
  constructor(private readonly dir: string) {}

  async get(drawingId: string): Promise<DamageDoc> {
    const saved = await readJsonFile<DamageDoc>(this.pathFor(drawingId));
    if (!saved) return createEmptyDoc(drawingId, NEVER_SAVED);
    // 예전에 저장된 v1 문서는 읽을 때 v2로 바꿔서 돌려준다. 저장은 항상 v2로 한다.
    return (migrateDoc(saved, drawingId) as DamageDoc | null) ?? createEmptyDoc(drawingId, NEVER_SAVED);
  }

  async save(doc: DamageDoc): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(doc.drawingId), doc);
  }

  private pathFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, `${drawingId}.json`);
  }
}
