// 앱 공통 색·글꼴·간격 토큰. 2026-11-01 3차 시안(디자인 캔버스 "망도 앱 디자인 시안" → 3차 · 둥근 카드 · 파랑):
// 연회색 바탕 위 크고 둥근 흰 카드, 굵고 큰 숫자, 강조색은 파랑 하나(주 버튼·선택·찍음 ✓).
// 새 화면·컴포넌트는 raw hex 대신 이걸 쓴다.
export const colors = {
  /** 로고 글자(스플래시·머리글) */
  brand: '#191f28',
  /** 로고 점 하나 */
  brandDot: '#3182f6',
  /** 주 버튼·선택·진행 막대 — 파랑 */
  primary: '#3182f6',
  onPrimary: '#ffffff',
  primaryPressed: '#1b64da',
  /** 파랑 글자(작은 글씨에도 대비가 나오는 진한 파랑)·옅은 파랑 바탕 */
  primaryText: '#1b64da',
  primarySoft: '#e8f3ff',
  /** 찍음 ✓ — 3차부터 파랑. 「완료」 글자만 초록 */
  success: '#3182f6',
  onSuccess: '#ffffff',
  successSoft: '#e8f3ff',
  done: '#0a7a4f',
  background: '#f2f4f6',
  card: '#ffffff',
  foreground: '#191f28',
  /** 칩 선택·진한 회색 글자 */
  ink2: '#4e5968',
  /** 빈 사진 자리·눌림·동그란 아이콘 버튼 바탕 */
  muted: '#f2f4f6',
  mutedForeground: '#6b7684',
  subtle: '#8b95a1',
  border: '#e5e8eb',
  borderStrong: '#d1d6db',
  destructive: '#e42939',
  destructiveSoft: '#ffeeee',
  /** 대기열 배지(안 올라간 사진·손상) */
  badge: '#f04452',
  /** 과업 구분 아이콘 바탕/글자 */
  tagWarmBg: '#e8f3ff',
  tagWarmFg: '#1b64da',
  tagCoolBg: '#e5f7ef',
  tagCoolFg: '#0a7a4f',
  tagPurpleBg: '#f3efff',
  tagPurpleFg: '#6b4fd1',
  tagOrangeBg: '#fff3e6',
  tagOrangeFg: '#b25e09',
  /** 아래 시트·사진 위 글자 배경 */
  scrim: 'rgba(0,0,0,0.45)',
  photoChip: 'rgba(25,31,40,0.55)',
} as const;

// Pretendard(OFL, assets/fonts). 안드로이드는 fontWeight로 굵기 파일을 못 고르므로 굵기마다 이름을 따로 쓴다.
// fontWeight는 쓰지 않는다. App.tsx의 useFonts가 이 이름으로 올린다.
export const font = {
  regular: 'Pretendard-Regular',
  semibold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
  heavy: 'Pretendard-ExtraBold',
} as const;

export const FONT_FILES = {
  [font.regular]: require('../assets/fonts/Pretendard-Regular.otf'),
  [font.semibold]: require('../assets/fonts/Pretendard-SemiBold.otf'),
  [font.bold]: require('../assets/fonts/Pretendard-Bold.otf'),
  [font.heavy]: require('../assets/fonts/Pretendard-ExtraBold.otf'),
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const radius = { sm: 8, md: 14, lg: 22, xl: 26, pill: 999 } as const;
/** 터치 영역 최소 높이(pt) — 손가락·장갑 */
export const TOUCH_MIN = 44;
/** 이 폭부터 태블릿(도면 탭을 먼저 연다) */
export const TABLET_MIN_WIDTH = 700;
