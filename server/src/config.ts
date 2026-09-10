import { createHash } from 'node:crypto';

export interface AppConfig {
  apsClientId: string;
  apsClientSecret: string;
  appAccessKey: string;
  bucketKey: string;
  port: number;
  dataDir: string;
}

const REQUIRED = ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APP_ACCESS_KEY'] as const;

export function loadConfig(env: NodeJS.ProcessEnv, dataDir: string): AppConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`server/.env에 다음 값이 없습니다: ${missing.join(', ')}`);
  }

  const port = env.PORT?.trim() ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT 값이 올바르지 않습니다: ${env.PORT}`);
  }

  const apsClientId = env.APS_CLIENT_ID!.trim();
  return {
    apsClientId,
    apsClientSecret: env.APS_CLIENT_SECRET!.trim(),
    appAccessKey: env.APP_ACCESS_KEY!.trim(),
    bucketKey: env.APS_BUCKET_KEY?.trim() || defaultBucketKey(apsClientId),
    port,
    dataDir,
  };
}

export function defaultBucketKey(clientId: string): string {
  const hash = createHash('sha256').update(clientId).digest('hex').slice(0, 16);
  return `mangdo-${hash}`;
}
