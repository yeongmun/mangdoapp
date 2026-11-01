// [필수 사진] 탭(2026-10-24 설계 화면(앱), 2026-11-01 3차 시안으로 다시 그림). 시설물 종류에 따른 필수 사진을
// 2열 둥근 카드로 보여 주고, 카드를 누르면 바로 카메라 → 찍으면 파란 ✓ → 기존 사진 대기열로 서버에 올린다.
// 위는 진행 카드, 아래는 「다음 사진 찍기」 큰 버튼. 상태·촬영 로직은 [전차 사진] 탭과 공유(useShots).
import { useEffect, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Project } from '../api';
import { ShotTile } from '../components/ShotCard';
import { NextShotButton, ShotProgressCard } from '../components/ShotProgress';
import { Skeleton } from '../components/motion';
import { useShots } from '../useShots';
import { colors, font, space } from '../theme';

interface Props {
  project: Project;
  /** 찍은 뒤 부모가 대기열 배지를 갱신하도록 */
  onPhotoQueued?: () => void;
  /** 홈 「카메라 열기」로 들어왔으면 목록을 받자마자 다음 사진 카메라를 연다(한 번) */
  autoShoot?: boolean;
}

export function RequiredShotsView({ project, onPhotoQueued, autoShoot = false }: Props) {
  const { state, error, busyId, isTaken, takenThumb, shoot } = useShots(project, onPhotoQueued);

  const required = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'required'), [state.list]);
  const takenCount = required.filter(isTaken).length;
  const next = required.find((s) => !isTaken(s)) ?? null;

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoShoot || autoDone.current || state.list === null || next === null) return;
    autoDone.current = true;
    void shoot(next);
  }, [autoShoot, state.list, next, shoot]);

  if (!project.facilityType) {
    return <Text style={styles.notice}>위에서 시설물 종류를 먼저 고르세요. 종류에 따라 찍을 사진 목록이 정해집니다.</Text>;
  }
  if (state.list === null && error) {
    return <Text style={styles.error}>{error}</Text>;
  }
  if (state.list === null) {
    return (
      <View style={{ gap: space.md }}>
        <Skeleton style={{ height: 118, borderRadius: 22 }} />
        <View style={styles.skeletonRow}>
          <Skeleton style={styles.skeletonTile} />
          <Skeleton style={styles.skeletonTile} />
        </View>
      </View>
    );
  }
  if (required.length === 0) {
    return <Text style={styles.notice}>{`'${project.facilityType}'의 필수 사진 목록이 아직 없습니다. (server/config/requiredShots.json)`}</Text>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={required}
        keyExtractor={(shot) => shot.id}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        ListHeaderComponent={<ShotProgressCard taken={takenCount} total={required.length} caption={`${project.facilityType} · 필수 사진`} />}
        renderItem={({ item: shot }) => (
          <View style={styles.cell}>
            <ShotTile
              member={shot.member}
              label={shot.label}
              number={shot.number}
              taken={isTaken(shot)}
              thumb={takenThumb(shot)}
              disabled={busyId !== null}
              onPress={() => void shoot(shot)}
            />
          </View>
        )}
        contentContainerStyle={styles.list}
      />
      <NextShotButton nextLabel={next ? `${next.member} ${next.label}` : null} disabled={busyId !== null} onPress={() => next && void shoot(next)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: space.lg },
  columns: { gap: space.md },
  cell: { flex: 1, maxWidth: '50%', marginBottom: space.md },
  skeletonRow: { flexDirection: 'row', gap: space.md },
  skeletonTile: { flex: 1, height: 170, borderRadius: 22 },
  notice: { fontFamily: font.regular, fontSize: 15, color: colors.mutedForeground, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
  error: { fontFamily: font.regular, fontSize: 15, color: colors.destructive, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
});
