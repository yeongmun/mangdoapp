// 찍을 사진 한 장의 카드(2026-10-24). 회색 테두리 = 안 찍음, 초록 테두리 + ✓ = 찍음.
// 썸네일은 기기 사본(찍은 직후)이 있으면 그것, 없으면 서버 썸네일. 카드 전체가 버튼이다(카메라).
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, TOUCH_MIN } from '../theme';

interface Props {
  label: string;
  number: string;
  taken: boolean;
  /** Image source. null이면 빈 자리 */
  thumb: { uri: string; headers?: Record<string, string> } | null;
  disabled?: boolean;
  onPress: () => void;
}

export function ShotCard({ label, number, taken, thumb, disabled = false, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${taken ? '찍음' : '안 찍음'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, taken && styles.cardTaken, pressed && styles.cardPressed, disabled && styles.cardDisabled]}
    >
      <View style={[styles.thumb, taken && styles.thumbTaken]}>
        {thumb ? <Image source={thumb} style={styles.thumbImage} resizeMode="cover" /> : <View style={styles.cameraGlyph} />}
      </View>
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.number}>No. {number}</Text>
      </View>
      <View style={[styles.mark, taken && styles.markTaken]}>{taken && <Text style={styles.markText}>✓</Text>}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_MIN + 32,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
  },
  cardTaken: { borderColor: colors.success },
  cardPressed: { backgroundColor: '#eef2f7' },
  cardDisabled: { opacity: 0.5 },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: space.md,
  },
  thumbTaken: { backgroundColor: '#e6f4ee' },
  thumbImage: { width: '100%', height: '100%' },
  // 카메라 자리 표시: 작은 둥근 사각형(이모지 대신)
  cameraGlyph: { width: 28, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.mutedForeground },
  text: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600', color: colors.foreground },
  number: { fontSize: 12, color: colors.mutedForeground, marginTop: 4 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: space.sm,
  },
  markTaken: { backgroundColor: colors.success, borderColor: colors.success },
  markText: { color: colors.onSuccess, fontSize: 16, fontWeight: '700', lineHeight: 18 },
});
