// 한 줄로 늘어선 선택 칩(점검 종류·과업구분 필터). 하나만 고를 수 있고, 고른 것을 다시 누르면 푼다.
// 3차 시안: 흰 알약, 고르면 진한 회색 바탕 + 흰 글자. 누르는 동안 살짝 작아진다.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, font, space, TOUCH_MIN } from '../theme';
import { PressScale } from './motion';

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
            <PressScale
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(selected ? null : option)}
              hitSlop={{ top: 4, bottom: 4 }}
              to={0.94}
              style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
            </PressScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: space.md },
  chips: { gap: space.sm },
  chip: { minHeight: TOUCH_MIN - 6, paddingHorizontal: 15, justifyContent: 'center', borderRadius: 999, backgroundColor: colors.card },
  chipSelected: { backgroundColor: colors.foreground },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontFamily: font.semibold, fontSize: 14, color: colors.ink2 },
  chipTextSelected: { fontFamily: font.bold, color: '#ffffff' },
});
