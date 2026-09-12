# 망도 손상조사 앱 (mangdo-app)

태블릿에서 DWG 망도를 열어 손상을 표기하고, 손상물량표가 반영된 DWG로 내보내는 앱.
현재 **1단계(PoC)**: DWG 업로드 → APS 변환 → 태블릿 뷰어 → 펜으로 균열 입력 → 도면 좌표 JSON 저장.

## 구성

```
[PC 브라우저] ─ 업로드 ─▶ [Node 서버 (내 PC)] ─▶ APS
                              ▲ cloudflared 터널
[태블릿 Expo Go 앱] ──────────┘  목록 + WebView 뷰어
```

- `server/` — Express 서버, APS 연동, 업로드 페이지, 뷰어 페이지, 손상 JSON 저장(`server/data/`)
- `App.tsx`, `src/` — 태블릿 앱 (도면 목록, 뷰어)
- 설계: `docs/superpowers/specs/2026-09-10-phase1-poc-design.md`

## 처음 한 번

PC에 필요한 것:
- **Node.js 24 이상**
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) — PATH에 없으면 `CLOUDFLARED_PATH` 환경변수로 실행 파일 경로를 지정합니다.

```bash
npm install
npm --prefix server install
```

`server/.env` 작성 (커밋 금지):
```
APS_CLIENT_ID=발급받은 Client ID
APS_CLIENT_SECRET=발급받은 Client Secret
APP_ACCESS_KEY=직접 정한 접근키(영문·숫자·-·_ 로만 20자 이상)
```
접근키에 `#`, `$`, 한글 등 다른 문자가 있으면 서버가 시작되지 않습니다 (앱 쪽 설정 파일에서 값이 달라지기 때문).
APS 콘솔에서 앱에 **Data Management API**, **Model Derivative API**가 켜져 있어야 합니다.

## 실행

터미널 1 — 서버 + 터널:
```bash
npm run server
```
`[dev] 터널 주소: https://….trycloudflare.com`이 나오면 루트 `.env.local`이 자동 갱신됩니다.

터미널 2 — 앱:
```bash
npx expo start --tunnel
```
태블릿 Expo Go로 QR을 스캔합니다.

> 서버를 재시작하면 터널 주소가 바뀌므로 **Expo도 재시작**해야 합니다.

## 주의: 저장 대기 중에는 서버를 재시작하지 마세요

> **뷰어에 빨간 `저장 대기` 또는 `저장 실패` 배지가 떠 있으면 균열이 아직 서버에 저장되지 않은 상태입니다.**

- 저장되지 않은 균열은 태블릿에 임시 보관되지만, **PC 서버를 다시 시작하면 터널 주소가 바뀌어 복구할 수 없습니다.**
- 배지가 `저장됨`으로 바뀐 것을 확인한 뒤 서버를 끄세요.
- `‹ 목록`(안드로이드는 뒤로가기)을 누르면 앱이 저장 완료를 확인한 뒤 나가고, 저장되지 않았으면 경고합니다.

## 사용

1. PC 브라우저 `http://localhost:3000/upload.html` → 접근키 저장 → DWG 업로드 → `완료`까지 대기
2. 태블릿 앱 목록에서 도면 선택
3. 아래 도구막대에서 **손상 유형**을 고른 뒤 도면에 표기합니다
   - 선형(균열, 균열/백태): 펜으로 긋습니다. 손가락은 확대·이동입니다
   - 면형(나머지): 드래그해서 사각형을 그리면 유형별 무늬로 채워집니다
   - 사각형을 탭해 선택하면 모서리 핸들로 크기를, 위쪽 둥근 핸들로 기울기를 바꿉니다
   - 선택한 상태에서 **속성**을 열어 길이(m) 또는 면적(㎡), 균열 폭, 부재명, 비고를 적습니다. 물량표에는 여기 적은 값이 들어갑니다
   - `손가락 그리기`: 펜이 없을 때 한 손가락으로 그리기 (두 손가락은 확대·이동)
   - 손상을 탭 → `선택 삭제`, `마지막 취소`
   - `좌표 확인`: 탭한 지점의 뷰어/DWG 좌표 표시
4. 저장은 자동입니다 (배지: 저장됨 / 저장 중 / 저장 대기 / 저장 실패)

## 문제 해결

- **서버가 바로 종료되고 포트 오류가 보이면** (`포트 3000을(를) 열 수 없습니다`): 다른 프로그램이 그 포트를 쓰고 있습니다. `server/.env`에 `PORT=3001` 처럼 다른 포트를 지정하세요.
- **앱이 예전 터널 주소로 접속하면** (서버를 재시작했는데 목록이 안 뜸): Expo를 `npx expo start --tunnel --clear`로 재시작하세요.
- **앱에서만 "접근키를 확인하세요"가 뜨면**: 접근키가 영문·숫자·-·_ 로만 20자 이상인지 확인한 뒤 `npm run server`와 Expo를 모두 재시작하세요.

## 테스트

```bash
npm run server:test
npm --prefix server run typecheck
npx tsc --noEmit
```
