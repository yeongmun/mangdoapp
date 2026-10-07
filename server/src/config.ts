import { createHash } from 'node:crypto';

export interface AppConfig {
  apsClientId: string;
  apsClientSecret: string;
  appAccessKey: string;
  /** 읽기 전용 접근키(선택). 웹(daenong)이 손상 원장을 읽을 때 쓴다. 없으면 읽기 전용 접근은 꺼진다. */
  appReadKey: string | null;
  bucketKey: string;
  port: number;
  dataDir: string;
}

const REQUIRED = ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APP_ACCESS_KEY'] as const;
const ACCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{20,}$/;

export function loadConfig(env: NodeJS.ProcessEnv, dataDir: string): AppConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`server/.env에 다음 값이 없습니다: ${missing.join(', ')}`);
  }

  // 앱의 .env.local은 @expo/env가 읽어 #을 주석으로, $를 변수로 해석하고, fetch 헤더에는 ASCII만 들어간다.
  if (!ACCESS_KEY_PATTERN.test(env.APP_ACCESS_KEY!.trim())) {
    throw new Error('APP_ACCESS_KEY는 영문·숫자·-·_ 로만 20자 이상이어야 합니다.');
  }

  const appReadKey = env.APP_READ_KEY?.trim() || null;
  if (appReadKey !== null) {
    if (!ACCESS_KEY_PATTERN.test(appReadKey)) {
      throw new Error('APP_READ_KEY는 영문·숫자·-·_ 로만 20자 이상이어야 합니다.');
    }
    if (appReadKey === env.APP_ACCESS_KEY!.trim()) {
      throw new Error('APP_READ_KEY는 APP_ACCESS_KEY와 달라야 합니다.');
    }
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
    appReadKey,
    bucketKey: env.APS_BUCKET_KEY?.trim() || defaultBucketKey(apsClientId),
    port,
    dataDir,
  };
}

export function defaultBucketKey(clientId: string): string {
  const hash = createHash('sha256').update(clientId).digest('hex').slice(0, 16);
  return `mangdo-${hash}`;
}
