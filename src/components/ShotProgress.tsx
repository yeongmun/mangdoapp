// 사진 탭 위 진행 카드(큰 숫자 + 남은 수 + 막대)와 아래 「다음 사진 찍기」 버튼(2026-11-01 3차 시안).
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';
import { AnimatedBar, PressScale } from './motion';

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
  pillDone: { backgroundColor: '#e5f7ef', color: colors.done },
  ctaWrap: { paddingTop: space.md, paddingBottom: space.sm },
  cta: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  ctaOff: { backgroundColor: colors.border },
  ctaText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary, flexShrink: 1 },
  ctaTextOff: { color: colors.subtle },
});
