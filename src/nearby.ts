// 「근처 구조물」의 순수 규칙(2026-11-02, 배민 「현재 위치로 찾기」 레퍼런스). import 없음 — vitest(server/test/nearby.test.ts)가 읽는다.
// 위치 자체는 expo-location이 주고(useNearby.ts), 여기선 거리 계산과 고르기만 한다.

export interface LatLng {
  lat: number;
  lng: number;
}

/** 두 지점 사이 거리(m). 하버사인 — 몇 km 안에서는 충분히 정확하다 */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 사람이 읽는 거리: 1km 미만은 m 단위(10m 반올림, 최소 10m), 그 위는 km 소수 한 자리 */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 995) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export interface Nearby<T> {
  item: T;
  distanceM: number;
}

/**
 * 위치가 있는 구조물 중 가까운 순으로 limit개. maxM(기본 3km)보다 멀면 뺀다 —
 * 다른 도시 현장이 「근처」로 뜨면 오히려 헷갈린다.
 */
export function nearestStructures<T extends { location?: LatLng | null }>(here: LatLng, items: T[], limit = 3, maxM = 3000): Nearby<T>[] {
  const out: Nearby<T>[] = [];
  for (const item of items) {
    if (!item.location) continue;
    const d = distanceM(here, item.location);
    if (d <= maxM) out.push({ item, distanceM: d });
  }
  out.sort((a, b) => a.distanceM - b.distanceM);
  return out.slice(0, limit);
}

/** 폰 GPS 정확도가 이보다 나쁘면(m) 구조물 위치로 기록하지 않는다 — 실내·터널 안 값이 자리를 망친다 */
export const MAX_RECORD_ACCURACY_M = 100;
