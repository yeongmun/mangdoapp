# 망도 손상조사 앱 — Claude Code 작업 가이드

## 프로젝트 개요
태블릿(iPad, 갤럭시탭)에서 캐드 망도(DWG/DXF)를 열어 보고, 펜으로 손상을 표기한 뒤,
손상 레이어와 손상물량표(ACAD_TABLE)가 반영된 DXF/DWG로 다시 내보내는 앱.
인프라스마트 "태블릿 Pro"와 같은 방향. 내업 웹(`daenong` 저장소)이 이 서버의 손상 원장을 읽어 집계표·사진첩을 만든다.

원래 요구사항은 `docs/기능명세서.md`. 현재 결정·진행 기록·확인 항목은 Claude 프로젝트 "대농"의
`claude/프로젝트-허브-설계.md`(§8 결정, §9 진행, §10 앱 Pro 방향)와 `claude/확인-체크리스트.md`에 있다.

## 현재 상태 (2026-10-24)
- **앱** (`src/`): Expo(React Native, TypeScript). 도면 목록 화면 + 뷰어 화면(WebView). 오프라인 저장·동기화(`offlineSync.ts`, 규칙 `offlineRules.ts`), 사진 촬영·업로드 큐.
- **서버** (`server/`): Express 5 + vitest. 파일 저장(`server/data/`, DB 없음). 손상 JSON(schemaVersion 5)이 원본.
  업로드 → APS 변환(뷰어용 SVF2만) → 손상 저장/병합(`mergeDamages.ts`, 손상 id 단위·삭제 기록 보존) →
  산출: 손상 DXF(`export/`), DWG(ODA 변환), 사진 zip, 손상 원장 JSON/xlsx(`ledger.ts`, `ledgerXlsx.ts`), 손글씨 인식(`handwriting.ts`, Claude 비전).
- **뷰어** (`server/public/viewer/`): APS Viewer 위 순수 JS 모듈. 선/네모/손글씨 토글, 속성창(손상유형·사진), 현황표 패널, 표 칸 글자 겹쳐 그리기.
  순수 규칙 모듈(`quantities.js`, `tableValues.js`, `statusTable.js`, `inkAttach.js`, `damageDoc.js`)은 서버 산출과 **같은 함수**를 쓰고 vitest가 검사한다.
  뷰어 번들은 도면을 내려받을 때 태블릿에 저장되므로, 뷰어를 고치면 "기기에서 지우기 → 다시 받기"를 해야 반영된다.
- **PC 페이지** (`server/public/`): 업로드, 프로젝트, 내려받기, 휴지통.
- **프로젝트**: 최상위(과업)에 `inspectionType`(점검 종류), 하위(구조물)에 `facilityType`(시설물 종류) — 앱 목록 화면 칩으로 고른다(2026-10-24). 웹(daenong)이 정기·정밀 과업을 저장하면 같은 이름의 최상위 프로젝트를 자동 생성한다. 현장 사진 체크리스트 설계: `docs/design/2026-10-24-field-photo-checklist.md`(1~4단계 완료, 계획은 `docs/plans/`).
- **촬영 항목(shots)** (2026-10-24, 2·3단계): 구조물마다 필수 사진(`required`)·전차 사진(`previous`) 목록(`server/src/shotsStore.ts`, `data/shots/`). 필수 목록은 `server/config/requiredShots.json`(시설물 종류별, 바꾸면 재시작). 전차 사진은 웹에서 올린 한글 파일을 앱 서버가 hwpx로 직접 읽어(`zipRead.ts`, `hwpxPhotos.ts` — **그림이 든 표 하나 = 페이지 하나**, 칸 좌표로 캡션 짝짓기) 만들고, 참조 이미지는 `data/shots/<id>/ref/`. 페이지 삭제는 휴지통(`trashed`, `PATCH …/shots/groups/:group`)이고 다시 올리면 안 찍은 옛 항목도 휴지통. 앱 [필수 사진]/[전차 사진] 탭(`RequiredShotsView`/`PreviousShotsView`, 공용 `useShots`)이 손상 사진과 **같은 대기열**(`photoQueue.target`)로 올린다. 사진 zip엔 `<구조물>/<구조물_부재_번호>.jpg`. 웹 과업 상세가 찍은 사진을 보여 주고 부재명을 고친다(`PATCH …/shots/:shotId`, 4단계). 1~4단계 완료 — 남은 입력은 시설물별 필수 목록과 보고서 예시(사용자).
- **앱 디자인** (2026-11-01 3차, 앱 이름 **농농**): 회색 바탕(#f2f4f6) 위 흰 둥근 카드, 강조 파랑(#3182f6, 토스 느낌). 시안은 Design 아티팩트 "망도 앱 디자인 시안" 3차. 사진은 폰, 망도 그리기는 태블릿(폰에서도 도면은 열림; 탭 기본값은 전차 사진 있으면 전차, 폰=필수 사진, 태블릿=도면). **하단 메뉴** 과업 / 찍은 사진(`PhotosScreen`) / 업로드 대기(`QueueScreen`) — `App.tsx`가 세 화면을 띄워 두고 고른 것만 보이며, 구조물 화면에선 메뉴를 숨긴다. 홈 「이어서 찍기」→[카메라 열기]는 그 구조물 사진 탭이 다음 사진 카메라를 바로 연다(`autoShoot`, 탭을 직접 바꾸면 끝). 전차 사진 카드의 보고서 사진을 누르면 「사진 한 장」(`ShotDetailModal`, 옆으로 넘김·[사진 찍기]). 움직임 부품 `src/components/motion.tsx`(눌림 축소+사진 확대 PressScale/ZoomImage·CheckPop·AnimatedBar·FadeSlideIn·Skeleton, RN Animated만, 「동작 줄이기」 존중) + `BottomSheet`(스프링으로 올라와 붙음, 입력 자동 포커스·빈칸이면 버튼 비활성)·`Toast`·`SegmentedTabs`·`TabBar`·`ShotProgress`. 토큰 `src/theme.ts`(색·**글꼴**·간격·radius) — 글꼴은 Pretendard(`assets/fonts`, OFL)를 `App.tsx` `useFonts`로 올리고 굵기마다 `font.*` 이름을 쓴다(`fontWeight` 안 씀). 과업 요약·다음 사진은 순수 모듈 `src/homeSummary.ts`(`nextShot`). 앱 아이콘은 없음(Expo 기본 — 사용자 결정, 나중에 정함). 스플래시 `assets/splash-icon.png`(로고 글자, 파랑 점). **2차 영상 반영(2026-11-02)**: 찍으면 5초 동안 서버로 안 보내고(`photoQueue` `holdUntil`, `useShots` `UNDO_MS`) 토스트 「찍었어요 · 되돌리기」, 찍은 칸은 아래 「찍음 (N) ▾」 묶음, 다 찍으면 「모두 찍었어요」(`AllDoneCard`). 사진 칸에 전송 상태(`UploadBadge` — `photoUpload`의 상태 알림 `subscribeUploadStatus`/`useUploadStatus`), 업로드 대기에 「올리는 중 n / N」. 인터넷 끊김은 `NetworkWatch`(expo-network, `isConnected`만·2초 지켜봄 — 데이터여도 늘 올린다, 사용자 결정): 하단 메뉴 위 어두운 줄 + 다시 이어지면 바로 보냄. 찍은 사진 크게 보기 `PhotoViewer` + `ZoomableImage`(PanResponder: 두 손가락 확대·두 번 톡·아래로 끌어 닫기). 앨범에서 고르기는 안 넣음(사용자 결정).
- **앱 안 카메라·근처 구조물** (2026-11-02 4차, 시안 승인): 촬영 항목은 폰 기본 카메라 대신 `CameraScreen`(expo-camera, 전체 화면 Modal)에서 이어 찍는다 — 위 ‹ › 이전/다음 항목(모든 칸 차례로), 아래 항목 줄(옆 스크롤, 62px), 셔터 → `savePhotoFromUri`(`photo.ts`, ImagePicker 흐름의 3~7단계를 뗀 것) → `useShots.commitPhoto` → 카메라 안 「찍었어요 · 되돌리기」 줄 → 다음 안 찍은 항목으로 자동 이동. 전차 사진은 보고서 사진 겹쳐 보기(끔/연하게/진하게). `useShots.shoot(shot)`은 이제 카메라를 여는 것뿐(`cameraShotId`). 손상 사진(뷰어)은 그대로 `takePhotoAndSave`. **구조물 위치**: 사진을 찍을 때 폰 GPS(expo-location, High, 정확도 100m 이내만)를 그 구조물 `location`으로 서버에 기록(`structureLocation.ts`, 오프라인이면 `structure-locations.json`에 두고 다음에; 서버 `projectsStore.shouldReplaceLocation` — 더 정확하거나 1시간 지난 값만 바꿈). 홈 `NearbyCard`가 3km 안 가까운 구조물 3개와 거리를 보여 주고 [찍기]는 autoShoot(순수 규칙 `nearby.ts`). 위치 권한은 첫 촬영 때 한 번 묻고, 홈에선 [현재 위치로 찾기] 버튼으로만 묻는다. `app.json`에 expo-camera·expo-location 플러그인(네이티브 빌드 때 권한 문구) — Expo Go에선 바로 됨.
- **필수 사진 펼치기·구조물 정보** (2026-11-03): `config/requiredShots.json` 항목에 선택 필드 `levels`(점검 종류)·`levelWhen`·`when`(구조물 정보 조건)·`repeat`(once/perSpan/perAbutment/perPier/perSupport/perJoint/perSide)·`hint`. 서버 `requiredShots.ts`의 순수 함수 `expandRequired`가 상위 과업 `inspectionType`과 구조물 `facilityInfo`(경간·교대·교각·신축이음 수, 바닥판·거더 형식, 박스·트러스·케이블·하천, 종별, 공중이용부위, 연장·최대경간)로 칸을 편다 — 위치 칸은 부재명에 위치(`교각(P3)`, 받침은 A1→P…→A2). 정보가 없으면 조건 칸은 빼고 반복 칸은 1장, 응답 `needsFacilityInfo`로 앱이 「넣기」 띄움. 앱: 교량 구조물 화면 「구조물 정보」 알약 → `FacilityInfoSheet`(변환·검사 순수 모듈 `src/facilityInfo.ts`), 칸에 점검 포인트(`hint`). 교량 목록 근거는 세부지침 해설서(교량편) 2026.2 — 원본 추출 데이터(상태평가 기준·가중치·결함도·중대결함·손상종류·재료시험 수량)는 `docs/reference/bridge-guideline-2026/`.
- **사내 환경**: 서버 PC는 Windows(ODA File Converter 있음 → DWG 업로드·산출 가능), 캐드는 지스타캐드. cloudflared 터널로 태블릿 접속.
- **비파괴(반발경도·탄산화)는 이 앱 범위 밖**(사용자 결정).

## 작업 방식
- 브랜치·PR 없이 `main`에 바로 커밋한다. 커밋 서명은 세션의 attribution 규칙대로.
- 한 번에 다 만들지 말고 단계별로, 각 단계마다 사용자가 실기기에서 테스트할 수 있는 상태로 끝낸다.
- 실기기 확인이 필요한 항목은 작업을 멈추지 말고 `claude/확인-체크리스트.md`에 적고 계속 진행한다.
- 메뉴·기능은 꼭 필요한 것만, 복잡하지 않게.
- 테스트: `cd server && npx vitest run`(앱 순수 모듈 테스트도 여기서 돈다 — 루트 `npm install`이 되어 있어야 expo tsconfig를 찾는다). 앱 타입 검사 `npx tsc --noEmit`(루트).

## 주의사항
- APS·Anthropic 키는 `server/.env`로 관리하고 절대 커밋하지 않는다(`server/.env.example` 참고).
- 뷰어 위 손상 입력은 화면 좌표가 아닌 **도면 좌표계** 기준으로 저장한다.
- 손상 입력은 유형별 정형 입력(균열=폴리라인 '선', 그 외=사각형 '네모'). 자유곡선 없음.
- 손글씨(치수)는 **선택한 손상에만** 붙는다. 획은 도면 좌표로 저장하고, 인식은 서버가 나중에(온라인일 때) 처리한다.
- 손상 원본 데이터는 JSON이 원본이고 DXF/DWG/엑셀은 산출물이다. 번호·손상현황·물량은 저장값이 아니라 계산값(`quantities.js`).
- 손상위치(부재)는 앱에서 입력하지 않는다 — 캐드/엑셀에서 사람이 적는다(2026-10-07 결정).
- 기존 손상(전차 망도의 `/table` 행)은 틀마다 `startNumber`·`existing`으로 읽어 신규 번호를 그 다음부터 매긴다.
