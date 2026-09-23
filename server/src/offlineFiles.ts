import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApsService } from './aps.js';
import type { ManifestLike, ManifestNode } from './aps.js';
import type { DrawingRecord } from './drawingsStore.js';
import { writeFileAtomic } from './jsonFile.js';

export interface OfflineFile {
  path: string;
  size: number;
}

export interface OfflineListing {
  drawingId: string;
  viewFormat: 'svf';
  model: string;
  files: OfflineFile[];
  damagesUpdatedAt: string;
}

// f2d 파생 리소스 노드: type이 resource, role이 graphics, mime이 application/autodesk-f2d.
function isF2dNode(node: ManifestNode): boolean {
  return node.type === 'resource' && node.role === 'graphics' && node.mime === 'application/autodesk-f2d' && !!node.urn;
}

function findF2dInChildren(nodes: ManifestNode[] | undefined): string | null {
  for (const node of nodes ?? []) {
    if (isF2dNode(node)) return node.urn as string;
    const found = findF2dInChildren(node.children);
    if (found) return found;
  }
  return null;
}

// 오프라인 모드(설계 3.1): manifest의 svf 파생(outputType === 'svf') 트리 아래에서 f2d 리소스
// 노드의 urn을 찾는다. svf2만 있거나 f2d 노드가 없으면(이론상 있을 수 없지만) null.
export function findF2dUrn(manifest: ManifestLike): string | null {
  for (const derivative of manifest.derivatives ?? []) {
    if (derivative.outputType !== 'svf') continue;
    const found = findF2dInChildren(derivative.children);
    if (found) return found;
  }
  return null;
}

// f2d와 같은 폴더에 있는(manifest에는 안 나오는) manifest.json.gz·metadata.json.gz를
// 파생 urn의 마지막 경로 조각을 바꿔서 만든다(설계 3.1).
export function siblingUrns(f2dUrn: string): string[] {
  const idx = f2dUrn.lastIndexOf('/');
  if (idx === -1) return [f2dUrn];
  const folder = f2dUrn.slice(0, idx);
  return [f2dUrn, `${folder}/manifest.json.gz`, `${folder}/metadata.json.gz`];
}

const OUTPUT_MARKER = '/output/';

// 파생 urn의 '/output/' 뒤 상대 경로. 캐시 안 파일 경로이자 files[].path 값이다(설계 3.1).
export function pathOfDerivative(derivativeUrn: string): string {
  const idx = derivativeUrn.indexOf(OUTPUT_MARKER);
  if (idx === -1) throw new Error(`파생 urn에 '${OUTPUT_MARKER}'가 없습니다: ${derivativeUrn}`);
  return derivativeUrn.slice(idx + OUTPUT_MARKER.length);
}

// '..'을 포함하거나 절대 경로('/' 또는 '\\'로 시작)이거나 '\\'를 포함하면 경로 조작으로 본다.
function isSafeRelativePath(path: string): boolean {
  if (!path) return false;
  if (path.includes('..')) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('\\')) return false;
  return true;
}

export class OfflineFilesStore {
  constructor(
    private readonly cacheDir: string,
    private readonly aps: Pick<ApsService, 'getRawManifest' | 'downloadDerivative'>,
  ) {}

  // 도면을 오프라인으로 두는 데 필요한 파일 3개(f2d·manifest.json.gz·metadata.json.gz)를 캐시에
  // 확보하며 size를 채운 목록을 돌려준다. 이미 캐시에 있는 파일은 다시 받지 않는다(설계 3.1).
  async listing(record: DrawingRecord, damagesUpdatedAt: string): Promise<OfflineListing> {
    const manifest = await this.aps.getRawManifest(record.urn);
    const f2dUrn = findF2dUrn(manifest);
    if (!f2dUrn) {
      throw new Error(`svf 파생에서 f2d 파일을 찾을 수 없습니다: ${record.id}`);
    }
    const files: OfflineFile[] = [];
    for (const derivativeUrn of siblingUrns(f2dUrn)) {
      const path = pathOfDerivative(derivativeUrn);
      const size = await this.ensureCached(record.id, record.urn, derivativeUrn, path);
      files.push({ path, size });
    }
    return {
      drawingId: record.id,
      viewFormat: 'svf',
      model: pathOfDerivative(f2dUrn),
      files,
      damagesUpdatedAt,
    };
  }

  // 캐시에 있는 파일만 준다(오토데스크를 다시 부르지 않는다). 경로 조작·캐시에 없음은 null.
  async read(drawingId: string, path: string): Promise<Buffer | null> {
    if (!isSafeRelativePath(path)) return null;
    try {
      return await readFile(join(this.cacheDir, drawingId, ...path.split('/')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async ensureCached(drawingId: string, urn: string, derivativeUrn: string, path: string): Promise<number> {
    const filePath = join(this.cacheDir, drawingId, ...path.split('/'));
    try {
      return (await stat(filePath)).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const data = await this.aps.downloadDerivative(urn, derivativeUrn);
    await writeFileAtomic(filePath, data);
    return data.byteLength;
  }
}
