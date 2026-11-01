// 하단 메뉴(2026-11-01 사용자 결정): 과업 / 찍은 사진 / 업로드 대기. 고른 칸은 파랑, 업로드 대기엔 빨간 숫자.
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';

export type MainTab = 'tasks' | 'photos' | 'queue';

const ITEMS: { key: MainTab; label: string; icon: ComponentProps<typeof Feather>['name'] }[] = [
  { key: 'tasks', label: '과업', icon: 'home' },
  { key: 'photos', label: '찍은 사진', icon: 'image' },
  { key: 'queue', label: '업로드 대기', icon: 'upload-cloud' },
];

/** 하단 메뉴 높이(안전 영역 제외) — 토스트를 그 위에 띄울 때 쓴다 */
export const TAB_BAR_HEIGHT = 60;

export function TabBar({ value, onChange, queueCount }: { value: MainTab; onChange: (tab: MainTab) => void; queueCount: number }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]} accessibilityRole="tablist">
      {ITEMS.map((item) => {
        const selected = item.key === value;
        const color = selected ? colors.primaryText : colors.subtle;
        return (
          <Pressable
            key={item.key}
            style={styles.item}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.key === 'queue' && queueCount > 0 ? `${item.label} ${queueCount}개` : item.label}
          >
            <View>
              <Feather name={item.icon} size={23} color={color} />
              {item.key === 'queue' && queueCount > 0 ? <Text style={styles.badge}>{queueCount > 99 ? '99+' : queueCount}</Text> : null}
            </View>
            <Text style={[styles.label, { color }, selected && styles.labelOn]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 52 },
  label: { fontFamily: font.semibold, fontSize: 12 },
  labelOn: { fontFamily: font.bold },
  badge: {
    position: 'absolute',
    top: -5,
    right: -12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    overflow: 'hidden',
    backgroundColor: colors.badge,
    color: '#ffffff',
    fontFamily: font.heavy,
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
});
