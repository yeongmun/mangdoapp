// 「구조물 정보」 아래 시트(2026-11-03) — 교량의 경간·교대·교각·신축이음 수와 형식을 넣으면 서버가 필수 사진을
// 그 수만큼 펴고(교각(P1)…), 형식에 맞지 않는 칸(케이블·강바닥판…)은 뺀다. 값 변환·검사는 순수 모듈 facilityInfo.ts.
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { PressScale } from './motion';
import { SegmentedTabs } from './SegmentedTabs';
import {
  CLASS_OPTIONS,
  COUNT_FIELDS,
  DECK_OPTIONS,
  FLAG_OPTIONS,
  formFromInfo,
  GIRDER_OPTIONS,
  infoFromForm,
  METER_FIELDS,
  PUBLIC_USE_OPTIONS,
  type FacilityInfo,
  type InfoForm,
} from '../facilityInfo';
import { colors, font, space } from '../theme';

interface Props {
  visible: boolean;
  info: FacilityInfo | null | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (info: FacilityInfo) => void;
}

export function FacilityInfoSheet({ visible, info, saving, onClose, onSave }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 키보드가 올라오면 시트가 그만큼 밀려 올라간다(BottomSheet의 KeyboardAvoidingView). 입력 영역 높이를
  // 키보드 뺀 남은 높이에 맞춰 줄여야 제목·입력칸이 화면 위로 넘어가지 않는다(11-03 아이폰).
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // 손잡이·제목·설명·오류·저장 버튼·아래 여백 ≈ 280 + 위아래 안전 영역
  const chrome = 280 + insets.top + insets.bottom;
  const scrollMax = Math.max(140, Math.min(height * 0.6, height - keyboard - chrome));
  const [form, setForm] = useState<InfoForm>(() => formFromInfo(info));
  const [error, setError] = useState<string | null>(null);
  // 열 때마다 저장된 값으로 다시 채운다
  useEffect(() => {
    if (visible) {
      setForm(formFromInfo(info));
      setError(null);
    }
  }, [visible, info]);

  const set = <K extends keyof InfoForm>(key: K, value: InfoForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = () => {
    const r = infoFromForm(form);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onSave(r.info);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="구조물 정보" description="경간·교각마다 찍을 칸이 생기고, 형식에 맞지 않는 칸은 빠져요.">
      <ScrollView style={{ maxHeight: scrollMax }} keyboardShouldPersistTaps="handled">
        <View style={styles.grid}>
          {[...COUNT_FIELDS, ...METER_FIELDS].map(([key, label]) => (
            <View key={key} style={styles.field}>
              <Text style={styles.label}>{label}</Text>
              <TextInput
                style={styles.input}
                value={form[key]}
                onChangeText={(t) => set(key, t)}
                keyboardType={key === 'length' || key === 'maxSpan' ? 'decimal-pad' : 'number-pad'}
                placeholder={key === 'length' || key === 'maxSpan' ? '선택' : '0'}
                placeholderTextColor={colors.subtle}
                editable={!saving}
                accessibilityLabel={label}
              />
            </View>
          ))}
        </View>

        <Text style={styles.group}>바닥판</Text>
        <SegmentedTabs options={DECK_OPTIONS} value={form.deck} onChange={(v) => set('deck', v)} />
        <Text style={styles.group}>거더</Text>
        <SegmentedTabs options={GIRDER_OPTIONS} value={form.girder} onChange={(v) => set('girder', v)} />
        <Text style={styles.group}>시설물 종별</Text>
        <SegmentedTabs options={CLASS_OPTIONS} value={form.facilityClass} onChange={(v) => set('facilityClass', v)} />

        <Text style={styles.group}>해당하면 고르기</Text>
        <View style={styles.chips}>
          {FLAG_OPTIONS.map(([key, label]) => (
            <Chip key={key} label={label} on={form[key]} onPress={() => set(key, !form[key])} />
          ))}
        </View>
        <Text style={styles.group}>공중이 이용하는 부위</Text>
        <View style={styles.chips}>
          {PUBLIC_USE_OPTIONS.map(([key, label]) => {
            const on = form.publicUse.includes(key);
            return <Chip key={key} label={label} on={on} onPress={() => set('publicUse', on ? form.publicUse.filter((k) => k !== key) : [...form.publicUse, key])} />;
          })}
        </View>
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PressScale
        disabled={saving}
        onPress={save}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving }}
        style={[styles.button, saving && styles.buttonOff]}
      >
        <Text style={styles.buttonText}>{saving ? '저장하는 중…' : '저장하기'}</Text>
      </PressScale>
    </BottomSheet>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.75 }]}
    >
      {on ? <Feather name="check" size={15} color={colors.primaryText} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  field: { width: '48%' },
  label: { fontFamily: font.semibold, fontSize: 13, color: colors.mutedForeground, marginBottom: 4, paddingLeft: 4 },
  input: { minHeight: 50, paddingHorizontal: space.lg, borderRadius: 14, backgroundColor: colors.muted, fontFamily: font.semibold, fontSize: 17, color: colors.foreground },
  group: { fontFamily: font.bold, fontSize: 14, color: colors.ink2, marginTop: space.lg, marginBottom: space.sm, paddingLeft: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.muted },
  chipOn: { backgroundColor: colors.primarySoft },
  chipText: { fontFamily: font.semibold, fontSize: 14, color: colors.ink2 },
  chipTextOn: { fontFamily: font.bold, color: colors.primaryText },
  error: { fontFamily: font.semibold, fontSize: 14, color: colors.destructive, marginTop: space.md },
  button: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  buttonOff: { backgroundColor: colors.border },
  buttonText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
});
