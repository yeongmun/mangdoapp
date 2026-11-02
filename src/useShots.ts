// [필수 사진]·[전차 사진] 탭이 함께 쓰는 상태·촬영 로직(2026-10-24). 화면은 보여 주기만 하고, 서버 목록 받기,
// 기기 저장(shotsLocal), 촬영 → 대기열(photoUpload) → 즉시 ✓ 표시, 서버와 맞추기(shotsRules.reconcileLocal)는 여기서.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import { fetchShots, shotThumbSource, type Project, type Shot, type ShotList } from './api';
import type { PhotoResult } from './photo';
import { recordStructureLocation } from './structureLocation';
import { enqueuePhoto, flushPhotoQueue, queuedShotIds, removeQueuedPhoto, shotUploadStates } from './photoUpload';
import { useUploadStatus } from './useUploadStatus';
import { reconcileLocal } from './shotsRules';
import { readShotsLocal, writeShotsLocal, type LocalShotState } from './shotsLocal';
import { useToast } from './components/Toast';

/** 서버 파일명 규칙(shotsStore.shotFileName)과 같은 모양 — 대기열 항목의 filename으로 보낸다 */
export function fileNameFor(projectName: string, shot: Shot): string {
  const safe = (t: string) => t.trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}.jpg`;
}

/** 찍은 뒤 이만큼은 서버로 보내지 않고 「되돌리기」를 받는다(구글 Tasks 「실행취소」 레퍼런스, 2026-11-02) */
export const UNDO_MS = 5000;

/** 찍은 칸이 「찍음」 묶음으로 내려가고 되돌리면 올라오는 움직임(다음 그리기 한 번에만 걸린다) */
function animateMove(): void {
  LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

export function useShots(project: Project, onPhotoQueued?: () => void) {
  const [state, setState] = useState<LocalShotState>(() => readShotsLocal(project.id));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

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

  // 사진 칸의 작은 표시(올라가는 중·대기·실패) — 대기열이 바뀔 때마다 다시 읽는다
  const upload = useUploadStatus();
  const uploadStates = useMemo(
    () => shotUploadStates(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upload.version],
  );

  const isTaken = useCallback((shot: Shot) => state.local[shot.id] !== undefined || shot.photo !== undefined, [state.local]);

  /** 찍은 사진 썸네일: 서버에 사진이 있으면 서버 것(기기 사본은 업로드 뒤 지워진다), 아니면 기기 사본 */
  const takenThumb = useCallback(
    (shot: Shot) => {
      const local = state.local[shot.id];
      return shot.photo ? shotThumbSource(shot) : local ? { uri: local.uri } : null;
    },
    [state.local],
  );

  // 앱 안 카메라(CameraScreen, 2026-11-02): 어느 항목에서 열렸는지. null이면 닫힘
  const [cameraShotId, setCameraShotId] = useState<string | null>(null);
  const shoot = useCallback((shot: Shot) => setCameraShotId(shot.id), []);
  const closeCamera = useCallback(() => setCameraShotId(null), []);

  /**
   * 찍힌 사진(앱 안 카메라 결과)을 이 항목에 붙인다: 대기열에 넣고(5초 뒤 전송) 칸에 ✓, 구조물 위치 기록.
   * 돌려주는 undo를 부르면 되돌린다(아직 안 보냈을 때만 true). inCamera면 토스트는 띄우지 않는다(카메라 화면이 직접 보여 준다)
   */
  const commitPhoto = useCallback(
    (shot: Shot, result: PhotoResult, inCamera = false): { undo: () => boolean } | null => {
      setBusyId(shot.id);
      try {
        if (!result.ok) {
          if (result.reason !== '취소') Alert.alert('사진', result.reason);
          return null;
        }
        if (!result.uploadUri) {
          Alert.alert('사진', '앨범에는 저장됐지만 서버로 보낼 사본을 만들지 못했습니다.');
          return null;
        }
        const projectName = state.list?.projectName ?? project.name;
        const queued = enqueuePhoto({
          drawingId: '',
          damageId: '',
          filename: fileNameFor(projectName, shot),
          uploadUri: result.uploadUri,
          target: { kind: 'shot', projectId: project.id, shotId: shot.id },
          holdMs: UNDO_MS,
        });
        if (!queued) {
          Alert.alert('사진', '앨범에는 저장됐지만 전송 대기열에 넣지 못했습니다.');
          return null;
        }
        let before: LocalShotState['local'][string] | undefined;
        animateMove();
        setState((prev) => {
          before = prev.local[shot.id];
          const next = { ...prev, local: { ...prev.local, [shot.id]: { uri: result.uploadUri!, takenAt: Date.now() } } };
          writeShotsLocal(project.id, next);
          return next;
        });
        onPhotoQueued?.();
        // 찍은 자리를 구조물 위치로(홈 「근처 구조물」). 기다리지 않는다 — 사진이 우선
        void recordStructureLocation(project.id);
        const undo = (): boolean => {
          // 아직 안 보낸 사진만 뺄 수 있다(UNDO_MS 동안은 보내지 않는다). 앨범 사본은 남는다
          if (!removeQueuedPhoto(queued.id)) {
            if (!inCamera) toast('이미 올리기 시작해서 되돌릴 수 없어요 · 다시 찍으면 바뀌어요');
            return false;
          }
          // 구조물 화면을 벗어났어도 맞도록 기기 파일을 직접 고친다(화면이 없으면 setState는 안 돈다)
          const disk = readShotsLocal(project.id);
          const local = { ...disk.local };
          if (before) local[shot.id] = before;
          else delete local[shot.id];
          writeShotsLocal(project.id, { ...disk, local });
          animateMove();
          setState((prev) => {
            const l = { ...prev.local };
            if (before) l[shot.id] = before;
            else delete l[shot.id];
            return { ...prev, local: l };
          });
          onPhotoQueued?.();
          return true;
        };
        if (!inCamera) {
          toast(`${shot.member} · ${shot.label} 찍었어요`, {
            action: { label: '되돌리기', onPress: () => void undo() },
            // 보내기 시작(UNDO_MS)보다 넉넉히 먼저 닫는다
            durationMs: UNDO_MS - 1000,
          });
        }
        // 앞서 밀린 다른 사진은 지금 보낸다(방금 찍은 것은 UNDO_MS 뒤 저절로)
        void flushPhotoQueue(() => undefined);
        return { undo };
      } finally {
        setBusyId(null);
      }
    },
    [project.id, project.name, state.list?.projectName, onPhotoQueued, toast],
  );

  return { state, setState, error, busyId, refresh, isTaken, takenThumb, shoot, cameraShotId, closeCamera, commitPhoto, uploadStates };
}
