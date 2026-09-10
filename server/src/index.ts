import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ApsService } from './aps.js';
import { createSdkClients } from './apsSdk.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { DamagesStore } from './damagesStore.js';
import { DrawingsStore } from './drawingsStore.js';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
dotenv.config({ path: join(serverRoot, '.env'), quiet: true });

async function main(): Promise<void> {
  const config = loadConfig(process.env, join(serverRoot, 'data'));
  const aps = new ApsService(createSdkClients(config.apsClientId, config.apsClientSecret), config.bucketKey);

  try {
    await aps.getInternalToken();
    await aps.ensureBucket();
  } catch (err) {
    console.error('[server] APS 연결에 실패했습니다.');
    console.error('  - server/.env의 APS_CLIENT_ID, APS_CLIENT_SECRET 값을 확인하세요.');
    console.error('  - APS 콘솔에서 앱에 Data Management API, Model Derivative API가 켜져 있는지 확인하세요.');
    console.error(`  - 원인: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const app = createApp({
    accessKey: config.appAccessKey,
    aps,
    drawings: new DrawingsStore(join(config.dataDir, 'drawings.json')),
    damages: new DamagesStore(join(config.dataDir, 'damages')),
    publicDir: join(serverRoot, 'public'),
  });

  app.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port} 에서 실행 중 (버킷: ${config.bucketKey})`);
  });
}

main().catch((err: unknown) => {
  console.error(`[server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
