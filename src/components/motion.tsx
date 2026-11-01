// 움직임 부품(2026-11-01, 사용자 레퍼런스 영상: 토스·모니모·현대카드·카카오뱅크).
// - PressScale: 누르는 동안 카드가 살짝 작아지고 안의 사진(ZoomImage)은 살짝 커졌다 돌아온다
// - CheckPop: ✓가 생길 때 톡 튀어나온다
// - AnimatedBar: 진행 막대가 차오른다
// - FadeSlideIn: 탭을 바꾸면 내용이 옆에서 밀려 들어온다
// - Skeleton: 불러오는 동안 회색 뼈대가 숨 쉬듯 깜빡인다
// 전부 RN Animated(네이티브 드라이버)만 쓴다 — 새 네이티브 모듈 없음. 「동작 줄이기」가 켜져 있으면 움직이지 않는다.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  View,
  type ImageStyle,
  type ImageSourcePropType,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme';

/** 기기 설정 「동작 줄이기」 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

const PressContext = createContext<Animated.Value | null>(null);
// Pressable 자체를 움직인다 — 바깥에 감싸는 View가 없어야 flex·너비 스타일이 그대로 먹는다
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** 눌렸을 때 크기(기본 0.97) */
  to?: number;
};

/** 누르는 동안 살짝 작아지는 카드·버튼. 안에 ZoomImage가 있으면 그 사진은 반대로 살짝 커진다 */
export function PressScale({ style, children, to = 0.97, onPressIn, onPressOut, ...rest }: PressScaleProps) {
  const reduce = useReduceMotion();
  const press = useRef(new Animated.Value(0)).current;
  const run = (v: number) => {
    if (reduce) return;
    Animated.spring(press, { toValue: v, useNativeDriver: true, speed: 40, bounciness: v === 0 ? 6 : 0 }).start();
  };
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, to] });
  return (
    <AnimatedPressable
      {...rest}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={(e) => {
        run(1);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        run(0);
        onPressOut?.(e);
      }}
    >
      <PressContext.Provider value={press}>{children}</PressContext.Provider>
    </AnimatedPressable>
  );
}

/** PressScale 안에서 누를 때 살짝 커지는 사진(카드 안 사진이 화면 쪽으로 다가오는 느낌) */
export function ZoomImage({ source, style }: { source: ImageSourcePropType; style?: StyleProp<ImageStyle> }) {
  const press = useContext(PressContext);
  const scale = press ? press.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) : 1;
  return <Animated.Image source={source} style={[style, { transform: [{ scale }] }]} resizeMode="cover" />;
}

/** taken이 false→true로 바뀌는 순간 톡 튀어나온다. 처음부터 true면 그냥 보인다 */
export function CheckPop({ visible, children, style }: { visible: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const prev = useRef(visible);
  useEffect(() => {
    if (visible && !prev.current) {
      if (reduce) v.setValue(1);
      else {
        v.setValue(0);
        Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
      }
    } else if (!visible) v.setValue(0);
    prev.current = visible;
  }, [visible, reduce, v]);
  if (!visible) return null;
  return <Animated.View style={[style, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>{children}</Animated.View>;
}

/** 진행 막대(0~1). 값이 바뀌면 차오른다 */
export function AnimatedBar({ ratio, height = 8, color = colors.primary, track = colors.border }: { ratio: number; height?: number; color?: string; track?: string }) {
  const reduce = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const v = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    if (reduce) v.setValue(clamped);
    else Animated.timing(v, { toValue: clamped, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [clamped, reduce, v]);
  const width = v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={{ height, borderRadius: height / 2, backgroundColor: color, width }} />
    </View>
  );
}

/** 처음 그려질 때(또는 key가 바뀔 때) 옆에서 살짝 밀려 들어온다. direction: 1이면 오른쪽에서, -1이면 왼쪽에서 */
export function FadeSlideIn({ children, direction = 1, style }: { children: ReactNode; direction?: 1 | -1; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, v]);
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [18 * direction, 0] });
  return <Animated.View style={[{ flex: 1, opacity: v, transform: [{ translateX }] }, style]}>{children}</Animated.View>;
}

/** 불러오는 동안 보이는 회색 뼈대 한 칸 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return <Animated.View style={[{ backgroundColor: colors.border, borderRadius: 10, opacity: v }, style]} />;
}
