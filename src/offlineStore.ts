// 기기 저장소(설계 3.2)를 다룬다. index.json·꾸러미·도면 폴더·손상 기록의 경로와 읽기·쓰기만
// 한다 — 언제 무엇을 내려받고 언제 올릴지는 offlineDownload.ts·offlineSync.ts가 정한다. 판단
// 규칙(순수)은 src/offlineRules.ts에 있다. 모든 실패는 삼키고 로그만 남긴다 — 오프라인 저장 한
// 조각이 안 된다고 앱이 멎으면 안 된다(photoUpload.ts와 같은 방침).
import { Directory, File, Paths } from 'expo-file-system';

const OFFLINE_DIR_NAME = 'offline';
const BUNDLE_DIR_NAME = 'bundle';
const DRAWINGS_DIR_NAME = 'drawings';
const MODEL_DIR_NAME = 'model';
const INDEX_FILE_NAME = 'index.json';
const INDEX_TMP_FILE_NAME = 'index.json.tmp';
const DAMAGES_FILE_NAME = 'damages.json';
const DAMAGES_TMP_FILE_NAME = 'damages.json.tmp';

export interface OfflineDrawingEntry {
  name: string;
  projectId: string | null;
  viewFormat: 'svf';
  model: string;
  files: string[];
  frames: unknown[];
  /** 기기 damages.json의 updatedAt(로컬이 아는 가장 최근 자기 것). */
  damagesUpdatedAt: string;
  /** 마지막으로 안 서버 쪽 updatedAt. 아직 모르면 null(설계 3.5). */
  serverUpdatedAt: string | null;
  downloadedAt: string;
}

export interface OfflineIndex {
  bundleVersion: string | null;
  drawings: Record<string, OfflineDrawingEntry>;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function parseEntry(value: unknown): OfflineDrawingEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  if (!isText(e.name) || !isText(e.model) || !isText(e.damagesUpdatedAt) || !isText(e.downloadedAt)) return null;
  if (!Array.isArray(e.files) || !e.files.every(isText)) return null;
  return {
    name: e.name,
    projectId: isText(e.projectId) ? e.projectId : null,
    viewFormat: 'svf',
    model: e.model,
    files: e.files as string[],
    frames: Array.isArray(e.frames) ? e.frames : [],
    damagesUpdatedAt: e.damagesUpdatedAt,
    serverUpdatedAt: isText(e.serverUpdatedAt) ? e.serverUpdatedAt : null,
    downloadedAt: e.downloadedAt,
  };
}

// 저장 파일(index.json)을 읽을 때 쓴다. 파일이 깨졌거나 옛 모양이어도 앱이 뜨는 것이 더 중요하다
// — 모양이 다른 항목은 조용히 버린다(photoQueue.parseQueue와 같은 방침).
function parseIndex(value: unknown): OfflineIndex {
  if (typeof value !== 'object' || value === null) return { bundleVersion: null, drawings: {} };
  const raw = value as Record<string, unknown>;
  const bundleVersion = isText(raw.bundleVersion) ? raw.bundleVersion : null;
  const drawings: Record<string, OfflineDrawingEntry> = {};
  const rawDrawings = raw.drawings;
  if (typeof rawDrawings === 'object' && rawDrawings !== null) {
    for (const [id, rawEntry] of Object.entries(rawDrawings as Record<string, unknown>)) {
      const entry = parseEntry(rawEntry);
      if (entry) drawings[id] = entry;
    }
  }
  return { bundleVersion, drawings };
}

export function offlineRoot(): Directory {
  return new Directory(Paths.document, OFFLINE_DIR_NAME);
}

export function bundleDir(version: string): Directory {
  return new Directory(Paths.document, OFFLINE_DIR_NAME, BUNDLE_DIR_NAME, version);
}

export function drawingDir(id: string): Directory {
  return new Directory(Paths.document, OFFLINE_DIR_NAME, DRAWINGS_DIR_NAME, id);
}

function indexFile(): File {
  return new File(offlineRoot(), INDEX_FILE_NAME);
}

function damagesFile(id: string): File {
  return new File(drawingDir(id), DAMAGES_FILE_NAME);
}

export function readIndex(): OfflineIndex {
  try {
    const file = indexFile();
    if (!file.exists) return { bundleVersion: null, drawings: {} };
    return parseIndex(JSON.parse(file.textSync()) as unknown);
  } catch (err) {
    console.error('[offlineStore] index.json을 읽지 못했습니다', err);
    return { bundleVersion: null, drawings: {} };
  }
}

// 통제관 규칙(photoUpload.ts R3와 같음): tmp에 다 쓴 뒤에만 자리를 옮긴다 — 쓰는 도중 앱이
// 죽어도 기존 index.json은 온전하게 남는다.
export function writeIndex(index: OfflineIndex): boolean {
  try {
    offlineRoot().create({ intermediates: true, idempotent: true });
  } catch (err) {
    console.error('[offlineStore] offline 폴더를 만들지 못했습니다', err);
    return false;
  }
  const tmp = new File(offlineRoot(), INDEX_TMP_FILE_NAME);
  try {
    tmp.write(JSON.stringify(index));
  } catch (err) {
    console.error('[offlineStore] index 임시 파일을 쓰지 못했습니다', err);
    return false;
  }
  try {
    tmp.moveSync(indexFile(), { overwrite: true });
    return true;
  } catch (err) {
    try {
      const target = indexFile();
      if (target.exists) target.delete();
      tmp.moveSync(target, {});
      return true;
    } catch (fallbackErr) {
      console.error('[offlineStore] index를 저장하지 못했습니다', err, fallbackErr);
      return false;
    }
  }
}

// 오프라인 뷰어 페이지(설계 3.3): file://…/bundle/<version>/viewer.html?id=<id>&offline=1
export function viewerPageUri(version: string, drawingId: string): string {
  const file = new File(bundleDir(version), 'viewer.html');
  return `${file.uri}?id=${encodeURIComponent(drawingId)}&offline=1`;
}

// 도면 하나의 파생 모델 파일(f2d) 경로. modelPath는 서버 목록의 'model' 값(예:
// '0ab7..._f2d/primaryGraphics.f2d') — 그 안의 '/'도 기기 폴더 구조 그대로 따라간다.
export function modelUri(id: string, modelPath: string): string {
  return new File(drawingDir(id), MODEL_DIR_NAME, ...modelPath.split('/')).uri;
}

export function readDamages(id: string): unknown | null {
  try {
    const file = damagesFile(id);
    if (!file.exists) return null;
    return JSON.parse(file.textSync()) as unknown;
  } catch (err) {
    console.error('[offlineStore] damages.json을 읽지 못했습니다', id, err);
    return null;
  }
}

// damages.json 원자적 쓰기(tmp→move) — photoUpload.writeQueue와 같은 방식.
export function writeDamages(id: string, doc: unknown): boolean {
  try {
    drawingDir(id).create({ intermediates: true, idempotent: true });
  } catch (err) {
    console.error('[offlineStore] 도면 폴더를 만들지 못했습니다', id, err);
    return false;
  }
  const tmp = new File(drawingDir(id), DAMAGES_TMP_FILE_NAME);
  try {
    tmp.write(JSON.stringify(doc));
  } catch (err) {
    console.error('[offlineStore] damages 임시 파일을 쓰지 못했습니다', id, err);
    return false;
  }
  try {
    tmp.moveSync(damagesFile(id), { overwrite: true });
    return true;
  } catch (err) {
    try {
      const target = damagesFile(id);
      if (target.exists) target.delete();
      tmp.moveSync(target, {});
      return true;
    } catch (fallbackErr) {
      console.error('[offlineStore] damages를 저장하지 못했습니다', id, err, fallbackErr);
      return false;
    }
  }
}

// 기기에서 지우기(설계 3.2): 도면 폴더와 index 항목을 지운다. 서버 손상 기록·사진은 그대로다.
export function removeDrawing(id: string): void {
  try {
    const dir = drawingDir(id);
    if (dir.exists) dir.delete();
  } catch (err) {
    console.error('[offlineStore] 도면 폴더를 지우지 못했습니다', id, err);
  }
  const index = readIndex();
  if (index.drawings[id]) {
    const { [id]: _removed, ...rest } = index.drawings;
    writeIndex({ ...index, drawings: rest });
  }
}
