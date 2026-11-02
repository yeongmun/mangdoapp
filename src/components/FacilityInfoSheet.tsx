// 「구조물 정보」 아래 시트(2026-11-03) — 시설물 종류마다 서버가 준 입력 항목(infoFields)대로 칸을 그린다.
// 교량은 경간·교대·교각 수와 형식, 터널은 라이닝 형식·연장·구간 수, 상수도는 시설 구성·지 수·펌프 수 … 넣으면 서버가 필수
// 사진을 그 수만큼 펴고(교각(P1)…), 해당 없는 칸은 뺀다. 값 변환·검사는 순수 모듈 facilityInfo.ts.
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { PressScale } from './motion';
import { SegmentedTabs } from './SegmentedTabs';
import { formFromInfo, infoFromForm, type FacilityInfo, type InfoField, type InfoForm } from '../facilityInfo';
import { colors, font, space } from '../theme';

interface Props {
  visible: boolean;
  fields: InfoField[];
  info: FacilityInfo | null | undefined;
  saving: boolean;
  onClose: () => void;
  onSave: (info: FacilityInfo) => void;
}

/** 미끄럼 탭으로 그려도 글자가 안 잘리는 choice인지(4개 이하, 짧은 표시) */
function fitsSegmented(f: InfoField): boolean {
  const opts = f.options ?? [];
  return opts.length <= 4 && opts.every(([, l]) => l.length <= 7);
}

export function FacilityInfoSheet({ visible, fields, info, saving, onClose, onSave }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<InfoForm>(() => formFromInfo(fields, info));
  const [error, setError] = useState<string | null>(null);
  // 열 때마다 저장된 값으로 다시 채운다
  useEffect(() => {
    if (visible) {
      setForm(formFromInfo(fields, info));
      setError(null);
    }
  }, [visible, fields, info]);

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

  const set = (key: string, value: InfoForm[string]) => setForm((f) => ({ ...f, [key]: value }));
  const save = () => {
    const r = infoFromForm(fields, form);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    onSave(r.info);
  };

  const numbers = fields.filter((f) => f.type === 'count' || f.type === 'meter');
  const flags = fields.filter((f) => f.type === 'bool');
  const groups = fields.filter((f) => f.type === 'choice' || f.type === 'multi');

  return (
    <BottomSheet visible={visible} onClose={onClose} title="구조물 정보" description="수를 넣으면 위치마다 찍을 칸이 생기고, 해당 없는 칸은 빠져요.">
      <ScrollView style={{ maxHeight: scrollMax }} keyboardShouldPersistTaps="handled">
        {numbers.length > 0 && (
          <View style={styles.grid}>
            {numbers.map((f) => (
              <View key={f.key} style={styles.field}>
                <Text style={styles.label} numberOfLines={1}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </Text>
                <TextInput
                  style={styles.input}
                  value={String(form[f.key] ?? '')}
                  onChangeText={(t) => set(f.key, t)}
                  keyboardType={f.type === 'meter' ? 'decimal-pad' : 'number-pad'}
                  placeholder={f.required ? '0' : '선택'}
                  placeholderTextColor={colors.subtle}
                  editable={!saving}
                  accessibilityLabel={f.label}
                />
              </View>
            ))}
          </View>
        )}

        {groups.map((f) => (
          <View key={f.key}>
            <Text style={styles.group}>
              {f.label}
              {f.required ? ' *' : ''}
            </Text>
            {f.type === 'choice' && fitsSegmented(f) && form[f.key] !== '' ? (
              <SegmentedTabs options={f.options ?? []} value={String(form[f.key])} onChange={(v) => set(f.key, v)} />
            ) : (
              <View style={styles.chips}>
                {(f.options ?? []).map(([value, label]) => {
                  if (f.type === 'choice') {
                    const on = form[f.key] === value;
                    return <Chip key={value} label={label} on={on} radio onPress={() => set(f.key, on && !f.required ? '' : value)} />;
                  }
                  const list = Array.isArray(form[f.key]) ? (form[f.key] as string[]) : [];
                  const on = list.includes(value);
                  return <Chip key={value} label={label} on={on} onPress={() => set(f.key, on ? list.filter((k) => k !== value) : [...list, value])} />;
                })}
              </View>
            )}
          </View>
        ))}

        {flags.length > 0 && (
          <>
            <Text style={styles.group}>해당하면 고르기</Text>
            <View style={styles.chips}>
              {flags.map((f) => (
                <Chip key={f.key} label={f.label} on={form[f.key] === true} onPress={() => set(f.key, form[f.key] !== true)} />
              ))}
            </View>
          </>
        )}
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

function Chip({ label, on, onPress, radio = false }: { label: string; on: boolean; onPress: () => void; radio?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={radio ? 'radio' : 'checkbox'}
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
