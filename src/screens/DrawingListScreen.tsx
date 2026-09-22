import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deleteDrawing, fetchDrawings, fetchProjects, type Drawing, type Project } from '../api';
import { configProblem } from '../config';
import { readLastLocation, writeLastLocation } from '../lastProject';
import { flushPhotoQueue, pendingPhotoCount, retryPendingPhotos } from '../photoUpload';
import { listItemsFor, normalizeLocation, parentLocation, type ListItem, type ListLocation } from '../projectList';

const STATUS: Record<Drawing['status'], { label: string; color: string }> = {
  pending: { label: '대기', color: '#8a8f98' },
  inprogress: { label: '변환 중', color: '#1e66f5' },
  success: { label: '완료', color: '#2e7d32' },
  failed: { label: '실패', color: '#d32f2f' },
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Props {
  onOpen: (drawing: Drawing) => void;
}

export function DrawingListScreen({ onOpen }: Props) {
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

  const goTo = useCallback((next: ListLocation) => {
    setLocation(next);
    writeLastLocation(next);
  }, []);

  const load = useCallback(async () => {
    setPendingPhotos(pendingPhotoCount());
    const [projectsResult, drawingsResult] = await Promise.allSettled([fetchProjects(), fetchDrawings()]);
    // 도면 목록을 못 받으면 오늘처럼 오류만 보인다 — 프로젝트만으로는 아무것도 보여줄 수 없다.
    if (drawingsResult.status === 'rejected') {
      setError(errMessage(drawingsResult.reason));
      return;
    }
    setDrawings(drawingsResult.value);
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

  // 배지를 눌렀을 때: 10번 실패해 멈춘 항목까지 되돌린 뒤 바로 한 번 다시 보낸다.
  const retryPhotos = useCallback(async () => {
    retryPendingPhotos();
    setPendingPhotos(pendingPhotoCount());
    await flushPhotoQueue(() => undefined);
    setPendingPhotos(pendingPhotoCount());
  }, []);

  // 삭제는 서버 휴지통으로 옮기기다(복구는 PC 업로드 페이지). 현장에서 실수로 누르지 않도록 행을
  // **길게 눌러야** 뜨고, 한 번 더 확인한다.
  const confirmDelete = useCallback(
    (drawing: Drawing) => {
      Alert.alert(
        '도면 삭제',
        `"${drawing.name}"을(를) 삭제할까요?

도면과 그 손상 기록·사진이 서버 휴지통으로 옮겨집니다. PC 업로드 페이지의 휴지통에서 복구할 수 있습니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: () => {
              deleteDrawing(drawing.id)
                .then(load)
                .catch((err: unknown) => setError(errMessage(err)));
            },
          },
        ],
      );
    },
    [load],
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const items = useMemo<ListItem<Project, Drawing>[]>(
    () => listItemsFor(projects, drawings, location),
    [projects, drawings, location],
  );

  if (problem) {
    return (
      <View style={styles.center}>
        <Text style={styles.problem}>{problem}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const flat = projects.length === 0;
  const showBack = !flat && location !== null;
  const currentProject = !flat && location !== null && location !== 'unfiled' ? projects.find((p) => p.id === location) : undefined;
  const title = flat ? '도면 목록' : location === null ? '프로젝트' : location === 'unfiled' ? '미분류' : (currentProject?.path ?? '프로젝트');
  const hasDrawingRow = items.some((item) => item.kind === 'drawing');
  const emptyText = flat
    ? '업로드된 도면이 없습니다.\nPC의 업로드 페이지에서 DWG를 올려주세요.'
    : '이 프로젝트에는 도면이 없습니다.\nPC의 업로드 페이지에서 올려 주세요.';

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        {showBack && (
          <Pressable onPress={() => goTo(parentLocation(projects, location))} hitSlop={12}>
            <Text style={styles.backButton}>‹ 뒤로</Text>
          </Pressable>
        )}
        <Text style={styles.title}>{title}</Text>
      </View>
      {pendingPhotos > 0 && (
        <Pressable onPress={retryPhotos}>
          <Text style={styles.photoBanner}>보내지 못한 사진 {pendingPhotos}장 — 눌러서 다시 시도</Text>
        </Pressable>
      )}
      {error && <Text style={styles.errorBanner}>{error}</Text>}
      {hasDrawingRow && <Text style={styles.hint}>도면을 길게 누르면 삭제할 수 있습니다.</Text>}
      <FlatList
        data={items}
        keyExtractor={(item) =>
          item.kind === 'project' ? `project-${item.project.id}` : item.kind === 'unfiled' ? 'unfiled' : `drawing-${item.drawing.id}`
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderItem={({ item }) => {
          if (item.kind === 'project') {
            const project = item.project;
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => goTo(project.id)}
              >
                <Text style={styles.folderGlyph}>📁</Text>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{project.name}</Text>
                  <Text style={styles.meta}>도면 {project.totalDrawingCount}</Text>
                  {project.memo ? (
                    <Text style={styles.memo} numberOfLines={1}>
                      {project.memo}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }
          if (item.kind === 'unfiled') {
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => goTo('unfiled')}
              >
                <Text style={styles.folderGlyph}>📁</Text>
                <View style={styles.rowText}>
                  <Text style={styles.name}>미분류</Text>
                  <Text style={styles.meta}>도면 {item.count}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }
          const drawing = item.drawing;
          const status = STATUS[drawing.status];
          const openable = drawing.status === 'success';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, !openable && styles.rowDisabled, pressed && openable && styles.rowPressed]}
              // disabled로 막으면 길게 누르기도 죽는다 — 변환 실패·대기 중인 도면도 지울 수 있어야 한다.
              onPress={() => {
                if (openable) onOpen(drawing);
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
              </View>
              <Text style={[styles.badge, { backgroundColor: status.color }]}>{status.label}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f5f7', paddingTop: 48, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#f4f5f7' },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a1a' },
  backButton: { fontSize: 16, fontWeight: '600', color: '#1e66f5', marginRight: 12 },
  problem: { fontSize: 16, color: '#d32f2f', textAlign: 'center', lineHeight: 24 },
  errorBanner: { color: '#fff', backgroundColor: '#d32f2f', padding: 12, borderRadius: 8, marginBottom: 12 },
  photoBanner: { color: '#fff', backgroundColor: '#ef6c00', padding: 12, borderRadius: 8, marginBottom: 12 },
  hint: { fontSize: 12, color: '#8a8f98', marginBottom: 8 },
  empty: { textAlign: 'center', color: '#8a8f98', marginTop: 48, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    marginBottom: 10,
  },
  rowDisabled: { opacity: 0.6 },
  rowPressed: { backgroundColor: '#e8eefc' },
  rowText: { flex: 1, marginRight: 12 },
  name: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  meta: { fontSize: 13, color: '#8a8f98', marginTop: 4 },
  memo: { fontSize: 13, color: '#8a8f98', marginTop: 2 },
  rowError: { fontSize: 13, color: '#d32f2f', marginTop: 4 },
  folderGlyph: { fontSize: 22, marginRight: 12 },
  chevron: { fontSize: 22, color: '#c4c8ce', marginLeft: 4 },
  badge: {
    color: '#fff',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
