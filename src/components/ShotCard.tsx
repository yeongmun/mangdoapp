// 찍을 사진 한 장의 카드(2026-10-24, 2026-10-25 농농 시안으로 다시 그림). 카드 전체가 버튼이다(카메라).
// - ShotCard: 필수 사진 줄 — 왼쪽 사진 자리, 가운데 부재·번호·설명, 오른쪽 체크 동그라미.
// - CompareShotCard: 전차 사진 — 위에 [전차 | 이번] 두 장을 나란히, 아래 캡션. 같은 자리에서 찍기 쉽게.
// 찍으면 초록 테두리 + ✓. 썸네일은 기기 사본(찍은 직후) 또는 서버 썸네일.
import { Feather } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';

type Source = { uri: string; headers?: Record<string, string> } | null;

interface Props {
  member: string;
  label: string;
  number: string;
  taken: boolean;
  /** 찍은 사진 썸네일. null이면 빈 자리 */
  thumb: Source;
  disabled?: boolean;
  onPress: () => void;
}

export function ShotCard({ member, label, number, taken, thumb, disabled = false, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${member} ${label} ${taken ? '찍음' : '안 찍음'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.row, taken && styles.cardTaken, pressed && styles.cardPressed, disabled && styles.cardDisabled]}
    >
      <View style={styles.rowThumb}>
        {thumb ? <Image source={thumb} style={styles.fill} resizeMode="cover" /> : <Feather name="camera" size={24} color={colors.mutedForeground} />}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.sub} numberOfLines={1}>
          {member} · No. {number}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <View style={styles.markBox}>
        <View style={[styles.mark, taken && styles.markTaken]}>{taken && <Feather name="check" size={16} color={colors.onSuccess} />}</View>
      </View>
    </Pressable>
  );
}

interface CompareProps extends Props {
  /** 보고서에서 뽑은 참조 이미지 */
  refThumb: Source;
  /** 보고서 캡션 원문 */
  caption?: string;
}

export function CompareShotCard({ member, label, number, taken, thumb, refThumb, caption, disabled = false, onPress }: CompareProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${caption ?? label} ${taken ? '찍음' : '안 찍음'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, taken && styles.cardTaken, pressed && styles.cardPressed, disabled && styles.cardDisabled]}
    >
      <View style={styles.pair}>
        <View style={[styles.half, styles.refHalf]}>
          {refThumb ? <Image source={refThumb} style={styles.fill} resizeMode="cover" /> : <Feather name="image" size={24} color={colors.mutedForeground} />}
          <Text style={styles.tag}>전차</Text>
        </View>
        <View style={[styles.half, taken ? styles.takenHalf : styles.emptyHalf]}>
          {taken && thumb ? <Image source={thumb} style={styles.fill} resizeMode="cover" /> : null}
          {taken ? (
            <Text style={[styles.tag, styles.tagTaken]}>이번 · 찍음</Text>
          ) : (
            <>
              <Feather name="camera" size={26} color={colors.foreground} />
              <Text style={styles.shootText}>눌러서 촬영</Text>
            </>
          )}
        </View>
      </View>
      <View style={styles.caption}>
        <Text style={styles.title} numberOfLines={2}>
          {caption ?? label}
        </Text>
        <Text style={styles.sub}>
          {member} · No. {number}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: space.sm + 2,
  },
  cardTaken: { borderWidth: 1.5, borderColor: colors.success },
  cardPressed: { backgroundColor: colors.muted },
  cardDisabled: { opacity: 0.5 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // 필수 사진 줄
  row: { flexDirection: 'row', alignItems: 'stretch', minHeight: 84 },
  rowThumb: { width: 96, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, paddingHorizontal: space.md, paddingVertical: space.md, justifyContent: 'center', gap: 2 },
  sub: { fontFamily: font.regular, fontSize: 13, color: colors.mutedForeground },
  title: { fontFamily: font.bold, fontSize: 17, color: colors.foreground },
  markBox: { width: 52, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#c5c6c9', alignItems: 'center', justifyContent: 'center' },
  markTaken: { backgroundColor: colors.success, borderColor: colors.success },
  // 전차 사진 카드
  pair: { flexDirection: 'row', gap: 2, backgroundColor: colors.border },
  half: { flex: 1, height: 132, alignItems: 'center', justifyContent: 'center', gap: 6 },
  refHalf: { backgroundColor: '#d9dbde' },
  takenHalf: { backgroundColor: colors.successSoft },
  emptyHalf: { backgroundColor: colors.background },
  tag: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: font.bold,
    fontSize: 12,
  },
  tagTaken: { backgroundColor: colors.success, color: colors.onSuccess },
  shootText: { fontFamily: font.bold, fontSize: 13, color: colors.foreground },
  caption: { paddingHorizontal: 14, paddingVertical: space.md, gap: 2 },
});
