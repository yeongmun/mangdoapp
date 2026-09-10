import { describe, expect, it, vi } from 'vitest';
import { ApsService, httpStatusOf, mapManifest, urnify, type ApsClients } from '../src/aps.js';

function apiError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { httpStatusCode: () => status });
}

function fakeClients(overrides: Partial<ApsClients> = {}): ApsClients {
  let issued = 0;
  return {
    getTwoLeggedToken: vi.fn(async () => ({ access_token: `tok-${++issued}`, expires_in: 3600 })),
    getBucketDetails: vi.fn(async () => ({})),
    createBucket: vi.fn(async () => ({})),
    uploadObject: vi.fn(async (bucketKey: string, objectKey: string) => ({
      objectId: `urn:adsk.objects:os.object:${bucketKey}/${objectKey}`,
    })),
    startJob: vi.fn(async () => ({})),
    getManifest: vi.fn(async () => ({ status: 'inprogress', progress: '10% complete' })),
    ...overrides,
  };
}

describe('urnify', () => {
  it('URL-safe base64이며 패딩이 없고 원래 값으로 복원된다', () => {
    const objectId = 'urn:adsk.objects:os.object:mangdo-abc/d_1.dwg';
    const urn = urnify(objectId);
    expect(urn).not.toMatch(/[=+/]/);
    expect(Buffer.from(urn, 'base64url').toString('utf8')).toBe(objectId);
  });
});

describe('httpStatusOf', () => {
  it('SDK 오류의 httpStatusCode(), axios 응답 상태, 그 외 null', () => {
    expect(httpStatusOf(apiError(404))).toBe(404);
    expect(httpStatusOf({ axiosError: { response: { status: 409 } } })).toBe(409);
    expect(httpStatusOf(new Error('x'))).toBeNull();
    expect(httpStatusOf('x')).toBeNull();
  });
});

describe('mapManifest', () => {
  it('상태를 매핑한다', () => {
    expect(mapManifest({ status: 'success', progress: 'complete' })).toEqual({ status: 'success', progress: 'complete', error: null });
    expect(mapManifest({ status: 'inprogress', progress: '45% complete' })).toEqual({ status: 'inprogress', progress: '45% complete', error: null });
    expect(mapManifest({ status: 'pending' })).toEqual({ status: 'pending', progress: '', error: null });
  });

  it('실패 시 error 메시지를 모아 알려준다', () => {
    const result = mapManifest({
      status: 'failed',
      progress: 'complete',
      derivatives: [
        {
          status: 'failed',
          messages: [
            { type: 'warning', message: '무시' },
            { type: 'error', code: 'AutoCAD-InvalidFile', message: ['Sorry,', 'the drawing file is invalid.'] },
          ],
        },
      ],
    });
    expect(result).toEqual({
      status: 'failed',
      progress: 'complete',
      error: 'Sorry, the drawing file is invalid. (AutoCAD-InvalidFile)',
    });
  });

  it('메시지가 없으면 기본 문구, timeout은 시간 초과 문구', () => {
    expect(mapManifest({ status: 'failed' }).error).toBe('변환에 실패했습니다.');
    expect(mapManifest({ status: 'timeout' })).toEqual({ status: 'failed', progress: '', error: '변환 시간이 초과되었습니다.' });
  });
});

describe('ApsService tokens', () => {
  it('내부 토큰은 만료 5분 전까지 캐시하고 이후 다시 발급한다', async () => {
    let clock = 1_000_000;
    const clients = fakeClients();
    const service = new ApsService(clients, 'bucket', () => clock);

    expect(await service.getInternalToken()).toBe('tok-1');
    clock += 3_600_000 - 300_000 - 1;
    expect(await service.getInternalToken()).toBe('tok-1');
    clock += 1;
    expect(await service.getInternalToken()).toBe('tok-2');
    expect(clients.getTwoLeggedToken).toHaveBeenCalledWith(['data:read', 'data:write', 'data:create', 'bucket:create', 'bucket:read']);
  });

  it('뷰어 토큰은 viewables:read만 요청하고 내부 토큰과 따로 캐시한다', async () => {
    const clock = 5_000;
    const clients = fakeClients();
    const service = new ApsService(clients, 'bucket', () => clock);

    await service.getInternalToken();
    const viewer = await service.getViewerToken();
    expect(viewer).toEqual({ accessToken: 'tok-2', expiresAt: 5_000 + 3_600_000 });
    expect(clients.getTwoLeggedToken).toHaveBeenLastCalledWith(['viewables:read']);
    expect(await service.getViewerToken()).toEqual(viewer);
    expect(clients.getTwoLeggedToken).toHaveBeenCalledTimes(2);
  });
});

describe('ApsService.ensureBucket', () => {
  it('버킷이 있으면 만들지 않는다', async () => {
    const clients = fakeClients();
    await new ApsService(clients, 'bucket').ensureBucket();
    expect(clients.getBucketDetails).toHaveBeenCalledWith('bucket', 'tok-1');
    expect(clients.createBucket).not.toHaveBeenCalled();
  });

  it('404면 만든다', async () => {
    const clients = fakeClients({ getBucketDetails: vi.fn(async () => { throw apiError(404); }) });
    await new ApsService(clients, 'bucket').ensureBucket();
    expect(clients.createBucket).toHaveBeenCalledWith('bucket', 'tok-1');
  });

  it('만들 때 409(이미 있음)는 성공으로 본다', async () => {
    const clients = fakeClients({
      getBucketDetails: vi.fn(async () => { throw apiError(404); }),
      createBucket: vi.fn(async () => { throw apiError(409); }),
    });
    await expect(new ApsService(clients, 'bucket').ensureBucket()).resolves.toBeUndefined();
  });

  it('그 밖의 오류는 그대로 던진다', async () => {
    const clients = fakeClients({ getBucketDetails: vi.fn(async () => { throw apiError(403); }) });
    await expect(new ApsService(clients, 'bucket').ensureBucket()).rejects.toThrow('HTTP 403');
  });
});

describe('ApsService 업로드와 변환', () => {
  it('uploadDrawing은 파일을 올리고 objectId를 URN으로 바꾼다', async () => {
    const clients = fakeClients();
    const data = Buffer.from('dwg-bytes');
    const result = await new ApsService(clients, 'bucket').uploadDrawing(data, 'd_1.dwg');
    expect(clients.uploadObject).toHaveBeenCalledWith('bucket', 'd_1.dwg', data, 'tok-1');
    expect(result).toEqual({ urn: urnify('urn:adsk.objects:os.object:bucket/d_1.dwg') });
  });

  it('objectId가 응답에 없으면 규칙대로 만든다', async () => {
    const clients = fakeClients({ uploadObject: vi.fn(async () => ({})) });
    const result = await new ApsService(clients, 'bucket').uploadDrawing(Buffer.from('x'), 'd_2.dwg');
    expect(result.urn).toBe(urnify('urn:adsk.objects:os.object:bucket/d_2.dwg'));
  });

  it('startTranslation은 토큰과 함께 작업을 요청한다', async () => {
    const clients = fakeClients();
    await new ApsService(clients, 'bucket').startTranslation('urn-1');
    expect(clients.startJob).toHaveBeenCalledWith('urn-1', 'tok-1');
  });

  it('getTranslationStatus는 manifest를 매핑하고 404는 대기 중으로 본다', async () => {
    const ok = fakeClients();
    expect(await new ApsService(ok, 'bucket').getTranslationStatus('urn-1')).toEqual({
      status: 'inprogress',
      progress: '10% complete',
      error: null,
    });

    const notYet = fakeClients({ getManifest: vi.fn(async () => { throw apiError(404); }) });
    expect(await new ApsService(notYet, 'bucket').getTranslationStatus('urn-1')).toEqual({
      status: 'pending',
      progress: '',
      error: null,
    });

    const broken = fakeClients({ getManifest: vi.fn(async () => { throw apiError(500); }) });
    await expect(new ApsService(broken, 'bucket').getTranslationStatus('urn-1')).rejects.toThrow('HTTP 500');
  });
});
