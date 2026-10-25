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
- **앱 디자인** (2026-10-25, 앱 이름 **농농**): 흰 바탕·굵은 검정 글자·얇은 테두리 카드, 주 버튼 검정, 강조는 찍음=초록·로고 점=주황뿐. 시안은 Design 아티팩트 "망도 앱 디자인 시안" 2차(폰). 사진은 폰, 망도 그리기는 태블릿(폰에서도 도면은 열림; 탭 기본값은 폰=필수 사진, 태블릿=도면). 토큰 `src/theme.ts`(색·**글꼴**·간격) — 글꼴은 Pretendard(`assets/fonts`, OFL)를 `App.tsx` `useFonts`로 올리고 굵기마다 `font.*` 이름을 쓴다(`fontWeight` 안 씀). 공용 컴포넌트 `src/components/`(TypeChips·ShotCard/CompareShotCard·IconButton(Feather)·Wordmark·LoadingView). 과업 카드 요약은 순수 모듈 `src/homeSummary.ts`. 앱 아이콘은 없음(Expo 기본 — 2026-10-25 사용자 결정, 나중에 정함). 스플래시 `assets/splash-icon.png`(로고 글자).
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
