import { describe, expect, it } from 'vitest';
import { createSdkClients } from '../src/apsSdk.js';

describe('createSdkClients', () => {
  it('APS SDK를 불러와 ApsClients의 모든 메서드를 만든다 (네트워크 호출 없음)', () => {
    const clients = createSdkClients('client-id', 'client-secret');
    for (const name of ['getTwoLeggedToken', 'getBucketDetails', 'createBucket', 'uploadObject', 'startJob', 'getManifest'] as const) {
      expect(typeof clients[name]).toBe('function');
    }
  });
});
