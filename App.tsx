import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Drawing } from './src/api';
import { DrawingListScreen } from './src/screens/DrawingListScreen';
import { ViewerScreen } from './src/screens/ViewerScreen';

export default function App() {
  const [opened, setOpened] = useState<Drawing | null>(null);
  const closeViewer = useCallback(() => setOpened(null), []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {opened ? <ViewerScreen drawing={opened} onBack={closeViewer} /> : <DrawingListScreen onOpen={setOpened} />}
    </SafeAreaProvider>
  );
}
