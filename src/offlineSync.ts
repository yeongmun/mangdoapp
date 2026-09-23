// 기기에 내려받은 도면들의 손상 기록을 서버와 맞춘다(설계 3.5). 어느 쪽이 이기는지는 순수 규칙
// src/offlineRules.ts의 syncDecision이 정하고, 이 파일은 그 판단에 따라 GET/PUT과 파일
// 읽기·쓰기만 한다. photoUpload.flushPhotoQueue와 같은 단일 실행 잠금을 쓴다 — 목록 화면 진입·
// 60초 타이머·배지 탭이 겹쳐 불려도 한 번만 돈다.
import { fetchDamages, putDamages, type DamageDoc } from './api';
import { syncDecision } from './offlineRules';
import { readDamages, readIndex, writeDamages, writeIndex, type OfflineDrawingEntry, type OfflineIndex } from './offlineStore';

let syncing = false;

export async function syncOffline(): Promise<{ pushed: number; pulled: number; failed: number }> {
  if (syncing) return { pushed: 0, pulled: 0, failed: 0 };
  syncing = true;
  try {
    let index = readIndex();
    let pushed = 0;
    let pulled = 0;
    let failed = 0;

    for (const id of Object.keys(index.drawings)) {
      const entry = index.drawings[id];
      let serverDoc: DamageDoc | null;
      try {
        serverDoc = await fetchDamages(id);
      } catch (err) {
        // 연결이 안 되면(비행기 모드 등) 조용히 다음 기회로 미룬다(설계 3.5).
        console.error('[offlineSync] 서버 손상 기록을 가져오지 못했습니다', id, err);
        failed++;
        continue;
      }
      // 도면이 서버에서 없어졌으면(휴지통행) 이 도면은 건너뛴다 — 범위 밖(설계 1장).
      if (!serverDoc) continue;

      const decision = syncDecision(entry.damagesUpdatedAt, serverDoc.updatedAt);
      if (decision === 'push') {
        const localDoc = readDamages(id) as DamageDoc | null;
        if (!localDoc) {
          failed++;
          continue;
        }
        try {
          const result = await putDamages(id, localDoc);
          index = updateEntry(index, id, { serverUpdatedAt: result.updatedAt });
          writeIndex(index);
          pushed++;
        } catch (err) {
          // 400(형식 오류)이든 연결 실패든 다음 기회에 다시 시도한다(설계 3.5 sync-error는
          // 화면 표시 몫 — Task 5).
          console.error('[offlineSync] 손상 기록을 올리지 못했습니다', id, err);
          failed++;
        }
      } else if (decision === 'pull') {
        if (!writeDamages(id, serverDoc)) {
          failed++;
          continue;
        }
        index = updateEntry(index, id, { damagesUpdatedAt: serverDoc.updatedAt, serverUpdatedAt: serverDoc.updatedAt });
        writeIndex(index);
        pulled++;
      }
      // decision === 'none'이면 할 일이 없다.
    }

    return { pushed, pulled, failed };
  } finally {
    syncing = false;
  }
}

function updateEntry(index: OfflineIndex, id: string, patch: Partial<OfflineDrawingEntry>): OfflineIndex {
  const current = index.drawings[id];
  if (!current) return index;
  return { ...index, drawings: { ...index.drawings, [id]: { ...current, ...patch } } };
}
