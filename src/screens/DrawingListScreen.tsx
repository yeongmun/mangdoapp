import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Feather } from '@expo/vector-icons';
import {
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
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
import { BottomSheet } from '../components/BottomSheet';
import { IconButton } from '../components/IconButton';
import { NearbyCard } from '../components/NearbyCard';
import { flushStructureLocations } from '../structureLocation';
import { AnimatedBar, FadeSlideIn, PressScale, Skeleton, ZoomImage } from '../components/motion';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { useToast } from '../components/Toast';
import { TypeChips } from '../components/TypeChips';
import { Wordmark } from '../components/Wordmark';
import { nextShot, nextStructure, photoProgress, recentPhotos, taskTypeOf, taskTypeOptions, UNSET_TASK_TYPE, type ShotCache } from '../homeSummary';
import { PreviousShotsView } from './PreviousShotsView';
import { RequiredShotsView } from './RequiredShotsView';
import { FacilityInfoSheet } from '../components/FacilityInfoSheet';
import { infoSummary, type FacilityInfo } from '../facilityInfo';
import { readShotsLocal } from '../shotsLocal';
import { readHiddenProjects, writeHiddenProjects } from '../hiddenProjects';
import { colors, font, radius, space, TABLET_MIN_WIDTH, TOUCH_MIN } from '../theme';
import { configProblem } from '../config';
import { readLastLocation, writeLastLocation } from '../lastProject';
import { downloadBusy, downloadDrawings } from '../offlineDownload';
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

function shotCacheOf(projectId: string): ShotCache {
  const local = readShotsLocal(projectId);
  return { list: local.list, local: local.local };
}

/** 지금 보고 있는 목록의 종류 — App이 하단 메뉴를 보일지 정한다(구조물 화면은 아래에 「다음 사진 찍기」가 있어 숨긴다) */
export type ListKind = 'top' | 'task' | 'structure' | 'other';

interface Props {
  onOpen: (drawing: Drawing) => void;
  /** 하단 메뉴가 아래에 붙어 있으면 바닥 안전 여백은 메뉴가 맡는다 */
  withTabBar?: boolean;
  onKindChange?: (kind: ListKind) => void;
  /** 안 올라간 사진+손상 수(하단 메뉴 배지) */
  onPendingChange?: (count: number) => void;
  /** 「찍은 사진」 탭에서 사진을 누르면 그 구조물로(nonce가 바뀔 때마다) */
  navRequest?: { projectId: string; nonce: number } | null;
  /** 하단 메뉴에서 이 화면(과업)을 보고 있는지 — 아니면 안드로이드 뒤로 버튼을 App에 넘긴다 */
  active?: boolean;
}

const TABS = [
  ['shots', '필수 사진'],
  ['previous', '전차 사진'],
  ['drawings', '도면'],
] as const;
type StructureTab = (typeof TABS)[number][0];

/** 과업 줄 왼쪽 네모 아이콘(과업구분 앞 두 글자) */
function taskIcon(type: string | null): { short: string; color: string; backgroundColor: string } {
  if (type === null) return { short: '–', color: colors.subtle, backgroundColor: colors.muted };
  if (type.startsWith('정기')) return { short: '정기', color: colors.tagCoolFg, backgroundColor: colors.tagCoolBg };
  if (type.startsWith('옹벽')) return { short: '옹벽', color: colors.tagPurpleFg, backgroundColor: colors.tagPurpleBg };
  if (type.endsWith('진단')) return { short: '진단', color: colors.tagOrangeFg, backgroundColor: colors.tagOrangeBg };
  return { short: '정밀', color: colors.tagWarmFg, backgroundColor: colors.tagWarmBg };
}

export function DrawingListScreen({ onOpen, withTabBar = false, onKindChange, onPendingChange, navRequest = null, active = true }: Props) {
  const toast = useToast();
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
  const [tab, setTab] = useState<StructureTab>('drawings');
  // 홈 「카메라 열기」로 들어간 구조물 — 그 화면의 사진 탭이 목록을 받자마자 다음 사진 카메라를 연다
  const [autoShootFor, setAutoShootFor] = useState<string | null>(null);
  const autoShootRef = useRef<string | null>(null);
  autoShootRef.current = autoShootFor;
  // 탭 바꿀 때 내용이 어느 쪽에서 들어올지(오른쪽 탭으로 가면 오른쪽에서)
  const tabDirection = useRef<1 | -1>(1);
  const changeTab = useCallback(
    (next: StructureTab) => {
      const order = TABS.map(([k]) => k);
      tabDirection.current = order.indexOf(next) >= order.indexOf(tab) ? 1 : -1;
      // 직접 탭을 바꾸면 「카메라 열기」는 끝 — 탭을 오갈 때 카메라가 다시 저절로 열리지 않게
      setAutoShootFor(null);
      setTab(next);
    },
    [tab],
  );
  useEffect(() => {
    const id = typeof location === 'string' && location !== 'unfiled' ? location : null;
    const hasPrevious = id !== null && (readShotsLocal(id).list?.shots ?? []).some((s) => s.kind === 'previous' && s.trashed !== true);
    const forShooting = id !== null && autoShootRef.current === id;
    setTab(hasPrevious ? 'previous' : isTablet && !forShooting ? 'drawings' : 'shots');
    if (!forShooting) setAutoShootFor(null);
    // isTablet은 일부러 뺀다 — 화면을 돌릴 때마다 탭이 바뀌면 안 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  // 아래 시트(Alert 대신): 구조물 추가 / 시설물 종류 고르기 / 과업 숨기기
  const [sheet, setSheet] = useState<null | { kind: 'addChild' } | { kind: 'facility' } | { kind: 'info' } | { kind: 'hide'; project: Project }>(null);
  // 맨 위 과업 목록의 검색
  const [query, setQuery] = useState('');
  // 맨 위 과업 목록의 과업구분 필터(웹 과업구분, 없으면 점검 종류). null = 전체
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  // 이 기기에서 숨긴 과업(지우지 않는다 — 원본은 웹). 기기 파일에 저장해 껐다 켜도 그대로
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set(readHiddenProjects()));
  const [showHidden, setShowHidden] = useState(false);
  const setProjectHidden = useCallback((id: string, hidden: boolean) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (hidden) next.add(id);
      else next.delete(id);
      writeHiddenProjects([...next]);
      return next;
    });
  }, []);
  const changeProjectType = useCallback(
    async (project: Project, patch: { inspectionType?: string | null; facilityType?: string | null; facilityInfo?: FacilityInfo | null }) => {
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
    // 오프라인에서 찍어 기기에만 적힌 구조물 위치를 서버로
    void flushStructureLocations();
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
        setSheet(null);
        toast(`${name}을(를) 추가했어요`);
        await load();
      } catch (e) {
        setError(errMessage(e));
        setSheet(null);
      } finally {
        setAddingChild(false);
      }
    },
    [newChildName, load, toast],
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
    downloadBusy.current = true;
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
      downloadBusy.current = false;
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
      // 다른 하단 메뉴를 보고 있으면 App이 맡는다(과업 탭으로 돌아가기)
      if (!active || atTop) return false;
      goTo(parentLocation(projects, location));
      return true;
    });
    return () => sub.remove();
  }, [projects, location, goTo, active]);

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

  // App에 지금 화면 종류·안 올라간 수·「찍은 사진」 탭에서 온 이동 요청을 주고받는다
  const here = typeof location === 'string' && location !== 'unfiled' ? projects.find((p) => p.id === location) : undefined;
  const kind: ListKind = projects.length === 0 ? 'other' : location === null ? 'top' : here?.depth === 0 ? 'task' : here?.depth === 1 ? 'structure' : 'other';
  useEffect(() => {
    onKindChange?.(kind);
  }, [kind, onKindChange]);
  useEffect(() => {
    onPendingChange?.(pendingDamages + pendingPhotos);
  }, [pendingDamages, pendingPhotos, onPendingChange]);
  const navNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!navRequest || navRequest.nonce === navNonce.current) return;
    navNonce.current = navRequest.nonce;
    goTo(navRequest.projectId);
  }, [navRequest, goTo]);

  const [searchOpen, setSearchOpen] = useState(false);

  if (problem) {
    return (
      <View style={styles.center}>
        <Text style={styles.problem}>{problem}</Text>
      </View>
    );
  }

  const flat = projects.length === 0;
  const atTop = !flat && location === null;
  const showBack = !flat && location !== null;
  const currentProject = here;
  const parentProject = currentProject?.parentId ? projects.find((p) => p.id === currentProject.parentId) : undefined;
  const title = flat ? '도면 목록' : location === 'unfiled' ? '미분류' : (currentProject?.name ?? '과업');
  const hasDrawingRow = items.some((item) => item.kind === 'drawing');
  // `현장 가기 전 모두 받기`는 도면이 든 목록(프로젝트 안·미분류·평평한 목록)에만 — 머리글 오른쪽 아이콘(설계 5장).
  const showListDownload = scoped.length > 0 && (flat || location !== null);
  const structureTabs = currentProject?.depth === 1 ? currentProject : undefined;
  const emptyText = flat
    ? '업로드된 도면이 없습니다.\nPC의 업로드 페이지에서 DWG를 올려주세요.'
    : atTop
      ? '과업이 없습니다.\n웹에서 과업을 등록하면 여기 뜹니다.'
      : '이 프로젝트에는 도면이 없습니다.\nPC의 업로드 페이지에서 올려 주세요.';

  // 맨 위: 숨긴 과업은 빼고(「숨긴 과업 보기」면 숨긴 것만), 과업구분·검색으로 거른다
  const q = query.trim();
  const topProjects = projects.filter((p) => p.depth === 0);
  const hiddenCount = topProjects.filter((p) => hiddenIds.has(p.id)).length;
  const viewingHidden = atTop && showHidden && hiddenCount > 0;
  const pool = topProjects.filter((p) => hiddenIds.has(p.id) === viewingHidden);
  const filterOptions = atTop ? taskTypeOptions(pool) : [];
  const activeFilter = taskFilter !== null && filterOptions.includes(taskFilter) ? taskFilter : null;
  const visibleItems = atTop
    ? items.filter((item) => {
        if (item.kind !== 'project') return !viewingHidden && !q && !activeFilter;
        if (hiddenIds.has(item.project.id) !== viewingHidden) return false;
        if (activeFilter !== null && (taskTypeOf(item.project) ?? UNSET_TASK_TYPE) !== activeFilter) return false;
        return !q || [item.project.name, ...(home.childrenOf.get(item.project.id) ?? []).map((c) => c.name)].some((n) => n.includes(q));
      })
    : items;

  // 홈 큰 한 줄(남은 사진)과 「이어서 찍기」 카드 — 숨기지 않은 과업, 이 기기에 받아 둔 목록 기준
  let remaining = 0;
  let known = false;
  let hero: { structure: Project; task: Project; label: string } | null = null;
  if (atTop) {
    for (const task of topProjects.filter((p) => !hiddenIds.has(p.id))) {
      const children = home.childrenOf.get(task.id) ?? [];
      const progress = photoProgress(children.map((c) => home.caches[c.id]).filter((c): c is ShotCache => c !== undefined));
      if (progress) {
        known = true;
        remaining += progress.total - progress.taken;
      }
      if (hero === null && progress && progress.taken < progress.total) {
        const sid = nextStructure(children, home.caches);
        const structure = children.find((c) => c.id === sid);
        if (structure) {
          const cache = home.caches[structure.id];
          const shot = cache && cache.list ? nextShot(cache) : null;
          hero = { structure, task, label: shot ? `${structure.name} · ${shot.member} ${shot.label}` : `${structure.name}부터` };
        }
      }
    }
  }
  const heroPhoto = home.recent[0] ? (home.recent[0].localUri ? { uri: home.recent[0].localUri } : shotThumbSource(home.recent[0].shot)) : null;

  const subtitle =
    currentProject?.depth === 1
      ? parentProject?.name ?? ''
      : currentProject?.depth === 0
        ? (taskTypeOf(currentProject) ?? '점검 종류를 고르세요')
        : null;

  const header = (
    <View style={[styles.header, sidePadding, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.headerRow}>
        {showBack ? <IconButton icon="chevron-left" label="뒤로" onPress={() => goTo(parentLocation(projects, location))} /> : null}
        <View style={[styles.headerCenter, !showBack && styles.headerLeft]}>
          {atTop || (flat && !showBack) ? (
            <Wordmark size={22} />
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
          {atTop && <IconButton icon={searchOpen ? 'x' : 'search'} label={searchOpen ? '검색 닫기' : '과업 검색'} onPress={() => { setSearchOpen((v) => !v); if (searchOpen) setQuery(''); }} />}
          {showListDownload && (
            <IconButton
              icon={toDownload.length === 0 ? 'check' : 'download'}
              label={toDownload.length === 0 ? '모두 기기에 있음' : `현장 가기 전 모두 받기 (${toDownload.length}장)`}
              badge={toDownload.length}
              disabled={toDownload.length === 0 || downloading !== null || opening !== null}
              onPress={() => void runDownload(toDownload)}
            />
          )}
          {showBack && !showListDownload && <View style={styles.headerSide} />}
        </View>
      </View>
    </View>
  );

  const banners = (
    <>
      {pendingBadge !== null && (
        <PressScale
          onPress={() => {
            toast('지금 보내는 중이에요');
            void sendNow();
          }}
          accessibilityRole="button"
          to={0.98}
          style={styles.pendingBanner}
        >
          <Feather name="upload-cloud" size={18} color={colors.tagOrangeFg} />
          <Text style={styles.pendingText}>{pendingBadge}</Text>
          <Text style={styles.pendingAction}>지금 보내기</Text>
        </PressScale>
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

  const homeHeader = atTop ? (
    <View>
      {searchOpen && (
        <View style={styles.search}>
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            style={styles.searchInput}
            placeholder="과업·구조물 검색"
            placeholderTextColor={colors.subtle}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="과업·구조물 검색"
          />
        </View>
      )}
      {!viewingHidden && !q && (
        <View style={styles.statement}>
          <Text style={styles.statementSub}>진행 중인 현장</Text>
          <Text style={styles.statementBig}>
            {known ? (
              remaining > 0 ? (
                <>
                  사진 <Text style={styles.statementBlue}>{remaining}장</Text> 남았어요
                </>
              ) : (
                '남은 사진이 없어요'
              )
            ) : (
              '구조물을 열면 남은 사진을 세어 드려요'
            )}
          </Text>
        </View>
      )}
      {!viewingHidden && !q && (
        <NearbyCard
          projects={projects}
          active={active && atTop}
          onOpen={goTo}
          onShoot={(id) => {
            setAutoShootFor(id);
            goTo(id);
          }}
        />
      )}
      {!viewingHidden && !q && hero !== null && (
        <PressScale
          to={0.98}
          // 카드 전체를 한 덩어리로 묶지 않는다 — 화면 읽기가 안쪽 「카메라 열기」에도 닿게
          accessible={false}
          onPress={() => goTo(hero!.structure.id)}
          style={styles.heroCard}
        >
          <View style={styles.heroPhoto}>
            {heroPhoto ? <ZoomImage source={heroPhoto} style={StyleSheet.absoluteFill} /> : <Feather name="image" size={36} color="rgba(255,255,255,0.75)" />}
            <Text style={styles.heroChip}>{hero.task.name}</Text>
          </View>
          <View style={styles.heroBody}>
            <View style={{ flex: 1 }} accessible accessibilityRole="button" accessibilityLabel={`이어서 찍기, 다음은 ${hero.label}`} onAccessibilityTap={() => goTo(hero!.structure.id)}>
              <Text style={styles.heroTitle}>이어서 찍기</Text>
              <Text style={styles.heroSub} numberOfLines={1}>
                다음은 {hero.label}
              </Text>
            </View>
          </View>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={`카메라 열기, ${hero.label}`}
            onPress={() => {
              setAutoShootFor(hero!.structure.id);
              goTo(hero!.structure.id);
            }}
            style={styles.heroButton}
          >
            <Feather name="camera" size={19} color={colors.onPrimary} />
            <Text style={styles.heroButtonText}>카메라 열기</Text>
          </PressScale>
        </PressScale>
      )}
      {filterOptions.length > 0 && (
        <TypeChips label="과업구분" options={filterOptions} value={activeFilter ?? undefined} onChange={setTaskFilter} />
      )}
      <View style={[styles.groupTop, visibleItems.length === 0 && styles.groupAlone]}>
        <Text style={styles.groupTitle}>{viewingHidden ? '숨긴 과업' : '진행 중인 과업'}</Text>
        <Text style={styles.groupCount}>{visibleItems.filter((i) => i.kind === 'project').length}개</Text>
      </View>
    </View>
  ) : null;

  const groupRowStyle = (i: number, n: number) => [styles.groupRow, i === n - 1 && styles.groupBottom];

  const renderTaskRow = (project: Project, i: number, n: number) => {
    const children = home.childrenOf.get(project.id) ?? [];
    const progress = photoProgress(children.map((c) => home.caches[c.id]).filter((c): c is ShotCache => c !== undefined));
    const ratio = progress && progress.total > 0 ? progress.taken / progress.total : 0;
    const done = progress !== null && progress.total > 0 && progress.taken === progress.total;
    const icon = taskIcon(taskTypeOf(project));
    const hidden = hiddenIds.has(project.id);
    return (
      <View style={groupRowStyle(i, n)}>
        <PressScale to={0.98} style={styles.taskRow} onPress={() => goTo(project.id)} accessibilityRole="button" accessibilityLabel={`${project.name} 열기`}>
          <Text style={[styles.taskIcon, { color: icon.color, backgroundColor: icon.backgroundColor }]}>{icon.short}</Text>
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {project.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {children.length > 0 ? `구조물 ${children.length}` : `도면 ${project.totalDrawingCount}`}
              {progress && progress.total > 0 ? ` · 사진 ${progress.taken}/${progress.total}` : ''}
            </Text>
          </View>
          {progress && progress.total > 0 ? (
            <View style={styles.pctBox}>
              <Text style={[styles.pct, done && styles.pctDone]}>{done ? '완료' : `${Math.round(ratio * 100)}%`}</Text>
              <View style={{ width: 56 }}>
                <AnimatedBar ratio={ratio} height={4} />
              </View>
            </View>
          ) : null}
        </PressScale>
        <Pressable
          onPress={() => setSheet({ kind: 'hide', project })}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${project.name} ${hidden ? '다시 보이기' : '숨기기'}`}
          style={({ pressed }) => [styles.moreButton, pressed && { backgroundColor: colors.muted }]}
        >
          <Feather name={hidden ? 'eye' : 'more-vertical'} size={18} color={colors.subtle} />
        </Pressable>
      </View>
    );
  };

  const renderStructureRow = (project: Project, i: number, n: number) => {
    const cache = home.caches[project.id];
    const progress = cache ? photoProgress([cache]) : null;
    const meta = [project.facilityType ?? '시설물 종류 미선택', progress && progress.total > 0 ? `사진 ${progress.taken}/${progress.total}` : null, `도면 ${project.totalDrawingCount}`]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={groupRowStyle(i, n)}>
        <PressScale to={0.98} style={styles.taskRow} onPress={() => goTo(project.id)} accessibilityRole="button">
          <View style={[styles.taskIconBox, { backgroundColor: colors.primarySoft }]}>
            <Feather name="map-pin" size={18} color={colors.primaryText} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.name}>{project.name}</Text>
            <Text style={styles.meta}>{meta}</Text>
          </View>
          <Feather name="chevron-right" size={22} color={colors.borderStrong} />
        </PressScale>
      </View>
    );
  };

  const renderDrawingRow = (drawing: Drawing, i: number, n: number) => {
    const downloaded = index.drawings[drawing.id] !== undefined;
    // 누르면 열리는 도면: 기기에 있거나, 눌렀을 때 받을 수 있는(변환이 끝난 SVF) 도면
    // (2026-09-28 설계 1.1). 옛 도면(SVF2)·변환 중·실패 도면은 누를 수 없다.
    const canFetch = drawing.status === 'success' && drawing.offlineReady === true;
    const openable = downloaded || canFetch;
    const chip = rowChip(drawing, downloaded, canFetch);
    const syncError = index.drawings[drawing.id]?.syncError ?? null;
    return (
      <View style={groupRowStyle(i, n)}>
        <PressScale
          to={0.98}
          style={[styles.taskRow, !openable && styles.rowDisabled]}
          // disabled로 막으면 길게 누르기도 죽는다 — 변환 실패·대기 중인 도면도 지울 수 있어야 한다.
          onPress={() => {
            if (openable) void openDrawing(drawing);
          }}
          onLongPress={() => confirmDelete(drawing)}
          delayLongPress={600}
          accessibilityRole="button"
        >
          <View style={[styles.taskIconBox, { backgroundColor: colors.muted }]}>
            <Feather name="file-text" size={18} color={colors.ink2} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.name}>{drawing.name}</Text>
            <Text style={styles.meta}>
              {new Date(drawing.uploadedAt).toLocaleDateString('ko-KR')}
              {drawing.progress ? ` · ${drawing.progress}` : ''}
            </Text>
            {drawing.error && <Text style={styles.rowError}>{drawing.error}</Text>}
            {syncError && <Text style={styles.rowError}>서버가 손상 기록을 받지 않았습니다: {syncError}</Text>}
          </View>
          <Text style={[styles.badge, { color: chip.color, backgroundColor: chip.bg }]}>{chip.label}</Text>
        </PressScale>
      </View>
    );
  };

  const listHeader = atTop ? (
    homeHeader
  ) : (
    <View>
      {currentProject?.depth === 0 && (
        <TypeChips
          label="점검 종류"
          options={INSPECTION_TYPES}
          value={currentProject.inspectionType}
          disabled={savingType}
          onChange={(v) => void changeProjectType(currentProject, { inspectionType: v })}
        />
      )}
      {currentProject?.depth === 0 && (
        <PressScale to={0.98} onPress={() => setSheet({ kind: 'addChild' })} accessibilityRole="button" style={styles.addRow}>
          <View style={[styles.taskIconBox, { backgroundColor: colors.primarySoft }]}>
            <Feather name="plus" size={20} color={colors.primaryText} />
          </View>
          <Text style={styles.addText}>구조물 추가</Text>
        </PressScale>
      )}
      {items.length > 0 && (
        <View style={styles.groupTop}>
          <Text style={styles.groupTitle}>{currentProject?.depth === 0 ? '구조물' : '도면'}</Text>
          <Text style={styles.groupCount}>{items.length}개</Text>
        </View>
      )}
      {hasDrawingRow && <Text style={styles.hint}>도면을 길게 누르면 휴지통으로 보내거나 기기에서 지울 수 있습니다.</Text>}
    </View>
  );

  const listFooter = atTop && hiddenCount > 0 ? (
    <Pressable onPress={() => setShowHidden((v) => !v)} style={({ pressed }) => [styles.hiddenToggle, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <Feather name={viewingHidden ? 'arrow-left' : 'eye-off'} size={16} color={colors.mutedForeground} />
      <Text style={styles.hiddenToggleText}>{viewingHidden ? '과업 목록으로' : `숨긴 과업 ${hiddenCount}개 보기`}</Text>
    </Pressable>
  ) : undefined;

  const list = (
    <FlatList
      data={visibleItems}
      keyExtractor={(item) => (item.kind === 'project' ? `project-${item.project.id}` : item.kind === 'unfiled' ? 'unfiled' : `drawing-${item.drawing.id}`)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={listHeader ?? undefined}
      ListFooterComponent={listFooter}
      ListEmptyComponent={<Text style={styles.empty}>{q || activeFilter ? '찾는 과업이 없습니다.' : emptyText}</Text>}
      contentContainerStyle={styles.listContent}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item, index: i }) => {
        const n = visibleItems.length;
        if (item.kind === 'project') return atTop ? renderTaskRow(item.project, i, n) : renderStructureRow(item.project, i, n);
        if (item.kind === 'unfiled') {
          return (
            <View style={groupRowStyle(i, n)}>
              <PressScale to={0.98} style={styles.taskRow} onPress={() => goTo('unfiled')} accessibilityRole="button">
                <Text style={[styles.taskIcon, { color: colors.subtle, backgroundColor: colors.muted }]}>–</Text>
                <View style={styles.rowText}>
                  <Text style={styles.name}>미분류</Text>
                  <Text style={styles.meta}>도면 {item.count}</Text>
                </View>
                <Feather name="chevron-right" size={22} color={colors.borderStrong} />
              </PressScale>
            </View>
          );
        }
        return renderDrawingRow(item.drawing, i, n);
      }}
    />
  );

  const body = loading ? (
    <View style={{ gap: space.md }}>
      <Skeleton style={{ height: 30, width: '60%' }} />
      <Skeleton style={{ height: 220, borderRadius: 24 }} />
      <Skeleton style={{ height: 72, borderRadius: 20 }} />
      <Skeleton style={{ height: 72, borderRadius: 20 }} />
    </View>
  ) : structureTabs ? (
    <View style={{ flex: 1 }}>
      <View style={styles.pillRow}>
      <Pressable
        onPress={() => setSheet({ kind: 'facility' })}
        disabled={savingType}
        accessibilityRole="button"
        accessibilityLabel={`시설물 종류 ${structureTabs.facilityType ?? '고르기'}`}
        style={({ pressed }) => [styles.facilityPill, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.facilityLabel}>시설물</Text>
        <Text style={styles.facilityValue}>{structureTabs.facilityType ?? '고르기'}</Text>
        <Feather name="chevron-down" size={16} color={colors.ink2} />
      </Pressable>
      {structureTabs.facilityType === '교량' && (
        <Pressable
          onPress={() => setSheet({ kind: 'info' })}
          disabled={savingType}
          accessibilityRole="button"
          accessibilityLabel={`구조물 정보 ${infoSummary(structureTabs.facilityInfo) ?? '넣기'}`}
          style={({ pressed }) => [styles.facilityPill, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.facilityLabel}>구조물 정보</Text>
          <Text style={[styles.facilityValue, !structureTabs.facilityInfo && { color: colors.primaryText }]}>{infoSummary(structureTabs.facilityInfo) ?? '넣기'}</Text>
          <Feather name="chevron-down" size={16} color={colors.ink2} />
        </Pressable>
      )}
      </View>
      <View style={{ marginBottom: space.md }}>
        <SegmentedTabs options={TABS} value={tab} onChange={changeTab} />
      </View>
      <FadeSlideIn key={tab} direction={tabDirection.current}>
        {tab === 'drawings' && list}
        {tab === 'shots' && (
          <RequiredShotsView
            key={`${structureTabs.id}:${JSON.stringify(structureTabs.facilityInfo ?? null)}`}
            project={structureTabs}
            onEditInfo={() => setSheet({ kind: 'info' })}
            autoShoot={autoShootFor === structureTabs.id}
            onPhotoQueued={() => setPendingPhotos(pendingPhotoCount())}
          />
        )}
        {tab === 'previous' && (
          <PreviousShotsView
            key={structureTabs.id}
            project={structureTabs}
            autoShoot={autoShootFor === structureTabs.id}
            onPhotoQueued={() => setPendingPhotos(pendingPhotoCount())}
          />
        )}
      </FadeSlideIn>
    </View>
  ) : (
    <FadeSlideIn key={String(location)}>{list}</FadeSlideIn>
  );

  return (
    <View style={styles.container}>
      {header}
      <View style={[styles.body, sidePadding, { paddingBottom: withTabBar ? 0 : insets.bottom }]}>
        {banners}
        {body}
      </View>

      <BottomSheet
        visible={sheet?.kind === 'addChild'}
        onClose={() => setSheet(null)}
        title="구조물 추가"
        description={currentProject ? `${currentProject.name} 아래에 만들어요.` : undefined}
      >
        <TextInput
          style={styles.sheetInput}
          placeholder="구조물 이름 (예: A교)"
          placeholderTextColor={colors.subtle}
          value={newChildName}
          onChangeText={setNewChildName}
          editable={!addingChild}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => currentProject && void addChild(currentProject)}
          accessibilityLabel="구조물 이름"
        />
        <PressScale
          disabled={!newChildName.trim() || addingChild}
          onPress={() => currentProject && void addChild(currentProject)}
          accessibilityRole="button"
          accessibilityState={{ disabled: !newChildName.trim() || addingChild }}
          style={[styles.sheetButton, (!newChildName.trim() || addingChild) && styles.sheetButtonOff]}
        >
          <Text style={[styles.sheetButtonText, (!newChildName.trim() || addingChild) && styles.sheetButtonTextOff]}>{addingChild ? '추가하는 중…' : '추가하기'}</Text>
        </PressScale>
      </BottomSheet>

      <BottomSheet visible={sheet?.kind === 'facility'} onClose={() => setSheet(null)} title="시설물 종류" description="종류에 따라 찍을 필수 사진 목록이 정해져요.">
        {FACILITY_TYPES.map((type) => {
          const selected = structureTabs?.facilityType === type;
          return (
            <Pressable
              key={type}
              onPress={() => {
                if (structureTabs) void changeProjectType(structureTabs, { facilityType: selected ? null : type });
                setSheet(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextOn]}>{type}</Text>
              {selected ? <Feather name="check" size={20} color={colors.primaryText} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>

      <FacilityInfoSheet
        visible={sheet?.kind === 'info'}
        info={structureTabs?.facilityInfo}
        saving={savingType}
        onClose={() => setSheet(null)}
        onSave={(info) => {
          if (!structureTabs) return;
          void changeProjectType(structureTabs, { facilityInfo: info }).then(() => setSheet(null));
        }}
      />

      <BottomSheet
        visible={sheet?.kind === 'hide'}
        onClose={() => setSheet(null)}
        title={sheet?.kind === 'hide' ? sheet.project.name : undefined}
        description={
          sheet?.kind === 'hide' && hiddenIds.has(sheet.project.id)
            ? '과업 목록에 다시 보여요.'
            : '이 폰의 과업 목록에서만 숨겨요. 지우는 게 아니라 아래 「숨긴 과업」에서 언제든 다시 보이게 할 수 있어요.'
        }
      >
        <View style={styles.sheetRow}>
          <PressScale onPress={() => setSheet(null)} accessibilityRole="button" style={[styles.sheetButton, styles.sheetButtonGray, { flex: 1 }]}>
            <Text style={[styles.sheetButtonText, { color: colors.ink2 }]}>취소</Text>
          </PressScale>
          <PressScale
            onPress={() => {
              if (sheet?.kind !== 'hide') return;
              const hidden = hiddenIds.has(sheet.project.id);
              setProjectHidden(sheet.project.id, !hidden);
              if (hidden && hiddenCount === 1) setShowHidden(false);
              toast(hidden ? '다시 보이게 했어요' : '목록에서 숨겼어요');
              setSheet(null);
            }}
            accessibilityRole="button"
            style={[styles.sheetButton, { flex: 2 }]}
          >
            <Text style={styles.sheetButtonText}>{sheet?.kind === 'hide' && hiddenIds.has(sheet.project.id) ? '다시 보이기' : '목록에서 숨기기'}</Text>
          </PressScale>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, backgroundColor: colors.background },
  problem: { fontFamily: font.regular, fontSize: 16, color: colors.destructive, textAlign: 'center', lineHeight: 24 },
  // 머리글: [뒤로] 제목 [검색·모두 받기]
  header: { paddingBottom: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH_MIN + 4, gap: space.sm },
  headerSide: { width: TOUCH_MIN, height: TOUCH_MIN },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerLeft: { alignItems: 'flex-start', paddingLeft: 4 },
  headerRight: { flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' },
  title: { fontFamily: font.bold, fontSize: 18, color: colors.foreground },
  subtitle: { fontFamily: font.regular, fontSize: 12.5, color: colors.mutedForeground, marginTop: 1 },
  body: { flex: 1, paddingTop: space.sm },
  listContent: { paddingBottom: space.xxl },
  // 홈
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    backgroundColor: colors.card,
    marginBottom: space.md,
  },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15.5, color: colors.foreground, paddingVertical: space.sm },
  statement: { paddingHorizontal: 4, marginBottom: space.lg, gap: 4 },
  statementSub: { fontFamily: font.semibold, fontSize: 15, color: colors.mutedForeground },
  statementBig: { fontFamily: font.heavy, fontSize: 26, lineHeight: 34, letterSpacing: -0.6, color: colors.foreground },
  statementBlue: { color: colors.primary },
  heroCard: { backgroundColor: colors.card, borderRadius: 24, overflow: 'hidden', marginBottom: space.lg },
  heroPhoto: { height: 132, backgroundColor: '#8fa3b8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroChip: {
    position: 'absolute',
    left: space.lg,
    bottom: space.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.photoChip,
    color: '#ffffff',
    fontFamily: font.bold,
    fontSize: 12,
  },
  heroBody: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: space.lg },
  heroTitle: { fontFamily: font.heavy, fontSize: 18, color: colors.foreground },
  heroSub: { fontFamily: font.regular, fontSize: 14, color: colors.mutedForeground, marginTop: 2 },
  heroButton: {
    margin: 18,
    marginTop: space.md,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  heroButtonText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
  // 흰 묶음 카드(제목 줄 + 줄들)
  groupTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  groupAlone: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, paddingBottom: space.lg },
  groupTitle: { fontFamily: font.heavy, fontSize: 17, color: colors.foreground },
  groupCount: { fontFamily: font.semibold, fontSize: 14, color: colors.subtle },
  groupRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, paddingLeft: space.sm, paddingRight: space.xs },
  groupBottom: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, paddingBottom: space.sm, marginBottom: space.md },
  taskRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: 16 },
  rowDisabled: { opacity: 0.55 },
  taskIcon: { width: 44, height: 44, borderRadius: 14, overflow: 'hidden', textAlign: 'center', lineHeight: 44, fontFamily: font.heavy, fontSize: 13.5 },
  taskIconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 3 },
  name: { fontFamily: font.bold, fontSize: 16, color: colors.foreground },
  meta: { fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground },
  rowError: { fontFamily: font.regular, fontSize: 13, color: colors.destructive, marginTop: 2 },
  pctBox: { alignItems: 'flex-end', gap: 6 },
  pct: { fontFamily: font.heavy, fontSize: 14, color: colors.foreground },
  pctDone: { color: colors.done },
  moreButton: { width: 36, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badge: { fontFamily: font.bold, fontSize: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.mutedForeground, marginVertical: space.sm, paddingHorizontal: 4 },
  empty: { fontFamily: font.regular, fontSize: 15, textAlign: 'center', color: colors.mutedForeground, marginTop: 48, lineHeight: 23 },
  hiddenToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: space.sm },
  hiddenToggleText: { fontFamily: font.semibold, fontSize: 14, color: colors.mutedForeground },
  // 과업 화면
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 68, paddingHorizontal: space.lg, borderRadius: 20, backgroundColor: colors.card, marginBottom: space.md },
  addText: { fontFamily: font.bold, fontSize: 16, color: colors.primaryText },
  // 구조물 화면
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  facilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.card,
    marginBottom: space.md,
  },
  facilityLabel: { fontFamily: font.semibold, fontSize: 13.5, color: colors.subtle },
  facilityValue: { fontFamily: font.bold, fontSize: 14.5, color: colors.foreground },
  // 알림 줄
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    backgroundColor: colors.tagOrangeBg,
    marginBottom: space.md,
  },
  pendingText: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.tagOrangeFg },
  pendingAction: { fontFamily: font.bold, fontSize: 14, color: colors.tagOrangeFg, textDecorationLine: 'underline' },
  errorBanner: { fontFamily: font.semibold, fontSize: 14, color: colors.destructive, backgroundColor: colors.destructiveSoft, padding: space.md, borderRadius: 16, marginBottom: space.md, overflow: 'hidden' },
  progressBanner: { fontFamily: font.semibold, fontSize: 14, color: colors.onPrimary, backgroundColor: colors.primary, padding: space.md, borderRadius: 16, marginBottom: space.md, overflow: 'hidden' },
  resultBanner: { fontFamily: font.semibold, fontSize: 14, color: colors.foreground, backgroundColor: colors.card, padding: space.md, borderRadius: 16, marginBottom: space.md, overflow: 'hidden' },
  // 아래 시트
  sheetInput: {
    minHeight: 56,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    backgroundColor: colors.muted,
    fontFamily: font.semibold,
    fontSize: 17,
    color: colors.foreground,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  sheetRow: { flexDirection: 'row', gap: 10, marginTop: space.md },
  sheetButton: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sheetButtonOff: { backgroundColor: colors.border },
  sheetButtonGray: { backgroundColor: colors.muted },
  sheetButtonText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
  sheetButtonTextOff: { color: colors.subtle },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, paddingHorizontal: space.sm, borderRadius: 14 },
  optionText: { fontFamily: font.semibold, fontSize: 17, color: colors.foreground },
  optionTextOn: { fontFamily: font.bold, color: colors.primaryText },
});
