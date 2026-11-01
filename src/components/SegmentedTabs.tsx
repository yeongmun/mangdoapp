// 회색 알약 안에서 흰 칸이 미끄러지며 고르는 탭(2026-11-01 3차 시안). 구조물 화면 필수 사진/전차 사진/도면.
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import { useReduceMotion } from './motion';

interface Props<K extends string> {
  options: readonly (readonly [K, string])[];
  value: K;
  onChange: (key: K) => void;
}

export function SegmentedTabs<K extends string>({ options, value, onChange }: Props<K>) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex(([k]) => k === value));
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    if (reduce) x.setValue(index);
    else Animated.spring(x, { toValue: index, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
  }, [index, reduce, x]);
  const segment = width > 0 ? (width - 8) / options.length : 0;
  return (
    <View style={styles.track} accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segment > 0 && (
        <Animated.View
          style={[styles.thumb, { width: segment, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, segment] }) }] }]}
        />
      )}
      {options.map(([key, label]) => {
        const selected = key === value;
        return (
          <Pressable key={key} style={styles.item} onPress={() => onChange(key)} accessibilityRole="tab" accessibilityState={{ selected }}>
            <Text style={[styles.text, selected && styles.textOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: colors.border },
  thumb: {
    position: 'absolute',
    top: 4,
    left: 4,
    bottom: 4,
    borderRadius: 12,
    backgroundColor: colors.card,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  item: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: font.semibold, fontSize: 15, color: colors.mutedForeground },
  textOn: { fontFamily: font.bold, color: colors.foreground },
});
