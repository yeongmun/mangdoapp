// 찍을 사진 카드(2026-11-01 3차 시안 — 둥근 카드·파랑).
// - ShotTile: [필수 사진] 2열 카드. 누르면 바로 카메라. 찍으면 사진 + 파란 ✓(톡 튀어나옴)
// - PreviousShotCard: [전차 사진] 큰 카드. 위 보고서 사진을 누르면 「사진 한 장」 화면(onPressImage),
//   아래 버튼은 바로 카메라(onShoot). 찍으면 이번 사진이 오른쪽 아래에 겹친다.
// 누르는 동안 카드는 살짝 작아지고 사진은 살짝 커진다(PressScale·ZoomImage).
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ShotUploadState } from '../photoUpload';
import { colors, font, radius, space } from '../theme';
import { CheckPop, PressScale, ZoomImage } from './motion';

type Source = { uri: string; headers?: Record<string, string> } | null;

function Check({ taken, size = 26 }: { taken: boolean; size?: number }) {
  return (
    <CheckPop visible={taken} style={[styles.check, { width: size, height: size, borderRadius: size / 2 }]}>
      <Feather name="check" size={size * 0.55} color={colors.onPrimary} />
    </CheckPop>
  );
}

/** 찍은 사진이 서버로 가는 중인지(카톡 말풍선의 올라가는 중·실패 표시 레퍼런스, 2026-11-02). 다 올라가면 사라진다 */
function UploadBadge({ state }: { state?: ShotUploadState }) {
  if (!state) return null;
  const text = state === 'uploading' ? '올리는 중' : state === 'failed' ? '다시 보낼게요' : state === 'stopped' ? '멈춤 · 업로드 대기에서 보내기' : '보낼 차례';
  const bad = state === 'failed' || state === 'stopped';
  return (
    <View style={[styles.upload, bad && styles.uploadFailed]} accessibilityLabel={`서버 전송: ${text}`}>
      {state === 'uploading' ? (
        <ActivityIndicator size="small" color="#ffffff" style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <Feather name={bad ? 'alert-circle' : 'upload-cloud'} size={12} color="#ffffff" />
      )}
      <Text style={styles.uploadText}>{text}</Text>
    </View>
  );
}

interface TileProps {
  member: string;
  label: string;
  number: string;
  taken: boolean;
  /** 찍은 사진 썸네일. null이면 빈 자리 */
  thumb: Source;
  disabled?: boolean;
  onPress: () => void;
  /** 대기열에 있으면 그 상태 */
  upload?: ShotUploadState;
}

export function ShotTile({ member, label, number, taken, thumb, disabled = false, onPress, upload }: TileProps) {
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={`${member} ${label} ${taken ? '찍음, 다시 찍기' : '안 찍음, 찍기'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.tile, disabled && styles.disabled]}
    >
      <View style={[styles.tilePhoto, !taken && styles.tilePhotoEmpty]}>
        {taken && thumb ? <ZoomImage source={thumb} style={StyleSheet.absoluteFill} /> : <Feather name="camera" size={26} color={colors.subtle} />}
        <View style={styles.checkCorner}>
          <Check taken={taken} />
        </View>
        {taken && (
          <View style={styles.uploadCorner}>
            <UploadBadge state={upload} />
          </View>
        )}
      </View>
      <View style={styles.tileText}>
        <Text style={styles.sub} numberOfLines={1}>
          {member} · {number}
        </Text>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </PressScale>
  );
}

interface PreviousProps extends TileProps {
  refThumb: Source;
  caption?: string;
  /** 보고서 사진을 눌렀을 때(사진 한 장 화면) */
  onPressImage: () => void;
}

export function PreviousShotCard({ member, label, number, taken, thumb, refThumb, caption, disabled = false, onPress, onPressImage, upload }: PreviousProps) {
  return (
    <View style={[styles.big, disabled && styles.disabled]}>
      <PressScale onPress={onPressImage} accessibilityRole="imagebutton" accessibilityLabel={`${caption ?? label} 보고서 사진 크게 보기`} to={0.98}>
        <View style={styles.bigPhoto}>
          {refThumb ? <ZoomImage source={refThumb} style={StyleSheet.absoluteFill} /> : <Feather name="image" size={34} color="rgba(255,255,255,0.8)" />}
          <Text style={styles.photoChip}>전차 보고서</Text>
          {taken && thumb ? (
            <View style={styles.inset}>
              <ZoomImage source={thumb} style={StyleSheet.absoluteFill} />
            </View>
          ) : null}
          {taken ? (
            <View style={styles.insetCheck}>
              <Check taken size={26} />
            </View>
          ) : null}
          {taken && (
            <View style={styles.uploadCorner}>
              <UploadBadge state={upload} />
            </View>
          )}
        </View>
      </PressScale>
      <View style={styles.bigText}>
        <Text style={styles.bigTitle} numberOfLines={2}>
          {caption ?? label}
        </Text>
        <Text style={styles.sub}>
          {member} · No. {number}
        </Text>
      </View>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        style={({ pressed }) => [styles.shootButton, taken ? styles.shootAgain : styles.shootFirst, pressed && styles.shootPressed]}
      >
        {!taken && <Feather name="camera" size={18} color={colors.primaryText} />}
        <Text style={[styles.shootText, taken ? styles.shootTextAgain : styles.shootTextFirst]}>{taken ? '다시 찍기' : '같은 자리에서 찍기'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  check: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#ffffff' },
  sub: { fontFamily: font.semibold, fontSize: 12.5, color: colors.subtle },
  // 필수 사진 2열 카드
  tile: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.sm, gap: space.sm },
  tilePhoto: { height: 104, borderRadius: 16, overflow: 'hidden', backgroundColor: '#c9d2dc', alignItems: 'center', justifyContent: 'center' },
  tilePhotoEmpty: { backgroundColor: colors.muted },
  checkCorner: { position: 'absolute', top: 8, right: 8 },
  uploadCorner: { position: 'absolute', left: 8, bottom: 8 },
  upload: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: colors.photoChip },
  uploadFailed: { backgroundColor: colors.destructive },
  uploadText: { fontFamily: font.semibold, fontSize: 11, color: '#ffffff' },
  tileText: { paddingHorizontal: 6, paddingBottom: 4, gap: 1 },
  tileTitle: { fontFamily: font.bold, fontSize: 15.5, color: colors.foreground },
  // 전차 사진 큰 카드
  big: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 10, gap: space.md, marginBottom: space.md },
  bigPhoto: { height: 180, borderRadius: 18, overflow: 'hidden', backgroundColor: '#9aa6b2', alignItems: 'center', justifyContent: 'center' },
  photoChip: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.photoChip,
    color: '#ffffff',
    fontFamily: font.bold,
    fontSize: 12,
  },
  inset: { position: 'absolute', right: 10, bottom: 10, width: 84, height: 64, borderRadius: 12, borderWidth: 3, borderColor: '#ffffff', overflow: 'hidden', backgroundColor: '#7f98ad' },
  insetCheck: { position: 'absolute', right: 4, bottom: 62 },
  bigText: { paddingHorizontal: space.sm, gap: 3 },
  bigTitle: { fontFamily: font.bold, fontSize: 17, color: colors.foreground },
  shootButton: { minHeight: 48, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 2, marginBottom: 2 },
  shootFirst: { backgroundColor: colors.primarySoft },
  shootAgain: { backgroundColor: colors.muted },
  shootPressed: { opacity: 0.75 },
  shootText: { fontFamily: font.bold, fontSize: 15 },
  shootTextFirst: { color: colors.primaryText },
  shootTextAgain: { color: colors.ink2 },
});
