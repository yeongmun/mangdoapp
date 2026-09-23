import { createRequire } from 'node:module';
import type * as ModelDerivativeSdk from '@aps_sdk/model-derivative';
import { describe, expect, it, vi } from 'vitest';
import { createSdkClients } from '../src/apsSdk.js';

const require = createRequire(import.meta.url);
const modelDerivativeSdk = require('@aps_sdk/model-derivative') as typeof ModelDerivativeSdk;

describe('createSdkClients', () => {
  it('APS SDK를 불러와 ApsClients의 모든 메서드를 만든다 (네트워크 호출 없음)', () => {
    const clients = createSdkClients('client-id', 'client-secret');
    for (const name of ['getTwoLeggedToken', 'getBucketDetails', 'createBucket', 'uploadObject', 'startJob', 'getManifest'] as const) {
      expect(typeof clients[name]).toBe('function');
    }
  });

  // 오프라인 모드(설계 2장): 온라인 뷰어도 SVF만 여므로 변환도 SVF(2D)만 요청한다. 실제 APS를
  // 부르지 않도록 SDK 클라이언트의 startJob 메서드를 가짜로 바꿔 인자만 확인한다.
  it('startJob은 SVF(2D)만 요청한다(네트워크 호출 없음)', async () => {
    const spy = vi
      .spyOn(modelDerivativeSdk.ModelDerivativeClient.prototype, 'startJob')
      .mockResolvedValue({} as never);
    try {
      const clients = createSdkClients('client-id', 'client-secret');
      await clients.startJob('urn:adsk.objects:os.object:bucket/x.dwg', 'token-x');
      expect(spy).toHaveBeenCalledWith(
        {
          input: { urn: 'urn:adsk.objects:os.object:bucket/x.dwg' },
          output: {
            formats: [{ type: modelDerivativeSdk.OutputType.Svf, views: [modelDerivativeSdk.View._2d] }],
          },
        },
        { accessToken: 'token-x', xAdsForce: true },
      );
    } finally {
      spy.mockRestore();
    }
  });

  // 오프라인 모드(설계 3.1): 파생 파일 바이트는 APS SDK에 메서드가 없어 전역 fetch로 직접 받는다.
  describe('downloadDerivative', () => {
    it('manifest 하위 파생 경로를 Bearer 토큰으로 불러 바이트를 돌려준다', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(Buffer.from('f2d-bytes'), { status: 200 }),
      );
      try {
        const clients = createSdkClients('client-id', 'client-secret');
        const result = await clients.downloadDerivative(
          'urn:adsk.objects:os.object:bucket/x.dwg',
          'urn:adsk.viewing:fs.file:abc/output/x_f2d/primaryGraphics.f2d',
          'token-x',
        );
        expect(result.toString('utf8')).toBe('f2d-bytes');
        expect(fetchSpy).toHaveBeenCalledWith(
          'https://developer.api.autodesk.com/modelderivative/v2/designdata/urn:adsk.objects:os.object:bucket/x.dwg/manifest/urn%3Aadsk.viewing%3Afs.file%3Aabc%2Foutput%2Fx_f2d%2FprimaryGraphics.f2d',
          { headers: { authorization: 'Bearer token-x' } },
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('200이 아니면 상태 코드를 담은 오류를 던진다', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
      try {
        const clients = createSdkClients('client-id', 'client-secret');
        await expect(clients.downloadDerivative('urn-1', 'deriv-urn', 'token-x')).rejects.toThrow(
          '파생 파일 내려받기 실패 (404)',
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
