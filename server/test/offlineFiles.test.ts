import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestLike } from '../src/aps.js';
import { newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import {
  findF2dUrn,
  OfflineFilesStore,
  pathOfDerivative,
  siblingUrns,
} from '../src/offlineFiles.js';

// 스파이크에서 실측한 manifest 모양(설계 3.1): svf 파생의 geometry 노드 아래
// mime이 application/autodesk-f2d인 resource 노드가 f2d 파생이다.
const F2D_URN = 'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123_f2d/primaryGraphics.f2d';

const SVF_MANIFEST: ManifestLike = {
  status: 'success',
  progress: 'complete',
  derivatives: [
    {
      outputType: 'svf',
      status: 'success',
      children: [
        {
          type: 'geometry',
          name: '000',
          children: [
            {
              type: 'resource',
              role: '3d',
              mime: 'application/autodesk-svf',
              urn: 'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123.svf',
            },
            {
              type: 'resource',
              role: 'graphics',
              mime: 'application/autodesk-f2d',
              urn: F2D_URN,
            },
          ],
        },
      ],
    },
  ],
};

const NO_F2D_MANIFEST: ManifestLike = {
  status: 'success',
  progress: 'complete',
  derivatives: [
    {
      outputType: 'svf',
      status: 'success',
      children: [
        {
          type: 'geometry',
          name: '000',
          children: [
            {
              type: 'resource',
              role: '3d',
              mime: 'application/autodesk-svf',
              urn: 'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123.svf',
            },
          ],
        },
      ],
    },
  ],
};

const SVF2_ONLY_MANIFEST: ManifestLike = {
  status: 'success',
  progress: 'complete',
  derivatives: [
    {
      outputType: 'svf2',
      status: 'success',
      children: [
        {
          type: 'resource',
          role: 'graphics',
          mime: 'application/vnd.autodesk-svf2+zip',
          urn: 'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123.svf2',
        },
      ],
    },
  ],
};

describe('findF2dUrn', () => {
  it('svf 파생 아래 f2d 리소스 노드의 urn을 찾는다', () => {
    expect(findF2dUrn(SVF_MANIFEST)).toBe(F2D_URN);
  });

  it('f2d 노드가 없으면 null', () => {
    expect(findF2dUrn(NO_F2D_MANIFEST)).toBeNull();
  });

  it('svf2 파생만 있으면 null', () => {
    expect(findF2dUrn(SVF2_ONLY_MANIFEST)).toBeNull();
  });

  it('derivatives가 없으면 null', () => {
    expect(findF2dUrn({ status: 'success' })).toBeNull();
  });
});

describe('siblingUrns', () => {
  it('f2d와 같은 폴더의 manifest.json.gz·metadata.json.gz를 만든다', () => {
    expect(siblingUrns(F2D_URN)).toEqual([
      F2D_URN,
      'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123_f2d/manifest.json.gz',
      'urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123_f2d/metadata.json.gz',
    ]);
  });
});

describe('pathOfDerivative', () => {
  it("'/output/' 뒤 상대 경로를 돌려준다", () => {
    expect(pathOfDerivative(F2D_URN)).toBe('0ab7c123_f2d/primaryGraphics.f2d');
  });

  it("'/output/'이 없으면 던진다", () => {
    expect(() => pathOfDerivative('urn:adsk.viewing:fs.file:dGVzdA==/no-output-here')).toThrow();
  });
});

function fakeAps(overrides: Record<string, unknown> = {}) {
  return {
    getRawManifest: vi.fn(async (_urn: string) => SVF_MANIFEST),
    downloadDerivative: vi.fn(async (_urn: string, derivativeUrn: string) => Buffer.from(`data:${derivativeUrn}`)),
    ...overrides,
  };
}

function record(patch: Partial<DrawingRecord> = {}): DrawingRecord {
  const id = newDrawingId();
  return {
    id,
    name: '교량.dwg',
    objectKey: `${id}.dwg`,
    urn: `urn-${id}`,
    status: 'success',
    progress: 'complete',
    error: null,
    uploadedAt: '2026-09-10T00:00:00.000Z',
    viewFormat: 'svf',
    ...patch,
  };
}

describe('OfflineFilesStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mangdo-offline-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('listing은 파일 3개를 캐시에 확보하며 size를 채우고, 두 번째부터는 오토데스크를 다시 부르지 않는다', async () => {
    const aps = fakeAps();
    const store = new OfflineFilesStore(dir, aps);
    const drawing = record();

    const listing1 = await store.listing(drawing, '2026-09-10T01:00:00.000Z');
    expect(listing1).toEqual({
      drawingId: drawing.id,
      viewFormat: 'svf',
      model: '0ab7c123_f2d/primaryGraphics.f2d',
      files: [
        { path: '0ab7c123_f2d/primaryGraphics.f2d', size: `data:${F2D_URN}`.length },
        {
          path: '0ab7c123_f2d/manifest.json.gz',
          size: 'data:urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123_f2d/manifest.json.gz'.length,
        },
        {
          path: '0ab7c123_f2d/metadata.json.gz',
          size: 'data:urn:adsk.viewing:fs.file:dGVzdA==/output/0ab7c123_f2d/metadata.json.gz'.length,
        },
      ],
      damagesUpdatedAt: '2026-09-10T01:00:00.000Z',
    });
    expect(aps.downloadDerivative).toHaveBeenCalledTimes(3);

    const listing2 = await store.listing(drawing, '2026-09-10T01:00:00.000Z');
    expect(listing2).toEqual(listing1);
    // 캐시가 있으므로 두 번째 listing은 오토데스크에서 다시 받지 않는다.
    expect(aps.downloadDerivative).toHaveBeenCalledTimes(3);
  });

  it('read는 캐시에 있는 파일만 준다', async () => {
    const aps = fakeAps();
    const store = new OfflineFilesStore(dir, aps);
    const drawing = record();
    const listing = await store.listing(drawing, '2026-09-10T01:00:00.000Z');

    const data = await store.read(drawing.id, listing.files[0].path);
    expect(data?.toString('utf8')).toBe(`data:${F2D_URN}`);

    expect(await store.read(drawing.id, 'not-cached.json')).toBeNull();
    expect(await store.read('d_다른도면', listing.files[0].path)).toBeNull();
  });

  it('read는 경로 조작을 거부한다', async () => {
    const store = new OfflineFilesStore(dir, fakeAps());
    const drawing = record();
    await store.listing(drawing, '2026-09-10T01:00:00.000Z');

    expect(await store.read(drawing.id, '../secrets.json')).toBeNull();
    expect(await store.read(drawing.id, 'a/../../secrets.json')).toBeNull();
    expect(await store.read(drawing.id, '/etc/passwd')).toBeNull();
    expect(await store.read(drawing.id, '\\windows\\system32')).toBeNull();
    expect(await store.read(drawing.id, 'a\\b')).toBeNull();
  });

  it('디스크에 실제로 캐시 파일을 남긴다', async () => {
    const store = new OfflineFilesStore(dir, fakeAps());
    const drawing = record();
    const listing = await store.listing(drawing, '2026-09-10T01:00:00.000Z');
    const onDisk = await readFile(join(dir, drawing.id, listing.files[0].path));
    expect(onDisk.toString('utf8')).toBe(`data:${F2D_URN}`);
  });
});
