import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTODESK_VIEWER_FILES, AUTODESK_VIEWER_VERSION, FILE_URL_SHIM, ViewerBundle } from '../src/viewerBundle.js';

let dir: string;
let publicDir: string;
let cacheDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-viewerbundle-'));
  publicDir = join(dir, 'public');
  cacheDir = join(dir, 'cache');
  await mkdir(join(publicDir, 'viewer', 'nested'), { recursive: true });
  await writeFile(join(publicDir, 'viewer.html'), '<html>viewer</html>', 'utf8');
  await writeFile(join(publicDir, 'viewer', 'main.js'), 'console.log(1);', 'utf8');
  await writeFile(join(publicDir, 'viewer', 'viewer.css'), 'body{margin:0}', 'utf8');
  // 재귀 없이 한 단계만 본다 — 이 파일은 목록에 들어가면 안 된다.
  await writeFile(join(publicDir, 'viewer', 'nested', 'deep.js'), 'x', 'utf8');
  // 뷰어 파일이 아니므로 목록·버전 계산에 들어가면 안 된다.
  await writeFile(join(publicDir, 'upload.html'), '<html>upload</html>', 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetchCdn(impl?: (url: string) => Promise<{ status: number; body: Buffer; contentEncoding: string | null }>) {
  return vi.fn(impl ?? (async (url: string) => ({ status: 200, body: Buffer.from(`cdn:${url}`), contentEncoding: null })));
}

describe('ViewerBundle.listing', () => {
  it('버전 형식과 파일 목록(우리 파일 + 오토데스크 7개)', async () => {
    const fetchCdn = fakeFetchCdn();
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);

    const listing = await bundle.listing();

    expect(listing.version).toMatch(/^[0-9a-f]{12}-7\.126\.0$/);
    expect(listing.version.endsWith(`-${AUTODESK_VIEWER_VERSION}`)).toBe(true);

    const paths = listing.files.map((f) => f.path).sort();
    expect(paths).toEqual(
      [
        'viewer.html',
        'viewer/main.js',
        'viewer/viewer.css',
        ...AUTODESK_VIEWER_FILES.map((p) => `autodesk/${p}`),
      ].sort(),
    );
    for (const file of listing.files) {
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it('우리 파일 내용이 바뀌면 버전이 달라진다', async () => {
    const bundle = new ViewerBundle(publicDir, cacheDir, fakeFetchCdn());
    const v1 = (await bundle.listing()).version;

    await writeFile(join(publicDir, 'viewer', 'main.js'), 'console.log(2);', 'utf8');
    const v2 = (await bundle.listing()).version;

    expect(v2).not.toBe(v1);
    expect(v2.endsWith(`-${AUTODESK_VIEWER_VERSION}`)).toBe(true);
  });

  it('같은 내용이면 버전이 같다(경로순 이어붙이기)', async () => {
    const bundle1 = new ViewerBundle(publicDir, join(dir, 'cache1'), fakeFetchCdn());
    const bundle2 = new ViewerBundle(publicDir, join(dir, 'cache2'), fakeFetchCdn());
    expect((await bundle1.listing()).version).toBe((await bundle2.listing()).version);
  });
});

describe('ViewerBundle.read', () => {
  it('뷰어 본체와 작업자 스크립트에는 file:// 보정 코드를 앞에 붙이고, 다른 파일은 그대로다', async () => {
    const fetchCdn = fakeFetchCdn(async () => ({ status: 200, body: Buffer.from('X'), contentEncoding: null }));
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);
    const main = (await bundle.read('autodesk/viewer3D.min.js'))!.toString('utf8');
    const worker = (await bundle.read('autodesk/lmvworker.min.js'))!.toString('utf8');
    const locale = (await bundle.read('autodesk/res/locales/ko/allstrings.json'))!.toString('utf8');
    expect(main.startsWith(FILE_URL_SHIM)).toBe(true);
    expect(main.endsWith('X')).toBe(true);
    expect(worker.startsWith(FILE_URL_SHIM)).toBe(true);
    expect(locale).toBe('X');
    // 보정 코드는 그 자체로 문법이 맞아야 한다(붙인 파일이 통째로 깨지면 안 된다).
    expect(() => new Function(FILE_URL_SHIM)).not.toThrow();
    // 목록의 size도 보정 코드를 포함한 실제 응답 크기다.
    const listing = await bundle.listing();
    const entry = listing.files.find((f) => f.path === 'autodesk/viewer3D.min.js')!;
    expect(entry.size).toBe(Buffer.byteLength(FILE_URL_SHIM) + 1);
  });

  it('Node fetch가 이미 풀어 준 본문은 content-encoding 헤더가 남아 있어도 다시 풀지 않는다 (실서버 502 원인)', async () => {
    const fetchCdn = fakeFetchCdn(async () => ({ status: 200, body: Buffer.from('already-plain'), contentEncoding: 'gzip' }));
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);
    expect((await bundle.read('autodesk/viewer3D.min.js'))?.toString('utf8')).toBe(FILE_URL_SHIM + 'already-plain');
  });

  it('오토데스크 파일: CDN 가짜를 한 번만 부르고 gzip을 풀어 저장한다', async () => {
    const gz = gzipSync(Buffer.from('viewer3d-content'));
    const fetchCdn = fakeFetchCdn(async () => ({ status: 200, body: gz, contentEncoding: 'gzip' }));
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);

    const data1 = await bundle.read('autodesk/viewer3D.min.js');
    expect(data1?.toString('utf8')).toBe(FILE_URL_SHIM + 'viewer3d-content');
    expect(fetchCdn).toHaveBeenCalledTimes(1);

    const data2 = await bundle.read('autodesk/viewer3D.min.js');
    expect(data2?.toString('utf8')).toBe(FILE_URL_SHIM + 'viewer3d-content');
    expect(fetchCdn).toHaveBeenCalledTimes(1);

    // 디스크에 실제로 풀어서 저장됐다.
    const onDisk = await readFile(join(cacheDir, AUTODESK_VIEWER_VERSION, 'viewer3D.min.js'));
    expect(onDisk.toString('utf8')).toBe('viewer3d-content');
  });

  it('CDN이 이미 풀어 준 응답(content-encoding 없음)은 그대로 저장한다', async () => {
    const fetchCdn = fakeFetchCdn(async () => ({ status: 200, body: Buffer.from('plain'), contentEncoding: null }));
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);
    const data = await bundle.read('autodesk/style.min.css');
    expect(data?.toString('utf8')).toBe('plain');
  });

  it('우리 파일은 publicDir에서 그대로 준다', async () => {
    const bundle = new ViewerBundle(publicDir, cacheDir, fakeFetchCdn());
    expect((await bundle.read('viewer.html'))?.toString('utf8')).toBe('<html>viewer</html>');
    expect((await bundle.read('viewer/main.js'))?.toString('utf8')).toBe('console.log(1);');
  });

  it('목록에 없는 경로·경로 조작은 null', async () => {
    const bundle = new ViewerBundle(publicDir, cacheDir, fakeFetchCdn());
    expect(await bundle.read('upload.html')).toBeNull();
    expect(await bundle.read('viewer/nested/deep.js')).toBeNull();
    expect(await bundle.read('autodesk/not-listed.js')).toBeNull();
    expect(await bundle.read('../secret.txt')).toBeNull();
    expect(await bundle.read('/etc/passwd')).toBeNull();
    expect(await bundle.read('viewer\\main.js')).toBeNull();
  });
});
