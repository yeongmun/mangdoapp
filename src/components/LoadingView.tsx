// 앱 안 로딩 화면(2026-10-24). 빙글빙글만 있던 자리에 심볼 + 무슨 일을 하는지 한 줄. 스플래시(남색)에서
// 이어지도록 같은 심볼을 쓴다. overlay=true면 뷰어처럼 위에 겹쳐 띄운다.
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../theme';

interface Props {
  message: string;
  overlay?: boolean;
}

export function LoadingView({ message, overlay = false }: Props) {
  return (
    <View style={[styles.container, overlay && styles.overlay]} accessibilityRole="progressbar" accessibilityLabel={message}>
      <Image source={require('../../assets/symbol-light.png')} style={styles.symbol} resizeMode="contain" />
      <Text style={styles.message}>{message}</Text>
      <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.background },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(244,245,247,0.92)' },
  symbol: { width: 96, height: 96, marginBottom: space.lg },
  message: { fontSize: 16, fontWeight: '600', color: colors.foreground, textAlign: 'center' },
  spinner: { marginTop: space.lg },
});
