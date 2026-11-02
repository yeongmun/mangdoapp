// 인터넷이 끊기고 다시 이어지는 것을 알린다(2026-11-02, MYBOX 「셀룰러로 전환되어 자동 올리기 일시 중지」 레퍼런스).
// - 끊겨 있는 동안: 하단 메뉴 바로 위에 어두운 줄 「인터넷 연결 없음 · 찍은 사진은 연결되면 저절로 올라가요」
// - 다시 이어지면: 멈춰 있던 사진까지 바로 보내고(기다림 간격 초기화) 토스트로 알린다
// 사용자 결정(2026-11-02): 데이터(셀룰러)여도 늘 올린다 — 현장엔 와이파이가 없다.
import { Feather } from '@expo/vector-icons';
import { useNetworkState } from 'expo-network';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { flushPhotoQueue, pendingPhotoCount, retryPendingPhotos } from '../photoUpload';
import { colors, font, space } from '../theme';
import { useToast } from './Toast';

/**
 * 연결돼 있는지. 모르는 값(undefined)은 연결된 것으로 본다 — 처음 읽기 전에 줄이 깜빡이지 않게.
 * isInternetReachable은 안 본다: 안드로이드는 자체 확인이 막힌 회사 와이파이에서 늘 false라 cloudflared로 잘
 * 올라가는데도 「끊김」으로 보인다. 와이파이↔LTE 바뀔 때 잠깐 끊기는 것도 무시하게 2초 지켜본 뒤 바꾼다.
 */
export function useOnline(): boolean {
  const raw = useNetworkState().isConnected !== false;
  const [online, setOnline] = useState(raw);
  useEffect(() => {
    if (raw === online) return;
    const t = setTimeout(() => setOnline(raw), 2000);
    return () => clearTimeout(t);
  }, [raw, online]);
  return online;
}

export const OFFLINE_STRIP_HEIGHT = 40;

export function NetworkWatch({ online, showStrip, onFlushed }: { online: boolean; showStrip: boolean; onFlushed?: () => void }) {
  const toast = useToast();
  const was = useRef(online);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (was.current === online) return;
    was.current = online;
    if (!online) {
      // 앱을 켤 때부터 끊겨 있었으면 줄만 보이고 알림은 안 띄운다
      if (Date.now() - startedAt.current < 4000) return;
      toast('인터넷이 끊겼어요 · 찍은 사진은 폰에 모아 둘게요');
      return;
    }
    const pending = pendingPhotoCount();
    if (pending === 0) return;
    toast(`인터넷이 다시 연결됐어요 · ${pending}장 올릴게요`);
    retryPendingPhotos();
    void flushPhotoQueue(() => undefined).finally(() => onFlushed?.());
  }, [online, toast, onFlushed]);

  if (online || !showStrip) return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert" accessibilityLabel="인터넷 연결 없음. 찍은 사진은 연결되면 저절로 올라가요">
      <View style={styles.strip}>
        <Feather name="wifi-off" size={14} color="#ffffff" />
        <Text style={styles.text} numberOfLines={1}>
          인터넷 연결 없음 · 찍은 사진은 연결되면 저절로 올라가요
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: OFFLINE_STRIP_HEIGHT, paddingHorizontal: space.lg, justifyContent: 'center', backgroundColor: colors.background },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: space.md, borderRadius: 16, backgroundColor: colors.foreground },
  text: { fontFamily: font.semibold, fontSize: 12.5, color: '#ffffff', flexShrink: 1 },
});
