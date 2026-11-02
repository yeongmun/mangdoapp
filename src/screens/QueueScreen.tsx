// 하단 메뉴 「업로드 대기」(2026-11-01). 아직 서버에 안 올라간 사진(전송 대기열)과 손상 기록 수를 보여 주고,
// [지금 모두 보내기]로 멈춘 것까지 바로 보낸다. 사진은 60초마다 저절로도 올라간다(photoUpload).
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedBar, PressScale, Skeleton } from '../components/motion';
import { useOnline } from '../components/NetworkWatch';
import { useUploadStatus } from '../useUploadStatus';
import { useToast } from '../components/Toast';
import { pendingPushCount } from '../offlineRules';
import { readIndex } from '../offlineStore';
import { downloadBusy } from '../offlineDownload';
import { syncOffline } from '../offlineSync';
import { MAX_PHOTO_TRIES, type PhotoQueueItem } from '../photoQueue';
import { flushPhotoQueue, pendingPhotoItems, retryPendingPhotos } from '../photoUpload';
import { colors, font, space } from '../theme';

function statusOf(item: PhotoQueueItem, uploadingId: string | null, online: boolean): { text: string; color: string } {
  if (item.id === uploadingId) return { text: '올리는 중…', color: colors.primaryText };
  if (item.holdUntil !== undefined && Date.now() < item.holdUntil) return { text: '방금 찍음 — 곧 보내요', color: colors.mutedForeground };
  if (item.tries >= MAX_PHOTO_TRIES) return { text: `${item.tries}번 실패 — 멈춤`, color: colors.destructive };
  if (item.tries > 0) return { text: `${item.tries}번 실패 — 곧 다시 보내요`, color: colors.tagOrangeFg };
  if (!online) return { text: '인터넷 연결되면 보내요', color: colors.mutedForeground };
  return { text: '보낼 차례를 기다려요', color: colors.mutedForeground };
}

/** onChanged: 남은 수(사진 + 손상 기록) — 하단 메뉴 배지와 같은 셈 */
export function QueueScreen({ active, onChanged }: { active: boolean; onChanged?: (pending: number) => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [items, setItems] = useState<PhotoQueueItem[]>([]);
  const [damages, setDamages] = useState(0);
  const [sending, setSending] = useState(false);
  const upload = useUploadStatus();
  const online = useOnline();

  const reload = useCallback(() => {
    const photos = pendingPhotoItems();
    const dmg = pendingPushCount(
      Object.values(readIndex().drawings).map((e) => ({ localUpdatedAt: e.damagesUpdatedAt, serverUpdatedAt: e.serverUpdatedAt })),
    );
    setItems(photos);
    setDamages(dmg);
    return photos.length + dmg;
  }, []);

  // 보고 있는 동안 3초마다 새로 읽는다(올라가면 줄이 빠진다)
  useEffect(() => {
    if (!active) return;
    reload();
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [active, reload]);
  // 한 장 올라갈 때마다 바로 줄이 빠진다(3초를 기다리지 않게)
  useEffect(() => {
    if (active) reload();
  }, [active, reload, upload.version]);

  const sendAll = useCallback(async () => {
    setSending(true);
    retryPendingPhotos();
    reload();
    try {
      await flushPhotoQueue(() => reload());
      // 「모두 받기」가 도는 중이면 손상 동기화는 건너뛴다 — 둘이 동시에 index.json을 쓰면 기록이 사라진다
      if (!downloadBusy.current) await syncOffline();
    } catch {
      // 실패해도 남은 수로 아래 문구가 알려 준다
    } finally {
      setSending(false);
      onChanged?.(reload());
    }
    // 방금 찍어 「되돌리기」를 기다리는 사진은 몇 초 뒤 저절로 간다 — 실패로 세지 않는다
    const now = Date.now();
    const left = pendingPhotoItems().filter((x) => x.holdUntil === undefined || now >= x.holdUntil).length;
    toast(left === 0 ? '모두 올렸어요' : `${left}장은 아직 못 올렸어요 — 연결을 확인해 주세요`);
  }, [reload, onChanged, toast]);

  const total = items.length + damages;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <Text style={styles.title}>업로드 대기</Text>
        <Text style={styles.big}>
          {total === 0 ? (
            '모두 올라갔어요'
          ) : (
            <>
              <Text style={styles.blue}>{items.length > 0 ? `${items.length}장` : `${damages}개`}</Text> 올라가길 기다려요
            </>
          )}
        </Text>
        {upload.total > 0 && (
          <View style={styles.progress} accessibilityLabel={`올리는 중 ${Math.min(upload.done + 1, upload.total)} / ${upload.total}`}>
            <Text style={styles.progressText}>
              올리는 중 {Math.min(upload.done + 1, upload.total)} / {upload.total}
            </Text>
            <AnimatedBar ratio={upload.done / upload.total} height={6} />
          </View>
        )}
        {damages > 0 && <Text style={styles.sub}>손상 기록 {damages}개도 아직 서버에 안 올라갔어요(도면에서 그린 것)</Text>}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}
        ListEmptyComponent={
          total === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name="check" size={28} color={colors.primaryText} />
              </View>
              <Text style={styles.emptyText}>찍은 사진은 인터넷이 되면 저절로 올라가요. 여기 남은 게 있으면 아직 못 올라간 거예요.</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item, index }) => {
          const st = statusOf(item, upload.uploadingId, online);
          const uploading = item.id === upload.uploadingId;
          return (
            <View style={[styles.row, index === 0 && styles.rowFirst, index === items.length - 1 && styles.rowLast]}>
              <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.filename}
                </Text>
                <Text style={[styles.status, { color: st.color }]}>{st.text}</Text>
                {uploading && <Skeleton style={styles.uploadingBar} />}
              </View>
            </View>
          );
        }}
      />

      {total > 0 && (
        <View style={styles.ctaWrap}>
          <PressScale onPress={() => void sendAll()} disabled={sending} accessibilityRole="button" style={[styles.cta, sending && { opacity: 0.6 }]}>
            <Feather name="upload-cloud" size={20} color={colors.onPrimary} />
            <Text style={styles.ctaText}>{sending ? '보내는 중…' : '지금 모두 보내기'}</Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  head: { paddingHorizontal: space.xl, marginBottom: space.lg, gap: 6 },
  title: { fontFamily: font.semibold, fontSize: 15, color: colors.mutedForeground },
  big: { fontFamily: font.heavy, fontSize: 26, lineHeight: 34, letterSpacing: -0.6, color: colors.foreground },
  blue: { color: colors.primary },
  sub: { fontFamily: font.regular, fontSize: 14, color: colors.mutedForeground },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowFirst: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: space.lg },
  rowLast: { borderBottomLeftRadius: 22, borderBottomRightRadius: 22, paddingBottom: space.lg },
  thumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.border },
  name: { fontFamily: font.bold, fontSize: 14.5, color: colors.foreground },
  status: { fontFamily: font.semibold, fontSize: 12.5 },
  uploadingBar: { height: 4, borderRadius: 2, backgroundColor: colors.primary, marginTop: 2 },
  progress: { gap: 6, marginTop: 4 },
  progressText: { fontFamily: font.semibold, fontSize: 13.5, color: colors.primaryText },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: space.xl, gap: space.md },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: font.regular, fontSize: 14.5, lineHeight: 22, color: colors.mutedForeground, textAlign: 'center' },
  ctaWrap: { paddingHorizontal: space.xl, paddingVertical: space.md },
  cta: { minHeight: 56, borderRadius: 18, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  ctaText: { fontFamily: font.bold, fontSize: 16, color: colors.onPrimary },
});
