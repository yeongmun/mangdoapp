# 1단계 PoC 설계 — DWG 뷰어 + 균열 입력

- 작성일: 2026-09-10
- 상태: 설계 승인됨 (구현 계획 작성 전)
- 근거: `docs/기능명세서.md` 5장 1단계, `CLAUDE.md`

---

## 1. 목표와 완료 기준

**목표**: DWG 업로드 → APS 변환 → 태블릿 웹뷰에 뷰어 표시 → 펜으로 균열 입력 → 도면 좌표 기준 JSON 저장

**완료 기준** (아이패드·갤럭시탭 실기기에서 확인):

1. PC 브라우저 업로드 페이지에서 DWG를 올리면 목록에 변환 상태(대기/진행 중/완료/실패)가 표시된다. 실패 시 원인과 재시도 버튼이 보인다.
2. 태블릿의 Expo Go 앱에서 도면 목록이 보이고, 변환 완료된 도면을 열면 APS 뷰어로 표시된다.
3. 손가락으로 핀치 줌·팬이 되고, 펜으로 균열을 그을 수 있다. 펜으로 그리는 동안 손바닥 접촉은 무시된다.
4. 줌·팬을 해도 균열이 도면에 고정되어 함께 움직인다.
5. 앱을 종료했다가 같은 도면을 다시 열면 균열이 복원된다.
6. 서버의 손상 JSON에 균열 좌표가 `world`(뷰어)와 `dwg`(원본 DWG) 두 좌표계로 저장된다.
7. 도면의 알려진 점(예: 부재 모서리)에 찍은 꼭짓점의 `dwg` 좌표가 지스타캐드 `ID` 명령 값과 일치한다.
   목적은 원점·축척·회전 오류가 없는지 판정하는 것이며, 충분히 확대한 상태의 펜 정밀도 수준 차이는 허용한다.

## 2. 범위

**포함**
- PC 웹 업로드 페이지 (업로드, 변환 상태 목록, 재시도)
- APS 연동: 토큰, 버킷, 파일 업로드, 변환 요청, 상태 조회, 뷰어용 읽기 전용 토큰
- 태블릿 앱: 도면 목록 화면, 뷰어 화면(WebView)
- 균열(선형) 1종 입력, 약한 단순화, 마지막 취소, 선택 삭제
- 손상 JSON 자동 저장 + 로컬 백업 + 재전송
- 간단한 접근키 보호

**제외** (후속 단계)
- DWG 내보내기 / Design Automation (2단계)
- 균열 외 손상 유형, 물량 단위 환산·집계, 물량표, 손상 속성 입력 (3단계)
- 로그인·권한, 프로젝트 관리, 조사 이력, 사진 첨부 (4단계)
- 레이어 표시/숨김 UI, 동시 편집 충돌 처리

## 3. 구조

```
[PC 브라우저] ── DWG 업로드 ──▶ [Node 서버 (내 PC, :3000)] ──▶ APS (OSS 버킷, Model Derivative)
                                     ▲  cloudflared 퀵 터널 (https://xxxx.trycloudflare.com)
[태블릿 앱 (Expo Go)]                 │
  ├ 도면 목록 화면 ── GET /api/drawings
  └ 뷰어 화면 = WebView ──▶ /viewer.html?id=…#key=…
        APS Viewer + 균열 입력 ── PUT /api/drawings/:id/damages
```

**결정: 뷰어 페이지는 서버가 제공한다.** 앱은 WebView로 주소를 열기만 한다.
- PC 크롬에서도 동일하게 열려 디버깅이 쉽고, 명세서의 "PC 겸용"을 충족한다.
- 뷰어 수정 시 앱 재시작 없이 페이지 새로고침으로 반영된다.
- 대안(앱 내 HTML 포함)은 Expo Go에서 로컬 HTML 로딩과 메시지 브리지가 번거로워 기각했다.

**결정: 서버는 사용자 PC에서 실행하고 cloudflared 퀵 터널로 외부 HTTPS 주소를 부여한다.**
PC(유선)와 태블릿의 네트워크가 달라 LAN 접속이 불가하기 때문이다. 퀵 터널 주소는 실행할 때마다 바뀐다.

## 4. 구성 요소

### 4.1 서버 (`server/`)

- Node.js + TypeScript + Express. 앱과 의존성을 섞지 않도록 `server/package.json`을 따로 둔다.
- 환경변수 `server/.env` (커밋 금지), 틀은 `server/.env.example`로 커밋:
  - `APS_CLIENT_ID`, `APS_CLIENT_SECRET` — 필수
  - `APP_ACCESS_KEY` — 필수, 접근키
  - `APS_BUCKET_KEY` — 선택, 미지정 시 client id에서 파생한 고유 이름
  - `PORT` — 선택, 기본 3000

**APS 모듈**
- 2-legged 토큰 발급, 만료 전까지 캐시. 서버 작업용 토큰과 뷰어용 토큰(`viewables:read` 한정)을 분리한다.
- 버킷이 없으면 생성한다 (영구 보관 정책). 2단계 Design Automation이 원본 DWG를 다시 쓰기 때문이다.
- S3 서명 업로드 방식으로 파일을 올린다.
- Model Derivative로 SVF2(2D 뷰 포함) 변환을 요청하고, manifest로 진행률·실패 사유를 조회한다.

**API** (모든 `/api/*`는 `x-access-key` 헤더가 `APP_ACCESS_KEY`와 일치해야 하며, 불일치 시 401)

| 메서드 · 경로 | 동작 |
|---|---|
| `POST /api/drawings` | multipart DWG 업로드 → OSS 업로드 → 변환 요청 → 도면 레코드 생성 |
| `GET /api/drawings` | 도면 목록. 완료/실패가 아닌 도면은 manifest를 조회해 상태를 갱신 |
| `POST /api/drawings/:id/retry` | 실패한 변환 재요청 |
| `GET /api/viewer-token` | `viewables:read` 토큰과 만료 시간 |
| `GET /api/drawings/:id/damages` | 손상 JSON. 없으면 빈 문서 |
| `PUT /api/drawings/:id/damages` | 손상 JSON 전체 저장 (검증 통과 시) |

정적 페이지 `upload.html`, `viewer.html`과 뷰어 JS는 키 없이 제공한다. 페이지는 공개돼도 데이터 API는 키가 없으면 호출되지 않는다.

**업로드 제한**: 확장자 `.dwg`만, 최대 100MB.

**저장소** (`server/data/`, git 제외)
- `drawings.json` — 도면 레코드 목록
- `damages/<drawingId>.json` — 도면별 손상 문서
- 쓰기는 임시 파일에 쓴 뒤 rename한다 (쓰는 도중 종료돼도 파일이 깨지지 않게).

도면 레코드:
```json
{
  "id": "d_…",
  "name": "원본파일명.dwg",
  "objectKey": "…",
  "urn": "…",
  "status": "pending | inprogress | success | failed",
  "progress": "45% complete",
  "error": null,
  "uploadedAt": "2026-09-10T…Z"
}
```

### 4.2 뷰어 페이지 (`server/public/viewer.html`)

- APS Viewer SDK v7 (Autodesk CDN). 브라우저 코드는 **빌드 없는 순수 JS ES 모듈**로 작성한다.
- 로드 순서: URL에서 `id`와 `#key` 읽기 → 뷰어 토큰 발급 → 문서 로드 → 2D 뷰 표시 → 손상 JSON 불러와 그리기
- 접근키는 URL 해시(`#key=…`)로 받는다. 해시는 서버로 전송되지 않아 로그에 남지 않는다.

**모듈 구성** (각각 하나의 역할)

| 모듈 | 역할 | 뷰어 의존 |
|---|---|---|
| `geometry.js` | 선 단순화(Ramer–Douglas–Peucker), 폴리라인 길이, 점–폴리라인 거리 | 없음 (단위 테스트) |
| `damageDoc.js` | 문서 생성·추가·삭제, undo 스택, 검증 | 없음 (단위 테스트) |
| `coords.js` | 화면 ↔ 뷰어 world ↔ DWG 좌표 변환 | 있음 |
| `overlay.js` | SVG로 균열 렌더링, 카메라 변경 시 재투영 | 있음 |
| `crackTool.js` | 포인터 입력 → 획 수집 → 단순화 → 문서 반영 | 있음 |
| `sync.js` | 자동 저장, 로컬 백업, 재전송, 저장 상태 표시 | 없음 |

**입력 규칙**
- `pointerType === "pen"` → 그리기
- `touch` → 뷰어 줌·팬으로 전달
- `mouse` → PC 테스트용. 그리기 모드일 때 그리기
- 펜으로 그리는 중 들어오는 다른 포인터는 무시한다 (팜 리젝션).
- "손가락으로 그리기" 토글: 켜면 한 손가락 = 그리기, 두 손가락 = 줌·팬
- 획이 끝나면 약한 단순화를 적용한다.
  - 허용 오차: 현재 줌에서 화면 1.5px에 해당하는 world 거리
  - 단순화 후 점이 2개 미만이거나 화면상 길이가 10px 미만이면 오터치로 보고 버린다.

**편집**
- 마지막 취소: 직전 추가·삭제를 되돌린다.
- 선택 삭제: 균열을 탭하면(화면 기준 12px 이내) 강조되고, 삭제 버튼으로 지운다.

**표시**
- 균열은 빨간색, 줌과 무관하게 화면 기준 1px 두께 (선택 시 주황 2px). 굵기는 `overlay.js`의 `CRACK_WIDTH_PX`, `SELECTED_WIDTH_PX`로 조절한다
- 저장 상태 배지: 저장됨 / 저장 중 / 저장 대기

### 4.3 앱 (`App.tsx`, `src/`)

- **도면 목록 화면**: `GET /api/drawings`, 상태 배지, 당겨서 새로고침. 완료된 도면만 열 수 있다.
- **뷰어 화면**: `react-native-webview`로 `${API_URL}/viewer.html?id=…#key=…`를 연다. 뒤로가기 버튼, 로딩·오류 표시.
- 화면이 두 개뿐이므로 내비게이션 라이브러리 없이 상태로 전환한다.
- 설정: 루트 `.env.local`의 `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_ACCESS_KEY` (커밋 금지).
  `EXPO_PUBLIC_*` 값은 앱 번들에 포함되므로, APS 키는 절대 여기에 넣지 않는다. 접근키는 PoC 수준 보호로 허용한다.
- WebView 설정: 브라우저 자체 확대 비활성화(줌은 뷰어가 처리), iOS 스크롤 바운스 끔

### 4.4 실행 흐름

1. `npm run server` (루트): 서버 시작 → cloudflared 퀵 터널 시작 → 터널 주소를 감지해 루트 `.env.local`에 `EXPO_PUBLIC_API_URL`(터널 주소)과 `EXPO_PUBLIC_ACCESS_KEY`(`server/.env`의 `APP_ACCESS_KEY` 복사)를 기록 → 주소 출력
2. `npx expo start --tunnel`: 앱 실행
3. PC 브라우저에서 `http://localhost:3000/upload.html` 로 업로드

서버를 재시작하면 터널 주소가 바뀌므로 Expo도 재시작해야 한다.

## 5. 손상 데이터 형식

JSON이 원본이고 DWG는 산출물이다.

```json
{
  "schemaVersion": 1,
  "drawingId": "d_…",
  "updatedAt": "2026-09-10T…Z",
  "damages": [
    {
      "id": "uuid",
      "type": "crack",
      "createdAt": "2026-09-10T…Z",
      "geometry": {
        "kind": "polyline",
        "world": [[x, y], …],
        "dwg": [[x, y], …]
      },
      "lengthDwg": 1234.5
    }
  ]
}
```

- `world`: 뷰어 좌표. 화면에 다시 그릴 때 사용
- `dwg`: 원본 DWG 좌표. 2단계 DWG 산출에 사용. 변환이 불가능한 도면이면 `null`
- `lengthDwg`: DWG 좌표 단위 길이. m 환산은 도면 단위가 확정되는 3단계에서 한다. `dwg`가 `null`이면 `null`

**검증 규칙** (서버·클라이언트 공통)
- `schemaVersion`은 1, `drawingId`는 URL과 일치
- `type`은 `crack`, `geometry.kind`는 `polyline`
- `world`는 점 2개 이상, 모든 값은 유한한 숫자
- `dwg`가 있으면 `world`와 점 개수가 같다
- `id`는 문서 안에서 중복 불가

## 6. 좌표 변환 (핵심 위험)

- **화면 → world**: 뷰어의 화면→월드 좌표 변환을 사용한다.
- **world → dwg**: 2D 모델이 제공하는 page→model 변환 행렬로 원본 DWG 모델 공간 좌표를 복원한다.
- **위험**: 2D DWG는 뷰어 world 좌표가 DWG 원본 좌표와 다를 수 있다. 레이아웃(도면틀) 뷰이거나 변환 정보가 없는 도면이 그런 경우다.
- **대응**
  - 모델 공간 2D 뷰를 우선 로드한다.
  - 변환 행렬을 얻지 못하면 `dwg`를 `null`로 저장하고 뷰어에 "DWG 좌표 변환 불가" 경고를 띄운다.
  - 완료 기준 7번(지스타캐드 `ID` 비교)으로 실측 검증한다.
- 검증 결과, 망도가 레이아웃에 그려져 있어 변환이 맞지 않으면 2단계 착수 전에 처리 방식을 결정한다.

## 7. 오류 처리

| 상황 | 동작 |
|---|---|
| 서버 시작 시 APS 키 오류 | 토큰을 1회 발급해보고, 실패하면 원인을 출력한 뒤 종료 |
| 업로드 실패 | 업로드 페이지에 오류 표시, 도면 레코드를 만들지 않음 |
| 변환 실패 | `status: failed` + manifest 실패 사유 저장, 목록에 재시도 버튼 |
| 뷰어 토큰·문서 로드 실패 | 뷰어에 오류 메시지 + 재시도 버튼 |
| 접근키 불일치 (401) | "접근키를 확인하세요" 안내 |
| 저장 실패·오프라인 | 로컬 백업 유지, "저장 대기" 표시, 재시도 간격 5초에서 두 배씩 늘려 최대 60초 |
| 다시 열었을 때 로컬 백업이 서버보다 최신 | 로컬 백업을 적용하고 서버로 재전송 |
| 동시 편집 | 단일 사용자 전제. 마지막 저장이 우선 (4단계에서 처리) |

## 8. 테스트

**자동 (단위 테스트)**
- `geometry.js`: 단순화 결과가 허용 오차 안에 있는지, 직선은 양 끝점만 남는지, 길이 계산
- `damageDoc.js`: 추가·삭제·undo, 검증 규칙 통과·거부 사례
- 서버 검증·저장소: 원자적 쓰기, 없는 문서 조회 시 빈 문서
- 접근키 미들웨어: 키 없음·틀림 → 401, 일치 → 통과
- APS 모듈: fetch를 가짜로 대체해 토큰 캐시, 업로드 순서, 상태 매핑 확인

**수동 (실기기)**: 1장 완료 기준 1~7번을 아이패드와 갤럭시탭에서 각각 확인한다.

## 9. 파일 구조

```
mangdo-app/
├── App.tsx
├── src/
│   ├── api.ts
│   └── screens/
│       ├── DrawingListScreen.tsx
│       └── ViewerScreen.tsx
├── metro.config.js          # server/ 폴더를 앱 번들 감시에서 제외
├── .env.local               # EXPO_PUBLIC_* (git 제외, 자동 생성)
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── .env                 # APS 키 (git 제외)
    ├── .env.example
    ├── src/
    │   ├── index.ts         # 서버 시작
    │   ├── config.ts        # 환경변수 로드·검증
    │   ├── auth.ts          # 접근키 미들웨어
    │   ├── aps.ts           # APS 연동
    │   ├── routes.ts        # API
    │   ├── drawingsStore.ts
    │   └── damagesStore.ts
    ├── scripts/dev.ts       # 서버 + 터널 + .env.local 갱신
    ├── public/
    │   ├── upload.html
    │   ├── viewer.html
    │   └── viewer/          # geometry.js, damageDoc.js, coords.js, overlay.js, crackTool.js, sync.js
    ├── data/                # git 제외
    └── test/
```

`.gitignore`의 `.env.*` 규칙이 `.env.example`까지 제외하므로 `!.env.example` 예외를 추가한다.

## 10. 후속 확인 사항

- 망도가 모델 공간이 아닌 레이아웃에 그려진 경우의 좌표 처리 (완료 기준 7번 결과로 판단)
- 도면 단위(mm/m) 확정 (3단계 물량 계산 전)
- 매번 바뀌는 터널 주소가 불편하면 고정 도메인 터널 또는 클라우드 배포로 전환
- 로컬 백업이 터널 주소(origin)에 묶여 서버 재시작 후에는 복구할 수 없음 → 앱(RN) 측 저장소나 고정 도메인 터널로 이전 검토
- 저장 오류를 재시도 가능(네트워크·5xx)과 불가능(4xx·형식 오류)으로 구분 — 1단계에서 "저장 실패" 상태로 반영함
- 완료 기준 6은 도면을 다시 열기 전에 서버 JSON으로 확인 (로컬 백업이 누락을 가리지 않도록)
