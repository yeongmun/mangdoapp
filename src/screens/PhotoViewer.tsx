// 찍은 사진 크게 보기(2026-11-02, 아이폰 사진 앱 레퍼런스). 「찍은 사진」 격자에서 한 장을 누르면 열린다.
// - 옆으로 밀어 다음/이전 사진, 아래 작은 사진 줄로 바로 가기
// - 두 손가락 확대·두 번 톡 확대, 아래로 끌어 닫기(ZoomableImage)
// - 한 번 톡: 위아래 막대 숨기기/보이기
// - [구조물로 가기]: 그 사진을 찍은 구조물 화면으로
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Image, Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shotPhotoSource, shotThumbSource } from '../api';
import { ZoomableImage } from '../components/ZoomableImage';
import { useReduceMotion } from '../components/motion';
import type { RecentPhoto } from '../homeSummary';
import { colors, font, space } from '../theme';

const STRIP_THUMB = 44;

function whenLabel(at: number): string {
  if (!at) return '날짜 모름';
  const d = new Date(at);
  return `${d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} ${d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}`;
}

interface Props {
  photos: RecentPhoto[];
  startIndex: number;
  onClose: () => void;
  onOpenStructure: (projectId: string) => void;
}

export function PhotoViewer({ photos, startIndex, onClose, onOpenStructure }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [index, setIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const [chrome, setChrome] = useState(true);
  const pager = useRef<FlatList<RecentPhoto>>(null);
  const strip = useRef<FlatList<RecentPhoto>>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  // 열 때: 배경이 어두워지며 사진이 살짝 커지며 자리 잡는다(격자에서 튀어나오는 느낌)
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(enter, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, reduce]);

  const close = () => {
    if (reduce) {
      onClose();
      return;
    }
    Animated.timing(enter, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  };

  // 태블릿을 돌리면 폭이 바뀐다 — 보던 사진에 다시 맞춘다
  useEffect(() => {
    pager.current?.scrollToIndex({ index, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const photo = photos[index] ?? photos[0];
  useEffect(() => {
    strip.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [index]);
  if (!photo) return null;

  const backdrop = Animated.multiply(enter, dragY.interpolate({ inputRange: [0, 300], outputRange: [1, 0.2], extrapolate: 'clamp' }));
  const pageScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const chromeOpacity = chrome ? 1 : 0;

  const jump = (i: number) => {
    pager.current?.scrollToIndex({ index: i, animated: false });
    setIndex(i);
    setZoomed(false);
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: enter, transform: [{ scale: pageScale }] }]}>
        <FlatList
          ref={pager}
          data={photos}
          horizontal
          pagingEnabled
          scrollEnabled={!zoomed}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(p) => `${p.projectId}-${p.shot.id}`}
          windowSize={3}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <ZoomableImage
              base={item.localUri ? { uri: item.localUri } : shotThumbSource(item.shot)}
              full={item.localUri ? null : shotPhotoSource(item.shot)}
              width={width}
              height={height}
              dragY={dragY}
              onZoomChange={setZoomed}
              onDismiss={close}
              onTap={() => setChrome((v) => !v)}
              accessibilityLabel={`${item.projectName} ${item.shot.member} ${item.shot.label}`}
            />
          )}
        />
      </Animated.View>

      {/* 위 막대 */}
      <Animated.View pointerEvents={chrome ? 'box-none' : 'none'} style={[styles.top, { paddingTop: insets.top + space.sm, opacity: Animated.multiply(enter, chromeOpacity) }]}>
        <Pressable onPress={close} style={styles.round} accessibilityRole="button" accessibilityLabel="닫기" hitSlop={8}>
          <Feather name="chevron-left" size={24} color="#ffffff" />
        </Pressable>
        <View style={styles.titlePill}>
          <Text style={styles.titleText} numberOfLines={1}>
            {whenLabel(photo.at)}
          </Text>
        </View>
        <Text style={styles.count}>
          {index + 1} / {photos.length}
        </Text>
      </Animated.View>

      {/* 아래: 설명 · 작은 사진 줄 · 구조물로 가기 */}
      <Animated.View pointerEvents={chrome ? 'box-none' : 'none'} style={[styles.bottom, { paddingBottom: insets.bottom + space.md, opacity: Animated.multiply(enter, chromeOpacity) }]}>
        <Text style={styles.caption} numberOfLines={1}>
          {photo.projectName} · {photo.shot.member} · {photo.shot.label}
          {photo.localUri ? '  ·  아직 안 올라감' : ''}
        </Text>
        <FlatList
          ref={strip}
          data={photos}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => `s-${p.projectId}-${p.shot.id}`}
          getItemLayout={(_, i) => ({ length: STRIP_THUMB + 4, offset: (STRIP_THUMB + 4) * i, index: i })}
          initialScrollIndex={Math.max(0, startIndex - 3)}
          renderItem={({ item, index: i }) => {
            const src = item.localUri ? { uri: item.localUri } : shotThumbSource(item.shot);
            return (
              <Pressable onPress={() => jump(i)} accessibilityRole="button" accessibilityLabel={`${i + 1}번째 사진`} style={[styles.thumb, i === index && styles.thumbOn]}>
                {src ? <Image source={src} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
              </Pressable>
            );
          }}
        />
        <Pressable
          onPress={() => {
            onClose();
            onOpenStructure(photo.projectId);
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.go, pressed && { opacity: 0.8 }]}
        >
          <Feather name="folder" size={17} color="#ffffff" />
          <Text style={styles.goText}>구조물로 가기</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, gap: space.sm },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  titlePill: { flexShrink: 1, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  titleText: { fontFamily: font.semibold, fontSize: 13, color: '#ffffff' },
  count: { minWidth: 40, textAlign: 'right', fontFamily: font.semibold, fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: space.md, paddingTop: space.md, backgroundColor: 'rgba(0,0,0,0.35)' },
  caption: { paddingHorizontal: space.xl, fontFamily: font.semibold, fontSize: 14, color: '#ffffff', textAlign: 'center' },
  thumb: { width: STRIP_THUMB, height: STRIP_THUMB, marginHorizontal: 2, borderRadius: 6, overflow: 'hidden', backgroundColor: '#333', opacity: 0.6 },
  thumbOn: { opacity: 1, borderWidth: 2, borderColor: '#ffffff', transform: [{ scale: 1.08 }] },
  go: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: space.xl, borderRadius: 22, backgroundColor: colors.primary },
  goText: { fontFamily: font.bold, fontSize: 15, color: '#ffffff' },
});
