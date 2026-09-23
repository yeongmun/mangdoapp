import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import { viewerUrl, type DamageDoc, type Drawing } from '../api';
import {
  modelUri,
  offlineRoot,
  readDamages,
  readIndex,
  viewerPageUri,
  writeDamages,
  writeIndex,
} from '../offlineStore';
import { takePhotoAndSave } from '../photo';
import { flushPhotoQueue, enqueuePhoto, PHOTO_FLUSH_INTERVAL_MS, type UploadNotice } from '../photoUpload';

interface Props {
  drawing: Drawing;
  onBack: () => void;
}

const FLUSH_TIMEOUT_MS = 5000;
// 끝의 true는 iOS에서 injectJavaScript 결과가 직렬화되지 않아 생기는 경고를 막는다.
const FLUSH_SCRIPT = 'window.mangdoFlush && window.mangdoFlush(); true;';

interface OfflineSource {
  /** file://…/bundle/<version>/viewer.html?id=…&offline=1 */
  pageUri: string;
  /** iOS가 읽도록 허용할 폴더(페이지·모델 파일이 모두 이 아래에 있어야 한다). */
  readAccessUri: string;
  /** 콘텐츠가 뜨기 전에 window.mangdoOffline을 놓는 스크립트. */
  injected: string;
}

// JSON을 그대로 JS 코드 안에 넣는다. U+2028·U+2029는 JSON 문자열 안에서는 멀쩡하지만 JS
// 소스에서는 줄바꿈으로 읽혀 코드가 깨진다 — 손상 비고에 그런 글자가 들어와도 안전하도록 바꾼다.
function embedJson(value: unknown): string {
  // 소스에 그 글자를 그대로 두면 이 파일 자체가 깨져 보이므로 코드 포인트로 만든다.
  const separators = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
  return JSON.stringify(value).replace(separators, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
}

// 기기에 내려받은 도면이면 뷰어를 기기 파일로 연다(설계 3.3). index에 없거나 꾸러미가 없으면
// null — 지금까지처럼 서버 페이지를 연다.
function buildOfflineSource(drawing: Drawing): OfflineSource | null {
  const index = readIndex();
  const entry = index.drawings[drawing.id];
  if (entry === undefined || index.bundleVersion === null) return null;
  const stored = readDamages(drawing.id) as DamageDoc | null;
  // 기기에 손상 파일이 아직 없으면(내려받기 도중 사라진 경우 등) 빈 문서로 연다 — 뷰어는
  // 이 문서를 그대로 편집 출발점으로 삼고, 저장하면 서버 것보다 새것이 되어 push된다.
  const doc: DamageDoc = stored ?? {
    schemaVersion: 5,
    drawingId: drawing.id,
    updatedAt: new Date(0).toISOString(),
    damages: [],
  };
  // 뷰어(main.js)는 이 레코드에서 id·status·frames를 본다. 내려받은 도면은 언제나 변환이 끝난
  // SVF이고, frames는 목록 레코드에 없으면(오프라인 목록) 내려받을 때 저장해 둔 것을 쓴다.
  const record: Drawing = {
    ...drawing,
    status: 'success',
    viewFormat: 'svf',
    frames: drawing.frames ?? entry.frames,
  };
  const root = offlineRoot().uri;
  return {
    pageUri: viewerPageUri(index.bundleVersion, drawing.id),
    readAccessUri: root.endsWith('/') ? root : `${root}/`,
    injected: `window.mangdoOffline = ${embedJson({
      drawing: record,
      doc,
      modelUrl: modelUri(drawing.id, entry.model),
    })}; true;`,
  };
}

export function ViewerScreen({ drawing, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 기기 파일로 열지(오프라인) 서버 페이지로 열지는 화면에 들어올 때 정한다 — 도면이 index에
  // 있으면 인터넷과 상관없이 기기 파일이다(설계 3.3). `다시 시도`(reloadKey)로 페이지를 새로
  // 띄울 때는 기기의 손상 기록을 다시 읽어 주입해야 한다(그 사이 저장된 것이 있다).
  const offline = useMemo(() => buildOfflineSource(drawing), [drawing, reloadKey]);

  const webViewRef = useRef<WebView>(null);
  // 뷰어 페이지가 도면을 다 불러와 { type: 'ready' }를 보낸 뒤에만 저장 확인을 요청한다.
  const viewerReadyRef = useRef(false);
  const pendingFlushRef = useRef<((saved: boolean) => void) | null>(null);
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leavingRef = useRef(false);
  // 카메라 요청이 겹치지 않게 막는다(설계 5장) — 버튼이 뷰어에서 비활성(⏳)이라 실제로는 거의
  // 오지 않지만, 혹시 겹쳐 와도 두 번째 요청은 조용히 무시한다.
  const photoBusyRef = useRef(false);
  // 찍어 올리는 중인 항목들의 대기열 id → requestId. 전송 결과를 뷰어에 알릴 때 그 촬영의
  // requestId를 함께 보내기 위해서다(대기열에 남아 있던 옛 항목은 매핑이 없으므로 null로
  // 보낸다). Map인 이유: photoBusyRef가 풀리자마자 다음 촬영이 대기열에 들어가면, 앞 항목의
  // 전송이 아직 끝나기 전에 새 항목이 추가될 수 있다 — 단일 참조였다면 앞 항목의 결과가 뒤
  // 항목의 requestId로 잘못 붙거나 null로 떨어진다(리뷰 Fix round 1, Minor).
  const photoRequestsRef = useRef<Map<string, string>>(new Map());

  // 뷰어 페이지의 window 함수를 부른다. 끝의 true는 iOS에서 injectJavaScript 결과가 직렬화되지
  // 않아 생기는 경고를 막는다(FLUSH_SCRIPT와 같은 이유).
  const inject = useCallback((fn: string, payload: unknown) => {
    webViewRef.current?.injectJavaScript(`window.${fn} && window.${fn}(${JSON.stringify(payload)}); true;`);
  }, []);

  const notifyUpload = useCallback(
    (notice: UploadNotice) => {
      const requests = photoRequestsRef.current;
      const requestId = requests.get(notice.id) ?? null;
      requests.delete(notice.id); // 다 쓴 매핑은 지운다 — 화면에 머무는 동안 계속 쌓이지 않게.
      if (notice.ok) {
        inject('mangdoPhotoUploaded', { requestId, damageId: notice.damageId, number: notice.number });
      } else {
        inject('mangdoPhotoUploadFailed', {
          requestId,
          damageId: notice.damageId,
          reason: notice.reason,
          willRetry: notice.willRetry,
        });
      }
    },
    [inject],
  );

  const flushPhotos = useCallback(() => {
    void flushPhotoQueue(notifyUpload);
  }, [notifyUpload]);

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
    } else if (type === 'offlineSave') {
      // 오프라인 뷰어의 저장 요청(설계 3.4). 뷰어는 3초 안에 회신을 기다리므로 파일에 쓰고
      // 바로 답한다 — writeDamages는 동기(tmp→move)라 늦어지지 않는다. 쓰지 못했으면 답하지
      // 않는다: 뷰어가 실패로 보고 재시도 규칙에 따라 다시 보낸다.
      const { doc } = message as { doc?: unknown };
      if (typeof doc !== 'object' || doc === null) return;
      const { updatedAt } = doc as { updatedAt?: unknown };
      if (typeof updatedAt !== 'string') return;
      if (!writeDamages(drawing.id, doc)) return;
      // index의 damagesUpdatedAt이 곧 "기기가 가진 가장 새 손상 기록"이다 — 목록 화면의
      // `서버에 올리지 못한 손상 기록 N개` 배지와 동기화(push/pull) 판단이 이 값을 본다.
      const index = readIndex();
      const entry = index.drawings[drawing.id];
      if (entry) {
        const ok = writeIndex({
          ...index,
          drawings: { ...index.drawings, [drawing.id]: { ...entry, damagesUpdatedAt: updatedAt } },
        });
        // 손상 파일은 이미 썼으므로 저장 자체는 성공이다. index만 못 쓰면 배지·동기화 판단이 한 번
        // 늦어질 뿐이고 다음 저장에서 다시 쓴다 — 로그만 남긴다.
        if (!ok) console.error('[offline] index.json을 갱신하지 못했습니다', drawing.id);
      }
      inject('mangdoOfflineSaved', { updatedAt });
    } else if (type === 'takePhoto') {
      if (typeof requestId !== 'string') return;
      // 뷰어는 drawingId도 함께 보내지만(설계 4장) 저장에는 **앱이 연 도면의 id**를 쓴다 —
      // 이 화면이 그 도면을 열었다는 사실이 더 확실하다. 손상 id는 뷰어만 안다.
      const { damageId } = message as { damageId?: unknown };
      const replyOk = (filename: string) =>
        inject('mangdoPhotoResult', { requestId, ok: true, filename, uploaded: false });
      const replyFail = (reason: string) => inject('mangdoPhotoResult', { requestId, ok: false, reason });

      // 겹친 요청(앞 촬영이 끝나기 전에 속성창을 닫았다 다시 열고 또 누른 경우)은 삼키지 않고
      // 바로 답한다 — 뷰어가 새 requestId로 기다리고 있어 답이 없으면 버튼이 ⏳로 남는다.
      if (photoBusyRef.current) {
        replyFail('이미 촬영 중입니다');
        return;
      }
      photoBusyRef.current = true;
      takePhotoAndSave()
        .then((result) => {
          if (!result.ok) {
            replyFail(result.reason);
            return;
          }
          // 1. 먼저 답한다 — 사용자는 전송을 기다리지 않는다(설계 4.1). 뷰어가 번호를 칸에 붙인다.
          replyOk(result.filename);
          if (typeof damageId !== 'string' || result.uploadUri === null) {
            // 손상 id가 없거나(PC 브라우저에서 띄운 옛 뷰어) 사본을 못 만들었으면 앨범 저장까지가 끝이다.
            inject('mangdoPhotoUploadFailed', {
              requestId,
              damageId: typeof damageId === 'string' ? damageId : '',
              reason: '서버로 보낼 사본을 만들지 못했습니다',
              willRetry: false,
            });
            return;
          }
          // 2. 대기열에 넣고 바로 한 번 보낸다. 실패하면 대기열에 남아 60초마다 다시 시도한다.
          const item = enqueuePhoto({
            drawingId: drawing.id,
            damageId,
            filename: result.filename,
            uploadUri: result.uploadUri,
          });
          if (item === null) {
            // 대기열 저장 자체가 실패했다(통제관 규칙 R3) — 사진은 앨범에 남아 있지만 서버로는
            // 보내지 못한다. 다시 시도해도 같은 원인(디스크 등)일 가능성이 높다.
            inject('mangdoPhotoUploadFailed', {
              requestId,
              damageId,
              reason: '사진 전송 목록에 기록하지 못했습니다',
              willRetry: false,
            });
            return;
          }
          photoRequestsRef.current.set(item.id, requestId);
          flushPhotos();
        })
        .catch((err: unknown) => {
          // takePhotoAndSave는 내부에서 모든 실패를 이미 잡아 { ok:false } 로 돌려주지만, 만약
          // 그 밖의 예외가 새어 나와도 여기서 던지지 않고 같은 형식으로 회신한다.
          replyFail(`사진을 저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          photoBusyRef.current = false;
        });
    }
  }, [drawing.id, flushPhotos, inject]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeave();
      return true;
    });
    return () => subscription.remove();
  }, [requestLeave]);

  useEffect(() => clearPendingFlush, [clearPendingFlush]);

  // 화면이 열릴 때 한 번, 그 뒤 60초마다 보내지 못한 사진을 다시 보낸다(설계 4.4).
  useEffect(() => {
    flushPhotos();
    const timer = setInterval(flushPhotos, PHOTO_FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flushPhotos]);

  // 기기 파일 페이지는 file://이라 원본 제한을 풀고(안드로이드) 읽을 폴더를 알려 줘야(iOS)
  // 뷰어가 옆의 js·css와 모델 파일을 읽을 수 있다(설계 3.3). onHttpError는 서버로 열 때만
  // 뜻이 있다 — file://에는 상태 코드가 없다.
  const sourceProps: WebViewProps = offline
    ? {
        source: { uri: offline.pageUri },
        originWhitelist: ['*'],
        allowFileAccess: true,
        allowFileAccessFromFileURLs: true,
        allowUniversalAccessFromFileURLs: true,
        allowingReadAccessToURL: offline.readAccessUri,
        injectedJavaScriptBeforeContentLoaded: offline.injected,
      }
    : {
        source: { uri: viewerUrl(drawing.id) },
        originWhitelist: ['https://*', 'http://*'],
        onHttpError: (event) =>
          setError(`서버 응답 오류 (${event.nativeEvent.statusCode}). PC의 서버와 터널을 확인하세요.`),
      };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={requestLeave} hitSlop={12}>
          <Text style={styles.back}>‹ 목록</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {drawing.name}
        </Text>
        {offline && <Text style={styles.offlineTag}>기기 파일</Text>}
      </View>

      <View style={styles.body}>
        <WebView
          key={reloadKey}
          ref={webViewRef}
          {...sourceProps}
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
  offlineTag: {
    marginLeft: 8,
    color: '#fff',
    backgroundColor: '#2e7d32',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
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
