// [전차 사진] 탭(2026-10-24, 3단계, 2026-11-01 3차 시안으로 다시 그림). 웹에서 올린 전차보고서에서 뽑은 사진을
// 보고서 페이지(group)별 큰 카드로 보여 준다. 카드 아래 버튼은 바로 카메라, 위 보고서 사진을 누르면 「사진 한 장」
// 화면(ShotDetailModal)에서 크게 보고 넘기며 찍는다. 필요 없는 페이지는 「휴지통으로」 — 서버에
// trashed 표시만 하므로 「휴지통 보기」에서 「복구」할 수 있다. 참조 이미지는 온라인일 때 기기에 내려받아 둔다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { File } from 'expo-file-system';
import { setGroupTrashed, shotRefRequest, shotRefThumbRequest, type Project, type Shot } from '../api';
import { PreviousShotCard } from '../components/ShotCard';
import { AllDoneCard, NextShotButton, ShotProgressCard, TakenHeader } from '../components/ShotProgress';
import { useCelebrate } from '../useCelebrate';
import { Skeleton } from '../components/motion';
import { CameraScreen } from './CameraScreen';
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
  const { state, setState, error, busyId, refresh, isTaken, takenThumb, shoot, cameraShotId, closeCamera, commitPhoto, uploadStates } = useShots(project, onPhotoQueued);
  const [showTrash, setShowTrash] = useState(false);
  const [takenOpen, setTakenOpen] = useState(false);
  const [changingGroup, setChangingGroup] = useState<string | null>(null);

  const previous = useMemo(() => (state.list?.shots ?? []).filter((s) => s.kind === 'previous'), [state.list]);
  const visible = useMemo(() => previous.filter((s) => (s.trashed === true) === showTrash), [previous, showTrash]);
  const trashedCount = previous.filter((s) => s.trashed === true).length;
  const activeShots = previous.filter((s) => s.trashed !== true);
  const takenCount = activeShots.filter(isTaken).length;
  const next = activeShots.find((s) => !isTaken(s)) ?? null;
  const allDone = activeShots.length > 0 && next === null;
  const celebrate = useCelebrate(activeShots.length - takenCount, state.list !== null && activeShots.length > 0);
  // 「사진 한 장」 화면: 지금 보이는(휴지통 아닌) 전차 사진 중 몇 번째에서 열지
  const [detailIndex, setDetailIndex] = useState<number | null>(null);

  const autoDone = useRef(false);
  useEffect(() => {
    if (!autoShoot || autoDone.current || state.list === null || next === null) return;
    autoDone.current = true;
    shoot(next);
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

  const TAKEN = '__taken';
  const sections = useMemo(() => {
    const byGroup = new Map<string, Shot[]>();
    for (const shot of visible) {
      const key = shot.group ?? '-';
      const list = byGroup.get(key) ?? [];
      list.push(shot);
      byGroup.set(key, list);
    }
    // group은 'r<회차>_pg_<순번>'(사진이 든 표 하나 = 페이지 하나) — 순번을 그대로 보여 휴지통 보기와 번호가 같게.
    // 휴지통이 아니면 찍은 칸은 페이지에서 빼서 맨 아래 「찍음」 묶음으로(2026-11-02). 다 찍은 페이지도 머리는 남긴다
    // (「휴지통으로」를 누를 수 있게, 몇 장 찍었는지 보이게)
    const out = [...byGroup.entries()].map(([group, all], i) => {
      const page = /pg_(\d+)/.exec(group);
      const data = showTrash ? all : all.filter((s) => !isTaken(s));
      return { group, title: `페이지 ${page ? Number(page[1]) : i + 1}`, data, takenInPage: showTrash ? 0 : all.length - data.length };
    });
    // 다시 올린 보고서와 옛 보고서의 같은 순번이 함께 보이면 회차를 붙여 구분한다
    const pages = out.map((sec) => {
      if (out.filter((o) => o.title === sec.title).length < 2) return sec;
      const round = /^r(\d+)_/.exec(sec.group);
      return round ? { ...sec, title: `${sec.title} · ${round[1]}차 보고서` } : sec;
    });
    if (showTrash) return pages;
    const taken = visible.filter(isTaken);
    if (taken.length === 0) return pages;
    const open = takenOpen || pages.every((p) => p.data.length === 0);
    return [...pages, { group: TAKEN, title: '찍음', data: open ? taken : [], count: taken.length, open }];
  }, [visible, showTrash, isTaken, takenOpen]);

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
            {!showTrash && allDone && <AllDoneCard total={activeShots.length} celebrate={celebrate} />}
            <View style={styles.summaryRow}>
              <Text style={styles.summary}>{showTrash ? `휴지통 ${trashedCount}` : `보고서 페이지 ${new Set(activeShots.map((s) => s.group ?? '-')).size}`}</Text>
              <Pressable onPress={() => setShowTrash((v) => !v)} style={[styles.trashToggle, showTrash && styles.trashToggleOn]} accessibilityRole="button">
                <Text style={[styles.trashToggleText, showTrash && styles.trashToggleTextOn]}>{showTrash ? '← 돌아가기' : `휴지통 ${trashedCount}`}</Text>
              </Pressable>
            </View>
            {showTrash && visible.length === 0 && <Text style={styles.notice}>휴지통이 비어 있습니다.</Text>}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.group === TAKEN ? (
            <TakenHeader
              count={'count' in section ? (section.count as number) : 0}
              open={'open' in section ? (section.open as boolean) : false}
              onToggle={() => setTakenOpen((v) => !v)}
            />
          ) : (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {section.title}
              {'takenInPage' in section && (section.takenInPage as number) > 0 ? (
                <Text style={styles.sectionTaken}>{`  ${section.takenInPage as number}장 찍음`}</Text>
              ) : null}
            </Text>
            <Pressable
              onPress={() => {
                const taken = 'takenInPage' in section ? (section.takenInPage as number) : 0;
                if (showTrash || taken === 0) {
                  void changeGroup(section.group, !showTrash);
                  return;
                }
                // 찍은 사진은 「찍음」 묶음에 숨어 있다 — 같이 휴지통으로 간다는 걸 알린다
                Alert.alert(section.title, `이 페이지에서 찍은 ${taken}장도 같이 휴지통으로 가요. (사진은 지워지지 않고 복구할 수 있어요)`, [
                  { text: '취소', style: 'cancel' },
                  { text: '휴지통으로', style: 'destructive', onPress: () => void changeGroup(section.group, true) },
                ]);
              }}
              disabled={changingGroup !== null}
              style={({ pressed }) => [styles.pageButton, pressed && styles.pageButtonPressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pageButtonText}>{showTrash ? '복구' : '휴지통으로'}</Text>
            </Pressable>
          </View>
          )
        }
        renderItem={({ item: shot }) => (
          <PreviousShotCard
            member={shot.member}
            label={shot.label}
            number={shot.number}
            caption={shot.caption}
            taken={isTaken(shot)}
            thumb={takenThumb(shot)}
            refThumb={thumbOf(shot)}
            upload={uploadStates.get(shot.id)}
            disabled={busyId !== null || showTrash}
            onPress={() => shoot(shot)}
            onPressImage={() => {
              const i = activeShots.findIndex((s) => s.id === shot.id);
              if (i >= 0) setDetailIndex(i);
            }}
          />
        )}
        contentContainerStyle={styles.list}
      />
      {!showTrash && (
        <NextShotButton nextLabel={next ? `${next.member} ${next.label}` : null} disabled={busyId !== null} onPress={() => next && shoot(next)} />
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
          onShoot={(s) => shoot(s)}
        />
      )}
      {cameraShotId !== null && (
        <CameraScreen
          shots={activeShots}
          startShotId={cameraShotId}
          mode="previous"
          isTaken={isTaken}
          takenThumb={takenThumb}
          refSource={(s) => (state.refs[s.id] ? { uri: state.refs[s.id] } : shotRefRequest(s) ?? thumbOf(s))}
          refThumbSource={thumbOf}
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
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs, paddingHorizontal: 2 },
  summary: { fontFamily: font.bold, fontSize: 15, color: colors.foreground },
  trashToggle: { minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  trashToggleOn: { backgroundColor: colors.foreground },
  trashToggleText: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2 },
  trashToggleTextOn: { color: colors.onPrimary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md, marginBottom: space.sm, paddingHorizontal: 2 },
  sectionTitle: { fontFamily: font.heavy, fontSize: 18, color: colors.foreground },
  sectionTaken: { fontFamily: font.semibold, fontSize: 13, color: colors.subtle },
  pageButton: { minHeight: TOUCH_MIN - 8, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  pageButtonPressed: { backgroundColor: colors.border },
  pageButtonText: { fontFamily: font.semibold, fontSize: 13, color: colors.ink2 },
  list: { paddingBottom: space.lg },
  notice: { fontFamily: font.regular, fontSize: 15, color: colors.mutedForeground, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
  error: { fontFamily: font.regular, fontSize: 15, color: colors.destructive, lineHeight: 23, marginTop: space.xxl, textAlign: 'center' },
});
