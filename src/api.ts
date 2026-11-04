import { ACCESS_KEY, API_URL } from './config';
import type { FacilityInfo, InfoField } from './facilityInfo';

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
  /** 점검 종류 — 최상위(과업)에만. 서버 projectsStore.ts의 INSPECTION_TYPES와 같은 값 */
  inspectionType?: string;
  /** 웹(daenong) 과업구분 — 최상위만, 웹이 넣는다(앱은 읽기만, 목록 필터용) */
  taskType?: string;
  /** 시설물 종류 — 하위(구조물)에만. 서버 FACILITY_TYPES와 같은 값 */
  facilityType?: string;
  /** 구조물 위치(하위만) — 그 자리에서 사진을 찍을 때 폰 GPS로 기록(2026-11-02). 홈 「근처 구조물」에 쓴다 */
  location?: { lat: number; lng: number; accuracy: number; at: string };
  /** 구조물 정보(하위만, 2026-11-03) — 경간·교대·교각 수, 형식. 서버가 필수 사진을 이 값으로 편다 */
  facilityInfo?: FacilityInfo;
  /** 현장에서 고른 필요시 촬영 항목(서버 templateKey "부재|설명", 하위만) */
  optionalShots?: string[];
}

export const INSPECTION_TYPES = ['정기안전점검', '정밀안전점검', '정밀안전진단'] as const;
export const FACILITY_TYPES = ['교량', '터널', '옹벽', '상수도', '하수처리장', '항만외곽시설', '절토사면', '건축물', '기타'] as const;

// 점검 종류·시설물 종류만 고친다. null은 지우기. 응답은 서버가 트리 계산을 거친 Project 하나.
export async function updateProject(
  projectId: string,
  patch: {
    inspectionType?: string | null;
    facilityType?: string | null;
    location?: { lat: number; lng: number; accuracy: number; at: string } | null;
    facilityInfo?: FacilityInfo | null;
    optionalShots?: string[] | null;
  },
): Promise<Project> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'x-access-key': ACCESS_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 인터넷이 되는 곳에서 다시 골라 주세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `프로젝트를 저장하지 못했습니다 (${res.status}).`);
  }
  return (await res.json()) as Project;
}

export async function fetchDrawings(): Promise<Drawing[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  // 404는 앱 서버가 아닌 곳(웹 서버 포트, 바뀐 터널 주소 등)에 닿았다는 뜻 — 앱 서버엔 이 주소가 늘 있다(11-04)
  if (res.status === 404) throw new Error(`앱 서버를 찾지 못했어요 (404). 앱의 서버 주소(${API_URL})가 앱 서버를 가리키는지 확인하세요 — 그 주소를 브라우저로 열면 PC 업로드 페이지가 떠야 해요.`);
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

// 촬영 항목(필수 사진·전차 사진). 서버 shotsStore.ts와 같은 모양 + 사진 주소.
export interface Shot {
  id: string;
  kind: 'required' | 'previous';
  member: string;
  label: string;
  number: string;
  photo?: { file: string; savedAt: string };
  url: string | null;
  thumbUrl: string | null;
  /** 이 칸의 사진 전부(2026-11-05 한 칸 여러 장). 첫 장이 대표(photo·url·thumbUrl과 같음) */
  photos?: ShotPhotoItem[];
  /** required만: 템플릿 항목 이름표("부재|설명") — 예시 사진의 열쇠 */
  templateKey?: string;
  /** 이 항목의 예시 사진(시설물 종류 + 항목마다 한 장, 모든 구조물 공통) */
  exampleUrl?: string;
  exampleThumbUrl?: string;
  exampleSavedAt?: string;
  /** required만: 점검 포인트(세부지침 1.2.1) */
  hint?: string;
  /** previous(전차 사진)만: 보고서 페이지 id, 캡션, 참조 이미지 주소, 휴지통 */
  group?: string;
  caption?: string;
  trashed?: true;
  refUrl?: string | null;
  refThumbUrl?: string | null;
}

export interface ShotPhotoItem {
  id: string;
  savedAt: string;
  url: string;
  thumbUrl: string;
}

export interface ShotList {
  projectId: string;
  projectName: string;
  facilityType: string | null;
  /** 상위 과업의 점검 종류 — 필수 목록을 이것으로 거른다 */
  inspectionType?: string | null;
  facilityInfo?: FacilityInfo | null;
  /** 이 시설물 종류의 「구조물 정보」 입력 항목 */
  infoFields?: InfoField[];
  /** 「필요시 추가」에서 고를 수 있는 항목(해설서 필요시·책임기술자 판단·선택과업). chosen = 지금 목록에 들어 있음 */
  optionalChoices?: { key: string; member: string; label: string; chosen: boolean; count: number }[];
  /** 경간·교각 수 등이 있어야 다 펴지는데 아직 없다 → 「구조물 정보 넣기」 */
  needsFacilityInfo?: boolean;
  shots: Shot[];
}

// 시설물 종류별 「구조물 정보」 입력 항목. 한 번 받으면 앱이 켜져 있는 동안 기억한다(오프라인에서도 알약·시트가 보이게)
let infoFieldsCache: Record<string, InfoField[]> | null = null;
export function cachedFacilityInfoFields(): Record<string, InfoField[]> | null {
  return infoFieldsCache;
}
export async function fetchFacilityInfoFields(): Promise<Record<string, InfoField[]>> {
  const res = await fetch(`${API_URL}/api/facility-info-fields`, { headers: { 'x-access-key': ACCESS_KEY } });
  if (!res.ok) throw new Error(`구조물 정보 항목을 불러오지 못했습니다 (${res.status}).`);
  infoFieldsCache = (await res.json()) as Record<string, InfoField[]>;
  return infoFieldsCache;
}

export async function fetchShots(projectId: string): Promise<ShotList> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/shots`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(`사진 목록을 불러오지 못했습니다 (${res.status}).`);
  return (await res.json()) as ShotList;
}

/** 찍은 사진 원본(크게 보기). 서버에 사진이 없으면 null */
export function shotPhotoSource(shot: { url?: string | null; photo?: { savedAt: string } }): { uri: string; headers: Record<string, string> } | null {
  if (!shot.url || !shot.photo) return null;
  return { uri: `${API_URL}${shot.url}?v=${encodeURIComponent(shot.photo.savedAt)}`, headers: { 'x-access-key': ACCESS_KEY } };
}

/** 썸네일 전체 주소(Image source용). 서버는 x-access-key가 있어야 준다 */
export function shotThumbSource(shot: { thumbUrl: string | null; photo?: { savedAt: string } }): { uri: string; headers: Record<string, string> } | null {
  if (!shot.thumbUrl) return null;
  // 다시 찍으면 주소가 같아 Image 캐시가 옛 사진을 보여 줄 수 있다 — savedAt을 붙여 구분한다
  const v = encodeURIComponent(shot.photo?.savedAt ?? '');
  return { uri: `${API_URL}${shot.thumbUrl}?v=${v}`, headers: { 'x-access-key': ACCESS_KEY } };
}

/** 사진 한 장(원본·썸네일) — 한 칸 여러 장 */
export function shotPhotoItemSource(p: ShotPhotoItem, thumb: boolean): { uri: string; headers: Record<string, string> } {
  return { uri: `${API_URL}${thumb ? p.thumbUrl : p.url}?v=${encodeURIComponent(p.savedAt)}`, headers: { 'x-access-key': ACCESS_KEY } };
}

/** 예시 사진(원본·썸네일). 없으면 null */
export function exampleSource(shot: Pick<Shot, 'exampleUrl' | 'exampleThumbUrl' | 'exampleSavedAt'>, thumb: boolean): { uri: string; headers: Record<string, string> } | null {
  const url = thumb ? shot.exampleThumbUrl : shot.exampleUrl;
  if (!url) return null;
  return { uri: `${API_URL}${url}?v=${encodeURIComponent(shot.exampleSavedAt ?? '')}`, headers: { 'x-access-key': ACCESS_KEY } };
}

async function shotCall(path: string, method: 'DELETE' | 'PATCH' | 'POST', body?: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${path}`, {
      method,
      headers: { 'x-access-key': ACCESS_KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 인터넷이 되는 곳에서 다시 해 주세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(b?.error ?? `저장하지 못했습니다 (${res.status}).`);
  }
}

const enc = encodeURIComponent;
/** 서버에 올라간 사진 한 장 지우기 */
export function deleteShotPhoto(projectId: string, shotId: string, photoId: string): Promise<void> {
  return shotCall(`${enc(projectId)}/shots/${enc(shotId)}/photos/${enc(photoId)}`, 'DELETE');
}
/** 대표 사진으로 */
export function setPrimaryShotPhoto(projectId: string, shotId: string, photoId: string): Promise<void> {
  return shotCall(`${enc(projectId)}/shots/${enc(shotId)}/photos/${enc(photoId)}`, 'PATCH', { primary: true });
}
/** 이 사진을 이 항목의 예시로(같은 시설물 종류의 모든 구조물에 보인다) */
export function setShotExample(projectId: string, shotId: string, photoId: string): Promise<void> {
  return shotCall(`${enc(projectId)}/shots/${enc(shotId)}/photos/${enc(photoId)}/example`, 'POST');
}
/** 이 항목의 예시 빼기 */
export function removeShotExample(projectId: string, shotId: string): Promise<void> {
  return shotCall(`${enc(projectId)}/shots/${enc(shotId)}/example`, 'DELETE');
}

// 구조물(하위 프로젝트) 추가. 응답은 트리 계산을 거친 Project 하나.
export async function createProject(name: string, parentId: string | null): Promise<Project> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects`, {
      method: 'POST',
      headers: { 'x-access-key': ACCESS_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 인터넷이 되는 곳에서 다시 해 주세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `프로젝트를 만들지 못했습니다 (${res.status}).`);
  }
  return (await res.json()) as Project;
}

/** 참조 이미지 썸네일 전체 주소 + 헤더(내려받기·Image 공용) */
export function shotRefThumbRequest(shot: Shot): { uri: string; headers: Record<string, string> } | null {
  if (!shot.refThumbUrl) return null;
  return { uri: `${API_URL}${shot.refThumbUrl}`, headers: { 'x-access-key': ACCESS_KEY } };
}

/** 보고서 참조 이미지 원본(「사진 한 장」 화면에서 크게 볼 때) */
export function shotRefRequest(shot: Shot): { uri: string; headers: Record<string, string> } | null {
  if (!shot.refUrl) return null;
  return { uri: `${API_URL}${shot.refUrl}`, headers: { 'x-access-key': ACCESS_KEY } };
}

// 보고서 페이지(group) 휴지통 넣기/복구
export async function setGroupTrashed(projectId: string, group: string, trashed: boolean): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${encodeURIComponent(projectId)}/shots/groups/${encodeURIComponent(group)}`, {
      method: 'PATCH',
      headers: { 'x-access-key': ACCESS_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ trashed }),
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. 인터넷이 되는 곳에서 다시 해 주세요.');
  }
  if (!res.ok) throw new Error(`페이지 상태를 바꾸지 못했습니다 (${res.status}).`);
}
