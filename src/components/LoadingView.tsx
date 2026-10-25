// 불러오는 중 화면. 스플래시와 같은 모양(흰 바탕 + 로고)이라 앱이 켜질 때 이어 보인다.
// overlay면 뷰어 위에 반투명으로 덮는다.
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, font, space } from '../theme';
import { Wordmark } from './Wordmark';

interface Props {
  message: string;
  overlay?: boolean;
}

export function LoadingView({ message, overlay = false }: Props) {
  return (
    <View style={[styles.container, overlay && styles.overlay]} accessibilityRole="progressbar" accessibilityLabel={message}>
      <Wordmark size={40} />
      <Text style={styles.message}>{message}</Text>
      <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, backgroundColor: colors.card },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.94)' },
  message: { fontFamily: font.semibold, fontSize: 15, color: colors.mutedForeground, textAlign: 'center', marginTop: space.lg },
  spinner: { marginTop: space.lg },
});
