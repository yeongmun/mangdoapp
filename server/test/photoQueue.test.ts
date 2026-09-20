import { describe, expect, it } from 'vitest';
import {
  applyResult,
  MAX_PHOTO_TRIES,
  nextRetry,
  parseQueue,
  pendingCount,
  retryAll,
  retryDelayMs,
  type PhotoQueueItem,
} from '../../src/photoQueue.js';

const NOW = 1_000_000;

function item(id: string, patch: Partial<PhotoQueueItem> = {}): PhotoQueueItem {
  return {
    id,
    drawingId: 'd_00000000000000000000000000000001',
    damageId: '11111111-1111-4111-8111-111111111111',
    uri: `file:///documents/photo-queue/${id}.jpg`,
    filename: '20260918_101530.jpg',
    addedAt: 100,
    tries: 0,
    lastTriedAt: 0,
    ...patch,
  };
}

describe('retryDelayMs', () => {
  it('처음에는 기다리지 않고, 실패할수록 1분씩 길어진다', () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(180_000);
  });

  it('10분에서 멈춘다', () => {
    expect(retryDelayMs(10)).toBe(600_000);
    expect(retryDelayMs(20)).toBe(600_000);
  });
});

describe('nextRetry', () => {
  it('빈 대기열은 null', () => {
    expect(nextRetry([], NOW)).toBeNull();
  });

  it('한 번도 안 보낸 항목은 바로 보낸다', () => {
    expect(nextRetry([item('a')], NOW)?.id).toBe('a');
  });

  it('먼저 들어온 것부터 보낸다', () => {
    const queue = [item('b', { addedAt: 300 }), item('a', { addedAt: 200 })];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('들어온 시각이 같으면 id 순서로 가른다', () => {
    const queue = [item('b'), item('a')];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('방금 실패한 항목은 기다린다', () => {
    // tries 1 → 60초를 기다려야 하는데 1초밖에 안 지났다.
    const queue = [item('a', { tries: 1, lastTriedAt: NOW - 1_000 })];
    expect(nextRetry(queue, NOW)).toBeNull();
  });

  it('기다릴 만큼 기다렸으면 다시 보낸다', () => {
    const queue = [item('a', { tries: 1, lastTriedAt: NOW - 60_000 })];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('기다리는 항목을 건너뛰고 보낼 수 있는 항목을 고른다', () => {
    const queue = [
      item('a', { addedAt: 100, tries: 1, lastTriedAt: NOW - 1_000 }),
      item('b', { addedAt: 200 }),
    ];
    expect(nextRetry(queue, NOW)?.id).toBe('b');
  });

  it('10번 실패한 항목은 더 보내지 않는다', () => {
    const queue = [item('a', { tries: MAX_PHOTO_TRIES, lastTriedAt: 0 })];
    expect(nextRetry(queue, NOW)).toBeNull();
  });
});

describe('applyResult', () => {
  it('성공하면 대기열에서 뺀다', () => {
    const queue = [item('a'), item('b')];
    expect(applyResult(queue, 'a', 'ok', NOW).map((entry) => entry.id)).toEqual(['b']);
  });

  it('서버가 400을 주면(형식·번호) 다시 보내도 소용없으므로 뺀다', () => {
    const queue = [item('a'), item('b')];
    expect(applyResult(queue, 'b', 'drop', NOW).map((entry) => entry.id)).toEqual(['a']);
  });

  it('실패하면 횟수를 올리고 시각을 남긴다', () => {
    const queue = [item('a', { tries: 2, lastTriedAt: 5 })];
    expect(applyResult(queue, 'a', 'retry', NOW)[0]).toMatchObject({ id: 'a', tries: 3, lastTriedAt: NOW });
  });

  it('원래 배열을 고치지 않는다', () => {
    const queue = [item('a')];
    applyResult(queue, 'a', 'retry', NOW);
    expect(queue[0]).toMatchObject({ tries: 0, lastTriedAt: 0 });
  });

  it('모르는 id면 그대로 둔다', () => {
    const queue = [item('a')];
    expect(applyResult(queue, 'zz', 'ok', NOW)).toEqual(queue);
  });
});

describe('pendingCount·retryAll', () => {
  it('보내지 못한 사진 수는 10번 실패한 것까지 센다', () => {
    expect(pendingCount([item('a'), item('b', { tries: MAX_PHOTO_TRIES })])).toBe(2);
  });

  it('다시 시도를 누르면 횟수와 시각을 0으로 되돌린다', () => {
    const queue = [item('a', { tries: MAX_PHOTO_TRIES, lastTriedAt: 5 })];
    expect(retryAll(queue)[0]).toMatchObject({ tries: 0, lastTriedAt: 0 });
    expect(nextRetry(retryAll(queue), NOW)?.id).toBe('a');
  });
});

describe('parseQueue', () => {
  it('저장된 배열을 그대로 읽는다', () => {
    expect(parseQueue([item('a')])).toEqual([item('a')]);
  });

  it('배열이 아니거나 모양이 다른 항목은 버린다 (파일이 깨져도 앱이 뜬다)', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('{')).toEqual([]);
    expect(parseQueue([item('a'), { id: 'b' }, null, 7])).toEqual([item('a')]);
  });

  it('숫자 칸이 없으면 기본값으로 채운다', () => {
    const { tries, lastTriedAt, ...rest } = item('a');
    expect(parseQueue([rest])[0]).toMatchObject({ id: 'a', tries: 0, lastTriedAt: 0 });
  });
});
