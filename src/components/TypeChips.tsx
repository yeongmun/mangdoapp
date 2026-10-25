// 한 줄로 늘어선 선택 칩(점검 종류·시설물 종류). 하나만 고를 수 있고, 고른 것을 다시 누르면 푼다.
// 값 목록은 부모가 준다(src/api.ts의 INSPECTION_TYPES / FACILITY_TYPES). 고른 칩은 검정 테두리 + 굵은 글자.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space, TOUCH_MIN } from '../theme';

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(selected ? null : option)}
              hitSlop={{ top: 4, bottom: 4 }}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !disabled && styles.chipPressed, disabled && styles.chipDisabled]}
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
  chips: { gap: space.sm },
  chip: {
    minHeight: TOUCH_MIN - 6,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipSelected: { borderWidth: 1.5, borderColor: colors.primary },
  chipPressed: { backgroundColor: colors.muted },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontFamily: font.regular, fontSize: 14, color: '#404145' },
  chipTextSelected: { fontFamily: font.bold, color: colors.foreground },
});
