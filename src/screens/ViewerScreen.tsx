import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';
import type { DamageDoc, Drawing } from '../api';
import { syncDecision } from '../offlineRules';
import {
  modelUri,
  offlineRoot,
  readDamages,
  readIndex,
  viewerPageUri,
  writeDamages,
  writeIndex,
} from '../offlineStore';
import { syncOffline } from '../offlineSync';
import { takePhotoAndSave } from '../photo';
import { enqueuePhoto, flushPhotoQueue, pendingPhotoCountFor, type UploadNotice } from '../photoUpload';
import { readViewerPrefs, writeViewerPrefs } from '../viewerPrefs';

interface Props {
  drawing: Drawing;
  onBack: () => void;
}

const FLUSH_TIMEOUT_MS = 5000;
// 뷰어를 보고 있는 동안에도 서버로 보낸다(2026-09-28 설계 1.1): 30초마다, 그리고 저장 직후.
// 저장은 그리는 동안 연달아 오므로 마지막 저장 뒤 3초 조용할 때 한 번만 보낸다.
const VIEWING_SYNC_INTERVAL_MS = 30_000;
const SAVE_SYNC_DEBOUNCE_MS = 3_000;
const MISSING_FILES_MESSAGE = '기기에 도면 파일이 없습니다. 목록에서 다시 눌러 주세요.';
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

// 도면은 언제나 기기 파일로 연다(2026-09-28 설계 1.1 — 온라인 뷰어 경로는 없앴다). index에
// 없거나 꾸러미·손상 파일이 없으면 null — 화면이 "목록에서 다시 눌러 달라"고 안내한다(목록이
// 누를 때 다시 내려받는다).
function buildOfflineSource(drawing: Drawing): OfflineSource | null {
  const index = readIndex();
  const entry = index.drawings[drawing.id];
  if (entry === undefined || index.bundleVersion === null) return null;
  const doc = readDamages(drawing.id) as DamageDoc | null;
  // 기기에 손상 파일이 없으면(내려받기 도중 앱이 죽은 경우 등) 열지 않는다. 빈 문서로 열면 첫
  // 편집이 서버의 진짜 손상 기록을 통째로 덮어쓴다(최종 검토 Critical).
  if (doc === null) {
    console.error('[offline] index에는 있는데 손상 파일이 없습니다', drawing.id);
    return null;
  }
  // 뷰어(main.js)는 이 레코드에서 id·status·frames를 본다. 내려받은 도면은 언제나 변환이 끝난
  // SVF이고, frames는 목록 레코드에 없으면(오프라인 목록) 내려받을 때 저장해 둔 것을 쓴다.
  const record: Drawing = {
    ...drawing,
    status: 'success',
    viewFormat: 'svf',
    frames: drawing.frames ?? entry.frames,
  };
  const root = offlineRoot().uri;
  // 보기 방식과 이 도면의 마지막 페이지(설계 2.1). 뷰어가 틀 수에 맞춰 다시 자른다(clampPage).
  const prefs = readViewerPrefs();
  return {
    pageUri: viewerPageUri(index.bundleVersion, drawing.id),
    readAccessUri: root.endsWith('/') ? root : `${root}/`,
    injected: `window.mangdoOffline = ${embedJson({
      drawing: record,
      doc,
      modelUrl: modelUri(drawing.id, entry.model),
      viewMode: prefs.viewMode,
      pageIndex: prefs.pages[drawing.id] ?? 0,
    })}; true;`,
  };
}

// 이 도면이 서버에 아직 안 올라간 것이 있는지(설계 1.3): 로컬 손상이 서버보다 새것(push)이거나
// 사진 대기열에 이 도면 항목이 있으면 true.
function hasPendingUpload(drawingId: string): boolean {
  const entry = readIndex().drawings[drawingId];
  const damagesPending =
    entry !== undefined && syncDecision(entry.damagesUpdatedAt, entry.serverUpdatedAt) === 'push';
  return damagesPending || pendingPhotoCountFor(drawingId) > 0;
}

export function ViewerScreen({ drawing, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 기기 파일 소스는 화면에 들어올 때 만든다. `다시 시도`(reloadKey)로 페이지를 새로 띄울 때는
  // 기기의 손상 기록을 다시 읽어 주입해야 한다(그 사이 저장된 것이 있다).
  const offline = useMemo(() => buildOfflineSource(drawing), [drawing, reloadKey]);
  // 헤더 오른쪽 서버 전송 상태(설계 1.3). 이 도면에 못 올린 손상이나 대기 중인 사진이 있으면 true.
  const [uploadPending, setUploadPending] = useState(() => hasPendingUpload(drawing.id));
  const mountedRef = useRef(true);
  const saveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const refreshUploadState = useCallback(() => {
    if (mountedRef.current) setUploadPending(hasPendingUpload(drawing.id));
  }, [drawing.id]);

  const flushPhotos = useCallback(() => {
    void flushPhotoQueue(notifyUpload).finally(refreshUploadState);
  }, [notifyUpload, refreshUploadState]);

  // 뷰어를 연 채로 사진과 손상 기록을 보낸다(설계 1.1). 열어 둔 도면은 push만 한다 — 뷰어가 들고
  // 있는 문서와 기기 파일이 갈라지지 않게 pull은 건너뛴다(skipPullFor). 사진 알림은 뷰어에도
  // 보낸다(notifyUpload) — 방금 찍은 사진이 이 회차에 올라가도 뷰어가 결과를 받게.
  const syncWhileViewing = useCallback(async () => {
    try {
      await flushPhotoQueue(notifyUpload);
      await syncOffline({ skipPullFor: drawing.id });
    } catch (err) {
      // 두 함수 모두 실패를 안에서 삼키지만, 타이머에서 부르므로 혹시 새어 나와도 여기서 멈춘다.
      console.error('[viewer] 서버 전송 중 오류', err);
    }
    refreshUploadState();
  }, [drawing.id, notifyUpload, refreshUploadState]);

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
        '기기에 저장하지 못했습니다. 지금 나가면 마지막으로 그린 손상이 사라질 수 있습니다.',
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
    } else if (type === 'offlineLog') {
      // 오프라인 뷰어의 진행 단계(진단용). Metro 콘솔에서 어디까지 갔는지 본다.
      const { step, detail } = message as { step?: unknown; detail?: unknown };
      console.log('[offline-viewer]', String(step ?? ''), String(detail ?? ''));
    } else if (type === 'viewPrefs') {
      // 뷰어에서 보기 방식이나 페이지가 바뀌었다(설계 2.1). 앱을 껐다 켜도 이어 보도록 저장한다.
      const { viewMode, pageIndex } = message as { viewMode?: unknown; pageIndex?: unknown };
      if (viewMode !== 'all' && viewMode !== 'page') return;
      const prefs = readViewerPrefs();
      const pages = { ...prefs.pages };
      if (typeof pageIndex === 'number' && Number.isInteger(pageIndex) && pageIndex >= 0) {
        pages[drawing.id] = pageIndex;
      }
      writeViewerPrefs({ viewMode, pages });
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
      // 헤더를 곧바로 `연결되면 서버로 전송`으로 바꾸고, 저장이 3초 멎으면 서버로 보낸다.
      refreshUploadState();
      if (saveSyncTimerRef.current !== null) clearTimeout(saveSyncTimerRef.current);
      saveSyncTimerRef.current = setTimeout(() => {
        saveSyncTimerRef.current = null;
        void syncWhileViewing();
      }, SAVE_SYNC_DEBOUNCE_MS);
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
  }, [drawing.id, flushPhotos, inject, refreshUploadState, syncWhileViewing]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeave();
      return true;
    });
    return () => subscription.remove();
  }, [requestLeave]);

  useEffect(() => clearPendingFlush, [clearPendingFlush]);

  // 화면이 열릴 때 한 번, 그 뒤 30초마다 사진과 손상 기록을 보낸다(설계 1.1 — 예전 사진만의
  // 60초 주기를 대신한다). 언마운트되면 타이머를 모두 멈추고 이후 상태 갱신을 막는다.
  useEffect(() => {
    mountedRef.current = true;
    void syncWhileViewing();
    const timer = setInterval(() => void syncWhileViewing(), VIEWING_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      if (saveSyncTimerRef.current !== null) {
        clearTimeout(saveSyncTimerRef.current);
        saveSyncTimerRef.current = null;
      }
      mountedRef.current = false;
    };
  }, [syncWhileViewing]);

  // 기기 파일 페이지는 file://이라 원본 제한을 풀고(안드로이드) 읽을 폴더를 알려 줘야(iOS)
  // 뷰어가 옆의 js·css와 모델 파일을 읽을 수 있다(설계 3.3).
  const sourceProps: WebViewProps | null = offline
    ? {
        source: { uri: offline.pageUri },
        originWhitelist: ['*'],
        allowFileAccess: true,
        allowFileAccessFromFileURLs: true,
        allowUniversalAccessFromFileURLs: true,
        allowingReadAccessToURL: offline.readAccessUri,
        injectedJavaScriptBeforeContentLoaded: offline.injected,
      }
    : null;

  return (
    <View style={styles.container}>
      {/* 노치·상태바·가로 모드의 모서리를 피해 머리띠와 본문을 안전영역 안에 둔다 */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right },
        ]}
      >
        <Pressable onPress={requestLeave} hitSlop={12}>
          <Text style={styles.back}>‹ 목록</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {drawing.name}
        </Text>
        <Text style={[styles.uploadTag, uploadPending ? styles.uploadPending : styles.uploadDone]}>
          {uploadPending ? '연결되면 서버로 전송' : '서버 전송 완료'}
        </Text>
      </View>

      <View style={[styles.body, { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: insets.bottom }]}>
        {sourceProps === null ? (
          <View style={styles.overlay}>
            <Text style={styles.errorText}>{MISSING_FILES_MESSAGE}</Text>
            <Pressable style={styles.retry} onPress={onBack}>
              <Text style={styles.retryText}>목록으로</Text>
            </Pressable>
          </View>
        ) : (
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
        )}
        {sourceProps !== null && loading && !error && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" />
          </View>
        )}
        {sourceProps !== null && error && (
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
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d3d9',
  },
  back: { fontSize: 17, color: '#1e66f5', marginRight: 16 },
  title: { flex: 1, fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  uploadTag: {
    marginLeft: 8,
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  uploadPending: { backgroundColor: '#ef6c00' },
  uploadDone: { backgroundColor: '#2e7d32' },
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
