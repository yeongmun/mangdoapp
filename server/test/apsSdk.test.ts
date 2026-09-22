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
});
