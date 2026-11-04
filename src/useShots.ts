// [필수 사진]·[전차 사진] 탭이 함께 쓰는 상태·촬영 로직(2026-10-24). 화면은 보여 주기만 하고, 서버 목록 받기,
// 기기 저장(shotsLocal), 촬영 → 대기열(photoUpload) → 즉시 ✓ 표시, 서버와 맞추기(shotsRules.reconcileLocal)는 여기서.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, LayoutAnimation } from 'react-native';
import { deleteShotPhoto, fetchShots, removeShotExample, setPrimaryShotPhoto, setShotExample, shotPhotoItemSource, shotThumbSource, type Project, type Shot, type ShotList } from './api';
import type { PhotoResult } from './photo';
import { recordStructureLocation } from './structureLocation';
import { enqueuePhoto, flushPhotoQueue, pendingPhotoItems, queuedShotIds, queuedShotPhotoIds, removeQueuedPhoto, shotUploadStates } from './photoUpload';
import { useUploadStatus } from './useUploadStatus';
import { newPhotoId, photoCountOf, reconcileLocal, type LocalEntry } from './shotsRules';
import { readShotsLocal, writeShotsLocal, type LocalShotState } from './shotsLocal';
import { useToast } from './components/Toast';

/** 서버 파일명 규칙(shotsStore.shotFileName)과 같은 모양 — 대기열 항목의 filename으로 보낸다 */
export function fileNameFor(projectName: string, shot: Shot): string {
  const safe = (t: string) => t.trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}.jpg`;
}

/** 크게 보기의 사진 한 장(서버 사진 또는 아직 안 올라간 기기 사본) */
export interface ShotPhotoView {
  key: string;
  photoId?: string;
  localUri?: string;
  source: { uri: string; headers?: Record<string, string> };
  thumb: { uri: string; headers?: Record<string, string> };
  at: number;
  onServer: boolean;
  primary: boolean;
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
      // 대기열은 요청 **전에** 읽는다 — 요청 중에 올라간 사진이 「대기열에도 서버 목록에도 없음」으로 지워지지 않게(리뷰 5)
      const queued = { shotIds: queuedShotIds(), photoIds: queuedShotPhotoIds() };
      const list: ShotList = await fetchShots(project.id);
      // 서버에 올라간 사진은 서버 썸네일로, 버려진 전송은 ✓를 내린다
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
  // 이 구조물 사진이 대기열에서 빠지면(올라감) 서버 목록을 다시 받는다 — 기기 사본이 지워졌으니 서버 사진으로 바꿔 보여 준다(리뷰 4)
  const pendingHere = useMemo(
    () => pendingPhotoItems().filter((x) => x.target?.projectId === project.id).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upload.version, project.id],
  );
  const lastPending = useRef(pendingHere);
  useEffect(() => {
    if (pendingHere < lastPending.current) void refresh();
    lastPending.current = pendingHere;
  }, [pendingHere, refresh]);

  const isTaken = useCallback((shot: Shot) => (state.local[shot.id]?.length ?? 0) > 0 || shot.photo !== undefined, [state.local]);

  /** 칸의 사진 수(서버 + 아직 안 올라간 기기 사본) — 2장 이상이면 칸에 「N장」 */
  const photoCount = useCallback((shot: Shot) => photoCountOf(shot, state.local[shot.id]), [state.local]);

  /** 대표 썸네일: 서버에 사진이 있으면 서버 대표, 아니면 가장 최근 기기 사본 */
  const takenThumb = useCallback(
    (shot: Shot) => {
      const local = state.local[shot.id] ?? [];
      // 서버도 먼저 올라간 사진을 대표로 삼으므로 기기 사본도 첫 장을 보인다(올라간 뒤 썸네일이 바뀌지 않게)
      return shot.photo ? shotThumbSource(shot) : local.length > 0 ? { uri: local[0].uri } : null;
    },
    [state.local],
  );

  /** 크게 보기에 넘길 사진 목록: 서버 사진(대표 먼저) + 아직 안 올라간 기기 사본 */
  const photoItems = useCallback(
    (shot: Shot): ShotPhotoView[] => {
      const server: ShotPhotoView[] = (shot.photos ?? []).map((p, i) => ({
        key: `s-${p.id}`,
        photoId: p.id,
        source: shotPhotoItemSource(p, false),
        thumb: shotPhotoItemSource(p, true),
        at: Date.parse(p.savedAt) || 0,
        onServer: true,
        primary: i === 0,
      }));
      const ids = new Set((shot.photos ?? []).map((p) => p.id));
      // 옛 서버(photos 없이 photo만)는 대표 한 장으로
      if (server.length === 0 && shot.photo && shot.url) {
        const src = shotThumbSource(shot);
        server.push({ key: 's-p0', photoId: 'p0', source: { uri: src!.uri.replace('/thumb?', '?'), headers: src!.headers }, thumb: src!, at: Date.parse(shot.photo.savedAt) || 0, onServer: true, primary: true });
      }
      const local: ShotPhotoView[] = (state.local[shot.id] ?? [])
        .filter((e) => !e.photoId || !ids.has(e.photoId))
        .map((e) => ({ key: `l-${e.photoId ?? e.uri}`, photoId: e.photoId, localUri: e.uri, source: { uri: e.uri }, thumb: { uri: e.uri }, at: e.takenAt, onServer: false, primary: server.length === 0 && e === (state.local[shot.id] ?? [])[0] }));
      return [...server, ...local];
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
        // 사진마다 기기가 id를 만든다 — 같은 칸을 또 찍으면 덮어쓰지 않고 한 장 더(2026-11-05)
        const photoId = newPhotoId(Date.now(), Math.random());
        const queued = enqueuePhoto({
          drawingId: '',
          damageId: '',
          filename: fileNameFor(projectName, shot),
          uploadUri: result.uploadUri,
          target: { kind: 'shot', projectId: project.id, shotId: shot.id, photoId },
          holdMs: UNDO_MS,
        });
        if (!queued) {
          Alert.alert('사진', '앨범에는 저장됐지만 전송 대기열에 넣지 못했습니다.');
          return null;
        }
        const entry: LocalEntry = { uri: result.uploadUri, takenAt: Date.now(), photoId };
        const wasTaken = isTaken(shot);
        if (!wasTaken) animateMove();
        setState((prev) => {
          const next = { ...prev, local: { ...prev.local, [shot.id]: [...(prev.local[shot.id] ?? []), entry] } };
          writeShotsLocal(project.id, next);
          return next;
        });
        onPhotoQueued?.();
        // 찍은 자리를 구조물 위치로(홈 「근처 구조물」). 기다리지 않는다 — 사진이 우선
        void recordStructureLocation(project.id);
        const undo = (): boolean => {
          // 아직 안 보낸 사진만 뺄 수 있다(UNDO_MS 동안은 보내지 않는다). 앨범 사본은 남는다
          if (!removeQueuedPhoto(queued.id)) {
            if (!inCamera) toast('이미 올리기 시작해서 되돌릴 수 없어요 · 찍은 칸을 눌러 이 사진을 지울 수 있어요');
            return false;
          }
          // 구조물 화면을 벗어났어도 맞도록 기기 파일을 직접 고친다(화면이 없으면 setState는 안 돈다)
          const without = (l: LocalShotState['local']) => {
            const rest = (l[shot.id] ?? []).filter((e) => e.photoId !== photoId);
            const out = { ...l };
            if (rest.length > 0) out[shot.id] = rest;
            else delete out[shot.id];
            return out;
          };
          const disk = readShotsLocal(project.id);
          writeShotsLocal(project.id, { ...disk, local: without(disk.local) });
          if (!wasTaken) animateMove();
          setState((prev) => ({ ...prev, local: without(prev.local) }));
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
    [project.id, project.name, state.list?.projectName, onPhotoQueued, toast, isTaken],
  );

  /** 크게 보기에서 한 장 지우기: 서버 사진은 서버에서, 안 올라간 사본은 대기열에서 뺀다 */
  const deletePhoto = useCallback(
    async (shot: Shot, item: ShotPhotoView): Promise<boolean> => {
      try {
        if (item.onServer && item.photoId) {
          await deleteShotPhoto(project.id, shot.id, item.photoId);
        } else {
          const q = pendingPhotoItems().find((x) => x.target?.shotId === shot.id && (item.photoId ? x.target?.photoId === item.photoId : x.uri === item.localUri));
          if (q && !removeQueuedPhoto(q.id)) {
            toast('지금 올리는 중이에요 · 올라간 뒤 다시 지워 주세요');
            return false;
          }
          setState((prev) => {
            const rest = (prev.local[shot.id] ?? []).filter((e) => (item.photoId ? e.photoId !== item.photoId : e.uri !== item.localUri));
            const local = { ...prev.local };
            if (rest.length > 0) local[shot.id] = rest;
            else delete local[shot.id];
            const next = { ...prev, local };
            writeShotsLocal(project.id, next);
            return next;
          });
          onPhotoQueued?.();
        }
        await refresh();
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [project.id, refresh, toast, onPhotoQueued],
  );

  const makePrimary = useCallback(
    async (shot: Shot, photoId: string): Promise<void> => {
      try {
        await setPrimaryShotPhoto(project.id, shot.id, photoId);
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
    [project.id, refresh, toast],
  );

  /** 예시로 지정(on) 또는 빼기(off) — 같은 시설물 종류의 모든 구조물 같은 칸에 보인다 */
  const setExample = useCallback(
    async (shot: Shot, photoId: string | null): Promise<void> => {
      try {
        if (photoId) await setShotExample(project.id, shot.id, photoId);
        else await removeShotExample(project.id, shot.id);
        toast(photoId ? '예시 사진으로 정했어요 · 다른 구조물에도 보여요' : '예시 사진을 뺐어요');
        await refresh();
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
      }
    },
    [project.id, refresh, toast],
  );

  return { state, setState, error, busyId, refresh, isTaken, photoCount, takenThumb, photoItems, shoot, cameraShotId, closeCamera, commitPhoto, uploadStates, deletePhoto, makePrimary, setExample };
}
