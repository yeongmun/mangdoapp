// 사진 탭 위 진행 카드(큰 숫자 + 남은 수 + 막대)와 아래 「다음 사진 찍기」 버튼(2026-11-01 3차 시안).
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';
import { AnimatedBar, CheckPop, PressScale } from './motion';

/**
 * 다 찍었을 때 남은 칸 자리에 뜨는 카드(구글 Tasks 「모든 할 일 완료됨」 레퍼런스, 2026-11-02).
 * 이 화면에서 마지막 장을 찍는 순간이면 ✓가 톡 튀어나오고, 처음부터 다 찍혀 있었으면 그냥 보인다.
 */
export function AllDoneCard({ total, celebrate = false }: { total: number; celebrate?: boolean }) {
  const [shown, setShown] = useState(!celebrate);
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(t);
  }, [celebrate]);
  return (
    <View style={styles.done} accessibilityRole="summary" accessibilityLabel={`모두 찍었어요. ${total}장`}>
      <View style={styles.doneSlot}>
        <CheckPop visible={shown} style={styles.doneCircle}>
          <Feather name="check" size={40} color={colors.onPrimary} />
        </CheckPop>
      </View>
      <Text style={styles.doneTitle}>모두 찍었어요</Text>
      <Text style={styles.doneSub}>수고하셨어요! 찍은 {total}장은 아래 「찍음」에 있어요</Text>
    </View>
  );
}

/** 「찍음 (N) ▾」 접힌 묶음 머리(구글 Tasks 「완료됨(1개)」 레퍼런스). 누르면 펼치고 접는다 */
export function TakenHeader({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`찍음 ${count}장, ${open ? '접기' : '펼치기'}`}
      style={({ pressed }) => [styles.takenHead, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.takenTitle}>
        찍음 <Text style={styles.takenCount}>({count})</Text>
      </Text>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

export function ShotProgressCard({ taken, total, caption }: { taken: number; total: number; caption: string }) {
  const left = Math.max(0, total - taken);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.caption}>{caption}</Text>
          <Text style={styles.big} accessibilityLabel={`${total}장 중 ${taken}장 찍음`}>
            {taken}
            <Text style={styles.bigSub}> / {total}장</Text>
          </Text>
        </View>
        <Text style={[styles.pill, left === 0 && total > 0 && styles.pillDone]}>{total === 0 ? '목록 없음' : left === 0 ? '다 찍었어요' : `${left}장 남음`}</Text>
      </View>
      <AnimatedBar ratio={total > 0 ? taken / total : 0} />
    </View>
  );
}

/** 화면 아래 큰 파랑 버튼. next가 없으면(다 찍음) 흐리게 */
export function NextShotButton({ nextLabel, onPress, disabled }: { nextLabel: string | null; onPress: () => void; disabled?: boolean }) {
  const off = nextLabel === null || disabled;
  return (
    <View style={styles.ctaWrap}>
      <PressScale
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityState={{ disabled: off }}
        style={[styles.cta, off && styles.ctaOff]}
      >
        <Feather name={nextLabel === null ? 'check' : 'camera'} size={20} color={off ? colors.subtle : colors.onPrimary} />
        <Text style={[styles.ctaText, off && styles.ctaTextOff]} numberOfLines={1}>
          {nextLabel === null ? '모두 찍었어요' : `다음 사진 찍기 · ${nextLabel}`}
        </Text>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.xl, gap: space.md, marginBottom: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.md },
  caption: { fontFamily: font.semibold, fontSize: 14, color: colors.mutedForeground },
  big: { fontFamily: font.heavy, fontSize: 30, letterSpacing: -0.8, color: colors.foreground, marginTop: 2 },
  bigSub: { fontFamily: font.bold, fontSize: 20, color: colors.subtle },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.primarySoft,
    color: colors.primaryText,
    fontFamily: font.bold,
    fontSize: 13,
  },
  done: { backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: space.xxl, paddingHorizontal: space.xl, alignItems: 'center', gap: space.sm, marginBottom: space.md },
  doneSlot: { width: 76, height: 76, marginBottom: space.sm },
  doneCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontFamily: font.heavy, fontSize: 22, letterSpacing: -0.5, color: colors.foreground },
  doneSub: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 21, color: colors.mutedForeground, textAlign: 'center' },
  takenHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 4, marginTop: space.sm, marginBottom: space.xs },
  takenTitle: { fontFamily: font.bold, fontSize: 16, color: colors.foreground },
  takenCount: { fontFamily: font.semibold, color: colors.subtle },
  pillDone: { backgroundColor: '#e5f7ef', color: colors.done },
  ctaWrap: { paddingTop: space.md, paddingBottom: space.sm },
  cta: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  ctaOff: { backgroundColor: colors.border },
  ctaText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary, flexShrink: 1 },
  ctaTextOff: { color: colors.subtle },
});
