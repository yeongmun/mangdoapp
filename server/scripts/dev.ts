import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig, type AppConfig } from '../src/config.js';
import { extractTunnelUrl, upsertEnvVars } from './tunnelUtils.js';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const envLocalPath = join(serverRoot, '..', '.env.local');
dotenv.config({ path: join(serverRoot, '.env'), quiet: true });

let config: AppConfig;
try {
  config = loadConfig(process.env, join(serverRoot, 'data'));
} catch (err) {
  console.error(`[dev] ${err instanceof Error ? err.message : String(err)}`);
  console.error('[dev] server/.env.example을 참고해 server/.env를 만들어 주세요.');
  process.exit(1);
}

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));

const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { cwd: serverRoot, stdio: 'inherit' });
children.push(server);
server.on('exit', (code) => {
  if (shuttingDown) return;
  console.error(`[dev] 서버가 종료되었습니다 (코드 ${code}).`);
  shutdown(code ?? 1);
});

// 고정 주소(이름 있는 터널, 예: https://mangdo.daenong.day)가 server/.env의 APP_PUBLIC_URL에 있으면 임시 터널을
// 열지 않고 그 주소를 .env.local에 쓴다 — 그 터널은 PC의 cloudflared(서비스·창)가 따로 띄운다(2026-11-04).
// 없으면 예전처럼 임시 터널(trycloudflare)을 열고 그때마다 바뀌는 주소를 쓴다.
const fixedUrl = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '') ?? '';

async function writeEnvLocal(url: string): Promise<boolean> {
  try {
    const current = await readFile(envLocalPath, 'utf8').catch(() => '');
    await writeFile(envLocalPath, upsertEnvVars(current, { EXPO_PUBLIC_API_URL: url, EXPO_PUBLIC_ACCESS_KEY: config.appAccessKey }), 'utf8');
  } catch (err) {
    console.error(`[dev] .env.local을 쓰지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[dev] 앱 서버 주소: ${url}`);
    console.error('[dev] 루트 .env.local에 EXPO_PUBLIC_API_URL과 EXPO_PUBLIC_ACCESS_KEY를 직접 적은 뒤 Expo를 시작하세요.');
    return false;
  }
  console.log('');
  console.log(`[dev] 앱 서버 주소: ${url}`);
  console.log(`[dev] PC 업로드 페이지: http://localhost:${config.port}/upload.html`);
  console.log('[dev] .env.local을 갱신했습니다. 다른 터미널에서 `npx expo start -c`를 실행하세요 (이미 실행 중이면 재시작).');
  console.log('');
  return true;
}

if (fixedUrl) {
  if (!/^https?:\/\/[^\s/]+$/.test(fixedUrl)) {
    console.error(`[dev] APP_PUBLIC_URL 값이 올바르지 않습니다: ${fixedUrl} (예: https://mangdo.daenong.day)`);
    shutdown(1);
  } else {
    console.log('[dev] 고정 주소(APP_PUBLIC_URL)를 씁니다 — 임시 터널은 열지 않습니다. PC의 cloudflared가 켜져 있어야 폰에서 열립니다.');
    void writeEnvLocal(fixedUrl);
  }
} else {
  startQuickTunnel();
}

function startQuickTunnel(): void {
  const cloudflaredPath = process.env.CLOUDFLARED_PATH ?? 'cloudflared';
  const tunnel = spawn(cloudflaredPath, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`], { cwd: serverRoot });
  children.push(tunnel);

  let logBuffer = '';
  let announced = false;
  const onTunnelOutput = (chunk: Buffer): void => {
    if (announced) return;
    // 주소가 두 조각으로 나뉘어 올 수 있어 최근 출력을 이어 붙여 찾는다.
    logBuffer = (logBuffer + chunk.toString('utf8')).slice(-4000);
    const url = extractTunnelUrl(logBuffer);
    if (!url) return;
    announced = true;
    void writeEnvLocal(url);
  };

  tunnel.stdout.on('data', onTunnelOutput);
  tunnel.stderr.on('data', onTunnelOutput);
  tunnel.on('error', (err) => {
    console.error(`[dev] cloudflared를 실행할 수 없습니다: ${err.message}`);
    console.error('[dev] cloudflared 설치 여부를 확인하거나 CLOUDFLARED_PATH 환경변수로 경로를 지정하세요.');
    shutdown(1);
  });
  tunnel.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[dev] 터널이 종료되었습니다 (코드 ${code}).`);
    shutdown(code ?? 1);
  });
}
