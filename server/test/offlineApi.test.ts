import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineApi, isOfflineMode, OFFLINE_STATUS_LABELS } from '../public/viewer/offlineApi.js';

const ID = 'd_0123456789abcdef0123456789abcdef';

function offlineData() {
  return {
    drawing: { id: ID, status: 'success', urn: 'x', frames: [] },
    doc: { schemaVersion: 5, drawingId: ID, updatedAt: '2026-09-23T01:00:00.000Z', damages: [] },
    modelUrl: `file:///offline/drawings/${ID}/model/primaryGraphics.f2d`,
  };
}

function bridge(overrides = {}) {
  const posted: unknown[] = [];
  let savedCb: ((result: { updatedAt: string }) => void) | null = null;
  return {
    posted,
    post: (message: unknown) => posted.push(message),
    onSaved: (cb: (result: { updatedAt: string }) => void) => {
      savedCb = cb;
    },
    fireSaved(result: { updatedAt: string }) {
      savedCb?.(result);
    },
    ...overrides,
  };
}

describe('isOfflineMode', () => {
  it('offline=1일 때만 true', () => {
    expect(isOfflineMode('?id=x&offline=1')).toBe(true);
    expect(isOfflineMode('?id=x&offline=0')).toBe(false);
    expect(isOfflineMode('?id=x')).toBe(false);
    expect(isOfflineMode('')).toBe(false);
  });
});

describe('createOfflineApi', () => {
  it('/drawings는 주입된 도면 하나짜리 배열', async () => {
    const data = offlineData();
    const api = createOfflineApi(data, bridge());
    await expect(api('/drawings')).resolves.toEqual([data.drawing]);
  });

  it('손상 문서 GET은 주입된 doc', async () => {
    const data = offlineData();
    const api = createOfflineApi(data, bridge());
    await expect(api(`/drawings/${ID}/damages`)).resolves.toEqual(data.doc);
  });

  it('사진 목록 GET은 항상 빈 배열', async () => {
    const data = offlineData();
    const api = createOfflineApi(data, bridge());
    await expect(api(`/drawings/${ID}/damages/c1/photos`)).resolves.toEqual([]);
  });

  it('알 수 없는 경로는 재시도 불가 오류', async () => {
    const data = offlineData();
    const api = createOfflineApi(data, bridge());
    await expect(api('/viewer-token')).rejects.toMatchObject({
      message: '오프라인에서는 쓸 수 없습니다',
      retryable: false,
    });
  });

  it('손상 문서 PUT은 앱에 offlineSave를 보내고 회신이 오면 updatedAt을 돌려준다', async () => {
    const data = offlineData();
    const b = bridge();
    const api = createOfflineApi(data, b);
    const doc = { ...data.doc, damages: [{ id: 'c1' }] };
    const promise = api(`/drawings/${ID}/damages`, { method: 'PUT', body: JSON.stringify(doc) });
    expect(b.posted).toEqual([{ type: 'offlineSave', doc }]);
    b.fireSaved({ updatedAt: '2026-09-23T02:00:00.000Z' });
    await expect(promise).resolves.toEqual({ updatedAt: '2026-09-23T02:00:00.000Z' });
  });

  describe('PUT 시간초과', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('3000ms 안에 회신이 없으면 재시도 가능한 오류로 거부한다', async () => {
      const data = offlineData();
      const b = bridge();
      const api = createOfflineApi(data, b);
      const promise = api(`/drawings/${ID}/damages`, { method: 'PUT', body: JSON.stringify(data.doc) });
      const assertion = expect(promise).rejects.toMatchObject({
        message: '기기에 저장하지 못했습니다',
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    });

    it('회신이 늦게 와도(3000ms 넘으면) 이미 실패로 끝난 뒤라 다시 성공으로 바뀌지 않는다', async () => {
      const data = offlineData();
      const b = bridge();
      const api = createOfflineApi(data, b);
      const promise = api(`/drawings/${ID}/damages`, { method: 'PUT', body: JSON.stringify(data.doc) });
      promise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(3000);
      b.fireSaved({ updatedAt: '2026-09-23T02:00:00.000Z' });
      await expect(promise).rejects.toMatchObject({ retryable: true });
    });
  });
});

describe('OFFLINE_STATUS_LABELS', () => {
  it('오프라인 저장 배지 문구', () => {
    expect(OFFLINE_STATUS_LABELS).toEqual({
      saved: '기기에 저장됨',
      saving: '기기에 저장 중',
      pending: '기기 저장 대기',
      error: '기기 저장 실패',
    });
  });
});
