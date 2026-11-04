// 「사진 한 장」 화면(2026-11-01 3차 시안 4번, 사용자 결정: 전차 사진 카드의 보고서 사진을 누르면 뜬다).
// 보고서 사진을 크게 보고 옆으로 넘기며 같은 자리를 확인한 뒤 [사진 찍기]. 카메라는 이 화면을 닫고 연다
// (모달 위에 카메라를 띄우면 iOS에서 안 뜨는 경우가 있다).
import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Shot } from '../api';
import { PressScale } from '../components/motion';
import { colors, font, radius, space } from '../theme';

type Source = { uri: string; headers?: Record<string, string> } | null;

interface Props {
  shots: Shot[];
  startIndex: number;
  projectName: string;
  /** 보고서 사진(크게) — 기기에 받아 둔 것이 있으면 그것, 없으면 서버 원본 */
  refSource: (shot: Shot) => Source;
  takenThumb: (shot: Shot) => Source;
  isTaken: (shot: Shot) => boolean;
  onClose: () => void;
  onShoot: (shot: Shot) => void;
}

export function ShotDetailModal({ shots, startIndex, projectName, refSource, takenThumb, isTaken, onClose, onShoot }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex);
  const list = useRef<FlatList<Shot>>(null);
  const shot = shots[index] ?? shots[0];
  if (!shot) return null;
  const taken = isTaken(shot);
  const goNext = () => {
    const next = Math.min(index + 1, shots.length - 1);
    list.current?.scrollToIndex({ index: next, animated: true });
    setIndex(next);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
        <View>
          <FlatList
            ref={list}
            data={shots}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(s) => s.id}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => {
              const src = refSource(item);
              return (
                <View style={{ width, paddingHorizontal: space.lg }}>
                  <View style={styles.photo}>
                    {src ? <Image source={src} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`${item.caption ?? item.label} 보고서 사진`} /> : <Feather name="image" size={44} color="rgba(255,255,255,0.8)" />}
                  </View>
                </View>
              );
            }}
          />
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" style={[styles.round, { left: space.lg + 14 }]}>
            <Feather name="chevron-down" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.chip, styles.chipLeft]}>전차 보고서{shot.group ? ` · ${shot.group.replace(/^r\d+_pg_0*/, '페이지 ')}` : ''}</Text>
          <Text style={[styles.chip, styles.chipRight]}>
            {index + 1} / {shots.length}
          </Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{shot.caption ?? shot.label}</Text>
          <View style={styles.chips}>
            <Text style={styles.info}>부재 · {shot.member}</Text>
            <Text style={styles.info}>No. {shot.number}</Text>
            <Text style={styles.info}>{projectName}</Text>
          </View>
          <View style={styles.tip}>
            <View style={styles.tipIcon}>
              <Feather name="info" size={18} color={colors.primaryText} />
            </View>
            <Text style={styles.tipText}>
              위 사진과 <Text style={styles.tipStrong}>같은 자리·같은 방향</Text>에서 찍으면 보고서에 나란히 넣기 좋아요.
            </Text>
          </View>
          <View style={styles.mine}>
            <Text style={styles.mineTitle}>이번 사진</Text>
            {taken && takenThumb(shot) ? (
              <Image source={takenThumb(shot)!} style={styles.mineThumb} resizeMode="cover" />
            ) : (
              <Text style={styles.mineEmpty}>아직 안 찍음</Text>
            )}
          </View>
        </View>

        <View style={[styles.actions, { paddingBottom: insets.bottom + space.md }]}>
          <PressScale onPress={goNext} disabled={index >= shots.length - 1} accessibilityRole="button" style={[styles.next, index >= shots.length - 1 && { opacity: 0.4 }]}>
            <Text style={styles.nextText}>다음 →</Text>
          </PressScale>
          <PressScale
            onPress={() => {
              // 모달이 다 내려간 뒤에 카메라를 연다(iOS는 닫히는 중인 화면 위에 카메라를 못 띄운다)
              onClose();
              setTimeout(() => onShoot(shot), 450);
            }}
            accessibilityRole="button"
            style={styles.shoot}
          >
            <Feather name="camera" size={20} color={colors.onPrimary} />
            <Text style={styles.shootText}>{taken ? '한 장 더 찍기' : '사진 찍기'}</Text>
          </PressScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  photo: { height: 330, borderRadius: 28, overflow: 'hidden', backgroundColor: '#a8a093', alignItems: 'center', justifyContent: 'center' },
  round: { position: 'absolute', top: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  chip: { position: 'absolute', bottom: 14, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontFamily: font.bold, fontSize: 12 },
  chipLeft: { left: space.lg + 14, backgroundColor: colors.photoChip, color: '#ffffff' },
  chipRight: { right: space.lg + 14, backgroundColor: 'rgba(255,255,255,0.92)', color: colors.foreground },
  body: { flex: 1, paddingHorizontal: space.xxl, paddingTop: space.xl, gap: space.lg },
  title: { fontFamily: font.heavy, fontSize: 24, letterSpacing: -0.5, color: colors.foreground },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  info: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.muted, fontFamily: font.semibold, fontSize: 14, color: colors.ink2 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 20, backgroundColor: colors.muted },
  tipIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, fontFamily: font.regular, fontSize: 14, lineHeight: 21, color: colors.ink2 },
  tipStrong: { fontFamily: font.bold, color: colors.foreground },
  mine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mineTitle: { fontFamily: font.bold, fontSize: 16, color: colors.foreground },
  mineEmpty: { fontFamily: font.semibold, fontSize: 14, color: colors.subtle },
  mineThumb: { width: 72, height: 54, borderRadius: radius.sm },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: space.xl, paddingTop: space.md },
  next: { width: 104, minHeight: 56, borderRadius: 18, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontFamily: font.bold, fontSize: 16, color: colors.ink2 },
  shoot: { flex: 1, minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  shootText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
});
