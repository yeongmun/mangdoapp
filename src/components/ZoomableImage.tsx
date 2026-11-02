// 크게 보기 화면의 사진 한 장(2026-11-02, 아이폰 사진 앱 레퍼런스). 새 네이티브 모듈 없이 PanResponder로:
// - 두 손가락 벌리기 = 확대(최대 4배), 두 번 톡 = 2.5배 ↔ 원래대로
// - 확대한 채 한 손가락 = 사진 옮기기(이때는 옆 사진으로 안 넘어간다 — onZoomChange로 목록 스크롤을 끈다)
// - 확대 안 한 채 아래로 끌기 = 닫기(dragY를 부모가 받아 배경을 옅게 한다)
// 한 번 톡은 부모의 onTap(위아래 막대 숨기기/보이기).
import { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type ImageSourcePropType } from 'react-native';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 260;
const DISMISS_DISTANCE = 120;

type Source = ImageSourcePropType | null;

interface Props {
  /** 먼저 보일 작은 사진(기기 사본·썸네일) */
  base: Source;
  /** 그 위에 겹칠 원본(서버). 못 받으면 base만 보인다 */
  full?: Source;
  width: number;
  height: number;
  /** 부모가 배경 투명도에 쓴다. 이 컴포넌트가 setValue한다 */
  dragY: Animated.Value;
  onZoomChange: (zoomed: boolean) => void;
  onDismiss: () => void;
  onTap: () => void;
  accessibilityLabel?: string;
}

function distance(e: GestureResponderEvent): number {
  const [a, b] = e.nativeEvent.touches;
  if (!a || !b) return 0;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

export function ZoomableImage({ base, full, width, height, dragY, onZoomChange, onDismiss, onTap, accessibilityLabel }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  // 손을 대기 시작할 때의 값과 지금 값(Animated 값은 바로 못 읽어서 따로 들고 있다)
  const cur = useRef({ scale: 1, tx: 0, ty: 0 });
  const start = useRef({ scale: 1, tx: 0, ty: 0, dist: 0, mode: 'none' as 'none' | 'pinch' | 'pan' | 'dismiss' });
  const lastTap = useRef(0);

  const clampPan = (s: number, x: number, y: number) => {
    const maxX = ((s - 1) * width) / 2;
    const maxY = ((s - 1) * height) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };

  const animateTo = (s: number, x: number, y: number) => {
    cur.current = { scale: s, tx: x, ty: y };
    onZoomChange(s > 1.01);
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, speed: 20, bounciness: 2 }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, speed: 20, bounciness: 2 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, speed: 20, bounciness: 2 }),
    ]).start();
  };

  const wantsMove = (e: GestureResponderEvent, dx: number, dy: number) => {
    if (e.nativeEvent.touches.length >= 2) return true;
    if (cur.current.scale > 1.01) return Math.abs(dx) + Math.abs(dy) > 4;
    // 확대 안 했으면 「아래로 끌기」만 잡고, 옆으로 미는 건 목록(옆 사진 넘기기)에 맡긴다
    return dy > 10 && Math.abs(dy) > Math.abs(dx) * 1.5;
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // 두 번째 손가락이 닿는 순간 잡는다 — 움직이기 전에 옆 넘기기(목록)가 가져가지 않게
        onStartShouldSetPanResponderCapture: (e) => e.nativeEvent.touches.length >= 2,
        // 안쪽 Pressable(톡)이 먼저 잡고 있어도 움직이기 시작하면 가져온다(Capture 단계)
        onMoveShouldSetPanResponderCapture: (e, g) => wantsMove(e, g.dx, g.dy),
        onMoveShouldSetPanResponder: (e, g) => wantsMove(e, g.dx, g.dy),
        onPanResponderTerminationRequest: () => start.current.mode === 'none',
        onPanResponderGrant: (e) => {
          const two = e.nativeEvent.touches.length >= 2;
          start.current = {
            ...cur.current,
            dist: two ? distance(e) : 0,
            mode: two ? 'pinch' : cur.current.scale > 1.01 ? 'pan' : 'dismiss',
          };
        },
        onPanResponderMove: (e, g) => {
          const st = start.current;
          if (e.nativeEvent.touches.length >= 2) {
            const d = distance(e);
            if (st.mode !== 'pinch' || st.dist === 0) {
              // 한 손가락으로 시작했다가 두 번째 손가락이 닿음
              start.current = { ...cur.current, dist: d, mode: 'pinch' };
              dragY.setValue(0);
              return;
            }
            const s = Math.max(0.8, Math.min(MAX_SCALE, (st.scale * d) / st.dist));
            const p = clampPan(s, st.tx, st.ty);
            cur.current = { scale: s, tx: p.x, ty: p.y };
            scale.setValue(s);
            tx.setValue(p.x);
            ty.setValue(p.y);
            return;
          }
          if (st.mode === 'pan' || (st.mode === 'pinch' && cur.current.scale > 1.01)) {
            const p = clampPan(cur.current.scale, st.tx + g.dx, st.ty + g.dy);
            cur.current = { ...cur.current, tx: p.x, ty: p.y };
            tx.setValue(p.x);
            ty.setValue(p.y);
            return;
          }
          if (st.mode === 'dismiss') dragY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          const st = start.current;
          start.current = { ...start.current, mode: 'none' };
          if (st.mode === 'dismiss') {
            if (g.dy > DISMISS_DISTANCE || g.vy > 1.2) onDismiss();
            else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
            return;
          }
          if (cur.current.scale <= 1.05) animateTo(1, 0, 0);
          else onZoomChange(true);
        },
        onPanResponderTerminate: () => {
          start.current = { ...start.current, mode: 'none' };
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
          if (cur.current.scale <= 1.05) animateTo(1, 0, 0);
        },
      }),
    // width/height가 바뀌면(화면 돌림) 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height],
  );

  const onPress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (cur.current.scale > 1.01) animateTo(1, 0, 0);
      else animateTo(DOUBLE_TAP_SCALE, 0, 0);
      return;
    }
    lastTap.current = now;
    // 두 번째 톡을 기다렸다가 한 번 톡으로 처리한다
    setTimeout(() => {
      if (lastTap.current === now) onTap();
    }, DOUBLE_TAP_MS);
  };

  const transform = [{ translateX: tx }, { translateY: Animated.add(ty, dragY) }, { scale }];
  return (
    <View style={{ width, height, overflow: 'hidden' }} {...responder.panHandlers}>
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill} accessibilityRole="image" accessibilityLabel={accessibilityLabel} accessibilityHint="두 번 톡 하면 확대, 아래로 끌면 닫기">
        <Animated.View style={[StyleSheet.absoluteFill, { transform }]}>
          {base ? <Animated.Image source={base} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
          {full ? <Animated.Image source={full} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}
