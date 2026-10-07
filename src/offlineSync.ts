// 기기에 내려받은 도면들의 손상 기록을 서버와 맞춘다(설계 3.5). 어느 쪽이 이기는지는 순수 규칙
// src/offlineRules.ts의 syncDecision이 정하고, 이 파일은 그 판단에 따라 GET/PUT과 파일
// 읽기·쓰기만 한다. photoUpload.flushPhotoQueue와 같은 단일 실행 잠금을 쓴다 — 목록 화면 진입·
// 60초 타이머·배지 탭이 겹쳐 불려도 한 번만 돈다.
import { fetchDamages, putDamages, type DamageDoc } from './api';
import { effectiveDecision, mergeSyncDecision } from './offlineRules';
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

export interface SyncOptions {
  /** 뷰어에 열려 있는 도면 id — 이 도면은 push만 하고 pull은 건너뛴다(2026-09-28 설계 1.1). */
  skipPullFor?: string;
}

// 이미 돌고 있으면 그 약속을 그대로 돌려준다(옵션이 달라도) — 겹쳐 돌면 index.json 갱신이
// 사라질 수 있다. 목록 화면은 뷰어가 열려 있는 동안 언마운트되어 있으므로 옵션 없는 회차가 새로
// 시작되지는 않는다. 다만 뷰어를 여는 순간 이미 돌던 목록의 회차 하나는 열어 둔 도면을 pull할 수
// 있다(이전부터 있던 드문 경우) — 뷰어가 다음에 저장하면 로컬 시각이 더 새것이 되어 push된다.
export function syncOffline(options: SyncOptions = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync(options.skipPullFor).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(skipPullFor: string | undefined): Promise<SyncResult> {
  {
    // 도는 동안 index는 다시 쓰지 않고 도면 목록을 도는 데만 쓴다. 고칠 때는 patchEntry가 그 순간의
    // index를 새로 읽어 고친다 — 뷰어가 열려 있으면 동기화 도중에도 저장(offlineSave)이
    // damagesUpdatedAt을 올리므로, 처음 읽은 사본을 통째로 쓰면 그 값이 옛 값으로 되돌아가
    // 방금 그린 손상이 "올릴 것 없음"이 되고 나중에 서버 것에 덮인다(2026-09-28 설계 1.1).
    const index = readIndex();
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
          patchEntry(id, { syncError: SERVER_GONE });
        }
        continue;
      }

      // 기기에서 고친 것이 있으면 서버가 새것이어도 올린다 — 서버가 손상 단위로 합쳐 돌려준다(2026-10-07).
      const decision = effectiveDecision(
        mergeSyncDecision(entry.damagesUpdatedAt, entry.serverUpdatedAt, serverDoc.updatedAt),
        id,
        skipPullFor,
      );
      if (decision === 'push') {
        const localDoc = readDamages(id) as DamageDoc | null;
        if (!localDoc) {
          failed++;
          continue;
        }
        try {
          const merged = await putDamages(id, localDoc);
          // 합친 문서를 기기에도 둔다 — 다른 기기 손상이 들어온다. 단 그 도면 뷰어가 열려 있으면
          // 파일만 바꾸면 뷰어 문서와 갈라지므로(effectiveDecision과 같은 이유) 시각만 맞추고 파일은 둔다.
          if (id !== skipPullFor && writeDamages(id, merged)) {
            patchEntry(id, { damagesUpdatedAt: merged.updatedAt, serverUpdatedAt: merged.updatedAt, syncError: null });
          } else {
            patchEntry(id, { serverUpdatedAt: merged.updatedAt, syncError: null });
          }
          pushed++;
        } catch (err) {
          // 연결 실패는 조용히 다음 기회로. 서버가 4xx로 거절한 것(형식 오류 등)은 다시 보내도
          // 같으므로 사유를 index에 적어 목록 화면이 그 도면에 보여 준다(설계 3.5 sync-error).
          // 그래도 다음 기회에 다시 시도는 한다 — 서버가 고쳐지면 통과할 수 있다.
          console.error('[offlineSync] 손상 기록을 올리지 못했습니다', id, err);
          const status = (err as { status?: unknown }).status;
          if (typeof status === 'number' && status >= 400 && status < 500) {
            patchEntry(id, { syncError: err instanceof Error ? err.message : String(err) });
          }
          failed++;
        }
      } else if (decision === 'pull') {
        if (!writeDamages(id, serverDoc)) {
          failed++;
          continue;
        }
        patchEntry(id, { damagesUpdatedAt: serverDoc.updatedAt, serverUpdatedAt: serverDoc.updatedAt });
        pulled++;
      }
      // decision === 'none'이면 할 일이 없다.
    }

    return { pushed, pulled, failed };
  }
}

// 그 순간의 index를 읽어 도면 하나만 고쳐 쓴다. readIndex·writeIndex가 동기라 둘 사이에 다른
// 저장이 끼어들지 않는다.
function patchEntry(id: string, patch: Partial<OfflineDrawingEntry>): void {
  writeIndex(updateEntry(readIndex(), id, patch));
}

function updateEntry(index: OfflineIndex, id: string, patch: Partial<OfflineDrawingEntry>): OfflineIndex {
  const current = index.drawings[id];
  if (!current) return index;
  return { ...index, drawings: { ...index.drawings, [id]: { ...current, ...patch } } };
}
