// [전차 사진] 탭(2026-10-24, 3단계, 2026-11-01 3차 시안으로 다시 그림). 웹에서 올린 전차보고서에서 뽑은 사진을
// 보고서 페이지(group)별 큰 카드로 보여 준다. 카드 아래 버튼은 바로 카메라, 위 보고서 사진을 누르면 「사진 한 장」
// 화면(ShotDetailModal)에서 크게 보고 넘기며 찍는다. 필요 없는 페이지는 「휴지통으로」 — 서버에
// trashed 표시만 하므로 「휴지통 보기」에서 「복구」할 수 있다. 참조 이미지는 온라인일 때 기기에 내려받아 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { setGroupTrashed, shotRefRequest, shotRefThumbRequest, type Project, type Shot } from '../api';
import { PreviousShotCard } from '../components/ShotCard';
import { NextShotButton, ShotProgressCard } from '../components/ShotProgress';
import { Skeleton } from '../components/motion';
import { ShotDetailModal } from './ShotDetailModal';
import { refFileFor, writeShotsLocal } from '../shotsLocal';
import { useShots } from '../useShots';
import { colors, font, radius, space, TOUCH_MIN } from '../theme';

interface Props {
  project: Project;
  onPhotoQueued?: () => void;
  /** 홈 「카메라 열기」로 들어왔으면 목록을 받자마자 다음 사진 카메라를 연다(한 번) */
  autoShoot?: boolean;
}

export function PreviousShotsView({ project, onPhotoQueued, autoShoot = false }: Props) {
  const { state, setState, error, busyId, refresh, isTaken, takenThumb, shoot } = useShots(project, onPhotoQueued);
  const [showTrash, setShowTrash] = useState(false);
  const [changingGroup, setChangingGroup] = useState<string | null>(null);

  const previous = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'previous'), [state.list]);
  const visible = useMemo(() => previous.filter((s) => (s.trashed === true) === showTrash), [previous, showTrash]);
  const trashedCount = previous.filter((s) => s.trashed === true).length;
  const activeShots = previous.filter((s) => s.trashed !== true);
  const takenCount = activeShots.filter(isTaken).length;
  const next = activeShots.find((s) => !isTaken(s)) ?? null;
  // 「사진 한 장」 화면: 지금 보이는(휴지통 아닌) 전차 사진 중 몇 번째에서 열지
  const [detailIndex, setDetailIndex] = useState<number | null>(null);

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoShoot || autoDone.current || state.list === null || next === null) return;
    autoDone.current = true;
    void shoot(next);
  }, [autoShoot, state.list, next, shoot]);

  const thumbOf = useCallback(
    (shot: Shot) => {
      const localRef = state.refs[shot.id];
      return localRef ? { uri: localRef } : shotRefThumbRequest(shot);
    },
    [state.refs],
  );

  // 참조 이미지 내려받기(없는 것만, 온라인일 때). 한 장이 실패해도 다음 장을 계속 받고(404·500 한 건에
  // 전부 포기하지 않게 — 리뷰 6), 연속 실패가 쌓이면(오프라인) 그만둔다. 기기 저장은 몇 장마다 한 번.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = previous.filter((s) => s.refThumbUrl && !state.refs[s.id]);
      if (missing.length === 0) return;
      let got: Record<string, string> = {};
      let failures = 0;
      const commit = () => {
        if (Object.keys(got).length === 0) return;
        const batch = got;
        got = {};
        setState((prev) => {
          const next = { ...prev, refs: { ...prev.refs, ...batch } };
          writeShotsLocal(project.id, next);
          return next;
        });
      };
      for (const shot of missing) {
        if (cancelled) break;
        const req = shotRefThumbRequest(shot);
        if (!req) continue;
        try {
          const file = await File.downloadFileAsync(req.uri, refFileFor(shot.id), { headers: req.headers, idempotent: true });
          got[shot.id] = file.uri;
          failures = 0;
          if (Object.keys(got).length >= 8) commit();
        } catch {
          failures += 1;
          if (failures >= 3) break; // 서버가 안 닿는다(오프라인)
        }
      }
      commit();
    })();
    return () => {
      cancelled = true;
    };
    // state.refs는 일부러 뺀다 — 받을 때마다 다시 돌지 않게. previous가 바뀔 때(목록 새로 받음)만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previous, project.id, setState]);

  const sections = useMemo(() => {
    const byGroup = new Map<string, Shot[]>();
    for (const shot of visible) {
      const key = shot.group ?? '-';
      const list = byGroup.get(key) ?? [];
      list.push(shot);
      byGroup.set(key, list);
    }
    // group은 'r<회차>_pg_<순번>'(사진이 든 표 하나 = 페이지 하나) — 순번을 그대로 보여 휴지통 보기와 번호가 같게
    const out = [...byGroup.entries()].map(([group, data], i) => {
      const page = /pg_(\d+)/.exec(group);
      return { group, title: `페이지 ${page ? Number(page[1]) : i + 1}`, data };
    });
    // 다시 올린 보고서와 옛 보고서의 같은 순번이 함께 보이면 회차를 붙여 구분한다
    return out.map((sec) => {
      if (out.filter((o) => o.title === sec.title).length < 2) return sec;
      const round = /^r(\d+)_/.exec(sec.group);
      return round ? { ...sec, title: `${sec.title} · ${round[1]}차 보고서` } : sec;
    });
  }, [visible]);

  const changeGroup = useCallback(
    async (group: string, trashed: boolean) => {
      setChangingGroup(group);
      try {
        await setGroupTrashed(project.id, group, trashed);
        await refresh();
      } catch (e) {
        Alert.alert('페이지', e instanceof Error ? e.message : String(e));
      } finally {
        setChangingGroup(null);
      }
    },
    [project.id, refresh],
  );

  if (state.list === null && error) return <Text style={styles.error}>{error}</Text>;
  if (state.list === null) {
    return (
      <View style={{ gap: space.md }}>
        <Skeleton style={{ height: 118, borderRadius: 22 }} />
        <Skeleton style={{ height: 290, borderRadius: 26 }} />
      </View>
    );
  }
  if (previous.length === 0) {
    return <Text style={styles.notice}>웹 과업 상세에서 이 구조물에 전차보고서(한글)를 올리면 사진이 여기 뜹니다.</Text>;
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(shot) => shot.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            {!showTrash && <ShotProgressCard taken={takenCount} total={activeShots.length} caption="전차 사진 · 같은 자리에서 다시" />}
            <View style={styles.summaryRow}>
              <Text style={styles.summary}>{showTrash ? `휴지통 ${trashedCount}` : `보고서 페이지 ${sections.length}`}</Text>
              <Pressable onPress={() => setShowTrash((v) => !v)} style={[styles.trashToggle, showTrash && styles.trashToggleOn]} accessibilityRole="button">
                <Text style={[styles.trashToggleText, showTrash && styles.trashToggleTextOn]}>{showTrash ? '← 돌아가기' : `휴지통 ${trashedCount}`}</Text>
              </Pressable>
            </View>
            {showTrash && visible.length === 0 && <Text style={styles.notice}>휴지통이 비어 있습니다.</Text>}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Pressable
              onPress={() => void changeGroup(section.group, !showTrash)}
              disabled={changingGroup !== null}
              style={({ pressed }) => [styles.pageButton, pressed && styles.pageButtonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pageButtonText}>{showTrash ? '복구' : '휴지통으로'}</Text>
            </Pressable>
          </View>
        )}
        renderItem={({ item: shot }) => (
          <PreviousShotCard
            member={shot.member}
            label={shot.label}
            number={shot.number}
            caption={shot.caption}
            taken={isTaken(shot)}
            thumb={takenThumb(shot)}
            refThumb={thumbOf(shot)}
            disabled={busyId !== null || showTrash}
            onPress={() => void shoot(shot)}
            onPressImage={() => {
              const i = activeShots.findIndex((s) => s.id === shot.id);
              if (i >= 0) setDetailIndex(i);
            }}
          />
        )}
        contentContainerStyle={styles.list}
      />
      {!showTrash && (
        <NextShotButton nextLabel={next ? `${next.member} ${next.label}` : null} disabled={busyId !== null} onPress={() => next && void shoot(next)} />
      )}
      {detailIndex !== null && (
        <ShotDetailModal
          shots={activeShots}
          startIndex={detailIndex}
          projectName={state.list?.projectName ?? project.name}
          refSource={(s) => (state.refs[s.id] ? { uri: state.refs[s.id] } : shotRefRequest(s) ?? thumbOf(s))}
          takenThumb={takenThumb}
          isTaken={isTaken}
          onClose={() => setDetailIndex(null)}
          onShoot={(s) => void shoot(s)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs, paddingHorizontal: 2 },
  summary: { fontFamily: font.bold, fontSize: 15, color: colors.foreground },
  trashToggle: { minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  trashToggleOn: { backgroundColor: colors.foreground },
  trashToggleText: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2 },
  trashToggleTextOn: { color: colors.onPrimary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.sm, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: font.heavy, fontSize: 18, color: colors.foreground },
  pageButton: { minHeight: TOUCH_MIN - 8, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  pageButtonPressed: { backgroundColor: colors.border },
  pageButtonText: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2 },
  list: { paddingBottom: space.lg },
  notice: { fontFamily: font.regular, fontSize: 15, color: colors.mutedForeground, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
  error: { fontFamily: font.regular, fontSize: 15, color: colors.destructive, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
});
