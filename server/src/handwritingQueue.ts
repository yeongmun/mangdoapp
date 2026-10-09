// 전송받은 손상 기록에 남아 있는 **아직 못 읽은 손글씨**(attrs.handwriting.image — 현장에 인터넷이 없어
// 뷰어가 바로 인식하지 못한 획 그림)를 서버가 대신 읽는다(2026-10-09). PUT 처리 뒤 백그라운드로 돌고,
// 결과는 잠금 아래 문서에 다시 쓴다: 비어 있던 폭/길이/개소만 채우고(사람이 적은 값은 그대로),
// image는 지우고 text(읽은 글)만 남긴다. 뷰어는 text를 속성창에 보여 준다.
// 앱은 서버 updatedAt이 새것이면 받아 가므로(동기화 규칙) 다음에 도면을 열 때 채워져 보인다.

import type { DamagesStore } from './damagesStore.js';
import { parseHandwriting, type Transcriber } from './handwriting.js';

type Damage = {
  id?: unknown;
  updatedAt?: unknown;
  measured?: { width?: unknown; length?: unknown; count?: unknown };
  attrs?: { handwriting?: { image?: unknown; text?: unknown } };
};

/** 아직 못 읽은 손글씨가 붙은 손상 id 목록 */
export function pendingHandwritingIds(damages: unknown[]): string[] {
  return (damages as Damage[])
    .filter((d) => typeof d?.attrs?.handwriting?.image === 'string' && d.attrs.handwriting.image !== '')
    .map((d) => String(d.id));
}

/** 읽은 결과를 손상에 적용한 새 손상(순수). 비어 있던 칸만 채운다 */
export function applyHandwritingToDamage(damage: unknown, values: { width: number | null; length: number | null; count: number | null; text: string }, now: string): unknown {
  const d = damage as Damage & { measured: Record<string, unknown>; attrs: Record<string, unknown> };
  const measured = { ...d.measured };
  if ((measured.width === null || measured.width === undefined) && values.width !== null) measured.width = values.width;
  if ((measured.length === null || measured.length === undefined) && values.length !== null) measured.length = values.length;
  if ((measured.count === null || measured.count === undefined) && values.count !== null) measured.count = values.count;
  const attrs = { ...d.attrs, handwriting: { text: values.text } };
  return { ...d, measured, attrs, updatedAt: now };
}

export async function processPendingHandwriting(
  damages: DamagesStore,
  transcriber: Transcriber,
  drawingId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<number> {
  const doc = await damages.get(drawingId);
  const ids = pendingHandwritingIds(doc.damages);
  if (ids.length === 0) return 0;

  // AI 호출은 잠금 밖에서(수 초 걸린다), 적용은 잠금 안에서 최신 문서에.
  const results = new Map<string, ReturnType<typeof parseHandwriting>>();
  for (const id of ids) {
    const damage = (doc.damages as Damage[]).find((d) => String(d.id) === id);
    const image = damage?.attrs?.handwriting?.image;
    if (typeof image !== 'string') continue;
    try {
      results.set(id, parseHandwriting(await transcriber.transcribe(Buffer.from(image, 'base64'))));
    } catch (err) {
      console.error('[handwriting] 대기 손글씨를 읽지 못했습니다', drawingId, id, err instanceof Error ? err.message : err);
    }
  }
  if (results.size === 0) return 0;

  return damages.withLock(drawingId, async () => {
    const latest = await damages.get(drawingId);
    const stamp = now();
    let applied = 0;
    const next = (latest.damages as Damage[]).map((d) => {
      const values = results.get(String(d.id));
      // 그 사이 누가 지웠거나(없음) 다시 썼으면(image가 달라짐) 건너뛴다
      if (!values || typeof d.attrs?.handwriting?.image !== 'string') return d;
      const original = (doc.damages as Damage[]).find((o) => String(o.id) === String(d.id));
      if (original?.attrs?.handwriting?.image !== d.attrs.handwriting.image) return d;
      applied += 1;
      return applyHandwritingToDamage(d, values, stamp);
    });
    if (applied > 0) await damages.save({ ...latest, damages: next, updatedAt: stamp });
    return applied;
  });
}
