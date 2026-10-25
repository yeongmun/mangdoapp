import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Drawing } from './src/api';
import { DrawingListScreen } from './src/screens/DrawingListScreen';
import { ViewerScreen } from './src/screens/ViewerScreen';
import { FONT_FILES } from './src/theme';

// 글꼴(Pretendard)을 올릴 때까지 스플래시를 그대로 둔다 — 시스템 글꼴로 한 번 그렸다가 바뀌지 않게
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [opened, setOpened] = useState<Drawing | null>(null);
  const closeViewer = useCallback(() => setOpened(null), []);
  // 실패해도(파일 손상 등) 앱은 시스템 글꼴로 뜬다
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {opened ? <ViewerScreen drawing={opened} onBack={closeViewer} /> : <DrawingListScreen onOpen={setOpened} />}
    </SafeAreaProvider>
  );
}
