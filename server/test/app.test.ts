import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import { DrawingTrash } from '../src/drawingTrash.js';
import { OriginalsStore } from '../src/originalsStore.js';
import { PhotosStore } from '../src/photosStore.js';

const KEY = 'test-access-key';
const NOW = Date.parse('2026-09-10T00:00:00.000Z');
// 뷰어가 crypto.randomUUID()로 만드는 손상 id 형식. 사진 API는 UUID만 받는다.
const D1 = '11111111-1111-4111-8111-111111111111';
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-app-'));
  await mkdir(join(dir, 'public'));
  await writeFile(join(dir, 'public', 'hello.html'), '<p>hi</p>', 'utf8');
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

function setup(apsOverrides: Record<string, unknown> = {}, maxUploadBytes?: number, maxPhotoBytes?: number) {
  const aps = fakeAps(apsOverrides);
  const drawings = new DrawingsStore(join(dir, 'data', 'drawings.json'));
  const damages = new DamagesStore(join(dir, 'data', 'damages'));
  const originals = new OriginalsStore(join(dir, 'data', 'drawings'));
  const photos = new PhotosStore(join(dir, 'data', 'photos'));
  const trash = new DrawingTrash(
    {
      trashDir: join(dir, 'data', 'trash'),
      originalsDir: join(dir, 'data', 'drawings'),
      damagesDir: join(dir, 'data', 'damages'),
      photosDir: join(dir, 'data', 'photos'),
    },
    drawings,
  );
  const app = createApp({
    accessKey: KEY,
    aps,
    drawings,
    damages,
    originals,
    photos,
    trash,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
    maxPhotoBytes,
  });
  return { app, aps, drawings, damages, originals, photos, trash };
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
    });
    const id = res.body.id as string;
    expect(res.body.objectKey).toBe(`${id}.dwg`);
    expect(res.body.urn).toBe(`urn-${id}.dwg`);
    expect(aps.uploadDrawing).toHaveBeenCalledWith(Buffer.from('dwg-bytes'), `${id}.dwg`);
    expect(aps.startTranslation).toHaveBeenCalledWith(`urn-${id}.dwg`);
    expect(await drawings.get(id)).toEqual(res.body);
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
    expect(await drawings.get(res.body.id)).toEqual(res.body);
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
});

describe('GET /api/drawings', () => {
  it('완료·실패가 아닌 도면만 상태를 조회해 저장한다', async () => {
    const { app, aps, drawings } = setup();
    const pending = await seed(drawings);
    const done = await seed(drawings, { status: 'success', progress: 'complete' });

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries((res.body as DrawingRecord[]).map((r) => [r.id, r]));
    expect(byId[pending.id]).toMatchObject({ status: 'inprogress', progress: '50% complete' });
    expect(byId[done.id]).toEqual({ ...done, frames: [] });
    expect(aps.getTranslationStatus).toHaveBeenCalledTimes(1);
    expect(aps.getTranslationStatus).toHaveBeenCalledWith(pending.urn);
    expect((await drawings.get(pending.id))?.status).toBe('inprogress');
  });

  it('상태 조회가 실패해도 기존 레코드를 돌려준다', async () => {
    const { app, drawings } = setup({ getTranslationStatus: vi.fn(async () => { throw new Error('down'); }) });
    const pending = await seed(drawings);
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ ...pending, frames: [] }]);
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
    const byId = Object.fromEntries((res.body as DrawingRecord[]).map((r) => [r.id, r]));
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
    expect(res.body).toEqual({ ...failed, status: 'pending', progress: '', error: null, frames: [] });
    expect(aps.startTranslation).toHaveBeenCalledWith(failed.urn);
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
  it('사진을 zip으로 묶어 보낸다 (이름은 번호_손상현황_사진번호)', async () => {
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
    expect(body.includes(Buffer.from('1_균열(0.3mm미만)_101530.jpg', 'utf8'))).toBe(true);
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
