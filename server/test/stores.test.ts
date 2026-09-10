import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, isDrawingId, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import { readJsonFile, writeJsonFileAtomic } from '../src/jsonFile.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function record(id: string, uploadedAt: string): DrawingRecord {
  return {
    id,
    name: '교량.dwg',
    objectKey: `${id}.dwg`,
    urn: 'urn-x',
    status: 'pending',
    progress: '',
    error: null,
    uploadedAt,
  };
}

describe('jsonFile', () => {
  it('없는 파일은 null', async () => {
    expect(await readJsonFile(join(dir, 'none.json'))).toBeNull();
  });

  it('하위 폴더를 만들며 쓰고 임시 파일을 남기지 않는다', async () => {
    const file = join(dir, 'a', 'b', 'data.json');
    await writeJsonFileAtomic(file, { hello: '세계' });
    expect(await readJsonFile(file)).toEqual({ hello: '세계' });
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['data.json']);
  });

  it('기존 파일을 덮어쓴다', async () => {
    const file = join(dir, 'data.json');
    await writeJsonFileAtomic(file, { v: 1 });
    await writeJsonFileAtomic(file, { v: 2 });
    expect(await readJsonFile(file)).toEqual({ v: 2 });
  });

  it('깨진 JSON은 예외', async () => {
    const file = join(dir, 'broken.json');
    await writeFile(file, '{', 'utf8');
    await expect(readJsonFile(file)).rejects.toThrow();
  });
});

describe('drawing id', () => {
  it('newDrawingId는 형식을 지키고 매번 다르다', () => {
    const a = newDrawingId();
    const b = newDrawingId();
    expect(isDrawingId(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('경로 조작이나 형식이 다른 문자열을 거부', () => {
    expect(isDrawingId('../etc/passwd')).toBe(false);
    expect(isDrawingId('d_123')).toBe(false);
    expect(isDrawingId('d_0123456789ABCDEF0123456789abcdef')).toBe(false);
  });
});

describe('DrawingsStore', () => {
  it('빈 저장소는 빈 목록', async () => {
    expect(await new DrawingsStore(join(dir, 'drawings.json')).list()).toEqual([]);
  });

  it('최신 업로드 순으로 돌려주고 get으로 찾는다', async () => {
    const store = new DrawingsStore(join(dir, 'drawings.json'));
    const older = record(newDrawingId(), '2026-09-10T00:00:00.000Z');
    const newer = record(newDrawingId(), '2026-09-10T01:00:00.000Z');
    await store.add(older);
    await store.add(newer);
    expect((await store.list()).map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(await store.get(older.id)).toEqual(older);
    expect(await store.get(newDrawingId())).toBeNull();
  });

  it('update는 병합한 레코드를 저장·반환하고 없는 id는 null', async () => {
    const store = new DrawingsStore(join(dir, 'drawings.json'));
    const r = record(newDrawingId(), '2026-09-10T00:00:00.000Z');
    await store.add(r);
    const updated = await store.update(r.id, { status: 'failed', error: '변환 실패' });
    expect(updated).toEqual({ ...r, status: 'failed', error: '변환 실패' });
    expect(await store.get(r.id)).toEqual(updated);
    expect(await store.update(newDrawingId(), { status: 'success' })).toBeNull();
  });

  it('동시에 add해도 레코드를 잃지 않는다', async () => {
    const store = new DrawingsStore(join(dir, 'drawings.json'));
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.add(record(newDrawingId(), `2026-09-10T00:00:${String(i).padStart(2, '0')}.000Z`)),
      ),
    );
    expect((await store.list()).length).toBe(20);
  });
});

describe('DamagesStore', () => {
  it('없는 문서는 1970년 updatedAt을 가진 빈 문서', async () => {
    const id = newDrawingId();
    expect(await new DamagesStore(join(dir, 'damages')).get(id)).toEqual({
      schemaVersion: 1,
      drawingId: id,
      updatedAt: '1970-01-01T00:00:00.000Z',
      damages: [],
    });
  });

  it('저장한 문서를 다시 읽는다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    const doc = { schemaVersion: 1, drawingId: id, updatedAt: '2026-09-10T00:00:00.000Z', damages: [{ id: 'x' }] };
    await store.save(doc);
    expect(await store.get(id)).toEqual(doc);
  });

  it('잘못된 id는 예외', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    await expect(store.get('../x')).rejects.toThrow('잘못된 도면 id: ../x');
  });
});
