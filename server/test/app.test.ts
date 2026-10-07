import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, inflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManifestLike } from '../src/aps.js';
import { createApp } from '../src/app.js';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import { DrawingTrash } from '../src/drawingTrash.js';
import { OfflineFilesStore } from '../src/offlineFiles.js';
import { OriginalsStore } from '../src/originalsStore.js';
import { PhotosStore } from '../src/photosStore.js';
import { FILE_URL_SHIM } from '../src/viewerBundle.js';
import { newProjectId, ProjectsStore } from '../src/projectsStore.js';
import { AUTODESK_VIEWER_FILES, AUTODESK_VIEWER_VERSION, ViewerBundle } from '../src/viewerBundle.js';

// 오프라인 모드(설계 2장): offlineReady는 저장하지 않고 응답에만 붙는다 — 저장 타입(DrawingRecord)에는
// 없으므로 응답 바디를 다루는 테스트에서만 이 타입으로 읽는다.
type WithOfflineReady = DrawingRecord & { offlineReady: boolean };

const KEY = 'test-access-key';
const NOW = Date.parse('2026-09-10T00:00:00.000Z');
// 뷰어가 crypto.randomUUID()로 만드는 손상 id 형식. 사진 API는 UUID만 받는다.
const D1 = '11111111-1111-4111-8111-111111111111';
let dir: string;

// 오프라인 모드(설계 3.1): 오프라인 라우트 테스트가 쓰는 svf 파생 manifest 조각. 실측 모양대로
// svf 파생의 geometry 노드 아래 mime이 application/autodesk-f2d인 resource 노드가 f2d 파생이다.
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
          children: [{ type: 'resource', role: 'graphics', mime: 'application/autodesk-f2d', urn: F2D_URN }],
        },
      ],
    },
  ],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-app-'));
  await mkdir(join(dir, 'public', 'viewer'), { recursive: true });
  await writeFile(join(dir, 'public', 'hello.html'), '<p>hi</p>', 'utf8');
  // 오프라인 모드(설계 3.1): 뷰어 꾸러미 목록·파일 라우트가 읽는 최소한의 우리 뷰어 파일.
  await writeFile(join(dir, 'public', 'viewer.html'), '<html>viewer</html>', 'utf8');
  await writeFile(join(dir, 'public', 'viewer', 'main.js'), 'console.log(1);', 'utf8');
  await writeFile(join(dir, 'public', 'viewer', 'viewer.css'), 'body{margin:0}', 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeAps(overrides: Record<string, unknown> = {}) {
  return {
    getViewerToken: vi.fn(async () => ({ accessToken: 'viewer-tok', expiresAt: NOW + 3_599_000 })),
    uploadDrawing: vi.fn(async (_data: Buffer, objectKey: string) => ({ urn: `urn-${objectKey}` })),
    startTranslation: vi.fn(async (_urn: string) => undefined),
    getTranslationStatus: vi.fn(async (_urn: string) => ({
      status: 'inprogress' as const,
      progress: '50% complete',
      error: null,
    })),
    ...overrides,
  };
}

// 오프라인 모드(설계 3.1): GET /drawings/:id/offline·offline/files가 쓰는 가짜 APS 클라이언트.
// 기본값은 svf manifest를 돌려주고, 파생 urn을 그대로 내용 삼아 버퍼를 만든다.
function fakeOfflineAps(overrides: Record<string, unknown> = {}) {
  return {
    getRawManifest: vi.fn(async (_urn: string) => SVF_MANIFEST),
    downloadDerivative: vi.fn(async (_urn: string, derivativeUrn: string) => Buffer.from(`data:${derivativeUrn}`)),
    ...overrides,
  };
}

// 오프라인 모드(설계 3.1): GET /viewer-bundle·viewer-bundle/files가 쓰는 가짜 CDN. 작은 버퍼를
// gzip 없이 돌려준다 — gzip 해제 자체는 viewerBundle.test.ts에서 따로 확인한다.
function fakeFetchCdn(impl?: (url: string) => Promise<{ status: number; body: Buffer; contentEncoding: string | null }>) {
  return vi.fn(impl ?? (async (url: string) => ({ status: 200, body: Buffer.from(`cdn:${url}`), contentEncoding: null })));
}

function setup(
  apsOverrides: Record<string, unknown> = {},
  maxUploadBytes?: number,
  maxPhotoBytes?: number,
  offlineApsOverrides: Record<string, unknown> = {},
  fetchCdnImpl?: (url: string) => Promise<{ status: number; body: Buffer; contentEncoding: string | null }>,
  readKey?: string,
  converter?: import('../src/oda.js').DrawingConverter | null,
) {
  const aps = fakeAps(apsOverrides);
  const drawings = new DrawingsStore(join(dir, 'data', 'drawings.json'));
  const damages = new DamagesStore(join(dir, 'data', 'damages'));
  const originals = new OriginalsStore(join(dir, 'data', 'drawings'));
  const photos = new PhotosStore(join(dir, 'data', 'photos'));
  const projects = new ProjectsStore(join(dir, 'data', 'projects.json'));
  const trash = new DrawingTrash(
    {
      trashDir: join(dir, 'data', 'trash'),
      originalsDir: join(dir, 'data', 'drawings'),
      damagesDir: join(dir, 'data', 'damages'),
      photosDir: join(dir, 'data', 'photos'),
    },
    drawings,
    (id) => projects.get(id).then(Boolean),
  );
  const offlineAps = fakeOfflineAps(offlineApsOverrides);
  const offline = new OfflineFilesStore(join(dir, 'data', 'cache', 'derivatives'), offlineAps);
  const fetchCdn = fakeFetchCdn(fetchCdnImpl);
  const viewerBundle = new ViewerBundle(join(dir, 'public'), join(dir, 'data', 'cache', 'viewer'), fetchCdn);
  const app = createApp({
    accessKey: KEY,
    readKey,
    converter,
    aps,
    drawings,
    damages,
    originals,
    photos,
    trash,
    projects,
    offline,
    viewerBundle,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
    maxPhotoBytes,
  });
  return { app, aps, drawings, damages, originals, photos, trash, projects, offlineAps, offline, fetchCdn, viewerBundle };
}

async function seed(drawings: DrawingsStore, patch: Partial<DrawingRecord> = {}): Promise<DrawingRecord> {
  const id = newDrawingId();
  const name = patch.name ?? '교량.dwg';
  const extension = name.toLowerCase().endsWith('.dxf') ? '.dxf' : '.dwg';
  const record: DrawingRecord = {
    id,
    name,
    objectKey: `${id}${extension}`,
    urn: `urn-${id}`,
    status: 'pending',
    progress: '',
    error: null,
    uploadedAt: '2026-09-09T00:00:00.000Z',
    ...patch,
  };
  await drawings.add(record);
  return record;
}

function crackDoc(drawingId: string) {
  return {
    schemaVersion: 5,
    drawingId,
    updatedAt: '2026-09-10T01:00:00.000Z',
    damages: [
      {
        id: 'c1',
        type: 'crack',
        createdAt: '2026-09-10T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
        copies: [],
        measured: { width: 0.3, length: 5, count: 2 },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: ['12', '13'] },
      },
    ],
  };
}

// 사진이 붙은 손상 하나. 폭 0.2 → 손상현황 '균열(0.3mm미만)'.
function photoDoc(drawingId: string) {
  return {
    schemaVersion: 5,
    drawingId,
    updatedAt: '2026-09-18T01:00:00.000Z',
    damages: [
      {
        id: D1,
        type: 'crack',
        createdAt: '2026-09-18T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [1, 0]], dwg: [[0, 0], [1, 0]] },
        copies: [],
        measured: { width: 0.2, length: 5, count: 1 },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: ['101530'] },
      },
    ],
  };
}

function spallingDoc(drawingId: string) {
  return {
    schemaVersion: 5,
    drawingId,
    updatedAt: '2026-09-12T01:00:00.000Z',
    damages: [
      {
        id: 's1',
        type: 'spalling',
        createdAt: '2026-09-12T01:00:00.000Z',
        geometry: {
          kind: 'rect',
          world: [[0, 0], [2, 0], [2, 1], [0, 1]],
          dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
        },
        copies: [],
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: 2 },
        attrs: { note: '', statusText: '', photoNumbers: [] },
      },
    ],
  };
}

describe('정적 파일과 인증', () => {
  it('정적 페이지는 키 없이 열린다', async () => {
    const res = await request(setup().app).get('/hello.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('hi');
  });

  it('API는 키가 없으면 401', async () => {
    const res = await request(setup().app).get('/api/drawings');
    expect(res.status).toBe(401);
  });

  it('없는 API는 404', async () => {
    const res = await request(setup().app).get('/api/nope').set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '없는 API입니다.' });
  });
});

describe('POST /api/drawings', () => {
  it('DWG를 올리고 변환을 요청한 뒤 레코드를 만든다 (name 필드의 한글 이름 사용)', async () => {
    const { app, aps, drawings } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량 A.dwg')
      .attach('file', Buffer.from('dwg-bytes'), 'bridge.dwg');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: '교량 A.dwg',
      status: 'pending',
      progress: '',
      error: null,
      uploadedAt: '2026-09-10T00:00:00.000Z',
      // 오프라인 모드(설계 2장): 새로 올린 도면은 SVF(2D)로만 변환을 요청한다.
      viewFormat: 'svf',
      // status가 pending이라 아직 오프라인용으로 쓸 수 없다.
      offlineReady: false,
    });
    const id = res.body.id as string;
    expect(res.body.objectKey).toBe(`${id}.dwg`);
    expect(res.body.urn).toBe(`urn-${id}.dwg`);
    expect(aps.uploadDrawing).toHaveBeenCalledWith(Buffer.from('dwg-bytes'), `${id}.dwg`);
    expect(aps.startTranslation).toHaveBeenCalledWith(`urn-${id}.dwg`);
    // offlineReady는 저장하지 않고 응답에서만 계산한다(설계 2장).
    const { offlineReady, ...stored } = res.body;
    expect(await drawings.get(id)).toEqual(stored);
  });

  it('name이 없으면 원본 파일명을 쓴다', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('x'), 'plan.DWG');
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('plan.DWG');
  });

  it('파일이 없으면 400', async () => {
    const res = await request(setup().app).post('/api/drawings').set('x-access-key', KEY).field('name', 'a.dwg');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'DWG 또는 DXF 파일이 없습니다.' });
  });

  it('.dwg 또는 .dxf를 올리고 올바른 확장자로 저장한다', async () => {
    const { app, aps, drawings } = setup();
    // DXF 업로드
    const resDxf = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량 B.dxf')
      .attach('file', Buffer.from('dxf-bytes'), 'bridge.dxf');

    expect(resDxf.status).toBe(201);
    expect(resDxf.body).toMatchObject({
      name: '교량 B.dxf',
      status: 'pending',
    });
    const idDxf = resDxf.body.id as string;
    expect(resDxf.body.objectKey).toBe(`${idDxf}.dxf`);
    expect(resDxf.body.urn).toBe(`urn-${idDxf}.dxf`);
    expect(aps.uploadDrawing).toHaveBeenCalledWith(Buffer.from('dxf-bytes'), `${idDxf}.dxf`);
  });

  it('.dwg가 아니면 400이고 APS를 부르지 않는다', async () => {
    const { app, aps, drawings } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('x'), 'photo.jpg');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '.dwg 또는 .dxf 파일만 업로드할 수 있습니다.' });
    expect(aps.uploadDrawing).not.toHaveBeenCalled();
    expect(await drawings.list()).toEqual([]);
  });

  it('크기 제한을 넘으면 413', async () => {
    const { app } = setup({}, 4);
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('12345'), 'a.dwg');
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: '파일이 100MB를 넘습니다.' });
  });

  it('APS 실패 시 502이고 레코드를 만들지 않는다', async () => {
    const { app, drawings } = setup({ startTranslation: vi.fn(async () => { throw new Error('boom'); }) });
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('x'), 'a.dwg');
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'APS 업로드 또는 변환 요청에 실패했습니다: boom' });
    expect(await drawings.list()).toEqual([]);
  });

  it('업로드한 DXF 원본을 서버에도 보관한다', async () => {
    const { app, originals } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량.dxf')
      .attach('file', Buffer.from('  0\nSECTION\n'), 'bridge.dxf');

    expect(res.status).toBe(201);
    expect(await originals.read(`${res.body.id}.dxf`)).toEqual(Buffer.from('  0\nSECTION\n'));
  });

  it('DWG 원본도 보관한다', async () => {
    const { app, originals } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('dwg'), 'a.dwg');
    expect(await originals.read(`${res.body.id}.dwg`)).toEqual(Buffer.from('dwg'));
  });

  // R17(minor): APS 업로드·변환 요청이 이미 성공했으면 디스크 저장 실패로 업로드 전체를
  // 502로 되돌리지 않는다 — 로그만 남기고 레코드는 만든다(산출 시점에 "원본 파일이 없습니다"로 드러난다).
  it('원본 저장이 실패해도 레코드는 만들어진다(로그만 남긴다)', async () => {
    const { app, drawings, originals } = setup();
    originals.save = vi.fn(async () => {
      throw new Error('disk full');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량.dxf')
      .attach('file', Buffer.from('  0\nSECTION\n'), 'bridge.dxf');

    expect(res.status).toBe(201);
    const { offlineReady, ...stored } = res.body;
    expect(await drawings.get(res.body.id)).toEqual(stored);
    expect(errorSpy).toHaveBeenCalledWith('[upload] 원본 보관 실패', expect.any(String), expect.any(Error));

    errorSpy.mockRestore();
  });

  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 3장
  it('DXF를 올리면 망도틀 영역을 계산해 레코드에 넣는다', async () => {
    const { app, drawings } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '망도.dxf')
      .attach('file', await readFile(templatePath), 'template.dxf');

    expect(res.status).toBe(201);
    // 픽스처의 틀 하나(frames.test.ts에서 손으로 계산한 값)
    expect(res.body.frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await drawings.get(res.body.id))?.frames).toEqual(res.body.frames);
  });

  it('DWG 업로드는 원본을 읽을 수 없으므로 frames가 빈 배열이다', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('dwg'), 'a.dwg');
    expect(res.body.frames).toEqual([]);
  });

  it('읽을 수 없는 DXF는 frames를 빈 배열로 두고 업로드는 계속된다', async () => {
    const { app } = setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 코드·값 짝이 맞지 않는(홀수 줄) 파일이라 parseDxf가 던진다.
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('  0'), 'a.dxf');
    expect(res.status).toBe(201);
    expect(res.body.frames).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[frames]', expect.any(String), expect.stringContaining('홀수'));
    errorSpy.mockRestore();
  });

  // 근거: docs/superpowers/specs/2026-09-21-projects-design.md 3장
  it('projectId를 보내면 레코드에 실린다', async () => {
    const { app, drawings, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('projectId', project.id)
      .attach('file', Buffer.from('x'), 'a.dwg');

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(project.id);
    expect((await drawings.get(res.body.id))?.projectId).toBe(project.id);
  });

  it('projectId를 보내지 않으면 레코드에 그 키가 없다', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('x'), 'a.dwg');
    expect(res.status).toBe(201);
    expect('projectId' in res.body).toBe(false);
  });

  it('없는 프로젝트로 올리면 APS를 부르기 전에 404', async () => {
    const { app, aps, drawings } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('projectId', newProjectId())
      .attach('file', Buffer.from('x'), 'a.dwg');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '프로젝트를 찾을 수 없습니다.' });
    expect(aps.uploadDrawing).not.toHaveBeenCalled();
    expect(await drawings.list()).toEqual([]);
  });

  it('형식이 틀린 projectId도 404이고 APS를 부르지 않는다', async () => {
    const { app, aps } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('projectId', 'bad-id')
      .attach('file', Buffer.from('x'), 'a.dwg');

    expect(res.status).toBe(404);
    expect(aps.uploadDrawing).not.toHaveBeenCalled();
  });
});

describe('GET /api/drawings', () => {
  it('완료·실패가 아닌 도면만 상태를 조회해 저장한다', async () => {
    const { app, aps, drawings } = setup();
    const pending = await seed(drawings);
    const done = await seed(drawings, { status: 'success', progress: 'complete' });

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.body as WithOfflineReady[]).map((r) => [r.id, r]));
    expect(byId[pending.id]).toMatchObject({ status: 'inprogress', progress: '50% complete' });
    // done은 옛 레코드(viewFormat 없음)라 success여도 offlineReady는 false다(설계 2장).
    expect(byId[done.id]).toEqual({ ...done, frames: [], offlineReady: false });
    expect(aps.getTranslationStatus).toHaveBeenCalledTimes(1);
    expect(aps.getTranslationStatus).toHaveBeenCalledWith(pending.urn);
    expect((await drawings.get(pending.id))?.status).toBe('inprogress');
  });

  it('success이고 viewFormat이 svf인 도면은 offlineReady가 true다', async () => {
    const { app, drawings } = setup();
    const ready = await seed(drawings, { status: 'success', progress: 'complete', viewFormat: 'svf' });
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    const byId = Object.fromEntries((res.body as WithOfflineReady[]).map((r) => [r.id, r]));
    expect(byId[ready.id].offlineReady).toBe(true);
  });

  it('상태 조회가 실패해도 기존 레코드를 돌려준다', async () => {
    const { app, drawings } = setup({ getTranslationStatus: vi.fn(async () => { throw new Error('down'); }) });
    const pending = await seed(drawings);
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ ...pending, frames: [], offlineReady: false }]);
  });

  it('frames가 없는 옛 DXF 레코드는 목록에서 한 번 계산해 저장한다', async () => {
    const { app, drawings, originals } = setup();
    const old = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    await originals.save(old.objectKey, await readFile(templatePath));

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.body[0].frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await drawings.get(old.id))?.frames).toEqual(res.body[0].frames);
  });

  it('DWG 옛 레코드는 원본을 읽지 않고 빈 배열로 저장한다', async () => {
    const { app, drawings, originals } = setup();
    const old = await seed(drawings, { name: '교량.dwg', status: 'success', progress: 'complete' });
    const readSpy = vi.spyOn(originals, 'read');

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.body[0].frames).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
    expect((await drawings.get(old.id))?.frames).toEqual([]);
  });

  it('원본이 없는 DXF 레코드도 빈 배열로 저장해 다시 시도하지 않는다', async () => {
    const { app, drawings } = setup();
    const old = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    expect(res.body[0].frames).toEqual([]);
    expect((await drawings.get(old.id))?.frames).toEqual([]);
  });

  it('이미 frames가 있는 레코드는 다시 계산하지 않는다', async () => {
    const { app, drawings, originals } = setup();
    await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete', frames: [] });
    const readSpy = vi.spyOn(originals, 'read');
    const updateSpy = vi.spyOn(drawings, 'update');

    await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  // 회귀: 레거시 레코드 하나의 frames 저장 실패가 Promise.all을 reject시켜 목록 전체를
  // 500으로 만들던 결함(리뷰 1건) — 이제 그 레코드만 frames: []로 응답하고 저장은 건너뛴다.
  it('레거시 레코드 하나의 frames 저장이 실패해도 나머지 목록은 200으로 돌아온다', async () => {
    const { app, drawings, originals } = setup();
    const good = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    await originals.save(good.objectKey, await readFile(templatePath));
    const bad = await seed(drawings, { name: '교량2.dxf', status: 'success', progress: 'complete' });
    await originals.save(bad.objectKey, await readFile(templatePath));

    const originalUpdate = drawings.update.bind(drawings);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(drawings, 'update').mockImplementation(async (id, patch) => {
      if (id === bad.id) throw new Error('disk full');
      return originalUpdate(id, patch);
    });

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.body as WithOfflineReady[]).map((r) => [r.id, r]));
    expect(byId[bad.id].frames).toEqual([]);
    expect(byId[good.id].frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect(errorSpy).toHaveBeenCalledWith('[frames]', bad.id, expect.any(String));
    // 저장은 건너뛰었으므로 다음 요청에서 다시 시도한다.
    expect((await drawings.get(bad.id))?.frames).toBeUndefined();

    errorSpy.mockRestore();
  });
});

describe('POST /api/drawings/:id/retry', () => {
  it('실패한 도면은 변환을 다시 요청하고 대기 상태로 되돌린다', async () => {
    const { app, aps, drawings } = setup();
    const failed = await seed(drawings, { status: 'failed', progress: 'complete', error: '파일 오류' });
    const res = await request(app).post(`/api/drawings/${failed.id}/retry`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    // 변환 작업은 이제 SVF를 만드므로 다시 시도한 도면도 viewFormat이 svf가 된다(오프라인 설계 2장).
    expect(res.body).toEqual({ ...failed, status: 'pending', progress: '', error: null, frames: [], viewFormat: 'svf', offlineReady: false });
    expect(aps.startTranslation).toHaveBeenCalledWith(failed.urn);
    expect((await drawings.get(failed.id))?.viewFormat).toBe('svf');
  });

  it('frames 없는 옛 레코드를 재시도해도 응답에 frames가 채워진다', async () => {
    const { app, drawings, originals } = setup();
    const failed = await seed(drawings, { name: '망도.dxf', status: 'failed', progress: '', error: '파일 오류' });
    await originals.save(failed.objectKey, await readFile(templatePath));

    const res = await request(app).post(`/api/drawings/${failed.id}/retry`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body.frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await drawings.get(failed.id))?.frames).toEqual(res.body.frames);
  });

  it('실패 상태가 아니면 409', async () => {
    const { app, drawings } = setup();
    const pending = await seed(drawings);
    const res = await request(app).post(`/api/drawings/${pending.id}/retry`).set('x-access-key', KEY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: '변환에 실패한 도면만 다시 시도할 수 있습니다.' });
  });

  it('없는 id나 형식이 틀린 id는 404', async () => {
    const { app } = setup();
    for (const id of [newDrawingId(), 'bad-id']) {
      const res = await request(app).post(`/api/drawings/${id}/retry`).set('x-access-key', KEY);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: '도면을 찾을 수 없습니다.' });
    }
  });
});

// 오프라인 모드(설계 2장, 4장): SVF2로 올라간 옛 도면을 PC 업로드 페이지에서 SVF로 다시 변환한다.
describe('POST /api/drawings/:id/retranslate', () => {
  it('SVF2(또는 viewFormat 없음) 도면은 변환을 다시 걸고 pending·svf로 바꾼다', async () => {
    const { app, aps, drawings } = setup();
    const old = await seed(drawings, { status: 'success', progress: 'complete', error: null });
    const res = await request(app).post(`/api/drawings/${old.id}/retranslate`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ...old,
      status: 'pending',
      progress: '',
      error: null,
      viewFormat: 'svf',
      frames: [],
      offlineReady: false,
    });
    expect(aps.startTranslation).toHaveBeenCalledWith(old.urn);
    expect((await drawings.get(old.id))?.viewFormat).toBe('svf');
    expect((await drawings.get(old.id))?.status).toBe('pending');
  });

  it('viewFormat이 svf2로 저장된 도면도 다시 변환할 수 있다', async () => {
    const { app, drawings } = setup();
    const old = await seed(drawings, { status: 'success', viewFormat: 'svf2' });
    const res = await request(app).post(`/api/drawings/${old.id}/retranslate`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.viewFormat).toBe('svf');
  });

  it('없는 id나 형식이 틀린 id는 404', async () => {
    const { app } = setup();
    for (const id of [newDrawingId(), 'bad-id']) {
      const res = await request(app).post(`/api/drawings/${id}/retranslate`).set('x-access-key', KEY);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: '도면을 찾을 수 없습니다.' });
    }
  });

  it('이미 svf인 도면은 409', async () => {
    const { app, drawings, aps } = setup();
    const ready = await seed(drawings, { status: 'success', viewFormat: 'svf' });
    const res = await request(app).post(`/api/drawings/${ready.id}/retranslate`).set('x-access-key', KEY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: '이미 오프라인용(SVF)으로 변환된 도면입니다.' });
    expect(aps.startTranslation).not.toHaveBeenCalled();
  });

  it.each(['pending', 'inprogress'] as const)('변환 중(%s)이면 409', async (status) => {
    const { app, drawings, aps } = setup();
    const mid = await seed(drawings, { status });
    const res = await request(app).post(`/api/drawings/${mid.id}/retranslate`).set('x-access-key', KEY);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: '변환이 끝난 뒤에 다시 시도하세요.' });
    expect(aps.startTranslation).not.toHaveBeenCalled();
  });

  it('APS 재요청이 실패하면 502이고 레코드를 바꾸지 않는다', async () => {
    const { app, drawings } = setup({ startTranslation: vi.fn(async () => { throw new Error('boom'); }) });
    const old = await seed(drawings, { status: 'success' });
    const res = await request(app).post(`/api/drawings/${old.id}/retranslate`).set('x-access-key', KEY);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: `변환 재요청에 실패했습니다: boom` });
    expect((await drawings.get(old.id))?.status).toBe('success');
  });
});

describe('PATCH /api/drawings/:id (프로젝트로 옮기기)', () => {
  it('프로젝트로 옮긴다', async () => {
    const { app, drawings, projects } = setup();
    const drawing = await seed(drawings);
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');

    const res = await request(app)
      .patch(`/api/drawings/${drawing.id}`)
      .set('x-access-key', KEY)
      .send({ projectId: project.id });

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(project.id);
    expect((await drawings.get(drawing.id))?.projectId).toBe(project.id);
  });

  it('null을 보내면 미분류로 옮긴다', async () => {
    const { app, drawings, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const drawing = await seed(drawings, { projectId: project.id });

    const res = await request(app)
      .patch(`/api/drawings/${drawing.id}`)
      .set('x-access-key', KEY)
      .send({ projectId: null });

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBeNull();
    expect((await drawings.get(drawing.id))?.projectId).toBeNull();
  });

  it('응답은 ensureFrames를 거친다(옛 레코드도 frames가 채워진다)', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: '교량.dwg' });
    const res = await request(app)
      .patch(`/api/drawings/${drawing.id}`)
      .set('x-access-key', KEY)
      .send({ projectId: null });
    expect(res.body.frames).toEqual([]);
  });

  // 오프라인 모드(설계 2장): 도면을 옮기는 곳도 offlineReady를 붙여 보낸다.
  it('응답에 offlineReady가 붙는다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { status: 'success', viewFormat: 'svf' });
    const res = await request(app)
      .patch(`/api/drawings/${drawing.id}`)
      .set('x-access-key', KEY)
      .send({ projectId: null });
    expect(res.body.offlineReady).toBe(true);
  });

  it('본문에 projectId 키가 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).patch(`/api/drawings/${drawing.id}`).set('x-access-key', KEY).send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'projectId가 필요합니다.' });
  });

  it('projectId가 문자열도 null도 아니면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).patch(`/api/drawings/${drawing.id}`).set('x-access-key', KEY).send({ projectId: 42 });
    expect(res.status).toBe(400);
  });

  it('없는 프로젝트면 404', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .patch(`/api/drawings/${drawing.id}`)
      .set('x-access-key', KEY)
      .send({ projectId: newProjectId() });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '프로젝트를 찾을 수 없습니다.' });
  });

  it('없는 도면이면 404', async () => {
    const { app } = setup();
    const res = await request(app)
      .patch(`/api/drawings/${newDrawingId()}`)
      .set('x-access-key', KEY)
      .send({ projectId: null });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '도면을 찾을 수 없습니다.' });
  });


  it('접근키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).patch(`/api/drawings/${drawing.id}`).send({ projectId: null });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/viewer-token', () => {
  it('토큰과 남은 초를 돌려준다', async () => {
    const res = await request(setup().app).get('/api/viewer-token').set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: 'viewer-tok', expiresIn: 3599 });
  });

  it('발급 실패는 502', async () => {
    const { app } = setup({ getViewerToken: vi.fn(async () => { throw new Error('bad secret'); }) });
    const res = await request(app).get('/api/viewer-token').set('x-access-key', KEY);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: '뷰어 토큰 발급에 실패했습니다: bad secret' });
  });
});

describe('손상 문서 API', () => {
  it('없는 도면은 404', async () => {
    const res = await request(setup().app).get(`/api/drawings/${newDrawingId()}/damages`).set('x-access-key', KEY);
    expect(res.status).toBe(404);
  });

  it('저장 전에는 빈 문서, 저장 후에는 저장한 문서', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);

    const empty = await request(app).get(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY);
    expect(empty.body).toEqual({ schemaVersion: 5, drawingId: drawing.id, updatedAt: '1970-01-01T00:00:00.000Z', damages: [] });

    const doc = crackDoc(drawing.id);
    const put = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(doc);
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ updatedAt: doc.updatedAt });

    const saved = await request(app).get(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY);
    expect(saved.body).toEqual(doc);
  });

  it('형식이 틀리면 400과 상세 오류', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const bad = { ...crackDoc(drawing.id), schemaVersion: 9 };
    const res = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(bad);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '손상 데이터 형식이 올바르지 않습니다.', details: ['schemaVersion은 5이어야 합니다.'] });
  });

  it('면형 손상 문서도 저장·조회된다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const doc = spallingDoc(drawing.id);

    const put = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(doc);
    expect(put.status).toBe(200);

    const saved = await request(app).get(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY);
    expect(saved.body).toEqual(doc);
  });

  it('기타가 아닌 유형에 손상현황이 들어 있으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const bad = crackDoc(drawing.id);
    bad.damages[0].attrs.statusText = '직접 적은 값';

    const res = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(bad);

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('damages[0].attrs.statusText는 기타 유형에서만 쓸 수 있습니다.');
  });

  it('유형 목록에 없는 type은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const bad = crackDoc(drawing.id);
    bad.damages[0].type = 'nope';

    const res = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(bad);

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });

  it('JSON 문법 오류는 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .put(`/api/drawings/${drawing.id}/damages`)
      .set('x-access-key', KEY)
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'JSON 형식이 올바르지 않습니다.' });
  });
});

const templatePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

// 픽스처의 망도틀 영역(x 2000~4280, y 3160~3400) 안에 둔다 — 틀 밖이면 번호가 없고 경고 헤더가 붙는다.
const RECT_DWG = [[2100, 3200], [3100, 3200], [3100, 3300], [2100, 3300]];

function exportDoc(drawingId: string) {
  return {
    schemaVersion: 5,
    drawingId,
    updatedAt: '2026-09-15T01:00:00.000Z',
    damages: [
      {
        id: 'e1',
        type: 'spalling',
        createdAt: '2026-09-15T01:00:00.000Z',
        geometry: { kind: 'rect', world: RECT_DWG, dwg: RECT_DWG as number[][] | null },
        copies: [] as Array<{ world: number[][]; dwg: number[][] | null }>,
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: [] as string[] },
      },
    ],
  };
}

// application/dxf는 supertest가 파싱하지 않는다. 텍스트로 왔든 버퍼로 왔든 글자로 읽는다.
function bodyText(res: { text?: string; body: unknown }): string {
  if (typeof res.text === 'string' && res.text.length > 0) return res.text;
  return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body);
}

describe('GET /api/drawings/:id/export.dxf', () => {
  it('손상을 얹은 DXF를 파일로 돌려준다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: '교량 A.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/dxf');
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('교량 A_손상.dxf')}`);
    expect(res.headers['x-mangdo-skipped']).toBe('0');
    expect(res.headers['x-mangdo-warning']).toBeUndefined();
    expect(bodyText(res)).toContain('신규손상');
    expect(bodyText(res)).toContain('ANSI37');
  });

  it('손상이 없으면 400', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '표기한 손상이 없습니다' });
  });

  it('DWG로 올린 도면은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: '교량.dwg' });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'DXF로 올린 도면만 산출할 수 있습니다' });
  });

  it('사본이 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '원본 파일이 없습니다. 도면을 다시 올려 주세요' });
  });

  it('없는 도면은 404', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/drawings/${newDrawingId()}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '도면을 찾을 수 없습니다.' });
  });

  it('접근키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    expect((await request(app).get(`/api/drawings/${drawing.id}/export.dxf`)).status).toBe(401);
  });

  it('dwg 좌표가 없는 손상은 헤더로 개수를 알린다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    const doc = exportDoc(drawing.id);
    doc.damages.push({
      ...doc.damages[0],
      id: 'e2',
      geometry: { kind: 'rect', world: RECT_DWG, dwg: null },
    });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(doc);

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.headers['x-mangdo-skipped']).toBe('1');
  });

  it('표가 없으면 경고 헤더를 퍼센트 인코딩해 붙인다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    const template = (await readFile(templatePath, 'utf8')).replace('  0\nACAD_TABLE\n', '  0\nPOINT\n');
    await originals.save(drawing.objectKey, Buffer.from(template, 'utf8'));
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers['x-mangdo-warning'])).toBe('표 없음');
  });

  it('내부 오류는 500이고 상세 메시지를 응답에 남기지 않는다', async () => {
    // exportDamagesToDxf가 parseDxf에서 ExportError가 아닌 순수 Error를 던지도록,
    // 코드·값 짝이 맞지 않는(홀수 줄) 원본을 저장해 둔다. damages.get/originals.read는
    // 라우트의 try/catch 밖에서 불리므로(이미 400으로 처리됨) 여기서 스텁해도 이 경로를
    // 타지 않는다 — 실제로 고친 catch 블록을 지나가도록 parseDxf 실패를 직접 유도한다.
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await originals.save(drawing.objectKey, Buffer.from('  0', 'utf8'));
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'DXF 산출에 실패했습니다.' });
    expect(JSON.stringify(res.body)).not.toContain('홀수');
    expect(JSON.stringify(res.body)).not.toContain('코드와 값의 짝');
  });
});

describe('POST /api/drawings/:id/damages/:damageId/photos', () => {
  it('사진을 올리면 201과 번호·주소를 준다 (안드로이드 이름)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', '20260918_101530.jpg')
      .attach('file', Buffer.from('jpeg-bytes'), { filename: '20260918_101530.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      number: '101530',
      url: `/api/drawings/${drawing.id}/damages/${D1}/photos/101530`,
      thumbUrl: `/api/drawings/${drawing.id}/damages/${D1}/photos/101530/thumb`,
    });
    expect((await photos.list(drawing.id, D1)).map((e) => e.file)).toEqual(['101530.jpg']);
  });

  it('아이폰 HEIC 이름에서도 번호를 뽑고 확장자를 지킨다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', 'IMG_0021.HEIC')
      .attach('file', Buffer.from('heic'), { filename: 'IMG_0021.HEIC', contentType: 'image/heic' });

    expect(res.status).toBe(201);
    expect(res.body.number).toBe('0021');
    expect((await photos.list(drawing.id, D1)).map((e) => e.file)).toEqual(['0021.heic']);
  });

  it('filename 필드가 없으면 multipart 파일명을 쓴다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('jpeg'), { filename: 'IMG_0007.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.number).toBe('0007');
  });

  it('같은 번호를 다시 올리면 덮어쓴다 (확장자가 달라도 하나)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const post = () =>
      request(app).post(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);

    await post().attach('file', Buffer.from('one'), { filename: 'IMG_0001.jpg', contentType: 'image/jpeg' });
    const res = await post().attach('file', Buffer.from('twotwo'), {
      filename: 'IMG_0001.png',
      contentType: 'image/png',
    });

    expect(res.status).toBe(201);
    const list = await photos.list(drawing.id, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: '0001', file: '0001.png', size: 6 });
  });

  it('없는 도면은 404', async () => {
    const { app } = setup();
    const res = await request(app)
      .post(`/api/drawings/${newDrawingId()}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
  });

  it('UUID가 아닌 손상 id는 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/c1/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('손상 id 형식이 올바르지 않습니다.');
  });

  it('파일이 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', 'IMG_1.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진 파일이 없습니다.');
  });

  it('사진이 아닌 형식은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('hello'), { filename: 'memo.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JPEG·PNG·HEIC 사진만 올릴 수 있습니다.');
  });

  it('번호를 뽑지 못하면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: '.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진 파일 이름에서 사진번호를 찾을 수 없습니다.');
  });

  it('쓸 수 없는 글자가 든 번호는 400 (경로 조작 방지)', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', '사진 1.jpg')
      .attach('file', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('사진번호에 쓸 수 없는 글자가 있습니다');
  });

  it('상한을 넘으면 413', async () => {
    const { app, drawings } = setup({}, undefined, 10);
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('12345678901234567890'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('사진이 20MB를 넘습니다.');
  });

  it('접근키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/drawings/:id/damages/:damageId/photos', () => {
  it('번호 오름차순 목록을 준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('abc'));
    await photos.save(drawing.id, D1, '9', '.jpg', Buffer.from('de'));

    const res = await request(app).get(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { number: string }) => p.number)).toEqual(['9', '101530']);
    expect(res.body[0]).toMatchObject({
      number: '9',
      url: `/api/drawings/${drawing.id}/damages/${D1}/photos/9`,
      thumbUrl: `/api/drawings/${drawing.id}/damages/${D1}/photos/9/thumb`,
      size: 2,
    });
    expect(Number.isFinite(Date.parse(res.body[0].savedAt))).toBe(true);
  });

  it('사진이 없으면 빈 배열', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).get(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('없는 도면은 404, UUID가 아닌 손상 id는 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    expect(
      (await request(app).get(`/api/drawings/${newDrawingId()}/damages/${D1}/photos`).set('x-access-key', KEY)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/drawings/${drawing.id}/damages/c1/photos`).set('x-access-key', KEY)).status,
    ).toBe(400);
  });
});

describe('GET /api/drawings/:id/damages/:damageId/photos/:number', () => {
  it('저장한 바이트를 저장 시 형식으로 돌려준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('jpeg-bytes'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/101530`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.from(res.body).toString()).toBe('jpeg-bytes');
  });

  it('HEIC는 image/heic로 돌려준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '0021', '.heic', Buffer.from('heic'));
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/0021`)
      .set('x-access-key', KEY)
      .responseType('blob');
    expect(res.headers['content-type']).toBe('image/heic');
  });

  it('없는 번호는 404', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/999`)
      .set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('사진을 찾을 수 없습니다.');
  });

  it('쓸 수 없는 글자가 든 번호는 400 (경로 조작 방지)', async () => {
    // %2E%2E(퍼센트 인코딩된 점 두 개)는 슈퍼에이전트(superagent)가 URL을 WHATWG new URL()로
    // 파싱하며 점-세그먼트로 인식해 요청을 보내기도 전에 클라이언트 쪽에서 '/'로 접어버린다
    // (RFC 3986과 달리 WHATWG URL 명세는 %2e를 점 세그먼트 판정에서 '.'과 동일하게 본다) —
    // 그러면 서버는 이 라우트 자체를 못 만나 404('없는 API입니다')를 준다. 인코딩된 슬래시
    // (%2f)는 점-세그먼트 판정 대상이 아니라 그대로 전달되므로, 같은 경로 조작 방지 검사
    // (isPhotoNumber)를 실제로 태워 보는 값으로 쓴다.
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/..%2f..`)
      .set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진번호 형식이 올바르지 않습니다.');
  });
});

describe('GET /api/drawings/:id/photos.zip', () => {
  it('사진을 zip으로 묶어 보낸다 (이름은 망도틀번호_손상현황_사진번호)', async () => {
    const { app, drawings, damages, photos } = setup();
    const drawing = await seed(drawings, { name: '교량 A.dwg' });
    await damages.save(photoDoc(drawing.id));
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('photo-one'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('교량 A_사진.zip')}`,
    );
    const body = Buffer.from(res.body);
    // 진짜 zip인지: 첫 항목 머리글 서명 PK\x03\x04
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // 항목 이름은 머리글에 UTF-8 그대로 들어가고, store 방식이라 내용도 그대로 들어간다.
    // 이 시험 도면은 틀이 없으므로 망도틀 번호 자리가 000이다.
    expect(body.includes(Buffer.from('000_균열(0.3mm미만)_101530.jpg', 'utf8'))).toBe(true);
    expect(body.includes(Buffer.from('photo-one', 'utf8'))).toBe(true);
  });

  it('손상 기록이 없으면 삭제된손상 이름으로 넣는다 (사진을 버리지 않는다)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('x'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).includes(Buffer.from('삭제된손상_11111111_101530.jpg', 'utf8'))).toBe(true);
  });

  it('사진이 하나도 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).get(`/api/drawings/${drawing.id}/photos.zip`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('저장된 사진이 없습니다');
  });

  it('없는 도면은 404, 키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    expect((await request(app).get(`/api/drawings/${newDrawingId()}/photos.zip`).set('x-access-key', KEY)).status).toBe(
      404,
    );
    expect((await request(app).get(`/api/drawings/${drawing.id}/photos.zip`)).status).toBe(401);
  });
});

describe('사진 썸네일 (…/photos/:number/thumb)', () => {
  async function jpeg(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg()
      .toBuffer();
  }

  it('올릴 때 320px 썸네일을 옆에 만들고 GET …/thumb가 image/jpeg로 준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const post = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', 'IMG_0031.jpg')
      .attach('file', await jpeg(1600, 1200), { filename: 'IMG_0031.jpg', contentType: 'image/jpeg' });
    expect(post.status).toBe(201);
    const entry = (await photos.find(drawing.id, D1, '0031'))!;
    expect(await photos.readThumb(drawing.id, entry)).not.toBeNull();

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/0031/thumb`)
      .set('x-access-key', KEY)
      .responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    const meta = await sharp(Buffer.from(res.body)).metadata();
    expect([meta.width, meta.height]).toEqual([320, 240]);
  });

  it('썸네일을 못 만들어도(사진이 아닌 바이트) 업로드는 201이고 thumb는 404', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const post = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('jpeg-bytes'), { filename: 'IMG_0032.jpg', contentType: 'image/jpeg' });
    expect(post.status).toBe(201);
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/0032/thumb`)
      .set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('썸네일을 만들 수 없습니다.');
  });

  it('썸네일 파일이 없으면(옛 사진) 본 사진에서 만들어 저장한 뒤 준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '77', '.jpg', await jpeg(800, 1000));
    const entry = (await photos.find(drawing.id, D1, '77'))!;
    expect(await photos.readThumb(drawing.id, entry)).toBeNull();

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/77/thumb`)
      .set('x-access-key', KEY)
      .responseType('blob');
    expect(res.status).toBe(200);
    const meta = await sharp(Buffer.from(res.body)).metadata();
    expect([meta.width, meta.height]).toEqual([256, 320]);
    expect(await photos.readThumb(drawing.id, entry)).not.toBeNull();
  });

  it('없는 번호는 404, 형식이 틀린 번호는 400, 접근키 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const base = `/api/drawings/${drawing.id}/damages/${D1}/photos`;
    expect((await request(app).get(`${base}/999/thumb`).set('x-access-key', KEY)).status).toBe(404);
    expect((await request(app).get(`${base}/a.b/thumb`).set('x-access-key', KEY)).status).toBe(400);
    expect((await request(app).get(`${base}/999/thumb`)).status).toBe(401);
  });

  it('사진 zip에는 썸네일이 들어가지 않는다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', await jpeg(400, 300), { filename: 'IMG_0040.jpg', contentType: 'image/jpeg' });
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');
    expect(res.status).toBe(200);
    const names = Buffer.from(res.body).toString('latin1');
    expect(names).toContain('0040.jpg');
    expect(names).not.toContain('thumb');
  });
});

describe('도면 삭제·휴지통 (DELETE /api/drawings/:id, /api/trash)', () => {
  it('지우면 목록에서 빠지고 휴지통 목록에 나온다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings, { name: '교량 A.dxf' });
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('p'));

    const res = await request(app).delete(`/api/drawings/${drawing.id}`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: drawing.id,
      name: '교량 A.dxf',
      uploadedAt: drawing.uploadedAt,
      deletedAt: new Date(NOW).toISOString(),
    });
    expect(await drawings.get(drawing.id)).toBeNull();
    expect(await photos.listDrawing(drawing.id)).toEqual([]);

    const list = await request(app).get('/api/trash').set('x-access-key', KEY);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([res.body]);
  });

  it('지운 도면의 손상·사진 API는 404가 된다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    await request(app).delete(`/api/drawings/${drawing.id}`).set('x-access-key', KEY);
    expect((await request(app).get(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY)).status).toBe(404);
    expect(
      (await request(app).get(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY)).status,
    ).toBe(404);
  });

  it('복구하면 목록·사진이 돌아오고 휴지통에서 빠진다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('p'));
    await request(app).delete(`/api/drawings/${drawing.id}`).set('x-access-key', KEY);

    const res = await request(app).post(`/api/trash/${drawing.id}/restore`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(drawing.id);
    expect((await drawings.get(drawing.id))?.name).toBe(drawing.name);
    expect((await photos.listDrawing(drawing.id)).map((e) => e.number)).toEqual(['101530']);
    expect((await request(app).get('/api/trash').set('x-access-key', KEY)).body).toEqual([]);
  });

  it('없는 도면 삭제·없는 휴지통 복구는 404, 접근키 없으면 401', async () => {
    const { app } = setup();
    const id = newDrawingId();
    expect((await request(app).delete(`/api/drawings/${id}`).set('x-access-key', KEY)).status).toBe(404);
    expect((await request(app).delete('/api/drawings/nope').set('x-access-key', KEY)).status).toBe(404);
    expect((await request(app).post(`/api/trash/${id}/restore`).set('x-access-key', KEY)).status).toBe(404);
    expect((await request(app).delete(`/api/drawings/${id}`)).status).toBe(401);
    expect((await request(app).get('/api/trash')).status).toBe(401);
    expect((await request(app).post(`/api/trash/${id}/restore`)).status).toBe(401);
  });
});

describe('프로젝트 API (GET/POST/PATCH/DELETE /api/projects)', () => {
  describe('GET /api/projects', () => {
    it('빈 배열로 시작해 만든 뒤에는 트리 순서로 나온다', async () => {
      const { app, projects } = setup();
      expect((await request(app).get('/api/projects').set('x-access-key', KEY)).body).toEqual([]);

      const b = await projects.create({ name: 'B현장' }, '2026-09-01T00:00:00.000Z');
      const a = await projects.create({ name: 'A현장' }, '2026-09-01T00:00:01.000Z');
      const child = await projects.create({ name: 'A교', parentId: a.id }, '2026-09-01T00:00:02.000Z');

      const res = await request(app).get('/api/projects').set('x-access-key', KEY);
      expect(res.status).toBe(200);
      expect(res.body.map((p: { id: string; path: string }) => [p.id, p.path])).toEqual([
        [a.id, 'A현장'],
        [child.id, 'A현장 › A교'],
        [b.id, 'B현장'],
      ]);
      expect(res.body).toHaveLength(3);
    });

    it('접근키가 없으면 401', async () => {
      const res = await request(setup().app).get('/api/projects');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/projects', () => {
    it('만들면 201과 ProjectView(트리 계산 결과)를 준다', async () => {
      const { app } = setup();
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({ name: '오봉대교', memo: '메모' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: '오봉대교',
        memo: '메모',
        parentId: null,
        depth: 0,
        path: '오봉대교',
        drawingCount: 0,
        totalDrawingCount: 0,
        childCount: 0,
      });
    });

    it('하위 프로젝트를 만들 수 있다', async () => {
      const { app, projects } = setup();
      const top = await projects.create({ name: 'OO용역' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({ name: 'A교', parentId: top.id });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ depth: 1, path: 'OO용역 › A교' });
    });

    it('이름이 없으면 400', async () => {
      const { app } = setup();
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '프로젝트 이름은 1~80자로 적어 주세요.' });
    });

    it('없는 parentId는 404', async () => {
      const { app } = setup();
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({ name: '이름', parentId: newProjectId() });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: '상위 프로젝트를 찾을 수 없습니다.' });
    });

    it('하위 프로젝트 아래에는 만들 수 없다(depth) → 400', async () => {
      const { app, projects } = setup();
      const top = await projects.create({ name: 'OO용역' }, '2026-09-01T00:00:00.000Z');
      const child = await projects.create({ name: 'A교', parentId: top.id }, '2026-09-01T00:00:01.000Z');
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({ name: 'B', parentId: child.id });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '하위 프로젝트 안에는 프로젝트를 만들 수 없습니다.' });
    });

    it('같은 자리 같은 이름은 400', async () => {
      const { app, projects } = setup();
      await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).post('/api/projects').set('x-access-key', KEY).send({ name: '이름' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '같은 자리에 같은 이름의 프로젝트가 있습니다.' });
    });

    it('접근키가 없으면 401', async () => {
      const res = await request(setup().app).post('/api/projects').send({ name: '이름' });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('이름·메모를 고치고 ProjectView를 준다', async () => {
      const { app, projects } = setup();
      const project = await projects.create({ name: '이름', memo: '메모' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).patch(`/api/projects/${project.id}`).set('x-access-key', KEY).send({ memo: '새 메모' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: project.id, name: '이름', memo: '새 메모', path: '이름' });
    });

    it('없는 id는 404', async () => {
      const { app } = setup();
      const res = await request(app).patch(`/api/projects/${newProjectId()}`).set('x-access-key', KEY).send({ memo: 'x' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: '프로젝트를 찾을 수 없습니다.' });
    });

    it('형식이 틀린 id도 404', async () => {
      const { app } = setup();
      const res = await request(app).patch('/api/projects/bad-id').set('x-access-key', KEY).send({ memo: 'x' });
      expect(res.status).toBe(404);
    });

    it('규칙 위반은 400', async () => {
      const { app, projects } = setup();
      const project = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).patch(`/api/projects/${project.id}`).set('x-access-key', KEY).send({ name: '' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: '프로젝트 이름은 1~80자로 적어 주세요.' });
    });

    it('접근키가 없으면 401', async () => {
      const { app, projects } = setup();
      const project = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).patch(`/api/projects/${project.id}`).send({ memo: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('비어 있으면 지우고 200 { id }', async () => {
      const { app, projects } = setup();
      const project = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).delete(`/api/projects/${project.id}`).set('x-access-key', KEY);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: project.id });
      expect(await projects.get(project.id)).toBeNull();
    });

    it('없는 id는 404', async () => {
      const { app } = setup();
      const res = await request(app).delete(`/api/projects/${newProjectId()}`).set('x-access-key', KEY);
      expect(res.status).toBe(404);
    });

    it('도면이 있으면 409, 문구에 도면 수가 들어간다', async () => {
      const { app, drawings, projects } = setup();
      const project = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      await seed(drawings, { projectId: project.id });
      const res = await request(app).delete(`/api/projects/${project.id}`).set('x-access-key', KEY);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: '비어 있는 프로젝트만 삭제할 수 있습니다. 도면 1개, 하위 프로젝트 0개가 있습니다.',
      });
    });

    it('하위 프로젝트가 있으면 409', async () => {
      const { app, projects } = setup();
      const top = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      await projects.create({ name: 'A교', parentId: top.id }, '2026-09-01T00:00:01.000Z');
      const res = await request(app).delete(`/api/projects/${top.id}`).set('x-access-key', KEY);
      expect(res.status).toBe(409);
    });

    it('접근키가 없으면 401', async () => {
      const { app, projects } = setup();
      const project = await projects.create({ name: '이름' }, '2026-09-01T00:00:00.000Z');
      const res = await request(app).delete(`/api/projects/${project.id}`);
      expect(res.status).toBe(401);
    });
  });
});

// zip 안 항목을 중앙 디렉터리(PK\x01\x02)에서 읽는다 — archiver가 데이터 디스크립터를 쓰면
// 로컬 헤더의 크기 필드가 0일 수 있어(export.zip의 deflate 항목) 중앙 디렉터리 쪽이 항상
// 정확하다(브리프 근거). store 항목(photos.zip)도 같은 방식으로 읽을 수 있다.
interface ZipCdEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function centralDirectoryEntries(buf: Buffer): ZipCdEntry[] {
  const CD_SIG = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const entries: ZipCdEntry[] = [];
  let offset = buf.indexOf(CD_SIG);
  while (offset !== -1 && buf.readUInt32LE(offset) === 0x02014b50) {
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryData(buf: Buffer, entry: ZipCdEntry): Buffer {
  const lh = entry.localHeaderOffset;
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  return entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

describe('GET /api/projects/:id/photos.zip', () => {
  it('고른 프로젝트는 최상위, 하위 프로젝트는 <하위>/ 폴더에 담고 썸네일은 넣지 않는다', async () => {
    const { app, projects, drawings, photos } = setup();
    const top = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const child = await projects.create({ name: 'A교', parentId: top.id }, '2026-09-01T00:00:01.000Z');
    const drawing = await seed(drawings, { name: '교량.dwg', projectId: child.id });
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('photo-one'));
    await photos.saveThumb(drawing.id, D1, '101530', Buffer.from('thumb-bytes'));

    const res = await request(app)
      .get(`/api/projects/${top.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('오봉대교_사진.zip')}`,
    );
    const body = Buffer.from(res.body);
    // 손상 기록이 없는 도면이라 '삭제된손상_…' 이름이 된다(photoZip.ts와 같은 규칙).
    expect(body.includes(Buffer.from('A교/교량/삭제된손상_11111111_101530.jpg', 'utf8'))).toBe(true);
    expect(body.includes(Buffer.from('thumb-bytes', 'utf8'))).toBe(false);
  });

  it('사진이 하나도 없으면 400', async () => {
    const { app, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const res = await request(app).get(`/api/projects/${project.id}/photos.zip`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '저장된 사진이 없습니다' });
  });

  it('없는 프로젝트는 404, 키가 없으면 401', async () => {
    const { app, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    expect(
      (await request(app).get(`/api/projects/${newProjectId()}/photos.zip`).set('x-access-key', KEY)).status,
    ).toBe(404);
    expect((await request(app).get(`/api/projects/${project.id}/photos.zip`)).status).toBe(401);
  });
});

describe('GET /api/projects/:id/export.zip', () => {
  it('DXF 도면은 산출하고 DWG 도면은 건너뛰어 건너뜀.txt에 사유를 남긴다', async () => {
    const { app, projects, drawings, originals } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const dxfDrawing = await seed(drawings, { name: '교량 A.dxf', projectId: project.id });
    await originals.save(dxfDrawing.objectKey, await readFile(templatePath));
    await request(app)
      .put(`/api/drawings/${dxfDrawing.id}/damages`)
      .set('x-access-key', KEY)
      .send(exportDoc(dxfDrawing.id));
    await seed(drawings, { name: '교량 B.dwg', projectId: project.id });

    const res = await request(app)
      .get(`/api/projects/${project.id}/export.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('오봉대교_손상.zip')}`,
    );
    const body = Buffer.from(res.body);
    const entries = centralDirectoryEntries(body);
    const names = entries.map((e) => e.name);
    expect(names).toContain('교량 A_손상.dxf');
    expect(names).toContain('건너뜀.txt');
    const skipEntry = entries.find((e) => e.name === '건너뜀.txt')!;
    expect(readZipEntryData(body, skipEntry).toString('utf8')).toBe(
      '교량 B.dwg: DXF로 올린 도면만 산출할 수 있습니다',
    );
    const dxfEntry = entries.find((e) => e.name === '교량 A_손상.dxf')!;
    expect(readZipEntryData(body, dxfEntry).toString('utf8')).toContain('신규손상');
  });

  it('전부 DWG면 400이고 사유가 하나면 괄호로 붙는다', async () => {
    const { app, projects, drawings } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    await seed(drawings, { name: '교량.dwg', projectId: project.id });

    const res = await request(app).get(`/api/projects/${project.id}/export.zip`).set('x-access-key', KEY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: '산출할 수 있는 도면이 없습니다 (DXF로 올린 도면만 산출할 수 있습니다)',
    });
  });

  it('도면이 하나도 없는 프로젝트는 400(괄호 없음)', async () => {
    const { app, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');

    const res = await request(app).get(`/api/projects/${project.id}/export.zip`).set('x-access-key', KEY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '산출할 수 있는 도면이 없습니다' });
  });

  it('없는 프로젝트는 404, 키가 없으면 401', async () => {
    const { app, projects } = setup();
    const project = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    expect(
      (await request(app).get(`/api/projects/${newProjectId()}/export.zip`).set('x-access-key', KEY)).status,
    ).toBe(404);
    expect((await request(app).get(`/api/projects/${project.id}/export.zip`)).status).toBe(401);
  });
});

// 손상 원장. 번호·손상현황·물량은 산출 DXF·사진 zip과 같은 함수를 쓴다(ledger.test.ts가 값을 검사하고,
// 여기서는 라우트가 틀·위치·손상을 제대로 모아 넘기는지만 본다).
describe('GET /api/drawings/:id/ledger', () => {
  it('틀·손상을 모아 행으로 준다', async () => {
    const { app, drawings, damages, originals } = setup();
    const drawing = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    // 템플릿 틀(x 2000~4280, y 3160~3400) 안의 균열 하나
    const doc = crackDoc(drawing.id);
    (doc.damages[0].geometry as { dwg: number[][] }).dwg = [[2100, 3200], [2300, 3200]];
    await damages.save(doc);

    const res = await request(app).get(`/api/drawings/${drawing.id}/ledger`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ drawingId: drawing.id, drawingName: '망도.dxf', frameCount: 1, outsideFrames: 0 });
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({
      damageId: 'c1',
      frameIndex: 0,
      no: 1,
      type: 'crack',
      statusText: '균열(0.3mm이상)',
      width: 0.3,
      widthUnit: 'mm',
      length: 5,
      count: 2,
      quantity: 10,
      unit: 'm',
      photoNumbers: ['12', '13'],
    });
  });

  it('손상이 없으면 빈 행', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: '교량.dwg' });
    const res = await request(app).get(`/api/drawings/${drawing.id}/ledger`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.frameCount).toBe(0);
  });

  it('없는 도면이면 404', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/drawings/${newDrawingId()}/ledger`).set('x-access-key', KEY);
    expect(res.status).toBe(404);
  });

  it('읽기 전용 키로 읽을 수 있고, 그 키로 PATCH는 403', async () => {
    const { app, drawings } = setup({}, undefined, undefined, {}, undefined, 'read-only-key-1234567890');
    const drawing = await seed(drawings, { name: '교량.dwg' });

    const read = await request(app).get(`/api/drawings/${drawing.id}/ledger`).set('x-access-key', 'read-only-key-1234567890');
    expect(read.status).toBe(200);

    const write = await request(app).patch(`/api/drawings/${drawing.id}`).set('x-access-key', 'read-only-key-1234567890').send({ projectId: null });
    expect(write.status).toBe(403);
  });
});

describe('GET /api/projects/:id/ledger', () => {
  it('프로젝트와 하위 프로젝트의 도면 원장을 사진 zip과 같은 순서로 준다', async () => {
    const { app, drawings, damages, projects } = setup();
    const parent = await projects.create({ name: '오봉대교' }, '2026-09-01T00:00:00.000Z');
    const child = await projects.create({ name: 'A교', parentId: parent.id }, '2026-09-01T00:00:00.000Z');
    const own = await seed(drawings, { name: '전경.dwg', projectId: parent.id });
    const sub = await seed(drawings, { name: '교대.dwg', projectId: child.id });
    await seed(drawings, { name: '남.dwg' }); // 미분류 — 빠진다
    await damages.save(crackDoc(sub.id));

    const res = await request(app).get(`/api/projects/${parent.id}/ledger`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(parent.id);
    expect(res.body.projectName).toBe('오봉대교');
    expect(res.body.drawings.map((d: { drawingId: string; subProject: string | null; rows: unknown[] }) => [d.drawingId, d.subProject, d.rows.length])).toEqual([
      [own.id, null, 0],
      [sub.id, 'A교', 1],
    ]);
    expect(res.body.drawings[1].rows[0]).toMatchObject({ no: 1, statusText: '균열(0.3mm이상)', quantity: 10 });
  });

  it('없는 프로젝트면 404', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/projects/${newProjectId()}/ledger`).set('x-access-key', KEY);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/drawings/:id/offline', () => {
  it('offlineReady인 도면의 목록을 준다', async () => {
    const { app, drawings, damages } = setup();
    const drawing = await seed(drawings, { status: 'success', progress: 'complete', viewFormat: 'svf' });
    await damages.save({ ...crackDoc(drawing.id), updatedAt: '2026-09-20T00:00:00.000Z' });

    const res = await request(app).get(`/api/drawings/${drawing.id}/offline`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      drawingId: drawing.id,
      viewFormat: 'svf',
      model: '0ab7c123_f2d/primaryGraphics.f2d',
      files: [
        { path: '0ab7c123_f2d/primaryGraphics.f2d', size: expect.any(Number) },
        { path: '0ab7c123_f2d/manifest.json.gz', size: expect.any(Number) },
        { path: '0ab7c123_f2d/metadata.json.gz', size: expect.any(Number) },
      ],
      damagesUpdatedAt: '2026-09-20T00:00:00.000Z',
    });
  });

  it('SVF2(또는 옛) 도면은 409', async () => {
    const { app, drawings } = setup();
    const svf2 = await seed(drawings, { status: 'success', progress: 'complete', viewFormat: 'svf2' });
    const legacy = await seed(drawings, { status: 'success', progress: 'complete' });

    for (const drawing of [svf2, legacy]) {
      const res = await request(app).get(`/api/drawings/${drawing.id}/offline`).set('x-access-key', KEY);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: '오프라인용으로 변환된 도면이 아닙니다.' });
    }
  });

  it('없는 도면은 404, 키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { status: 'success', viewFormat: 'svf' });
    expect((await request(app).get(`/api/drawings/${newDrawingId()}/offline`).set('x-access-key', KEY)).status).toBe(404);
    expect((await request(app).get(`/api/drawings/${drawing.id}/offline`)).status).toBe(401);
  });
});

describe('GET /api/drawings/:id/offline/files/*path', () => {
  it('목록에 있는 파일을 캐시해 두고 바이트로 준다(중첩 경로 포함)', async () => {
    const { app, drawings, offlineAps } = setup();
    const drawing = await seed(drawings, { status: 'success', viewFormat: 'svf' });
    // 캐시를 먼저 채운다(설계: read는 listing이 캐시에 둔 것만 준다).
    await request(app).get(`/api/drawings/${drawing.id}/offline`).set('x-access-key', KEY);

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/offline/files/0ab7c123_f2d/primaryGraphics.f2d`)
      .set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(Buffer.from(res.body).toString('utf8')).toBe(`data:${F2D_URN}`);
    // 두 번째 요청은 오토데스크를 다시 부르지 않는다(캐시 재사용).
    expect(offlineAps.downloadDerivative).toHaveBeenCalledTimes(3);
  });

  it('목록에 없는 path·도면 없음은 404, 키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { status: 'success', viewFormat: 'svf' });
    await request(app).get(`/api/drawings/${drawing.id}/offline`).set('x-access-key', KEY);

    const missing = await request(app)
      .get(`/api/drawings/${drawing.id}/offline/files/not-cached.json`)
      .set('x-access-key', KEY);
    expect(missing.status).toBe(404);

    const noDrawing = await request(app)
      .get(`/api/drawings/${newDrawingId()}/offline/files/0ab7c123_f2d/primaryGraphics.f2d`)
      .set('x-access-key', KEY);
    expect(noDrawing.status).toBe(404);

    expect(
      (await request(app).get(`/api/drawings/${drawing.id}/offline/files/0ab7c123_f2d/primaryGraphics.f2d`)).status,
    ).toBe(401);
  });
});

describe('GET /api/viewer-bundle', () => {
  it('버전과 파일 목록(우리 파일 + 오토데스크 7개)을 준다', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/viewer-bundle').set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(new RegExp(`^[0-9a-f]{12}-${AUTODESK_VIEWER_VERSION.replace(/\./g, '\.')}$`));
    const paths = (res.body.files as { path: string }[]).map((f) => f.path).sort();
    expect(paths).toEqual(
      ['viewer.html', 'viewer/main.js', 'viewer/viewer.css', ...AUTODESK_VIEWER_FILES.map((p) => `autodesk/${p}`)].sort(),
    );
  });

  it('키가 없으면 401', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/viewer-bundle')).status).toBe(401);
  });
});

describe('GET /api/viewer-bundle/files/*path', () => {
  it('우리 파일은 그대로, 오토데스크 파일은 gzip을 풀어 준다', async () => {
    const gz = gzipSync(Buffer.from('viewer3d-content'));
    const { app, fetchCdn } = setup({}, undefined, undefined, {}, async () => ({
      status: 200,
      body: gz,
      contentEncoding: 'gzip',
    }));

    const ours = await request(app).get('/api/viewer-bundle/files/viewer.html').set('x-access-key', KEY);
    expect(ours.status).toBe(200);
    expect(Buffer.from(ours.body).toString('utf8')).toBe('<html>viewer</html>');

    const first = await request(app)
      .get('/api/viewer-bundle/files/autodesk/viewer3D.min.js')
      .set('x-access-key', KEY);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('application/octet-stream');
    expect(first.headers['cache-control']).toBe('private, max-age=86400');
    // 뷰어 본체에는 file:// 보정 코드가 앞에 붙어 온다(viewerBundle.ts FILE_URL_SHIM).
    expect(Buffer.from(first.body).toString('utf8')).toBe(FILE_URL_SHIM + 'viewer3d-content');

    const second = await request(app)
      .get('/api/viewer-bundle/files/autodesk/viewer3D.min.js')
      .set('x-access-key', KEY);
    expect(Buffer.from(second.body).toString('utf8')).toBe(FILE_URL_SHIM + 'viewer3d-content');
    expect(fetchCdn).toHaveBeenCalledTimes(1);
  });

  it('목록에 없는 path는 404, 키가 없으면 401', async () => {
    const { app } = setup();
    expect(
      (await request(app).get('/api/viewer-bundle/files/not-listed.js').set('x-access-key', KEY)).status,
    ).toBe(404);
    expect((await request(app).get('/api/viewer-bundle/files/viewer.html')).status).toBe(401);
  });
});

// DWG ↔ DXF 변환기(ODA)가 있을 때. 변환기는 가짜 — DWG 바이트를 템플릿 DXF로, DXF 글자를 'DWG:' 접두 바이트로.
describe('DWG 변환기(ODA)가 있을 때', () => {
  async function fakeConverter(opts: { failDwgToDxf?: boolean } = {}) {
    const dxf = await readFile(templatePath);
    return {
      dwgToDxf: vi.fn(async () => {
        if (opts.failDwgToDxf) throw new Error('oda broke');
        return dxf;
      }),
      dxfToDwg: vi.fn(async (text: string) => Buffer.from(`DWG:${text.length}`)),
    };
  }

  it('DWG를 올리면 DXF로 바꿔 DXF로 올린 것과 똑같이 다룬다(objectKey .dxf, APS에 DXF, 틀 계산)', async () => {
    const converter = await fakeConverter();
    const { app, aps, drawings, originals } = setup({}, undefined, undefined, {}, undefined, undefined, converter);
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량 A.dwg')
      .attach('file', Buffer.from('dwg-bytes'), 'bridge.dwg');

    expect(res.status).toBe(201);
    const id = res.body.id as string;
    expect(res.body.name).toBe('교량 A.dwg');
    expect(res.body.objectKey).toBe(`${id}.dxf`);
    expect(converter.dwgToDxf).toHaveBeenCalledWith(Buffer.from('dwg-bytes'));
    expect(aps.uploadDrawing).toHaveBeenCalledWith(await readFile(templatePath), `${id}.dxf`);
    expect(res.body.frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await originals.read(`${id}.dxf`))?.equals(await readFile(templatePath))).toBe(true);
    expect((await drawings.get(id))?.objectKey).toBe(`${id}.dxf`);
    expect(res.headers['x-mangdo-warning']).toBeUndefined();
  });

  it('변환에 실패하면 예전처럼 DWG 그대로 올리고 경고 헤더를 준다', async () => {
    const converter = await fakeConverter({ failDwgToDxf: true });
    const { app, aps } = setup({}, undefined, undefined, {}, undefined, undefined, converter);
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량.dwg')
      .attach('file', Buffer.from('dwg-bytes'), 'bridge.dwg');
    expect(res.status).toBe(201);
    expect(res.body.objectKey).toBe(`${res.body.id}.dwg`);
    expect(res.body.frames).toEqual([]);
    expect(aps.uploadDrawing).toHaveBeenCalledWith(Buffer.from('dwg-bytes'), `${res.body.id}.dwg`);
    expect(decodeURIComponent(res.headers['x-mangdo-warning'])).toContain('oda broke');
  });

  it('DXF 업로드는 변환기를 거치지 않는다', async () => {
    const converter = await fakeConverter();
    const { app } = setup({}, undefined, undefined, {}, undefined, undefined, converter);
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '망도.dxf')
      .attach('file', await readFile(templatePath), 'template.dxf');
    expect(res.status).toBe(201);
    expect(converter.dwgToDxf).not.toHaveBeenCalled();
  });

  it('export.dwg: 산출 DXF를 DWG로 바꿔 준다', async () => {
    const converter = await fakeConverter();
    const { app, drawings, damages, originals } = setup({}, undefined, undefined, {}, undefined, undefined, converter);
    const drawing = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    await damages.save(crackDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dwg`).set('x-access-key', KEY).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/acad');
    expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers['content-disposition'])![1])).toBe('망도_손상.dwg');
    expect((res.body as Buffer).toString()).toMatch(/^DWG:\d+$/);
    expect(converter.dxfToDwg).toHaveBeenCalledTimes(1);
  });

  it('export.dwg: 변환기가 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: '망도.dxf' });
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dwg`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ODA_PATH');
  });
});
