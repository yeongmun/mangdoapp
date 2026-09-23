import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { writeFileAtomic } from './jsonFile.js';

// 온라인 뷰어(viewer.html)도 같은 버전을 고정해 쓴다 — 로컬과 온라인이 같은 코드여야
// 좌표 변환이 같다(설계 3.1).
export const AUTODESK_VIEWER_VERSION = '7.126.0';

// 스파이크에서 실측한, 오프라인 뷰어가 실제로 쓰는 오토데스크 뷰어 파일 7개(설계 3.1).
export const AUTODESK_VIEWER_FILES = [
  'viewer3D.min.js',
  'style.min.css',
  'lmvworker.min.js',
  'res/locales/ko/allstrings.json',
  'res/locales/en/allstrings.json',
  'res/ui/powered-by-autodesk-blk-rgb.png',
  'extensions/MixpanelProvider/MixpanelProvider.min.js',
];

const AUTODESK_PREFIX = 'autodesk/';
const CDN_BASE = 'https://developer.api.autodesk.com/modelderivative/v2/viewers';

export interface BundleFile {
  path: string;
  size: number;
}

export interface BundleListing {
  version: string;
  files: BundleFile[];
}

export interface FetchCdnResult {
  status: number;
  body: Buffer;
  contentEncoding: string | null;
}

function isSafeRelativePath(path: string): boolean {
  if (!path) return false;
  if (path.includes('..')) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('\\')) return false;
  return true;
}

export class ViewerBundle {
  constructor(
    private readonly publicDir: string,
    private readonly cacheDir: string,
    private readonly fetchCdn: (url: string) => Promise<FetchCdnResult>,
  ) {}

  // 우리 파일(viewer.html + viewer/*.js·*.css, 재귀 없이 한 단계) + 오토데스크 파일 7개의 목록.
  // 오토데스크 파일은 캐시에 없으면 CDN에서 받아 확보한 뒤 size를 채운다(설계 3.1).
  async listing(): Promise<BundleListing> {
    const ownPaths = await this.listOwnPaths();
    const ownFiles: BundleFile[] = [];
    const buffers: Buffer[] = [];
    for (const path of ownPaths) {
      const data = await readFile(this.ownFilePath(path));
      ownFiles.push({ path, size: data.length });
      buffers.push(data);
    }
    const version = `${this.hashOf(buffers)}-${AUTODESK_VIEWER_VERSION}`;

    const autodeskFiles: BundleFile[] = [];
    for (const path of AUTODESK_VIEWER_FILES) {
      const size = await this.ensureAutodeskCached(path);
      autodeskFiles.push({ path: `${AUTODESK_PREFIX}${path}`, size });
    }

    return { version, files: [...ownFiles, ...autodeskFiles] };
  }

  // 'autodesk/…'는 캐시에서(없으면 CDN에서 받아 gzip이면 풀어 저장), 그 밖은 publicDir에서.
  // 목록에 없는 경로·경로 조작은 null(설계 3.1).
  async read(path: string): Promise<Buffer | null> {
    if (!isSafeRelativePath(path)) return null;
    if (path.startsWith(AUTODESK_PREFIX)) {
      const rel = path.slice(AUTODESK_PREFIX.length);
      if (!AUTODESK_VIEWER_FILES.includes(rel)) return null;
      await this.ensureAutodeskCached(rel);
      try {
        return await readFile(this.autodeskFilePath(rel));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
    }
    const ownPaths = await this.listOwnPaths();
    if (!ownPaths.includes(path)) return null;
    try {
      return await readFile(this.ownFilePath(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  // viewer.html과 viewer/ 바로 아래(재귀 없이)의 .js·.css 파일을 경로순으로.
  private async listOwnPaths(): Promise<string[]> {
    const paths = ['viewer.html'];
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(join(this.publicDir, 'viewer'), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') entries = [];
      else throw err;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.js') || entry.name.endsWith('.css')) {
        paths.push(`viewer/${entry.name}`);
      }
    }
    return paths.sort();
  }

  private ownFilePath(path: string): string {
    return join(this.publicDir, ...path.split('/'));
  }

  private autodeskFilePath(path: string): string {
    return join(this.cacheDir, AUTODESK_VIEWER_VERSION, ...path.split('/'));
  }

  private hashOf(buffers: Buffer[]): string {
    return createHash('sha256').update(Buffer.concat(buffers)).digest('hex').slice(0, 12);
  }

  private async ensureAutodeskCached(path: string): Promise<number> {
    const filePath = this.autodeskFilePath(path);
    try {
      return (await stat(filePath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const url = `${CDN_BASE}/${AUTODESK_VIEWER_VERSION}/${path}`;
    const res = await this.fetchCdn(url);
    if (res.status !== 200) {
      throw new Error(`뷰어 파일을 받지 못했습니다 (${res.status}): ${path}`);
    }
    // 실서버(2026-09-23): Node의 fetch는 본문을 이미 풀어 주면서도 content-encoding 헤더를 그대로
    // 남긴다 → 헤더만 믿고 다시 풀면 'incorrect header check'. 헤더가 아니라 **바이트**(gzip 매직
    // 1f 8b)로 판단한다. 헤더는 참고용으로만 남긴다.
    const looksGzip = res.body.length >= 2 && res.body[0] === 0x1f && res.body[1] === 0x8b;
    const data = looksGzip ? gunzipSync(res.body) : res.body;
    await writeFileAtomic(filePath, data);
    return data.length;
  }
}
