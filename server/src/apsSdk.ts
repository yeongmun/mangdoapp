import { createRequire } from 'node:module';
import type * as AuthenticationSdk from '@aps_sdk/authentication';
import type * as ModelDerivativeSdk from '@aps_sdk/model-derivative';
import type * as OssSdk from '@aps_sdk/oss';
import type { ApsClients, ManifestLike } from './aps.js';

// APS SDK는 CommonJS 패키지다. ESM 서버에서 확실히 불러오도록 createRequire를 쓴다.
const require = createRequire(import.meta.url);
const authenticationSdk = require('@aps_sdk/authentication') as typeof AuthenticationSdk;
const ossSdk = require('@aps_sdk/oss') as typeof OssSdk;
const modelDerivativeSdk = require('@aps_sdk/model-derivative') as typeof ModelDerivativeSdk;

type ScopeList = Parameters<AuthenticationSdk.AuthenticationClient['getTwoLeggedToken']>[2];

export function createSdkClients(clientId: string, clientSecret: string): ApsClients {
  const authClient = new authenticationSdk.AuthenticationClient();
  const ossClient = new ossSdk.OssClient();
  const modelDerivativeClient = new modelDerivativeSdk.ModelDerivativeClient();

  return {
    async getTwoLeggedToken(scopes) {
      const token = await authClient.getTwoLeggedToken(clientId, clientSecret, scopes as ScopeList);
      return { access_token: token.access_token, expires_in: token.expires_in };
    },
    getBucketDetails: (bucketKey, accessToken) => ossClient.getBucketDetails(bucketKey, { accessToken }),
    createBucket: (bucketKey, accessToken) =>
      ossClient.createBucket(
        ossSdk.Region.Us,
        { bucketKey, policyKey: ossSdk.PolicyKey.Persistent },
        { accessToken },
      ),
    uploadObject: (bucketKey, objectKey, data, accessToken) =>
      ossClient.uploadObject(bucketKey, objectKey, data, { accessToken }),
    startJob: (urn, accessToken) =>
      modelDerivativeClient.startJob(
        {
          input: { urn },
          output: {
            formats: [
              {
                type: modelDerivativeSdk.OutputType.Svf2,
                views: [modelDerivativeSdk.View._2d, modelDerivativeSdk.View._3d],
              },
            ],
          },
        },
        { accessToken, xAdsForce: true },
      ),
    getManifest: async (urn, accessToken) =>
      (await modelDerivativeClient.getManifest(urn, { accessToken })) as unknown as ManifestLike,
  };
}
