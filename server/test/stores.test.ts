import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, isDrawingId, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import { readJsonFile, renameWithRetry, writeJsonFileAtomic } from '../src/jsonFile.js';
import { OriginalsStore } from '../src/originalsStore.js';

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

describe('renameWithRetry', () => {
  function codeError(code: string) {
    return Object.assign(new Error(code), { code });
  }

  function recordWait() {
    const waits: number[] = [];
    return { waits, wait: async (ms: number) => void waits.push(ms) };
  }

  it('EPERM이면 50ms, 100ms 기다리며 다시 시도해 성공한다', async () => {
    const rename = vi
      .fn()
      .mockRejectedValueOnce(codeError('EPERM'))
      .mockRejectedValueOnce(codeError('EPERM'))
      .mockResolvedValueOnce(undefined);
    const { waits, wait } = recordWait();
    await expect(renameWithRetry('a.tmp', 'a.json', { rename, wait })).resolves.toBeUndefined();
    expect(rename).toHaveBeenCalledTimes(3);
    expect(rename).toHaveBeenLastCalledWith('a.tmp', 'a.json');
    expect(waits).toEqual([50, 100]);
  });

  it('재시도 대상이 아닌 오류(ENOENT)는 바로 던진다', async () => {
    const rename = vi.fn().mockRejectedValue(codeError('ENOENT'));
    const { waits, wait } = recordWait();
    await expect(renameWithRetry('a.tmp', 'a.json', { rename, wait })).rejects.toThrow('ENOENT');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('EBUSY가 계속되면 5번 시도한 뒤 마지막 오류를 던진다', async () => {
    const rename = vi.fn().mockRejectedValue(codeError('EBUSY'));
    const { wait } = recordWait();
    await expect(renameWithRetry('a.tmp', 'a.json', { rename, wait })).rejects.toThrow('EBUSY');
    expect(rename).toHaveBeenCalledTimes(5);
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
      schemaVersion: 4,
      drawingId: id,
      updatedAt: '1970-01-01T00:00:00.000Z',
      damages: [],
    });
  });

  it('저장한 문서를 다시 읽는다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    const doc = { schemaVersion: 4, drawingId: id, updatedAt: '2026-09-10T00:00:00.000Z', damages: [{ id: 'x' }] };
    await store.save(doc);
    expect(await store.get(id)).toEqual(doc);
  });

  it('v1 문서를 읽으면 v4로 변환해서 돌려준다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    await writeJsonFileAtomic(join(dir, 'damages', `${id}.json`), {
      schemaVersion: 1,
      drawingId: id,
      updatedAt: '2026-09-10T00:00:00.000Z',
      damages: [
        {
          id: 'old-1',
          type: 'crack',
          createdAt: '2026-09-10T00:00:00.000Z',
          geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
          lengthDwg: 5,
        },
      ],
    });

    const doc = await store.get(id);

    expect(doc.schemaVersion).toBe(4);
    expect(doc.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: '2026-09-10T00:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    });
  });

  it('v2 문서를 읽으면 v4로 변환하고 면적·부재명을 비고에 남긴다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    await writeJsonFileAtomic(join(dir, 'damages', `${id}.json`), {
      schemaVersion: 2,
      drawingId: id,
      updatedAt: '2026-09-12T00:00:00.000Z',
      damages: [
        {
          id: 'v2-area',
          type: 'spalling',
          createdAt: '2026-09-12T00:00:00.000Z',
          geometry: {
            kind: 'rect',
            world: [[0, 0], [2, 0], [2, 1], [0, 1]],
            dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
          },
          measured: { lengthM: null, areaM2: 1.8 },
          computed: { lengthDwg: null, areaDwg: 2 },
          attrs: { widthMm: null, member: '기둥', note: '' },
        },
      ],
    });

    const doc = await store.get(id);

    expect(doc.schemaVersion).toBe(4);
    expect(doc.damages[0]).toEqual({
      id: 'v2-area',
      type: 'spalling',
      createdAt: '2026-09-12T00:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, 1], [0, 1]],
        dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
      },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { note: '이전 면적 입력값: 1.8㎡ / 부재명: 기둥', statusText: '', photoNumbers: [] },
    });
  });

  it('v3 문서를 읽으면 photoNumbers를 채워 v4로 변환한다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    await writeJsonFileAtomic(join(dir, 'damages', `${id}.json`), {
      schemaVersion: 3,
      drawingId: id,
      updatedAt: '2026-09-13T00:00:00.000Z',
      damages: [
        {
          id: 'v3-crack',
          type: 'crack',
          createdAt: '2026-09-13T00:00:00.000Z',
          geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
          measured: { width: 0.3, length: 5, count: 2 },
          computed: { lengthDwg: 5, areaDwg: null },
          attrs: { note: '기존 비고', statusText: '' },
        },
      ],
    });

    const doc = await store.get(id);

    expect(doc.schemaVersion).toBe(4);
    expect(doc.damages[0]).toEqual({
      id: 'v3-crack',
      type: 'crack',
      createdAt: '2026-09-13T00:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
      measured: { width: 0.3, length: 5, count: 2 },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '기존 비고', statusText: '', photoNumbers: [] },
    });
  });

  it('잘못된 id는 예외', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    await expect(store.get('../x')).rejects.toThrow('잘못된 도면 id: ../x');
  });
});

describe('OriginalsStore', () => {
  it('저장한 원본을 바이트 그대로 읽는다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    const id = newDrawingId();
    const data = Buffer.from('  0\nSECTION\n한글\n', 'utf8');
    await store.save(`${id}.dxf`, data);
    expect(await store.read(`${id}.dxf`)).toEqual(data);
  });

  it('없는 파일은 null', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    expect(await store.read(`${newDrawingId()}.dxf`)).toBeNull();
  });

  it('형식이 틀린 objectKey는 던진다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    for (const key of ['../secret.dxf', 'a.dxf', `${newDrawingId()}.txt`, newDrawingId()]) {
      await expect(store.save(key, Buffer.from('x'))).rejects.toThrow(/잘못된 파일 이름/);
      await expect(store.read(key)).rejects.toThrow(/잘못된 파일 이름/);
    }
  });

  it('덮어써도 깨지지 않는다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    const id = newDrawingId();
    await store.save(`${id}.dxf`, Buffer.from('처음'));
    await store.save(`${id}.dxf`, Buffer.from('나중'));
    expect((await store.read(`${id}.dxf`))?.toString('utf8')).toBe('나중');
  });
});
