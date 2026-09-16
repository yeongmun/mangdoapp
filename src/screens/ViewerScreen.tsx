import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { viewerUrl, type Drawing } from '../api';
import { takePhotoAndSave } from '../photo';

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
  // 카메라 요청이 겹치지 않게 막는다(설계 5장) — 버튼이 뷰어에서 비활성(⏳)이라 실제로는 거의
  // 오지 않지만, 혹시 겹쳐 와도 두 번째 요청은 조용히 무시한다.
  const photoBusyRef = useRef(false);

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
    const { type, saved, requestId } = message as { type?: unknown; saved?: unknown; requestId?: unknown };
    if (type === 'ready') {
      viewerReadyRef.current = true;
    } else if (type === 'flushResult') {
      pendingFlushRef.current?.(saved === true);
    } else if (type === 'takePhoto') {
      if (typeof requestId !== 'string') return;
      // 겹친 요청은 무시한다 — 뷰어는 응답이 올 때까지 버튼을 비활성(⏳)으로 바꾸므로 실제로는
      // 거의 오지 않는다.
      if (photoBusyRef.current) return;
      photoBusyRef.current = true;
      const reply = (result: { ok: true; filename: string } | { ok: false; reason: string }) => {
        webViewRef.current?.injectJavaScript(
          `window.mangdoPhotoResult && window.mangdoPhotoResult(${JSON.stringify({ requestId, ...result })}); true;`,
        );
      };
      takePhotoAndSave()
        .then(reply)
        .catch((err: unknown) => {
          // takePhotoAndSave는 내부에서 모든 실패를 이미 잡아 { ok:false } 로 돌려주지만, 만약
          // 그 밖의 예외가 새어 나와도 여기서 던지지 않고 같은 형식으로 회신한다.
          reply({ ok: false, reason: `사진을 저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}` });
        })
        .finally(() => {
          photoBusyRef.current = false;
        });
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
