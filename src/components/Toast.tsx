// 화면 아래에 잠깐 떴다 사라지는 알림(2026-11-01, 모니모 「삼성생명으로 이동했어요」 레퍼런스).
// App.tsx가 ToastProvider로 감싸고, 어디서든 useToast()('사진을 저장했어요')로 띄운다.
import { Feather } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, space } from '../theme';

/** action: 오른쪽 파란 글자 버튼(구글 Tasks 「실행취소」 레퍼런스, 2026-11-02). 있으면 조금 더 오래 떠 있다 */
export interface ToastOptions {
  action?: { label: string; onPress: () => void };
  durationMs?: number;
}
type Show = (message: string, options?: ToastOptions) => void;
const ToastContext = createContext<Show>(() => undefined);

export function useToast(): Show {
  return useContext(ToastContext);
}

/** 하단 메뉴가 있으면 그 위에 뜨도록 App이 바닥 여백을 준다 */
export function ToastProvider({ children, bottomOffset = 0 }: { children: ReactNode; bottomOffset?: number }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<ToastOptions['action'] | null>(null);
  const v = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<Show>(
    (text, options) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(text);
      setAction(options?.action ?? null);
      AccessibilityInfo.announceForAccessibility(text);
      v.setValue(0);
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(v, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && setMessage(null));
      }, options?.durationMs ?? (options?.action ? 4500 : 2200));
    },
    [v],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message !== null && (
        <View pointerEvents={action ? 'box-none' : 'none'} style={[styles.wrap, { bottom: insets.bottom + bottomOffset + space.lg }]}>
          <Animated.View
            accessibilityLiveRegion="polite"
            style={[styles.toast, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
          >
            <View style={styles.dot}>
              <Feather name="check" size={13} color={colors.onPrimary} />
            </View>
            <Text style={styles.text}>{message}</Text>
            {action && (
              <Pressable
                onPress={() => {
                  // 먼저 닫고 나서 실행한다 — 실행이 새 토스트를 띄우면 그게 보이게
                  if (timer.current) clearTimeout(timer.current);
                  setAction(null);
                  setMessage(null);
                  action.onPress();
                }}
                hitSlop={12}
                accessibilityRole="button"
                style={styles.actionBtn}
              >
                <Text style={styles.actionText}>{action.label}</Text>
              </Pressable>
            )}
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
  actionBtn: { marginLeft: space.sm, paddingVertical: 2 },
  actionText: { fontFamily: font.bold, fontSize: 14, color: '#64a8ff' },
});
