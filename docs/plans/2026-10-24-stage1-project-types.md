# 1단계: 프로젝트 점검 종류·시설물 종류 + 웹 과업 → 앱 자동 생성 — 실행 계획

> 작업자용: `executing-plans` 스킬로 작업 단위로 실행. 단계는 `- [ ]` 체크박스.

**목표:** 웹에서 정기·정밀 과업을 저장하면 앱 프로젝트가 자동으로 생기고, 앱에서 그 프로젝트의 점검 종류(상위)와 시설물 종류(하위)를 고를 수 있다.
**구조:** 앱 서버 `ProjectRecord`에 선택 필드 2개를 더하고 POST/PATCH가 받게 한다. 앱 목록 화면 상단에 선택 칩을 둔다. 웹은 과업 POST 때 앱 서버에 프로젝트를 만들고 `appProjectId`를 붙인다(쓰기 키 환경변수 하나 추가).
**기술:** Express 5 + vitest(앱 서버), Expo RN(앱), Next.js + vitest(웹)
**설계 문서:** `docs/design/2026-10-24-field-photo-checklist.md` (결정 1, 5 / 화면(앱) 1행 / 화면(웹) 1행)

## 전역 제약
- 점검 종류 값: `'정기안전점검' | '정밀안전점검' | '정밀안전진단'`. 시설물 종류 값: `'교량' | '터널' | '옹벽' | '절토사면' | '건축물' | '기타'`. (설계: 사용자가 나중에 목록을 줄 때 `requiredShots.json`의 키와 맞춘다 — 지금은 이 6개.)
- 둘 다 선택 필드. 기존 프로젝트 레코드(필드 없음)는 그대로 읽힌다.
- 점검 종류는 **최상위**(parentId null)에만, 시설물 종류는 **하위**에만 둔다. 반대 자리에 넣으면 400.
- 웹 과업구분 값은 바꾸지 않는다(`정밀안전점검 | 정기안전점검 | 건기법 | 기타과업`). 앱 프로젝트 자동 생성은 `APP_LINKED_TASK_TYPES`(정기·정밀)만.
- 웹 쓰기 키 환경변수 이름: `MANGDO_WRITE_KEY`(앱 서버 `APP_ACCESS_KEY` 값). 없으면 자동 생성은 조용히 건너뛰고 과업 저장은 성공한다.
- `main` 직접 커밋. 커밋 메시지 끝에 세션 attribution 두 줄.

## 리뷰 포인트
1. 같은 현장명 과업을 두 번 저장 → 앱 `duplicate`(409) → 기존 최상위 프로젝트를 찾아 연결한다(작업 4 테스트).
2. 앱 서버가 꺼져 있을 때 과업 저장 → 과업은 저장되고 `appProjectId` 없음, 응답에 `appLinkError` 문구(작업 4 테스트).
3. PATCH로 `inspectionType: null`을 보내면 필드를 지운다(작업 1 테스트).
4. 허용값 밖 문자열(`'정밀점검'`) → 400 `ProjectRuleError('type')`(작업 1·2 테스트).
5. 앱 오프라인에서 칩을 누르면 서버 오류 → 이전 값 유지 + 오류 배너(작업 3, 실기기 확인 항목으로 체크리스트에 기록).

---

### 작업 1: ProjectsStore에 inspectionType · facilityType

**파일:**
- 수정: `server/src/projectsStore.ts` (ProjectRecord, ProjectRuleCode, create, update)
- 테스트: `server/test/projectsStore.test.ts`

**인터페이스:**
- 생산: `ProjectRecord.inspectionType?: InspectionType`, `ProjectRecord.facilityType?: FacilityType`; `export const INSPECTION_TYPES = ['정기안전점검','정밀안전점검','정밀안전진단'] as const`, `export const FACILITY_TYPES = ['교량','터널','옹벽','절토사면','건축물','기타'] as const`; `ProjectRuleCode`에 `'type'` 추가; `create(input: { name; memo?; parentId?; inspectionType?; facilityType? })`, `update(id, patch: { name?; memo?; inspectionType?; facilityType? })` — patch 값 `null`이면 필드 삭제.

- [ ] **1단계: 실패하는 테스트 작성** (`describe('점검 종류·시설물 종류')`)
```ts
it('최상위에 점검 종류를 저장한다', async () => {
  const p = await store.create({ name: '오봉대교', inspectionType: '정밀안전점검' }, T);
  expect(p.inspectionType).toBe('정밀안전점검');
  expect('facilityType' in p).toBe(false);
});
it('하위에 시설물 종류를 저장한다', async () => {
  const top = await store.create({ name: '오봉대교' }, T);
  const child = await store.create({ name: 'A교', parentId: top.id, facilityType: '교량' }, T);
  expect(child.facilityType).toBe('교량');
});
it('최상위에 시설물 종류, 하위에 점검 종류는 거부(type)', async () => {
  await expect(store.create({ name: 'X', facilityType: '교량' }, T)).rejects.toMatchObject({ code: 'type' });
  const top = await store.create({ name: 'Y' }, T);
  await expect(store.create({ name: 'Z', parentId: top.id, inspectionType: '정기안전점검' }, T)).rejects.toMatchObject({ code: 'type' });
});
it('허용값 밖이면 거부(type)', async () => {
  await expect(store.create({ name: 'X', inspectionType: '정밀점검' }, T)).rejects.toMatchObject({ code: 'type' });
});
it('update로 바꾸고 null이면 지운다', async () => {
  const p = await store.create({ name: '오봉대교', inspectionType: '정기안전점검' }, T);
  expect((await store.update(p.id, { inspectionType: '정밀안전진단' }))?.inspectionType).toBe('정밀안전진단');
  const cleared = await store.update(p.id, { inspectionType: null });
  expect(cleared && 'inspectionType' in cleared).toBe(false);
});
```
- [ ] **2단계: 실패 확인** — Run: `cd server && npx vitest run test/projectsStore.test.ts -t "점검 종류"` / Expected: FAIL (`inspectionType` undefined / `code` 불일치)
- [ ] **3단계: 구현** — `validateInspectionType(value, parentId)` / `validateFacilityType(value, parentId)`: `undefined`면 undefined, 허용값 밖이거나 자리가 틀리면 `ProjectRuleError('type', '점검 종류는 상위 프로젝트에, 시설물 종류는 구조물에만 둘 수 있습니다.')`(허용값 밖은 `'점검 종류 값이 올바르지 않습니다.'` / `'시설물 종류 값이 올바르지 않습니다.'`). `create`는 값이 있을 때만 키를 넣는다. `update`는 `'inspectionType' in patch`일 때 `null`이면 `delete next.inspectionType`, 아니면 검증 후 대입(자리는 `current.parentId` 기준).
- [ ] **4단계: 통과 확인** — Run: 같은 명령 / Expected: PASS, 기존 projectsStore 테스트 전부 PASS
- [ ] **5단계: 커밋** — `git add server/src/projectsStore.ts server/test/projectsStore.test.ts` / `git commit -m "feat(server): 프로젝트에 점검 종류·시설물 종류 필드"`

### 작업 2: API가 두 필드를 받고 돌려준다

**파일:**
- 수정: `server/src/app.ts:594-637` (POST/PATCH /projects), `projectRuleStatus`에 `type` → 400
- 테스트: `server/test/app.test.ts` (기존 `describe` 중 프로젝트 라우트 근처에 추가)

**인터페이스:**
- 소비: 작업 1의 `create`/`update` 시그니처
- 생산: `POST /api/projects { name, memo?, parentId?, inspectionType?, facilityType? }` → 201 ProjectView(필드 포함); `PATCH /api/projects/:id { inspectionType?: string|null, facilityType?: string|null }` → 200 ProjectView; 위반 400 `{ error }`

- [ ] **1단계: 실패하는 테스트 작성**
```ts
it('POST /projects가 점검 종류를 받고 GET 목록에 실린다', async () => {
  const { app } = setup();
  const res = await request(app).post('/api/projects').set(KEY).send({ name: '오봉대교', inspectionType: '정밀안전점검' });
  expect(res.status).toBe(201);
  expect(res.body.inspectionType).toBe('정밀안전점검');
  const list = await request(app).get('/api/projects').set(KEY);
  expect(list.body[0].inspectionType).toBe('정밀안전점검');
});
it('PATCH /projects/:id로 시설물 종류를 넣고 null로 지운다', async () => { /* 하위 만들고 PATCH '교량' → 200, PATCH null → 응답에 키 없음 */ });
it('허용값 밖이면 400', async () => { /* POST inspectionType '정밀점검' → 400, body.error 포함 */ });
```
(`KEY`·`setup`은 파일의 기존 헬퍼 이름을 그대로 쓴다.)
- [ ] **2단계: 실패 확인** — Run: `cd server && npx vitest run test/app.test.ts -t "점검 종류|시설물 종류|허용값"` / Expected: FAIL
- [ ] **3단계: 구현** — POST는 `body.inspectionType`, `body.facilityType`을 `create`에 그대로 넘김. PATCH는 `'inspectionType' in body`/`'facilityType' in body`일 때만 patch에 넣음(기존 name/memo 방식 그대로). `projectRuleStatus`: `type` → 400.
- [ ] **4단계: 통과 확인** — Run: `cd server && npx vitest run test/app.test.ts test/projectTree.test.ts` / Expected: PASS
- [ ] **5단계: 커밋** — `git commit -m "feat(server): POST/PATCH /projects에 점검 종류·시설물 종류"`

### 작업 3: 앱 목록 화면에 선택 칩

**파일:**
- 수정: `src/api.ts:58-68` (Project 타입), `src/api.ts` (`updateProject` 추가), `src/screens/DrawingListScreen.tsx:416-425` (제목 아래 칩 줄)
- 생성: `src/components/TypeChips.tsx`
- 검증: `npx tsc --noEmit` (앱 화면은 자동 테스트 없음 — 실기기 확인은 체크리스트)

**인터페이스:**
- 소비: 작업 2의 PATCH 응답(ProjectView)
- 생산: `Project.inspectionType?: string`, `Project.facilityType?: string`; `updateProject(id: string, patch: { inspectionType?: string|null; facilityType?: string|null }): Promise<Project>`; `<TypeChips label="점검 종류" options={INSPECTION_TYPES} value={...} onChange={(v)=>...} disabled />`

- [ ] **1단계: `src/api.ts`** — `Project`에 두 선택 필드, `INSPECTION_TYPES`·`FACILITY_TYPES` 상수(서버와 같은 문자열), `updateProject` (PATCH, `x-access-key`, 실패 시 `'프로젝트를 저장하지 못했습니다 (status).'`).
- [ ] **2단계: `src/components/TypeChips.tsx`** — 가로 스크롤 칩 줄. 선택된 칩은 채움색, 나머지 테두리. `disabled`면 흐리게. 스타일은 `ui-ux-pro-max` 스킬의 React Native 가이드로 잡는다(StyleSheet.create, 44pt 이상 터치 영역). 이 컴포넌트가 이후 사진 화면의 첫 디자인 기준이 된다.
- [ ] **3단계: `DrawingListScreen.tsx`** — `currentProject`가 있고 `depth === 0`이면 제목 아래 `TypeChips(점검 종류)`, `depth === 1`이면 `TypeChips(시설물 종류)`. `onChange` → `updateProject` → 성공하면 `setProjects`에서 해당 항목 교체, 실패하면 `setError(message)`(이전 값 유지). 저장 중엔 `disabled`.
- [ ] **4단계: 검증** — Run: `npx tsc --noEmit` / Expected: 오류 0. `claude/확인-체크리스트.md`에 "9-1 프로젝트 칩" 항목 추가(최상위 점검 종류 / 하위 시설물 종류 / 오프라인에서 누르면 오류 배너·값 유지 / PC 페이지 목록에 값 보임).
- [ ] **5단계: 커밋** — `git commit -m "feat(app): 프로젝트 화면에 점검 종류·시설물 종류 선택 칩"`

### 작업 4: 웹 과업 저장 → 앱 프로젝트 자동 생성·연결

**파일:**
- 수정: `app/api/lib/mangdo.ts` (`mangdoPost`, `ensureAppProject`), `app/api/work-status/route.ts:21-62` (POST)
- 테스트: `app/api/lib/mangdo.test.ts`
- 수정: `.env.example`(있으면) `MANGDO_WRITE_KEY=` 한 줄

**인터페이스:**
- 소비: 앱 서버 `POST /api/projects`(작업 2), `GET /api/projects`(기존 `listAppProjects`)
- 생산: `isMangdoWriteConfigured(): boolean`; `ensureAppProject(name: string, deps?: { post: (body: {name: string}) => Promise<{ status: number; body: { id?: string; error?: string } }>; list: () => Promise<MangdoProjectView[]> }): Promise<string>` — 201이면 그 id, 409(duplicate)면 `list()`에서 같은 이름의 최상위 id, 그 밖은 throw. POST `/api/work-status` 응답에 `appProjectId`(성공) 또는 `appLinkError: string`(실패 문구) 추가.

- [ ] **1단계: 실패하는 테스트 작성**
```ts
describe("ensureAppProject", () => {
  it("201이면 새 id", async () => {
    const id = await ensureAppProject("오봉대교", { post: async () => ({ status: 201, body: { id: "p_new" } }), list: async () => [] });
    expect(id).toBe("p_new");
  });
  it("409면 같은 이름의 최상위를 찾아 준다", async () => {
    const id = await ensureAppProject("호계4교 정밀안전진단", { post: async () => ({ status: 409, body: { error: "중복" } }), list: async () => views });
    expect(id).toBe("p_1");
  });
  it("그 밖의 오류는 throw", async () => {
    await expect(ensureAppProject("X", { post: async () => ({ status: 500, body: { error: "서버" } }), list: async () => [] })).rejects.toThrow("서버");
  });
});
```
- [ ] **2단계: 실패 확인** — Run: `npx vitest run app/api/lib/mangdo.test.ts -t ensureAppProject` / Expected: FAIL (`ensureAppProject is not a function`)
- [ ] **3단계: 구현** — `mangdoPost(path, body)`: `MANGDO_WRITE_KEY` 헤더로 POST, `{status, body}` 반환(throw 안 함). `ensureAppProject` 기본 deps는 `mangdoPost('/projects', …)`와 `listAppProjects`. `route.ts` POST: 항목 push 전에 `if (APP_LINKED_TASK_TYPES.includes(newItem.과업구분) && isMangdoWriteConfigured())` → `try { newItem.appProjectId = await ensureAppProject(newItem.현장명.trim() || newItem.과업내용) } catch (e) { appLinkError = message }`. 응답 JSON은 `{...newItem, appLinkError?}`.
- [ ] **4단계: 통과 확인** — Run: `npx vitest run app/api/lib/mangdo.test.ts && npx tsc --noEmit` / Expected: PASS, 오류 0
- [ ] **5단계: 커밋** — `git commit -m "feat(web): 정기·정밀 과업 저장 시 앱 프로젝트 자동 생성·연결"`

### 작업 5: 문서

**파일:** 프로젝트 문서 `claude/프로젝트-허브-설계.md` §8(결정 변경: 자동 생성 함, 2026-10-24) · §9(진행 행) · `claude/확인-체크리스트.md` 9장, `mangdoapp/CLAUDE.md` 현재 상태에 "프로젝트 점검 종류·시설물 종류" 한 줄.

- [ ] **1단계: 문서 갱신** — 위 항목. 사내 PC 설정에 `daenong/.env.local`의 `MANGDO_WRITE_KEY=<APP_ACCESS_KEY 값>` 추가 안내.
- [ ] **2단계: 커밋** — `git commit -m "docs: 1단계 상태 반영"` (mangdoapp)
