# 3단계: 전차보고서 사진 → [전차 사진] 탭 (+ 페이지 휴지통) — 실행 계획

> 작업자용: `executing-plans` 스킬로 작업 단위로 실행. 단계는 `- [ ]` 체크박스.

**목표:** 웹 과업 상세에서 구조물에 전차보고서(한글 .hwp/.hwpx)를 올리면, 보고서 안 사진(대부분 표 안 그림)과 캡션이 "페이지" 단위로 앱 [전차 사진] 탭에 뜨고, 사진을 누르면 카메라 → 찍음 표시. 사진 없는/필요 없는 페이지는 휴지통으로 보내고(복구 가능) 보면서 찍는다.
**구조:** 앱 서버가 hwpx(zip)를 직접 읽는다(`zipRead.ts` + `hwpxPhotos.ts`, 순수 함수, 외부 의존 없음). 표(`hp:tbl`) 하나 = 페이지 하나로 본다("대부분 표 안에 그림" — 사용자). 표 밖 그림은 그림 하나 = 페이지 하나. 추출 결과는 `previous` shot(그룹 = 페이지)으로 저장하고 참조 이미지는 `data/shots/<projectId>/ref/`. `.hwp`는 웹(daenong)의 기존 한컴 변환(`scripts/hwp_to_hwpx.py`)을 거쳐 hwpx로 앱 서버에 넘긴다. 앱은 2단계 화면·대기열을 그대로 쓰고 참조 이미지는 기기에 내려받아 오프라인에서도 보인다.
**기술:** Node zlib(zip 해제), 정규식 기반 hwpx 섹션 XML 스캔, sharp(썸네일), multer; Next.js 프록시; Expo RN
**설계 문서:** `docs/design/2026-10-24-field-photo-checklist.md` (결정 2, 3 / 화면(앱) [전차 사진] / 화면(웹))

## 전역 제약
- `Shot`에 추가: `group?: string`(페이지 id, previous만), `caption?: string`(보고서 캡션 원문), `ref?: { file: string }`(참조 이미지 파일명, `ref/` 아래), `trashed?: true`(휴지통). `member`는 캡션 첫 어절이 부재 단어 목록(전경·교대·교각·거더·바닥판·슬래브·신축이음·교량받침·난간·방호벽·배수·포장·옹벽·터널·라이닝·측벽·천장·기타)에 있으면 그것, 아니면 `'전차'`. `label`은 캡션(없으면 `사진 N`).
- 페이지 id = `pg_<순번 3자리>`(섹션 순서대로 1부터). 페이지 안 사진 순서 = 문서 순서.
- 다시 올리면 **안 찍은** previous는 전부 교체, **찍은** previous는 남긴다(그룹은 그대로). required는 건드리지 않는다.
- hwpx 파싱은 `Contents/content.hpf`의 `<opf:item id href media-type>`로 `binaryItemIDRef` → 파일을 푼다. 섹션은 `Contents/section*.xml` 이름순. 그림은 `<hc:img binaryItemIDRef="…">`, 표는 `<hp:tbl …>…</hp:tbl>`(중첩은 깊이 세기), 글은 `<hp:t>…</hp:t>`.
- 캡션 짝짓기(표 안): 그림 뒤에 오는 **첫 글(비어 있지 않은 `hp:t` 묶음, 다음 그림 전까지)**. 없으면 그림 앞 글. 둘 다 없으면 `사진 N`. 표 밖 그림: 같은 문단의 글, 없으면 바로 다음 문단.
- 이미지 형식: png/jpg/jpeg/bmp/gif는 그대로 저장(확장자 유지), 그 밖(emf/wmf 등)은 **건너뛰고** 건너뛴 수를 응답에 넣는다.
- 웹 업로드 상한 50MB. 앱 서버 `POST /projects/:id/previous-report`는 `maxUploadBytes`(기존 DXF 상한) 사용.
- `main` 직접 커밋, attribution 두 줄.

## 리뷰 포인트
1. 중첩 표(표 안의 표)에서 그림을 두 번 세지 않는다 (작업 1 테스트).
2. 캡션 없는 그림은 `사진 N`, 캡션에 줄바꿈·탭이 있으면 공백 하나로 (작업 1 테스트).
3. 다시 올렸을 때 찍은 전차 사진이 남고 번호가 겹치지 않는다 (작업 2 테스트).
4. 페이지를 휴지통에 넣어도 찍은 사진·파일은 지워지지 않고, 복구하면 그대로 보인다 (작업 2 테스트, 작업 4).
5. 오프라인에서 [전차 사진] 탭을 열면 내려받아 둔 참조 이미지로 보인다 (작업 4, 실기기).

---

### 작업 1: zip 읽기 + hwpx 사진 추출 (순수)

**파일:**
- 생성: `server/src/zipRead.ts`, `server/src/hwpxPhotos.ts`
- 테스트: `server/test/hwpxPhotos.test.ts` (테스트 안에서 작은 hwpx를 zip으로 만든다 — `archiver` 대신 Node `zlib.deflateRawSync`로 직접 조립하는 `makeZip(entries)` 헬퍼)

**인터페이스 (생산):**
- `export function readZipEntries(buf: Buffer): Map<string, Buffer>` — 중앙 디렉터리로 읽는다(store·deflate).
- `export interface PhotoBlock { page: string; texts: string[]; images: { ref: string; ext: string; data: Buffer; caption: string | null }[] }`
- `export function extractPhotoBlocks(hwpx: Buffer): { blocks: PhotoBlock[]; skipped: number }` — 그림이 있는 표/문단만. `ext`는 `.png|.jpg|.gif|.bmp`.
- `export function memberOfCaption(caption: string | null): string` — 전역 제약의 부재 단어 규칙.

- [ ] **1단계: 실패하는 테스트**
```ts
it('표 안 그림 2장과 뒤따르는 캡션을 페이지 하나로', () => { /* section0: tbl[ tc(img1) tc("사진 1. 교각 P1 균열") tc(img2) tc("사진 2. 교대 A1 백태") ] → blocks[0].page 'pg_001', images[0].caption '사진 1. 교각 P1 균열', images[1].caption … */ });
it('중첩 표의 그림은 한 번만', () => { /* 바깥 tbl 안에 tbl → 그림 1장 → images.length 1, blocks.length 1 */ });
it('캡션 없는 그림은 null, 줄바꿈 캡션은 공백 하나', () => {});
it('표 밖 그림은 같은 문단 글이 캡션', () => {});
it('emf는 건너뛰고 skipped에 센다', () => {});
it('memberOfCaption: "교각 P1 균열" → 교각, "사진 3" → 전차', () => {});
```
- [ ] **2단계: 실패 확인** — `cd server && npx vitest run test/hwpxPhotos.test.ts` / FAIL (module not found)
- [ ] **3단계: 구현** — 섹션 XML을 문자열로 받아 태그 토큰 스캔(`/<(\/?)(hp:tbl|hp:p|hc:img|hp:t)\b([^>]*)>/g`): 깊이 0에서 `hp:tbl` 열림~닫힘 구간이 페이지, 구간 안의 `hc:img`·`hp:t`를 순서대로 모아 캡션 규칙 적용. `hp:t` 안 글은 `>…<` 사이를 엔티티 해제(`&lt; &gt; &amp; &quot; &apos;`)하고 `\s+`→공백. 표 밖 `hc:img`는 그 `hp:p` 구간의 글을 캡션으로.
- [ ] **4단계: 통과 확인** — 같은 명령 / PASS
- [ ] **5단계: 커밋** — `feat(server): hwpx에서 사진·캡션 추출 (표 = 페이지)`

### 작업 2: previous shot 저장·라우트·휴지통

**파일:**
- 수정: `server/src/shotsStore.ts` (Shot 필드, `importPrevious`, `setGroupTrashed`, ref 파일 경로), `server/src/app.ts` (라우트 4개 + GET shots 응답 확장 + photos.zip은 previous도 `<구조물>/<파일명>`으로)
- 테스트: `server/test/shotsStore.test.ts`, `server/test/app.test.ts`

**인터페이스 (생산):**
- `ShotsStore.importPrevious(projectId, blocks: PhotoBlock[], savedAt): Promise<{ shots: Shot[]; added: number }>` — 안 찍은 previous 제거 → 블록 순서대로 새 previous 추가(`group=block.page`, `caption`, `label=caption ?? '사진 N'`, `member=memberOfCaption`, `number`는 남은 항목 최대 다음부터), ref 파일 `ref/<shotId><ext>` 저장 + 썸네일 `ref/<shotId>.thumb.jpg`(sharp 실패 시 없음).
- `ShotsStore.setGroupTrashed(projectId, group, trashed): Promise<number>` — 바뀐 수.
- `ShotsStore.refPathOf / refThumbPathOf(projectId, shot)`.
- `POST /api/projects/:id/previous-report` (multipart `file`, .hwpx만; .hwp는 400 `'hwpx로 바꿔서 올려 주세요(웹 과업 상세는 자동 변환)'`) → 201 `{ pages: number; photos: number; skipped: number }`.
- `GET /api/projects/:id/shots/:shotId/ref`, `…/ref/thumb`.
- `PATCH /api/projects/:id/shots/groups/:group` `{ trashed: boolean }` → `{ changed }`.
- `GET /api/projects/:id/shots` 항목에 `group`, `caption`, `trashed`, `refUrl`, `refThumbUrl` 추가.

- [ ] **1단계: 실패하는 테스트** — store: importPrevious(찍은 것 유지·번호 이어짐·ref 파일 생김), setGroupTrashed(찍은 사진 파일 그대로). app: POST previous-report(테스트 hwpx) → 201 `{pages:1, photos:2}` → GET shots에 previous 2개 `group 'pg_001'`, `refThumbUrl`; PATCH groups → trashed; .hwp → 400.
- [ ] **2단계: 실패 확인** — `npx vitest run test/shotsStore.test.ts test/app.test.ts -t "previous|전차"` / FAIL
- [ ] **3단계: 구현**
- [ ] **4단계: 통과 확인** — 전체 `npx vitest run` / PASS
- [ ] **5단계: 커밋** — `feat(server): 전차보고서 업로드 → previous shot, 참조 이미지, 페이지 휴지통`

### 작업 3: 웹 — 업로드 프록시 + 과업 상세 버튼

**파일:**
- 생성: `app/api/mangdo/projects/[id]/previous-report/route.ts` (POST: `.hwp`면 `scripts/hwp_to_hwpx.py`로 변환 후, `mangdoPostFile` 로 앱 서버에 전달), `app/api/mangdo/projects/[id]/children/route.ts` (GET: 하위 구조물 목록 = `listAppProjects().filter(parentId===id)`)
- 수정: `app/api/lib/mangdo.ts` (`mangdoPostFile(path, filename, buffer, contentType)` — 쓰기 키, multipart), `app/work/detail/[id]/AppDrawings.tsx` (구조물 목록 + 「전차보고서 올리기」 파일 입력 + 결과 문구 "N페이지 · 사진 M장")
- 테스트: `app/api/lib/mangdo.test.ts`에 `isMangdoWriteConfigured`·`mangdoPostFile` 헤더 테스트 1개

- [ ] **1단계: 테스트** — `mangdoPostFile`이 `x-access-key`에 쓰기 키를 붙이고 multipart로 POST 한다(fetch stub).
- [ ] **2단계: 실패 확인** — `npx vitest run app/api/lib/mangdo.test.ts -t mangdoPostFile` / FAIL
- [ ] **3단계: 구현** — 구조물이 없으면 "앱에서 구조물을 먼저 추가하세요(+ 구조물 추가)". 업로드 중 버튼 비활성, 50MB 넘으면 400.
- [ ] **4단계: 검증** — vitest PASS + `npx tsc --noEmit` 0
- [ ] **5단계: 커밋** — `feat(web): 과업 상세에서 구조물별 전차보고서(hwp/hwpx) 올리기`

### 작업 4: 앱 — [전차 사진] 탭 + 페이지 휴지통

**파일:**
- 생성: `src/screens/PreviousShotsView.tsx`
- 수정: `src/api.ts` (`Shot` 필드 추가, `setGroupTrashed(projectId, group, trashed)`, `shotRefThumbSource`), `src/shotsLocal.ts` (`refs: Record<shotId, localUri>`), `src/components/ShotCard.tsx` (`refThumb?` — 찍기 전엔 참조 이미지가 썸네일, 찍은 뒤엔 찍은 사진 + 작은 참조), `src/screens/DrawingListScreen.tsx` (탭 3개, previous가 하나라도 있으면 기본 탭 = 전차 사진)
- 검증: `npx tsc --noEmit`, 체크리스트 11장

**동작:**
- 섹션 = 페이지(`group`), 제목 `페이지 1`(+ 캡션 첫 줄). 섹션 머리에 「휴지통으로」. 상단 `N/M 찍음 · 휴지통 K` + 「휴지통 보기」 토글 → 휴지통 페이지들만 보이고 「복구」.
- 참조 이미지: 탭을 열 때(온라인) `refThumbUrl`을 기기(`shots/ref/<shotId>.jpg`)로 내려받아 `refs`에 적는다. 이미 있으면 안 받는다. 카드는 로컬 파일 우선.
- 촬영·대기열·✓·reconcile은 2단계와 같은 코드(`shoot` 로직을 `useShotCapture` 훅으로 빼서 둘이 공유).
- 전차 사진이 없으면 "웹 과업 상세에서 전차보고서를 올리면 여기 뜹니다".

- [ ] **1~4단계: 구현** (훅 분리 → 화면 → 탭)
- [ ] **5단계: 검증** — `npx tsc --noEmit` 0. 체크리스트 11장.
- [ ] **6단계: 커밋** — `feat(app): [전차 사진] 탭 — 페이지별 참조 사진·촬영·휴지통/복구`

### 작업 5: 문서 — 허브 §9·§11, 체크리스트 11장, CLAUDE.md. 커밋 `docs: 3단계 상태 반영`.
