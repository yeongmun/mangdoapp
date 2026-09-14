import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';

const KEY = 'test-access-key';
const NOW = Date.parse('2026-09-10T00:00:00.000Z');
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

function setup(apsOverrides: Record<string, unknown> = {}, maxUploadBytes?: number) {
  const aps = fakeAps(apsOverrides);
  const drawings = new DrawingsStore(join(dir, 'data', 'drawings.json'));
  const damages = new DamagesStore(join(dir, 'data', 'damages'));
  const app = createApp({
    accessKey: KEY,
    aps,
    drawings,
    damages,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
  });
  return { app, aps, drawings, damages };
}

async function seed(drawings: DrawingsStore, patch: Partial<DrawingRecord> = {}): Promise<DrawingRecord> {
  const id = newDrawingId();
  const record: DrawingRecord = {
    id,
    name: '교량.dwg',
    objectKey: `${id}.dwg`,
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
    schemaVersion: 4,
    drawingId,
    updatedAt: '2026-09-10T01:00:00.000Z',
    damages: [
      {
        id: 'c1',
        type: 'crack',
        createdAt: '2026-09-10T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
        measured: { width: 0.3, length: 5, count: 2 },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: ['12', '13'] },
      },
    ],
  };
}

function spallingDoc(drawingId: string) {
  return {
    schemaVersion: 4,
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
    expect(byId[done.id]).toEqual(done);
    expect(aps.getTranslationStatus).toHaveBeenCalledTimes(1);
    expect(aps.getTranslationStatus).toHaveBeenCalledWith(pending.urn);
    expect((await drawings.get(pending.id))?.status).toBe('inprogress');
  });

  it('상태 조회가 실패해도 기존 레코드를 돌려준다', async () => {
    const { app, drawings } = setup({ getTranslationStatus: vi.fn(async () => { throw new Error('down'); }) });
    const pending = await seed(drawings);
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([pending]);
  });
});

describe('POST /api/drawings/:id/retry', () => {
  it('실패한 도면은 변환을 다시 요청하고 대기 상태로 되돌린다', async () => {
    const { app, aps, drawings } = setup();
    const failed = await seed(drawings, { status: 'failed', progress: 'complete', error: '파일 오류' });
    const res = await request(app).post(`/api/drawings/${failed.id}/retry`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...failed, status: 'pending', progress: '', error: null });
    expect(aps.startTranslation).toHaveBeenCalledWith(failed.urn);
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
    expect(empty.body).toEqual({ schemaVersion: 4, drawingId: drawing.id, updatedAt: '1970-01-01T00:00:00.000Z', damages: [] });

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
    expect(res.body).toEqual({ error: '손상 데이터 형식이 올바르지 않습니다.', details: ['schemaVersion은 4이어야 합니다.'] });
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
