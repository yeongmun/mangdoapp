import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>망도 손상조사 앱</Text>
      <Text style={styles.subtitle}>프로젝트 초기 화면입니다.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: '#888888',
  },
});
