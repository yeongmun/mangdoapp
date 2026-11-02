// 구조물 위치(2026-11-02, 배민 「현재 위치로 찾기」 레퍼런스). 두 가지 일을 한다.
// 1) 사진을 찍을 때 폰 GPS를 읽어 그 구조물의 위치로 서버에 기록한다(정확도 100m 이내만). 오프라인이면
//    structure-locations.json(앱 문서 폴더)에 적어 두고 다음 기회에 올린다.
// 2) 홈이 「근처 구조물」을 셀 때 쓸 현재 위치를 준다(getPositionQuick).
// 위치 권한은 처음 찍을 때 한 번 묻는다. 거절하면 조용히 넘어간다 — 사진은 그대로 찍힌다.
import { File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { updateProject, type Project } from './api';
import { MAX_RECORD_ACCURACY_M, type LatLng } from './nearby';

export interface Fix extends LatLng {
  accuracy: number;
  at: number;
}

const FILE_NAME = 'structure-locations.json';
type Pending = Record<string, { lat: number; lng: number; accuracy: number; at: string; sent?: boolean }>;

function file(): File {
  return new File(Paths.document, FILE_NAME);
}
function readPending(): Pending {
  try {
    const f = file();
    if (!f.exists) return {};
    const parsed = JSON.parse(f.textSync()) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Pending) : {};
  } catch {
    return {};
  }
}
function writePending(p: Pending): void {
  try {
    file().write(JSON.stringify(p));
  } catch {
    // 못 적으면 이번 위치는 잃는다 — 다음 촬영에서 다시 기록된다
  }
}

/** 기기에 적어 둔(아직 서버에 못 보냈거나 방금 보낸) 구조물 위치 — 오프라인 「근처 구조물」에도 쓴다 */
export function localStructureLocations(): Pending {
  return readPending();
}

let asked = false;
async function ensurePermission(ask: boolean): Promise<boolean> {
  const cur = await Location.getForegroundPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || asked || !cur.canAskAgain) return false;
  asked = true;
  const res = await Location.requestForegroundPermissionsAsync();
  return res.granted;
}

/**
 * 현재 위치를 빨리 받는다: 최근 값(getLastKnownPosition)이 2분 안이면 그걸, 아니면 새로 읽되 timeoutMs 안에.
 * 권한이 없거나(ask=false면 묻지 않음) 못 받으면 null.
 */
export async function getPositionQuick(ask: boolean, timeoutMs = 8000, accuracy: Location.LocationAccuracy = Location.Accuracy.Balanced): Promise<Fix | null> {
  try {
    if (!(await ensurePermission(ask))) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 2 * 60 * 1000, requiredAccuracy: MAX_RECORD_ACCURACY_M });
    if (last) return toFix(last);
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return fresh ? toFix(fresh) : null;
  } catch {
    return null;
  }
}

function toFix(loc: Location.LocationObject): Fix {
  return { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy ?? 1000, at: loc.timestamp };
}

/**
 * 사진을 찍은 자리를 그 구조물의 위치로 기록한다. 기다리지 않아도 된다(void). 실패는 조용히 — 사진이 우선.
 * 정확도가 나쁘면(실내·터널) 기록하지 않는다. 서버에 못 보내면 기기에 적어 두고 다음에 올린다.
 */
export async function recordStructureLocation(projectId: string): Promise<void> {
  // 기록은 정밀하게(Balanced는 100m급이라 안드로이드에서 대부분 걸러진다)
  const fix = await getPositionQuick(true, 10000, Location.Accuracy.High);
  if (!fix || fix.accuracy > MAX_RECORD_ACCURACY_M) return;
  const loc = { lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy), at: new Date(fix.at).toISOString() };
  const pending = readPending();
  const cur = pending[projectId];
  // 서버와 같은 규칙으로 기기 사본도 더 정확한 값만 남긴다
  if (!cur || loc.accuracy <= cur.accuracy || Date.parse(loc.at) - Date.parse(cur.at) > 3600_000) pending[projectId] = loc;
  writePending(pending);
  await flushStructureLocations();
}

let flushing = false;
let rerun = false;
/**
 * 기기에 적어 둔 위치를 서버로 보낸다(온라인일 때). 보낸 것도 기기에 남겨 둔다 — 오프라인 「근처」용.
 * 보내는 중에 또 불리면 끝나고 한 번 더 돈다. 매번 파일을 다시 읽어 그 사이 적힌 새 값을 덮지 않는다.
 * 서버가 거절한 값(400·404 — 구조물이 지워졌거나 과업에 찍음)은 보낸 것으로 치고 넘어간다 — 하나가 막혀 뒤를 다 막지 않게.
 */
export async function flushStructureLocations(): Promise<void> {
  if (flushing) {
    rerun = true;
    return;
  }
  flushing = true;
  try {
    do {
      rerun = false;
      for (const [projectId, loc] of Object.entries(readPending())) {
        if (loc.sent) continue;
        try {
          await updateProject(projectId, { location: { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, at: loc.at } });
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('서버에 연결할 수 없습니다')) return; // 오프라인 — 다음에
          // 거절(400·404·401): 다시 보내도 같다
        }
        const now = readPending();
        const cur = now[projectId];
        if (cur && cur.at === loc.at) now[projectId] = { ...cur, sent: true };
        writePending(now);
      }
    } while (rerun);
  } finally {
    flushing = false;
  }
}

/** 서버 목록의 위치와 기기에 적어 둔 위치를 합친다(기기 것이 더 새롭거나 서버에 없으면 기기 것) */
export function withLocalLocations(projects: Project[]): Project[] {
  const local = readPending();
  if (Object.keys(local).length === 0) return projects;
  return projects.map((p) => {
    const l = local[p.id];
    if (!l) return p;
    if (p.location && Date.parse(p.location.at) >= Date.parse(l.at)) return p;
    return { ...p, location: { lat: l.lat, lng: l.lng, accuracy: l.accuracy, at: l.at } };
  });
}
