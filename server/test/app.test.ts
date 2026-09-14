import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, newDrawingId, type DrawingRecord } from '../src/drawingsStore.js';
import { OriginalsStore } from '../src/originalsStore.js';

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
  const originals = new OriginalsStore(join(dir, 'data', 'drawings'));
  const app = createApp({
    accessKey: KEY,
    aps,
    drawings,
    damages,
    originals,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
  });
  return { app, aps, drawings, damages, originals };
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

const templatePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

const RECT_DWG = [[0, 0], [1000, 0], [1000, 400], [0, 400]];

function exportDoc(drawingId: string) {
  return {
    schemaVersion: 4,
    drawingId,
    updatedAt: '2026-09-15T01:00:00.000Z',
    damages: [
      {
        id: 'e1',
        type: 'spalling',
        createdAt: '2026-09-15T01:00:00.000Z',
        geometry: { kind: 'rect', world: RECT_DWG, dwg: RECT_DWG as number[][] | null },
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
