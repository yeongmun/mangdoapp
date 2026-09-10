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

// save가 retryable === false인 오류를 던지면(형식 오류·4xx) 재시도하지 않고 'error' 상태로 멈춘다.
// 다음 change()나 flushNow()에서 다시 저장을 시도한다.
export function createSyncer({ drawingId, save, storage, onStatus }) {
  let latest = null;
  let dirty = false;
  let inFlightPromise = null;
  let timer = null;
  let retryDelay = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(ms) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, ms);
  }

  async function attemptSave() {
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
    } catch (err) {
      dirty = true;
      if (err?.retryable === false) {
        retryDelay = null;
        onStatus('error', err.message);
        return;
      }
      retryDelay = nextRetryDelay(retryDelay);
      onStatus('pending');
      schedule(retryDelay);
    }
  }

  function flush() {
    if (inFlightPromise !== null || !dirty) return Promise.resolve();
    // finally 콜백이 먼저 실행되므로, 이 promise를 기다린 쪽이 깨어날 때는 inFlightPromise가 이미 null이다.
    inFlightPromise = attemptSave().finally(() => {
      inFlightPromise = null;
    });
    return inFlightPromise;
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
      if (retryDelay !== null && inFlightPromise === null) {
        onStatus('pending');
        return;
      }
      onStatus('saving');
      if (inFlightPromise === null) schedule(SAVE_DELAY_MS);
    },

    // 대기 없이 저장하고, 남은 변경이 없으면 true, 서버에 저장하지 못한 변경이 남으면 false.
    async flushNow() {
      clearTimer();
      // 동시에 호출된 다른 flushNow가 먼저 깨어나 다음 저장을 시작했을 수 있으므로 저장이 없을 때까지 기다린다.
      while (inFlightPromise !== null) await inFlightPromise;
      // 진행 중이던 저장이 끝나며 다음 저장이나 재시도를 예약했을 수 있다.
      clearTimer();
      await flush();
      // 저장에 실패하면 attemptSave가 dirty를 다시 true로 돌리므로 dirty만 보면 된다.
      return !dirty;
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
