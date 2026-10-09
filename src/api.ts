import { ACCESS_KEY, API_URL } from './config';

export type DrawingStatus = 'pending' | 'inprogress' | 'success' | 'failed';

// 'svf2'만 있던 옛 도면은 서버가 viewFormat을 안 내려준다 — 그 경우 오프라인 모드에서는 'svf2'로
// 본다(설계 2장). offlineReady는 저장값이 아니라 서버 응답에서 계산된 값을 그대로 받는다.
export type ViewFormat = 'svf' | 'svf2';

export interface Drawing {
  id: string;
  name: string;
  status: DrawingStatus;
  progress: string;
  error: string | null;
  uploadedAt: string;
  projectId?: string | null;
  viewFormat?: ViewFormat;
  offlineReady?: boolean;
  frames?: unknown[];
}

// 오프라인 모드(설계 3.1) — 서버 응답 그대로의 모양.
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

export interface BundleFile {
  path: string;
  size: number;
}

export interface BundleListing {
  version: string;
  files: BundleFile[];
}

// server/src/damagesStore.ts의 DamageDoc과 같은 모양. 앱은 damages 배열 안을 들여다보지 않는다
// (원본은 JSON, 앱은 그대로 저장·비교만 한다 — 브리프 근거).
export interface DamageDoc {
  schemaVersion: number;
  drawingId: string;
  updatedAt: string;
  damages: unknown[];
  /** 지운 손상의 기록(id·시각). 서버가 손상 단위로 합칠 때 쓴다(2026-10-07) */
  deleted?: { id: string; deletedAt: string }[];
}

// 서버(projectTree.ts)가 트리 순서로 편 목록을 그대로 내려준다 — 앱은 같은 계산을 다시 하지 않는다.
export interface Project {
  id: string;
  name: string;
  memo: string;
  parentId: string | null;
  depth: 0 | 1;
  path: string;
  drawingCount: number;
  totalDrawingCount: number;
  childCount: number;
}

export async function fetchDrawings(): Promise<Drawing[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(`도면 목록을 불러오지 못했습니다 (${res.status}).`);
  return (await res.json()) as Drawing[];
}

export async function fetchProjects(): Promise<Project[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(`프로젝트 목록을 불러오지 못했습니다 (${res.status}).`);
  return (await res.json()) as Project[];
}

// 도면 삭제 = 서버 휴지통으로 옮기기(손상 기록·사진도 함께). PC 업로드 페이지의 휴지통에서 복구한다.
export async function deleteDrawing(drawingId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings/${encodeURIComponent(drawingId)}`, {
      method: 'DELETE',
      headers: { 'x-access-key': ACCESS_KEY },
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  // 이미 다른 기기에서 지운 도면이면 목적은 이뤄졌다 — 목록만 새로 고치면 된다.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`도면을 삭제하지 못했습니다 (${res.status}).`);
}

// GET 요청 하나의 공통 뼈대(접근키 헤더·연결 실패 문구). 오프라인 API 넷이 똑같이 쓴다.
async function apiGet(path: string): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
}

// 실패 응답의 본문에 있는 서버 문구(예: "오프라인용으로 변환된 도면이 아닙니다.")를 쓴다.
// JSON이 아니면(프록시 오류 페이지 등) 기본 문구로 돌아간다.
async function errorMessageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // 본문이 JSON이 아니면 기본 문구를 쓴다.
  }
  return fallback;
}

// 오프라인 모드(설계 3.1): 이 도면을 기기에 두는 데 필요한 파일 목록. offlineReady가 아니면
// 서버가 409를 주고(문구는 errorMessageOf가 그대로 옮긴다), 변환 중인 도면도 마찬가지다.
export async function fetchOfflineListing(drawingId: string): Promise<OfflineListing> {
  const res = await apiGet(`/api/drawings/${encodeURIComponent(drawingId)}/offline`);
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(await errorMessageOf(res, `오프라인 파일 목록을 가져오지 못했습니다 (${res.status}).`));
  return (await res.json()) as OfflineListing;
}

// 오프라인 모드(설계 3.1): 뷰어 꾸러미(우리 파일 + 오토데스크 뷰어 파일) 목록과 버전.
export async function fetchViewerBundleListing(): Promise<BundleListing> {
  const res = await apiGet('/api/viewer-bundle');
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(await errorMessageOf(res, `뷰어 꾸러미 목록을 가져오지 못했습니다 (${res.status}).`));
  return (await res.json()) as BundleListing;
}

// 손상 기록 하나(설계 3.5 동기화가 로컬과 비교할 서버 쪽). 도면이 서버에서 없어졌으면(휴지통행)
// null — 그 도면은 동기화를 건너뛴다.
export async function fetchDamages(drawingId: string): Promise<DamageDoc | null> {
  const res = await apiGet(`/api/drawings/${encodeURIComponent(drawingId)}/damages`);
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await errorMessageOf(res, `손상 기록을 가져오지 못했습니다 (${res.status}).`));
  return (await res.json()) as DamageDoc;
}

// 로컬이 더 새것일 때 서버로 올린다(설계 3.5 push). 형식 오류(400)면 다시 보내도 소용없지만,
// 그 판단은 호출부(offlineSync)가 한다 — 여기서는 실패를 그대로 던진다.
// 서버는 저장된 문서와 손상 단위로 합친 결과(문서 전체)를 돌려준다(2026-10-07).
export async function putDamages(drawingId: string, doc: DamageDoc): Promise<DamageDoc> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings/${encodeURIComponent(drawingId)}/damages`, {
      method: 'PUT',
      headers: { 'x-access-key': ACCESS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  // 4xx(형식 오류 등)는 다시 보내도 같으므로 동기화가 "서버 거절"로 표시할 수 있게 status를 붙인다(설계 3.5).
  if (!res.ok) {
    throw Object.assign(new Error(await errorMessageOf(res, `손상 기록을 올리지 못했습니다 (${res.status}).`)), {
      status: res.status,
    });
  }
  return (await res.json()) as DamageDoc;
}

export interface HandwritingResult {
  width: number | null;
  length: number | null;
  count: number | null;
  text: string;
}

// 손글씨 인식(2026-10-09): 뷰어가 그린 펜 획 PNG(base64)를 서버에 보내 폭/길이/개소로 받는다.
// 인터넷이 될 때만 된다 — 뷰어는 기기 파일로 열리므로 서버 호출은 앱이 대신한다(ViewerScreen).
export async function recognizeHandwriting(drawingId: string, imageBase64: string): Promise<HandwritingResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings/${encodeURIComponent(drawingId)}/handwriting`, {
      method: 'POST',
      headers: { 'x-access-key': ACCESS_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64 }),
    });
  } catch {
    throw new Error('서버에 연결하지 못했습니다 — 인터넷이 될 때 다시 해 보세요');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `손글씨 인식에 실패했습니다 (${res.status})`);
  }
  return (await res.json()) as HandwritingResult;
}

// path의 '/'는 그대로 두고 구간마다만 인코딩한다 — 서버의 와일드카드 라우트(/*path)는 슬래시로
// 구간을 가르므로 encodeURIComponent를 통째로 쓰면(슬래시까지 %2F로 바뀌어) 404가 난다.
function encodeFilePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function offlineFileUrl(drawingId: string, path: string): string {
  return `${API_URL}/api/drawings/${encodeURIComponent(drawingId)}/offline/files/${encodeFilePath(path)}`;
}

export function bundleFileUrl(path: string): string {
  return `${API_URL}/api/viewer-bundle/files/${encodeFilePath(path)}`;
}
