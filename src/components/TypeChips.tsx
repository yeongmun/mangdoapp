// 한 줄로 늘어선 선택 칩(점검 종류·시설물 종류). 하나만 고를 수 있고, 고른 것을 다시 누르면 푼다.
// 값 목록은 부모가 준다(src/api.ts의 INSPECTION_TYPES / FACILITY_TYPES).
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, TOUCH_MIN } from '../theme';

interface Props {
  label: string;
  options: readonly string[];
  value: string | undefined;
  /** 고른 값, 풀면 null */
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export function TypeChips({ label, options, value, onChange, disabled = false }: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(selected ? null : option)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && !disabled && styles.chipPressed,
                disabled && styles.chipDisabled,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: space.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.mutedForeground, marginBottom: space.xs },
  chips: { gap: space.sm, paddingVertical: 2 },
  chip: {
    minHeight: TOUCH_MIN,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipPressed: { opacity: 0.8 },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 15, fontWeight: '500', color: colors.foreground },
  chipTextSelected: { color: colors.onPrimary, fontWeight: '600' },
});
