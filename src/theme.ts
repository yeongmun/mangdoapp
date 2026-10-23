// 앱 공통 색·간격 토큰(2026-10-24). ui-ux-pro-max "Minimalism & Swiss" 제안(현장 점검 도구용)을
// 기존 화면 색(#1e66f5 파랑, #f4f5f7 배경)에 맞춰 조정했다. 새 화면·컴포넌트는 raw hex 대신 이걸 쓴다.
// 기존 DrawingListScreen의 스타일은 건드리지 않았다 — 손볼 때 여기로 옮긴다.
export const colors = {
  /** 스플래시·아이콘 바탕. 화면 안에서는 제목·강조 글자에만 */
  navy: '#1e3a5f',
  primary: '#1e66f5',
  onPrimary: '#ffffff',
  primaryPressed: '#1a56d0',
  /** 찍음·완료 */
  success: '#059669',
  onSuccess: '#ffffff',
  background: '#f4f5f7',
  card: '#ffffff',
  foreground: '#0f172a',
  muted: '#f1f3f5',
  mutedForeground: '#475569',
  border: '#e4e7eb',
  destructive: '#d32f2f',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 8, lg: 12, pill: 999 } as const;
/** 터치 영역 최소 높이(pt) — 손가락·장갑 */
export const TOUCH_MIN = 44;
