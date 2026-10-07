import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ApsService } from './aps.js';
import { createSdkClients } from './apsSdk.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { DamagesStore } from './damagesStore.js';
import { DrawingsStore } from './drawingsStore.js';
import { DrawingTrash } from './drawingTrash.js';
import { OfflineFilesStore } from './offlineFiles.js';
import { OriginalsStore } from './originalsStore.js';
import { PhotosStore } from './photosStore.js';
import { ProjectsStore } from './projectsStore.js';
import { ViewerBundle } from './viewerBundle.js';

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

  const drawings = new DrawingsStore(join(config.dataDir, 'drawings.json'));
  const projects = new ProjectsStore(join(config.dataDir, 'projects.json'));

  // 오프라인 모드(설계 3.1): 파생 파일·뷰어 꾸러미 캐시. fetchCdn은 전역 fetch로 CDN 파일을
  // 받는다. Node fetch는 보통 본문을 이미 풀어 주지만 content-encoding 헤더를 남기므로,
  // ViewerBundle은 헤더가 아니라 바이트(gzip 매직)로 풀지 말지 정한다.
  const fetchCdn = async (url: string) => {
    const response = await fetch(url);
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, body, contentEncoding: response.headers.get('content-encoding') };
  };

  const app = createApp({
    accessKey: config.appAccessKey,
    readKey: config.appReadKey,
    aps,
    drawings,
    damages: new DamagesStore(join(config.dataDir, 'damages')),
    originals: new OriginalsStore(join(config.dataDir, 'drawings')),
    photos: new PhotosStore(join(config.dataDir, 'photos')),
    trash: new DrawingTrash(
      {
        trashDir: join(config.dataDir, 'trash'),
        originalsDir: join(config.dataDir, 'drawings'),
        damagesDir: join(config.dataDir, 'damages'),
        photosDir: join(config.dataDir, 'photos'),
      },
      drawings,
      (id) => projects.get(id).then(Boolean),
    ),
    projects,
    offline: new OfflineFilesStore(join(config.dataDir, 'cache', 'derivatives'), aps),
    viewerBundle: new ViewerBundle(join(serverRoot, 'public'), join(config.dataDir, 'cache', 'viewer'), fetchCdn),
    publicDir: join(serverRoot, 'public'),
  });

  // Express 5는 listen 오류(EADDRINUSE 등)를 콜백 인자로 넘긴다.
  app.listen(config.port, (error?: Error) => {
    if (error) {
      console.error(`[server] 포트 ${config.port}을(를) 열 수 없습니다: ${error.message}`);
      console.error('  - 다른 프로그램이 이 포트를 쓰고 있다면 server/.env에 PORT=3001 처럼 다른 포트를 지정하세요.');
      process.exit(1);
    }
    console.log(`[server] http://localhost:${config.port} 에서 실행 중 (버킷: ${config.bucketKey})`);
  });
}

main().catch((err: unknown) => {
  console.error(`[server] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
