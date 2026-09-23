import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { writeFileAtomic } from './jsonFile.js';

// 온라인 뷰어(viewer.html)도 같은 버전을 고정해 쓴다 — 로컬과 온라인이 같은 코드여야
// 좌표 변환이 같다(설계 3.1).
export const AUTODESK_VIEWER_VERSION = '7.126.0';

// 스파이크에서 실측한, 오프라인 뷰어가 실제로 쓰는 오토데스크 뷰어 파일 7개(설계 3.1).
/**
 * file://에서 도는 뷰어에 앞에 붙이는 보정 코드(2026-09-23 실기기: 아이폰 WebView가 `file://` XHR·fetch에
 * status 0을 주어 오토데스크 뷰어가 "오류 7 Unhandled response code"로 멈췄다). file: 주소의 응답만
 * status 200으로 보이게 하고, 그 밖의 요청은 손대지 않는다. 뷰어 본체와 작업자(worker) 스크립트
 * 둘 다 앞에 붙는다 — 작업자는 자기 전역에서 XHR을 쓰므로 페이지에 주입한 것으로는 닿지 않는다.
 * 온라인 뷰어는 이 꾸러미를 쓰지 않으므로 영향이 없다.
 */
export const FILE_URL_SHIM = `/* mangdo offline shim: file:// 응답 status 0 → 200 */
(function(g){try{var X=g.XMLHttpRequest;if(X){var P=X.prototype,o=P.open,d=Object.getOwnPropertyDescriptor(P,'status'),t=Object.getOwnPropertyDescriptor(P,'statusText');P.open=function(m,u){var h=typeof u==='string'?u:(u&&u.href)||'';this.__mangdoFile=String(h).indexOf('file:')===0;return o.apply(this,arguments)};if(d&&d.get){Object.defineProperty(P,'status',{configurable:true,get:function(){var s=d.get.call(this);return s===0&&this.__mangdoFile&&this.readyState===4?200:s}})}if(t&&t.get){Object.defineProperty(P,'statusText',{configurable:true,get:function(){var s=t.get.call(this);return this.__mangdoFile&&this.readyState===4&&!s?'OK':s}})}}var f=g.fetch;if(f){g.fetch=function(u,i){var url=typeof u==='string'?u:(u&&u.url)||'';if(String(url).indexOf('file:')!==0)return f.apply(this,arguments);return f.apply(this,arguments).then(function(r){if(r.status!==0)return r;return r.arrayBuffer().then(function(b){return new Response(b,{status:200,statusText:'OK',headers:r.headers})})})}}}catch(e){}})(typeof self!=='undefined'?self:this);
`;

/** 보정 코드를 앞에 붙이는 오토데스크 파일. */
export const SHIMMED_AUTODESK_FILES = ['viewer3D.min.js', 'lmvworker.min.js'];

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
    // 보정 코드(FILE_URL_SHIM)가 바뀌면 기기가 새 꾸러미를 받아야 하므로 해시에 함께 넣는다 —
    // 안 넣으면 버전이 같아 보여 고친 뷰어 스크립트가 기기에 내려가지 않는다.
    buffers.push(Buffer.from(FILE_URL_SHIM, 'utf8'));
    const version = `${this.hashOf(buffers)}-${AUTODESK_VIEWER_VERSION}`;

    const autodeskFiles: BundleFile[] = [];
    for (const path of AUTODESK_VIEWER_FILES) {
      const size = await this.ensureAutodeskCached(path);
      autodeskFiles.push({
        path: `${AUTODESK_PREFIX}${path}`,
        size: size + (SHIMMED_AUTODESK_FILES.includes(path) ? Buffer.byteLength(FILE_URL_SHIM) : 0),
      });
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
        const data = await readFile(this.autodeskFilePath(rel));
        return SHIMMED_AUTODESK_FILES.includes(rel) ? Buffer.concat([Buffer.from(FILE_URL_SHIM, 'utf8'), data]) : data;
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
