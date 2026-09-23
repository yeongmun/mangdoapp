// 기기에 내려받은 도면들의 손상 기록을 서버와 맞춘다(설계 3.5). 어느 쪽이 이기는지는 순수 규칙
// src/offlineRules.ts의 syncDecision이 정하고, 이 파일은 그 판단에 따라 GET/PUT과 파일
// 읽기·쓰기만 한다. photoUpload.flushPhotoQueue와 같은 단일 실행 잠금을 쓴다 — 목록 화면 진입·
// 60초 타이머·배지 탭이 겹쳐 불려도 한 번만 돈다.
import { fetchDamages, putDamages, type DamageDoc } from './api';
import { syncDecision } from './offlineRules';
import { readDamages, readIndex, writeDamages, writeIndex, type OfflineDrawingEntry, type OfflineIndex } from './offlineStore';

/** 서버에 없는(휴지통으로 간) 도면에 적는 사유. 목록 화면이 그대로 보인다. */
export const SERVER_GONE = '서버에 없는 도면입니다(휴지통). PC에서 복구하거나 기기에서 지우세요';

export interface SyncResult {
  pushed: number;
  pulled: number;
  failed: number;
}

// 진행 중인 동기화. 내려받기(offlineDownload)도 index.json을 쓰므로, 시작 전에 waitForSync()로
// 이것이 끝나기를 기다린다(Task 5 검토 Major: 한쪽 갱신이 사라질 수 있었다).
let inFlight: Promise<SyncResult> | null = null;

/** 동기화가 돌고 있으면 끝날 때까지 기다린다. 안 돌면 바로 돌아온다. */
export function waitForSync(): Promise<void> {
  return inFlight ? inFlight.then(() => undefined, () => undefined) : Promise.resolve();
}

export function syncOffline(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncResult> {
  {
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
      if (!serverDoc) {
        // 서버에서 지워진(휴지통) 도면. 못 올린 손상이 있으면 배지가 영영 남으므로 사유를 적어
        // 목록 줄에 보이고, 사용자가 PC에서 복구하거나 기기에서 지우게 한다(최종 검토 Important 3).
        if (entry.syncError !== SERVER_GONE) {
          index = updateEntry(index, id, { syncError: SERVER_GONE });
          writeIndex(index);
        }
        continue;
      }

      const decision = syncDecision(entry.damagesUpdatedAt, serverDoc.updatedAt);
      if (decision === 'push') {
        const localDoc = readDamages(id) as DamageDoc | null;
        if (!localDoc) {
          failed++;
          continue;
        }
        try {
          const result = await putDamages(id, localDoc);
          index = updateEntry(index, id, { serverUpdatedAt: result.updatedAt, syncError: null });
          writeIndex(index);
          pushed++;
        } catch (err) {
          // 연결 실패는 조용히 다음 기회로. 서버가 4xx로 거절한 것(형식 오류 등)은 다시 보내도
          // 같으므로 사유를 index에 적어 목록 화면이 그 도면에 보여 준다(설계 3.5 sync-error).
          // 그래도 다음 기회에 다시 시도는 한다 — 서버가 고쳐지면 통과할 수 있다.
          console.error('[offlineSync] 손상 기록을 올리지 못했습니다', id, err);
          const status = (err as { status?: unknown }).status;
          if (typeof status === 'number' && status >= 400 && status < 500) {
            index = updateEntry(index, id, { syncError: err instanceof Error ? err.message : String(err) });
            writeIndex(index);
          }
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
  }
}

function updateEntry(index: OfflineIndex, id: string, patch: Partial<OfflineDrawingEntry>): OfflineIndex {
  const current = index.drawings[id];
  if (!current) return index;
  return { ...index, drawings: { ...index.drawings, [id]: { ...current, ...patch } } };
}
