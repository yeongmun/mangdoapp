// 앱 공통 색·글꼴·간격 토큰. 2026-10-25 "농농" 폰 시안(디자인 캔버스 "망도 앱 디자인 시안" 2차):
// 흰 바탕·굵은 검정 글자·얇은 테두리 카드, 주 버튼은 검정, 외곽선 버튼은 흰 바탕+검정 테두리.
// 강조색은 거의 안 쓴다 — 찍음/완료만 초록, 로고 점만 주황. 새 화면·컴포넌트는 raw hex 대신 이걸 쓴다.
export const colors = {
  /** 로고 글자(스플래시·머리글) */
  brand: '#14213d',
  /** 로고 점 하나 */
  brandDot: '#f97316',
  /** 주 버튼·선택된 탭·칩 테두리 — 검정 */
  primary: '#222325',
  onPrimary: '#ffffff',
  primaryPressed: '#000000',
  /** 찍음·완료 */
  success: '#16a34a',
  onSuccess: '#ffffff',
  successSoft: '#e8f6ee',
  background: '#f7f7f7',
  card: '#ffffff',
  foreground: '#222325',
  /** 빈 사진 자리·눌림·동그란 아이콘 버튼 바탕 */
  muted: '#f2f2f2',
  mutedForeground: '#62646a',
  border: '#e4e5e7',
  borderStrong: '#dadbdd',
  destructive: '#d32f2f',
  destructiveSoft: '#fdecec',
  /** 대기열 배지(안 올라간 사진·손상) */
  badge: '#e11d48',
  /** 태그: 점검 종류 */
  tagWarmBg: '#fff1e6',
  tagWarmFg: '#9a3412',
  tagCoolBg: '#e8f0fe',
  tagCoolFg: '#1e40af',
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
export const radius = { sm: 6, md: 8, lg: 10, pill: 999 } as const;
/** 터치 영역 최소 높이(pt) — 손가락·장갑 */
export const TOUCH_MIN = 44;
/** 이 폭부터 태블릿(도면 탭을 먼저 연다) */
export const TABLET_MIN_WIDTH = 700;
