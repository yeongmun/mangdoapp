// 손상 문서 자동 저장. 변경 즉시 로컬 백업, 1초 뒤 서버 저장, 실패 시 5초부터 두 배씩(최대 60초) 재시도한다.

export const SAVE_DELAY_MS = 1000;
export const RETRY_START_MS = 5000;
export const RETRY_MAX_MS = 60000;

export function nextRetryDelay(previousMs) {
  return previousMs === null ? RETRY_START_MS : Math.min(previousMs * 2, RETRY_MAX_MS);
}

export function backupKey(drawingId) {
  return `mangdo.damages.${drawingId}`;
}

export function chooseInitialDoc(serverDoc, backupDoc) {
  const backupIsNewer =
    backupDoc !== null &&
    backupDoc.drawingId === serverDoc.drawingId &&
    Date.parse(backupDoc.updatedAt) > Date.parse(serverDoc.updatedAt);
  return backupIsNewer ? { doc: backupDoc, needsUpload: true } : { doc: serverDoc, needsUpload: false };
}

export function createSyncer({ drawingId, save, storage, onStatus }) {
  let latest = null;
  let dirty = false;
  let inFlight = false;
  let timer = null;
  let retryDelay = null;

  function schedule(ms) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
  }

  async function flush() {
    if (inFlight || !dirty) return;
    inFlight = true;
    dirty = false;
    const doc = latest;
    onStatus('saving');
    try {
      await save(doc);
      retryDelay = null;
      if (dirty) {
        schedule(SAVE_DELAY_MS);
      } else {
        onStatus('saved');
      }
    } catch {
      dirty = true;
      retryDelay = nextRetryDelay(retryDelay);
      onStatus('pending');
      schedule(retryDelay);
    } finally {
      inFlight = false;
    }
  }

  return {
    change(doc) {
      latest = doc;
      dirty = true;
      try {
        storage.setItem(backupKey(drawingId), JSON.stringify(doc));
      } catch {
        // 백업 실패(저장 공간 부족 등)는 서버 저장을 막지 않는다.
      }
      onStatus('saving');
      if (!inFlight) schedule(SAVE_DELAY_MS);
    },

    async flushNow() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },

    readBackup() {
      try {
        const raw = storage.getItem(backupKey(drawingId));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
  };
}
