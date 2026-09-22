# 오프라인 모드 — 도면을 미리 내려받아 인터넷 없이 열고, 연결되면 자동으로 올린다

- 날짜: 2026-09-23
- 상태: 설계 승인됨(사용자 2026-09-23: SVF로만 변환, 프로젝트 단위+도면별 내려받기, 기존 도면은 PC에서 "다시 변환", 동기화는 자동).
- 근거 시험: 2026-09-23 SVF 스파이크 — SVF(2D) 파생 파일(`primaryGraphics.f2d` + `manifest.json.gz` + `metadata.json.gz`)을 내려받아 뷰어 파일 7개(5.1MB)와 함께 로컬에서 띄우면 외부 접속 0건으로 도면이 그려지고, 좌표 변환 행렬이 지금(SVF2)과 소수 아홉째 자리까지 같았다. 미검증: **앱 안 WebView**에서 기기 파일을 같은 방식으로 여는 것(이 설계의 3.2가 그 답이고, Task 5에서 실기기로 확인한다).
- 앞선 설계: `2026-09-10-phase1-poc-design.md`(뷰어·동기화), `2026-09-18-photo-upload-design.md`(사진 대기열), `2026-09-21-projects-design.md`(프로젝트).

## 1. 목표

통신이 안 되는 현장(터널·교량 하부)에서도 도면을 열어 손상을 그리고 사진을 찍는다. 인터넷이 되는 곳에서 미리 내려받아 두고, 돌아와 연결되면 **아무 버튼 없이** 서버에 올라간다.

범위 밖: 오프라인에서 새 도면 올리기, 프로젝트 만들기·옮기기, 서버 사진 썸네일 보기(연결되면 보인다), 두 기기의 손상 합치기(지금처럼 도면 단위로 더 새것이 이긴다).

## 2. 변환 형식 — SVF만

- 업로드 시 오토데스크 변환을 **SVF(2D)** 로만 요청한다(지금은 SVF2). 온라인 뷰어도 그대로 SVF를 연다 — 2D 망도에서 화면·좌표 차이가 없음을 스파이크로 확인했다.
- `DrawingRecord.viewFormat?: 'svf' | 'svf2'`. **없으면 `svf2`**(이 기능 전에 올린 도면). `offlineReady`는 저장하지 않고 응답에서 계산한다: `status === 'success' && viewFormat === 'svf'`.
- 기존(SVF2) 도면은 PC 업로드 페이지의 **다시 변환** 버튼으로 필요한 것만 SVF로 바꾼다(장당 0.1토큰). `POST /api/drawings/:id/retranslate` → `x-ads-force: true`로 SVF 작업을 다시 걸고 레코드를 `status: 'pending', viewFormat: 'svf'`로 바꾼다. 이미 `svf`인 도면은 409 `이미 오프라인용(SVF)으로 변환된 도면입니다.` 변환 중(`pending`/`inprogress`)이면 409 `변환이 끝난 뒤에 다시 시도하세요.`
- 강제 재변환 동안(수십 초~수 분) 그 도면은 온라인에서도 열리지 않는다(변환 중 표시). 버튼의 확인 문구에 적는다.

## 3. 저장·전달

### 3.1 서버 — 오프라인 꾸러미 API (접근키 필요)

| 메서드·경로 | 하는 일 |
|---|---|
| `GET /api/drawings/:id/offline` | 이 도면을 기기에 두는 데 필요한 파일 목록. `offlineReady`가 아니면 409 `오프라인용으로 변환된 도면이 아닙니다.` 응답: `{ drawingId, viewFormat: 'svf', model: '<f2d 경로>', files: [{ path, size }] , damagesUpdatedAt }` — `path`는 오토데스크 파생 urn의 `output/` 뒤 상대 경로(예: `0ab7…_f2d/primaryGraphics.f2d`), `files`는 f2d와 그 옆의 `manifest.json.gz`·`metadata.json.gz` 세 개(썸네일·properties.db는 넣지 않는다) |
| `GET /api/drawings/:id/offline/files/*path` | 그 파일 바이트. 서버는 오토데스크에서 한 번 받아 `server/data/cache/derivatives/<drawingId>/<path>`에 두고 다음부터 거기서 준다. `path`는 목록에 있는 것만(아니면 404). `Content-Type: application/octet-stream`, `Cache-Control: private, max-age=86400` |
| `GET /api/viewer-bundle` | 뷰어 꾸러미 목록 `{ version, files: [{ path, size }] }`. 우리 뷰어 파일(`viewer.html`, `viewer/*.js`, `viewer/*.css`)과 오토데스크 뷰어 파일 7개(아래). `version`은 우리 파일 내용의 sha256 앞 12자 + `-` + 오토데스크 뷰어 버전(`7.126.0`) |
| `GET /api/viewer-bundle/files/*path` | 그 파일 바이트. 우리 파일은 `server/public`에서, 오토데스크 파일은 `server/data/cache/viewer/<버전>/<path>`(없으면 `https://developer.api.autodesk.com/modelderivative/v2/viewers/<버전>/<path>`에서 받아 둔다) |

오토데스크 뷰어 파일(스파이크에서 실측): `viewer3D.min.js`, `style.min.css`, `lmvworker.min.js`, `res/locales/ko/allstrings.json`, `res/locales/en/allstrings.json`, `res/ui/powered-by-autodesk-blk-rgb.png`, `extensions/MixpanelProvider/MixpanelProvider.min.js`. CDN이 gzip으로 주므로 서버가 풀어서 저장한다(`content-encoding` 확인). 뷰어 버전은 `server/src/viewerBundle.ts`의 상수 `AUTODESK_VIEWER_VERSION = '7.126.0'`(온라인 뷰어도 같은 버전을 고정해 쓴다 — `viewer.html`의 `7.*`를 `7.126.0`으로 바꾼다. 로컬과 온라인이 같은 코드여야 좌표가 같다).

파생 파일 내려받기는 `ApsService.downloadDerivative(urn, derivativeUrn): Promise<Buffer>`(`GET …/designdata/:urn/manifest/:derivativeUrn`, 내부 토큰)와 `ApsService.getManifest`로 한다. 파생 urn은 manifest의 `svf` 파생 아래 `mime: application/autodesk-f2d`인 노드의 `urn`이고, 옆 파일 둘은 그 urn의 마지막 경로 조각을 바꿔 만든다.

### 3.2 앱 — 기기 저장

```
Paths.document/
  offline/
    index.json                       { bundleVersion, drawings: { [drawingId]: { name, projectId, viewFormat, model, files, damagesUpdatedAt, downloadedAt } } }
    bundle/<version>/…               뷰어 꾸러미(우리 파일 + 오토데스크 파일)
    drawings/<drawingId>/model/…     파생 파일 3개
    drawings/<drawingId>/damages.json  손상 기록(서버와 같은 형식, schemaVersion 5)
```

- 내려받기 단위: **프로젝트**(하위 포함, `offlineReady`인 도면 전부) 또는 **도면 하나**. 순서: 꾸러미(없거나 버전이 다르면) → 도면마다 파일 3개 → 손상 기록. 한 도면이 실패해도 나머지는 계속하고 마지막에 `N장 중 M장 실패`를 알린다. 이미 있는 도면은 손상 기록만 새로 받는다(서버가 더 새것일 때).
- 지우기: 도면 줄 길게 누르기 메뉴에 **기기에서 지우기**(내려받은 도면일 때만). 도면 폴더와 index 항목을 지운다. 서버 손상 기록·사진은 그대로다. 아직 서버에 못 올린 손상(로컬이 더 새것)이 있으면 확인 문구에 `아직 서버에 올리지 못한 손상 기록이 있습니다.`를 붙인다.
- 꾸러미 버전이 바뀌면(서버 갱신) 다음 내려받기 때 새 버전을 받고 옛 버전 폴더를 지운다. 내려받은 도면은 그대로 쓴다.

### 3.3 앱 — 열기 (항상 기기 파일)

- `index.json`에 있는 도면은 **인터넷과 상관없이** 기기 파일로 연다. 없는 도면은 지금처럼 서버 페이지를 연다(인터넷 필요).
- WebView: `source={{ uri: 'file://<document>/offline/bundle/<version>/viewer.html?id=<drawingId>&offline=1' }}`, `originWhitelist={['*']}`, `allowFileAccess`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs`, iOS `allowingReadAccessToURL=<document>/offline/`. 뷰어 페이지는 `injectedJavaScriptBeforeContentLoaded`로 `window.mangdoOffline = { drawing, doc, modelUrl }`을 받는다(`modelUrl`은 `file://…/primaryGraphics.f2d`).
- **실기기 관문(Task 5)**: 아이폰·갤럭시 Expo Go에서 이 방식으로 도면이 그려지는지. 안 되면 대안은 `source={{ html, baseUrl }}`로 페이지를 문자열로 넣고 파일은 `file://`로 두는 것이며, 그래도 안 되면 설계를 다시 한다 — 이 관문 전에는 4·6장을 만들지 않는다(계획의 Task 순서).

### 3.4 뷰어 (`main.js`) — 오프라인 모드

`offline=1`이면:
- `api()`를 쓰지 않는다. `/drawings` → `[mangdoOffline.drawing]`, 손상 GET → `mangdoOffline.doc`, 손상 PUT → `postToApp({ type: 'offlineSave', doc })`를 보내고 앱이 `window.mangdoOfflineSaved({ updatedAt })`로 답하면 성공(3초 안에 답이 없으면 실패로 보고 syncer가 재시도한다).
- 오토데스크 뷰어는 `Autodesk.Viewing.Initializer({ env: 'Local', useADP: false })` → `viewer.loadModel(mangdoOffline.modelUrl)`. 토큰을 받지 않는다.
- 사진 줄: 서버 목록을 읽지 않고, 사진번호 칸의 번호마다 `<번호> (연결되면 보임)` 칩을 보인다. 📷 촬영은 지금처럼 앱에 맡긴다(대기열).
- 저장 배지: 오프라인에서는 `기기에 저장됨` / `기기 저장 실패`로 문구를 바꾼다(`STATUS_LABELS`의 offline 판).
- 기기 백업(`localStorage`)은 `file://`에서 못 믿으므로 쓰지 않는다 — 앱 파일이 곧 백업이다.
- 그 밖(그리기, 속성창, 복제, 번호, 라벨)은 그대로다. 온라인 모드는 바뀌지 않는다(SVF도 `Document.load`로 연다).

### 3.5 동기화 (`src/offlineSync.ts`, 규칙은 순수 모듈 `src/offlineRules.ts`)

- 도면마다 `local.updatedAt`(기기 damages.json)과 서버 `updatedAt`을 비교한다. 규칙(`syncDecision(localUpdatedAt, serverUpdatedAt)`): 로컬이 더 새것 → `push`, 서버가 더 새것 → `pull`, 같으면 `none`. 시각은 ISO 문자열 비교가 아니라 `Date.parse`.
- 언제: (1) 도면 목록 화면이 열릴 때와 당겨서 새로 고칠 때, (2) 뷰어를 닫고 목록으로 돌아올 때, (3) 목록 화면에 있는 동안 60초마다(사진 대기열과 같은 주기, 같은 타이머에서 사진도 함께). 서버에 닿지 못하면 조용히 넘어가고 다음 기회에 한다.
- push는 `PUT /drawings/:id/damages`(지금 API). 서버가 400을 주면(형식 오류) 그 도면은 `sync-error`로 표시하고 다음 기회에 다시 한다.
- 목록 화면 배지: `서버에 올리지 못한 손상 기록 N개`(push 대기 도면 수) — 사진 배지 옆, 누르면 즉시 동기화.
- 온라인으로 연 도면(기기에 없는 것)은 지금 방식(뷰어 안 syncer)이 그대로다.

## 4. PC 업로드 페이지

- 상태 배지 옆에 오프라인 가능 여부: `offlineReady`면 작은 `오프라인` 칩. SVF2 도면(`viewFormat` 없음)에는 **다시 변환** 버튼(확인 문구: `"<도면>"을 오프라인용(SVF)으로 다시 변환할까요?\n\n변환 요금이 한 번 더 들고, 변환이 끝날 때까지(수십 초~수 분) 태블릿에서 열 수 없습니다.`).
- 그 밖은 바뀌지 않는다.

## 5. 앱 화면

- 프로젝트 안(및 미분류)에 **이 목록 내려받기 (N장)** 버튼 — N은 `offlineReady`이고 아직 없는 도면 수. 0이면 `모두 기기에 있음`으로 비활성.
- 도면 줄: 기기에 있으면 `기기` 칩(초록), `offlineReady`인데 없으면 **내려받기** 작은 버튼, SVF2 도면이면 `PC에서 다시 변환 필요` 회색 글씨.
- 내려받는 동안 위쪽 배너 `내려받는 중 3/7 — <도면 이름>`. 끝나면 `내려받았습니다 (7장)` 또는 `7장 중 2장 실패 — 다시 시도하세요`.
- 길게 누르기: 지금의 삭제(휴지통) 확인창에 **기기에서 지우기** 버튼을 더한다(내려받은 도면일 때만).

## 6. 바뀌지 않는 것

손상 기록 형식(v5), 사진 대기열·서버 보관, DXF 산출, 프로젝트·휴지통 API, 온라인 뷰어의 동작. 기기에 없는 도면은 지금과 똑같이 동작한다.

## 7. 검증

단위(vitest): 변환 형식·`viewFormat`·`offlineReady`·retranslate 409/200; 오프라인 목록·파일 라우트(가짜 APS: manifest에서 f2d urn 찾기, 캐시 저장·재사용, 목록에 없는 path 404, SVF2 도면 409); 뷰어 꾸러미 목록(버전 계산·파일 목록)과 파일 라우트(CDN 가짜, gzip 풀기, 캐시); 순수 규칙 `src/offlineRules.ts`(`syncDecision`, `drawingsToDownload(projectItems, index)`, `bundleNeedsUpdate`); 뷰어 오프라인 판단은 `photoStrip.js`처럼 순수 부분(`offlineApi(data)`의 응답 형태)만.

실기기(사용자, 순서대로): (1) PC에서 도면 하나 **다시 변환** → `오프라인` 칩. (2) 앱에서 그 도면 **내려받기** → `기기` 칩. (3) **비행기 모드** → 앱 완전히 껐다 켬 → 그 도면을 열어 손상 하나 그리고 사진 한 장 찍고 저장 → 목록으로 나옴 → 배지 `서버에 올리지 못한 손상 기록 1개`, `보내지 못한 사진 1장`. (4) 비행기 모드 해제 → 목록 화면에서 기다림(60초 안) → 두 배지가 사라짐 → PC에서 DXF·사진 zip에 그 손상·사진이 있음. (5) 프로젝트 내려받기 버튼으로 여러 장 한 번에. (6) 기기에서 지우기.

## 8. 미해결·주의

- 오토데스크 뷰어 파일을 기기에 담는 것에 대한 약관 확인은 사용자 몫(보고서 4.1).
- iOS `file://` 페이지에서 `localStorage`가 비어 있을 수 있어 뷰어 백업을 쓰지 않는다(3.4). 앱 파일 저장이 대신한다.
- 같은 도면을 두 기기에서 오프라인으로 그리면 나중에 올린 쪽이 이긴다(지금과 같음).
