// [필수 사진] 탭(2026-10-24 설계 화면(앱), 2026-11-01 3차 시안으로 다시 그림). 시설물 종류에 따른 필수 사진을
// 2열 둥근 카드로 보여 주고, 카드를 누르면 바로 카메라 → 찍으면 파란 ✓ → 기존 사진 대기열로 서버에 올린다.
// 위는 진행 카드, 아래는 「다음 사진 찍기」 큰 버튼. 상태·촬영 로직은 [전차 사진] 탭과 공유(useShots).
// 찍은 칸은 아래 「찍음 (N) ▾」 접힌 묶음으로 내려가고, 다 찍으면 「모두 찍었어요」(2026-11-02 구글 Tasks 레퍼런스).
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Project, Shot } from '../api';
import { ShotTile } from '../components/ShotCard';
import { AllDoneCard, NextShotButton, ShotProgressCard, TakenHeader } from '../components/ShotProgress';
import { useCelebrate } from '../useCelebrate';
import { CameraScreen } from './CameraScreen';
import { Skeleton } from '../components/motion';
import { useShots } from '../useShots';
import { colors, font, space } from '../theme';

interface Props {
  project: Project;
  /** 찍은 뒤 부모가 대기열 배지를 갱신하도록 */
  onPhotoQueued?: () => void;
  /** 홈 「카메라 열기」로 들어왔으면 목록을 받자마자 다음 사진 카메라를 연다(한 번) */
  autoShoot?: boolean;
  /** 「구조물 정보 넣기」 — 경간·교각 수를 넣으면 칸이 그만큼 펴진다(2026-11-03) */
  onEditInfo?: () => void;
}

export function RequiredShotsView({ project, onPhotoQueued, autoShoot = false, onEditInfo }: Props) {
  const { state, error, busyId, isTaken, takenThumb, shoot, cameraShotId, closeCamera, commitPhoto, uploadStates } = useShots(project, onPhotoQueued);
  const [takenOpen, setTakenOpen] = useState(false);

  const required = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'required'), [state.list]);
  const untaken = required.filter((s) => !isTaken(s));
  const taken = required.filter(isTaken);
  const takenCount = taken.length;
  const next = untaken[0] ?? null;
  const celebrate = useCelebrate(untaken.length, state.list !== null && required.length > 0);

  // 2열 줄로 묶는다: 안 찍은 칸 → (다 찍었으면 축하 카드) → 「찍음」 머리 → (펼쳤으면) 찍은 칸
  type Row = { key: string; kind: 'pair'; shots: Shot[] } | { key: string; kind: 'done' } | { key: string; kind: 'takenHead' };
  const rows: Row[] = [];
  const pairs = (list: Shot[], prefix: string) => {
    for (let i = 0; i < list.length; i += 2) rows.push({ key: `${prefix}${list[i].id}`, kind: 'pair', shots: list.slice(i, i + 2) });
  };
  pairs(untaken, 'u-');
  if (untaken.length === 0 && required.length > 0) rows.push({ key: 'done', kind: 'done' });
  if (taken.length > 0) {
    rows.push({ key: 'taken-head', kind: 'takenHead' });
    if (takenOpen || untaken.length === 0) pairs(taken, 't-');
  }

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoShoot || autoDone.current || state.list === null || next === null) return;
    autoDone.current = true;
    shoot(next);
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
        data={rows}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={
          <>
            {state.list?.needsFacilityInfo && onEditInfo ? (
              <Pressable onPress={onEditInfo} accessibilityRole="button" style={({ pressed }) => [styles.infoBanner, pressed && { opacity: 0.8 }]}>
                <Feather name="info" size={18} color={colors.primaryText} />
                <Text style={styles.infoText}>경간·교각 수와 형식을 넣으면 위치마다 칸이 생겨요</Text>
                <Text style={styles.infoAction}>넣기</Text>
              </Pressable>
            ) : null}
            <ShotProgressCard
              taken={takenCount}
              total={required.length}
              caption={`${project.facilityType}${state.list?.inspectionType ? ` · ${state.list.inspectionType}` : ''} · 필수 사진`}
            />
          </>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'done') return <AllDoneCard total={required.length} celebrate={celebrate} />;
          if (row.kind === 'takenHead') {
            // 다 찍었으면 늘 펼쳐 둔다(접을 이유가 없다)
            const open = takenOpen || untaken.length === 0;
            return <TakenHeader count={taken.length} open={open} onToggle={() => untaken.length > 0 && setTakenOpen((v) => !v)} />;
          }
          return (
            <View style={styles.columns}>
              {row.shots.map((shot) => (
                <View key={shot.id} style={styles.cell}>
                  <ShotTile
                    member={shot.member}
                    label={shot.label}
                    number={shot.number}
                    taken={isTaken(shot)}
                    thumb={takenThumb(shot)}
                    upload={uploadStates.get(shot.id)}
                    disabled={busyId !== null}
                    onPress={() => shoot(shot)}
                  />
                </View>
              ))}
              {row.shots.length === 1 && <View style={styles.cell} />}
            </View>
          );
        }}
        contentContainerStyle={styles.list}
      />
      <NextShotButton nextLabel={next ? `${next.member} ${next.label}` : null} disabled={busyId !== null} onPress={() => next && shoot(next)} />
      {cameraShotId !== null && (
        <CameraScreen
          shots={required}
          startShotId={cameraShotId}
          mode="required"
          isTaken={isTaken}
          takenThumb={takenThumb}
          uploadStates={uploadStates}
          onCapture={(s, r, inCamera) => commitPhoto(s, r, inCamera)}
          onClose={closeCamera}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingBottom: space.lg },
  columns: { flexDirection: 'row', gap: space.md },
  cell: { flex: 1, marginBottom: space.md },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingHorizontal: space.lg, borderRadius: 16, backgroundColor: colors.primarySoft, marginBottom: space.md },
  infoText: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.primaryText, lineHeight: 20 },
  infoAction: { fontFamily: font.bold, fontSize: 14, color: colors.primaryText, textDecorationLine: 'underline' },
  skeletonRow: { flexDirection: 'row', gap: space.md },
  skeletonTile: { flex: 1, height: 170, borderRadius: 22 },
  notice: { fontFamily: font.regular, fontSize: 15, color: colors.mutedForeground, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
  error: { fontFamily: font.regular, fontSize: 15, color: colors.destructive, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
});
