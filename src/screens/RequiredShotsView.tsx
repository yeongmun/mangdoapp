// [필수 사진] 탭(2026-10-24 설계 화면(앱)). 구조물의 시설물 종류에 따른 필수 사진 목록을 부재별로 묶어
// 카드로 보여 주고, 카드를 누르면 카메라 → 찍으면 즉시 ✓ → 기존 사진 대기열로 서버에 올린다.
// 상태·촬영 로직은 [전차 사진] 탭과 공유(useShots).
import { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import type { Project, Shot } from '../api';
import { ShotCard } from '../components/ShotCard';
import { useShots } from '../useShots';
import { colors, space } from '../theme';

interface Props {
  project: Project;
  /** 찍은 뒤 부모가 대기열 배지를 갱신하도록 */
  onPhotoQueued?: () => void;
}

export function RequiredShotsView({ project, onPhotoQueued }: Props) {
  const { state, error, busyId, isTaken, takenThumb, shoot } = useShots(project, onPhotoQueued);

  const required = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'required'), [state.list]);
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
        renderItem={({ item: shot }) => (
          <ShotCard
            label={shot.label}
            number={shot.number}
            taken={isTaken(shot)}
            thumb={takenThumb(shot)}
            disabled={busyId !== null}
            onPress={() => void shoot(shot)}
          />
        )}
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
