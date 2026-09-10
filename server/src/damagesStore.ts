import { join } from 'node:path';
import { createEmptyDoc } from '../public/viewer/damageDoc.js';
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
    return saved ?? createEmptyDoc(drawingId, NEVER_SAVED);
  }

  async save(doc: DamageDoc): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(doc.drawingId), doc);
  }

  private pathFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, `${drawingId}.json`);
  }
}
