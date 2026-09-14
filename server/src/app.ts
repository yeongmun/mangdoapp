import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { validateDamageDoc } from '../public/viewer/damageDoc.js';
import type { ApsService } from './aps.js';
import { requireAccessKey } from './auth.js';
import type { DamageDoc, DamagesStore } from './damagesStore.js';
import { isDrawingId, newDrawingId, type DrawingRecord, type DrawingsStore } from './drawingsStore.js';
import { ExportError, exportDamagesToDxf } from './export/exportDrawing.js';
import type { OriginalsStore } from './originalsStore.js';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface AppDeps {
  accessKey: string;
  aps: Pick<ApsService, 'getViewerToken' | 'uploadDrawing' | 'startTranslation' | 'getTranslationStatus'>;
  drawings: DrawingsStore;
  damages: DamagesStore;
  originals: OriginalsStore;
  publicDir: string;
  now?: () => number;
  maxUploadBytes?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findDrawing(deps: AppDeps, id: string): Promise<DrawingRecord | null> {
  return isDrawingId(id) ? deps.drawings.get(id) : null;
}

async function refreshStatus(deps: AppDeps, record: DrawingRecord): Promise<DrawingRecord> {
  if (record.status === 'success' || record.status === 'failed') return record;
  try {
    const next = await deps.aps.getTranslationStatus(record.urn);
    if (next.status === record.status && next.progress === record.progress && next.error === record.error) {
      return record;
    }
    return (await deps.drawings.update(record.id, next)) ?? record;
  } catch (err) {
    console.error('[status]', record.id, messageOf(err));
    return record;
  }
}

const apiErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: '파일이 100MB를 넘습니다.' });
    } else {
      res.status(400).json({ error: `업로드 형식 오류: ${err.code}` });
    }
    return;
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON 형식이 올바르지 않습니다.' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ error: '요청이 너무 큽니다.' });
    return;
  }
  console.error('[api]', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
};

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxUploadBytes ?? MAX_UPLOAD_BYTES },
  });

  const app = express();
  app.use(express.static(deps.publicDir));

  const api = express.Router();
  api.use(requireAccessKey(deps.accessKey));
  api.use(express.json({ limit: '5mb' }));

  api.post('/drawings', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'DWG 또는 DXF 파일이 없습니다.' });
      return;
    }
    // 브라우저가 보낸 name 필드는 UTF-8로 안전하게 들어온다. 없을 때만 multipart 파일명을 쓴다.
    const bodyName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const name = bodyName || file.originalname;
    const nameLower = name.toLowerCase();
    const isDwg = nameLower.endsWith('.dwg');
    const isDxf = nameLower.endsWith('.dxf');
    if (!isDwg && !isDxf) {
      res.status(400).json({ error: '.dwg 또는 .dxf 파일만 업로드할 수 있습니다.' });
      return;
    }

    const id = newDrawingId();
    const extension = isDwg ? '.dwg' : '.dxf';
    const objectKey = `${id}${extension}`;
    try {
      const { urn } = await deps.aps.uploadDrawing(file.buffer, objectKey);
      await deps.aps.startTranslation(urn);
      // 산출은 이 사본에서 시작한다(스펙 2장). APS가 성공한 뒤에만 남긴다.
      await deps.originals.save(objectKey, file.buffer);
      const record: DrawingRecord = {
        id,
        name,
        objectKey,
        urn,
        status: 'pending',
        progress: '',
        error: null,
        uploadedAt: new Date(now()).toISOString(),
      };
      await deps.drawings.add(record);
      res.status(201).json(record);
    } catch (err) {
      console.error('[upload]', err);
      res.status(502).json({ error: `APS 업로드 또는 변환 요청에 실패했습니다: ${messageOf(err)}` });
    }
  });

  api.get('/drawings', async (_req, res) => {
    const records = await deps.drawings.list();
    res.json(await Promise.all(records.map((record) => refreshStatus(deps, record))));
  });

  api.post('/drawings/:id/retry', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    if (drawing.status !== 'failed') {
      res.status(409).json({ error: '변환에 실패한 도면만 다시 시도할 수 있습니다.' });
      return;
    }
    try {
      await deps.aps.startTranslation(drawing.urn);
    } catch (err) {
      console.error('[retry]', err);
      res.status(502).json({ error: `변환 재요청에 실패했습니다: ${messageOf(err)}` });
      return;
    }
    res.json(await deps.drawings.update(drawing.id, { status: 'pending', progress: '', error: null }));
  });

  api.get('/viewer-token', async (_req, res) => {
    try {
      const token = await deps.aps.getViewerToken();
      const expiresIn = Math.max(0, Math.floor((token.expiresAt - now()) / 1000));
      res.json({ accessToken: token.accessToken, expiresIn });
    } catch (err) {
      console.error('[viewer-token]', err);
      res.status(502).json({ error: `뷰어 토큰 발급에 실패했습니다: ${messageOf(err)}` });
    }
  });

  api.get('/drawings/:id/damages', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    res.json(await deps.damages.get(drawing.id));
  });

  api.put('/drawings/:id/damages', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    const errors = validateDamageDoc(req.body, drawing.id);
    if (errors.length > 0) {
      res.status(400).json({ error: '손상 데이터 형식이 올바르지 않습니다.', details: errors });
      return;
    }
    const doc = req.body as DamageDoc;
    await deps.damages.save(doc);
    res.json({ updatedAt: doc.updatedAt });
  });

  api.get('/drawings/:id/export.dxf', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    if (!drawing.objectKey.toLowerCase().endsWith('.dxf')) {
      res.status(400).json({ error: 'DXF로 올린 도면만 산출할 수 있습니다' });
      return;
    }
    const original = await deps.originals.read(drawing.objectKey);
    if (!original) {
      res.status(400).json({ error: '원본 파일이 없습니다. 도면을 다시 올려 주세요' });
      return;
    }

    const doc = await deps.damages.get(drawing.id);
    let result;
    try {
      result = exportDamagesToDxf(original.toString('utf8'), doc.damages);
    } catch (err) {
      if (err instanceof ExportError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('[export]', drawing.id, err);
      res.status(500).json({ error: `DXF 산출에 실패했습니다: ${messageOf(err)}` });
      return;
    }

    // 한글은 HTTP 헤더 값에 그대로 넣을 수 없다(Node가 ERR_INVALID_CHAR로 던진다).
    // 파일명은 RFC 5987 filename*, 경고 문구는 퍼센트 인코딩으로 보낸다.
    const fileName = `${drawing.name.replace(/\.[^.]*$/, '')}_손상.dxf`;
    res.setHeader('Content-Type', 'application/dxf; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="damage.dxf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('X-Mangdo-Skipped', String(result.skipped));
    if (result.warnings.length > 0) {
      res.setHeader('X-Mangdo-Warning', encodeURIComponent(result.warnings.join('; ')));
    }
    res.send(Buffer.from(result.dxfText, 'utf8'));
  });

  api.use((_req, res) => {
    res.status(404).json({ error: '없는 API입니다.' });
  });
  api.use(apiErrorHandler);

  app.use('/api', api);
  return app;
}
