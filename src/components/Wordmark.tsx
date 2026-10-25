// 앱 로고 "농농." — 글자 하나에 주황 점 하나(스플래시·머리글·로딩). 원본 그림: assets/splash-icon.png와 같은 모양.
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';

export const APP_NAME = '농농';

export function Wordmark({ size = 24 }: { size?: number }) {
  const dot = Math.round(size * 0.28);
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel={APP_NAME}>
      <Text style={[styles.text, { fontSize: size, lineHeight: Math.round(size * 1.25), letterSpacing: -size * 0.04 }]}>{APP_NAME}</Text>
      <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, marginBottom: Math.round(size * 0.22) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  text: { fontFamily: font.heavy, color: colors.brand },
  dot: { backgroundColor: colors.brandDot },
});
