// 손상 문서 병합(2026-10-07, 여러 태블릿이 같은 도면을 나눠 점검). 서버가 PUT을 받을 때 저장된 문서와
// 손상 단위로 합친다 — 문서 전체를 덮어쓰면 다른 기기가 그린 손상이 사라지기 때문이다.
//
// 규칙(손상 id 기준):
//   - 양쪽에 있으면 updatedAt(없으면 createdAt)이 늦은 쪽. 같으면 들어온 쪽.
//   - 한쪽에만 있으면 그대로 둔다 — 단, 반대쪽에 그 id의 삭제 기록(deleted)이 있고 그 시각이
//     손상의 수정 시각 이상이면 지운 것으로 본다(삭제가 수정보다 나중).
//   - deleted는 양쪽 합집합(id마다 늦은 시각). 합친 결과에 살아 있는 손상의 기록은 뺀다.
//   - updatedAt은 양쪽 중 늦은 것. schemaVersion은 5 그대로(필드는 모두 선택이라 옛 기기와 호환).
// 순수 함수라 손으로 검산할 수 있다.

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export interface MergeableDoc {
  schemaVersion: number;
  drawingId: string;
  updatedAt: string;
  damages: unknown[];
  deleted?: Tombstone[];
}

type Damage = { id?: unknown; createdAt?: unknown; updatedAt?: unknown };

function time(value: unknown): number {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** 손상의 수정 시각. updatedAt이 없으면(옛 기기) createdAt, 그것도 없으면 0 */
export function damageTime(damage: unknown): number {
  const d = damage as Damage | null;
  return time(d?.updatedAt) || time(d?.createdAt);
}

function tombstonesOf(doc: MergeableDoc): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of Array.isArray(doc.deleted) ? doc.deleted : []) {
    if (!t || typeof t.id !== 'string' || typeof t.deletedAt !== 'string') continue;
    const current = map.get(t.id);
    if (!current || time(t.deletedAt) > time(current)) map.set(t.id, t.deletedAt);
  }
  return map;
}

function byId(doc: MergeableDoc): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const damage of Array.isArray(doc.damages) ? doc.damages : []) {
    const id = (damage as Damage | null)?.id;
    if (typeof id === 'string' && id !== '') map.set(id, damage);
  }
  return map;
}

export function mergeDamageDocs(server: MergeableDoc, incoming: MergeableDoc): MergeableDoc {
  const serverDamages = byId(server);
  const incomingDamages = byId(incoming);
  const serverDeleted = tombstonesOf(server);
  const incomingDeleted = tombstonesOf(incoming);

  // 삭제 기록 합집합(id마다 늦은 시각)
  const deleted = new Map<string, string>(serverDeleted);
  for (const [id, at] of incomingDeleted) {
    const current = deleted.get(id);
    if (!current || time(at) > time(current)) deleted.set(id, at);
  }

  const merged: unknown[] = [];
  // 순서: 서버 문서 순서를 지키고, 들어온 쪽에만 있는 손상은 뒤에 붙인다 — 번호는 위치로 매기므로
  // 순서는 화면에 영향이 없지만, 파일 diff가 읽기 쉽다.
  const ids = [...serverDamages.keys(), ...[...incomingDamages.keys()].filter((id) => !serverDamages.has(id))];
  for (const id of ids) {
    const sv = serverDamages.get(id);
    const inc = incomingDamages.get(id);
    let chosen: unknown;
    if (sv !== undefined && inc !== undefined) {
      chosen = damageTime(inc) >= damageTime(sv) ? inc : sv;
    } else if (inc !== undefined) {
      // 들어온 쪽에만 있다: 서버 쪽에서 지웠고 그 삭제가 이 손상의 수정보다 나중이면 지운 것.
      const deletedAt = serverDeleted.get(id);
      if (deletedAt !== undefined && time(deletedAt) >= damageTime(inc)) continue;
      chosen = inc;
    } else {
      const deletedAt = incomingDeleted.get(id);
      if (deletedAt !== undefined && time(deletedAt) >= damageTime(sv)) continue;
      chosen = sv;
    }
    merged.push(chosen);
    deleted.delete(id); // 살아남은 손상의 삭제 기록은 뺀다
  }

  const updatedAt = time(incoming.updatedAt) >= time(server.updatedAt) ? incoming.updatedAt : server.updatedAt;
  const result: MergeableDoc = {
    schemaVersion: server.schemaVersion,
    drawingId: server.drawingId,
    updatedAt,
    damages: merged,
  };
  if (deleted.size > 0) result.deleted = [...deleted].map(([id, deletedAt]) => ({ id, deletedAt }));
  return result;
}
