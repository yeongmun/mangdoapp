import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupKey,
  chooseInitialDoc,
  createSyncer,
  nextRetryDelay,
  RETRY_MAX_MS,
  SAVE_DELAY_MS,
} from '../public/viewer/sync.js';

const ID = 'd_0123456789abcdef0123456789abcdef';

function doc(updatedAt: string, n = 0) {
  return { schemaVersion: 1, drawingId: ID, updatedAt, damages: Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe('nextRetryDelay', () => {
  it('5초에서 시작해 두 배씩, 최대 60초', () => {
    const delays: number[] = [];
    let current: number | null = null;
    for (let i = 0; i < 7; i++) {
      current = nextRetryDelay(current);
      delays.push(current);
    }
    expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
    expect(RETRY_MAX_MS).toBe(60000);
  });
});

describe('chooseInitialDoc', () => {
  const server = doc('2026-09-10T01:00:00.000Z');

  it('백업이 더 최신이면 백업을 쓰고 업로드가 필요하다', () => {
    const backup = doc('2026-09-10T02:00:00.000Z', 1);
    expect(chooseInitialDoc(server, backup)).toEqual({ doc: backup, needsUpload: true });
  });

  it('백업이 같거나 오래됐거나 없거나 다른 도면이면 서버 문서', () => {
    expect(chooseInitialDoc(server, doc('2026-09-10T01:00:00.000Z', 1))).toEqual({ doc: server, needsUpload: false });
    expect(chooseInitialDoc(server, doc('2026-09-10T00:00:00.000Z', 1))).toEqual({ doc: server, needsUpload: false });
    expect(chooseInitialDoc(server, null)).toEqual({ doc: server, needsUpload: false });
    const other = { ...doc('2026-09-10T09:00:00.000Z'), drawingId: 'd_ffffffffffffffffffffffffffffffff' };
    expect(chooseInitialDoc(server, other)).toEqual({ doc: server, needsUpload: false });
  });
});

describe('createSyncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('변경 즉시 백업하고, 1초 뒤 마지막 문서만 한 번 저장한다', async () => {
    const storage = memoryStorage();
    const save = vi.fn(async () => undefined);
    const statuses: string[] = [];
    const syncer = createSyncer({ drawingId: ID, save, storage, onStatus: (s: string) => statuses.push(s) });

    const first = doc('2026-09-10T01:00:00.000Z', 1);
    const second = doc('2026-09-10T01:00:00.500Z', 2);
    syncer.change(first);
    await vi.advanceTimersByTimeAsync(500);
    syncer.change(second);

    expect(JSON.parse(storage.map.get(backupKey(ID))!)).toEqual(second);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(second);
    expect(statuses.at(-1)).toBe('saved');
    expect(syncer.readBackup()).toEqual(second);
  });

  it('저장 실패 시 저장 대기로 바꾸고 5초, 10초 간격으로 재시도한 뒤 성공하면 저장됨', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const statuses: string[] = [];
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: (s: string) => statuses.push(s) });

    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('pending');

    await vi.advanceTimersByTimeAsync(4999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(9999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('saved');
  });

  it('저장 요청 중에 바뀐 내용은 끝난 뒤 다시 저장한다', async () => {
    let resolveFirst: () => void = () => undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });

    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    const later = doc('2026-09-10T01:00:05.000Z', 2);
    syncer.change(later);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    resolveFirst();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(later);
  });

  it('flushNow는 대기 시간 없이 저장한다', async () => {
    const save = vi.fn(async () => undefined);
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });
    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await syncer.flushNow();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('저장소가 예외를 던져도 저장은 계속되고, 깨진 백업은 null', async () => {
    const save = vi.fn(async () => undefined);
    const broken = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    const syncer = createSyncer({ drawingId: ID, save, storage: broken, onStatus: () => undefined });
    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(syncer.readBackup()).toBeNull();
  });
});
