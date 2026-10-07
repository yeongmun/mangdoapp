import { join } from 'node:path';
import { createEmptyDoc, migrateDoc } from '../public/viewer/damageDoc.js';
import { isDrawingId } from './drawingsStore.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export interface DamageDoc {
  schemaVersion: number;
  drawingId: string;
  updatedAt: string;
  damages: unknown[];
  /** 지운 손상의 기록(선택, 병합용). public/viewer/damageDoc.js 참고 */
  deleted?: Array<{ id: string; deletedAt: string }>;
}

const NEVER_SAVED = new Date(0).toISOString();

export class DamagesStore {
  constructor(private readonly dir: string) {}

  async get(drawingId: string): Promise<DamageDoc> {
    const saved = await readJsonFile<DamageDoc>(this.pathFor(drawingId));
    if (!saved) return createEmptyDoc(drawingId, NEVER_SAVED);
    // 예전에 저장된 옛 버전 문서는 읽을 때 현재 버전(v5)으로 바꿔서 돌려준다. 저장은 항상 v5로 한다.
    return (migrateDoc(saved, drawingId) as DamageDoc | null) ?? createEmptyDoc(drawingId, NEVER_SAVED);
  }

  async save(doc: DamageDoc): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(doc.drawingId), doc);
  }

  /**
   * 도면 하나의 저장 작업을 줄 세운다 — 병합(읽기→합치기→쓰기)이 두 기기에서 동시에 오면 한쪽의 합침이
   * 다른 쪽에 덮이지 않게. 도면이 다르면 서로 기다리지 않는다.
   */
  withLock<T>(drawingId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(drawingId) ?? Promise.resolve();
    const run = previous.then(work, work);
    // 실패해도 다음 작업은 이어진다(결과는 호출자에게 그대로 간다).
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(drawingId, settled);
    void settled.then(() => {
      if (this.locks.get(drawingId) === settled) this.locks.delete(drawingId);
    });
    return run;
  }

  private readonly locks = new Map<string, Promise<void>>();

  private pathFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, `${drawingId}.json`);
  }
}
