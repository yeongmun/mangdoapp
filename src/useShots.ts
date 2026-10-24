// [필수 사진]·[전차 사진] 탭이 함께 쓰는 상태·촬영 로직(2026-10-24). 화면은 보여 주기만 하고, 서버 목록 받기,
// 기기 저장(shotsLocal), 촬영 → 대기열(photoUpload) → 즉시 ✓ 표시, 서버와 맞추기(shotsRules.reconcileLocal)는 여기서.
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { fetchShots, shotThumbSource, type Project, type Shot, type ShotList } from './api';
import { takePhotoAndSave } from './photo';
import { enqueuePhoto, flushPhotoQueue, queuedShotIds } from './photoUpload';
import { reconcileLocal } from './shotsRules';
import { readShotsLocal, writeShotsLocal, type LocalShotState } from './shotsLocal';

/** 서버 파일명 규칙(shotsStore.shotFileName)과 같은 모양 — 대기열 항목의 filename으로 보낸다 */
export function fileNameFor(projectName: string, shot: Shot): string {
  const safe = (t: string) => t.trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}.jpg`;
}

export function useShots(project: Project, onPhotoQueued?: () => void) {
  const [state, setState] = useState<LocalShotState>(() => readShotsLocal(project.id));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list: ShotList = await fetchShots(project.id);
      // 서버에 올라간 사진은 서버 썸네일로, 버려진 전송은 ✓를 내린다
      const queued = queuedShotIds();
      setState((prev) => {
        const next = { ...prev, list, fetchedAt: Date.now(), local: reconcileLocal(prev.local, list.shots, queued) };
        writeShotsLocal(project.id, next);
        return next;
      });
      setError(null);
    } catch (e) {
      // 오프라인이면 기기 사본으로 보여 준다. 사본도 없을 때만 오류를 띄운다
      setState((prev) => {
        if (prev.list === null) setError(e instanceof Error ? e.message : String(e));
        return prev;
      });
    }
  }, [project.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isTaken = useCallback((shot: Shot) => state.local[shot.id] !== undefined || shot.photo !== undefined, [state.local]);

  /** 찍은 사진 썸네일: 서버에 사진이 있으면 서버 것(기기 사본은 업로드 뒤 지워진다), 아니면 기기 사본 */
  const takenThumb = useCallback(
    (shot: Shot) => {
      const local = state.local[shot.id];
      return shot.photo ? shotThumbSource(shot) : local ? { uri: local.uri } : null;
    },
    [state.local],
  );

  const shoot = useCallback(
    async (shot: Shot) => {
      setBusyId(shot.id);
      try {
        const result = await takePhotoAndSave();
        if (!result.ok) {
          if (result.reason !== '취소') Alert.alert('사진', result.reason);
          return;
        }
        if (!result.uploadUri) {
          Alert.alert('사진', '앨범에는 저장됐지만 서버로 보낼 사본을 만들지 못했습니다.');
          return;
        }
        const projectName = state.list?.projectName ?? project.name;
        const queued = enqueuePhoto({
          drawingId: '',
          damageId: '',
          filename: fileNameFor(projectName, shot),
          uploadUri: result.uploadUri,
          target: { kind: 'shot', projectId: project.id, shotId: shot.id },
        });
        if (!queued) {
          Alert.alert('사진', '앨범에는 저장됐지만 전송 대기열에 넣지 못했습니다.');
          return;
        }
        setState((prev) => {
          const next = { ...prev, local: { ...prev.local, [shot.id]: { uri: result.uploadUri!, takenAt: Date.now() } } };
          writeShotsLocal(project.id, next);
          return next;
        });
        onPhotoQueued?.();
        void flushPhotoQueue(() => undefined);
      } finally {
        setBusyId(null);
      }
    },
    [project.id, project.name, state.list?.projectName, onPhotoQueued],
  );

  return { state, setState, error, busyId, refresh, isTaken, takenThumb, shoot };
}
