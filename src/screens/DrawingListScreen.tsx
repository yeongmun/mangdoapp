import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { deleteDrawing, fetchDrawings, type Drawing } from '../api';
import { configProblem } from '../config';
import { flushPhotoQueue, pendingPhotoCount, retryPendingPhotos } from '../photoUpload';

const STATUS: Record<Drawing['status'], { label: string; color: string }> = {
  pending: { label: '대기', color: '#8a8f98' },
  inprogress: { label: '변환 중', color: '#1e66f5' },
  success: { label: '완료', color: '#2e7d32' },
  failed: { label: '실패', color: '#d32f2f' },
};

interface Props {
  onOpen: (drawing: Drawing) => void;
}

export function DrawingListScreen({ onOpen }: Props) {
  const problem = configProblem();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState(0);

  const load = useCallback(async () => {
    setPendingPhotos(pendingPhotoCount());
    try {
      setDrawings(await fetchDrawings());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>도면 목록</Text>
      {pendingPhotos > 0 && (
        <Pressable onPress={retryPhotos}>
          <Text style={styles.photoBanner}>보내지 못한 사진 {pendingPhotos}장 — 눌러서 다시 시도</Text>
        </Pressable>
      )}
      {error && <Text style={styles.errorBanner}>{error}</Text>}
      {drawings.length > 0 && <Text style={styles.hint}>도면을 길게 누르면 삭제할 수 있습니다.</Text>}
      <FlatList
        data={drawings}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>업로드된 도면이 없습니다.{'\n'}PC의 업로드 페이지에서 DWG를 올려주세요.</Text>
        }
        renderItem={({ item }) => {
          const status = STATUS[item.status];
          const openable = item.status === 'success';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, !openable && styles.rowDisabled, pressed && openable && styles.rowPressed]}
              // disabled로 막으면 길게 누르기도 죽는다 — 변환 실패·대기 중인 도면도 지울 수 있어야 한다.
              onPress={() => {
                if (openable) onOpen(item);
              }}
              onLongPress={() => confirmDelete(item)}
              delayLongPress={600}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {new Date(item.uploadedAt).toLocaleString('ko-KR')}
                  {item.progress ? ` · ${item.progress}` : ''}
                </Text>
                {item.error && <Text style={styles.rowError}>{item.error}</Text>}
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
  title: { fontSize: 24, fontWeight: '700', color: '#1a1a1a', marginBottom: 16 },
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
  rowError: { fontSize: 13, color: '#d32f2f', marginTop: 4 },
  badge: {
    color: '#fff',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
