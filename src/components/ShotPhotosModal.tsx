// 한 칸의 사진 보기(2026-11-05, 한 칸 여러 장). 찍은 칸을 누르면(전차 사진은 길게 누르면) 열린다.
// - 옆으로 넘겨 한 장씩, 아래 작은 사진 줄
// - [한 장 더 찍기] → 그 칸으로 카메라
// - [대표로] → 칸 썸네일·보고서 사진첩의 기본 사진(서버에 올라간 사진만)
// - [예시로] → 이 항목의 예시 사진(같은 시설물 종류의 모든 구조물 같은 칸, 카메라 오른쪽 위에 보인다)
// - [지우기] → 이 사진만(안 올라간 사진은 대기열에서 뺀다)
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Shot } from '../api';
import type { ShotPhotoView } from '../useShots';
import { colors, font, space } from '../theme';

interface Props {
  shot: Shot;
  photos: ShotPhotoView[];
  /** 필수 사진이면 예시로 지정할 수 있다 */
  canSetExample: boolean;
  onClose: () => void;
  onShootMore: () => void;
  onDelete: (item: ShotPhotoView) => Promise<boolean>;
  onMakePrimary: (photoId: string) => Promise<void>;
  onSetExample: (photoId: string | null) => Promise<void>;
}

export function ShotPhotosModal({ shot, photos, canSetExample, onClose, onShootMore, onDelete, onMakePrimary, onSetExample }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const pager = useRef<FlatList<ShotPhotoView>>(null);
  // 지워서 줄면 자리를 맞춘다
  useEffect(() => {
    if (index > photos.length - 1) setIndex(Math.max(0, photos.length - 1));
  }, [photos.length, index]);
  const current = photos[Math.min(index, photos.length - 1)];

  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!current) return;
    Alert.alert('사진 지우기', photos.length > 1 ? '이 사진 한 장만 지워요.' : '이 칸의 마지막 사진이에요. 지우면 안 찍은 칸이 돼요.', [
      { text: '취소', style: 'cancel' },
      { text: '지우기', style: 'destructive', onPress: () => void run(() => onDelete(current)) },
    ]);
  };

  const goTo = (i: number) => {
    setIndex(i);
    pager.current?.scrollToIndex({ index: i, animated: true });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={10} style={styles.round}>
            <Feather name="x" size={22} color="#ffffff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {shot.member} · {shot.label}
            </Text>
            <Text style={styles.sub}>
              No. {shot.number} · {photos.length > 0 ? `${Math.min(index, photos.length - 1) + 1} / ${photos.length}` : '사진 없음'}
              {current?.primary ? ' · 대표' : ''}
              {current && !current.onServer ? ' · 올리기 전' : ''}
            </Text>
          </View>
        </View>

        <FlatList
          ref={pager}
          data={photos}
          keyExtractor={(p) => p.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => (
            <View style={{ width, flex: 1, justifyContent: 'center' }}>
              <Image source={item.source} style={{ width, height: '100%' }} resizeMode="contain" accessibilityLabel={item.primary ? '대표 사진' : '사진'} />
            </View>
          )}
          style={{ flex: 1 }}
        />

        <FlatList
          data={photos}
          keyExtractor={(p) => `t-${p.key}`}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          renderItem={({ item, index: i }) => (
            <Pressable onPress={() => goTo(i)} accessibilityRole="button" accessibilityLabel={`${i + 1}번째 사진`} style={[styles.stripItem, i === index && styles.stripItemOn]}>
              <Image source={item.thumb} style={StyleSheet.absoluteFill} resizeMode="cover" />
              {item.primary ? <Text style={styles.primaryTag}>대표</Text> : null}
            </Pressable>
          )}
        />

        <View style={[styles.actions, { paddingBottom: insets.bottom + space.md }]}>
          <Action icon="camera" label="한 장 더" onPress={onShootMore} disabled={busy} />
          <Action
            icon="star"
            label="대표로"
            onPress={() => current?.photoId && void run(async () => {
              await onMakePrimary(current.photoId!);
              goTo(0); // 대표는 맨 앞으로 간다 — 그 사진을 계속 보여 준다
            })}
            disabled={busy || !current || current.primary || !current.onServer || !current.photoId}
          />
          {canSetExample ? (
            shot.exampleUrl ? (
              <Action icon="image" label="예시 바꾸기" onPress={() => exampleMenu(current, run, onSetExample)} disabled={busy} />
            ) : (
              <Action icon="image" label="예시로" onPress={() => current?.photoId && void run(() => onSetExample(current.photoId!))} disabled={busy || !current?.onServer || !current?.photoId} />
            )
          ) : null}
          <Action icon="trash-2" label="지우기" onPress={confirmDelete} disabled={busy || !current} danger />
        </View>
      </View>
    </Modal>
  );
}

/** 예시가 이미 있을 때: 바꾸기/빼기 고르기 */
function exampleMenu(current: ShotPhotoView | undefined, run: (t: () => Promise<unknown>) => Promise<void>, onSetExample: (photoId: string | null) => Promise<void>) {
  Alert.alert('예시 사진', '이 항목에는 이미 예시가 있어요.', [
    { text: '취소', style: 'cancel' },
    { text: '예시 빼기', style: 'destructive', onPress: () => void run(() => onSetExample(null)) },
    ...(current?.onServer && current.photoId ? [{ text: '이 사진으로 바꾸기', onPress: () => void run(() => onSetExample(current.photoId!)) }] : []),
  ]);
}

function Action({ icon, label, onPress, disabled, danger }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }, disabled && { opacity: 0.35 }]}
    >
      <Feather name={icon} size={20} color={danger ? '#ff6b6b' : '#ffffff'} />
      <Text style={[styles.actionText, danger && { color: '#ff6b6b' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font.bold, fontSize: 16, color: '#ffffff' },
  sub: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  strip: { gap: 6, paddingHorizontal: space.lg, paddingVertical: space.md },
  stripItem: { width: 52, height: 52, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#222' },
  stripItemOn: { borderColor: colors.primary },
  primaryTag: { position: 'absolute', left: 2, bottom: 2, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.primary, fontFamily: font.bold, fontSize: 10, color: '#ffffff' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: space.sm, paddingTop: space.sm },
  action: { alignItems: 'center', gap: 4, minWidth: 64, minHeight: 52, justifyContent: 'center' },
  actionText: { fontFamily: font.semibold, fontSize: 12, color: '#ffffff' },
});
