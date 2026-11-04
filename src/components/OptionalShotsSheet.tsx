// 「필요시 추가」 아래 시트(2026-11-04) — 해설서가 「필요시」「책임기술자 판단에 따라」·선택과업으로 둔 촬영 항목(수중조사,
// 코어채취 위치, 내시경, 재하시험 등)은 기본 목록에 없고, 현장에서 여기서 골라 필수 사진 목록에 넣는다. 빼면 안 찍은 칸만 사라진다.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { PressScale } from './motion';
import { colors, font, space } from '../theme';

export interface OptionalChoice {
  key: string;
  member: string;
  label: string;
  chosen: boolean;
  count: number;
}

interface Props {
  visible: boolean;
  choices: OptionalChoice[];
  saving: boolean;
  onClose: () => void;
  /** 고른 항목 key 전체(이 구조물에서 고를 수 없는 옛 key는 부모가 그대로 남긴다) */
  onSave: (keys: string[]) => void;
}

export function OptionalShotsSheet({ visible, choices, saving, onClose, onSave }: Props) {
  const { height } = useWindowDimensions();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(choices.filter((c) => c.chosen).map((c) => c.key)));
  useEffect(() => {
    if (visible) setPicked(new Set(choices.filter((c) => c.chosen).map((c) => c.key)));
  }, [visible, choices]);
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="필요시 추가" description="책임기술자 판단으로 하는 조사예요. 이번 과업에서 하는 것만 고르면 사진 칸이 생겨요.">
      <ScrollView style={{ maxHeight: height * 0.55 }}>
        {choices.map((c) => {
          const on = picked.has(c.key);
          return (
            <Pressable
              key={c.key}
              onPress={() => toggle(c.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${c.member} ${c.label}`}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.muted }]}
            >
              <View style={[styles.box, on && styles.boxOn]}>{on ? <Feather name="check" size={16} color={colors.onPrimary} /> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.member}>
                  {c.member}
                  {c.count > 1 ? ` · ${c.count}장` : ''}
                </Text>
                <Text style={styles.label}>{c.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <PressScale
        disabled={saving}
        onPress={() => onSave([...picked])}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        style={[styles.button, saving && styles.buttonOff]}
      >
        <Text style={styles.buttonText}>{saving ? '저장하는 중…' : '저장하기'}</Text>
      </PressScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.sm, borderRadius: 14 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  member: { fontFamily: font.semibold, fontSize: 12.5, color: colors.subtle },
  label: { fontFamily: font.bold, fontSize: 16, color: colors.foreground, marginTop: 2 },
  button: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  buttonOff: { backgroundColor: colors.border },
  buttonText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
});
