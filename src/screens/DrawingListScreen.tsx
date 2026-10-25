import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Alert,
  BackHandler,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type AlertButton,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  createProject,
  deleteDrawing,
  FACILITY_TYPES,
  fetchDrawings,
  fetchProjects,
  INSPECTION_TYPES,
  shotThumbSource,
  updateProject,
  type Drawing,
  type Project,
} from '../api';
import { IconButton } from '../components/IconButton';
import { LoadingView } from '../components/LoadingView';
import { TypeChips } from '../components/TypeChips';
import { Wordmark } from '../components/Wordmark';
import { nextStructure, photoProgress, recentPhotos, type ShotCache } from '../homeSummary';
import { PreviousShotsView } from './PreviousShotsView';
import { RequiredShotsView } from './RequiredShotsView';
import { readShotsLocal } from '../shotsLocal';
import { colors, font, radius, space, TABLET_MIN_WIDTH, TOUCH_MIN } from '../theme';
import { configProblem } from '../config';
import { readLastLocation, writeLastLocation } from '../lastProject';
import { downloadDrawings } from '../offlineDownload';
import { drawingsToDownload, pendingPushCount, pendingSummary, syncDecision } from '../offlineRules';
import { readIndex, removeDrawing, type OfflineIndex } from '../offlineStore';
import { syncOffline, waitForSync } from '../offlineSync';
import { flushPhotoQueue, PHOTO_FLUSH_INTERVAL_MS, pendingPhotoCount, retryPendingPhotos } from '../photoUpload';
import { listItemsFor, normalizeLocation, parentLocation, type ListItem, type ListLocation } from '../projectList';

// 상태 칩: 글자색 color + 옅은 바탕 bg
const STATUS: Record<Drawing['status'], { label: string; color: string; bg: string }> = {
  pending: { label: '대기', color: '#62646a', bg: '#f2f2f2' },
  inprogress: { label: '변환 중', color: '#1e40af', bg: '#e8f0fe' },
  success: { label: '완료', color: '#15803d', bg: '#e8f6ee' },
  failed: { label: '실패', color: '#c62828', bg: '#fdecec' },
};

// downloadDrawings는 실패한 도면 이름만 돌려주고 사유는 콘솔에만 남긴다 — 사용자에게는 흔한 원인을
// 묶어 알린다(2026-09-28 설계 1.1 `내려받지 못했습니다: <사유>`).
const DOWNLOAD_FAIL_REASON = '서버에 연결할 수 없거나 파일을 받지 못했습니다';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// 서버에 닿지 못할 때(비행기 모드·서버 꺼짐) 쓸 도면 목록. 기기에 내려받은 도면은 인터넷과
// 상관없이 열 수 있어야 하므로(설계 3.3) index.json 항목을 목록 레코드 모양으로 바꿔 보여 준다.
// 내려받은 도면은 항상 변환이 끝난 SVF다(offlineStore의 항목 조건).
function offlineDrawingsOf(index: OfflineIndex): Drawing[] {
  return Object.entries(index.drawings).map(([id, entry]) => ({
    id,
    name: entry.name,
    status: 'success',
    progress: '',
    error: null,
    uploadedAt: entry.downloadedAt,
    projectId: entry.projectId,
    viewFormat: 'svf',
    offlineReady: true,
    frames: entry.frames,
  }));
}

// 프로젝트 하나와 그 아래 모든 하위 프로젝트의 id. 지금 설계는 2단계까지지만 더 깊어져도
// 맞도록 더 늘지 않을 때까지 자식을 모은다.
function subtreeIds(projects: Project[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  for (;;) {
    const before = ids.size;
    for (const project of projects) {
      if (project.parentId !== null && ids.has(project.parentId)) ids.add(project.id);
    }
    if (ids.size === before) return ids;
  }
}

// "이 목록"이 담고 있는 도면 전부 — 줄로 보이는 도면과, 프로젝트 줄 **안쪽**(하위 포함)의
// 도면까지(설계 3.2 "프로젝트(하위 포함, offlineReady인 도면 전부)"). `현장 가기 전 모두 받기`
// 버튼의 N을 이 목록으로 센다.
function scopedDrawings(items: ListItem<Project, Drawing>[], projects: Project[], drawings: Drawing[]): Drawing[] {
  const picked: Drawing[] = [];
  const seen = new Set<string>();
  const add = (drawing: Drawing): void => {
    if (seen.has(drawing.id)) return;
    seen.add(drawing.id);
    picked.push(drawing);
  };
  const known = new Set(projects.map((p) => p.id));
  for (const item of items) {
    if (item.kind === 'drawing') {
      add(item.drawing);
    } else if (item.kind === 'unfiled') {
      for (const drawing of drawings) {
        const pid = drawing.projectId;
        if (typeof pid !== 'string' || !known.has(pid)) add(drawing);
      }
    } else {
      const subtree = subtreeIds(projects, item.project.id);
      for (const drawing of drawings) {
        const pid = drawing.projectId;
        if (typeof pid === 'string' && subtree.has(pid)) add(drawing);
      }
    }
  }
  return picked;
}

// 도면 줄 오른쪽의 상태 하나(2026-09-28 설계 1.2). 기기에 있으면 그것이 가장 중요하다 — 서버에서
// 다시 변환 중이어도 기기 파일로 열린다. 그 밖에는 변환 상태(대기·변환 중·실패)를 먼저 보이고,
// 변환이 끝났으면 받을 수 있는지(SVF)·PC에서 다시 변환해야 하는지(옛 SVF2)를 보인다.
const GRAY = { color: '#62646a', bg: '#f2f2f2' };
function rowChip(drawing: Drawing, downloaded: boolean, canFetch: boolean): { label: string; color: string; bg: string } {
  if (downloaded) return { label: '기기에 있음', color: '#15803d', bg: '#e8f6ee' };
  if (drawing.status !== 'success') return STATUS[drawing.status];
  if (canFetch) return { label: '받기 필요', ...GRAY };
  return { label: 'PC에서 다시 변환 필요', ...GRAY };
}

/** 점검 종류 태그 색: 정기는 파랑, 정밀은 주황 */
function inspectionTag(type: string): { color: string; backgroundColor: string } {
  return type.startsWith('정기')
    ? { color: colors.tagCoolFg, backgroundColor: colors.tagCoolBg }
    : { color: colors.tagWarmFg, backgroundColor: colors.tagWarmBg };
}

function shotCacheOf(projectId: string): ShotCache {
  const local = readShotsLocal(projectId);
  return { list: local.list, local: local.local };
}

interface Props {
  onOpen: (drawing: Drawing) => void;
}

export function DrawingListScreen({ onOpen }: Props) {
  // 노치·상태바·홈 표시줄·가로 모드 모서리를 피하는 여백. 고정값이면 아이폰 노치에 제목이 가린다.
  const insets = useSafeAreaInsets();
  const sidePadding = { paddingLeft: space.lg + insets.left, paddingRight: space.lg + insets.right };
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_MIN_WIDTH;
  const problem = configProblem();
  const [projects, setProjects] = useState<Project[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  // 마지막 위치는 App.tsx가 이 화면을 마운트/언마운트할 때마다(뷰어를 열고 닫을 때) 새로 읽어야
  // 하므로 lazy initialiser로 파일을 동기로 한 번 읽는다(설계 6장).
  const [location, setLocation] = useState<ListLocation>(() => readLastLocation());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState(0);
  // 기기에 내려받은 것들(설계 3.2). 화면이 뜰 때 한 번 동기로 읽고, 내려받기·지우기·동기화
  // 뒤마다 다시 읽는다.
  const [index, setIndex] = useState<OfflineIndex>(() => readIndex());
  const [downloading, setDownloading] = useState<{ done: number; total: number; name: string } | null>(null);
  const [downloadResult, setDownloadResult] = useState<string | null>(null);
  // 기기에 없는 도면을 눌러 받는 중이면 그 이름(배너 `여는 중 — <이름>`, 2026-09-28 설계 1.2).
  const [opening, setOpening] = useState<string | null>(null);
  // 점검 종류·시설물 종류 저장 중이면 칩을 잠근다. 실패하면 이전 값 그대로 두고 오류 배너만.
  const [savingType, setSavingType] = useState(false);
  // 구조물 화면의 탭. location이 바뀌면 되돌린다. 전차 사진이 (기기 저장 기준으로) 하나라도 있으면
  // [전차 사진]부터 — 전차 사진이 있을 때는 그것만 보고 찍어도 된다(설계: 사용자 결정).
  // 전차 사진이 없으면 폰은 [필수 사진], 태블릿은 [도면]부터(2026-10-25: 사진은 폰, 망도 그리기는 태블릿).
  const [tab, setTab] = useState<'drawings' | 'shots' | 'previous'>('drawings');
  useEffect(() => {
    const id = typeof location === 'string' && location !== 'unfiled' ? location : null;
    const hasPrevious = id !== null && (readShotsLocal(id).list?.shots ?? []).some((s) => s.kind === 'previous' && s.trashed !== true);
    setTab(hasPrevious ? 'previous' : isTablet ? 'drawings' : 'shots');
    // isTablet은 일부러 뺀다 — 화면을 돌릴 때마다 탭이 바뀌면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  // 맨 위 과업 목록의 검색
  const [query, setQuery] = useState('');
  const changeProjectType = useCallback(
    async (project: Project, patch: { inspectionType?: string | null; facilityType?: string | null }) => {
      setSavingType(true);
      setError(null);
      try {
        const updated = await updateProject(project.id, patch);
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setSavingType(false);
      }
    },
    [],
  );
  // 내려받는 동안에는 동기화를 돌리지 않는다 — 둘 다 index.json을 고치므로 겹치면 한쪽 갱신이
  // 사라질 수 있다(offlineDownload·offlineSync는 서로의 잠금을 모른다).
  const downloadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // 눌러서 받는 중인 도면. 받는 사이 사용자가 다른 목록으로 옮겨 가면 비운다 — 다 받은 뒤 사용자가
  // 떠난 도면을 억지로 열지 않기 위해서다(Task 1 검토 Major).
  const openIntentRef = useRef<string | null>(null);

  const goTo = useCallback((next: ListLocation) => {
    openIntentRef.current = null;
    setLocation(next);
    writeLastLocation(next);
  }, []);

  const load = useCallback(async () => {
    setPendingPhotos(pendingPhotoCount());
    const deviceIndex = readIndex();
    setIndex(deviceIndex);
    const [projectsResult, drawingsResult] = await Promise.allSettled([fetchProjects(), fetchDrawings()]);
    // 도면 목록을 못 받으면 오류를 보인다. 다만 아직 아무 목록도 못 받은 상태(앱을 껐다 켠
    // 직후 + 비행기 모드)라면 기기에 내려받은 도면만이라도 보여 준다 — 그래야 인터넷 없이
    // 열 수 있다(설계 3.3). 이미 받아 둔 서버 목록이 있으면 그대로 둔다.
    if (drawingsResult.status === 'rejected') {
      setError(errMessage(drawingsResult.reason));
      setDrawings((prev) => (prev.length > 0 ? prev : offlineDrawingsOf(deviceIndex)));
      return;
    }
    // 서버 목록에 없는데 기기에는 있는 도면(서버에서 휴지통으로 간 것)은 기기 항목으로 덧붙여 보인다 —
    // 안 그러면 줄이 사라져 '기기에서 지우기'를 할 수 없고 못 올린 손상 배지만 남는다.
    const serverIds = new Set(drawingsResult.value.map((d) => d.id));
    const deviceOnly = offlineDrawingsOf(deviceIndex).filter((d) => !serverIds.has(d.id));
    setDrawings([...drawingsResult.value, ...deviceOnly]);
    if (projectsResult.status === 'rejected') {
      // 프로젝트만 실패하면 막지 않는다 — 오류 배너를 보이고 도면을 평평한 목록으로 대신 보인다
      // (프로젝트가 하나도 없을 때와 같은 모양).
      setProjects([]);
      setError(errMessage(projectsResult.reason));
      return;
    }
    const nextProjects = projectsResult.value;
    setProjects(nextProjects);
    setError(null);
    // 함수형 갱신으로 최신 location을 받는다 — load는 마운트 시 한 번 만들어져 재사용되므로
    // (onRefresh·confirmDelete의 .then(load)) 클로저에 갇힌 옛 location을 읽으면 안 된다.
    setLocation((prev) => {
      const next = normalizeLocation(nextProjects, prev);
      writeLastLocation(next);
      return next;
    });
  }, []);

  // 과업 화면의 「+ 구조물 추가」
  const [newChildName, setNewChildName] = useState('');
  const [addingChild, setAddingChild] = useState(false);
  const addChild = useCallback(
    async (parent: Project) => {
      const name = newChildName.trim();
      if (!name) return;
      setAddingChild(true);
      setError(null);
      try {
        await createProject(name, parent.id);
        setNewChildName('');
        await load();
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setAddingChild(false);
      }
    },
    [newChildName, load],
  );

  // `서버에 아직 안 올라감` 배지를 눌렀을 때(2026-09-28 설계 1.2): 10번 실패해 멈춘 사진까지
  // 되돌린 뒤 사진과 손상 기록을 바로 한 번 보내고 목록을 새로 고친다. 내려받는 중에는 손상
  // 동기화를 건너뛴다(index.json을 둘이 함께 쓰면 안 된다) — 사진은 index와 상관없어 보낸다.
  const sendNow = useCallback(async () => {
    retryPendingPhotos();
    setPendingPhotos(pendingPhotoCount());
    await flushPhotoQueue(() => undefined);
    if (!mountedRef.current) return;
    setPendingPhotos(pendingPhotoCount());
    if (downloadingRef.current) return;
    await syncOffline();
    if (!mountedRef.current) return;
    await load();
  }, [load]);

  // 사진 대기열과 손상 기록 동기화를 같은 계기에 함께 돌린다(설계 3.5: 화면이 열릴 때·당겨서
  // 새로 고칠 때·60초마다). 뷰어에서 목록으로 돌아오면 App.tsx가 이 화면을 새로 마운트하므로
  // "뷰어를 닫고 돌아올 때"도 화면이 열릴 때와 같은 계기로 걸린다.
  const runBackground = useCallback(async () => {
    if (downloadingRef.current) return;
    await flushPhotoQueue(() => undefined);
    await syncOffline();
    if (!mountedRef.current) return;
    setPendingPhotos(pendingPhotoCount());
    setIndex(readIndex());
  }, []);

  // `현장 가기 전 모두 받기`. 진행 배너 → 결과 문구(설계 5장).
  const runDownload = useCallback(async (targets: Drawing[]) => {
    if (targets.length === 0 || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloadResult(null);
    setDownloading({ done: 0, total: targets.length, name: targets[0].name });
    try {
      // 이미 돌고 있는 동기화가 끝난 뒤에 시작한다 — 둘 다 index.json을 쓴다. 잠금을 먼저 잡았으므로
      // 이 사이에 새 동기화는 시작되지 않는다(runBackground·syncNow가 downloadingRef를 본다).
      await waitForSync();
      const result = await downloadDrawings(targets, (done, total, name) => {
        if (mountedRef.current) setDownloading({ done, total, name });
      });
      if (!mountedRef.current) return;
      setDownloadResult(
        result.failed.length === 0
          ? `내려받았습니다 (${result.ok}장)`
          : `${targets.length}장 중 ${result.failed.length}장 실패 — 다시 시도하세요`,
      );
    } finally {
      downloadingRef.current = false;
      if (mountedRef.current) {
        setDownloading(null);
        setIndex(readIndex());
      }
    }
  }, []);

  // 도면 줄을 눌렀을 때(2026-09-28 설계 1.1). 도면은 언제나 기기 파일로 연다 — 기기에 있으면 바로
  // 열고, 없으면 그 자리에서 내려받은 뒤 연다. runDownload와 같은 잠금(downloadingRef)과
  // waitForSync를 쓴다. 내려받는 중에는 어떤 도면도 열지 않는다 — 뷰어가 열리면 이 화면이 사라져
  // 잠금을 아무도 모르는 채로 내려받기와 뷰어의 동기화가 index.json을 함께 쓰게 된다.
  const openDrawing = useCallback(
    async (drawing: Drawing) => {
      if (downloadingRef.current) return;
      if (readIndex().drawings[drawing.id] !== undefined) {
        onOpen(drawing);
        return;
      }
      // 옛 도면(SVF2)·변환 중·실패 도면은 기기로 받을 수 없어 누를 수 없다(설계 1.1).
      if (drawing.status !== 'success' || drawing.offlineReady !== true) return;
      downloadingRef.current = true;
      setDownloadResult(null);
      setOpening(drawing.name);
      openIntentRef.current = drawing.id;
      let ready = false;
      try {
        await waitForSync();
        const result = await downloadDrawings([drawing], () => undefined);
        const nextIndex = readIndex();
        ready = result.failed.length === 0 && nextIndex.drawings[drawing.id] !== undefined;
        if (mountedRef.current) {
          setIndex(nextIndex);
          if (!ready) setDownloadResult(`내려받지 못했습니다: ${DOWNLOAD_FAIL_REASON}`);
        }
      } catch (err) {
        if (mountedRef.current) setDownloadResult(`내려받지 못했습니다: ${errMessage(err)}`);
      } finally {
        downloadingRef.current = false;
        if (mountedRef.current) setOpening(null);
      }
      // 잠금을 푼 뒤에 연다 — 여는 순간 이 화면은 언마운트된다.
      const stillWanted = openIntentRef.current === drawing.id;
      openIntentRef.current = null;
      if (ready && stillWanted && mountedRef.current) onOpen(drawing);
    },
    [onOpen],
  );

  // 기기에서 지우기(설계 3.2): 도면 폴더와 index 항목만 지운다. 서버 손상 기록·사진은 그대로다.
  const removeFromDevice = useCallback((drawing: Drawing) => {
    removeDrawing(drawing.id);
    setIndex(readIndex());
  }, []);

  // 삭제는 서버 휴지통으로 옮기기다(복구는 PC 업로드 페이지). 현장에서 실수로 누르지 않도록 행을
  // **길게 눌러야** 뜨고, 한 번 더 확인한다. 버튼 순서는 `기기에서 지우기`(기기에 있을 때) ·
  // `휴지통으로 보내기` · `취소`(2026-09-28 설계 1.2).
  const confirmDelete = useCallback(
    (drawing: Drawing) => {
      const entry = index.drawings[drawing.id];
      // 로컬이 서버보다 새것이면 아직 못 올린 손상이 있다 — 기기에서 지우면 그 기록이 사라진다.
      const unsent = entry !== undefined && syncDecision(entry.damagesUpdatedAt, entry.serverUpdatedAt) === 'push';
      const message = `"${drawing.name}"을(를) 삭제할까요?

도면과 그 손상 기록·사진이 서버 휴지통으로 옮겨집니다. PC 업로드 페이지의 휴지통에서 복구할 수 있습니다.${
        unsent ? '\n\n아직 서버에 올리지 못한 손상 기록이 있습니다.' : ''
      }`;
      const buttons: AlertButton[] = [];
      if (entry !== undefined) {
        buttons.push({ text: '기기에서 지우기', onPress: () => removeFromDevice(drawing) });
      }
      buttons.push({
        text: '휴지통으로 보내기',
        style: 'destructive',
        onPress: () => {
          // 실패해도 목록을 다시 읽는다 — 서버가 절반만 처리했을 때 화면이 실제와 어긋나지 않게(2026-10-17).
          deleteDrawing(drawing.id)
            .catch((err: unknown) => setError(errMessage(err)))
            .finally(() => void load());
        },
      });
      buttons.push({ text: '취소', style: 'cancel' });
      Alert.alert('도면 삭제', message, buttons);
    },
    [index, load, removeFromDevice],
  );

  useEffect(() => {
    if (problem) {
      setLoading(false);
      return;
    }
    load().finally(() => setLoading(false));
  }, [load, problem]);

  // 안드로이드 하드웨어 뒤로 버튼도 한 단계 위로 간다. 맨 위(또는 프로젝트가 하나도 없을 때)는
  // 기본 동작(앱 나가기)에 맡긴다.
  useEffect(() => {
    const atTop = projects.length === 0 || location === null;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (atTop) return false;
      goTo(parentLocation(projects, location));
      return true;
    });
    return () => sub.remove();
  }, [projects, location, goTo]);

  // 화면에 머무는 동안 60초마다 사진과 손상 기록을 함께 보낸다(설계 3.5, 사진 대기열과 같은 주기).
  useEffect(() => {
    if (problem) return;
    void runBackground();
    const timer = setInterval(() => void runBackground(), PHOTO_FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [problem, runBackground]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    await runBackground();
    if (mountedRef.current) setRefreshing(false);
  }, [load, runBackground]);

  const items = useMemo<ListItem<Project, Drawing>[]>(
    () => listItemsFor(projects, drawings, location),
    [projects, drawings, location],
  );

  const scoped = useMemo(() => scopedDrawings(items, projects, drawings), [items, projects, drawings]);
  const toDownload = useMemo(
    () => drawingsToDownload(scoped, Object.keys(index.drawings)),
    [scoped, index],
  );
  const pendingDamages = useMemo(
    () =>
      pendingPushCount(
        Object.values(index.drawings).map((entry) => ({
          localUpdatedAt: entry.damagesUpdatedAt,
          serverUpdatedAt: entry.serverUpdatedAt,
        })),
      ),
    [index],
  );
  const pendingBadge = pendingSummary(pendingDamages, pendingPhotos);

  // 맨 위 과업 카드: 구조물들, 사진 진행(기기 저장 기준), 최근 찍은 사진. 위치가 바뀔 때(구조물에서 돌아올 때) 다시 읽는다.
  const home = useMemo(() => {
    const childrenOf = new Map<string, Project[]>();
    for (const p of projects) {
      if (p.parentId === null) continue;
      const list = childrenOf.get(p.parentId) ?? [];
      list.push(p);
      childrenOf.set(p.parentId, list);
    }
    // 기기 파일을 동기로 읽으므로 쓰는 곳에서만: 맨 위(모든 구조물)·과업 화면(그 과업의 구조물)
    const caches: Record<string, ShotCache> = {};
    const here = typeof location === 'string' && location !== 'unfiled' ? projects.find((p) => p.id === location) : undefined;
    if (location === null || here?.depth === 0) {
      for (const p of projects) {
        if (p.depth === 1 && (location === null || p.parentId === location)) caches[p.id] = shotCacheOf(p.id);
      }
    }
    const recent = recentPhotos(
      projects.filter((p) => caches[p.id]).map((p) => ({ projectId: p.id, projectName: p.name, cache: caches[p.id] })),
      10,
    );
    return { childrenOf, caches, recent };
  }, [projects, location]);

  if (problem) {
    return (
      <View style={styles.center}>
        <Text style={styles.problem}>{problem}</Text>
      </View>
    );
  }

  if (loading) {
    return <LoadingView message="목록을 불러오는 중" />;
  }

  const flat = projects.length === 0;
  const atTop = !flat && location === null;
  const showBack = !flat && location !== null;
  const currentProject = !flat && location !== null && location !== 'unfiled' ? projects.find((p) => p.id === location) : undefined;
  const parentProject = currentProject?.parentId ? projects.find((p) => p.id === currentProject.parentId) : undefined;
  const title = flat ? '도면 목록' : location === 'unfiled' ? '미분류' : (currentProject?.name ?? '과업');
  const subtitle =
    currentProject?.depth === 1
      ? [currentProject.facilityType, parentProject?.name].filter(Boolean).join(' · ')
      : currentProject?.depth === 0
        ? (currentProject.inspectionType ?? '점검 종류를 고르세요')
        : null;
  const hasDrawingRow = items.some((item) => item.kind === 'drawing');
  // `현장 가기 전 모두 받기`는 도면이 든 목록(프로젝트 안·미분류·평평한 목록)에만 — 머리글 오른쪽 아이콘(설계 5장).
  const showListDownload = scoped.length > 0 && (flat || location !== null);
  const emptyText = flat
    ? '업로드된 도면이 없습니다.\nPC의 업로드 페이지에서 DWG를 올려주세요.'
    : atTop
      ? '과업이 없습니다.\n웹에서 과업을 등록하면 여기 뜹니다.'
      : '이 프로젝트에는 도면이 없습니다.\nPC의 업로드 페이지에서 올려 주세요.';
  const q = query.trim();
  const visibleItems =
    atTop && q
      ? items.filter(
          (item) =>
            item.kind === 'project' &&
            [item.project.name, ...(home.childrenOf.get(item.project.id) ?? []).map((c) => c.name)].some((n) => n.includes(q)),
        )
      : items;
  const structureTabs = currentProject && currentProject.depth === 1;

  const header = (
    <View style={[styles.header, sidePadding, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.headerRow}>
        {showBack ? (
          <IconButton icon="chevron-left" label="뒤로" onPress={() => goTo(parentLocation(projects, location))} />
        ) : (
          <View style={styles.headerSide} />
        )}
        <View style={styles.headerCenter}>
          {atTop ? (
            <Wordmark size={24} />
          ) : (
            <>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </>
          )}
        </View>
        <View style={styles.headerRight}>
          {showListDownload && (
            <IconButton
              icon={toDownload.length === 0 ? 'check' : 'download'}
              label={toDownload.length === 0 ? '모두 기기에 있음' : `현장 가기 전 모두 받기 (${toDownload.length}장)`}
              badge={toDownload.length}
              disabled={toDownload.length === 0 || downloading !== null || opening !== null}
              onPress={() => void runDownload(toDownload)}
            />
          )}
          {!showListDownload && <View style={styles.headerSide} />}
        </View>
      </View>
      {atTop && (
        <View style={styles.search}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={styles.searchInput}
            placeholder="과업·구조물 검색"
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            accessibilityLabel="과업·구조물 검색"
          />
        </View>
      )}
      {currentProject && currentProject.depth === 0 && (
        <TypeChips
          label="점검 종류"
          options={INSPECTION_TYPES}
          value={currentProject.inspectionType}
          disabled={savingType}
          onChange={(v) => void changeProjectType(currentProject, { inspectionType: v })}
        />
      )}
      {structureTabs && (
        <TypeChips
          label="시설물 종류"
          options={FACILITY_TYPES}
          value={currentProject.facilityType}
          disabled={savingType}
          onChange={(v) => void changeProjectType(currentProject, { facilityType: v })}
        />
      )}
      {structureTabs && (
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              ['shots', '필수 사진'],
              ['previous', '전차 사진'],
              ['drawings', '도면'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  const banners = (
    <>
      {pendingBadge !== null && (
        <Pressable onPress={() => void sendNow()} accessibilityRole="button" style={({ pressed }) => [styles.pendingBanner, pressed && styles.cardPressed]}>
          <Feather name="upload-cloud" size={18} color={colors.tagWarmFg} />
          <Text style={styles.pendingText}>{pendingBadge}</Text>
          <Text style={styles.pendingAction}>지금 보내기</Text>
        </Pressable>
      )}
      {error && <Text style={styles.errorBanner}>{error}</Text>}
      {opening !== null && <Text style={styles.progressBanner}>여는 중 — {opening}</Text>}
      {downloading && (
        <Text style={styles.progressBanner}>
          {downloading.name
            ? `내려받는 중 ${downloading.done + 1}/${downloading.total} — ${downloading.name}`
            : `내려받는 중 ${downloading.total}/${downloading.total}`}
        </Text>
      )}
      {!downloading && opening === null && downloadResult && (
        <Pressable onPress={() => setDownloadResult(null)}>
          <Text style={styles.resultBanner}>{downloadResult}</Text>
        </Pressable>
      )}
    </>
  );

  const renderTaskCard = (project: Project) => {
    const children = home.childrenOf.get(project.id) ?? [];
    const progress = photoProgress(children.map((c) => home.caches[c.id]).filter((c): c is ShotCache => c !== undefined));
    const next = nextStructure(children, home.caches);
    const pct = progress && progress.total > 0 ? Math.round((progress.taken / progress.total) * 100) : 0;
    return (
      // 카드 전체도 눌리지만 화면 읽기는 안쪽 두 버튼을 따로 잡는다(accessible={false})
      <Pressable style={({ pressed }) => [styles.taskCard, pressed && styles.cardPressed]} onPress={() => goTo(project.id)} accessible={false}>
        <View style={styles.taskTop}>
          {project.inspectionType ? (
            <Text style={[styles.tag, inspectionTag(project.inspectionType)]}>{project.inspectionType}</Text>
          ) : (
            <Text style={[styles.tag, styles.tagEmpty]}>점검 종류 미선택</Text>
          )}
          <Text style={styles.meta}>{children.length > 0 ? `구조물 ${children.length}개` : `도면 ${project.totalDrawingCount}`}</Text>
        </View>
        <Text style={styles.taskName}>{project.name}</Text>
        {children.length > 0 && (
          <Text style={styles.meta} numberOfLines={1}>
            {children.map((c) => c.name).join(' · ')}
          </Text>
        )}
        {project.memo ? (
          <Text style={styles.meta} numberOfLines={1}>
            {project.memo}
          </Text>
        ) : null}
        {progress && progress.total > 0 && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progressText}>
              사진 {progress.taken}/{progress.total}
            </Text>
          </View>
        )}
        <View style={styles.taskButtons}>
          <Pressable
            style={({ pressed }) => [styles.outlineButton, pressed && styles.outlineButtonPressed]}
            onPress={() => goTo(project.id)}
            accessibilityRole="button"
            accessibilityLabel={`${project.name} ${children.length > 0 ? '구조물 보기' : '열기'}`}
          >
            <Text style={styles.outlineButtonText}>{children.length > 0 ? '구조물 보기' : '열기'}</Text>
          </Pressable>
          {next !== null && (
            <Pressable
              style={({ pressed }) => [styles.solidButton, pressed && styles.solidButtonPressed]}
              onPress={() => goTo(next)}
              accessibilityRole="button"
              accessibilityLabel={`${project.name} 이어서 찍기`}
            >
              <Text style={styles.solidButtonText}>이어서 찍기</Text>
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  };

  const recentSection =
    atTop && !q && home.recent.length > 0 ? (
      <View style={styles.recent}>
        <Text style={styles.sectionTitle}>최근 찍은 사진</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
          {home.recent.map((r) => {
            const source = r.localUri ? { uri: r.localUri } : shotThumbSource(r.shot);
            return (
              <Pressable key={`${r.projectId}-${r.shot.id}`} style={styles.recentCard} onPress={() => goTo(r.projectId)} accessibilityRole="button">
                <View style={styles.recentThumb}>{source ? <Image source={source} style={styles.fill} resizeMode="cover" /> : null}</View>
                <View style={styles.recentText}>
                  <Text style={styles.recentTitle} numberOfLines={1}>
                    {r.shot.member} · {r.shot.label}
                  </Text>
                  <Text style={styles.recentSub} numberOfLines={1}>
                    {r.projectName} · {r.shot.number}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      {header}
      <View style={[styles.body, sidePadding, { paddingBottom: insets.bottom }]}>
        {banners}
        {currentProject && currentProject.depth === 0 && (
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              placeholder="구조물 이름 (예: A교)"
              placeholderTextColor={colors.mutedForeground}
              value={newChildName}
              onChangeText={setNewChildName}
              editable={!addingChild}
              returnKeyType="done"
              onSubmitEditing={() => void addChild(currentProject)}
            />
            <Pressable
              style={({ pressed }) => [styles.solidButton, styles.addButton, (!newChildName.trim() || addingChild) && styles.buttonOff, pressed && styles.solidButtonPressed]}
              disabled={!newChildName.trim() || addingChild}
              onPress={() => void addChild(currentProject)}
            >
              <Text style={styles.solidButtonText}>+ 구조물 추가</Text>
            </Pressable>
          </View>
        )}
        {tab === 'drawings' || !structureTabs ? (
          <FlatList
            data={visibleItems}
            keyExtractor={(item) =>
              item.kind === 'project' ? `project-${item.project.id}` : item.kind === 'unfiled' ? 'unfiled' : `drawing-${item.drawing.id}`
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={
              atTop ? (
                <Text style={styles.sectionTitle}>진행 중인 과업</Text>
              ) : hasDrawingRow ? (
                <Text style={styles.hint}>도면을 길게 누르면 휴지통으로 보내거나 기기에서 지울 수 있습니다.</Text>
              ) : null
            }
            ListFooterComponent={recentSection}
            ListEmptyComponent={<Text style={styles.empty}>{q ? '찾는 과업이 없습니다.' : emptyText}</Text>}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.kind === 'project') {
                const project = item.project;
                if (atTop) return renderTaskCard(project);
                const cache = home.caches[project.id];
                const progress = cache ? photoProgress([cache]) : null;
                const meta = [
                  project.facilityType,
                  progress && progress.total > 0 ? `사진 ${progress.taken}/${progress.total}` : null,
                  `도면 ${project.totalDrawingCount}`,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <Pressable style={({ pressed }) => [styles.row, pressed && styles.cardPressed]} onPress={() => goTo(project.id)}>
                    <View style={styles.rowText}>
                      <Text style={styles.name}>{project.name}</Text>
                      <Text style={styles.meta}>{meta}</Text>
                      {project.memo ? (
                        <Text style={styles.meta} numberOfLines={1}>
                          {project.memo}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={22} color="#b5b6ba" />
                  </Pressable>
                );
              }
              if (item.kind === 'unfiled') {
                return (
                  <Pressable style={({ pressed }) => [styles.row, pressed && styles.cardPressed]} onPress={() => goTo('unfiled')}>
                    <View style={styles.rowText}>
                      <Text style={styles.name}>미분류</Text>
                      <Text style={styles.meta}>도면 {item.count}</Text>
                    </View>
                    <Feather name="chevron-right" size={22} color="#b5b6ba" />
                  </Pressable>
                );
              }
              const drawing = item.drawing;
              const downloaded = index.drawings[drawing.id] !== undefined;
              // 누르면 열리는 도면: 기기에 있거나, 눌렀을 때 받을 수 있는(변환이 끝난 SVF) 도면
              // (2026-09-28 설계 1.1). 옛 도면(SVF2)·변환 중·실패 도면은 누를 수 없다.
              const canFetch = drawing.status === 'success' && drawing.offlineReady === true;
              const openable = downloaded || canFetch;
              const chip = rowChip(drawing, downloaded, canFetch);
              const syncError = index.drawings[drawing.id]?.syncError ?? null;
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, !openable && styles.rowDisabled, pressed && openable && styles.cardPressed]}
                  // disabled로 막으면 길게 누르기도 죽는다 — 변환 실패·대기 중인 도면도 지울 수 있어야 한다.
                  onPress={() => {
                    if (openable) void openDrawing(drawing);
                  }}
                  onLongPress={() => confirmDelete(drawing)}
                  delayLongPress={600}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{drawing.name}</Text>
                    <Text style={styles.meta}>
                      {new Date(drawing.uploadedAt).toLocaleString('ko-KR')}
                      {drawing.progress ? ` · ${drawing.progress}` : ''}
                    </Text>
                    {drawing.error && <Text style={styles.rowError}>{drawing.error}</Text>}
                    {syncError && <Text style={styles.rowError}>서버가 손상 기록을 받지 않았습니다: {syncError}</Text>}
                  </View>
                  <Text style={[styles.badge, { color: chip.color, backgroundColor: chip.bg }]}>{chip.label}</Text>
                </Pressable>
              );
            }}
          />
        ) : null}
        {tab === 'shots' && structureTabs && (
          <RequiredShotsView key={currentProject.id} project={currentProject} onPhotoQueued={() => setPendingPhotos(pendingPhotoCount())} />
        )}
        {tab === 'previous' && structureTabs && (
          <PreviousShotsView key={currentProject.id} project={currentProject} onPhotoQueued={() => setPendingPhotos(pendingPhotoCount())} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, backgroundColor: colors.background },
  problem: { fontFamily: font.regular, fontSize: 16, color: colors.destructive, textAlign: 'center', lineHeight: 24 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // 머리글(흰 바탕): [뒤로] 제목 [대기열·모두 받기] / 검색·칩·탭
  header: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, gap: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_MIN + 4, gap: space.sm },
  headerSide: { width: TOUCH_MIN, height: TOUCH_MIN },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight: { flexDirection: 'row', gap: space.sm, minWidth: TOUCH_MIN, justifyContent: 'flex-end' },
  title: { fontFamily: font.bold, fontSize: 20, color: colors.foreground },
  subtitle: { fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginTop: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH_MIN,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    marginBottom: space.md,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.foreground, paddingVertical: space.sm },
  tabs: { flexDirection: 'row', marginTop: -space.xs },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontFamily: font.regular, fontSize: 15, color: colors.mutedForeground },
  tabTextActive: { fontFamily: font.bold, color: colors.foreground },
  body: { flex: 1, paddingTop: space.lg },
  listContent: { paddingBottom: space.xxl },
  sectionTitle: { fontFamily: font.bold, fontSize: 20, color: colors.foreground, marginBottom: space.md },
  // 알림 줄
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH_MIN,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.tagWarmBg,
    marginBottom: space.md,
  },
  pendingText: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.tagWarmFg },
  pendingAction: { fontFamily: font.bold, fontSize: 14, color: colors.tagWarmFg, textDecorationLine: 'underline' },
  errorBanner: { fontFamily: font.semibold, fontSize: 14, color: colors.destructive, backgroundColor: colors.destructiveSoft, padding: space.md, borderRadius: radius.md, marginBottom: space.md, overflow: 'hidden' },
  progressBanner: { fontFamily: font.semibold, fontSize: 14, color: colors.onPrimary, backgroundColor: colors.primary, padding: space.md, borderRadius: radius.md, marginBottom: space.md, overflow: 'hidden' },
  resultBanner: {
    fontFamily: font.semibold,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    borderRadius: radius.md,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginBottom: space.sm },
  empty: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', color: colors.mutedForeground, marginTop: 48, lineHeight: 23 },
  // 과업 카드(맨 위)
  taskCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space.lg, gap: space.sm, marginBottom: space.md },
  cardPressed: { backgroundColor: colors.muted },
  taskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { fontFamily: font.bold, fontSize: 12, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  tagEmpty: { color: colors.mutedForeground, backgroundColor: colors.muted },
  taskName: { fontFamily: font.bold, fontSize: 18, lineHeight: 24, color: colors.foreground, marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.xs },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  progressText: { fontFamily: font.bold, fontSize: 13, color: colors.foreground },
  taskButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  outlineButton: { flex: 1, minHeight: TOUCH_MIN, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  outlineButtonPressed: { backgroundColor: colors.muted },
  outlineButtonText: { fontFamily: font.bold, fontSize: 15, color: colors.foreground },
  solidButton: { flex: 1, minHeight: TOUCH_MIN, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  solidButtonPressed: { backgroundColor: colors.primaryPressed },
  solidButtonText: { fontFamily: font.bold, fontSize: 15, color: colors.onPrimary },
  buttonOff: { opacity: 0.35 },
  // 최근 찍은 사진
  recent: { marginTop: space.lg },
  recentRow: { gap: 10 },
  recentCard: { width: 132, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  recentThumb: { height: 96, backgroundColor: colors.muted },
  recentText: { paddingHorizontal: 10, paddingTop: space.sm, paddingBottom: 10, gap: 2 },
  recentTitle: { fontFamily: font.bold, fontSize: 14, color: colors.foreground },
  recentSub: { fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground },
  // 줄(구조물·도면·미분류)
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    marginBottom: space.sm,
  },
  rowDisabled: { opacity: 0.55 },
  rowText: { flex: 1, marginRight: space.md, gap: 3 },
  name: { fontFamily: font.bold, fontSize: 17, color: colors.foreground },
  meta: { fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground },
  rowError: { fontFamily: font.regular, fontSize: 13, color: colors.destructive, marginTop: 2 },
  badge: { fontFamily: font.bold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden' },
  // 과업 화면 「+ 구조물 추가」
  addRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  addInput: {
    flex: 1,
    minHeight: TOUCH_MIN,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.foreground,
  },
  addButton: { flex: 0, paddingHorizontal: space.lg },
});
