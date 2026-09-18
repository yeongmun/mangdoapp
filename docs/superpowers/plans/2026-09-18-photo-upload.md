# 사진 파일 서버 보관 구현 계획 — 찍은 사진을 손상에 붙인다 (앨범 + 서버)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 📷로 찍은 사진이 앨범에 남는 동시에 **서버에도 올라가** 그 손상에 붙고, 앱 속성창에서 썸네일로 보이며, PC 업로드 페이지에서 `손상번호_손상현황_사진번호.jpg` 이름의 **zip**으로 내려받힌다.

**Architecture:** 연결은 **폴더 구조가 곧 데이터다** — `server/data/photos/<drawingId>/<damageId>/<사진번호><확장자>`. 손상 기록(schemaVersion 5)은 한 글자도 바뀌지 않는다. 서버는 파일 I/O만 하는 `PhotosStore`와, 이름을 짓는 **순수 함수**(`photoZip.ts`의 `zipEntryNamesFor`)로 나뉜다. 번호·손상현황은 화면·산출과 똑같이 `server/public/viewer/quantities.js`의 `computeNumbers`·`statusTextOf`를 부른다 — 사용자가 산출 DXF의 번호와 zip 파일 이름을 나란히 놓고 보기 때문이다. 앱은 찍은 뒤 **먼저 뷰어에 답하고**(사용자를 기다리게 하지 않는다) 뒤에서 올리며, 실패하면 앱 문서 폴더의 대기열에 넣어 다시 시도한다. 대기열의 **판단 규칙만** 순수 모듈(`src/photoQueue.ts`)로 떼어 vitest가 검사한다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict, `checkJs: false`), Express 5, multer(메모리 저장), vitest, 빌드 없는 ES 모듈 브라우저 JS(`server/public/viewer/*.js`), Expo 앱(React Native, `expo-file-system`·`expo-media-library`). **새 의존성은 `archiver`(+`@types/archiver`) 하나뿐이고 `server/`에만 넣는다.**

**Spec:** `docs/superpowers/specs/2026-09-18-photo-upload-design.md`
그대로 유효해 이 계획이 따르는 앞선 설계:
- `docs/superpowers/specs/2026-09-17-photo-capture-design.md` — 📷 버튼, 앱↔뷰어 메시지, `photoNumberFromFilename` 번호 규칙. 이 계획은 그 메시지에 `drawingId`·`damageId`를 **더할 뿐** 촬영·앨범 저장·번호 규칙을 바꾸지 않는다.
- `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` 9장 — `attrs.photoNumbers`(문자열 배열, 저장 형식 불변).
- `docs/superpowers/specs/2026-09-16-frame-numbering-design.md` 5장 — 틀마다 1번부터. zip의 `<번호>`가 이 번호다.

---

## Global Constraints

스펙과 사용자 지시에서 그대로 옮긴 구속값이다. 판단이 갈리면 여기를 기준으로 한다. **모든 Task의 요구사항에 이 절이 암묵적으로 포함된다.**

### 작업 안전 규칙 (모든 Task에 적용)

- **`git checkout` / `git restore` / `git stash`를 절대 실행하지 않는다.** 앞선 작업에서 이 명령이 작성 중이던 문서를 통째로 날린 적이 있다. 되돌리고 싶으면 파일을 직접 고쳐라.
- `git add .` / `git add -A` / `git commit -a`를 쓰지 않는다. **파일 이름을 하나씩 적어** `git add <경로> <경로>` 로만 스테이징한다.
- `server/data/`, `.env`, `docs/*.dxf`, `docs/*.bak`는 커밋 대상이 아니다(`.gitignore`). **사진 파일(`server/data/photos/`)도 마찬가지로 커밋되지 않는다** — `server/data/` 전체가 이미 무시된다.
- 모든 커밋 메시지의 마지막 줄은 정확히 다음과 같다(글자 하나도 다르면 안 된다):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- 커밋 제목과 본문, 화면 문구는 한국어로 쓴다. 코드와 식별자는 코드의 언어(영어)로 쓴다.
- 작업 브랜치는 `feat/photo-upload`다(이미 체크아웃돼 있다).
- `docs/DXF산출-테스트-결과.md`는 **Task 7이 지시하는 자리(표 맨 끝에 행 추가)** 말고는 건드리지 않는다. 기존 행의 글자를 고치지 않는다.

### 코드 규약 (기존 코드에서 그대로 이어받는다)

- TypeScript는 NodeNext다 — **상대 경로 import에 `.js` 확장자를 붙인다**(`./photosStore.js`). 빼먹으면 `npm --prefix server run typecheck`가 바로 잡아낸다.
- 뷰어 JS(`server/public/viewer/*.js`)는 브라우저가 그대로 읽는 순수 ES 모듈이고, 서버 TS는 이를 `../../public/viewer/*.js`로 가져다 쓴다. `checkJs`는 꺼져 있지만 **TS가 소비하는 JS 내보내기에는 JSDoc `@type`/`@typedef`를 단다**. 타입 없이 두면 호출부에서 조용히 `any`가 된다.
- 앱 코드(`src/**`)는 루트 `npx tsc --noEmit`으로만 검증한다(테스트 러너가 없다). **RN에 의존하지 않는 순수 규칙은 반드시 떼어내 vitest로 검사한다.**
- 뷰어 DOM 코드(`main.js`)는 `node --check` + 읽기로 확인한다. 브라우저 DOM이 필요한 코드에 단위 테스트를 붙이지 않는다.
- 숫자·문구를 여러 곳에 베껴 쓰지 않는다. 상한·MIME 목록은 상수 하나로 두고 화면 문구가 그 상수를 쓴다.

### 저장과 연결 (스펙 2장)

- 폴더: `server/data/photos/<drawingId>/<damageId>/<사진번호><확장자>`.
- **손상 기록(schemaVersion 5)을 바꾸지 않는다.** 연결은 폴더 구조 + `attrs.photoNumbers`다. 이 계획의 어떤 Task도 `damageDoc.js`의 검증·형식을 손대지 않는다.
- 사진번호는 `photoNumberFromFilename`(`quantities.js`)이 **파일명에서** 뽑는다 — 뷰어와 서버가 같은 함수를 쓴다.
- 같은 손상·같은 번호로 다시 올리면 덮어쓴다(확장자가 달라도 하나만 남긴다).
- 크기 상한 **20MB**(`MAX_PHOTO_BYTES = 20 * 1024 * 1024`). MIME 허용 목록은 `image/jpeg`·`image/png`·`image/heic` 셋뿐이고 내용은 바꾸지 않는다(HEIC도 그대로).

### 경로 안전 (스펙 3장)

- `:damageId`는 **UUID 형식만** 받는다(`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`). 뷰어가 `crypto.randomUUID()`로 만드는 id가 이 형식이다.
- `:number`는 **영문·숫자·`-`·`_`만**, 1~64자(`/^[A-Za-z0-9_-]{1,64}$/`).
- 두 검증 모두 **경로 조작 방지**가 목적이다. `..`·`/`·`\`가 섞인 값에 400을 주는 테스트를 Task 1(스토어)과 Task 2(라우트) 양쪽에 둔다.
- 도면 id는 기존 `isDrawingId`를 그대로 쓴다.

### 검증 명령

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit (서버 + server/test가 가져오는 src/photoQueue.ts)
npx tsc --noEmit                  # 앱(src/**, App.tsx)
node --check server/public/viewer/main.js
node --check server/public/viewer/photoStrip.js
node --check server/public/viewer/quantities.js
node --check server/public/upload.js
```

---

## File Structure

```
server/src/photosStore.ts              생성: 사진 파일 저장·목록·읽기. id/번호 검증과 경로 계산이 여기 한 곳에만 있다
server/src/photoZip.ts                 생성: zip 항목 이름을 짓는 순수 함수(zipEntryNamesFor). 파일 I/O 없음
server/src/app.ts                      수정: AppDeps.photos·maxPhotoBytes, 사진 업로드/목록/파일/zip 라우트 4개
server/src/index.ts                    수정: PhotosStore를 data/photos로 엮는다
server/public/viewer/quantities.js     수정: comparePhotoNumbers 추가(서버 목록·zip과 뷰어 썸네일이 같은 순서)
server/public/viewer/photoStrip.js     생성: 썸네일 줄의 순수 규칙(photoStripItems, blocksDrawing)
server/public/viewer.html              수정: #photoStrip(속성창 안), #photoView(전체 화면 오버레이)
server/public/viewer/main.js           수정: 썸네일 읽기·그리기, 오버레이, takePhoto에 drawingId·damageId,
                                             mangdoPhotoUploaded/mangdoPhotoUploadFailed 처리
server/public/viewer/viewer.css        수정: 썸네일·칩·오버레이 모양
server/public/upload.html              수정: 표에 '사진' 열 추가
server/public/upload.js                수정: 사진 zip 버튼
server/vitest.config.ts                (필요할 때만) 루트 밖 파일 import 허용

src/photoQueue.ts                      생성: 대기열 판단 규칙(순수). vitest가 server/test에서 상대 경로로 가져간다
src/photoUpload.ts                     생성: 대기열 저장·전송·재시도(RN 의존을 여기 모은다)
src/photo.ts                           수정: 문서 폴더에 보관용 사본을 만들고 그 uri를 함께 돌려준다
src/screens/ViewerScreen.tsx           수정: takePhoto 회신 분리, 전송, 60초 재시도, 뷰어 알림 주입
src/screens/DrawingListScreen.tsx      수정: '보내지 못한 사진 N장' 배지

server/test/photosStore.test.ts        생성: 저장·목록·읽기·덮어쓰기·id 검증
server/test/photoZip.test.ts           생성: zip 항목 이름(틀별 번호·X·미연결·삭제된손상·이름 정리·중복)
server/test/photoQueue.test.ts         생성: nextRetry·applyResult·10회 상한·400 폐기
server/test/photoStrip.test.ts         생성: photoStripItems·blocksDrawing
server/test/app.test.ts                수정: 사진 API 4개(멀티파트·404·400·413·덮어쓰기·헤더·zip)
server/test/quantities.test.ts         수정: comparePhotoNumbers

README.md                              수정: 사용 절차의 📷 설명, 사진 zip, 문제 해결 표
docs/DXF산출-테스트-결과.md             수정: 확인표 맨 끝에 행 추가(행 추가 외 금지)
docs/superpowers/specs/2026-09-17-photo-capture-design.md  수정: 맨 위에 "사진 서버 보관은 2026-09-18 설계가 잇는다" 한 줄
```

---

## Task 1: 사진 스토어와 번호 정렬

**Files:**
- Create: `server/src/photosStore.ts`
- Modify: `server/public/viewer/quantities.js` (맨 끝, `photoTextOf` 아래에 추가)
- Test: `server/test/photosStore.test.ts` (생성), `server/test/quantities.test.ts` (추가)

**Interfaces:**
- Consumes: `isDrawingId`(`server/src/drawingsStore.ts`), `writeFileAtomic`(`server/src/jsonFile.ts`)
- Produces:
  - `comparePhotoNumbers(a: string, b: string): number` — `server/public/viewer/quantities.js`
  - `class PhotosStore { constructor(dir: string); save(drawingId, damageId, number, extension, data: Buffer): Promise<void>; list(drawingId, damageId): Promise<PhotoEntry[]>; find(drawingId, damageId, number): Promise<PhotoEntry | null>; listDrawing(drawingId): Promise<PhotoEntry[]>; pathOf(drawingId, entry: PhotoEntry): string; readData(drawingId, entry: PhotoEntry): Promise<Buffer> }`
  - `interface PhotoEntry { damageId: string; number: string; file: string; size: number; savedAt: string }`
  - `isDamageId(value: unknown): boolean`, `isPhotoNumber(value: unknown): boolean`
  - `PHOTO_EXTENSIONS: Record<string, string>` (MIME→확장자), `PHOTO_MIME_TYPES: Record<string, string>` (확장자→MIME)

- [ ] **Step 1: `comparePhotoNumbers`의 실패하는 테스트를 쓴다**

`server/test/quantities.test.ts` 맨 끝에 붙인다. 파일 맨 위 import 줄에 `comparePhotoNumbers`를 더한다.

```ts
describe('comparePhotoNumbers', () => {
  it('숫자 번호는 값 순서로 놓는다 (글자 순서가 아니다)', () => {
    expect(['101530', '9', '88'].sort(comparePhotoNumbers)).toEqual(['9', '88', '101530']);
  });

  it('값이 같으면 글자 순서로 가른다 (앞자리 0이 앞)', () => {
    expect(['21', '0021'].sort(comparePhotoNumbers)).toEqual(['0021', '21']);
  });

  it('숫자가 아닌 번호는 숫자 뒤에, 자기들끼리는 글자 순서로', () => {
    expect(['P-013', '101530', 'DSC_0001'].sort(comparePhotoNumbers)).toEqual(['101530', 'DSC_0001', 'P-013']);
  });

  it('같은 값은 0', () => {
    expect(comparePhotoNumbers('12', '12')).toBe(0);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- quantities`
Expected: FAIL — `comparePhotoNumbers is not a function`

- [ ] **Step 3: `comparePhotoNumbers`를 넣는다**

`server/public/viewer/quantities.js` 맨 끝에 붙인다.

```js
// 사진번호 정렬 규칙. 서버 목록·zip과 뷰어 썸네일이 같은 순서를 내야 하므로 한 곳에 둔다
// (2026-09-18 사진 보관 설계 3·5장). 숫자만으로 된 번호끼리는 값으로 비교한다 — 글자 코드로
// 비교하면 '101530'이 '9'보다 앞이라 사람이 보는 순서와 어긋난다. 값이 같으면('0021'과 '21')
// 글자 순서로 가르고, 숫자가 아닌 번호('P-013')는 숫자 뒤에 놓는다.
/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function comparePhotoNumbers(a, b) {
  const left = String(a);
  const right = String(b);
  const leftIsDigits = /^\d+$/.test(left);
  const rightIsDigits = /^\d+$/.test(right);
  if (leftIsDigits !== rightIsDigits) return leftIsDigits ? -1 : 1;
  if (leftIsDigits && rightIsDigits) {
    const diff = Number(left) - Number(right);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left < right) return -1;
  return left > right ? 1 : 0;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm --prefix server test -- quantities`
Expected: PASS (기존 테스트도 그대로 통과)

- [ ] **Step 5: 스토어의 실패하는 테스트를 쓴다**

`server/test/photosStore.test.ts` 생성.

```ts
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDamageId, isPhotoNumber, PhotosStore } from '../src/photosStore.js';

const DRAWING = 'd_00000000000000000000000000000001';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

let dir: string;
let photos: PhotosStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-photos-'));
  photos = new PhotosStore(join(dir, 'photos'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('id·번호 검증', () => {
  it('UUID만 손상 id다', () => {
    expect(isDamageId(D1)).toBe(true);
    expect(isDamageId('c1')).toBe(false);
    expect(isDamageId('../../etc')).toBe(false);
    expect(isDamageId(`${D1}/x`)).toBe(false);
    expect(isDamageId(null)).toBe(false);
  });

  it('사진번호는 영문·숫자·-·_ 만', () => {
    expect(isPhotoNumber('101530')).toBe(true);
    expect(isPhotoNumber('DSC_0001')).toBe(true);
    expect(isPhotoNumber('P-013')).toBe(true);
    expect(isPhotoNumber('..')).toBe(false);
    expect(isPhotoNumber('a/b')).toBe(false);
    expect(isPhotoNumber('a\\b')).toBe(false);
    expect(isPhotoNumber('')).toBe(false);
    expect(isPhotoNumber('가나다')).toBe(false);
  });
});

describe('PhotosStore', () => {
  it('저장하면 폴더가 생기고 목록에 나온다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    expect(await readdir(join(dir, 'photos', DRAWING, D1))).toEqual(['101530.jpg']);
    const list = await photos.list(DRAWING, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ damageId: D1, number: '101530', file: '101530.jpg', size: 3 });
    expect(Number.isFinite(Date.parse(list[0].savedAt))).toBe(true);
  });

  it('없는 폴더의 목록은 빈 배열이다', async () => {
    expect(await photos.list(DRAWING, D1)).toEqual([]);
    expect(await photos.listDrawing(DRAWING)).toEqual([]);
  });

  it('같은 번호를 다시 올리면 확장자가 달라도 하나만 남는다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    await photos.save(DRAWING, D1, '101530', '.png', Buffer.from('defg'));
    expect(await readdir(join(dir, 'photos', DRAWING, D1))).toEqual(['101530.png']);
    const list = await photos.list(DRAWING, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: '101530', file: '101530.png', size: 4 });
  });

  it('목록은 사진번호 오름차순이다 (값 순서)', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '9', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '88', '.jpg', Buffer.from('a'));
    expect((await photos.list(DRAWING, D1)).map((e) => e.number)).toEqual(['9', '88', '101530']);
  });

  it('우리 규칙에 맞지 않는 파일은 목록에서 뺀다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('a'));
    await writeFile(join(dir, 'photos', DRAWING, D1, 'note.txt'), 'x', 'utf8');
    await writeFile(join(dir, 'photos', DRAWING, D1, '가나다.jpg'), 'x', 'utf8');
    expect((await photos.list(DRAWING, D1)).map((e) => e.number)).toEqual(['101530']);
  });

  it('listDrawing은 손상 폴더를 이름순으로 모으고 UUID가 아닌 폴더는 뺀다', async () => {
    await photos.save(DRAWING, D2, '1', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '2', '.jpg', Buffer.from('a'));
    await mkdir(join(dir, 'photos', DRAWING, 'tmp'), { recursive: true });
    await writeFile(join(dir, 'photos', DRAWING, 'tmp', '3.jpg'), 'x', 'utf8');
    expect((await photos.listDrawing(DRAWING)).map((e) => [e.damageId, e.number])).toEqual([
      [D1, '2'],
      [D2, '1'],
    ]);
  });

  it('readData는 저장한 내용을 그대로 돌려준다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    const entry = await photos.find(DRAWING, D1, '101530');
    expect(entry).not.toBeNull();
    expect((await photos.readData(DRAWING, entry!)).toString()).toBe('abc');
  });

  it('없는 번호는 null', async () => {
    expect(await photos.find(DRAWING, D1, '999')).toBeNull();
  });

  it('pathOf는 폴더 아래 경로를 만들고, 이름이 이상하면 던진다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    const entry = (await photos.find(DRAWING, D1, '101530'))!;
    expect(photos.pathOf(DRAWING, entry)).toBe(join(dir, 'photos', DRAWING, D1, '101530.jpg'));
    expect(() => photos.pathOf(DRAWING, { ...entry, file: '../x.jpg' })).toThrow('잘못된 사진 파일 이름');
  });

  it('잘못된 id·번호·확장자는 던진다 (경로 조작 방지)', async () => {
    await expect(photos.save(DRAWING, 'c1', '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 손상 id');
    await expect(photos.save(DRAWING, '..', '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 손상 id');
    await expect(photos.save('nope', D1, '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 도면 id');
    await expect(photos.save(DRAWING, D1, '../x', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 사진번호');
    await expect(photos.save(DRAWING, D1, '1', '.exe', Buffer.from('a'))).rejects.toThrow('잘못된 확장자');
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npm --prefix server test -- photosStore`
Expected: FAIL — `Cannot find module '../src/photosStore.js'`

- [ ] **Step 7: `server/src/photosStore.ts`를 만든다**

```ts
// 손상 사진 파일을 서버에 보관한다. 연결은 폴더 구조가 곧 데이터다 —
// data/photos/<drawingId>/<damageId>/<사진번호><확장자>. 손상 기록(schemaVersion 5)은
// 바꾸지 않는다. 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 2장

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { comparePhotoNumbers } from '../public/viewer/quantities.js';
import { isDrawingId } from './drawingsStore.js';
import { writeFileAtomic } from './jsonFile.js';

// 뷰어가 crypto.randomUUID()로 만드는 손상 id 형식(main.js 305·319행). 판 번호는 따지지
// 않는다 — 이 검사의 목적은 '..'·'/'·'\' 같은 경로 조각을 막는 것이다(스펙 3장).
const DAMAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// 받는 MIME과 디스크에 쓰는 확장자. 스펙 2장의 세 가지뿐이고 내용은 바꾸지 않는다.
// 스펙 2장이 파일을 `<사진번호>.jpg`로 적은 것은 JPEG일 때의 예시로 읽는다 — 파일 응답의
// Content-Type을 '저장 시 값'으로 돌려주려면(3장) 확장자가 남아 있어야 한다.
export const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
};

export const PHOTO_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
};

export interface PhotoEntry {
  damageId: string;
  number: string;
  /** 폴더 안의 파일 이름(확장자 포함). 경로를 만들 때만 쓴다. */
  file: string;
  size: number;
  /** 파일 mtime(ISO). 따로 기록을 두지 않는다 — 파일이 곧 데이터다. */
  savedAt: string;
}

export function isDamageId(value: unknown): boolean {
  return typeof value === 'string' && DAMAGE_ID_PATTERN.test(value);
}

export function isPhotoNumber(value: unknown): boolean {
  return typeof value === 'string' && PHOTO_NUMBER_PATTERN.test(value);
}

// 파일 이름을 번호와 확장자로 가른다. 규칙에 맞지 않는 이름은 null이다 — 손으로 넣은 파일이나
// writeFileAtomic이 남긴 `.tmp` 찌꺼기가 목록·zip에 섞이지 않는다.
function parsePhotoFile(file: string): { number: string; extension: string } | null {
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  const number = file.slice(0, dot);
  const extension = file.slice(dot).toLowerCase();
  if (!isPhotoNumber(number) || PHOTO_MIME_TYPES[extension] === undefined) return null;
  return { number, extension };
}

export class PhotosStore {
  constructor(private readonly dir: string) {}

  // 같은 번호의 옛 파일은 확장자가 달라도 지우고 새로 쓴다(스펙 2장 "다시 올리면 덮어쓴다").
  // 남겨 두면 같은 번호가 목록에 둘 보인다.
  async save(drawingId: string, damageId: string, number: string, extension: string, data: Buffer): Promise<void> {
    const folder = this.folderFor(drawingId, damageId);
    if (!isPhotoNumber(number)) throw new Error(`잘못된 사진번호: ${number}`);
    if (PHOTO_MIME_TYPES[extension] === undefined) throw new Error(`잘못된 확장자: ${extension}`);
    for (const old of await this.readFolder(folder)) {
      if (old.number === number && old.extension !== extension) {
        await rm(join(folder, `${old.number}${old.extension}`), { force: true });
      }
    }
    await writeFileAtomic(join(folder, `${number}${extension}`), data);
  }

  async list(drawingId: string, damageId: string): Promise<PhotoEntry[]> {
    const folder = this.folderFor(drawingId, damageId);
    const entries: PhotoEntry[] = [];
    for (const parsed of await this.readFolder(folder)) {
      const file = `${parsed.number}${parsed.extension}`;
      const info = await stat(join(folder, file));
      entries.push({
        damageId,
        number: parsed.number,
        file,
        size: info.size,
        savedAt: info.mtime.toISOString(),
      });
    }
    return entries.sort((a, b) => comparePhotoNumbers(a.number, b.number));
  }

  async find(drawingId: string, damageId: string, number: string): Promise<PhotoEntry | null> {
    if (!isPhotoNumber(number)) throw new Error(`잘못된 사진번호: ${number}`);
    return (await this.list(drawingId, damageId)).find((entry) => entry.number === number) ?? null;
  }

  // 도면 폴더 아래 모든 손상 폴더의 사진. 손상 기록에 없는 폴더(지운 손상)도 그대로 담는다 —
  // zip이 `삭제된손상_…`으로 넣어 사진을 버리지 않기 위해서다(스펙 3장).
  async listDrawing(drawingId: string): Promise<PhotoEntry[]> {
    const folder = this.drawingFolderFor(drawingId);
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const result: PhotoEntry[] = [];
    for (const name of names.filter(isDamageId).sort()) {
      result.push(...(await this.list(drawingId, name)));
    }
    return result;
  }

  // 디스크 경로를 만드는 유일한 출구. entry는 list·find가 돌려준 것만 넣지만 그래도 이름을
  // 다시 검사한다(호출부를 믿지 않는 편이 싸다). zip(Task 3)이 이 경로를 스트림으로 읽는다.
  pathOf(drawingId: string, entry: PhotoEntry): string {
    if (parsePhotoFile(entry.file) === null) throw new Error(`잘못된 사진 파일 이름: ${entry.file}`);
    return join(this.folderFor(drawingId, entry.damageId), entry.file);
  }

  async readData(drawingId: string, entry: PhotoEntry): Promise<Buffer> {
    return readFile(this.pathOf(drawingId, entry));
  }

  private folderFor(drawingId: string, damageId: string): string {
    if (!isDamageId(damageId)) throw new Error(`잘못된 손상 id: ${damageId}`);
    return join(this.drawingFolderFor(drawingId), damageId);
  }

  private drawingFolderFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, drawingId);
  }

  private async readFolder(folder: string): Promise<{ number: string; extension: string }[]> {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const parsed: { number: string; extension: string }[] = [];
    for (const name of names) {
      const entry = parsePhotoFile(name);
      if (entry) parsed.push(entry);
    }
    return parsed;
  }
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm --prefix server test -- photosStore` → PASS
Run: `npm --prefix server run typecheck` → 오류 없음

- [ ] **Step 9: 커밋**

```bash
git add server/src/photosStore.ts server/test/photosStore.test.ts server/public/viewer/quantities.js server/test/quantities.test.ts
git commit -m "$(cat <<'MSG'
사진 파일을 손상 폴더에 보관하는 스토어를 더한다

data/photos/<도면>/<손상>/<사진번호><확장자>에 쓰고 읽는다. 손상 id는 UUID, 사진번호는
영문·숫자·-·_ 만 받아 경로 조작을 막는다. 같은 번호를 다시 올리면 확장자가 달라도 하나만
남긴다. 목록 순서는 뷰어와 공용인 comparePhotoNumbers가 정한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

(커밋 메시지 heredoc 이름은 `MSG`든 `EOF`든 상관없다 — 마지막 줄의 `Co-Authored-By:`가 글자 그대로 들어가기만 하면 된다.)

**Deliverable:** 사진 파일을 안전하게 쓰고 읽는 스토어. 아직 아무도 부르지 않는다.

---

## Task 2: 사진 업로드·목록·파일 API

**Files:**
- Modify: `server/src/app.ts` (import 줄, `AppDeps`, `createApp` 안의 라우트 — `PUT /drawings/:id/damages` 아래, `GET /drawings/:id/export.dxf` 위에 넣는다)
- Modify: `server/src/index.ts:30-37` (`createApp` 인자에 `photos` 추가)
- Test: `server/test/app.test.ts` (`setup` 헬퍼 수정 + `describe` 두 개 추가)

**Interfaces:**
- Consumes: Task 1의 `PhotosStore`·`PhotoEntry`·`isDamageId`·`isPhotoNumber`·`PHOTO_EXTENSIONS`·`PHOTO_MIME_TYPES`, 기존 `photoNumberFromFilename`(`quantities.js`), 기존 `findDrawing`·`requireAccessKey`·`apiErrorHandler`
- Produces:
  - `AppDeps.photos: PhotosStore`, `AppDeps.maxPhotoBytes?: number`, `MAX_PHOTO_BYTES = 20 * 1024 * 1024`
  - `POST /api/drawings/:id/damages/:damageId/photos` → `201 { number, url }`
  - `GET  /api/drawings/:id/damages/:damageId/photos` → `200 [{ number, url, size, savedAt }]`
  - `GET  /api/drawings/:id/damages/:damageId/photos/:number` → 파일 바이트
  - 테스트 헬퍼 `setup(apsOverrides?, maxUploadBytes?, maxPhotoBytes?)`가 `photos`를 함께 돌려준다

- [ ] **Step 1: 실패하는 라우트 테스트를 쓴다**

`server/test/app.test.ts`를 세 곳 고친다.

(1) import에 스토어를 더한다:

```ts
import { PhotosStore } from '../src/photosStore.js';
```

(2) `setup`을 고친다(기존 함수 전체를 아래로 바꾼다):

```ts
function setup(apsOverrides: Record<string, unknown> = {}, maxUploadBytes?: number, maxPhotoBytes?: number) {
  const aps = fakeAps(apsOverrides);
  const drawings = new DrawingsStore(join(dir, 'data', 'drawings.json'));
  const damages = new DamagesStore(join(dir, 'data', 'damages'));
  const originals = new OriginalsStore(join(dir, 'data', 'drawings'));
  const photos = new PhotosStore(join(dir, 'data', 'photos'));
  const app = createApp({
    accessKey: KEY,
    aps,
    drawings,
    damages,
    originals,
    photos,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
    maxPhotoBytes,
  });
  return { app, aps, drawings, damages, originals, photos };
}
```

(3) 손상 id 상수를 **파일 위쪽 상수 자리**(`const KEY`·`const NOW` 옆)에 둔다. Task 3의 `photoDoc`도 이 상수를 쓴다.

```ts
// 뷰어가 crypto.randomUUID()로 만드는 손상 id 형식. 사진 API는 UUID만 받는다.
const D1 = '11111111-1111-4111-8111-111111111111';
```

그리고 파일 맨 끝에 테스트를 붙인다:

```ts
describe('POST /api/drawings/:id/damages/:damageId/photos', () => {
  it('사진을 올리면 201과 번호·주소를 준다 (안드로이드 이름)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', '20260918_101530.jpg')
      .attach('file', Buffer.from('jpeg-bytes'), { filename: '20260918_101530.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      number: '101530',
      url: `/api/drawings/${drawing.id}/damages/${D1}/photos/101530`,
    });
    expect((await photos.list(drawing.id, D1)).map((e) => e.file)).toEqual(['101530.jpg']);
  });

  it('아이폰 HEIC 이름에서도 번호를 뽑고 확장자를 지킨다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', 'IMG_0021.HEIC')
      .attach('file', Buffer.from('heic'), { filename: 'IMG_0021.HEIC', contentType: 'image/heic' });

    expect(res.status).toBe(201);
    expect(res.body.number).toBe('0021');
    expect((await photos.list(drawing.id, D1)).map((e) => e.file)).toEqual(['0021.heic']);
  });

  it('filename 필드가 없으면 multipart 파일명을 쓴다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('jpeg'), { filename: 'IMG_0007.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.number).toBe('0007');
  });

  it('같은 번호를 다시 올리면 덮어쓴다 (확장자가 달라도 하나)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    const post = () =>
      request(app).post(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);

    await post().attach('file', Buffer.from('one'), { filename: 'IMG_0001.jpg', contentType: 'image/jpeg' });
    const res = await post().attach('file', Buffer.from('twotwo'), {
      filename: 'IMG_0001.png',
      contentType: 'image/png',
    });

    expect(res.status).toBe(201);
    const list = await photos.list(drawing.id, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: '0001', file: '0001.png', size: 6 });
  });

  it('없는 도면은 404', async () => {
    const { app } = setup();
    const res = await request(app)
      .post(`/api/drawings/${newDrawingId()}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(404);
  });

  it('UUID가 아닌 손상 id는 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/c1/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('손상 id 형식이 올바르지 않습니다.');
  });

  it('파일이 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', 'IMG_1.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진 파일이 없습니다.');
  });

  it('사진이 아닌 형식은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('hello'), { filename: 'memo.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JPEG·PNG·HEIC 사진만 올릴 수 있습니다.');
  });

  it('번호를 뽑지 못하면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('x'), { filename: '.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진 파일 이름에서 사진번호를 찾을 수 없습니다.');
  });

  it('쓸 수 없는 글자가 든 번호는 400 (경로 조작 방지)', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .field('filename', '사진 1.jpg')
      .attach('file', Buffer.from('x'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('사진번호에 쓸 수 없는 글자가 있습니다');
  });

  it('상한을 넘으면 413', async () => {
    const { app, drawings } = setup({}, undefined, 10);
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .set('x-access-key', KEY)
      .attach('file', Buffer.from('12345678901234567890'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('사진이 20MB를 넘습니다.');
  });

  it('접근키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .post(`/api/drawings/${drawing.id}/damages/${D1}/photos`)
      .attach('file', Buffer.from('x'), { filename: 'IMG_1.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/drawings/:id/damages/:damageId/photos', () => {
  it('번호 오름차순 목록을 준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('abc'));
    await photos.save(drawing.id, D1, '9', '.jpg', Buffer.from('de'));

    const res = await request(app).get(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.map((p: { number: string }) => p.number)).toEqual(['9', '101530']);
    expect(res.body[0]).toMatchObject({
      number: '9',
      url: `/api/drawings/${drawing.id}/damages/${D1}/photos/9`,
      size: 2,
    });
    expect(Number.isFinite(Date.parse(res.body[0].savedAt))).toBe(true);
  });

  it('사진이 없으면 빈 배열', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).get(`/api/drawings/${drawing.id}/damages/${D1}/photos`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('없는 도면은 404, UUID가 아닌 손상 id는 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    expect(
      (await request(app).get(`/api/drawings/${newDrawingId()}/damages/${D1}/photos`).set('x-access-key', KEY)).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/drawings/${drawing.id}/damages/c1/photos`).set('x-access-key', KEY)).status,
    ).toBe(400);
  });
});

describe('GET /api/drawings/:id/damages/:damageId/photos/:number', () => {
  it('저장한 바이트를 저장 시 형식으로 돌려준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('jpeg-bytes'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/101530`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.from(res.body).toString()).toBe('jpeg-bytes');
  });

  it('HEIC는 image/heic로 돌려준다', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '0021', '.heic', Buffer.from('heic'));
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/0021`)
      .set('x-access-key', KEY)
      .responseType('blob');
    expect(res.headers['content-type']).toBe('image/heic');
  });

  it('없는 번호는 404', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/999`)
      .set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('사진을 찾을 수 없습니다.');
  });

  it('쓸 수 없는 글자가 든 번호는 400 (경로 조작 방지)', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/damages/${D1}/photos/%2E%2E`)
      .set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('사진번호 형식이 올바르지 않습니다.');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- app`
Expected: FAIL — `createApp`에 `photos`가 없다는 타입/실행 오류, 사진 라우트는 `없는 API입니다.`(404)

- [ ] **Step 3: `server/src/app.ts`에 의존과 상한을 더한다**

맨 위 import 줄을 고친다(추가하는 줄만 적는다 — 기존 줄은 그대로 둔다):

```ts
import { extname } from 'node:path';
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import { photoNumberFromFilename } from '../public/viewer/quantities.js';
import {
  isDamageId,
  isPhotoNumber,
  PHOTO_EXTENSIONS,
  PHOTO_MIME_TYPES,
  type PhotosStore,
} from './photosStore.js';
```

`MAX_UPLOAD_BYTES` 아래에 상한을 더한다:

```ts
// 사진 한 장의 상한. DXF(100MB)와 따로 둔다 — 3~5MB 사진이 20MB를 넘는 일은 없고,
// 잘못된 파일을 올리다 디스크가 차는 것을 막는다(스펙 2장).
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
```

`AppDeps`에 두 줄을 더한다:

```ts
  photos: PhotosStore;
  maxPhotoBytes?: number;
```

- [ ] **Step 4: 사진 라우트 앞부분을 공용 헬퍼로 뺀다**

`findDrawing` 아래(파일 위쪽 헬퍼 자리)에 넣는다:

```ts
// 사진 주소는 검증된 값 셋(도면 id, UUID, 영문·숫자·-·_)으로만 만들어지므로 그대로 이어 붙인다.
function photoUrl(drawingId: string, damageId: string, number: string): string {
  return `/api/drawings/${drawingId}/damages/${damageId}/photos/${number}`;
}

// 사진 라우트 셋이 모두 쓰는 앞부분: 도면이 있는지, 손상 id가 UUID인지. 막히면 응답을 보내고
// null을 돌려준다 — UUID 검사는 경로 조작 방지가 목적이라 라우트마다 빠뜨리면 안 된다(스펙 3장).
async function findDamageTarget(
  deps: AppDeps,
  req: Request,
  res: Response,
): Promise<{ drawing: DrawingRecord; damageId: string } | null> {
  const drawing = await findDrawing(deps, req.params.id);
  if (!drawing) {
    res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
    return null;
  }
  const damageId = req.params.damageId;
  if (!isDamageId(damageId)) {
    res.status(400).json({ error: '손상 id 형식이 올바르지 않습니다.' });
    return null;
  }
  return { drawing, damageId };
}
```

- [ ] **Step 5: 라우트 셋을 넣는다**

`createApp` 안, `upload`를 만드는 자리 바로 아래에 사진용 multer를 더한다:

```ts
  const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.maxPhotoBytes ?? MAX_PHOTO_BYTES },
  });

  // 공용 apiErrorHandler는 DXF 기준 문구('파일이 100MB를 넘습니다')를 쓰므로 사진의 multer
  // 오류는 여기서 먼저 받아 사진 문구로 답한다. 문구는 늘 실제 상한(20MB)을 말한다 —
  // 테스트가 상한을 낮춰도 사용자에게 보여줄 값은 하나뿐이다.
  const photoUploadField: RequestHandler = (req, res, next) => {
    photoUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: `사진이 ${MAX_PHOTO_BYTES / 1024 / 1024}MB를 넘습니다.` });
        } else {
          res.status(400).json({ error: `업로드 형식 오류: ${err.code}` });
        }
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  };
```

`api.put('/drawings/:id/damages', …)` 아래, `api.get('/drawings/:id/export.dxf', …)` 위에 넣는다:

```ts
  // 찍은 사진을 그 손상 폴더에 저장한다. 사진번호는 **파일 이름에서** 뽑는다(스펙 2장) —
  // 뷰어가 칸에 붙인 번호와 같아야 하므로 뷰어와 같은 photoNumberFromFilename을 쓴다.
  // 앱이 filename 필드를 함께 보내면 그것을 먼저 쓴다: multer의 originalname은 비ASCII에서
  // 깨질 수 있다(DXF 업로드의 name 필드와 같은 이유). 이 필드는 file 파트보다 **앞에** 와야
  // req.body에 담긴다.
  api.post('/drawings/:id/damages/:damageId/photos', photoUploadField, async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: '사진 파일이 없습니다.' });
      return;
    }
    const extension = PHOTO_EXTENSIONS[file.mimetype];
    if (extension === undefined) {
      res.status(400).json({ error: 'JPEG·PNG·HEIC 사진만 올릴 수 있습니다.' });
      return;
    }
    const bodyName = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
    const number = photoNumberFromFilename(bodyName || file.originalname);
    if (number === '') {
      res.status(400).json({ error: '사진 파일 이름에서 사진번호를 찾을 수 없습니다.' });
      return;
    }
    if (!isPhotoNumber(number)) {
      res.status(400).json({ error: `사진번호에 쓸 수 없는 글자가 있습니다: ${number}` });
      return;
    }
    await deps.photos.save(target.drawing.id, target.damageId, number, extension, file.buffer);
    res.status(201).json({ number, url: photoUrl(target.drawing.id, target.damageId, number) });
  });

  api.get('/drawings/:id/damages/:damageId/photos', async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const entries = await deps.photos.list(target.drawing.id, target.damageId);
    res.json(
      entries.map((entry) => ({
        number: entry.number,
        url: photoUrl(target.drawing.id, target.damageId, entry.number),
        size: entry.size,
        savedAt: entry.savedAt,
      })),
    );
  });

  // 파일 그대로. 서버는 내용을 바꾸지 않는다(HEIC도 그대로 — 스펙 2장). 한 장이 20MB 이하라
  // 스트리밍 대신 통째로 읽어 보낸다(업로드도 이미 메모리에 통째로 받는다).
  api.get('/drawings/:id/damages/:damageId/photos/:number', async (req, res) => {
    const target = await findDamageTarget(deps, req, res);
    if (!target) return;
    const number = req.params.number;
    if (!isPhotoNumber(number)) {
      res.status(400).json({ error: '사진번호 형식이 올바르지 않습니다.' });
      return;
    }
    const entry = await deps.photos.find(target.drawing.id, target.damageId, number);
    if (!entry) {
      res.status(404).json({ error: '사진을 찾을 수 없습니다.' });
      return;
    }
    const data = await deps.photos.readData(target.drawing.id, entry);
    res.setHeader('Content-Type', PHOTO_MIME_TYPES[extname(entry.file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  });
```

- [ ] **Step 6: `server/src/index.ts`를 엮는다**

import에 한 줄을 더한다:

```ts
import { PhotosStore } from './photosStore.js';
```

`createApp({ … })` 인자에 한 줄을 더한다(`originals:` 아래):

```ts
    photos: new PhotosStore(join(config.dataDir, 'photos')),
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npm --prefix server test -- app` → PASS
Run: `npm --prefix server test` → 전체 PASS
Run: `npm --prefix server run typecheck` → 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add server/src/app.ts server/src/index.ts server/test/app.test.ts
git commit -m "$(cat <<'MSG'
사진을 올리고 목록·파일로 받아 가는 API를 더한다

POST/GET /api/drawings/:id/damages/:damageId/photos 와 파일 하나 받기. 사진번호는 뷰어와
같은 photoNumberFromFilename이 파일 이름에서 뽑는다. 상한 20MB, JPEG·PNG·HEIC만 받고,
손상 id는 UUID·사진번호는 영문·숫자·-·_ 만 받아 경로 조작을 막는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** `curl -H "x-access-key: …" -F file=@IMG_0001.jpg http://localhost:3000/api/drawings/<id>/damages/<uuid>/photos`로 사진이 올라가고 다시 받아진다.

---

## Task 3: 도면 전체 사진 zip

**Files:**
- Modify: `server/package.json`, `server/package-lock.json` (`archiver`, `@types/archiver`)
- Create: `server/src/photoZip.ts`
- Modify: `server/src/app.ts` (import + `GET /drawings/:id/photos.zip` 라우트 — `export.dxf` 라우트 **위**에 넣는다)
- Test: `server/test/photoZip.test.ts` (생성), `server/test/app.test.ts` (zip `describe` 추가)

**Interfaces:**
- Consumes: Task 1의 `PhotoEntry`·`PhotosStore.listDrawing`·`pathOf`, Task 2의 `findDrawing`·`AppDeps.photos`, 기존 `computeNumbers`·`statusTextOf`(`quantities.js`), 기존 `framesOf`(`app.ts` 50행), 기존 `FrameBounds`(`export/frames.ts`)
- Produces:
  - `zipEntryNamesFor(damages: unknown[], frames: FrameBounds[], files: PhotoEntry[]): ZipEntry[]`
  - `interface ZipEntry { name: string; entry: PhotoEntry }`
  - `sanitizeEntryName(text: string): string`
  - `GET /api/drawings/:id/photos.zip` → `application/zip`, 사진 없으면 `400 { error: '저장된 사진이 없습니다' }`

- [ ] **Step 1: `archiver`를 설치한다**

```bash
npm --prefix server install archiver
npm --prefix server install -D @types/archiver
npm --prefix server ls archiver
```
Expected: `archiver@<버전>`이 보인다. `server/package.json`의 `dependencies`에 `archiver`, `devDependencies`에 `@types/archiver`가 생긴다.

- [ ] **Step 2: 이름 짓기의 실패하는 테스트를 쓴다**

`server/test/photoZip.test.ts` 생성. 값은 전부 손으로 계산한 것이다(계획 맨 끝 표 참고).

```ts
import { describe, expect, it } from 'vitest';
import type { FrameBounds } from '../src/export/frames.js';
import type { PhotoEntry } from '../src/photosStore.js';
import { sanitizeEntryName, zipEntryNamesFor } from '../src/photoZip.js';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';

// 손상 하나. world 중심 x가 번호 순서를 정하고(왼쪽이 앞), dwg 중심이 틀 배정을 정한다.
function damage(id: string, type: string, width: number, x: number, photoNumbers: string[]) {
  return {
    id,
    type,
    createdAt: '2026-09-18T01:00:00.000Z',
    geometry: {
      kind: 'polyline',
      world: [[x, 0], [x + 1, 0]],
      dwg: [[x, 0], [x + 1, 0]],
    },
    copies: [],
    measured: { width, length: 5, count: 1 },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers },
  };
}

function file(damageId: string, number: string, extension = '.jpg'): PhotoEntry {
  return { damageId, number, file: `${number}${extension}`, size: 10, savedAt: '2026-09-18T01:00:00.000Z' };
}

const NO_FRAMES: FrameBounds[] = [];

describe('sanitizeEntryName', () => {
  it('파일 이름에 쓸 수 없는 글자를 _로 바꾼다', () => {
    expect(sanitizeEntryName('균열/백태(0.5mm이상)')).toBe('균열_백태(0.5mm이상)');
    expect(sanitizeEntryName('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('바꿀 글자가 없으면 그대로 둔다', () => {
    expect(sanitizeEntryName('균열(0.3mm미만)')).toBe('균열(0.3mm미만)');
  });
});

describe('zipEntryNamesFor', () => {
  it('사진번호 칸에 있고 파일도 있는 것만 손상 이름으로 넣는다', () => {
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530', '999'])];
    const names = zipEntryNamesFor(damages, NO_FRAMES, [file(D1, '101530')]).map((e) => e.name);
    expect(names).toEqual(['1_균열(0.3mm미만)_101530.jpg']);
  });

  it('번호·손상현황·확장자를 그대로 쓰고, 칸에 없는 파일은 미연결로 넣는다', () => {
    const damages = [
      damage(D1, 'crack', 0.2, 0, ['101530', '999']),
      damage(D2, 'crack_efflorescence', 0.6, 10, ['101600']),
    ];
    const files = [file(D1, '101530'), file(D1, '777', '.png'), file(D2, '101600'), file(D3, '88')];

    expect(zipEntryNamesFor(damages, NO_FRAMES, files).map((e) => e.name)).toEqual([
      '1_균열(0.3mm미만)_101530.jpg',
      '미연결_11111111_777.png',
      '2_균열_백태(0.5mm이상)_101600.jpg',
      '삭제된손상_33333333_88.jpg',
    ]);
  });

  it('돌려주는 항목은 어느 파일인지도 함께 들고 있다', () => {
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530'])];
    const entry = file(D1, '101530');
    expect(zipEntryNamesFor(damages, NO_FRAMES, [entry])).toEqual([{ name: '1_균열(0.3mm미만)_101530.jpg', entry }]);
  });

  it('틀 밖 손상은 번호 자리가 X다', () => {
    const frames: FrameBounds[] = [{ minX: -5, minY: -5, maxX: 5, maxY: 5 }];
    const damages = [
      damage(D1, 'crack', 0.2, 0, ['101530']),
      damage(D2, 'crack_efflorescence', 0.6, 10, ['101600']),
    ];
    expect(zipEntryNamesFor(damages, frames, [file(D1, '101530'), file(D2, '101600')]).map((e) => e.name)).toEqual([
      '1_균열(0.3mm미만)_101530.jpg',
      'X_균열_백태(0.5mm이상)_101600.jpg',
    ]);
  });

  it('틀마다 1번부터라 이름이 겹치면 뒤에 (2)를 붙인다', () => {
    const frames: FrameBounds[] = [
      { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      { minX: 9, minY: -5, maxX: 12, maxY: 5 },
    ];
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530']), damage(D2, 'crack', 0.2, 10, ['101530'])];
    expect(zipEntryNamesFor(damages, frames, [file(D1, '101530'), file(D2, '101530')]).map((e) => e.name)).toEqual([
      '1_균열(0.3mm미만)_101530.jpg',
      '1_균열(0.3mm미만)_101530 (2).jpg',
    ]);
  });

  it('손상이 하나도 없으면 전부 삭제된손상이다', () => {
    expect(zipEntryNamesFor([], NO_FRAMES, [file(D1, '101530')]).map((e) => e.name)).toEqual([
      '삭제된손상_11111111_101530.jpg',
    ]);
  });

  it('파일이 없는 손상은 아무 항목도 만들지 않는다', () => {
    expect(zipEntryNamesFor([damage(D1, 'crack', 0.2, 0, ['101530'])], NO_FRAMES, [])).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm --prefix server test -- photoZip`
Expected: FAIL — `Cannot find module '../src/photoZip.js'`

- [ ] **Step 4: `server/src/photoZip.ts`를 만든다**

```ts
// 도면 전체 사진 zip의 항목 이름을 짓는다. 파일 I/O가 없는 순수 함수라 손으로 계산한 값으로
// 검사할 수 있다. 번호와 손상현황은 화면·산출 DXF와 **같은 함수**로 구한다 — 사용자가 zip 이름과
// 산출 도면을 나란히 놓고 보기 때문이다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 3장 + 9장(규칙 보완)

import { computeNumbers, statusTextOf } from '../public/viewer/quantities.js';
import type { FrameBounds } from './export/frames.js';
import type { PhotoEntry } from './photosStore.js';

export interface ZipEntry {
  /** zip 안에서 보일 이름 */
  name: string;
  /** 그 이름으로 넣을 파일 */
  entry: PhotoEntry;
}

// 파일 이름에 쓸 수 없는 글자. 손상현황에 '/'가 들어가는 유형이 있고('균열/백태'), 기타 유형은
// 사용자가 아무 글자나 적을 수 있다. '/'를 그대로 두면 zip 안에 폴더가 생겨 버린다.
const UNSAFE_NAME = /[\\/:*?"<>|\r\n\t]/g;

export function sanitizeEntryName(text: string): string {
  return String(text).replace(UNSAFE_NAME, '_');
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? '' : file.slice(dot);
}

function photoNumbersOf(damage: unknown): string[] {
  const value = (damage as { attrs?: { photoNumbers?: unknown } } | null)?.attrs?.photoNumbers;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * zip에 넣을 항목과 그 이름. 규칙(스펙 3장·9장):
 * - `attrs.photoNumbers`에 있는 번호 중 **파일이 있는 것**만 `<번호>_<손상현황>_<사진번호><확장자>`.
 * - 번호는 `computeNumbers`(틀마다 1번부터). 틀 밖이라 번호가 없으면 `X`.
 * - 같은 손상 폴더에 있지만 칸에 없는 번호는 `미연결_<손상id 앞 8자>_<사진번호><확장자>` —
 *   사진을 버리지 않는다.
 * - 손상 기록에 없는 폴더(지운 손상)는 `삭제된손상_<손상id 앞 8자>_<사진번호><확장자>`.
 * - 틀마다 1번부터라 이름이 겹칠 수 있다. 겹치면 확장자 앞에 ` (2)`, ` (3)`…을 붙인다.
 */
export function zipEntryNamesFor(damages: unknown[], frames: FrameBounds[], files: PhotoEntry[]): ZipEntry[] {
  const list = Array.isArray(damages) ? damages : [];
  const numbers = computeNumbers(list, frames);

  // 손상 폴더별로 모은다. listDrawing이 손상 id 오름차순·번호 오름차순으로 주므로 순서가
  // 흔들리지 않는다(Map은 넣은 순서를 지킨다).
  const byDamage = new Map<string, PhotoEntry[]>();
  for (const file of Array.isArray(files) ? files : []) {
    const bucket = byDamage.get(file.damageId);
    if (bucket) bucket.push(file);
    else byDamage.set(file.damageId, [file]);
  }

  const result: ZipEntry[] = [];
  const used = new Set<string>();
  const push = (base: string, entry: PhotoEntry): void => {
    const extension = extensionOf(entry.file);
    let name = `${base}${extension}`;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})${extension}`;
    used.add(name);
    result.push({ name, entry });
  };

  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id ?? '');
    const bucket = byDamage.get(id);
    if (!bucket) continue;
    byDamage.delete(id);
    const prefix = `${numbers.get(id) ?? 'X'}_${sanitizeEntryName(statusTextOf(damage))}`;
    const linked = new Set<string>();
    for (const photoNumber of photoNumbersOf(damage)) {
      const found = bucket.find((item) => item.number === photoNumber);
      if (!found) continue;
      linked.add(found.number);
      push(`${prefix}_${found.number}`, found);
    }
    for (const item of bucket) {
      if (linked.has(item.number)) continue;
      push(`미연결_${id.slice(0, 8)}_${item.number}`, item);
    }
  }

  for (const [id, bucket] of byDamage) {
    for (const item of bucket) push(`삭제된손상_${id.slice(0, 8)}_${item.number}`, item);
  }
  return result;
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npm --prefix server test -- photoZip` → PASS

- [ ] **Step 6: zip 라우트의 실패하는 테스트를 쓴다**

`server/test/app.test.ts`에 붙인다. `photoDoc` 헬퍼를 `crackDoc` 옆에 둔다.

```ts
// 사진이 붙은 손상 하나. 폭 0.2 → 손상현황 '균열(0.3mm미만)'.
function photoDoc(drawingId: string) {
  return {
    schemaVersion: 5,
    drawingId,
    updatedAt: '2026-09-18T01:00:00.000Z',
    damages: [
      {
        id: D1,
        type: 'crack',
        createdAt: '2026-09-18T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [1, 0]], dwg: [[0, 0], [1, 0]] },
        copies: [],
        measured: { width: 0.2, length: 5, count: 1 },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: ['101530'] },
      },
    ],
  };
}

describe('GET /api/drawings/:id/photos.zip', () => {
  it('사진을 zip으로 묶어 보낸다 (이름은 번호_손상현황_사진번호)', async () => {
    const { app, drawings, damages, photos } = setup();
    const drawing = await seed(drawings, { name: '교량 A.dwg' });
    await damages.save(photoDoc(drawing.id));
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('photo-one'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('교량 A_사진.zip')}`,
    );
    const body = Buffer.from(res.body);
    // 진짜 zip인지: 첫 항목 머리글 서명 PK\x03\x04
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // 항목 이름은 머리글에 UTF-8 그대로 들어가고, store 방식이라 내용도 그대로 들어간다.
    expect(body.includes(Buffer.from('1_균열(0.3mm미만)_101530.jpg', 'utf8'))).toBe(true);
    expect(body.includes(Buffer.from('photo-one', 'utf8'))).toBe(true);
  });

  it('손상 기록이 없으면 삭제된손상 이름으로 넣는다 (사진을 버리지 않는다)', async () => {
    const { app, drawings, photos } = setup();
    const drawing = await seed(drawings);
    await photos.save(drawing.id, D1, '101530', '.jpg', Buffer.from('x'));

    const res = await request(app)
      .get(`/api/drawings/${drawing.id}/photos.zip`)
      .set('x-access-key', KEY)
      .responseType('blob');

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).includes(Buffer.from('삭제된손상_11111111_101530.jpg', 'utf8'))).toBe(true);
  });

  it('사진이 하나도 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const res = await request(app).get(`/api/drawings/${drawing.id}/photos.zip`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('저장된 사진이 없습니다');
  });

  it('없는 도면은 404, 키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    expect((await request(app).get(`/api/drawings/${newDrawingId()}/photos.zip`).set('x-access-key', KEY)).status).toBe(
      404,
    );
    expect((await request(app).get(`/api/drawings/${drawing.id}/photos.zip`)).status).toBe(401);
  });
});
```

- [ ] **Step 7: 실패를 확인한다**

Run: `npm --prefix server test -- app`
Expected: FAIL — zip 요청이 `없는 API입니다.`(404)

- [ ] **Step 8: zip 라우트를 넣는다**

`server/src/app.ts` import에 더한다:

```ts
import archiver from 'archiver';
import { zipEntryNamesFor } from './photoZip.js';
```

`ensureFrames` 아래(헬퍼 자리)에 넣는다:

```ts
// zip 이름의 <번호>는 사용자가 산출 DXF·앱 화면에서 보는 번호와 같아야 한다. 산출
// (exportDamagesToDxf)이 레코드가 아니라 **원본에서** 틀을 다시 구하므로 zip도 같은 길을 쓴다 —
// 원본이 곧 진실이다(2026-09-16 틀 설계 6장). DXF가 아니거나 원본이 없으면 레코드의 frames로
// 물러선다(DWG 레코드는 [] 이므로 도면 전체가 한 묶음, 예전 번호 규칙과 같다).
async function zipFramesOf(deps: AppDeps, drawing: DrawingRecord): Promise<FrameBounds[]> {
  if (!drawing.objectKey.toLowerCase().endsWith('.dxf')) return drawing.frames ?? [];
  const original = await deps.originals.read(drawing.objectKey);
  if (!original) return drawing.frames ?? [];
  return framesOf(original, drawing.objectKey);
}
```

`api.get('/drawings/:id/export.dxf', …)` **위**에 라우트를 넣는다(둘 다 `/drawings/:id/…`라 순서는 상관없지만 산출끼리 모아 둔다):

```ts
  api.get('/drawings/:id/photos.zip', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    const files = await deps.photos.listDrawing(drawing.id);
    if (files.length === 0) {
      res.status(400).json({ error: '저장된 사진이 없습니다' });
      return;
    }
    const doc = await deps.damages.get(drawing.id);
    const entries = zipEntryNamesFor(doc.damages, await zipFramesOf(deps, drawing), files);

    // 한글은 HTTP 헤더 값에 그대로 넣을 수 없다(export.dxf와 같은 이유) — RFC 5987 filename*.
    const fileName = `${drawing.name.replace(/\.[^.]*$/, '')}_사진.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="photos.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    // JPEG·HEIC·PNG는 이미 압축돼 있어 다시 줄여도 거의 안 줄어든다. store로 두면 사진 수십 장에도
    // CPU를 쓰지 않는다. 파일은 스트림으로 읽는다 — 20MB짜리 수십 장을 메모리에 쌓지 않는다.
    const archive = archiver('zip', { store: true });
    archive.on('warning', (err) => console.error('[photos.zip]', drawing.id, err));
    // 여기까지 오면 머리글을 이미 보냈으므로 상태 코드를 400·500으로 바꿀 수 없다. 받는 쪽이
    // 깨진 zip을 온전한 것으로 착각하지 않도록 연결을 끊는다.
    archive.on('error', (err) => {
      console.error('[photos.zip]', drawing.id, err);
      res.destroy(err);
    });
    archive.pipe(res);
    for (const { name, entry } of entries) {
      archive.file(deps.photos.pathOf(drawing.id, entry), { name });
    }
    await archive.finalize();
  });
```

- [ ] **Step 9: 통과를 확인한다**

Run: `npm --prefix server test` → 전체 PASS
Run: `npm --prefix server run typecheck` → 오류 없음

- [ ] **Step 10: 커밋**

```bash
git add server/package.json server/package-lock.json server/src/photoZip.ts server/src/app.ts server/test/photoZip.test.ts server/test/app.test.ts
git commit -m "$(cat <<'MSG'
도면의 사진을 zip 하나로 내려받는다

항목 이름은 <번호>_<손상현황>_<사진번호>다. 번호는 산출 DXF와 같게 원본에서 다시 구한
망도틀로 매기고, 틀 밖이면 X다. 사진번호 칸에서 지운 파일은 미연결_, 지운 손상 폴더는
삭제된손상_ 으로 넣어 사진을 버리지 않는다. 이름이 겹치면 (2)를 붙인다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** 서버만으로 `GET /api/drawings/<id>/photos.zip`이 사내 이름 규칙대로 zip을 내려준다. 앱·화면은 아직 그대로다.

---

## Task 4: 전송 대기열의 판단 규칙 (순수)

**왜 `src/`에 두는가(스펙 8장이 계획에서 정하라고 한 것):** 규칙 함수는 **`src/photoQueue.ts`**에 둔다.
- 앱은 `./photoQueue`로 가져간다(Metro·Expo 기본 해석).
- 루트 `npx tsc --noEmit`이 `src/**`를 검사한다(루트 `tsconfig.json`의 `exclude`는 `server`뿐이다).
- `server/test/photoQueue.test.ts`가 `../../src/photoQueue.js`로 가져간다. `server/tsconfig.json`의 `include`에 `../src`가 없어도 된다 — **테스트가 import한 파일은 TS 프로그램에 함께 들어간다.** NodeNext라 `.js`를 붙여 쓰고 TS가 `.ts`를 찾아 준다.
- 그래서 이 파일은 **아무것도 import하지 않는다.** `react-native`·`expo-*`를 하나라도 가져오면 vitest가 깨진다. 이 규칙을 파일 맨 위 주석에 적어 둔다.
- `server/public/viewer/photoQueue.js`에 두는 대안은 쓰지 않는다 — 대기열은 브라우저와 아무 상관이 없고, 뷰어 폴더는 "화면과 서버가 함께 쓰는 규칙"만 두는 자리다.

**Files:**
- Create: `src/photoQueue.ts`
- Test: `server/test/photoQueue.test.ts`
- Modify(필요할 때만): `server/vitest.config.ts`

**Interfaces:**
- Consumes: 없음(순수 모듈)
- Produces:
  - `interface PhotoQueueItem { id: string; drawingId: string; damageId: string; uri: string; filename: string; addedAt: number; tries: number; lastTriedAt: number }`
  - `type PhotoUploadOutcome = 'ok' | 'retry' | 'drop'`
  - `MAX_PHOTO_TRIES = 10`, `PHOTO_RETRY_STEP_MS = 60_000`, `PHOTO_RETRY_MAX_MS = 600_000`
  - `retryDelayMs(tries: number): number`
  - `nextRetry(queue: PhotoQueueItem[], now: number): PhotoQueueItem | null`
  - `applyResult(queue: PhotoQueueItem[], id: string, outcome: PhotoUploadOutcome, now: number): PhotoQueueItem[]`
  - `pendingCount(queue: PhotoQueueItem[]): number`
  - `retryAll(queue: PhotoQueueItem[]): PhotoQueueItem[]`
  - `parseQueue(value: unknown): PhotoQueueItem[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/photoQueue.test.ts` 생성. 시각은 손으로 고른 값이다.

```ts
import { describe, expect, it } from 'vitest';
import {
  applyResult,
  MAX_PHOTO_TRIES,
  nextRetry,
  parseQueue,
  pendingCount,
  retryAll,
  retryDelayMs,
  type PhotoQueueItem,
} from '../../src/photoQueue.js';

const NOW = 1_000_000;

function item(id: string, patch: Partial<PhotoQueueItem> = {}): PhotoQueueItem {
  return {
    id,
    drawingId: 'd_00000000000000000000000000000001',
    damageId: '11111111-1111-4111-8111-111111111111',
    uri: `file:///documents/photo-queue/${id}.jpg`,
    filename: '20260918_101530.jpg',
    addedAt: 100,
    tries: 0,
    lastTriedAt: 0,
    ...patch,
  };
}

describe('retryDelayMs', () => {
  it('처음에는 기다리지 않고, 실패할수록 1분씩 길어진다', () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(180_000);
  });

  it('10분에서 멈춘다', () => {
    expect(retryDelayMs(10)).toBe(600_000);
    expect(retryDelayMs(20)).toBe(600_000);
  });
});

describe('nextRetry', () => {
  it('빈 대기열은 null', () => {
    expect(nextRetry([], NOW)).toBeNull();
  });

  it('한 번도 안 보낸 항목은 바로 보낸다', () => {
    expect(nextRetry([item('a')], NOW)?.id).toBe('a');
  });

  it('먼저 들어온 것부터 보낸다', () => {
    const queue = [item('b', { addedAt: 300 }), item('a', { addedAt: 200 })];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('들어온 시각이 같으면 id 순서로 가른다', () => {
    const queue = [item('b'), item('a')];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('방금 실패한 항목은 기다린다', () => {
    // tries 1 → 60초를 기다려야 하는데 1초밖에 안 지났다.
    const queue = [item('a', { tries: 1, lastTriedAt: NOW - 1_000 })];
    expect(nextRetry(queue, NOW)).toBeNull();
  });

  it('기다릴 만큼 기다렸으면 다시 보낸다', () => {
    const queue = [item('a', { tries: 1, lastTriedAt: NOW - 60_000 })];
    expect(nextRetry(queue, NOW)?.id).toBe('a');
  });

  it('기다리는 항목을 건너뛰고 보낼 수 있는 항목을 고른다', () => {
    const queue = [
      item('a', { addedAt: 100, tries: 1, lastTriedAt: NOW - 1_000 }),
      item('b', { addedAt: 200 }),
    ];
    expect(nextRetry(queue, NOW)?.id).toBe('b');
  });

  it('10번 실패한 항목은 더 보내지 않는다', () => {
    const queue = [item('a', { tries: MAX_PHOTO_TRIES, lastTriedAt: 0 })];
    expect(nextRetry(queue, NOW)).toBeNull();
  });
});

describe('applyResult', () => {
  it('성공하면 대기열에서 뺀다', () => {
    const queue = [item('a'), item('b')];
    expect(applyResult(queue, 'a', 'ok', NOW).map((entry) => entry.id)).toEqual(['b']);
  });

  it('서버가 400을 주면(형식·번호) 다시 보내도 소용없으므로 뺀다', () => {
    const queue = [item('a'), item('b')];
    expect(applyResult(queue, 'b', 'drop', NOW).map((entry) => entry.id)).toEqual(['a']);
  });

  it('실패하면 횟수를 올리고 시각을 남긴다', () => {
    const queue = [item('a', { tries: 2, lastTriedAt: 5 })];
    expect(applyResult(queue, 'a', 'retry', NOW)[0]).toMatchObject({ id: 'a', tries: 3, lastTriedAt: NOW });
  });

  it('원래 배열을 고치지 않는다', () => {
    const queue = [item('a')];
    applyResult(queue, 'a', 'retry', NOW);
    expect(queue[0]).toMatchObject({ tries: 0, lastTriedAt: 0 });
  });

  it('모르는 id면 그대로 둔다', () => {
    const queue = [item('a')];
    expect(applyResult(queue, 'zz', 'ok', NOW)).toEqual(queue);
  });
});

describe('pendingCount·retryAll', () => {
  it('보내지 못한 사진 수는 10번 실패한 것까지 센다', () => {
    expect(pendingCount([item('a'), item('b', { tries: MAX_PHOTO_TRIES })])).toBe(2);
  });

  it('다시 시도를 누르면 횟수와 시각을 0으로 되돌린다', () => {
    const queue = [item('a', { tries: MAX_PHOTO_TRIES, lastTriedAt: 5 })];
    expect(retryAll(queue)[0]).toMatchObject({ tries: 0, lastTriedAt: 0 });
    expect(nextRetry(retryAll(queue), NOW)?.id).toBe('a');
  });
});

describe('parseQueue', () => {
  it('저장된 배열을 그대로 읽는다', () => {
    expect(parseQueue([item('a')])).toEqual([item('a')]);
  });

  it('배열이 아니거나 모양이 다른 항목은 버린다 (파일이 깨져도 앱이 뜬다)', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('{')).toEqual([]);
    expect(parseQueue([item('a'), { id: 'b' }, null, 7])).toEqual([item('a')]);
  });

  it('숫자 칸이 없으면 기본값으로 채운다', () => {
    const { tries, lastTriedAt, ...rest } = item('a');
    expect(parseQueue([rest])[0]).toMatchObject({ id: 'a', tries: 0, lastTriedAt: 0 });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- photoQueue`
Expected: FAIL — `Cannot find module '../../src/photoQueue.js'`

**모듈이 없다는 오류가 아니라 "루트 밖 파일이라 읽을 수 없다"는 오류가 나면**(Vite의 `fs.allow`) `server/vitest.config.ts`를 아래로 바꾸고 다시 돌린다:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 대기열 규칙(src/photoQueue.ts)은 앱 코드라 server/ 밖에 있다. 앱과 테스트가 같은 파일을
    // 보도록 루트 밖 읽기를 연다.
    server: { fs: { allow: ['..'] } },
  },
});
```

- [ ] **Step 3: `src/photoQueue.ts`를 만든다**

```ts
// 사진 전송 대기열의 **판단 규칙**만 모은다. 파일·네트워크·RN을 건드리지 않는 순수 모듈이라
// vitest(server/test/photoQueue.test.ts)가 상대 경로로 가져가 검사한다.
// 그래서 이 파일은 **아무것도 import하지 않는다** — expo·react-native를 하나라도 가져오면
// 서버 테스트가 깨진다. 실제 저장·전송은 src/photoUpload.ts가 한다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 4장

export interface PhotoQueueItem {
  /** 항목 식별자. 대기열 안에서만 쓰며 서버로 보내지 않는다. */
  id: string;
  drawingId: string;
  damageId: string;
  /** 앱 문서 폴더에 둔 보관 사본의 uri. 앨범 파일은 권한 때문에 다시 읽기 어렵다(설계 4장). */
  uri: string;
  /** 서버가 사진번호를 뽑는 이름. 뷰어가 칸에 붙인 번호와 같은 이름이어야 한다. */
  filename: string;
  addedAt: number;
  tries: number;
  /** 마지막으로 보낸 시각(epoch ms). 아직 한 번도 안 보냈으면 0. */
  lastTriedAt: number;
}

export type PhotoUploadOutcome = 'ok' | 'retry' | 'drop';

/** 10번 실패한 항목은 그대로 두고 더 시도하지 않는다(설계 4장). 목록 화면 배지로 알린다. */
export const MAX_PHOTO_TRIES = 10;
export const PHOTO_RETRY_STEP_MS = 60_000;
export const PHOTO_RETRY_MAX_MS = 600_000;

// 실패한 항목을 다시 보내기까지 기다리는 시간. 실패할수록 1분씩 길어지고 10분에서 멈춘다 —
// 서버가 꺼져 있는 동안 60초마다 같은 항목을 계속 두드리지 않기 위해서다.
export function retryDelayMs(tries: number): number {
  if (!Number.isFinite(tries) || tries <= 0) return 0;
  return Math.min(PHOTO_RETRY_STEP_MS * tries, PHOTO_RETRY_MAX_MS);
}

// 지금 보낼 항목 하나. 먼저 들어온 것부터, 같으면 id 순서로. 한 번에 하나만 보낸다 —
// 현장 회선이 느릴 때 사진 여러 장을 동시에 올리면 셋 다 시간이 초과된다.
export function nextRetry(queue: PhotoQueueItem[], now: number): PhotoQueueItem | null {
  let best: PhotoQueueItem | null = null;
  for (const item of Array.isArray(queue) ? queue : []) {
    if (item.tries >= MAX_PHOTO_TRIES) continue;
    if (now - item.lastTriedAt < retryDelayMs(item.tries)) continue;
    if (best === null || item.addedAt < best.addedAt || (item.addedAt === best.addedAt && item.id < best.id)) {
      best = item;
    }
  }
  return best;
}

// 보낸 결과를 대기열에 반영한다. 성공('ok')과 서버가 400을 준 경우('drop')는 뺀다 — 형식·번호
// 오류는 다시 보내도 같은 답이 온다(설계 4.5). 그 밖의 실패('retry')는 횟수를 올린다.
export function applyResult(
  queue: PhotoQueueItem[],
  id: string,
  outcome: PhotoUploadOutcome,
  now: number,
): PhotoQueueItem[] {
  const list = Array.isArray(queue) ? queue : [];
  if (outcome === 'ok' || outcome === 'drop') return list.filter((item) => item.id !== id);
  return list.map((item) => (item.id === id ? { ...item, tries: item.tries + 1, lastTriedAt: now } : item));
}

/** 목록 화면 배지의 숫자. 10번 실패해 멈춘 항목도 "보내지 못한 사진"이므로 함께 센다. */
export function pendingCount(queue: PhotoQueueItem[]): number {
  return Array.isArray(queue) ? queue.length : 0;
}

/** 배지를 눌렀을 때. 멈춘 항목까지 처음부터 다시 보낼 수 있게 되돌린다. */
export function retryAll(queue: PhotoQueueItem[]): PhotoQueueItem[] {
  return (Array.isArray(queue) ? queue : []).map((item) => ({ ...item, tries: 0, lastTriedAt: 0 }));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// 저장 파일(photo-queue.json)을 읽을 때 쓴다. 파일이 깨졌거나 옛 모양이어도 앱이 뜨는 것이
// 사진 몇 장보다 중요하다 — 모양이 다른 항목은 조용히 버린다.
export function parseQueue(value: unknown): PhotoQueueItem[] {
  if (!Array.isArray(value)) return [];
  const result: PhotoQueueItem[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (!isText(entry.id) || !isText(entry.drawingId) || !isText(entry.damageId)) continue;
    if (!isText(entry.uri) || !isText(entry.filename)) continue;
    result.push({
      id: entry.id,
      drawingId: entry.drawingId,
      damageId: entry.damageId,
      uri: entry.uri,
      filename: entry.filename,
      addedAt: numberOr(entry.addedAt, 0),
      tries: numberOr(entry.tries, 0),
      lastTriedAt: numberOr(entry.lastTriedAt, 0),
    });
  }
  return result;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm --prefix server test -- photoQueue` → PASS
Run: `npm --prefix server run typecheck` → 오류 없음(테스트가 가져온 `src/photoQueue.ts`도 함께 검사된다)
Run: `npx tsc --noEmit` → 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/photoQueue.ts server/test/photoQueue.test.ts
git commit -m "$(cat <<'MSG'
사진 전송 대기열의 판단 규칙을 순수 모듈로 뺀다

다음에 보낼 항목 고르기, 결과 반영(성공·400은 빼고 나머지는 횟수 증가), 10번 상한,
기다리는 시간(1분씩 늘려 10분에서 멈춤), 깨진 저장 파일 읽기. 앱에는 테스트 러너가 없어
server/test가 상대 경로로 가져가 검사한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

(`server/vitest.config.ts`를 고쳤다면 `git add`에 함께 적는다.)

**Deliverable:** 대기열이 언제 무엇을 다시 보내는지가 테스트로 못 박혔다. 아직 앱은 이 파일을 쓰지 않는다.

---

## Task 5: 앱 — 찍은 뒤 올리기와 재시도

**Files:**
- Create: `src/photoUpload.ts`
- Modify: `src/photo.ts` (`PhotoResult` 타입, `takePhotoAndSave`의 5단계 뒤)
- Modify: `src/screens/ViewerScreen.tsx` (`handleMessage`의 `takePhoto` 가지, 60초 타이머 `useEffect`)
- Modify: `src/screens/DrawingListScreen.tsx` (배지)
- 검증: `npx tsc --noEmit` + 읽기(앱 코드에는 테스트 러너가 없다). 규칙은 Task 4가 이미 검사했다.

**Interfaces:**
- Consumes: Task 4의 `PhotoQueueItem`·`nextRetry`·`applyResult`·`pendingCount`·`retryAll`·`parseQueue`, Task 2의 `POST …/photos`, 기존 `API_URL`·`ACCESS_KEY`(`src/config.ts`), 기존 `takePhotoAndSave`
- Produces:
  - `keepCopy(sourceUri: string, filename: string): Promise<string | null>` — 문서 폴더 사본의 uri
  - `enqueuePhoto(input: { drawingId: string; damageId: string; filename: string; uploadUri: string }): PhotoQueueItem`
  - `type UploadNotice = { id: string; ok: true; damageId: string; number: string } | { id: string; ok: false; damageId: string; reason: string; willRetry: boolean }`
  - `flushPhotoQueue(notify: (notice: UploadNotice) => void): Promise<void>`
  - `pendingPhotoCount(): number`, `retryPendingPhotos(): void`, `PHOTO_FLUSH_INTERVAL_MS = 60_000`
  - `PhotoResult`(바뀜): `{ ok: true; filename: string; uploadUri: string | null } | { ok: false; reason: string }`

- [ ] **Step 1: `src/photoUpload.ts`를 만든다**

```ts
// 찍은 사진을 서버로 보낸다. 실패하면 앱 문서 폴더의 대기열(photo-queue.json)에 넣고 나중에 다시
// 보낸다. **언제 무엇을 보낼지**는 순수 모듈 src/photoQueue.ts가 정하고(테스트 있음), 이 파일은
// 파일·네트워크만 다룬다. 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 4장
import { Directory, File, Paths } from 'expo-file-system';
import { ACCESS_KEY, API_URL } from './config';
import { applyResult, nextRetry, parseQueue, pendingCount, retryAll, type PhotoQueueItem } from './photoQueue';

/** 뷰어 화면에 머무는 동안 이 간격으로 다시 시도한다(설계 4.4). */
export const PHOTO_FLUSH_INTERVAL_MS = 60_000;

const QUEUE_FILE_NAME = 'photo-queue.json';
const KEEP_DIR_NAME = 'photo-queue';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.heif': 'image/heic',
};

export type UploadNotice =
  | { id: string; ok: true; damageId: string; number: string }
  // willRetry: 나중에 다시 보낼 항목인지. 뷰어 문구가 '다시 시도합니다'와 '서버가 받지
  // 않았습니다'로 갈린다(설계 4.2·4.5).
  | { id: string; ok: false; damageId: string; reason: string; willRetry: boolean };

function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(filename);
  return match ? match[0].toLowerCase() : '.jpg';
}

function mimeOf(filename: string): string {
  return MIME_BY_EXTENSION[extensionOf(filename)] ?? 'image/jpeg';
}

function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE_NAME);
}

// 읽기·쓰기는 모두 실패를 삼킨다. 사진 몇 장보다 앱이 뜨는 것이 중요하다.
function readQueue(): PhotoQueueItem[] {
  try {
    const file = queueFile();
    if (!file.exists) return [];
    return parseQueue(JSON.parse(file.textSync()) as unknown);
  } catch {
    return [];
  }
}

function writeQueue(queue: PhotoQueueItem[]): void {
  try {
    queueFile().write(JSON.stringify(queue));
  } catch (err) {
    console.error('[photoUpload] 대기열을 저장하지 못했습니다', err);
  }
}

function newItemId(): string {
  // crypto.randomUUID은 RN에 없을 수 있다. 대기열 안에서만 구분되면 되므로 시각 + 임의 글자로 짓는다.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function removeFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 지우지 못해도 대기열에서는 빠졌다. 문서 폴더에 사본 하나가 남을 뿐이다.
  }
}

// 앨범 파일은 권한 때문에 나중에 다시 읽기 어렵고, 캐시 사본은 시스템이 언제든 지운다.
// 그래서 문서 폴더(Paths.document)에 사본을 하나 더 둔다 — 전송이 끝나면 지운다(설계 4.3).
export async function keepCopy(sourceUri: string, filename: string): Promise<string | null> {
  try {
    const folder = new Directory(Paths.document, KEEP_DIR_NAME);
    folder.create({ intermediates: true, idempotent: true });
    const destination = new File(folder, `${newItemId()}${extensionOf(filename)}`);
    await new File(sourceUri).copy(destination, { overwrite: true });
    return destination.uri;
  } catch (err) {
    console.error('[photoUpload] 보관 사본을 만들지 못했습니다', err);
    return null;
  }
}

export function enqueuePhoto(input: {
  drawingId: string;
  damageId: string;
  filename: string;
  uploadUri: string;
}): PhotoQueueItem {
  const item: PhotoQueueItem = {
    id: newItemId(),
    drawingId: input.drawingId,
    damageId: input.damageId,
    uri: input.uploadUri,
    filename: input.filename,
    addedAt: Date.now(),
    tries: 0,
    lastTriedAt: 0,
  };
  writeQueue([...readQueue(), item]);
  return item;
}

type Attempt =
  | { outcome: 'ok'; number: string }
  | { outcome: 'retry'; reason: string }
  | { outcome: 'drop'; reason: string };

async function uploadOne(item: PhotoQueueItem): Promise<Attempt> {
  const form = new FormData();
  // filename 필드는 file 파트보다 **앞에** 와야 서버(multer)의 req.body에 담긴다. 앨범 파일
  // 이름을 그대로 보내야 서버가 뽑는 사진번호가 뷰어가 칸에 붙인 번호와 같다.
  form.append('filename', item.filename);
  // RN의 FormData는 파일을 { uri, name, type } 객체로 받는다(웹 Blob이 아니다). 타입 정의에는
  // 없는 모양이라 캐스트가 필요하다.
  form.append('file', { uri: item.uri, name: item.filename, type: mimeOf(item.filename) } as unknown as Blob);

  let res: Response;
  try {
    // Content-Type은 넣지 않는다 — RN이 multipart 경계 문자열을 스스로 붙인다.
    res = await fetch(`${API_URL}/api/drawings/${item.drawingId}/damages/${item.damageId}/photos`, {
      method: 'POST',
      headers: { 'x-access-key': ACCESS_KEY },
      body: form,
    });
  } catch {
    return { outcome: 'retry', reason: '서버에 연결할 수 없습니다' };
  }

  const body = (await res.json().catch(() => ({}))) as { number?: string; error?: string };
  if (res.status === 201) return { outcome: 'ok', number: typeof body.number === 'string' ? body.number : '' };
  const reason = body.error ?? `서버가 거절했습니다 (${res.status})`;
  // 400(형식·번호)·404(도면이 없어짐)·413(너무 큼)은 다시 보내도 같은 답이 온다 → 뺀다(설계 4.5).
  // 401·5xx·그 밖은 접근키를 고치거나 서버가 살아나면 되므로 남긴다.
  if (res.status === 400 || res.status === 404 || res.status === 413) return { outcome: 'drop', reason };
  return { outcome: 'retry', reason };
}

let flushing = false;

// 보낼 수 있는 항목을 하나씩 끝까지 보낸다. 겹쳐 불려도(화면 진입 + 60초 타이머 + 촬영 직후)
// 한 번만 돈다. 매번 파일에서 다시 읽는다 — 보내는 동안 새로 찍은 사진을 잃지 않는다.
export async function flushPhotoQueue(notify: (notice: UploadNotice) => void): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const item = nextRetry(readQueue(), Date.now());
      if (!item) return;
      const attempt = await uploadOne(item);
      writeQueue(applyResult(readQueue(), item.id, attempt.outcome, Date.now()));
      if (attempt.outcome !== 'retry') removeFile(item.uri);
      if (attempt.outcome === 'ok') {
        notify({ id: item.id, ok: true, damageId: item.damageId, number: attempt.number });
      } else {
        notify({
          id: item.id,
          ok: false,
          damageId: item.damageId,
          reason: attempt.reason,
          willRetry: attempt.outcome === 'retry',
        });
      }
    }
  } finally {
    flushing = false;
  }
}

/** 목록 화면 배지의 숫자. */
export function pendingPhotoCount(): number {
  return pendingCount(readQueue());
}

/** 배지를 눌렀을 때. 10번 실패해 멈춘 항목까지 되돌린다 — 이어서 flushPhotoQueue를 부른다. */
export function retryPendingPhotos(): void {
  writeQueue(retryAll(readQueue()));
}
```

- [ ] **Step 2: `src/photo.ts`가 보관 사본을 만들어 uri를 함께 돌려주게 한다**

타입을 바꾼다:

```ts
export type PhotoResult =
  // uploadUri: 서버로 보낼 문서 폴더 사본. 만들지 못하면 null이고 이때는 서버 전송을 건너뛴다.
  | { ok: true; filename: string; uploadUri: string | null }
  | { ok: false; reason: string };
```

import에 한 줄을 더한다:

```ts
import { keepCopy } from './photoUpload';
```

5단계(앨범 저장)의 `return`을 바꾼다:

```ts
    // 5. 앨범에 저장. asset.filename이 있으면 그것을(iOS는 IMG_로 다시 지어짐 — 조사 2장), 없으면
    // 우리가 지은 이름을 돌려준다. 앨범을 따로 만들지 않는다 — 기본 카메라 앨범/DCIM.
    const savedAsset = await MediaLibrary.createAssetAsync(uri);
    const filename = savedAsset.filename || ourName;
    // 6. 서버로 보낼 사본을 문서 폴더에 하나 더 둔다(2026-09-18 설계 4.3). 앨범 파일은 권한
    // 때문에, 캐시 사본은 시스템이 지울 수 있어 나중에 다시 읽기 어렵다. 실패해도 촬영 자체는
    // 성공이다 — uploadUri만 null로 돌려주고 호출부가 전송을 건너뛴다.
    return { ok: true, filename, uploadUri: await keepCopy(uri, filename) };
```

- [ ] **Step 3: `ViewerScreen.tsx`의 `takePhoto` 처리를 고친다**

import에 더한다:

```ts
import {
  flushPhotoQueue,
  enqueuePhoto,
  PHOTO_FLUSH_INTERVAL_MS,
  type UploadNotice,
} from '../photoUpload';
```

`photoBusyRef` 아래에 ref 하나를 더한다:

```ts
// 방금 찍어 올리는 중인 항목. 전송 결과를 뷰어에 알릴 때 그 촬영의 requestId를 함께 보내기
// 위해서다(대기열에 남아 있던 옛 항목은 requestId가 없으므로 null로 보낸다).
const photoRequestRef = useRef<{ itemId: string; requestId: string } | null>(null);
```

주입을 한 곳으로 모은다(`clearPendingFlush` 위에 둔다):

```ts
// 뷰어 페이지의 window 함수를 부른다. 끝의 true는 iOS에서 injectJavaScript 결과가 직렬화되지
// 않아 생기는 경고를 막는다(FLUSH_SCRIPT와 같은 이유).
const inject = useCallback((fn: string, payload: unknown) => {
  webViewRef.current?.injectJavaScript(`window.${fn} && window.${fn}(${JSON.stringify(payload)}); true;`);
}, []);
```

전송 결과를 뷰어에 알리는 콜백과 재시도 함수를 더한다:

```ts
const notifyUpload = useCallback(
  (notice: UploadNotice) => {
    const pending = photoRequestRef.current;
    const requestId = pending && pending.itemId === notice.id ? pending.requestId : null;
    if (notice.ok) {
      inject('mangdoPhotoUploaded', { requestId, damageId: notice.damageId, number: notice.number });
    } else {
      inject('mangdoPhotoUploadFailed', {
        requestId,
        damageId: notice.damageId,
        reason: notice.reason,
        willRetry: notice.willRetry,
      });
    }
  },
  [inject],
);

const flushPhotos = useCallback(() => {
  void flushPhotoQueue(notifyUpload);
}, [notifyUpload]);
```

`handleMessage`의 `takePhoto` 가지를 아래로 바꾼다(`handleMessage`의 `useCallback` 의존성 배열을 `[flushPhotos, inject]`로 고친다):

```ts
    } else if (type === 'takePhoto') {
      if (typeof requestId !== 'string') return;
      // 뷰어는 drawingId도 함께 보내지만(설계 4장) 저장에는 **앱이 연 도면의 id**를 쓴다 —
      // 이 화면이 그 도면을 열었다는 사실이 더 확실하다. 손상 id는 뷰어만 안다.
      const { damageId } = message as { damageId?: unknown };
      const replyOk = (filename: string) =>
        inject('mangdoPhotoResult', { requestId, ok: true, filename, uploaded: false });
      const replyFail = (reason: string) => inject('mangdoPhotoResult', { requestId, ok: false, reason });

      // 겹친 요청(앞 촬영이 끝나기 전에 속성창을 닫았다 다시 열고 또 누른 경우)은 삼키지 않고
      // 바로 답한다 — 뷰어가 새 requestId로 기다리고 있어 답이 없으면 버튼이 ⏳로 남는다.
      if (photoBusyRef.current) {
        replyFail('이미 촬영 중입니다');
        return;
      }
      photoBusyRef.current = true;
      takePhotoAndSave()
        .then((result) => {
          if (!result.ok) {
            replyFail(result.reason);
            return;
          }
          // 1. 먼저 답한다 — 사용자는 전송을 기다리지 않는다(설계 4.1). 뷰어가 번호를 칸에 붙인다.
          replyOk(result.filename);
          if (typeof damageId !== 'string' || result.uploadUri === null) {
            // 손상 id가 없거나(PC 브라우저에서 띄운 옛 뷰어) 사본을 못 만들었으면 앨범 저장까지가 끝이다.
            inject('mangdoPhotoUploadFailed', {
              requestId,
              damageId: typeof damageId === 'string' ? damageId : '',
              reason: '서버로 보낼 사본을 만들지 못했습니다',
              willRetry: false,
            });
            return;
          }
          // 2. 대기열에 넣고 바로 한 번 보낸다. 실패하면 대기열에 남아 60초마다 다시 시도한다.
          const item = enqueuePhoto({
            drawingId: drawing.id,
            damageId,
            filename: result.filename,
            uploadUri: result.uploadUri,
          });
          photoRequestRef.current = { itemId: item.id, requestId };
          flushPhotos();
        })
        .catch((err: unknown) => {
          // takePhotoAndSave는 내부에서 모든 실패를 이미 잡아 { ok:false } 로 돌려주지만, 만약
          // 그 밖의 예외가 새어 나와도 여기서 던지지 않고 같은 형식으로 회신한다.
          replyFail(`사진을 저장하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          photoBusyRef.current = false;
        });
    }
```

`handleMessage`가 `drawing.id`를 쓰므로 의존성 배열을 `[drawing.id, flushPhotos, inject]`로 한다.

화면에 있는 동안의 재시도를 더한다(`useEffect(() => clearPendingFlush, …)` 아래):

```ts
// 화면이 열릴 때 한 번, 그 뒤 60초마다 보내지 못한 사진을 다시 보낸다(설계 4.4).
useEffect(() => {
  flushPhotos();
  const timer = setInterval(flushPhotos, PHOTO_FLUSH_INTERVAL_MS);
  return () => clearInterval(timer);
}, [flushPhotos]);
```

- [ ] **Step 4: `DrawingListScreen.tsx`에 배지를 더한다**

import에 더한다:

```ts
import { flushPhotoQueue, pendingPhotoCount, retryPendingPhotos } from '../photoUpload';
```

상태와 갱신을 더한다:

```ts
const [pendingPhotos, setPendingPhotos] = useState(0);
```

`load`를 고친다(목록을 새로 읽을 때마다 숫자도 다시 센다):

```ts
const load = useCallback(async () => {
  setPendingPhotos(pendingPhotoCount());
  try {
    setDrawings(await fetchDrawings());
    setError(null);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}, []);
```

배지를 누르면 되돌리고 보낸 뒤 숫자를 다시 센다:

```ts
const retryPhotos = useCallback(async () => {
  retryPendingPhotos();
  setPendingPhotos(pendingPhotoCount());
  await flushPhotoQueue(() => undefined);
  setPendingPhotos(pendingPhotoCount());
}, []);
```

제목 아래(`{error && …}` 위)에 넣는다:

```ts
{pendingPhotos > 0 && (
  <Pressable onPress={retryPhotos}>
    <Text style={styles.photoBanner}>보내지 못한 사진 {pendingPhotos}장 — 눌러서 다시 시도</Text>
  </Pressable>
)}
```

`styles`에 한 줄을 더한다:

```ts
photoBanner: { color: '#fff', backgroundColor: '#ef6c00', padding: 12, borderRadius: 8, marginBottom: 12 },
```

- [ ] **Step 5: 타입과 읽기로 확인한다**

Run: `npx tsc --noEmit`
Expected: 오류 없음. 특히 `PhotoResult`에 `uploadUri`를 더했으므로 `ViewerScreen`에서 쓰는 자리가 전부 맞아야 한다.

Run: `npm --prefix server test` → 그대로 PASS(서버는 건드리지 않았다)

읽어서 확인할 것(테스트가 못 잡는 부분):
- `takePhoto` 가지가 **모든 경로에서 정확히 한 번** 답한다(성공·실패·겹친 요청).
- `flushPhotos`가 `setInterval`에 걸려 있고 화면을 벗어날 때 `clearInterval`된다.
- `photoBusyRef`가 `finally`에서 반드시 풀린다.

- [ ] **Step 6: 커밋**

```bash
git add src/photoUpload.ts src/photo.ts src/screens/ViewerScreen.tsx src/screens/DrawingListScreen.tsx
git commit -m "$(cat <<'MSG'
찍은 사진을 서버로 보내고, 못 보내면 대기열에 담아 다시 시도한다

찍으면 앨범에 저장하고 뷰어에 먼저 답한 뒤 서버로 보낸다. 문서 폴더에 보관 사본을 두어
앨범을 지워도 다시 보낼 수 있다. 뷰어 화면에 들어올 때·찍은 직후·60초마다 다시 보내고,
서버가 400·404·413을 주면 대기열에서 뺀다. 목록 화면에 보내지 못한 사진 수를 알린다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** 실기기에서 📷로 찍으면 번호가 칸에 붙고, 잠시 뒤 서버 폴더에 파일이 생긴다. 서버를 끈 채 찍으면 목록 화면에 `보내지 못한 사진 1장`이 뜨고, 서버를 켜고 뷰어를 다시 열면 올라간다. (썸네일은 Task 6에서 보인다.)

---

## Task 6: 뷰어 — 썸네일과 크게 보기

**Files:**
- Create: `server/public/viewer/photoStrip.js`
- Modify: `server/public/viewer.html` (속성창 사진번호 줄 아래 `#photoStrip`, `#coordPanel` 위 `#photoView`)
- Modify: `server/public/viewer/main.js`
- Modify: `server/public/viewer/viewer.css`
- Test: `server/test/photoStrip.test.ts` (생성)

**Interfaces:**
- Consumes: Task 1의 `comparePhotoNumbers`, Task 2의 `GET …/photos`(목록)·`GET …/photos/:number`(파일), Task 5가 주입하는 `mangdoPhotoUploaded`·`mangdoPhotoUploadFailed`, 기존 `api`·`parsePhotoNumbers`·`isPropsOpen`·`showPropsError`·`postToApp`·`selectedDamage`
- Produces:
  - `photoStripItems(photoNumbers: string[], list: PhotoListItem[]): PhotoStripItem[]`
  - `blocksDrawing(propsOpen: boolean, photoViewOpen: boolean): boolean`
  - `takePhoto` 메시지가 `{ type, requestId, drawingId, damageId }`가 된다

- [ ] **Step 1: 순수 규칙의 실패하는 테스트를 쓴다**

`server/test/photoStrip.test.ts` 생성.

```ts
import { describe, expect, it } from 'vitest';
import { blocksDrawing, photoStripItems } from '../public/viewer/photoStrip.js';

function photo(number: string) {
  return { number, url: `/api/x/photos/${number}`, size: 10, savedAt: '2026-09-18T01:00:00.000Z' };
}

describe('photoStripItems', () => {
  it('서버에 있는 사진은 번호 순서대로 그림, 칸에만 있는 번호는 칩', () => {
    const items = photoStripItems(['101530', '101600', '999'], [photo('101600'), photo('101530')]);
    expect(items).toEqual([
      { kind: 'image', number: '101530', url: '/api/x/photos/101530' },
      { kind: 'image', number: '101600', url: '/api/x/photos/101600' },
      { kind: 'missing', number: '999' },
    ]);
  });

  it('번호 순서는 값 기준이다 (9가 101530보다 앞)', () => {
    expect(photoStripItems([], [photo('101530'), photo('9')]).map((item) => item.number)).toEqual(['9', '101530']);
  });

  it('칸에 없는 파일도 보여준다 (칸에서 번호를 지운 사진)', () => {
    expect(photoStripItems([], [photo('777')])).toEqual([
      { kind: 'image', number: '777', url: '/api/x/photos/777' },
    ]);
  });

  it('칩 순서는 칸에 적힌 순서를 지킨다', () => {
    expect(photoStripItems(['22', '11'], []).map((item) => item.number)).toEqual(['22', '11']);
  });

  it('둘 다 비면 빈 배열, 입력이 배열이 아니어도 던지지 않는다', () => {
    expect(photoStripItems([], [])).toEqual([]);
    // @ts-expect-error 일부러 잘못된 입력을 넣는다 (목록 요청이 실패했을 때)
    expect(photoStripItems(null, null)).toEqual([]);
  });
});

describe('blocksDrawing', () => {
  it('속성창이나 사진 오버레이가 열려 있으면 도면 입력을 막는다', () => {
    expect(blocksDrawing(false, false)).toBe(false);
    expect(blocksDrawing(true, false)).toBe(true);
    expect(blocksDrawing(false, true)).toBe(true);
    expect(blocksDrawing(true, true)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- photoStrip`
Expected: FAIL — `Cannot find module '../public/viewer/photoStrip.js'`

- [ ] **Step 3: `server/public/viewer/photoStrip.js`를 만든다**

```js
// 속성창 사진 줄의 순수 규칙. DOM을 건드리지 않으므로 vitest가 그대로 검사한다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 5장

import { comparePhotoNumbers } from './quantities.js';

/**
 * @typedef {{ number: string, url: string, size: number, savedAt: string }} PhotoListItem
 * 서버 목록(GET …/photos)의 한 줄.
 * @typedef {{ kind: 'image', number: string, url: string } | { kind: 'missing', number: string }} PhotoStripItem
 */

/**
 * 사진 줄에 무엇을 그릴지 정한다.
 * - 서버에 파일이 있는 사진은 모두 썸네일(`image`)이다 — 번호 오름차순. 사진번호 칸에서 번호를
 *   지운 사진도 폴더에는 남아 있으므로 함께 보여준다(그렇지 않으면 사용자가 그 사진을 볼 길이 없다).
 * - 사진번호 칸에 있는데 파일이 없는 번호는 회색 칩(`missing`)이다 — 칸에 적힌 순서를 지킨다.
 *   앱이 올리기 전이거나 다른 사람이 손으로 적은 번호다.
 * @param {string[]} photoNumbers
 * @param {PhotoListItem[]} list
 * @returns {PhotoStripItem[]}
 */
export function photoStripItems(photoNumbers, list) {
  const numbers = Array.isArray(photoNumbers) ? photoNumbers : [];
  const photos = Array.isArray(list) ? list : [];
  const items = photos
    .slice()
    .sort((a, b) => comparePhotoNumbers(a.number, b.number))
    .map((photo) => ({ kind: 'image', number: photo.number, url: photo.url }));
  const onServer = new Set(photos.map((photo) => photo.number));
  for (const number of numbers) {
    if (!onServer.has(number)) items.push({ kind: 'missing', number });
  }
  return items;
}

/**
 * 도면 입력(그리기·탭)을 막아야 하는지. 속성창과 같은 가드에 사진 오버레이를 넣는다 —
 * 오버레이가 도면을 덮고 있는 동안 손가락이 새 손상을 만들면 안 된다(설계 5장).
 * @param {boolean} propsOpen
 * @param {boolean} photoViewOpen
 * @returns {boolean}
 */
export function blocksDrawing(propsOpen, photoViewOpen) {
  return propsOpen === true || photoViewOpen === true;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm --prefix server test -- photoStrip` → PASS
Run: `node --check server/public/viewer/photoStrip.js` → 조용히 끝난다

- [ ] **Step 5: `server/public/viewer.html`에 자리를 만든다**

사진번호 줄(35행) **바로 아래**에 넣는다:

```html
      <div id="photoStrip" hidden></div>
```

`<div id="coordPanel" hidden></div>` **위**에 넣는다(속성창 밖이다 — 화면 전체를 덮는다):

```html
    <div id="photoView" hidden><img id="photoViewImage" alt="" /></div>
```

- [ ] **Step 6: `server/public/viewer/viewer.css`에 모양을 더한다**

`#propsPanel[hidden], #propsPanel [hidden] { display: none; }` 아래에 넣는다:

```css
/* 사진 줄: 썸네일을 가로로 나열하고 넘치면 옆으로 넘긴다(설계 5장, 높이 56px). */
#photoStrip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin: 0 0 8px;
  padding-bottom: 2px;
}
.photoThumb {
  height: 56px;
  width: auto;
  border-radius: 4px;
  background: #eceef1;
  flex: none;
}
.photoChip {
  flex: none;
  align-self: center;
  padding: 3px 6px;
  border-radius: 4px;
  background: #eceef1;
  color: #8a8f98;
  font-size: 12px;
  white-space: nowrap;
}

/* 사진 크게 보기: 화면 전체를 덮고 어디든 누르면 닫힌다. z-index는 속성창(12)보다 위. */
#photoView {
  position: absolute;
  inset: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  padding: 12px;
}
#photoView img {
  max-width: 100%;
  max-height: 100%;
}
```

`#toolbar[hidden], … #error[hidden] { display: none; }` 목록에 `#photoView[hidden],` 한 줄을 더한다(`#photoStrip`은 `#propsPanel [hidden]` 규칙이 이미 덮는다).

- [ ] **Step 7: `main.js`를 고친다**

(1) import에 더한다:

```js
import { photoStripItems, blocksDrawing } from './photoStrip.js';
```

(2) 사진 줄을 그리는 부분을 `showPropsError` 아래에 넣는다:

```js
  // 사진 썸네일 ────────────────────────────────────────────────────────────
  // 사진 API도 x-access-key 헤더를 요구하는데 <img src>에는 헤더를 붙일 수 없다. 그래서 fetch로
  // 받아 blob: 주소를 만들어 쓰고, 다시 그릴 때·닫을 때 거둔다(안 거두면 사진만큼 메모리가 쌓인다).
  // 썸네일은 원본을 CSS로 줄여 보인다 — 서버 축소본은 후속이다(설계 9장).
  let photoObjectUrls = [];
  // 지금 사진 줄이 보여주는 손상. 늦게 도착한 목록 응답과 전송 알림을 가려내는 데 쓴다.
  let photoStripDamageId = null;

  function revokePhotoUrls() {
    for (const url of photoObjectUrls) URL.revokeObjectURL(url);
    photoObjectUrls = [];
  }

  async function loadPhotoBlobUrl(url) {
    const res = await fetch(url, { headers: { 'x-access-key': accessKey } });
    if (!res.ok) throw new Error(`사진을 불러오지 못했습니다 (${res.status})`);
    const objectUrl = URL.createObjectURL(await res.blob());
    photoObjectUrls.push(objectUrl);
    return objectUrl;
  }

  function closePhotoStrip() {
    photoStripDamageId = null;
    // 오버레이가 보여주는 blob 주소는 사진 줄이 만든 것이다. 거두기 전에 먼저 닫는다 —
    // 안 그러면 사진이 사라진 빈 검은 화면이 남는다.
    closePhotoView();
    revokePhotoUrls();
    $('photoStrip').replaceChildren();
    $('photoStrip').hidden = true;
  }

  function chip(text) {
    const span = document.createElement('span');
    span.className = 'photoChip';
    span.textContent = text;
    return span;
  }

  async function refreshPhotoStrip(damageId) {
    const strip = $('photoStrip');
    closePhotoStrip();
    photoStripDamageId = damageId;
    let list = [];
    try {
      list = await api(`/drawings/${drawingId}/damages/${damageId}/photos`);
    } catch (err) {
      // 목록을 못 읽어도 속성창은 그대로 쓴다 — 사진번호 글자는 이미 칸에 있다.
      console.error('[photos]', damageId, err);
      return;
    }
    // 기다리는 동안 다른 손상을 열었거나 창을 닫았으면 버린다.
    if (photoStripDamageId !== damageId) return;
    const items = photoStripItems(parsePhotoNumbers($('photoInput').value), list);
    if (items.length === 0) return;
    for (const item of items) {
      if (item.kind === 'missing') {
        strip.append(chip(`${item.number} (서버에 없음)`));
        continue;
      }
      const img = document.createElement('img');
      img.className = 'photoThumb';
      img.alt = `사진 ${item.number}`;
      img.addEventListener('click', () => {
        // 썸네일에 이미 원본이 들어 있다(CSS로 줄여 보일 뿐) — 다시 받지 않는다.
        if (img.src) openPhotoView(img.src, item.number);
      });
      strip.append(img);
      loadPhotoBlobUrl(item.url).then(
        (objectUrl) => {
          img.src = objectUrl;
        },
        (err) => {
          console.error('[photos]', item.number, err);
          img.replaceWith(chip(`${item.number} (읽기 실패)`));
        },
      );
    }
    strip.hidden = false;
  }

  function openPhotoView(objectUrl, number) {
    $('photoViewImage').src = objectUrl;
    $('photoViewImage').alt = `사진 ${number}`;
    $('photoView').hidden = false;
  }

  function closePhotoView() {
    $('photoView').hidden = true;
    // blob: 주소는 사진 줄이 갖고 있으므로 여기서 거두지 않는다 — src만 뗀다.
    $('photoViewImage').removeAttribute('src');
  }

  function isPhotoViewOpen() {
    return !$('photoView').hidden;
  }

  $('photoView').addEventListener('click', closePhotoView);
```

(3) 속성창을 열 때 사진 줄을 읽는다 — `openProps` 맨 끝(`$('propsPanel').hidden = false;` 위)에 넣는다:

```js
    // 사진 줄은 서버에 물어봐야 하므로 기다리지 않고 채운다 — 속성창은 바로 열린다.
    void refreshPhotoStrip(damage.id);
```

(4) 선택이 바뀌거나 창을 닫으면 사진 줄을 접는다.

`setSelection` 안의 `$('propsPanel').hidden = true;` 아래에 넣는다(`closePhotoStrip`은 아래에서 정의되지만 이 함수는 초기화가 끝난 뒤에만 불린다 — `resetPhotoButton`과 같다):

```js
    closePhotoStrip();
```

`$('propsClose')` 처리기를 바꾼다:

```js
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
    closePhotoStrip();
  });
```

`$('propsSave')` 처리기의 `$('propsPanel').hidden = true;` 아래에도 같은 줄을 넣는다:

```js
    closePhotoStrip();
```

(5) 도면 입력 가드에 오버레이를 넣는다. `createCrackInput({ … })` 인자의 `isPropsOpen,` 줄을 바꾼다:

```js
    // 사진 오버레이가 열린 동안도 그리기·탭을 막는다(설계 5장). 판정은 순수 함수가 갖는다.
    isPropsOpen: () => blocksDrawing(isPropsOpen(), isPhotoViewOpen()),
```

(6) 📷 메시지에 도면·손상 id를 싣는다. `$('photoCamera')` 처리기를 바꾼다:

```js
  $('photoCamera').addEventListener('click', () => {
    // PC 브라우저 등 앱 밖에서 열었을 때는 ReactNativeWebView가 없다 — 앱에 보내지 않고 바로 알린다.
    if (!window.ReactNativeWebView) {
      showPropsError('이 환경에서는 카메라를 쓸 수 없습니다');
      return;
    }
    const damage = selectedDamage();
    if (!damage) return;
    const requestId = crypto.randomUUID();
    photoRequestId = requestId;
    $('photoCamera').disabled = true;
    $('photoCamera').textContent = '⏳';
    // 앱이 사진을 어느 손상 폴더에 넣을지는 뷰어만 안다(2026-09-18 설계 4장).
    postToApp({ type: 'takePhoto', requestId, drawingId, damageId: damage.id });
  });
```

(7) 전송 결과 처리기를 `window.mangdoPhotoResult` 아래에 더한다:

```js
  // 앱이 서버 전송을 마쳤을 때(설계 4.2). 지금 사진 줄이 보여주는 손상이면 목록을 다시 읽는다.
  // requestId는 보기용이다 — 대기열에 남아 있던 옛 항목은 null로 온다.
  window.mangdoPhotoUploaded = (result) => {
    if (!result || result.damageId !== photoStripDamageId) return;
    void refreshPhotoStrip(result.damageId);
  };

  window.mangdoPhotoUploadFailed = (result) => {
    if (!result || !isPropsOpen() || result.damageId !== photoStripDamageId) return;
    const message =
      result.willRetry === false
        ? `사진은 앨범에 저장됐지만 서버가 받지 않았습니다 (${result.reason})`
        : `사진은 앨범에 저장됐고 서버 전송은 다시 시도합니다 (${result.reason})`;
    showPropsError(message);
  };
```

또한 `window.mangdoPhotoResult`가 번호를 칸에 붙인 뒤 칩이 바로 보이도록 한 줄을 더한다(`updateSummary();` 아래):

```js
      // 방금 붙인 번호는 아직 서버에 없다 — 칩으로 보인다. 전송이 끝나면 mangdoPhotoUploaded가
      // 다시 읽어 썸네일로 바뀐다.
      const shown = selectedDamage();
      if (shown) void refreshPhotoStrip(shown.id);
```

- [ ] **Step 8: 문법과 읽기로 확인한다**

```bash
node --check server/public/viewer/main.js
node --check server/public/viewer/photoStrip.js
npm --prefix server test
```
Expected: 모두 조용히/PASS.

읽어서 확인할 것:
- `closePhotoStrip`이 `setSelection`·`propsClose`·`propsSave`·`refreshPhotoStrip` 시작에서 모두 불려 blob 주소가 쌓이지 않는다.
- `refreshPhotoStrip`이 `photoStripDamageId`를 비교해 늦게 온 응답을 버린다.
- `#photoView`를 누르면 닫히고, 열려 있는 동안 `blocksDrawing`이 true다.

- [ ] **Step 9: 커밋**

```bash
git add server/public/viewer/photoStrip.js server/public/viewer/main.js server/public/viewer.html server/public/viewer/viewer.css server/test/photoStrip.test.ts
git commit -m "$(cat <<'MSG'
속성창에서 그 손상의 사진을 썸네일로 보고 눌러 크게 본다

사진번호 줄 아래에 썸네일을 나열하고, 칸에 있는데 서버에 없는 번호는 회색 칩으로 보여준다.
썸네일을 누르면 화면 전체로 커지고 어디든 누르면 닫힌다 — 열린 동안은 그리기·탭을 막는다.
📷 메시지에 도면·손상 id를 실어 앱이 어느 폴더에 넣을지 알게 한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** 실기기에서 📷로 찍으면 번호가 칸에 붙고 잠시 뒤 썸네일이 뜬다. PC 브라우저에서도 썸네일을 보고 크게 볼 수 있다(📷는 안내만).

---

## Task 7: PC 업로드 페이지의 사진 zip과 문서

**Files:**
- Modify: `server/public/upload.html` (표 머리글에 `사진` 열)
- Modify: `server/public/upload.js` (`renderRows`에 버튼, `downloadPhotos` 추가)
- Modify: `README.md` (사용 절차의 📷 항목, 사진 zip, 문제 해결 표)
- Modify: `docs/DXF산출-테스트-결과.md` (**표 맨 끝에 행만 추가**)
- Modify: `docs/superpowers/specs/2026-09-17-photo-capture-design.md` (맨 위에 안내 한 덩이)

**Interfaces:**
- Consumes: Task 3의 `GET /api/drawings/:id/photos.zip`, 기존 `download(path, fallbackName)`·`showMessage`·`renderRows`
- Produces: 없음(마지막 Task)

- [ ] **Step 1: 표에 열을 더한다**

`server/public/upload.html` 55행의 머리글 줄을 바꾼다:

```html
            <tr><th>도면</th><th>상태</th><th>진행률</th><th>업로드 시각</th><th>산출</th><th>사진</th><th></th></tr>
```

- [ ] **Step 2: `server/public/upload.js`에 버튼과 내려받기를 더한다**

`renderRows`의 `tr.append(exportTd);` **아래**에 넣는다:

```js
    // 사진 zip은 DWG로 올린 도면에서도 된다 — 사진은 도면 파일 형식과 상관이 없다.
    const photoTd = document.createElement('td');
    const photoButton = document.createElement('button');
    photoButton.type = 'button';
    photoButton.textContent = '사진 zip';
    photoButton.addEventListener('click', () => downloadPhotos(drawing, photoButton));
    photoTd.append(photoButton);
    tr.append(photoTd);
```

`exportDxf` 아래에 넣는다:

```js
// 사진이 없으면 서버가 400과 '저장된 사진이 없습니다'를 주고, download가 그 문구로 던진다 —
// 여기서는 그대로 보여준다(다른 오류도 같다).
async function downloadPhotos(drawing, button) {
  button.disabled = true;
  showMessage('사진을 모으는 중…');
  try {
    const result = await download(`/drawings/${drawing.id}/photos.zip`, '사진.zip');
    showMessage(`내려받았습니다: ${result.name}`);
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    button.disabled = false;
  }
}
```

- [ ] **Step 3: 문법을 확인하고 눈으로 본다**

```bash
node --check server/public/upload.js
npm run server
```
브라우저에서 `http://localhost:3000/upload.html`을 열어 도면 줄에 `사진 zip` 버튼이 보이는지, 사진이 없는 도면에서 누르면 `저장된 사진이 없습니다`가 뜨는지 본다.

- [ ] **Step 4: README를 고친다**

`## 사용` 3번의 📷 항목(현재 "**기기 앨범에 저장됩니다(서버에는 올리지 않습니다)**"로 시작하는 줄)을 아래로 바꾼다:

```markdown
   - 사진번호 칸 옆 **📷** 버튼을 누르면 카메라가 열리고, 찍은 사진은 **기기 앨범에 저장되는 동시에 서버에도 올라가** 그 손상에 붙습니다. 저장된 사진의 번호가 사진번호 칸에 자동으로 이어 붙습니다 — 아이폰/아이패드는 앨범 파일명의 `IMG_` 뒤 숫자, 안드로이드(갤럭시탭)는 `_` 뒤 6자리(찍은 시각)가 번호입니다. **이 기능을 쓰려면 앱을 완전히 껐다 켜야 합니다**(새 네이티브 모듈이 추가되었습니다 — Expo Go는 다시 열기만 하면 됩니다)
   - 올라간 사진은 사진번호 줄 아래에 **썸네일**로 보이고, 누르면 화면 전체로 커집니다(아무 곳이나 누르면 닫힘). 칸에 번호는 있는데 서버에 파일이 없으면 `101530 (서버에 없음)` 회색 칩으로 보입니다 — 아직 올라가는 중이거나 손으로 적은 번호입니다
   - 서버가 꺼져 있거나 전파가 없으면 사진은 앨범에 저장되고 `서버 전송은 다시 시도합니다` 안내가 뜹니다. 도면 목록 화면 위쪽에 `보내지 못한 사진 N장`이 보이며, 뷰어 화면에 들어오면 자동으로(그리고 60초마다) 다시 보냅니다. 배지를 누르면 즉시 다시 시도합니다. 사진은 앨범을 지워도 앱 안에 사본이 남아 있어 다시 보낼 수 있습니다
```

5번(내려받기) 항목 마지막에 한 줄을 더한다:

```markdown
   - 그 도면의 사진은 같은 줄의 **사진 zip**으로 한 번에 받습니다. 파일 이름은 `<도면이름>_사진.zip`이고, 안의 사진은 `<손상번호>_<손상현황>_<사진번호>.jpg`입니다(예: `1_균열(0.3mm미만)_101530.jpg`). 손상번호는 산출 DXF의 번호와 같습니다 — 망도틀마다 1번부터입니다
```

`### DXF 내려받기가 안 될 때` 아래 두 표 뒤에 새 절을 더한다:

```markdown
### 사진이 안 올라갈 때 / 사진 zip이 안 될 때

| 메시지 | 뜻 |
|---|---|
| `사진은 앨범에 저장됐고 서버 전송은 다시 시도합니다` | 서버에 닿지 못했습니다(서버 꺼짐·터널 끊김·전파 없음). 사진은 앨범과 앱 안에 남아 있고, 뷰어 화면에 있는 동안 60초마다 다시 보냅니다 |
| `사진은 앨범에 저장됐지만 서버가 받지 않았습니다` | 서버가 거절했습니다(형식·번호·크기). 다시 보내도 같으므로 대기열에서 뺐습니다. 아래 문구를 함께 보세요 |
| `JPEG·PNG·HEIC 사진만 올릴 수 있습니다` | 카메라가 다른 형식으로 저장했습니다. 카메라 앱 설정을 확인하세요 |
| `사진 파일 이름에서 사진번호를 찾을 수 없습니다` / `사진번호에 쓸 수 없는 글자가 있습니다` | 앨범 파일명이 우리 규칙(`IMG_숫자` 또는 `날짜_시각`)과 너무 달라 번호를 만들 수 없습니다 |
| `사진이 20MB를 넘습니다` | 한 장의 상한입니다. 카메라 화질을 낮추세요 |
| `저장된 사진이 없습니다` | 그 도면에 올라간 사진이 하나도 없습니다(사진 zip) |
| 목록 화면 배지가 사라지지 않는다 | 10번까지 실패한 사진입니다. 서버를 켠 뒤 **배지를 눌러** 다시 시도하세요 |
```

`보내지 못한 사진 N장` 배지와 사진 zip은 서버 폴더 `server/data/photos/<도면id>/<손상id>/`에 그대로 쌓입니다 — 이 폴더는 커밋되지 않습니다.

- [ ] **Step 5: 캐드 확인표에 행을 더한다**

`docs/DXF산출-테스트-결과.md`에서 **51번 행 바로 아래**(`## 라벨 겹침 어림값` 제목 **위**)에 다섯 줄만 넣는다. 다른 줄은 한 글자도 고치지 않는다.

```markdown
| 52 | 📷로 찍은 사진이 앨범에 남고, 잠시 뒤 속성창에 **썸네일**로 뜬다 | | |
| 53 | 썸네일을 누르면 화면 전체로 커지고, 열려 있는 동안 도면에 새 손상이 그려지지 않는다 | | |
| 54 | 서버를 끈 채 찍으면 앨범엔 저장되고 안내가 뜨며, 서버를 켜고 뷰어를 다시 열면 올라간다(목록 화면 배지가 사라진다) | | |
| 55 | PC의 `사진 zip` 안 이름이 `1_균열(0.3mm미만)_101530.jpg` 형식이고, 앞 번호가 산출 DXF의 번호와 같다(틀마다 1번부터) | | |
| 56 | 아이패드 HEIC 사진이 썸네일·크게 보기에서 보인다 (안 보이면 후속: 서버 변환) | | |
```

- [ ] **Step 6: 앞선 설계에 안내를 남긴다**

`docs/superpowers/specs/2026-09-17-photo-capture-design.md`의 `- 상태: 설계 승인됨…` 줄 **아래**에 넣는다:

```markdown
> **2026-09-18 이후:** 찍은 사진은 앨범에 남는 동시에 **서버에도 올라간다** —
> `2026-09-18-photo-upload-design.md`가 잇는다. 이 문서 1장·5장의 "사진 파일을 서버에
> 보관하는 것은 이번 범위 밖"은 그 설계로 대체됐다. 번호 규칙(3장)과 메시지 통로(4장)는
> 그대로 유효하며, `takePhoto` 메시지에 `drawingId`·`damageId`가 더해지고 앱→뷰어
> 회신에 `uploaded: false`·`mangdoPhotoUploaded`·`mangdoPhotoUploadFailed`가 늘었다.
```

- [ ] **Step 7: 전체 검증**

```bash
npm --prefix server test
npm --prefix server run typecheck
npx tsc --noEmit
node --check server/public/viewer/main.js
node --check server/public/viewer/photoStrip.js
node --check server/public/viewer/quantities.js
node --check server/public/upload.js
```
Expected: 전부 통과. 문서만 고친 Step이 많으니 앞 Task의 결과가 그대로여야 한다.

- [ ] **Step 8: 커밋**

```bash
git add server/public/upload.html server/public/upload.js README.md docs/DXF산출-테스트-결과.md docs/superpowers/specs/2026-09-17-photo-capture-design.md
git commit -m "$(cat <<'MSG'
PC에서 도면 사진을 zip으로 받고, 문서에 사진 보관을 반영한다

업로드 페이지 도면 줄에 사진 zip 버튼을 더한다. README의 📷 설명을 서버 보관·썸네일·재시도로
고치고 사진 관련 메시지 표를 더한다. 캐드 확인표에 52~56번(썸네일, 크게 보기 가드, 서버 꺼짐
재시도, zip 이름, HEIC)을 더하고 2026-09-17 설계에 안내 줄을 남긴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** 사용자가 PC에서 사진 zip을 받고, 무엇을 실기기에서 확인해야 하는지 확인표로 알 수 있다.

---

## 검증 명령 모음

작업 중 언제든 아래를 돌린다.

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit (서버 + 테스트가 가져온 src/photoQueue.ts)
npx tsc --noEmit                  # 앱(src/**, App.tsx)
node --check server/public/viewer/main.js
node --check server/public/viewer/photoStrip.js
node --check server/public/viewer/quantities.js
node --check server/public/upload.js
```

한 Task만 빨리 보고 싶으면 `npm --prefix server test -- photosStore`처럼 파일 이름 조각을 붙인다.

실기기·PC 확인은 Task 7의 확인표(`docs/DXF산출-테스트-결과.md` 52~56번)로 사용자와 함께 본다.
**핵심은 서버를 끈 채 사진을 찍어 보는 것이다** — 앨범에는 남고, 목록 화면에 `보내지 못한 사진 1장`이
뜨고, 서버를 켜고 뷰어를 다시 열면 저절로 올라가 썸네일이 보여야 한다(설계 8장).

## 손으로 계산한 값 (테스트 리터럴의 출처)

| 값 | 출처 |
|---|---|
| `photoNumberFromFilename('20260918_101530.jpg')` = `'101530'` | 규칙 2: `\d{8}_(\d{6})`의 뒤 6자리 (2026-09-17 설계 3장) |
| `photoNumberFromFilename('IMG_0021.HEIC')` = `'0021'` | 규칙 1: `IMG_` 뒤 숫자, 앞자리 0 유지 |
| `photoNumberFromFilename('IMG_0007.jpg')` = `'0007'` | 규칙 1 |
| `photoNumberFromFilename('.jpg')` = `''` | 규칙 3에서 확장자를 떼면 빈 글자 → 업로드 400 |
| `photoNumberFromFilename('사진 1.jpg')` = `'사진 1'` | 규칙 3 그대로. 한글·공백이라 `isPhotoNumber` 실패 → 400 |
| `statusTextOf`(crack, width 0.2) = `'균열(0.3mm미만)'` | `quantities.js` 154행, 경계 `CRACK_WIDTH_BREAKS[0]` = 0.3 |
| `statusTextOf`(crack_efflorescence, width 0.6) = `'균열/백태(0.5mm이상)'` | 경계 0.5 + 라벨 `균열/백태`(`damageTypes.js` 45행) |
| zip 이름 정리 후 `'균열_백태(0.5mm이상)'` | `/`를 그대로 두면 zip 안에 폴더가 생긴다 → `_` |
| 번호 `1`·`2`(frames 없음) | world 중심 x가 0.5와 10.5 → 왼쪽이 앞번호(설계 3.1) |
| 번호 `1`·`1`(틀 두 개) | dwg 중심 (0.5, 0)은 틀 0, (10.5, 0)은 틀 1 → 틀마다 1번부터 |
| 번호 자리 `X` | 틀이 `(-5,-5)~(5,5)` 하나뿐이면 dwg 중심 10.5는 틀 밖 → `computeNumbers` Map에 없다 |
| `미연결_11111111_777.png` | `damageId`의 앞 8자 = `11111111` |
| `삭제된손상_33333333_88.jpg` | 같은 규칙. 손상 기록에 없는 폴더 |
| `retryDelayMs(1)` = 60000, `(3)` = 180000, `(10)` = 600000 | `min(60_000 × tries, 600_000)` |
| `comparePhotoNumbers` 정렬 `['9','88','101530']` | 숫자끼리는 값으로 비교 |
| `['0021','21']` 순서 | 값이 같으면 글자로 비교(`'0'` < `'2'`) |
| zip 첫 4바이트 `50 4B 03 04` | zip 지역 파일 머리글 서명(`PK\x03\x04`) |
| 20MB = `20 * 1024 * 1024` = 20971520 | 스펙 2장 |

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 1장 앨범 + 서버 양쪽에 남는다 | 5 |
| 1장 속성창 썸네일·크게 보기 | 6 |
| 1장 PC에서 사진 zip | 3(서버) · 7(버튼) |
| 1장 범위 밖(앨범에서 고르기, 삭제·교체, 보고서, DXF에 사진) | — (하지 않는다) |
| 2장 폴더 `photos/<도면>/<손상>/<사진번호>` | 1 |
| 2장 사진번호는 `photoNumberFromFilename`으로 서버가 뽑는다 | 2 |
| 2장 손상 기록(v5) 불변 — 연결은 폴더 + `attrs.photoNumbers` | — (건드리지 않음) · 3(zip이 그렇게 읽는다) |
| 2장 같은 손상·같은 번호는 덮어쓴다 | 1(스토어) · 2(라우트 테스트) |
| 2장 20MB 상한, `image/jpeg`·`heic`·`png`만, 내용 변경 없음 | 2 |
| 3장 `POST …/photos` → 201 `{ number, url }`, 404·400·413 | 2 |
| 3장 `GET …/photos` 목록(번호 오름차순) | 1(정렬) · 2(라우트) |
| 3장 `GET …/photos/:number` 파일 + `Cache-Control: private, max-age=3600` | 2 |
| 3장 `GET …/photos.zip` 항목 이름 `<번호>_<손상현황>_<사진번호>` | 3 |
| 3장 zip의 번호는 `computeNumbers(list, frames)`, 번호 없으면 `X` | 3 |
| 3장 지운 손상 폴더는 `삭제된손상_<앞 8자>_…` | 3 |
| 3장 사진이 없으면 400 `저장된 사진이 없습니다` | 3 |
| 3장 `:damageId` UUID만, `:number` 영문·숫자·`-`·`_`만 | 1(스토어) · 2(라우트) |
| 3장 zip은 `archiver`로 스트리밍 | 3 |
| 3장 업로드는 multer 메모리 → `writeFileAtomic` | 1(쓰기) · 2(multer) |
| 4장 `takePhoto`에 `drawingId`·`damageId` | 6(보내기) · 5(받기) |
| 4.1 앨범 저장까지 성공하면 **먼저** 회신 `{ …, uploaded: false }` | 5 |
| 4.2 성공하면 `mangdoPhotoUploaded` → 썸네일 다시 읽기 | 5(주입) · 6(처리) |
| 4.2 실패하면 대기열 + `mangdoPhotoUploadFailed` 안내 | 5(주입) · 6(문구) |
| 4.3 `photo-queue.json`(문서 폴더) + 문서 폴더 보관 사본 | 5 |
| 4.4 재시도 시점(화면 진입·촬영 직후·60초), 10회 상한, 목록 배지 | 4(규칙) · 5(호출·배지) |
| 4.5 400은 대기열에서 빼고 사유를 보낸다 | 4(`drop`) · 5(판정) |
| 5장 `#photoStrip` 썸네일(56px), `openProps`에서 목록 읽기 | 6 |
| 5장 파일 없는 번호는 회색 칩 `101530 (서버에 없음)` | 6 |
| 5장 `#photoView` 오버레이, 열린 동안 그리기·탭 막기 | 6 |
| 5장 `mangdoPhotoUploaded`는 열린 손상일 때만 다시 읽는다 | 6 |
| 5장 PC 브라우저에서 📷는 안내만, 썸네일은 보인다 | 6 (기존 동작 유지 + fetch로 읽으므로 그대로 된다) |
| 6장 도면 줄에 `사진 zip` 버튼, 파일명 `<도면이름>_사진.zip` | 3(헤더) · 7(버튼) |
| 7장 사진번호 글자·라벨·물량표·산출 DXF·저장 형식(v5)·📷 규칙 불변 | — (건드리지 않음) |
| 8장 서버 단위 테스트(업로드·목록·헤더·zip 이름·id 검증) | 1 · 2 · 3 |
| 8장 뷰어 순수 부분(`photoStripItems`, 오버레이 가드) | 6 |
| 8장 대기열 규칙을 vitest가 보게 두는 자리 결정 | 4 (`src/photoQueue.ts`로 결정 — 이유는 Task 4 머리에) |
| 8장 실기기 확인 목록 | 7 (확인표 52~56) |
| 9장 zip은 `photoNumbers`에 있는 번호만 손상 이름으로, 없는 파일은 `미연결_…` | 3 |
| 9장 HEIC 썸네일이 안 보일 수 있다(서버 변환은 후속) | 7 (확인표 56번으로 사용자와 확인) |
| 9장 사진 삭제·교체 UI 없음 | — (하지 않는다) |
| 9장 사진이 디스크에 쌓인다(도면 삭제 때 함께 지운다) | — (도면 삭제 기능이 없어 이번 범위 밖) |
