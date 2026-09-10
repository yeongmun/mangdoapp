import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupKey,
  chooseInitialDoc,
  createSyncer,
  nextRetryDelay,
  RETRY_MAX_MS,
  RETRY_START_MS,
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

  it('flushNow는 진행 중인 저장을 기다린 뒤 남은 변경까지 저장하고 true를 돌려준다', async () => {
    let resolveFirst: () => void = () => undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue(undefined);
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });

    const a = doc('2026-09-10T01:00:00.000Z', 1);
    const b = doc('2026-09-10T01:00:02.000Z', 2);
    syncer.change(a);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    syncer.change(b);

    const result = syncer.flushNow();
    resolveFirst();
    expect(await result).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(b);
  });

  it('flushNow를 동시에 호출해도 모두 마지막 저장이 끝난 뒤에 결과를 돌려준다', async () => {
    let resolveFirst: () => void = () => undefined;
    let resolveSecond: () => void = () => undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSecond = resolve; }));
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });

    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    syncer.change(doc('2026-09-10T01:00:02.000Z', 2));

    const done: string[] = [];
    const first = syncer.flushNow().then((saved: boolean) => { done.push('first'); return saved; });
    const second = syncer.flushNow().then((saved: boolean) => { done.push('second'); return saved; });
    resolveFirst();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(done).toEqual([]);

    resolveSecond();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it('flushNow는 저장에 실패하면 false를 돌려준다', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });
    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    expect(await syncer.flushNow()).toBe(false);
  });

  it('변경이 없으면 flushNow는 true', async () => {
    const save = vi.fn(async () => undefined);
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });
    expect(await syncer.flushNow()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('재시도할 수 없는 오류는 저장 실패로 표시하고 재시도하지 않는다', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('형식 오류'), { retryable: false }))
      .mockResolvedValue(undefined);
    const calls: unknown[][] = [];
    const syncer = createSyncer({
      drawingId: ID,
      save,
      storage: memoryStorage(),
      onStatus: (...args: unknown[]) => calls.push(args),
    });

    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)?.[0]).toBe('error');
    expect(calls.at(-1)?.[1]).toBe('형식 오류');

    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(save).toHaveBeenCalledTimes(1);

    syncer.change(doc('2026-09-10T01:01:05.000Z', 2));
    expect(calls.at(-1)?.[0]).toBe('saving');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls.at(-1)?.[0]).toBe('saved');
  });

  it('재시도할 수 없는 오류로 저장하지 못하면 flushNow도 false', async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('형식 오류'), { retryable: false }));
    const syncer = createSyncer({ drawingId: ID, save, storage: memoryStorage(), onStatus: () => undefined });
    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    expect(await syncer.flushNow()).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
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

  it('재시도 대기 중에 바뀐 내용은 재시도 간격을 줄이지 않고 다음 재시도에 저장한다', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const statuses: string[] = [];
    const storage = memoryStorage();
    const syncer = createSyncer({ drawingId: ID, save, storage, onStatus: (s: string) => statuses.push(s) });

    syncer.change(doc('2026-09-10T01:00:00.000Z', 1));
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('pending');

    const later = doc('2026-09-10T01:00:02.000Z', 2);
    await vi.advanceTimersByTimeAsync(1000);
    syncer.change(later);
    expect(statuses.at(-1)).toBe('pending');
    expect(JSON.parse(storage.map.get(backupKey(ID))!)).toEqual(later);

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RETRY_START_MS - 1000 - SAVE_DELAY_MS - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(later);
    expect(statuses.at(-1)).toBe('saved');
  });
});
