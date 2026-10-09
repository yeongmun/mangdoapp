import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DamagesStore } from '../src/damagesStore.js';
import { newDrawingId } from '../src/drawingsStore.js';
import { applyHandwritingToDamage, pendingHandwritingIds, processPendingHandwriting } from '../src/handwritingQueue.js';

type Dmg = { id: string; updatedAt: string; measured: Record<string, number | null>; attrs: Record<string, unknown> } & Record<string, unknown>;
function damage(id: string, extra: Record<string, unknown> = {}, measured: Record<string, number | null> = {}): Dmg {
  return {
    id, type: 'crack', createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
    geometry: { kind: 'polyline', world: [[0, 0], [10, 0]], dwg: [[0, 0], [10, 0]] }, copies: [],
    measured: { width: null, length: null, count: null, ...measured }, computed: { lengthDwg: 10, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [], ...extra },
  };
}
const IMG = Buffer.from('png').toString('base64');

describe('pendingHandwritingIds / applyHandwritingToDamage', () => {
  it('image가 붙은 손상만 대기', () => {
    expect(pendingHandwritingIds([damage('a', { handwriting: { image: IMG } }), damage('b', { handwriting: { text: 'x' } }), damage('c')])).toEqual(['a']);
  });
  it('빈 칸만 채우고 image는 text로 바꾼다', () => {
    const out = applyHandwritingToDamage(damage('a', { handwriting: { image: IMG } }, { width: 0.5 }), { width: 0.2, length: 1.5, count: 2, text: '0.2/1.5 2EA' }, 'T') as Dmg;
    expect(out.measured).toEqual({ width: 0.5, length: 1.5, count: 2 });
    expect(out.attrs.handwriting).toEqual({ text: '0.2/1.5 2EA' });
    expect(out.updatedAt).toBe('T');
  });
});

describe('processPendingHandwriting', () => {
  let dir: string;
  let store: DamagesStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hw-'));
    store = new DamagesStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('대기 손글씨를 읽어 문서에 적용하고 updatedAt을 올린다', async () => {
    const d1 = newDrawingId();
    await store.save({ schemaVersion: 5, drawingId: d1, updatedAt: '2026-10-09T00:00:00.000Z', damages: [damage('a', { handwriting: { image: IMG } }), damage('b')] });
    const applied = await processPendingHandwriting(store, { transcribe: async () => '0.3/2' }, d1, () => '2026-10-09T01:00:00.000Z');
    expect(applied).toBe(1);
    const doc = await store.get(d1);
    expect(doc.updatedAt).toBe('2026-10-09T01:00:00.000Z');
    const a = (doc.damages as Dmg[]).find((d) => d.id === 'a')!;
    expect(a.measured).toEqual({ width: 0.3, length: 2, count: null });
    expect(a.attrs.handwriting).toEqual({ text: '0.3/2' });
    expect(pendingHandwritingIds(doc.damages)).toEqual([]);
  });

  it('대기가 없으면 아무것도 안 하고, AI 실패는 건너뛴다', async () => {
    const d1 = newDrawingId();
    const d2 = newDrawingId();
    await store.save({ schemaVersion: 5, drawingId: d1, updatedAt: 'T0', damages: [damage('a')] });
    expect(await processPendingHandwriting(store, { transcribe: async () => '1' }, d1)).toBe(0);
    await store.save({ schemaVersion: 5, drawingId: d2, updatedAt: 'T0', damages: [damage('a', { handwriting: { image: IMG } })] });
    expect(await processPendingHandwriting(store, { transcribe: async () => { throw new Error('x'); } }, d2)).toBe(0);
    expect(pendingHandwritingIds((await store.get(d2)).damages)).toEqual(['a']);
  });
});
