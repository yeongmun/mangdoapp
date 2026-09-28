# 기기 버전 통일 + 페이지 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 앱이 도면을 항상 기기 파일로 열게 하고(없으면 눌러서 자동 받기), 목록·헤더 UI를 단순화하며, 뷰어에 망도틀 단위 "페이지" 보기를 더한다.

**Architecture:** 서버는 바뀌지 않는다. 앱: `ViewerScreen`은 기기 소스만, `DrawingListScreen`은 누르면 받고 여는 흐름과 합친 배지. 뷰어: `pageView.js` 순수 규칙 + 도구막대 전환·아래 페이지 이동, 선택은 앱이 `viewer-prefs.json`에 기억.

**Tech Stack:** Expo SDK 57 · RN · expo-file-system / 뷰어 plain ESM + Autodesk Viewer 7.126 / vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-device-only-and-pages-design.md` (binding)

## Global Constraints
- 커밋 한국어, 끝에 정확히 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 파일은 이름으로 스테이징(`git add .`/`-A`/`commit -a`/`checkout`/`restore`/`stash` 금지).
- `.dxf` 픽스처·`server/data/` 수정 금지, `.env*` 커밋 금지, 새 npm 의존성 금지, 서버 코드(`server/src`) 수정 금지.
- `src/offlineRules.ts`는 import 없는 순수 모듈 유지. 뷰어 JS는 의존성 없는 ESM.
- 문구는 스펙 그대로.
- 끝낼 때마다 `npm --prefix server test`, `npm --prefix server run typecheck`, 루트 `npx tsc --noEmit`, `node --check server/public/viewer/main.js`(뷰어를 건드렸으면). 기준선 1053 통과.

---

### Task 1: 앱 — 기기 버전으로 통일 (스펙 1장)

**Files:** Modify `src/screens/DrawingListScreen.tsx`, `src/screens/ViewerScreen.tsx`, `src/offlineSync.ts`, `src/offlineRules.ts`, `src/api.ts`(필요 시 `viewerUrl` 제거·미사용 정리), `App.tsx`(필요 시), `README.md`(오프라인 절을 "기기 버전" 설명으로 고침). Test `server/test/offlineRules.test.ts`.

**Interfaces:**
- `offlineRules.ts`: `export function pendingSummary(damages: number, photos: number): string | null` — 스펙 1.2 문구(`서버에 아직 안 올라감: 손상 N개 · 사진 M장`, 0인 쪽 생략, 둘 다 0이면 null).
- `offlineSync.ts`: `syncOffline(options?: { skipPullFor?: string }): Promise<SyncResult>` — `skipPullFor` 도면은 pull 결정이 나와도 건너뛴다(push는 한다). 진행 중 약속이 있으면 그것을 돌려주는 지금 동작 유지(옵션이 달라도).
- `ViewerScreen`: props `{ drawing: Drawing; onBack }` 유지하되 기기 소스만 만든다(`buildOfflineSource`가 null이면 "기기에 도면 파일이 없습니다. 목록에서 다시 눌러 주세요." 오류 화면 + 뒤로). 헤더 오른쪽 서버 전송 상태(스펙 1.3). 뷰어가 열려 있는 동안 30초마다 + `offlineSave` 처리 3초 뒤(디바운스) `flushPhotoQueue` + `syncOffline({ skipPullFor: drawing.id })`, 끝나면 헤더 상태 갱신. 언마운트 시 타이머 정리.
- `DrawingListScreen`: 줄 누르기 → 기기에 있으면 `onOpen`; `offlineReady`인데 없으면 `downloadDrawings([drawing])`(배너 `여는 중 — <이름>`) 성공 시 `onOpen`, 실패 시 배너 `내려받지 못했습니다: <사유>`; 그 밖(옛 도면·변환 중·실패)은 누를 수 없음. 상태 칩(스펙 1.2), 줄 내려받기 버튼 제거, 목록 버튼 이름 변경, 배지 하나로(`pendingSummary`), 길게 누르기 창 버튼 순서.

- [ ] Step 1 실패 테스트(`pendingSummary` 4경우; `skipPullFor`는 결정 로직을 순수 함수 `effectiveDecision(decision, drawingId, skipPullFor)`로 빼서 테스트)
- [ ] Step 2 실패 확인 → Step 3 구현 → Step 4 검증 → Step 5 커밋

---

### Task 2: 페이지 보기 (스펙 2장)

**Files:** Create `server/public/viewer/pageView.js`, `src/viewerPrefs.ts`; Modify `server/public/viewer/main.js`, `server/public/viewer.html`, `server/public/viewer/viewer.css`, `src/screens/ViewerScreen.tsx`, `docs/DXF산출-테스트-결과.md`(74~80행 덧붙임). Test `server/test/pageView.test.ts`.

**Interfaces:**
- `pageView.js`: 스펙 2.2 네 함수. `frameWorldBox`는 네 모서리를 `dwgToWorld([x,y])`(null 가능)로 바꿔 경계상자를 잡고 여백을 폭·높이의 `marginRatio`만큼 사방에 더한다.
- `viewer.html`: 도구막대에 `<span id="viewModeGroup" role="group" aria-label="보기 방식"><button id="viewAll" type="button" aria-pressed="true">전체</button><button id="viewPage" type="button" aria-pressed="false">페이지</button></span>`; 본문 끝에 `<div id="pageNav" hidden><button id="pagePrev" type="button">◀ 이전</button><span id="pageLabel"></span><button id="pageNext" type="button">다음 ▶</button></div>`.
- `main.js`: 도형 로드 뒤 `frames = drawing.frames ?? []`; `window.mangdoOffline.viewMode`('page'면 페이지로 시작)·`pageIndex`; `fitPage(i)`는 `frameWorldBox(frames[i], mapper.dwgToWorld)` → `new THREE.Box3(new THREE.Vector3(minX,minY,0), new THREE.Vector3(maxX,maxY,0))` → `viewer.navigation.fitBounds(false, box)`; `THREE`는 전역(Autodesk 뷰어가 노출). 전환·이동마다 `postToApp({ type: 'viewPrefs', viewMode, pageIndex })`. frames 없으면 `viewPage` disabled.
- `src/viewerPrefs.ts`: `readViewerPrefs(): { viewMode: 'all'|'page'; pages: Record<string, number> }`, `writeViewerPrefs(p)` — `Paths.document/viewer-prefs.json`, 실패 삼킴.
- `ViewerScreen`: 주입 데이터에 `viewMode`, `pageIndex`(prefs에서) 추가; `viewPrefs` 메시지 → prefs 저장.

- [ ] Step 1 실패 테스트(`pageView`) → Step 2 → Step 3 구현 → Step 4 검증 → Step 5 결과 문서 74~80행(스펙 4장 실기기 항목) → 커밋
