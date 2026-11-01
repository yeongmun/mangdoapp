// 아래에서 올라와 자리에 「착」 붙는 시트(2026-11-01, 현대카드·카카오뱅크 레퍼런스). Alert 창 대신
// 고르기(시설물 종류)·확인(숨기기)·입력(구조물 추가)에 쓴다. 바깥(어두운 곳)을 누르거나 뒤로 가기면 닫힌다.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, space } from '../theme';
import { useReduceMotion } from './motion';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** 제목 아래 작은 설명 */
  description?: string;
  children: ReactNode;
}

export function BottomSheet({ visible, onClose, title, description, children }: Props) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  // 닫히는 움직임이 끝날 때까지 Modal을 띄워 둔다
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (reduce) v.setValue(1);
      else Animated.spring(v, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.9 }).start();
    } else if (mounted) {
      if (reduce) {
        v.setValue(0);
        setMounted(false);
      } else {
        Animated.timing(v, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && setMounted(false));
      }
    }
    // mounted는 일부러 뺀다 — visible이 바뀔 때만 움직인다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduce, v]);
  if (!mounted) return null;
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });
  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent animationType="none">
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: v }]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg, transform: [{ translateY }] }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {description ? <Text style={styles.description}>{description}</Text> : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xxl,
    paddingTop: space.md,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: space.lg },
  title: { fontFamily: font.bold, fontSize: 21, color: colors.foreground, marginBottom: space.xs },
  description: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: colors.mutedForeground, marginBottom: space.md },
});
