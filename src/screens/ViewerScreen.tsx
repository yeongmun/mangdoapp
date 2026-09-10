import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { viewerUrl, type Drawing } from '../api';

interface Props {
  drawing: Drawing;
  onBack: () => void;
}

export function ViewerScreen({ drawing, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ 목록</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {drawing.name}
        </Text>
      </View>

      <View style={styles.body}>
        <WebView
          key={reloadKey}
          source={{ uri: viewerUrl(drawing.id) }}
          originWhitelist={['https://*', 'http://*']}
          javaScriptEnabled
          domStorageEnabled
          bounces={false}
          scrollEnabled={false}
          setBuiltInZoomControls={false}
          webviewDebuggingEnabled
          onLoadStart={() => {
            setLoading(true);
            setError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => setError(`페이지를 열 수 없습니다: ${event.nativeEvent.description}`)}
          onHttpError={(event) =>
            setError(`서버 응답 오류 (${event.nativeEvent.statusCode}). PC의 서버와 터널을 확인하세요.`)
          }
        />
        {loading && !error && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" />
          </View>
        )}
        {error && (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retry} onPress={() => setReloadKey((key) => key + 1)}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d3d9',
  },
  back: { fontSize: 17, color: '#1e66f5', marginRight: 16 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  body: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    padding: 32,
  },
  errorText: { fontSize: 16, color: '#d32f2f', textAlign: 'center', marginBottom: 16 },
  retry: { backgroundColor: '#1e66f5', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontSize: 16 },
});
