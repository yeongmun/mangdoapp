import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { viewerUrl, type Drawing } from '../api';

interface Props {
  drawing: Drawing;
  onBack: () => void;
}

const FLUSH_TIMEOUT_MS = 5000;
// 끝의 true는 iOS에서 injectJavaScript 결과가 직렬화되지 않아 생기는 경고를 막는다.
const FLUSH_SCRIPT = 'window.mangdoFlush && window.mangdoFlush(); true;';

export function ViewerScreen({ drawing, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const webViewRef = useRef<WebView>(null);
  // 뷰어 페이지가 도면을 다 불러와 { type: 'ready' }를 보낸 뒤에만 저장 확인을 요청한다.
  const viewerReadyRef = useRef(false);
  const pendingFlushRef = useRef<((saved: boolean) => void) | null>(null);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef(false);

  const clearPendingFlush = useCallback(() => {
    if (flushTimeoutRef.current !== null) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    pendingFlushRef.current = null;
  }, []);

  const requestLeave = useCallback(() => {
    if (leavingRef.current) return;
    const webView = webViewRef.current;
    if (!viewerReadyRef.current || !webView) {
      onBack();
      return;
    }
    leavingRef.current = true;

    const finish = (saved: boolean) => {
      clearPendingFlush();
      if (saved) {
        onBack();
        return;
      }
      leavingRef.current = false;
      Alert.alert(
        '저장되지 않은 손상이 있습니다',
        '서버에 저장하지 못했습니다. 이 기기에 임시 보관되지만, PC 서버를 다시 시작하면 복구할 수 없습니다.',
        [
          { text: '계속 편집', style: 'cancel' },
          { text: '그래도 나가기', style: 'destructive', onPress: onBack },
        ],
      );
    };

    pendingFlushRef.current = finish;
    flushTimeoutRef.current = setTimeout(() => finish(false), FLUSH_TIMEOUT_MS);
    webView.injectJavaScript(FLUSH_SCRIPT);
  }, [clearPendingFlush, onBack]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    let message: unknown;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const { type, saved } = message as { type?: unknown; saved?: unknown };
    if (type === 'ready') {
      viewerReadyRef.current = true;
    } else if (type === 'flushResult') {
      pendingFlushRef.current?.(saved === true);
    }
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeave();
      return true;
    });
    return () => subscription.remove();
  }, [requestLeave]);

  useEffect(() => clearPendingFlush, [clearPendingFlush]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={requestLeave} hitSlop={12}>
          <Text style={styles.back}>‹ 목록</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {drawing.name}
        </Text>
      </View>

      <View style={styles.body}>
        <WebView
          key={reloadKey}
          ref={webViewRef}
          source={{ uri: viewerUrl(drawing.id) }}
          originWhitelist={['https://*', 'http://*']}
          javaScriptEnabled
          domStorageEnabled
          bounces={false}
          scrollEnabled={false}
          setBuiltInZoomControls={false}
          webviewDebuggingEnabled
          onMessage={handleMessage}
          onLoadStart={() => {
            viewerReadyRef.current = false;
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
