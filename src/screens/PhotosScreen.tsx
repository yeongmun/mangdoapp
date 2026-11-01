// 하단 메뉴 「찍은 사진」(2026-11-01). 이 폰에 받아 둔 촬영 목록(shots/*.json)에서 찍은 사진을 날짜별로 모아
// 3열로 보여 준다. 사진을 누르면 그 구조물 화면으로 간다. 프로젝트 목록 없이 읽으므로 오프라인에서도 보인다.
import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shotThumbSource } from '../api';
import { PressScale, ZoomImage } from '../components/motion';
import { recentPhotos, type RecentPhoto } from '../homeSummary';
import { listShotsLocal } from '../shotsLocal';
import { colors, font, space } from '../theme';

const COLUMNS = 3;
const GAP = 6;

function dayLabel(at: number): string {
  if (!at) return '날짜 모름';
  const d = new Date(at);
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

export function PhotosScreen({ active, onOpenStructure }: { active: boolean; onOpenStructure: (projectId: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [photos, setPhotos] = useState<RecentPhoto[]>([]);
  // 탭에 들어올 때마다 기기 파일을 다시 읽는다(방금 찍은 사진 반영)
  useEffect(() => {
    if (!active) return;
    const items = listShotsLocal()
      .filter((x) => x.state.list !== null)
      .map((x) => ({ projectId: x.projectId, projectName: x.state.list!.projectName, cache: x.state }));
    setPhotos(recentPhotos(items, 500));
  }, [active]);

  const sections = useMemo(() => {
    const byDay = new Map<string, RecentPhoto[]>();
    for (const p of photos) {
      const key = dayLabel(p.at);
      byDay.set(key, [...(byDay.get(key) ?? []), p]);
    }
    // 한 줄에 3장씩 묶어 SectionList의 한 항목으로
    return [...byDay.entries()].map(([title, list]) => {
      const rows: RecentPhoto[][] = [];
      for (let i = 0; i < list.length; i += COLUMNS) rows.push(list.slice(i, i + COLUMNS));
      return { title, count: list.length, data: rows };
    });
  }, [photos]);

  const size = (width - space.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <Text style={styles.title}>찍은 사진</Text>
        <Text style={styles.sub}>이 폰에서 본 구조물 기준 · {photos.length}장</Text>
      </View>
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="image" size={28} color={colors.primaryText} />
          </View>
          <Text style={styles.emptyTitle}>아직 찍은 사진이 없어요</Text>
          <Text style={styles.emptyText}>과업 → 구조물에서 필수 사진이나 전차 사진을 찍으면 여기에 날짜별로 모여요.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.map((p) => `${p.projectId}-${p.shot.id}`).join('|')}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
          renderSectionHeader={({ section }) => (
            <View style={styles.dayRow}>
              <Text style={styles.day}>{section.title}</Text>
              <Text style={styles.dayCount}>{section.count}장</Text>
            </View>
          )}
          renderItem={({ item: row }) => (
            <View style={[styles.row, { gap: GAP, marginBottom: GAP }]}>
              {row.map((p) => {
                const source = p.localUri ? { uri: p.localUri } : shotThumbSource(p.shot);
                return (
                  <PressScale
                    key={`${p.projectId}-${p.shot.id}`}
                    to={0.95}
                    onPress={() => onOpenStructure(p.projectId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.projectName} ${p.shot.member} ${p.shot.label}${p.localUri ? ', 아직 안 올라감' : ''}, 구조물로 가기`}
                    style={[styles.cell, { width: size, height: size }]}
                  >
                    {source ? <ZoomImage source={source} style={StyleSheet.absoluteFill} /> : null}
                    <Text style={styles.cellLabel} numberOfLines={1}>
                      {p.projectName} · {p.shot.member}
                    </Text>
                    {p.localUri ? <View style={styles.pendingDot} /> : null}
                  </PressScale>
                );
              })}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  head: { paddingHorizontal: space.xl, marginBottom: space.md, gap: 4 },
  title: { fontFamily: font.heavy, fontSize: 26, letterSpacing: -0.6, color: colors.foreground },
  sub: { fontFamily: font.semibold, fontSize: 14, color: colors.mutedForeground },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space.md, marginBottom: space.sm, paddingHorizontal: 2 },
  day: { fontFamily: font.bold, fontSize: 16, color: colors.foreground },
  dayCount: { fontFamily: font.semibold, fontSize: 13, color: colors.subtle },
  row: { flexDirection: 'row' },
  cell: { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border, justifyContent: 'flex-end' },
  cellLabel: { margin: 6, alignSelf: 'flex-start', maxWidth: '92%', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.photoChip, color: '#ffffff', fontFamily: font.semibold, fontSize: 10.5 },
  pendingDot: { position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.badge, borderWidth: 2, borderColor: '#ffffff' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xxl, gap: space.sm },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  emptyTitle: { fontFamily: font.bold, fontSize: 18, color: colors.foreground },
  emptyText: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 22, color: colors.mutedForeground, textAlign: 'center' },
});
