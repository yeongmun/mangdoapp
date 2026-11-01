import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Drawing } from './src/api';
import { TabBar, TAB_BAR_HEIGHT, type MainTab } from './src/components/TabBar';
import { ToastProvider } from './src/components/Toast';
import { pendingPhotoCount } from './src/photoUpload';
import { DrawingListScreen, type ListKind } from './src/screens/DrawingListScreen';
import { PhotosScreen } from './src/screens/PhotosScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { ViewerScreen } from './src/screens/ViewerScreen';
import { colors, FONT_FILES } from './src/theme';

// 글꼴(Pretendard)을 올릴 때까지 스플래시를 그대로 둔다 — 시스템 글꼴로 한 번 그렸다가 바뀌지 않게
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [opened, setOpened] = useState<Drawing | null>(null);
  const closeViewer = useCallback(() => setOpened(null), []);
  // 실패해도(파일 손상 등) 앱은 시스템 글꼴로 뜬다
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const ready = fontsLoaded || fontError !== null;

  // 하단 메뉴(2026-11-01): 과업 / 찍은 사진 / 업로드 대기. 구조물 화면은 아래에 「다음 사진 찍기」가 있어 메뉴를 숨긴다
  const [tab, setTab] = useState<MainTab>('tasks');
  const [listKind, setListKind] = useState<ListKind>('top');
  const [pending, setPending] = useState(() => pendingPhotoCount());
  const [navRequest, setNavRequest] = useState<{ projectId: string; nonce: number } | null>(null);
  const showTabBar = tab !== 'tasks' || listKind !== 'structure';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  // 안드로이드 뒤로 버튼: 다른 하단 메뉴에 있으면 과업 탭으로
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (opened || tab === 'tasks') return false;
      setTab('tasks');
      return true;
    });
    return () => sub.remove();
  }, [opened, tab]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {opened ? (
        <ToastProvider>
          <ViewerScreen drawing={opened} onBack={closeViewer} />
        </ToastProvider>
      ) : (
        <ToastProvider bottomOffset={showTabBar ? TAB_BAR_HEIGHT : 0}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* 세 화면을 모두 띄워 두고 고른 것만 보인다 — 과업 화면의 위치·스크롤이 탭을 오가도 그대로 */}
            <View style={{ flex: 1, display: tab === 'tasks' ? 'flex' : 'none' }}>
              <DrawingListScreen
                onOpen={setOpened}
                withTabBar={showTabBar}
                onKindChange={setListKind}
                onPendingChange={setPending}
                navRequest={navRequest}
                active={tab === 'tasks'}
              />
            </View>
            <View style={{ flex: 1, display: tab === 'photos' ? 'flex' : 'none' }}>
              <PhotosScreen
                active={tab === 'photos'}
                onOpenStructure={(projectId) => {
                  setNavRequest({ projectId, nonce: Date.now() });
                  setTab('tasks');
                }}
              />
            </View>
            <View style={{ flex: 1, display: tab === 'queue' ? 'flex' : 'none' }}>
              <QueueScreen active={tab === 'queue'} onChanged={setPending} />
            </View>
            {showTabBar && <TabBar value={tab} onChange={setTab} queueCount={pending} />}
          </View>
        </ToastProvider>
      )}
    </SafeAreaProvider>
  );
}
