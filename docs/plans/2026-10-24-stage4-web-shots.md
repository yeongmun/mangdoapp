# 4단계: 웹 과업 상세에서 찍은 사진 보기·부재명 고치기·연결 상태 표시 — 실행 계획

> 작업자용: `executing-plans` 스킬로 작업 단위로 실행. 단계는 `- [ ]` 체크박스.

**목표:** 사무실(웹 과업 상세)에서 구조물별로 현장에서 찍은 필수·전차 사진을 보고 내려받고, 전차 사진의 부재명(파일명 가운데 토막)을 고칠 수 있다. 과업의 점검 종류·구조물의 시설물 종류가 보이고, 과업 저장 때 앱 연결 실패가 화면에 보인다.
**구조:** 앱 서버에 `PATCH /api/projects/:id/shots/:shotId { member?, label? }` 하나 추가. 웹은 기존 읽기 프록시 방식(`proxyFile`)으로 shots 목록·사진·썸네일을 중계하고, 부재명 수정만 쓰기 키 프록시. 과업 상세 `AppDrawings`의 구조물 표 아래 접었다 펴는 사진 블록.
**기술:** Express 5 + vitest / Next.js(서버 라우트, 클라이언트 컴포넌트) + vitest
**설계 문서:** `docs/design/2026-10-24-field-photo-checklist.md` (화면(웹))

## 전역 제약
- 부재명 수정은 `previous`·`required` 모두 허용(`member` 1~40자, `label` 1~120자, 앞뒤 공백 제거, 빈 값 400). 바뀐 부재명은 zip 파일명에 바로 반영(파일명은 내려받을 때 계산).
- 웹 중계: 읽기(목록·사진·썸네일·참조 썸네일)는 `MANGDO_ACCESS_KEY`, 수정은 `MANGDO_WRITE_KEY`.
- `GET /api/mangdo/projects/[id]/children` 응답을 `{ inspectionType, children: [{ id, name, facilityType }] }`로 바꾼다(오늘 만든 라우트라 호출처는 AppDrawings뿐).
- 과업 등록: POST 응답에 `appLinkError`가 있으면 등록은 성공으로 두고 `window.alert`로 알린다. `appProjectId`가 생겼으면 토스트 한 줄.
- `main` 직접 커밋, attribution 두 줄.

## 리뷰 포인트
1. 부재명에 `/`·`\` 같은 글자를 넣어도 400이 아니라 저장되고 파일명에서만 `_`로 바뀐다(기존 `safe`) (작업 1 테스트).
2. 사진이 하나도 없는 구조물은 "아직 찍은 사진이 없어요"만 (작업 3).
3. 휴지통 페이지의 찍은 사진은 웹에서도 "휴지통" 표시와 함께 보인다(숨기지 않는다 — zip에도 들어간다) (작업 3).
4. 썸네일 주소에 `?v=savedAt`를 붙여 다시 찍은 사진이 바로 바뀐다 (작업 3).
5. 쓰기 키가 없으면 부재명 칸이 읽기 전용이고 문구로 알린다 (작업 3).

---

### 작업 1: 앱 서버 — shot 수정 라우트
- 수정: `server/src/shotsStore.ts` (`update(projectId, shotId, patch: { member?: unknown; label?: unknown }): Promise<Shot | null>`, `ShotRuleError`), `server/src/app.ts` (`PATCH /projects/:id/shots/:shotId`)
- 테스트: `server/test/shotsStore.test.ts`(update: 정상·빈 값 거부·없는 id null), `server/test/app.test.ts`(PATCH 200/400/404)
- [ ] 1단계 실패 테스트 → 2단계 FAIL 확인 → 3단계 구현 → 4단계 `npx vitest run test/shotsStore.test.ts test/app.test.ts` PASS → 5단계 커밋 `feat(server): PATCH /projects/:id/shots/:shotId (부재명·설명 수정)`

### 작업 2: 웹 — 프록시 라우트
- 생성: `app/api/mangdo/projects/[id]/shots/route.ts`(GET 목록), `app/api/mangdo/projects/[id]/shots/[shotId]/route.ts`(PATCH → `mangdoPatch`), `…/[shotId]/photo/route.ts`, `…/[shotId]/photo/thumb/route.ts`, `…/[shotId]/ref/thumb/route.ts`(모두 `proxyFile`)
- 수정: `app/api/lib/mangdo.ts` (`mangdoPatch(path, body)`), `app/api/mangdo/projects/[id]/children/route.ts` (응답에 `inspectionType`)
- 테스트: `mangdo.test.ts`에 `mangdoPatch` 헤더·메서드 1개
- [ ] 테스트 → FAIL → 구현 → `npx vitest run app/api/lib/mangdo.test.ts && npx tsc --noEmit` → 커밋 `feat(web): 앱 촬영 항목 중계(목록·사진·썸네일·부재명 수정)`

### 작업 3: 웹 — 과업 상세 화면
- 생성: `app/work/detail/[id]/StructureShots.tsx` — 구조물 하나의 사진 블록. 상단 "필수 N/M · 전차 N/M(휴지통 K)". 찍은 사진만 썸네일 격자(96px, 클릭 → 새 탭에 원본). 전차 항목은 참조 썸네일 작게 + 부재명 `<input>`(blur/Enter 저장, 저장 중 흐림) + 캡션. 휴지통 항목은 회색 "휴지통" 배지. 쓰기 키 없으면(PATCH 503) 입력 비활성 + 문구.
- 수정: `AppDrawings.tsx` — 헤더에 "점검 종류: X"(없으면 "앱에서 미선택"), 구조물 행에 시설물 종류, 행 끝 「사진 보기 ▾」 토글로 `StructureShots` 펼침.
- 수정: `app/work-status/hooks/useWorkInput.ts`(`onSuccess(created)`), `app/work-status/input/page.tsx`(appLinkError alert / 연결 토스트)
- [ ] 구현 → `npx tsc --noEmit` 0, `npx vitest run` PASS → 커밋 `feat(web): 과업 상세에 구조물별 찍은 사진·부재명 수정·점검/시설물 종류·연결 결과`

### 작업 4: 문서 — 허브 §9·§11, 체크리스트 12장, CLAUDE.md. 커밋 `docs: 4단계 상태 반영`.
