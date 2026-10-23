// [필수 사진] 탭(2026-10-24 설계 화면(앱)). 구조물의 시설물 종류에 따른 필수 사진 목록을 부재별로 묶어
// 카드로 보여 주고, 카드를 누르면 카메라 → 찍으면 즉시 ✓ → 기존 사진 대기열(photoUpload)로 서버에 올린다.
// 오프라인: 마지막으로 받은 목록(shotsLocal)을 그대로 쓰고, 찍은 사진은 대기열이 나중에 올린다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, Text, View } from 'react-native';
import { fetchShots, shotThumbSource, type Project, type Shot, type ShotList } from '../api';
import { ShotCard } from '../components/ShotCard';
import { takePhotoAndSave } from '../photo';
import { enqueuePhoto, flushPhotoQueue } from '../photoUpload';
import { readShotsLocal, writeShotsLocal, type LocalShotState } from '../shotsLocal';
import { colors, space } from '../theme';

interface Props {
  project: Project;
  /** 찍은 뒤 부모가 대기열 배지를 갱신하도록 */
  onPhotoQueued?: () => void;
}

/** 서버 파일명 규칙(shotsStore.shotFileName)과 같은 모양 — 대기열 항목의 filename으로 보낸다 */
function fileNameFor(projectName: string, shot: Shot): string {
  const safe = (t: string) => t.trim().replace(/[\\/:*?"<>|]/g, '_');
  return `${safe(projectName)}_${safe(shot.member)}_${shot.number}.jpg`;
}

export function RequiredShotsView({ project, onPhotoQueued }: Props) {
  const [state, setState] = useState<LocalShotState>(() => readShotsLocal(project.id));
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list: ShotList = await fetchShots(project.id);
      setState((prev) => {
        const next = { ...prev, list, fetchedAt: Date.now() };
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

  const required = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'required'), [state.list]);
  const isTaken = useCallback((shot: Shot) => state.local[shot.id] !== undefined || shot.photo !== undefined, [state.local]);
  const takenCount = required.filter(isTaken).length;

  const sections = useMemo(() => {
    const byMember = new Map<string, Shot[]>();
    for (const shot of required) {
      const list = byMember.get(shot.member) ?? [];
      list.push(shot);
      byMember.set(shot.member, list);
    }
    return [...byMember.entries()].map(([title, data]) => ({ title, data }));
  }, [required]);

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

  if (!project.facilityType) {
    return <Text style={styles.notice}>위에서 시설물 종류를 먼저 고르세요. 종류에 따라 찍을 사진 목록이 정해집니다.</Text>;
  }
  if (state.list === null && error) {
    return <Text style={styles.error}>{error}</Text>;
  }
  if (state.list !== null && required.length === 0) {
    return <Text style={styles.notice}>{`'${project.facilityType}'의 필수 사진 목록이 아직 없습니다. (server/config/requiredShots.json)`}</Text>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <Text style={styles.summary}>
          <Text style={styles.summaryStrong}>{takenCount}</Text>
          {` / ${required.length} 찍음`}
        </Text>
        {state.list === null && <Text style={styles.offline}>불러오는 중…</Text>}
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(shot) => shot.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item: shot }) => {
          const local = state.local[shot.id];
          const thumb = local ? { uri: local.uri } : shotThumbSource(shot);
          return (
            <ShotCard
              label={shot.label}
              number={shot.number}
              taken={isTaken(shot)}
              thumb={thumb}
              disabled={busyId !== null}
              onPress={() => void shoot(shot)}
            />
          );
        }}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.sm },
  summary: { fontSize: 15, color: colors.mutedForeground },
  summaryStrong: { fontSize: 20, fontWeight: '700', color: colors.success },
  offline: { fontSize: 12, color: colors.mutedForeground },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.navy, marginTop: space.md, marginBottom: space.sm, letterSpacing: 0.2 },
  list: { paddingBottom: space.xl },
  notice: { color: colors.mutedForeground, lineHeight: 22, marginTop: space.lg, textAlign: 'center' },
  error: { color: colors.destructive, lineHeight: 22, marginTop: space.lg, textAlign: 'center' },
});
