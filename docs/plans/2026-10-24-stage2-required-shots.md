# 2단계: [필수 사진] 탭 — 실행 계획

> 작업자용: `executing-plans` 스킬로 작업 단위로 실행. 단계는 `- [ ]` 체크박스.

**목표:** 구조물(하위 프로젝트)에 시설물 종류를 고르면 그 종류의 필수 사진 목록이 카드로 뜨고, 카드를 누르면 카메라 → 찍으면 초록 테두리·✓, 사진은 기존 대기열로 서버에 올라가 `시설물이름_부재_번호.jpg`로 쌓인다. 오프라인에서도 찍고 표시되며 나중에 올라간다.
**구조:** 서버에 "촬영 항목(shot)" 저장소 하나(`data/shots/<projectId>.json` + 사진 파일). 필수 목록 원본은 `server/config/requiredShots.json`(시설물 종류 → 항목). 앱은 기존 촬영 함수(`takePhotoAndSave`)와 업로드 대기열(`photoQueue`/`photoUpload`)에 "대상이 손상이 아니라 shot"인 경우를 더한다. 화면은 도면 목록 화면의 구조물 단계에 탭 [도면]·[필수 사진]을 두고, [필수 사진]은 별도 컴포넌트.
**기술:** Express 5 + multer + sharp(기존) + vitest / Expo RN(expo-image-picker, expo-file-system 기존)
**설계 문서:** `docs/design/2026-10-24-field-photo-checklist.md` (결정 3, 4 / 화면(앱) / 서버(앱))

## 전역 제약
- shot 모양: `{ id: string; kind: 'required' | 'previous'; member: string; label: string; number: string; photo?: { file: string; savedAt: string } }`. `number`는 구조물 안에서 001부터 3자리, 만들 때 매긴다. 2단계는 `required`만 만든다(`previous`는 3단계).
- 사진 파일명 규칙: `<구조물이름>_<부재>_<번호>.jpg` (zip·내려받기 때). 디스크는 `data/shots/<projectId>/<number>.jpg` + `<number>.thumb.jpg`(기존 `photoThumb.ts`).
- 필수 목록 샘플(교량 10항목, 사용자가 나중에 교체): 전경/상류측, 전경/하류측, 교대/A1 전면, 교대/A2 전면, 교각/P1, 거더/하면 전경, 바닥판/하면 전경, 신축이음/전경, 교량받침/대표, 난간·방호벽/전경. 다른 시설물 종류는 빈 배열(화면에 "이 시설물 종류의 목록이 아직 없습니다").
- 시설물 종류를 바꾸면 **안 찍은** required 항목은 새 목록으로 갈아끼우고, 찍은 항목은 남긴다.
- 앱은 서버 응답을 문서 폴더 `shots/<projectId>.json`에 저장해 오프라인에서도 보여 준다. 찍은 즉시 로컬 표시(`localUri`)는 같은 파일에 적는다.
- `main` 직접 커밋, attribution 두 줄.

## 리뷰 포인트
1. 시설물 종류 없는 구조물에서 [필수 사진] → "시설물 종류를 먼저 고르세요" (작업 4).
2. 같은 shot을 두 번 찍으면 두 번째가 덮어쓴다(서버 파일·앱 표시 모두) (작업 1·2 테스트, 작업 4).
3. 오프라인에서 찍기 → 카드는 바로 ✓, 대기열 배지 +1, 온라인 되면 올라감 (작업 3·4, 실기기).
4. 사진번호에 쓸 수 없는 글자(`/`)가 부재명에 있어도 파일명은 안전해야 한다 → 파일명 만들 때 `[\\/:*?"<>|]`를 `_`로 (작업 1 테스트).
5. 프로젝트 `photos.zip`에 shot 사진이 `<구조물이름>/<파일명>`으로 함께 들어간다 (작업 2 테스트).

---

### 작업 1: shotsStore + requiredShots.json

**파일:**
- 생성: `server/config/requiredShots.json`, `server/src/shotsStore.ts`
- 테스트: `server/test/shotsStore.test.ts`

**인터페이스 (생산):**
- `export interface Shot { id; kind; member; label; number; photo? }` (위 모양)
- `export function shotFileName(projectName: string, shot: Shot): string` — `${safe(projectName)}_${safe(member)}_${number}.jpg`, `safe`는 `[\\/:*?"<>|]` → `_`, 앞뒤 공백 제거.
- `export function mergeRequired(existing: Shot[], template: { member: string; label: string }[]): Shot[]` — 순수. 찍은(`photo` 있는) 항목은 전부 유지, 안 찍은 required는 template 순서대로 다시 만든다(같은 member+label이 이미 있으면 그 id·number 유지). 번호는 유지된 것 다음부터 3자리.
- `export class ShotsStore { constructor(rootDir) ; list(projectId): Promise<Shot[]>; replace(projectId, shots): Promise<void>; savePhoto(projectId, shotId, ext, data: Buffer): Promise<Shot|null>; saveThumb/readThumb(projectId, shot) ; pathOf(projectId, shot): string }` — `data/shots/<projectId>.json`, 사진 `data/shots/<projectId>/<number><ext>`.
- `export function loadRequiredTemplate(configPath): Record<string, {member; label}[]>`

- [ ] **1단계: 실패하는 테스트**
```ts
it('shotFileName은 구조물_부재_번호.jpg, 위험 글자는 _', () => {
  expect(shotFileName('A교', { ...base, member: '교대/A1', number: '003' })).toBe('A교_교대_A1_003.jpg');
});
it('mergeRequired: 안 찍은 항목은 새 목록으로, 찍은 항목은 남고 번호 이어짐', () => {
  const taken = { id: 's1', kind: 'required', member: '전경', label: '상류측', number: '001', photo: { file: '001.jpg', savedAt: T } };
  const out = mergeRequired([taken, { id: 's2', kind: 'required', member: '교대', label: 'A1', number: '002' }], [{ member: '전경', label: '상류측' }, { member: '교각', label: 'P1' }]);
  expect(out.map((s) => [s.member, s.number])).toEqual([['전경', '001'], ['교각', '002']]);
  expect(out[0].id).toBe('s1');
});
it('ShotsStore.savePhoto는 파일을 쓰고 photo를 채우며 두 번째는 덮어쓴다', async () => { /* list → replace([shot]) → savePhoto 2회 → photo.file === '001.jpg', 파일 내용은 두 번째 */ });
```
- [ ] **2단계: 실패 확인** — `cd server && npx vitest run test/shotsStore.test.ts` / Expected: FAIL (module not found)
- [ ] **3단계: 구현** — id는 `s_<uuid 없는 32hex>`. JSON 쓰기는 `writeJsonFileAtomic`. `config/requiredShots.json`은 `{ "교량": [...10], "터널": [], "옹벽": [], "절토사면": [], "건축물": [], "기타": [] }`.
- [ ] **4단계: 통과 확인** — 같은 명령 / Expected: PASS
- [ ] **5단계: 커밋** — `feat(server): 촬영 항목(shot) 저장소 + 필수 사진 목록 설정`

### 작업 2: 라우트 + photos.zip

**파일:**
- 수정: `server/src/app.ts` (deps에 `shots: ShotsStore`, `requiredTemplate`), `server/src/index.ts`(생성), `server/test/app.test.ts`의 `setup()`
- 테스트: `server/test/app.test.ts`

**인터페이스 (생산):**
- `GET /api/projects/:id/shots` → `{ projectId, projectName, facilityType: string|null, shots: Shot[] }`. 하위 프로젝트에 `facilityType`이 있으면 `mergeRequired(list, template[facilityType])` 결과를 저장하고 돌려준다. 없으면 저장된 것만.
- `POST /api/projects/:id/shots/:shotId/photo` (multipart `file`, 기존 `photoUploadField`·`PHOTO_EXTENSIONS`) → 201 `{ shot, url, thumbUrl }`. 없는 shot 404.
- `GET /api/projects/:id/shots/:shotId/photo`, `…/photo/thumb` → 파일(썸네일 없으면 만들어서, 못 만들면 본 사진).
- `GET /api/projects/:id/photos.zip`: 기존 손상 사진에 더해 하위 프로젝트마다 shot 사진을 `<구조물이름>/<shotFileName>`으로 추가.

- [ ] **1단계: 실패하는 테스트**
```ts
describe('촬영 항목 API', () => {
  it('시설물 종류를 고르면 GET /projects/:id/shots에 필수 목록이 생긴다', ...);  // 교량 → shots.length 10, kind required, number '001'..'010'
  it('POST …/shots/:shotId/photo 두 번 → photo 하나, 두 번째 내용', ...);
  it('photos.zip에 구조물이름/구조물_부재_번호.jpg 가 들어간다', ...);   // 기존 readZipEntry 헬퍼 재사용
});
```
- [ ] **2단계: 실패 확인** — `npx vitest run test/app.test.ts -t "촬영 항목"` / FAIL
- [ ] **3단계: 구현** — multer·확장자·썸네일 흐름은 손상 사진 라우트(923행~)를 그대로 따라간다. 템플릿은 `index.ts`에서 `loadRequiredTemplate(join(__dirname, '..', 'config', 'requiredShots.json'))`.
- [ ] **4단계: 통과 확인** — `npx vitest run test/app.test.ts test/shotsStore.test.ts` / PASS
- [ ] **5단계: 커밋** — `feat(server): 촬영 항목 API (목록·사진 올리기·zip 포함)`

### 작업 3: 앱 — 대기열에 shot 대상 + API

**파일:**
- 수정: `src/photoQueue.ts` (`PhotoQueueItem.target?: { kind: 'shot'; projectId: string; shotId: string }`), `src/photoUpload.ts` (`enqueuePhoto`에 `target?`, `uploadOne`의 url 분기, `UploadNotice`는 그대로), `src/api.ts` (`Shot`, `ShotList`, `fetchShots(projectId)`, `shotPhotoUrl`)
- 생성: `src/shotsLocal.ts` (문서 폴더 `shots/<projectId>.json` 읽기·쓰기: `{ fetchedAt, facilityType, shots, local: Record<shotId, { uri; takenAt }> }`)
- 테스트: `server/test/photoQueue.test.ts`에 target 보존 테스트 1개

- [ ] **1단계: 실패하는 테스트** — `parseQueue`가 `target`을 보존하고, 없으면 키가 없다.
- [ ] **2단계: 실패 확인** — `npx vitest run test/photoQueue.test.ts -t target` / FAIL
- [ ] **3단계: 구현** — `uploadOne`: `item.target?.kind === 'shot'` 이면 `/api/projects/${projectId}/shots/${shotId}/photo`, 아니면 기존. 성공 응답에서 `number`가 없으면 `shot.number`를 쓴다. `shotsLocal.ts`는 실패를 삼킨다(photoUpload 방식).
- [ ] **4단계: 검증** — vitest PASS + `npx tsc --noEmit` 0
- [ ] **5단계: 커밋** — `feat(app): 사진 대기열에 촬영 항목 대상 추가, shots API`

### 작업 4: 앱 — [필수 사진] 화면 + 탭 + 구조물 추가

**파일:**
- 생성: `src/components/ShotCard.tsx`, `src/screens/RequiredShotsView.tsx`
- 수정: `src/screens/DrawingListScreen.tsx` (depth 1에 탭 [도면]·[필수 사진]; depth 0에 「+ 구조물 추가」 한 줄 입력), `src/api.ts` (`createProject(name, parentId)`)
- 검증: `npx tsc --noEmit`, 체크리스트 10장

**동작:**
- 탭은 `theme` 토큰의 segmented(두 칸). 선택 기억은 안 한다(열 때마다 [도면]).
- `RequiredShotsView({ project })`: 마운트 시 `shotsLocal` 읽어 먼저 그리고, 온라인이면 `fetchShots` → 저장 → 다시 그림. `facilityType` 없으면 안내 한 줄만. 상단 `N/M 찍음`. 부재별 묶음(섹션 제목 = member) 아래 `ShotCard`(label, 번호, 찍었으면 초록 테두리+✓+썸네일(로컬 uri 우선, 없으면 서버 thumbUrl)).
- 카드 탭 → `takePhotoAndSave()` → ok면 `enqueuePhoto({ drawingId: '', damageId: '', filename: shotFileName, uploadUri, target: { kind: 'shot', projectId, shotId } })` → `shotsLocal`에 `{ uri: uploadUri, takenAt }` → 카드 ✓ → `flushPhotoQueue()`. 실패면 `Alert`.
- 「+ 구조물 추가」: depth 0 화면 목록 위에 `TextInput` + 버튼 → `createProject` → 목록 갱신. 이름 비면 비활성.

- [ ] **1단계: `api.ts`** — `createProject`, `fetchShots`, `shotThumbUrl(projectId, shotId)`.
- [ ] **2단계: `ShotCard.tsx`** — 44pt 이상, 테두리 `colors.border` / 찍음 `colors.success`, ✓는 Text. 썸네일 `Image` 72×72.
- [ ] **3단계: `RequiredShotsView.tsx`** — 위 동작. `SectionList`.
- [ ] **4단계: `DrawingListScreen.tsx`** — 탭·구조물 추가. 기존 FlatList는 [도면] 탭일 때만.
- [ ] **5단계: 검증** — `npx tsc --noEmit` 0. 체크리스트 10장 작성.
- [ ] **6단계: 커밋** — `feat(app): [필수 사진] 탭 — 카드·촬영·찍음 표시, 구조물 추가`

### 작업 5: 문서
- [ ] 허브 §9 진행 행, §11 상태(2단계 완료), 체크리스트 10장, `CLAUDE.md` 한 줄(shots). 커밋 `docs: 2단계 상태 반영`.
