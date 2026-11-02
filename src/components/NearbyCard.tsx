// 홈 「지금 여기 근처」 카드(2026-11-02, 배민 「현재 위치로 찾기」 레퍼런스). 폰 GPS로 가까운 구조물 1~3개와 거리를 보여 주고
// 누르면 그 구조물로, [찍기]는 카메라까지 바로. 구조물 위치는 그 자리에서 사진을 찍을 때 저절로 기억된다(structureLocation).
// 위치 권한이 없으면 [현재 위치로 찾기] 버튼 하나만 보인다(눌러야 묻는다). 위치가 기록된 구조물이 하나도 없으면 아무것도 안 보인다.
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Project } from '../api';
import { formatDistance, nearestStructures, type Nearby } from '../nearby';
import { getPositionQuick, withLocalLocations, type Fix } from '../structureLocation';
import { colors, font, radius, space } from '../theme';
import { PressScale } from './motion';

interface Props {
  projects: Project[];
  active: boolean;
  onOpen: (structureId: string) => void;
  onShoot: (structureId: string) => void;
}

export function NearbyCard({ projects, active, onOpen, onShoot }: Props) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [state, setState] = useState<'idle' | 'finding' | 'denied' | 'none'>('idle');

  const structures = useMemo(() => withLocalLocations(projects.filter((p) => p.depth === 1)), [projects]);
  const anyLocated = structures.some((p) => p.location);

  const find = useCallback(
    async (ask: boolean) => {
      setState('finding');
      const f = await getPositionQuick(ask, 8000);
      if (!f) {
        setState(ask ? 'none' : 'denied');
        return;
      }
      setFix(f);
      setState('idle');
    },
    [],
  );

  // 홈에 올 때마다 조용히(묻지 않고) 한 번 읽는다 — 권한을 이미 줬으면 바로 뜬다
  useEffect(() => {
    if (!active || !anyLocated) return;
    void find(false);
  }, [active, anyLocated, find]);

  if (!anyLocated) return null;
  const taskName = (p: Project) => projects.find((t) => t.id === p.parentId)?.name ?? '';
  const near: Nearby<Project>[] = fix ? nearestStructures(fix, structures, 3) : [];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <View style={styles.pin}>
            <Feather name="map-pin" size={15} color={colors.primaryText} />
          </View>
          <Text style={styles.title}>지금 여기 근처</Text>
        </View>
        <Pressable onPress={() => void find(true)} disabled={state === 'finding'} accessibilityRole="button" accessibilityLabel="현재 위치로 다시 찾기" style={({ pressed }) => [styles.refresh, pressed && { opacity: 0.6 }]}>
          <Feather name="crosshair" size={14} color={colors.ink2} />
          <Text style={styles.refreshText}>{state === 'finding' ? '찾는 중…' : '현재 위치로 찾기'}</Text>
        </Pressable>
      </View>
      {!fix ? (
        <Text style={styles.hint}>
          {state === 'denied'
            ? '위에서 [현재 위치로 찾기]를 누르면 가까운 구조물을 찾아 드려요'
            : state === 'none'
              ? '위치를 못 읽었어요 · 설정에서 위치 권한을 확인해 주세요'
              : '위치를 읽는 중…'}
        </Text>
      ) : near.length === 0 ? (
        <Text style={styles.hint}>3km 안에 기억된 구조물이 없어요</Text>
      ) : (
        near.map((n, i) => (
          <PressScale key={n.item.id} to={0.98} onPress={() => onOpen(n.item.id)} accessibilityRole="button" accessibilityLabel={`${n.item.name}, ${formatDistance(n.distanceM)}, 열기`} style={[styles.row, i === 0 && styles.rowFirst]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, i === 0 && styles.nameFirst]} numberOfLines={1}>
                {n.item.name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {taskName(n.item)}
                {n.item.facilityType ? ` · ${n.item.facilityType}` : ''}
              </Text>
            </View>
            <Text style={[styles.dist, i === 0 && styles.distFirst]}>{formatDistance(n.distanceM)}</Text>
            {i === 0 ? (
              <Pressable onPress={() => onShoot(n.item.id)} accessibilityRole="button" accessibilityLabel={`${n.item.name} 바로 찍기`} style={({ pressed }) => [styles.shoot, pressed && { opacity: 0.8 }]}>
                <Feather name="camera" size={16} color={colors.onPrimary} />
                <Text style={styles.shootText}>찍기</Text>
              </Pressable>
            ) : (
              <Feather name="chevron-right" size={18} color={colors.subtle} />
            )}
          </PressScale>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, marginBottom: space.lg, gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pin: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font.bold, fontSize: 15, color: colors.foreground },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: colors.muted },
  refreshText: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink2 },
  hint: { fontFamily: font.regular, fontSize: 13.5, lineHeight: 20, color: colors.mutedForeground, paddingHorizontal: 4, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: 8, borderRadius: 14 },
  rowFirst: { backgroundColor: colors.primarySoft, minHeight: 64, paddingHorizontal: 12 },
  name: { fontFamily: font.bold, fontSize: 15, color: colors.foreground },
  nameFirst: { fontSize: 17, fontFamily: font.heavy },
  meta: { fontFamily: font.semibold, fontSize: 12.5, color: colors.mutedForeground },
  dist: { fontFamily: font.bold, fontSize: 14, color: colors.ink2 },
  distFirst: { color: colors.primaryText },
  shoot: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.primary },
  shootText: { fontFamily: font.bold, fontSize: 14, color: colors.onPrimary },
});
