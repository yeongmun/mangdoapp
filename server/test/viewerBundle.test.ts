import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTODESK_VIEWER_FILES, AUTODESK_VIEWER_VERSION, ViewerBundle } from '../src/viewerBundle.js';

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
  it('오토데스크 파일: CDN 가짜를 한 번만 부르고 gzip을 풀어 저장한다', async () => {
    const gz = gzipSync(Buffer.from('viewer3d-content'));
    const fetchCdn = fakeFetchCdn(async () => ({ status: 200, body: gz, contentEncoding: 'gzip' }));
    const bundle = new ViewerBundle(publicDir, cacheDir, fetchCdn);

    const data1 = await bundle.read('autodesk/viewer3D.min.js');
    expect(data1?.toString('utf8')).toBe('viewer3d-content');
    expect(fetchCdn).toHaveBeenCalledTimes(1);

    const data2 = await bundle.read('autodesk/viewer3D.min.js');
    expect(data2?.toString('utf8')).toBe('viewer3d-content');
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
