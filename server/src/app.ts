import { extname } from 'node:path';
import archiver from 'archiver';
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { validateDamageDoc } from '../public/viewer/damageDoc.js';
import { photoNumberFromFilename } from '../public/viewer/quantities.js';
import type { ApsService } from './aps.js';
import type { DrawingTrash } from './drawingTrash.js';
import { requireAccessKey } from './auth.js';
import type { DamageDoc, DamagesStore } from './damagesStore.js';
import { isDrawingId, newDrawingId, type DrawingRecord, type DrawingsStore } from './drawingsStore.js';
import { parseDxf } from './export/dxfDocument.js';
import { ExportError, exportDamagesToDxf } from './export/exportDrawing.js';
import { findFrames, type FrameBounds } from './export/frames.js';
import type { OriginalsStore } from './originalsStore.js';
import { makeThumbnail } from './photoThumb.js';
import { zipEntryNamesFor } from './photoZip.js';
import {
  isDamageId,
  isPhotoNumber,
  PHOTO_EXTENSIONS,
  PHOTO_MIME_TYPES,
  type PhotoEntry,
  type PhotosStore,
} from './photosStore.js';
import { baseNameOf, drawingFoldersFor, uniqueNames, type DrawingFolder } from './projectZip.js';
import { isProjectId, ProjectRuleError, type ProjectRuleCode, type ProjectsStore } from './projectsStore.js';
import { buildProjectViews, effectiveProjectId, type ProjectView } from './projectTree.js';

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// 사진 한 장의 상한. DXF(100MB)와 따로 둔다 — 3~5MB 사진이 20MB를 넘는 일은 없고,
// 잘못된 파일을 올리다 디스크가 차는 것을 막는다(스펙 2장).
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

export interface AppDeps {
  accessKey: string;
  aps: Pick<ApsService, 'getViewerToken' | 'uploadDrawing' | 'startTranslation' | 'getTranslationStatus'>;
  drawings: DrawingsStore;
  damages: DamagesStore;
  originals: OriginalsStore;
  photos: PhotosStore;
  trash: DrawingTrash;
  projects: ProjectsStore;
  publicDir: string;
  now?: () => number;
  maxUploadBytes?: number;
  maxPhotoBytes?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findDrawing(deps: AppDeps, id: string): Promise<DrawingRecord | null> {
  return isDrawingId(id) ? deps.drawings.get(id) : null;
}

// ProjectRuleError → 상태 코드(설계 3장): parent(상위를 못 찾음)는 404, notEmpty(삭제 규칙)는
// 409, 나머지(name·memo·duplicate·depth, 모두 입력값 문제)는 400.
function projectRuleStatus(code: ProjectRuleCode): number {
  if (code === 'parent') return 404;
  if (code === 'notEmpty') return 409;
  return 400;
}

// 프로젝트를 만들거나 고친 직후에도 응답은 항상 트리 계산(ProjectView)을 거쳐 돌려준다 —
// PC 페이지와 앱이 같은 path·개수 계산을 따로 갖지 않게 하기 위해서다(설계 3.1).
async function projectViewFor(deps: AppDeps, id: string): Promise<ProjectView | undefined> {
  const views = buildProjectViews(await deps.projects.list(), await deps.drawings.list());
  return views.find((v) => v.id === id);
}

// 사진 주소는 검증된 값 셋(도면 id, UUID, 영문·숫자·-·_)으로만 만들어지므로 그대로 이어 붙인다.
function photoUrl(drawingId: string, damageId: string, number: string): string {
  return `/api/drawings/${drawingId}/damages/${damageId}/photos/${number}`;
}

function thumbUrl(drawingId: string, damageId: string, number: string): string {
  return `${photoUrl(drawingId, damageId, number)}/thumb`;
}

// 본 사진 바이트로 썸네일을 만들어 저장한다. 실패는 로그만 남기고 null — 썸네일은 덤이라
// 업로드·조회를 막지 않는다(뷰어는 본 사진으로 대신한다).
async function ensureThumb(
  deps: AppDeps,
  drawingId: string,
  damageId: string,
  number: string,
  data: Buffer,
): Promise<Buffer | null> {
  try {
    const thumb = await makeThumbnail(data);
    await deps.photos.saveThumb(drawingId, damageId, number, thumb);
    return thumb;
  } catch (err) {
    console.error('[photos] 썸네일을 만들지 못했습니다', drawingId, damageId, number, messageOf(err));
    return null;
  }
}

// 사진 라우트 셋이 모두 쓰는 앞부분: 도면이 있는지, 손상 id가 UUID인지. 막히면 응답을 보내고
// null을 돌려준다 — UUID 검사는 경로 조작 방지가 목적이라 라우트마다 빠뜨리면 안 된다(스펙 3장).
async function findDamageTarget(
  deps: AppDeps,
  req: Request,
  res: Response,
): Promise<{ drawing: DrawingRecord; damageId: string } | null> {
  const drawing = await findDrawing(deps, String(req.params.id));
  if (!drawing) {
    res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
    return null;
  }
  const damageId = String(req.params.damageId);
  if (!isDamageId(damageId)) {
    res.status(400).json({ error: '손상 id 형식이 올바르지 않습니다.' });
    return null;
  }
  return { drawing, damageId };
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

// 원본 DXF 글자에서 망도틀 영역만 뽑는다. 읽지 못해도 업로드·목록은 계속된다 — 틀이 없으면
// 도면 전체에서 1번부터 매기는 예전 동작이 될 뿐이다(설계 3장).
function framesOf(original: Buffer, objectKey: string): FrameBounds[] {
  try {
    return findFrames(parseDxf(original.toString('utf8'))).map((frame) => frame.bounds);
  } catch (err) {
    console.error('[frames]', objectKey, messageOf(err));
    return [];
  }
}

// frames 필드가 없는 옛 레코드를 목록을 돌려주기 전에 한 번 채운다. 원본이 없거나 DWG면
// 빈 배열로 저장해 다시 시도하지 않는다(설계 3장). 계산이든 저장이든 실패하면 refreshStatus와
// 같은 방식으로 통째로 삼킨다 — 이 레코드는 저장하지 않고 응답만 frames: []로 채우므로,
// 실패 하나가 Promise.all 전체를 reject시켜 목록 요청을 500으로 만들지 않고, 다음 목록
// 요청 때 다시 시도한다.
async function ensureFrames(deps: AppDeps, record: DrawingRecord): Promise<DrawingRecord> {
  if (record.frames !== undefined) return record;
  try {
    let frames: FrameBounds[] = [];
    if (record.objectKey.toLowerCase().endsWith('.dxf')) {
      const original = await deps.originals.read(record.objectKey);
      if (original) frames = framesOf(original, record.objectKey);
    }
    return (await deps.drawings.update(record.id, { frames })) ?? { ...record, frames };
  } catch (err) {
    console.error('[frames]', record.id, messageOf(err));
    return { ...record, frames: [] };
  }
}

// zip 이름의 <번호>는 사용자가 산출 DXF·앱 화면에서 보는 번호와 같아야 한다. 산출
// (exportDamagesToDxf)이 레코드가 아니라 **원본에서** 틀을 다시 구하므로 zip도 같은 길을 쓴다 —
// 원본이 곧 진실이다(2026-09-16 틀 설계 6장). DXF가 아니거나 원본이 없으면 레코드의 frames로
// 물러선다(DWG 레코드는 [] 이므로 도면 전체가 한 묶음, 예전 번호 규칙과 같다).
async function zipFramesOf(deps: AppDeps, drawing: DrawingRecord): Promise<FrameBounds[]> {
  if (!drawing.objectKey.toLowerCase().endsWith('.dxf')) return drawing.frames ?? [];
  const original = await deps.originals.read(drawing.objectKey);
  if (!original) return drawing.frames ?? [];
  return framesOf(original, drawing.objectKey);
}

// 도면 하나를 산출한다. 단일 도면 라우트(export.dxf)와 프로젝트 zip 라우트(export.zip)가
// 같이 쓴다 — DWG·원본 없음·ExportError·그 밖의 오류를 가르는 판단은 하나만 둔다. 문구는
// 라우트마다 다르므로(export.zip의 건너뜀.txt는 더 짧은 문구를 쓴다) kind만 돌려주고 문구는
// 호출부가 짓는다. exportError만 detail(err.message)을 함께 돌려준다.
type ExportOutcome =
  | { ok: true; result: import('./export/exportDrawing.js').ExportResult }
  | { ok: false; kind: 'notDxf' | 'noOriginal' | 'exportError' | 'other'; detail?: string };

async function exportDrawing(deps: AppDeps, drawing: DrawingRecord): Promise<ExportOutcome> {
  if (!drawing.objectKey.toLowerCase().endsWith('.dxf')) {
    return { ok: false, kind: 'notDxf' };
  }
  const original = await deps.originals.read(drawing.objectKey);
  if (!original) {
    return { ok: false, kind: 'noOriginal' };
  }
  const doc = await deps.damages.get(drawing.id);
  try {
    const result = exportDamagesToDxf(original.toString('utf8'), doc.damages);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof ExportError) {
      return { ok: false, kind: 'exportError', detail: err.message };
    }
    console.error('[export]', drawing.id, err);
    return { ok: false, kind: 'other' };
  }
}

// 프로젝트 zip 안에서 겹치지 않을 도면별 밑이름(baseNameOf)을 짓는다. 같은 폴더('' 또는
// '<하위>/')끼리만 겹침을 가른다 — 폴더가 다르면 애초에 zip 경로가 갈린다.
function baseNamesFor(folders: DrawingFolder[]): Map<string, string> {
  const byFolder = new Map<string, DrawingFolder[]>();
  for (const f of folders) {
    const bucket = byFolder.get(f.folder);
    if (bucket) bucket.push(f);
    else byFolder.set(f.folder, [f]);
  }
  const result = new Map<string, string>();
  for (const bucket of byFolder.values()) {
    const names = uniqueNames(bucket.map((f) => baseNameOf(f.drawing.name)));
    bucket.forEach((f, i) => result.set(f.drawing.id, names[i]));
  }
  return result;
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
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxPhotoBytes ?? MAX_PHOTO_BYTES },
  });

  // 이 미들웨어는 라우트 본문(도면 404·손상 id 400)보다 먼저 돈다 — 너무 큰 파일은 도면이
  // 없어도 413이 먼저 나간다. multer가 폼을 읽는 단계라 순서를 바꿀 수 없고, 어차피 거부되는
  // 요청이라 그대로 둔다.
  // 공용 apiErrorHandler는 DXF 기준 문구('파일이 100MB를 넘습니다')를 쓰므로 사진의 multer
  // 오류는 여기서 먼저 받아 사진 문구로 답한다. 문구는 늘 실제 상한(20MB)을 말한다 —
  // 테스트가 상한을 낮춰도 사용자에게 보여줄 값은 하나뿐이다.
  const photoUploadField: RequestHandler = (req, res, next) => {
    photoUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: `사진이 ${MAX_PHOTO_BYTES / 1024 / 1024}MB를 넘습니다.` });
        } else {
          res.status(400).json({ error: `업로드 형식 오류: ${err.code}` });
        }
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  };

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

    // 프로젝트 확인은 APS를 부르기 전에 한다 — 없는 프로젝트로 올리려는 요청이 헛되이
    // APS 업로드·변환을 시작하지 않도록(설계 3장). 빈 문자열·필드 없음은 미분류(키를 안 넣는다).
    const rawProjectId = req.body?.projectId;
    let projectId: string | undefined;
    if (typeof rawProjectId === 'string' && rawProjectId !== '') {
      if (!isProjectId(rawProjectId) || !(await deps.projects.get(rawProjectId))) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      projectId = rawProjectId;
    }

    const id = newDrawingId();
    const extension = isDwg ? '.dwg' : '.dxf';
    const objectKey = `${id}${extension}`;
    try {
      const { urn } = await deps.aps.uploadDrawing(file.buffer, objectKey);
      await deps.aps.startTranslation(urn);
      // 산출은 이 사본에서 시작한다(스펙 2장). APS가 성공한 뒤에 시도한다. 디스크 저장이
      // 실패해도(디스크 꽉 참 등) 업로드 자체(APS 업로드·변환 요청)는 이미 성공했으므로 여기서
      // 502로 되돌리지 않는다 — 로그만 남기고 레코드는 그대로 만든다. 원본이 없다는 사실은
      // 나중에 산출을 시도할 때 "원본 파일이 없습니다"로 드러난다(R17).
      try {
        await deps.originals.save(objectKey, file.buffer);
      } catch (err) {
        console.error('[upload] 원본 보관 실패', objectKey, err);
      }
      const record: DrawingRecord = {
        id,
        name,
        objectKey,
        urn,
        status: 'pending',
        progress: '',
        error: null,
        uploadedAt: new Date(now()).toISOString(),
        // DWG는 원본을 읽을 수 없으므로 틀이 없다(설계 3장).
        frames: isDxf ? framesOf(file.buffer, objectKey) : [],
        // 없거나 미분류면 키 자체를 넣지 않는다(설계 2.2 — 기존 도면과 같은 모양으로 남는다).
        ...(projectId !== undefined ? { projectId } : {}),
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
    const refreshed = await Promise.all(records.map((record) => refreshStatus(deps, record)));
    // frames 채우기는 원본(수 MB DXF)을 읽어 동기로 파싱하므로 한 번에 하나씩 한다 — 옛 레코드가
    // 여럿이면 병렬로 돌릴 때 메모리가 레코드 수만큼 겹친다. 이미 frames가 있는 레코드는 그냥 지나간다.
    const withFrames: DrawingRecord[] = [];
    for (const record of refreshed) withFrames.push(await ensureFrames(deps, record));
    res.json(withFrames);
  });

  // 도면을 다른 프로젝트로 옮긴다(또는 미분류로). PC 업로드 페이지의 "옮기기" 선택 상자가 부른다
  // (설계 3장). projectId는 필수 키다 — 실수로 빼먹은 요청과 "미분류로 옮기기"(null)를 구분한다.
  api.patch('/drawings/:id', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!('projectId' in body)) {
      res.status(400).json({ error: 'projectId가 필요합니다.' });
      return;
    }
    const value = body.projectId;
    let projectId: string | null;
    if (value === null) {
      projectId = null;
    } else if (typeof value === 'string') {
      if (!isProjectId(value) || !(await deps.projects.get(value))) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      projectId = value;
    } else {
      res.status(400).json({ error: 'projectId 형식이 올바르지 않습니다.' });
      return;
    }
    const updated = await deps.drawings.update(drawing.id, { projectId });
    res.json(await ensureFrames(deps, updated ?? drawing));
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
    const updated = await deps.drawings.update(drawing.id, { status: 'pending', progress: '', error: null });
    // 옛 레코드(frames 없음)를 재시도할 수도 있으니, GET과 같은 헬퍼로 frames를 채워 보낸다.
    res.json(await ensureFrames(deps, updated ?? drawing));
  });

  // 도면 삭제 = 휴지통으로 옮기기(drawingTrash.ts). 점검 데이터는 다시 만들 수 없어 서버는 영구 삭제를
  // 하지 않는다. PC 업로드 페이지와 앱 목록 화면이 부른다(2026-09-18 사용자 결정).
  api.delete('/drawings/:id', async (req, res) => {
    const trashed = await deps.trash.moveToTrash(req.params.id, new Date(now()).toISOString());
    if (!trashed) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    res.json(trashed);
  });

  api.get('/trash', async (_req, res) => {
    res.json(await deps.trash.list());
  });

  api.post('/trash/:id/restore', async (req, res) => {
    const record = await deps.trash.restore(req.params.id);
    if (!record) {
      res.status(404).json({ error: '휴지통에서 도면을 찾을 수 없습니다.' });
      return;
    }
    res.json(await ensureFrames(deps, record));
  });

  // 프로젝트(현장·구조물) 관리. 만들기·고치기·옮기기는 PC 업로드 페이지에서만 쓴다 — 앱은 이
  // 목록을 읽기만 한다(설계 1장). 응답은 항상 트리 계산(ProjectView)을 거친다(설계 3.1).
  api.get('/projects', async (_req, res) => {
    res.json(buildProjectViews(await deps.projects.list(), await deps.drawings.list()));
  });

  api.post('/projects', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const created = await deps.projects.create(
        { name: body.name, memo: body.memo, parentId: body.parentId },
        new Date(now()).toISOString(),
      );
      res.status(201).json(await projectViewFor(deps, created.id));
    } catch (err) {
      if (err instanceof ProjectRuleError) {
        res.status(projectRuleStatus(err.code)).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  api.patch('/projects/:id', async (req, res) => {
    const id = req.params.id;
    if (!isProjectId(id)) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // ProjectsStore.update는 준 키만 바꾼다 — req.body에 실제로 있던 키만 넘긴다(항상 undefined를
    // 넣으면 "그 키를 지워라"로 오해할 수 있다).
    const patch: { name?: unknown; memo?: unknown } = {};
    if ('name' in body) patch.name = body.name;
    if ('memo' in body) patch.memo = body.memo;
    try {
      const updated = await deps.projects.update(id, patch);
      if (!updated) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      res.json(await projectViewFor(deps, id));
    } catch (err) {
      if (err instanceof ProjectRuleError) {
        res.status(projectRuleStatus(err.code)).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  api.delete('/projects/:id', async (req, res) => {
    const id = req.params.id;
    if (!isProjectId(id)) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    // 도면 수는 휴지통을 뺀 현재 목록에서 센다 — effectiveProjectId는 가리키는 프로젝트가
    // 없어졌으면(있을 수 없지만) 미분류로 보므로 이 프로젝트를 가리키는 도면만 정확히 센다.
    const [projectRecords, drawingRecords] = await Promise.all([deps.projects.list(), deps.drawings.list()]);
    const drawingCount = drawingRecords.filter((d) => effectiveProjectId(d.projectId, projectRecords) === id).length;
    try {
      const removed = await deps.projects.remove(id, { drawingCount });
      if (!removed) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      res.json({ id });
    } catch (err) {
      if (err instanceof ProjectRuleError) {
        res.status(projectRuleStatus(err.code)).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // 프로젝트(와 하위 프로젝트)의 모든 도면 사진을 zip 하나로 묶는다(설계 4장). photoZip.ts의
  // zipEntryNamesFor로 도면별 사진 zip과 항목 이름 규칙을 맞춘다 — 겹치는 것은 폴더(하위
  // 이름 + 도면 밑이름)뿐이다.
  api.get('/projects/:id/photos.zip', async (req, res) => {
    const id = req.params.id;
    if (!isProjectId(id)) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    const project = await deps.projects.get(id);
    if (!project) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    const [projectRecords, drawingRecords] = await Promise.all([deps.projects.list(), deps.drawings.list()]);
    const folders = drawingFoldersFor(id, projectRecords, drawingRecords);
    const baseNames = baseNamesFor(folders);

    const items: { name: string; drawingId: string; entry: PhotoEntry }[] = [];
    for (const { drawing, folder } of folders) {
      const files = await deps.photos.listDrawing(drawing.id);
      if (files.length === 0) continue;
      const doc = await deps.damages.get(drawing.id);
      const entries = zipEntryNamesFor(doc.damages, await zipFramesOf(deps, drawing), files);
      const base = baseNames.get(drawing.id) ?? baseNameOf(drawing.name);
      for (const { name, entry } of entries) {
        items.push({ name: `${folder}${base}/${name}`, drawingId: drawing.id, entry });
      }
    }
    if (items.length === 0) {
      res.status(400).json({ error: '저장된 사진이 없습니다' });
      return;
    }

    const fileName = `${project.name}_사진.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="photos.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    const archive = archiver('zip', { store: true });
    archive.on('warning', (err) => console.error('[projects/photos.zip]', id, err));
    archive.on('error', (err) => {
      console.error('[projects/photos.zip]', id, err);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        res.status(500).json({ error: '사진 zip 생성에 실패했습니다.' });
      }
    });
    archive.pipe(res);
    for (const { name, drawingId, entry } of items) {
      archive.file(deps.photos.pathOf(drawingId, entry), { name });
    }
    await archive.finalize();
  });

  // 프로젝트(와 하위 프로젝트)의 모든 도면 산출 DXF를 zip 하나로 묶는다(설계 4장). 산출은
  // 도면을 하나씩 순서대로 돌린다 — 수 MB DXF를 동기로 파싱하므로 병렬이면 메모리가 겹친다.
  // 산출을 모두 끝낸 뒤에야 헤더를 보내고 archive에 append한다 — 그래야 산출된 DXF가 하나도
  // 없을 때 400을 줄 수 있다(헤더를 먼저 보내면 상태 코드를 바꿀 수 없다).
  api.get('/projects/:id/export.zip', async (req, res) => {
    const id = req.params.id;
    if (!isProjectId(id)) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    const project = await deps.projects.get(id);
    if (!project) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    const [projectRecords, drawingRecords] = await Promise.all([deps.projects.list(), deps.drawings.list()]);
    const folders = drawingFoldersFor(id, projectRecords, drawingRecords);
    const baseNames = baseNamesFor(folders);

    const exported: { name: string; text: string }[] = [];
    const skipLines: string[] = [];
    const skipReasons: string[] = [];
    for (const { drawing, folder } of folders) {
      const outcome = await exportDrawing(deps, drawing);
      const path = `${folder}${drawing.name}`;
      if (!outcome.ok) {
        const reason =
          outcome.kind === 'notDxf'
            ? 'DXF로 올린 도면만 산출할 수 있습니다'
            : outcome.kind === 'noOriginal'
              ? '원본 파일이 없습니다'
              : outcome.kind === 'exportError'
                ? (outcome.detail ?? 'DXF 산출에 실패했습니다')
                : 'DXF 산출에 실패했습니다';
        skipLines.push(`${path}: ${reason}`);
        skipReasons.push(reason);
        continue;
      }
      const base = baseNames.get(drawing.id) ?? baseNameOf(drawing.name);
      exported.push({ name: `${folder}${base}_손상.dxf`, text: outcome.result.dxfText });
      if (outcome.result.skipped > 0) {
        skipLines.push(`${path}: 손상 ${outcome.result.skipped}개가 빠졌습니다`);
      }
      for (const warning of outcome.result.warnings) {
        skipLines.push(`${path}: ${warning}`);
      }
    }

    if (exported.length === 0) {
      const uniqueReasons = [...new Set(skipReasons)];
      const suffix = uniqueReasons.length === 1 ? ` (${uniqueReasons[0]})` : '';
      res.status(400).json({ error: `산출할 수 있는 도면이 없습니다${suffix}` });
      return;
    }

    const fileName = `${project.name}_손상.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    // DXF는 글자라 압축한다(deflate) — 사진 zip과 달리 store를 쓰지 않는다.
    const archive = archiver('zip');
    archive.on('warning', (err) => console.error('[projects/export.zip]', id, err));
    archive.on('error', (err) => {
      console.error('[projects/export.zip]', id, err);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        res.status(500).json({ error: 'DXF zip 생성에 실패했습니다.' });
      }
    });
    archive.pipe(res);
    for (const file of exported) {
      archive.append(Buffer.from(file.text, 'utf8'), { name: file.name });
    }
    if (skipLines.length > 0) {
      archive.append(Buffer.from(skipLines.join('\n'), 'utf8'), { name: '건너뜀.txt' });
    }
    await archive.finalize();
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

  // 찍은 사진을 그 손상 폴더에 저장한다. 사진번호는 **파일 이름에서** 뽑는다(스펙 2장) —
  // 뷰어가 칸에 붙인 번호와 같아야 하므로 뷰어와 같은 photoNumberFromFilename을 쓴다.
  // 앱이 filename 필드를 함께 보내면 그것을 먼저 쓴다: multer의 originalname은 비ASCII에서
  // 깨질 수 있다(DXF 업로드의 name 필드와 같은 이유). multer는 폼 전체를 읽은 뒤에 넘어오므로
  // 파트 순서는 상관없다(검토에서 실측). 앱이 filename을 앞에 두는 것은 관례일 뿐이다.
  api.post('/drawings/:id/damages/:damageId/photos', photoUploadField, async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '사진 파일이 없습니다.' });
      return;
    }
    const extension = PHOTO_EXTENSIONS[file.mimetype];
    if (extension === undefined) {
      res.status(400).json({ error: 'JPEG·PNG·HEIC 사진만 올릴 수 있습니다.' });
      return;
    }
    const bodyName = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
    const number = photoNumberFromFilename(bodyName || file.originalname);
    if (number === '') {
      res.status(400).json({ error: '사진 파일 이름에서 사진번호를 찾을 수 없습니다.' });
      return;
    }
    if (!isPhotoNumber(number)) {
      res.status(400).json({ error: `사진번호에 쓸 수 없는 글자가 있습니다: ${number}` });
      return;
    }
    await deps.photos.save(target.drawing.id, target.damageId, number, extension, file.buffer);
    // 썸네일은 덤이다 — 못 만들어도(깨진 파일·sharp가 못 읽는 형식) 본 사진 저장은 성공이다.
    // 뷰어는 썸네일 주소가 404면 본 사진을 대신 받는다(main.js). 없는 썸네일은 GET …/thumb가
    // 다시 한 번 만들어 본다.
    await ensureThumb(deps, target.drawing.id, target.damageId, number, file.buffer);
    res.status(201).json({
      number,
      url: photoUrl(target.drawing.id, target.damageId, number),
      thumbUrl: thumbUrl(target.drawing.id, target.damageId, number),
    });
  });

  api.get('/drawings/:id/damages/:damageId/photos', async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const entries = await deps.photos.list(target.drawing.id, target.damageId);
    res.json(
      entries.map((entry) => ({
        number: entry.number,
        url: photoUrl(target.drawing.id, target.damageId, entry.number),
        thumbUrl: thumbUrl(target.drawing.id, target.damageId, entry.number),
        size: entry.size,
        savedAt: entry.savedAt,
      })),
    );
  });

  // 320px 썸네일(photoThumb.ts). 올릴 때 만들어 둔 파일을 주고, 없으면(옛 사진·그때 실패) 본 사진에서
  // 지금 만들어 저장한 뒤 준다. 그래도 못 만들면 404 — 뷰어가 본 사진으로 대신한다.
  api.get('/drawings/:id/damages/:damageId/photos/:number/thumb', async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const number = req.params.number;
    if (!isPhotoNumber(number)) {
      res.status(400).json({ error: '사진번호 형식이 올바르지 않습니다.' });
      return;
    }
    const entry = await deps.photos.find(target.drawing.id, target.damageId, number);
    if (!entry) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
      return;
    }
    let thumb = await deps.photos.readThumb(target.drawing.id, entry);
    if (!thumb) {
      const made = await ensureThumb(deps, target.drawing.id, target.damageId, number, await deps.photos.readData(target.drawing.id, entry));
      if (!made) {
        res.status(404).json({ error: '썸네일을 만들 수 없습니다.' });
        return;
      }
      thumb = made;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(thumb);
  });

  // 파일 그대로. 서버는 내용을 바꾸지 않는다(HEIC도 그대로 — 스펙 2장). 한 장이 20MB 이하라
  // 스트리밍 대신 통째로 읽어 보낸다(업로드도 이미 메모리에 통째로 받는다).
  api.get('/drawings/:id/damages/:damageId/photos/:number', async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const number = req.params.number;
    if (!isPhotoNumber(number)) {
      res.status(400).json({ error: '사진번호 형식이 올바르지 않습니다.' });
      return;
    }
    const entry = await deps.photos.find(target.drawing.id, target.damageId, number);
    if (!entry) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
      return;
    }
    const data = await deps.photos.readData(target.drawing.id, entry);
    res.setHeader('Content-Type', PHOTO_MIME_TYPES[extname(entry.file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  });

  api.get('/drawings/:id/photos.zip', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    const files = await deps.photos.listDrawing(drawing.id);
    if (files.length === 0) {
      res.status(400).json({ error: '저장된 사진이 없습니다' });
      return;
    }
    const doc = await deps.damages.get(drawing.id);
    const entries = zipEntryNamesFor(doc.damages, await zipFramesOf(deps, drawing), files);

    // 한글은 HTTP 헤더 값에 그대로 넣을 수 없다(export.dxf와 같은 이유) — RFC 5987 filename*.
    const fileName = `${drawing.name.replace(/\.[^.]*$/, '')}_사진.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="photos.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    // JPEG·HEIC·PNG는 이미 압축돼 있어 다시 줄여도 거의 안 줄어든다. store로 두면 사진 수십 장에도
    // CPU를 쓰지 않는다. 파일은 스트림으로 읽는다 — 20MB짜리 수십 장을 메모리에 쌓지 않는다.
    const archive = archiver('zip', { store: true });
    archive.on('warning', (err) => console.error('[photos.zip]', drawing.id, err));
    // 여기까지 오면 머리글을 이미 보냈으므로 상태 코드를 400·500으로 바꿀 수 없다. 받는 쪽이
    // 깨진 zip을 온전한 것으로 착각하지 않도록 연결을 끊는다.
    archive.on('error', (err) => {
      console.error('[photos.zip]', drawing.id, err);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        res.status(500).json({ error: '사진 zip 생성에 실패했습니다.' });
      }
    });
    archive.pipe(res);
    for (const { name, entry } of entries) {
      archive.file(deps.photos.pathOf(drawing.id, entry), { name });
    }
    await archive.finalize();
  });

  api.get('/drawings/:id/export.dxf', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    const outcome = await exportDrawing(deps, drawing);
    if (!outcome.ok) {
      if (outcome.kind === 'notDxf') {
        res.status(400).json({ error: 'DXF로 올린 도면만 산출할 수 있습니다' });
        return;
      }
      if (outcome.kind === 'noOriginal') {
        res.status(400).json({ error: '원본 파일이 없습니다. 도면을 다시 올려 주세요' });
        return;
      }
      if (outcome.kind === 'exportError') {
        res.status(400).json({ error: outcome.detail });
        return;
      }
      res.status(500).json({ error: 'DXF 산출에 실패했습니다.' });
      return;
    }
    const result = outcome.result;

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
