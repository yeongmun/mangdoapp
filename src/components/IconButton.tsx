// 동그란 회색 아이콘 버튼(뒤로·모두 받기·대기열). 아이콘은 Feather. badge가 있으면 오른쪽 위 빨간 숫자.
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, font, TOUCH_MIN } from '../theme';

interface Props {
  icon: ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
  disabled?: boolean;
}

export function IconButton({ icon, label, onPress, badge, disabled = false }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Feather name={icon} size={20} color={colors.foreground} />
      {badge !== undefined && badge > 0 ? <Text style={styles.badge}>{badge > 99 ? '99+' : badge}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: TOUCH_MIN, height: TOUCH_MIN, borderRadius: TOUCH_MIN / 2, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.border },
  disabled: { opacity: 0.4 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: colors.badge,
    color: '#ffffff',
    fontFamily: font.bold,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
});
