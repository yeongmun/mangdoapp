// 앱 안 카메라(2026-11-02 4차 시안, 사용자 승인 「이걸로」). 폰 기본 카메라를 항목마다 여닫지 않고 한 화면에서
// 이어 찍는다. 레퍼런스: InfraSmart 페이지 미리보기 줄(아래 항목 줄), 토스 신분증 틀(전차 사진 겹쳐 보기), 아이폰 카메라.
// - 위: 지금 항목 이름·번호·「5 / 10」. 양옆 ‹ › 로 이전·다음 항목(모든 칸을 차례로 — 다시 찍기도 쉽게)
// - 가운데: 카메라 미리보기 + 격자. 전차 사진이면 보고서 사진을 반투명하게 겹친다(끔/연하게/진하게)
// - 아래: 항목 줄(옆으로 스크롤, 찍은 칸은 사진+✓, 지금 칸은 파란 테두리) → 누르면 그 항목으로
// - 셔터: 찍으면 저장(savePhotoFromUri) → onCapture(useShots.commitPhoto) → 「찍었어요 · 되돌리기」 줄 →
//   다음 안 찍은 항목으로 자동 이동. 되돌리기는 5초(UNDO_MS) 안에만.
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, Image, Linking, Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Shot } from '../api';
import { useReduceMotion } from '../components/motion';
import { savePhotoFromUri, type PhotoResult } from '../photo';
import type { ShotUploadState } from '../photoUpload';
import { colors, font, space } from '../theme';
import { UNDO_MS } from '../useShots';

type Source = { uri: string; headers?: Record<string, string> } | null;

interface Props {
  shots: Shot[];
  startShotId: string;
  /** 'required' = 필수 사진(격자만), 'previous' = 전차 사진(보고서 사진 겹쳐 보기) */
  mode: 'required' | 'previous';
  isTaken: (shot: Shot) => boolean;
  takenThumb: (shot: Shot) => Source;
  /** 전차 사진의 보고서 사진 원본(기기 사본이 있으면 그것) — 겹쳐 보기·오른쪽 위 작은 그림 */
  refSource?: (shot: Shot) => Source;
  /** 전차 사진의 작은 보고서 사진 — 항목 줄(수십 장을 한 번에 그리므로 원본을 쓰면 메모리가 모자란다) */
  refThumbSource?: (shot: Shot) => Source;
  uploadStates: Map<string, ShotUploadState>;
  /** 찍힌 사진을 항목에 붙인다. 되돌리기 함수를 돌려준다(실패면 null) */
  /** inCamera=false면(찍는 사이 카메라가 닫힘) 바깥 토스트로 알린다 */
  onCapture: (shot: Shot, result: PhotoResult, inCamera: boolean) => { undo: () => boolean } | null;
  onClose: () => void;
}

const STRIP_ITEM = 62;
const STRIP_GAP = 8;
const OVERLAY_LEVELS = [0, 0.35, 0.6] as const;
const FLASH_MODES: FlashMode[] = ['off', 'on', 'auto'];
const FLASH_LABEL: Record<string, string> = { off: '플래시 끔', on: '플래시 켬', auto: '플래시 자동' };

// 항목 줄 한 칸 — 모듈 수준 컴포넌트(렌더 안에서 만들면 매번 다른 타입이 되어 칸이 전부 다시 올라온다)
function StripItem({ item, i, current, done, thumb, onPress }: { item: Shot; i: number; current: boolean; done: boolean; thumb: Source; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.number} ${item.member} ${item.label}, ${done ? '찍음' : '안 찍음'}${current ? ', 지금 찍을 항목' : ''}`}
      style={styles.stripItem}
    >
      <View style={[styles.stripBox, current && styles.stripBoxCurrent, !done && !thumb && styles.stripBoxEmpty]}>
        {thumb ? <Image source={thumb} style={[StyleSheet.absoluteFill, !done && { opacity: 0.55 }]} resizeMode="cover" /> : null}
        {!done && !thumb ? (
          <Text style={styles.stripLabel} numberOfLines={2}>
            {item.member}
          </Text>
        ) : null}
        {current && !done ? (
          <View style={styles.stripNow}>
            <Text style={styles.stripNowText}>지금</Text>
          </View>
        ) : null}
        {done ? (
          <View style={styles.stripCheck}>
            <Feather name="check" size={10} color="#ffffff" />
          </View>
        ) : null}
      </View>
      <Text style={[styles.stripNum, current && styles.stripNumCurrent]}>{i + 1}</Text>
    </Pressable>
  );
}

export function CameraScreen({ shots, startShotId, mode, isTaken, takenThumb, refSource, refThumbSource, uploadStates, onCapture, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const strip = useRef<FlatList<Shot>>(null);
  const [index, setIndex] = useState(() => Math.max(0, shots.findIndex((s) => s.id === startShotId)));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<FlashMode>('off');
  const [overlay, setOverlay] = useState<number>(mode === 'previous' ? 1 : 0);
  const [lastUri, setLastUri] = useState<string | null>(null);
  // 「찍었어요 · 되돌리기」 줄
  const [undo, setUndo] = useState<{ label: string; run: () => boolean } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const nextHint = useRef(new Animated.Value(0)).current;
  const mounted = useRef(true);
  const askedOnce = useRef(false);
  const [undoNote, setUndoNote] = useState<string | null>(null);

  const shot = shots[index] ?? shots[0];
  const taken = shots.filter(isTaken).length;

  // 권한은 열릴 때 한 번만 묻는다(안드로이드는 거절 뒤에도 canAskAgain이 true라 바로 또 뜰 수 있다). 그 뒤는 화면의 버튼으로
  useEffect(() => {
    if (!permission || permission.granted || askedOnce.current || !permission.canAskAgain) return;
    askedOnce.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  // 목록이 줄어들면(새로 받아 휴지통으로 간 페이지) 범위 안으로
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, shots.length - 1)));
  }, [shots.length]);

  useEffect(() => {
    if (index < shots.length) strip.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [index, shots.length]);

  useEffect(
    () => () => {
      mounted.current = false;
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    [],
  );

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(shots.length - 1, i + delta)));
    },
    [shots.length],
  );

  const showUndo = (label: string, run: () => boolean) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoNote(null);
    setUndo({ label, run });
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS - 1000);
  };

  const capture = useCallback(async () => {
    if (!shot || busy || !ready || !camera.current) return;
    setBusy(true);
    try {
      if (!reduce) {
        flashAnim.setValue(1);
        Animated.timing(flashAnim, { toValue: 0, duration: 260, useNativeDriver: true }).start();
      }
      const pic = await camera.current.takePictureAsync({ quality: 1 });
      if (!pic) return;
      const result = await savePhotoFromUri(pic.uri, pic.width, pic.height);
      // 찍는 사이 카메라를 닫았으면 바깥 토스트(되돌리기 포함)로 알린다
      const committed = onCapture(shot, result, !mounted.current);
      if (!mounted.current || !committed || !result.ok) return;
      setLastUri(result.uploadUri ?? pic.uri);
      const target = shot;
      showUndo(`${target.member} · ${target.label} 찍었어요`, committed.undo);
      // 다음 안 찍은 항목으로(지금 칸 뒤에서 먼저 찾고, 없으면 앞에서). 없으면 그대로
      const after = shots.findIndex((s, i) => i > index && !isTaken(s) && s.id !== target.id);
      const before = shots.findIndex((s) => !isTaken(s) && s.id !== target.id);
      const next = after >= 0 ? after : before;
      if (next >= 0) {
        setIndex(next);
        if (!reduce) {
          nextHint.setValue(0);
          Animated.sequence([
            Animated.timing(nextHint, { toValue: 1, duration: 200, useNativeDriver: true }),
            Animated.delay(1400),
            Animated.timing(nextHint, { toValue: 0, duration: 250, useNativeDriver: true }),
          ]).start();
        }
      }
    } catch (e) {
      // 미리보기가 닫히는 중이었거나 카메라가 바빴다 — 사진은 안 찍혔다
      if (mounted.current) Alert.alert('사진', `찍지 못했어요. 다시 눌러 주세요. (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [shot, busy, ready, reduce, flashAnim, nextHint, onCapture, shots, index, isTaken]);

  const refOf = useCallback((s: Shot) => (refSource ? refSource(s) : null), [refSource]);
  const refThumbOf = useCallback((s: Shot) => (refThumbSource ? refThumbSource(s) : refSource ? refSource(s) : null), [refThumbSource, refSource]);
  const previewH = Math.round(width * 1.25);
  const nextShot = shots[Math.min(index + 1, shots.length - 1)];
  const prevShot = shots[Math.max(index - 1, 0)];
  const upload = shot ? uploadStates.get(shot.id) : undefined;


  if (!shot) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={() => {
        if (!busy) onClose();
      }} statusBarTranslucent presentationStyle="fullScreen">
      <StatusBar barStyle="light-content" />
      <View style={styles.screen}>
        {/* 위 */}
        <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
          <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="카메라 닫기" style={[styles.round, busy && { opacity: 0.4 }]}>
            <Feather name="x" size={22} color="#ffffff" />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>
              {shot.caption ?? `${shot.member} · ${shot.label}`}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {mode === 'previous' ? `전차 사진${shot.group ? ` · ${shot.group.replace(/^r\d+_pg_0*/, '페이지 ')}` : ''}` : '필수 사진'} · No. {shot.number}
              {isTaken(shot) ? '  ·  찍음' : ''}
            </Text>
          </View>
          <Text style={styles.count} accessibilityLabel={`${shots.length}장 중 ${taken}장 찍음`}>
            {taken} / {shots.length}
          </Text>
        </View>

        {/* 카메라 */}
        <View style={[styles.preview, { height: previewH }]}>
          {permission?.granted ? (
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" flash={flash} onCameraReady={() => setReady(true)} />
          ) : (
            <View style={styles.denied}>
              <Feather name="camera-off" size={36} color="rgba(255,255,255,0.7)" />
              <Text style={styles.deniedText}>카메라 권한이 필요해요</Text>
              <Pressable onPress={() => void (permission?.canAskAgain ? requestPermission() : Linking.openSettings())} style={styles.deniedBtn} accessibilityRole="button">
                <Text style={styles.deniedBtnText}>{permission?.canAskAgain ? '권한 허용' : '설정 열기'}</Text>
              </Pressable>
            </View>
          )}
          {/* 전차 사진 겹쳐 보기 */}
          {mode === 'previous' && OVERLAY_LEVELS[overlay] > 0 && refOf(shot) ? (
            <Image source={refOf(shot)!} style={[StyleSheet.absoluteFill, { opacity: OVERLAY_LEVELS[overlay] }]} resizeMode="contain" pointerEvents="none" />
          ) : null}
          {/* 격자 */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={[styles.gridV, { left: '33.3%' }]} />
            <View style={[styles.gridV, { left: '66.6%' }]} />
            <View style={[styles.gridH, { top: '33.3%' }]} />
            <View style={[styles.gridH, { top: '66.6%' }]} />
          </View>
          {/* 안내 */}
          <Animated.View pointerEvents="none" style={[styles.hintWrap, { opacity: nextHint }]}>
            <View style={styles.hintNext}>
              <Feather name="chevron-right" size={15} color="#ffffff" />
              <Text style={styles.hintText}>다음: {shot.member}</Text>
            </View>
          </Animated.View>
          {mode === 'previous' && refOf(shot) ? (
            <View style={styles.refMini} accessibilityRole="image" accessibilityLabel="전차 보고서 사진">
              <Image source={refOf(shot)!} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Text style={styles.refMiniLabel}>보고서</Text>
            </View>
          ) : null}
          {/* ‹ › */}
          <Pressable
            onPress={() => go(-1)}
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel={index === 0 ? '첫 항목' : `이전 항목: ${prevShot.member} ${prevShot.label}`}
            style={[styles.arrow, { left: 10 }, index === 0 && { opacity: 0.3 }]}
          >
            <Feather name="chevron-left" size={26} color="#ffffff" />
          </Pressable>
          <Pressable
            onPress={() => go(1)}
            disabled={index >= shots.length - 1}
            accessibilityRole="button"
            accessibilityLabel={index >= shots.length - 1 ? '마지막 항목' : `다음 항목: ${nextShot.member} ${nextShot.label}`}
            style={[styles.arrow, { right: 10 }, index >= shots.length - 1 && { opacity: 0.3 }]}
          >
            <Feather name="chevron-right" size={26} color="#ffffff" />
          </Pressable>
          {/* 겹쳐 보기 조절 */}
          {mode === 'previous' ? (
            <Pressable
              onPress={() => setOverlay((v) => (v + 1) % OVERLAY_LEVELS.length)}
              accessibilityRole="button"
              accessibilityLabel={`겹쳐 보기 ${['끔', '연하게', '진하게'][overlay]}, 누르면 바꿈`}
              style={styles.overlayBtn}
            >
              <Feather name="layers" size={15} color="#ffffff" />
              <Text style={styles.overlayText}>겹쳐 보기 · {['끔', '연하게', '진하게'][overlay]}</Text>
            </Pressable>
          ) : null}
          {upload ? (
            <Text style={styles.uploadChip}>{upload === 'uploading' ? '올리는 중' : upload === 'waiting' ? '보낼 차례' : '다시 보낼게요'}</Text>
          ) : null}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#ffffff', opacity: flashAnim }]} />
        </View>

        {/* 항목 줄 */}
        <View style={styles.stripHead}>
          <Text style={styles.stripTitle}>
            {mode === 'previous' ? '전차 사진' : '필수 사진'} {shots.length}
          </Text>
          <Text style={styles.stripSub}>{taken}장 찍음 · 옆으로 밀어 보기</Text>
        </View>
        <FlatList
          ref={strip}
          data={shots}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s.id}
          getItemLayout={(_, i) => ({ length: STRIP_ITEM + STRIP_GAP, offset: (STRIP_ITEM + STRIP_GAP) * i, index: i })}
          initialScrollIndex={Math.max(0, index - 2)}
          contentContainerStyle={{ paddingHorizontal: space.lg, gap: STRIP_GAP }}
          style={{ flexGrow: 0 }}
          renderItem={({ item, index: i }) => {
            const done = isTaken(item);
            return <StripItem item={item} i={i} current={i === index} done={done} thumb={done ? takenThumb(item) : mode === 'previous' ? refThumbOf(item) : null} onPress={() => setIndex(i)} />;
          }}
          extraData={[index, taken]}
        />

        {/* 되돌리기 줄 */}
        {undoNote ? (
          <View style={styles.undoBar} accessibilityRole="alert">
            <Text style={styles.undoText}>{undoNote}</Text>
          </View>
        ) : undo ? (
          <View style={styles.undoBar}>
            <View style={styles.undoDot}>
              <Feather name="check" size={11} color="#ffffff" />
            </View>
            <Text style={styles.undoText} numberOfLines={1}>
              {undo.label}
            </Text>
            <Pressable
              onPress={() => {
                if (undoTimer.current) clearTimeout(undoTimer.current);
                const ok = undo.run();
                setUndo(null);
                if (ok) setLastUri(null);
                else {
                  setUndoNote('이미 올리기 시작해서 되돌릴 수 없어요 · 다시 찍으면 바뀌어요');
                  undoTimer.current = setTimeout(() => setUndoNote(null), 2500);
                }
              }}
              accessibilityRole="button"
              hitSlop={10}
              style={styles.undoBtn}
            >
              <Text style={styles.undoBtnText}>되돌리기</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 셔터 */}
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
          <View style={styles.lastThumb} accessibilityRole="image" accessibilityLabel={lastUri ? '방금 찍은 사진' : '아직 찍은 사진 없음'}>
            {lastUri ? <Image source={{ uri: lastUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          </View>
          <Pressable
            onPress={() => void capture()}
            disabled={busy || !ready || !permission?.granted}
            accessibilityRole="button"
            accessibilityLabel={isTaken(shot) ? '다시 찍기' : '사진 찍기'}
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.92 }] }, (busy || !ready) && { opacity: 0.6 }]}
          >
            {busy ? <ActivityIndicator color="#000000" /> : <View style={styles.shutterInner} />}
          </Pressable>
          <Pressable
            onPress={() => setFlash((f) => FLASH_MODES[(FLASH_MODES.indexOf(f) + 1) % FLASH_MODES.length])}
            accessibilityRole="button"
            accessibilityLabel={`${FLASH_LABEL[flash]}, 누르면 바꿈`}
            style={styles.round}
          >
            <Feather name={flash === 'off' ? 'zap-off' : 'zap'} size={22} color={flash === 'on' ? '#ffd166' : '#ffffff'} />
            {flash === 'auto' ? <Text style={styles.flashAuto}>A</Text> : null}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingBottom: space.md },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center', gap: 2 },
  title: { fontFamily: font.heavy, fontSize: 17, letterSpacing: -0.3, color: '#ffffff' },
  sub: { fontFamily: font.semibold, fontSize: 12.5, color: 'rgba(255,255,255,0.72)' },
  count: { minWidth: 56, textAlign: 'center', height: 32, lineHeight: 32, paddingHorizontal: 12, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.14)', fontFamily: font.bold, fontSize: 13, color: '#ffffff' },
  preview: { marginHorizontal: 8, borderRadius: 22, overflow: 'hidden', backgroundColor: '#1b1f24' },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  deniedText: { fontFamily: font.bold, fontSize: 16, color: '#ffffff' },
  deniedBtn: { minHeight: 44, paddingHorizontal: space.xl, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center' },
  deniedBtnText: { fontFamily: font.bold, fontSize: 15, color: '#ffffff' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  hintWrap: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
  hintNext: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.primary },
  hintText: { fontFamily: font.bold, fontSize: 13.5, color: '#ffffff' },
  refMini: { position: 'absolute', top: 12, right: 12, width: 92, height: 70, borderRadius: 12, borderWidth: 2, borderColor: '#ffffff', overflow: 'hidden', backgroundColor: '#555' },
  refMiniLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 20, lineHeight: 20, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: font.bold, fontSize: 10.5, color: '#ffffff' },
  arrow: { position: 'absolute', top: '45%', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  overlayBtn: { position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayText: { fontFamily: font.bold, fontSize: 12.5, color: '#ffffff' },
  uploadChip: { position: 'absolute', right: 12, bottom: 12, height: 28, lineHeight: 28, paddingHorizontal: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.55)', fontFamily: font.semibold, fontSize: 12, color: '#ffffff' },
  stripHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  stripTitle: { fontFamily: font.bold, fontSize: 13, color: 'rgba(255,255,255,0.86)' },
  stripSub: { fontFamily: font.semibold, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  stripItem: { width: STRIP_ITEM, alignItems: 'center', gap: 4 },
  stripBox: { width: STRIP_ITEM, height: STRIP_ITEM, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  stripBoxEmpty: { paddingHorizontal: 4 },
  stripBoxCurrent: { borderWidth: 3, borderColor: colors.primary },
  stripLabel: { fontFamily: font.semibold, fontSize: 10.5, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
  stripNow: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  stripNowText: { fontFamily: font.bold, fontSize: 10, color: '#ffffff' },
  stripCheck: { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  stripNum: { fontFamily: font.semibold, fontSize: 11.5, color: 'rgba(255,255,255,0.7)' },
  stripNumCurrent: { fontFamily: font.heavy, color: '#ffffff' },
  undoBar: { marginHorizontal: space.lg, marginTop: space.sm, height: 46, paddingLeft: space.lg, paddingRight: 8, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.16)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  undoDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  undoText: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: '#ffffff' },
  undoBtn: { height: 34, paddingHorizontal: 12, justifyContent: 'center' },
  undoBtnText: { fontFamily: font.bold, fontSize: 14, color: '#64a8ff' },
  bottom: { marginTop: 'auto', paddingHorizontal: 28, paddingTop: space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastThumb: { width: 52, height: 52, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#ffffff', padding: 4, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#ffffff' },
  flashAuto: { position: 'absolute', right: 6, bottom: 6, fontFamily: font.heavy, fontSize: 9, color: '#ffffff' },
});
