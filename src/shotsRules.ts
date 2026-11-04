// [필수 사진] 카드 표시의 **판단 규칙**(순수, import 없음 — vitest가 server/test/shotsRules.test.ts에서 상대 경로로 읽는다).
// 기기 사본(local)은 "찍었지만 아직 서버에 없는" 동안만 의미가 있다. 서버에 사진이 올라갔으면 서버 썸네일이
// 정답이고(사본은 업로드 뒤 지워진다 — photoUpload.ts), 대기열에도 없고 서버에도 없으면 전송이 버려진
// 것이라(400·404) ✓를 내려야 한다(리뷰 1).
// 2026-11-05 한 칸 여러 장: local은 칸마다 사본 **목록**이고, 사본마다 기기가 만든 photoId가 있다.

export interface LocalEntry {
  uri: string;
  takenAt: number;
  /** 기기가 만든 사진 id(서버 photos[].id와 같다). 11-05 이전 사본엔 없다 */
  photoId?: string;
}

export type LocalMap = Record<string, LocalEntry[]>;

function isEntry(x: unknown): x is LocalEntry {
  return typeof x === 'object' && x !== null && typeof (x as LocalEntry).uri === 'string';
}

/** 기기 파일의 local을 읽는다 — 옛 모양(칸마다 사본 하나)도 목록으로 */
export function normalizeLocal(raw: unknown): LocalMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: LocalMap = {};
  for (const [shotId, value] of Object.entries(raw as Record<string, unknown>)) {
    const list = Array.isArray(value) ? value.filter(isEntry) : isEntry(value) ? [value] : [];
    if (list.length > 0) out[shotId] = list;
  }
  return out;
}

/**
 * 서버 목록과 대기열을 기준으로 local을 정리한다.
 * - photoId가 있는 사본: 서버 photos에 그 id가 있으면 삭제(서버 것 사용), 대기열에 그 id가 없으면 삭제(버려짐), 그 밖엔 유지
 * - photoId가 없는 옛 사본: 서버에 사진이 있거나 그 칸이 대기열에 없으면 삭제
 * 서버 목록을 아직 못 받았으면(serverShots === null) 건드리지 않는다.
 */
export function reconcileLocal(
  local: LocalMap,
  serverShots: { id: string; photo?: unknown; photos?: { id: string }[] }[] | null,
  queued: { shotIds: Set<string>; photoIds: Set<string> },
): LocalMap {
  if (serverShots === null) return local;
  const byId = new Map(serverShots.map((s) => [s.id, s]));
  const out: LocalMap = {};
  for (const [shotId, entries] of Object.entries(local)) {
    const server = byId.get(shotId);
    const serverPhotoIds = new Set((server?.photos ?? []).map((p) => p.id));
    const serverHasPhoto = server !== undefined && server.photo !== undefined && server.photo !== null;
    const kept = entries.filter((e) => {
      if (e.photoId) return !serverPhotoIds.has(e.photoId) && queued.photoIds.has(e.photoId);
      return !serverHasPhoto && queued.shotIds.has(shotId);
    });
    if (kept.length > 0) out[shotId] = kept;
  }
  return out;
}

/** 칸의 사진 수: 서버 사진 + 아직 서버에 없는 기기 사본 */
export function photoCountOf(shot: { photo?: unknown; photos?: { id: string }[] }, local: LocalEntry[] | undefined): number {
  const server = shot.photos?.length ?? (shot.photo ? 1 : 0);
  const ids = new Set((shot.photos ?? []).map((p) => p.id));
  return server + (local ?? []).filter((e) => !e.photoId || !ids.has(e.photoId)).length;
}

/** 새 사진 id(기기에서 만든다 — 서버 PHOTO_ID_PATTERN: 영문·숫자·_- 2~64자) */
export function newPhotoId(now: number, random: number): string {
  return `ph_${now.toString(36)}${Math.floor(random * 1e9).toString(36)}`;
}
