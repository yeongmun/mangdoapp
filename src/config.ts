// 값은 PC에서 `npm run server`가 루트 .env.local에 기록한다. Expo 시작 시 번들에 들어가므로 APS 키는 절대 넣지 않는다.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const ACCESS_KEY = process.env.EXPO_PUBLIC_ACCESS_KEY ?? '';

export function configProblem(): string | null {
  if (!API_URL || !ACCESS_KEY) {
    return '서버 주소 또는 접근키가 없습니다.\nPC에서 npm run server를 실행한 뒤 Expo를 다시 시작하세요.';
  }
  return null;
}
