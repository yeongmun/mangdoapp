// [필수 사진] 카드 표시의 **판단 규칙**(순수, import 없음 — vitest가 server/test/shotsRules.test.ts에서 상대 경로로 읽는다).
// 기기 사본(local)은 "찍었지만 아직 서버에 없는" 동안만 의미가 있다. 서버에 사진이 올라갔으면 서버 썸네일이
// 정답이고(사본은 업로드 뒤 지워진다 — photoUpload.ts), 대기열에도 없고 서버에도 없으면 전송이 버려진
// 것이라(400·404) ✓를 내려야 한다(리뷰 1).

export interface LocalEntry {
  uri: string;
  takenAt: number;
}

/**
 * 서버 목록과 대기열을 기준으로 local을 정리한다.
 * - 서버에 photo가 있는 shot → local 삭제(서버 썸네일 사용)
 * - 서버에 photo가 없고 대기열에도 없는 shot → local 삭제(전송 실패로 버려짐 → 다시 찍어야 한다)
 * - 그 밖(대기 중) → 유지
 * 서버 목록을 아직 못 받았으면(serverShots === null) 건드리지 않는다.
 */
export function reconcileLocal(
  local: Record<string, LocalEntry>,
  serverShots: { id: string; photo?: unknown }[] | null,
  queuedShotIds: Set<string>,
): Record<string, LocalEntry> {
  if (serverShots === null) return local;
  const onServer = new Set(serverShots.filter((s) => s.photo !== undefined && s.photo !== null).map((s) => s.id));
  const out: Record<string, LocalEntry> = {};
  for (const [shotId, entry] of Object.entries(local)) {
    if (onServer.has(shotId)) continue;
    if (!queuedShotIds.has(shotId)) continue;
    out[shotId] = entry;
  }
  return out;
}
