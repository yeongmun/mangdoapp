// 화면 아래에 잠깐 떴다 사라지는 알림(2026-11-01, 모니모 「삼성생명으로 이동했어요」 레퍼런스).
// App.tsx가 ToastProvider로 감싸고, 어디서든 useToast()('사진을 저장했어요')로 띄운다.
import { Feather } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, space } from '../theme';

type Show = (message: string) => void;
const ToastContext = createContext<Show>(() => undefined);

export function useToast(): Show {
  return useContext(ToastContext);
}

/** 하단 메뉴가 있으면 그 위에 뜨도록 App이 바닥 여백을 준다 */
export function ToastProvider({ children, bottomOffset = 0 }: { children: ReactNode; bottomOffset?: number }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<Show>(
    (text) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      AccessibilityInfo.announceForAccessibility(text);
      v.setValue(0);
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(v, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && setMessage(null));
      }, 2200);
    },
    [v],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message !== null && (
        <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + bottomOffset + space.lg }]}>
          <Animated.View
            accessibilityLiveRegion="polite"
            style={[styles.toast, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
          >
            <View style={styles.dot}>
              <Feather name="check" size={13} color={colors.onPrimary} />
            </View>
            <Text style={styles.text}>{message}</Text>
          </Animated.View>
        </View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: '88%',
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(25,31,40,0.92)',
  },
  dot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: font.semibold, fontSize: 14, color: '#ffffff', flexShrink: 1 },
});
