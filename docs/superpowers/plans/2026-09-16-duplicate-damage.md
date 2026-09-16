# 손상 복제(nEA)와 첫 그리기 속성창 자동 열기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 손상 하나가 **도형을 여러 개** 가질 수 있게 해(첫 도형 + 복제본들) 사내 표기의 `3EA`를 도형 3개 + 속성 1개로 그릴 수 있게 하고, 손상 유형을 고른 뒤 **처음 그린 손상**에서 속성창이 저절로 열리게 한다.

**Architecture:** 저장 형식에 `copies: Array<{ world, dwg }>`를 더해 `schemaVersion`을 5로 올린다. 첫 도형은 지금 그대로 `geometry`라서 **번호·틀 배정·라벨·표 한 행은 하나도 바뀌지 않는다** — 그 규칙들은 전부 `geometry`만 본다. 도형이 여러 개라는 사실이 새어 나가는 곳은 딱 네 군데다: ① 선택이 `(손상 id, 도형 번호)`가 된다 ② 화면·DXF가 도형을 전부 그린다 ③ 라벨 겹침 장애물에 복제본 경계상자가 더해진다 ④ 개소(`measured.count`)가 도형 수로 자동으로 맞춰진다. 새 편집 연산(`duplicateShape`·`removeShape`·`updateShape`)은 전부 `damageDoc.js`의 순수 함수라 DOM 없이 node에서 테스트한다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict, `checkJs: false`), Express 5, vitest, 빌드 없는 ES 모듈 브라우저 JS(`server/public/viewer/*.js`, `allowJs: true`). 테스트는 **DOM 없이 node에서** 돌므로 새 로직은 전부 순수 함수여야 하고, `createOverlay`의 DOM 코드와 `main.js`는 읽기 + `node --check`로 확인한다. Expo 앱(`App.tsx` 등)은 이번 계획에서 **변경 없음**.

**Spec:** `docs/superpowers/specs/2026-09-16-duplicate-damage-design.md`

이 문서가 아래 한 곳을 **대체**한다:
- `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` §3(개소) — "개소는 사용자가 직접 적는 값" → 복제본이 있는 손상은 도형 수로 자동으로 맞춰진다(Task 6에서 안내 줄을 남긴다).

그대로 유효해 이 계획이 따르는 앞선 설계:
- `docs/superpowers/specs/2026-09-12-damage-types-design.md` §4 — 선택·이동·크기·회전 제스처의 우선순위
- `docs/superpowers/specs/2026-09-16-label-layout-design.md` — 라벨 모양·겹침 방지·화살표(장애물만 늘어난다)
- `docs/superpowers/specs/2026-09-16-frame-numbering-design.md` — 틀 배정·번호(첫 도형으로 정한다, 변함없음)
- `docs/superpowers/specs/2026-09-16-sheet-overflow-design.md` — 넘침 장 복사(손상 단위 이동량, 변함없음)

---

## Global Constraints

스펙과 사용자 지시에서 그대로 옮긴 구속값이다. 구현 중 판단이 갈리면 여기를 기준으로 한다. **모든 Task의 요구사항에 이 절이 암묵적으로 포함된다.**

### 작업 안전 규칙 (모든 Task에 적용)

- **`git checkout` / `git restore` / `git stash`를 절대 실행하지 않는다.** 앞선 작업에서 이 명령이 작성 중이던 문서를 통째로 날린 적이 있다. 되돌리고 싶으면 파일을 직접 고쳐라.
- `git add .` / `git add -A` / `git commit -a`를 쓰지 않는다. **파일 이름을 하나씩 적어** `git add <경로> <경로>` 로만 스테이징한다.
- `server/data/`, `.env`, `docs/*.dxf`, `docs/*.bak`는 커밋 대상이 아니다(`.gitignore`).
- 모든 커밋 메시지의 마지막 줄은 정확히 다음과 같다(글자 하나도 다르면 안 된다):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- 커밋 제목과 본문, 화면 문구는 한국어로 쓴다. 코드와 식별자는 코드의 언어(영어)로 쓴다.
- 작업 브랜치는 `feat/duplicate-damage`다(이미 체크아웃돼 있다).
- `docs/DXF산출-테스트-결과.md`는 **Task 6이 지시하는 자리 말고는 건드리지 않는다.** 그 Task에서도 **표 끝에 행만 덧붙이고**, 사용자가 손으로 적어 둔 메모(`## 발견한 문제`, `## 다음에 고칠 것` 등)는 그대로 둔다.

### 코드 규약 (기존 코드에서 그대로 이어받는다)

- TypeScript는 NodeNext다 — **상대 경로 import에 `.js` 확장자를 붙인다**(`./damageEntities.js`). 빼먹으면 `npm --prefix server run typecheck`가 바로 잡아낸다.
- 뷰어 JS(`server/public/viewer/*.js`)는 브라우저가 그대로 읽는 순수 ES 모듈이고, 서버 TS는 이를 `../../public/viewer/*.js`로 가져다 쓴다. `checkJs`는 꺼져 있지만 **TS가 소비하는 JS 내보내기에는 JSDoc `@type`/`@typedef`를 단다**(기존 `overlay.js`·`quantities.js`와 같은 방식). 타입 없이 두면 호출부에서 조용히 `any`가 된다.
- 숫자·문구를 코드에 박아 두지 않는다. 새로 생기는 상수(`DUPLICATE_OFFSET_FACTOR`)도 이름을 붙여 내보낸다.

### 데이터 (스펙 2장)

- `SCHEMA_VERSION = 5`. 손상 하나는 `geometry`(첫 도형, 그대로) + `copies: Array<{ world, dwg }>`를 갖는다. 복제본의 `kind`는 따로 두지 않는다 — **언제나 `geometry.kind`와 같다.**
- 검증: `copies`는 **배열이어야 하고**(없으면 오류), 각 항목의 `world`는 `geometry.kind`의 점 개수 규칙(사각형 4점, 선 2점 이상)을 따르며 `dwg`는 `null`이거나 `world`와 점 개수가 같다. `geometry`와 똑같은 규칙이다.
- 이행 v4 → v5: 모든 손상에 `copies: []`. 다른 값은 그대로.
- **서버를 다시 시작해야 한다.** 서버는 `server/public/viewer/damageDoc.js`를 그대로 import해 검증하므로, 켜 둔 채로 앱을 새로 고치면 `schemaVersion은 4이어야 합니다`로 저장이 막힌다(2026-09-13에 실제로 겪은 문제).
- 도형 수 `shapeCountOf(damage) = 1 + copies.length`.
- 개소 자동: **복제하거나 도형을 지울 때** `measured.count`를 그 시점의 도형 수로 맞춘다(항상). 사용자가 속성창에서 고치면 그 값이 저장되고, 다음 복제·삭제 때 다시 도형 수로 덮인다. 도형을 **옮기기만** 할 때는 건드리지 않는다.

### 호환성 (모든 Task에 적용)

- **복제본이 없는 손상(= 이행 후 `copies: []`)의 동작은 지금과 완전히 같아야 한다.** 화면 그리기·라벨 자리·DXF 엔티티·표 한 행·번호·틀 배정 전부.
- 기존 테스트는 **어떤 Task가 명시적으로 고치고 이유를 적지 않는 한 그대로 통과해야 한다.** 이 계획에서 기존 테스트를 고치는 곳은 두 종류뿐이고 각 Task가 이유를 적어 둔다:
  1. Task 1 — `schemaVersion` 리터럴 4 → 5, 이행 결과 기대값에 `copies: []` 추가.
  2. Task 3 — `pickDamage`의 반환값이 문자열에서 객체로 바뀐 데 따른 기대값 수정.
- `dimensionTextOf`(` nEA`)·`drawingNameOf`·`photoTextOf`·라벨 모양·번호 규칙·틀 인식·표 칸 매핑은 **손대지 않는다.**

### 화면 (스펙 3장)

- 속성창 자동 열기: `#damageType`에 `change` **또는** `pointerup`이 오면 "다음 새 손상에 속성창 열기" 깃발을 켠다(같은 유형을 다시 골라도 `change`가 안 나므로 `pointerup`도 본다). `onStroke`/`onRect`로 새 손상이 저장될 때 깃발이 켜져 있으면 그 손상을 선택하고 속성창을 연 뒤 **깃발을 끈다**. 꺼져 있으면 지금처럼 선택 없이 끝난다. 복제·이동·탭 선택은 깃발과 무관하다.
- 선택은 `(손상 id, 도형 번호 shapeIndex)`다. 0이 `geometry`, 1부터 `copies[i-1]`.
- 선택 표시: 선택된 손상의 **모든 도형**이 주황(`SELECTED_COLOR`), 핸들은 **선택된 도형 하나에만**(사각형일 때).
- 이동·크기·회전은 선택된 도형만 바꾼다. `computed`는 **첫 도형을 바꿨을 때만** 다시 계산한다.
- `선택 삭제`는 선택된 도형만 지운다. 첫 도형을 지우면 `copies[0]`이 새 `geometry`가 되고(라벨이 그 도형으로 옮겨간다), 마지막 남은 도형을 지우면 손상 자체가 사라진다.
- `복제` 버튼: 선택된 도형을 그 경계상자 **너비 × 1.2**만큼 오른쪽으로 옮긴 자리에 복제본으로 더하고 새 복제본을 선택한다.
- 속성창은 손상 단위다 — 어느 도형을 골라 열어도 같은 속성이다.

### 라벨 (스펙 3.4 · 4장)

- 번호 라벨은 **첫 도형 위에만** 그린다. 복제본은 도형만.
- 겹침 방지 장애물에 **복제본의 경계상자(도면 mm)를 더한다.** 화면(`overlay.computeLabelPlacements`)과 DXF(`labelPlacement.damageLabels`)가 **완전히 같은 입력**을 만들어야 한다 — 그러지 않으면 화면 라벨 자리와 산출 라벨 자리가 갈린다.
- 라벨 기준점은 여전히 첫 도형 경계상자다. 번호·틀 배정도 첫 도형으로 정한다(`computeNumbers`·`frameIndexOf` 변함없음).

### 산출 (스펙 4장)

- 손상마다 첫 도형과 복제본 **모두** 도형·해치·기호를 그린다. 라벨은 첫 도형에 한 번.
- 물량표는 한 행, 개소 = `measured.count`. 다른 열은 지금과 같다.
- 넘침 장 복사·틀 이동은 **손상 단위**로 같은 이동량을 적용한다(첫 도형이 속한 틀 기준). 복제본이 다른 틀에 걸쳐 있어도 첫 도형의 틀을 따른다.

### 검증 명령

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/viewer/damageDoc.js
node --check server/public/viewer/crackTool.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/labelCollision.js
node --check server/public/viewer/main.js
```

---

## File Structure

```
server/public/viewer/damageDoc.js      수정: SCHEMA_VERSION 5, copies 검증, v4→v5 이행,
                                             shapesOf·shapeCountOf·duplicateShape·removeShape·updateShape
server/public/viewer/crackTool.js      수정: emptyDamage에 copies: [], pickDamage가 {id, shapeIndex},
                                             offsetShape(복제본 자리 계산)
server/public/viewer/labelCollision.js 수정: placeLabels에 obstacles 옵션(라벨을 받지 않는 장애물 상자)
server/public/viewer/overlay.js        수정: describeDamageRender에 선택 도형 번호, renderDamage가
                                             도형 전부를 그림, setSelected(id, shapeIndex),
                                             computeLabelPlacements가 복제본 경계상자를 장애물로 넘김
server/public/viewer/main.js           수정: 선택 상태 (selectedId, selectedShape), 복제 버튼,
                                             선택 삭제 → removeShape, onTransform → updateShape,
                                             유형 선택 후 첫 그리기에 속성창 자동 열기
server/public/viewer.html              수정: 도구막대에 `복제` 버튼
server/src/export/damageEntities.ts    수정: dwgShapesOf(도형별 dwg 점), damageEntities가 점 목록을 받음
server/src/export/labelPlacement.ts    수정: damageLabels가 복제본 경계상자를 장애물로 넘김
server/src/export/exportDrawing.ts     수정: 손상마다 도형 전부를 그림(라벨은 한 번)

server/test/damageDoc.test.ts          수정: v5 검증·이행·새 편집 연산·되돌리기
server/test/crackTool.test.ts          수정: pickDamage 반환 모양, offsetShape, v5 문서 검증
server/test/labelCollision.test.ts     수정: obstacles 옵션
server/test/overlay.test.ts            수정: describeDamageRender 도형 번호, 복제본 장애물
server/test/labelPlacement.test.ts     수정: 복제본 장애물(화면과 같은 답)
server/test/damageEntities.test.ts     수정: dwgShapesOf, 점 목록을 받는 damageEntities
server/test/exportDrawing.test.ts      수정: 도형 3벌·라벨 1벌·표 개소 3, 넘침 복사에서 복제본도 이동
server/test/app.test.ts                수정: schemaVersion 5, 손상 픽스처에 copies: []
server/test/stores.test.ts             수정: 이행 결과 schemaVersion 5 + copies: []
README.md                              수정: 복제·속성창 자동 열기 사용법
docs/DXF산출-테스트-결과.md             수정: 확인표 44~47번 추가(표 끝에 행만)
docs/superpowers/specs/2026-09-13-damage-attributes-design.md  수정: 개소 절에 대체 안내 줄
```

**바꾸지 않는 파일(확인만):** `quantities.js`(`computeNumbers`·`frameIndexOf`·`dimensionTextOf` 전부 첫 도형만 본다), `labelLayout.js`, `tableFill.ts`, `frames.ts`, `sheetCopy.ts`, `sync.js`(문서를 통째로 다루므로 스키마를 모른다), `damagesStore.ts`(`migrateDoc`을 부르기만 한다), `viewer.css`(`#toolbar button` 규칙이 이미 있어 새 버튼에 CSS가 필요 없다).

---

## Task 1: 저장 형식 schemaVersion 5 — 복제본과 도형 단위 편집 연산

**Files:**
- Modify: `server/public/viewer/damageDoc.js`
- Modify: `server/public/viewer/crackTool.js:49-60` (`emptyDamage`에 `copies: []`)
- Test: `server/test/damageDoc.test.ts`
- Test(리터럴 수정): `server/test/crackTool.test.ts:185-216`, `server/test/app.test.ts`, `server/test/stores.test.ts`

**Interfaces:**
- Consumes: 기존 `createEditor`/`commit`/`addDamage`/`removeDamage`/`updateDamage`/`undo`, `geometry.js`의 `polygonArea(points)`·`polylineLength(points)`.
- Produces:
  - `SCHEMA_VERSION = 5`
  - `shapesOf(damage): Array<{ world: number[][], dwg: number[][] | null }>` — 0번이 `geometry`, 1번부터 `copies`
  - `shapeCountOf(damage): number`
  - `duplicateShape(editor, damageId, shape: { world, dwg }, now): Editor` — 복제본을 **맨 뒤에** 붙이고 `measured.count`를 도형 수로 맞춘다
  - `removeShape(editor, damageId, shapeIndex, now): Editor` — 0번이면 `copies[0]` 승격(+`computed` 재계산), 마지막 하나면 손상 삭제, 그 외에는 그 복제본만 제거. 남은 도형 수로 `measured.count`를 맞춘다
  - `updateShape(editor, damageId, shapeIndex, shape: { world, dwg }, now): Editor` — 그 도형의 좌표만 바꾸고, 0번일 때만 `computed`를 다시 센다

> **설계와 다른 점(의도적):** 스펙 6장은 `duplicateShape(editor, id, shapeIndex, offset)`으로 적었지만, 실제 서명은 `duplicateShape(editor, id, shape, now)`다. 복제본의 `dwg`는 뷰어의 좌표 변환기(`mapper.worldToDwg`)가 있어야 구할 수 있는데 `damageDoc.js`는 **서버도 쓰는 파일**이라 mapper를 모른다. 그래서 "어디에 놓을지"(world 이동 + dwg 재계산)는 부르는 쪽(Task 3의 `crackTool.offsetShape`)이 정하고, 이 파일은 완성된 도형을 받아 문서에 넣기만 한다. 같은 이유로 `shapeIndex`도 받지 않는다 — 어느 도형을 베꼈는지는 이미 `shape`에 녹아 있다.

- [ ] **Step 1: `copies` 검증과 v5 이행의 실패하는 테스트를 쓴다**

`server/test/damageDoc.test.ts`의 헬퍼 두 개에 `copies: []`를 더한다(이제 모든 v5 손상이 갖는 필드다. `...overrides`가 뒤에 있으므로 각 테스트에서 덮어쓸 수 있다):

```ts
function lineDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'crack',
    createdAt: T0,
    geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
    copies: [],
    measured: { width: 0.3, length: 5, count: 2 },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
    ...overrides,
  };
}
```

`areaDamage`에도 `geometry` 다음 줄에 `copies: [],`를 같은 자리에 넣는다.

그다음 `describe('validateDamageDoc')` 안에 이 테스트들을 더한다:

```ts
it('복제본은 배열이어야 하고, 없으면 오류다', () => {
  const { copies, ...withoutCopies } = lineDamage('a') as Record<string, unknown>;
  expect(validateDamageDoc(docWith([withoutCopies]), DRAWING)).toContain('damages[0].copies는 배열이어야 합니다.');
  expect(validateDamageDoc(docWith([lineDamage('a', { copies: {} })]), DRAWING)).toContain(
    'damages[0].copies는 배열이어야 합니다.',
  );
});

it('복제본의 점 개수 규칙은 geometry와 같다 (면형 4점, 선형 2점 이상)', () => {
  expect(validateDamageDoc(docWith([areaDamage('a', { copies: [{ world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: null }] })]), DRAWING)).toEqual([]);
  expect(validateDamageDoc(docWith([areaDamage('a', { copies: [{ world: [[0, 0], [2, 0], [2, 1]], dwg: null }] })]), DRAWING)).toContain(
    'damages[0].copies[0].world는 유효한 점 4개여야 합니다.',
  );
  expect(validateDamageDoc(docWith([lineDamage('a', { copies: [{ world: [[0, 0]], dwg: null }] })]), DRAWING)).toContain(
    'damages[0].copies[0].world는 유효한 점 2개 이상이어야 합니다.',
  );
  expect(validateDamageDoc(docWith([lineDamage('a', { copies: ['nope'] })]), DRAWING)).toContain(
    'damages[0].copies[0]가 객체가 아닙니다.',
  );
});

it('복제본의 dwg는 null이거나 world와 점 개수가 같아야 한다', () => {
  expect(validateDamageDoc(docWith([lineDamage('a', { copies: [{ world: [[0, 0], [3, 4]], dwg: [[9, 9], [9, 10]] }] })]), DRAWING)).toEqual([]);
  expect(validateDamageDoc(docWith([lineDamage('a', { copies: [{ world: [[0, 0], [3, 4]], dwg: [[9, 9]] }] })]), DRAWING)).toContain(
    'damages[0].copies[0].dwg는 world와 점 개수가 같아야 합니다.',
  );
});
```

`describe('migrateDoc')` 안에는:

```ts
it('v4 문서는 각 손상에 copies = []를 채워 v5로 변환되고, 다른 값은 그대로다', () => {
  const v4 = { schemaVersion: 4, drawingId: DRAWING, updatedAt: T0, damages: [lineDamage('a')] };
  const { copies, ...withoutCopies } = lineDamage('a') as Record<string, unknown>;
  const migrated = migrateDoc({ ...v4, damages: [withoutCopies] }, DRAWING)!;
  expect(migrated.schemaVersion).toBe(5);
  expect(migrated.damages[0]).toEqual(lineDamage('a'));
  expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
});

it('v4 → v5 변환은 입력 문서와 각 손상 객체를 바꾸지 않는다', () => {
  const { copies, ...withoutCopies } = lineDamage('a') as Record<string, unknown>;
  const v4 = { schemaVersion: 4, drawingId: DRAWING, updatedAt: T0, damages: [withoutCopies] };
  migrateDoc(v4, DRAWING);
  expect(v4.schemaVersion).toBe(4);
  expect(withoutCopies).not.toHaveProperty('copies');
});
```

기존 테스트의 리터럴도 함께 고친다(**스키마를 올렸으므로 불가피한 수정이다**):
- `:56-59` `'schemaVersion 4인 빈 문서를 만든다'` → 제목과 두 리터럴을 5로.
- `:78` `'schemaVersion은 4이어야 합니다.'` → `5`.
- `:319`, `:411`, `:429`, `:445` 등 `toBe(4)` / `'이미 v4면 그대로 돌려준다'` → 5·v5로. v1·v2·v3 이행 결과를 `toEqual`로 비교하는 기대 객체(`:409-444`)에는 `copies: []`를 더한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- damageDoc`
Expected: FAIL — `SCHEMA_VERSION`이 4라서 `schemaVersion은 5여야 합니다`류의 기대 불일치, `copies` 관련 오류 문구 없음.

- [ ] **Step 3: `damageDoc.js`에 스키마 5·검증·이행을 넣는다**

맨 위 import와 상수:

```js
import { getDamageType } from './damageTypes.js';
import { polygonArea, polylineLength } from './geometry.js';

export const SCHEMA_VERSION = 5;
```

`validateGeometry` 바로 앞에 점 개수 규칙을 빼 둔다(첫 도형과 복제본이 같은 규칙을 쓴다):

```js
// 도형의 점 개수 규칙: 사각형은 딱 4점, 선은 2점 이상(null = 개수 제한 없음, isPointList 규약).
function pointCountFor(kind) {
  return kind === 'rect' ? 4 : null;
}
```

`validateGeometry` 안의 `const pointCount = expectedKind === 'rect' ? 4 : null;`을 `const pointCount = pointCountFor(expectedKind);`로 바꾼다.

`validateGeometry` 다음에 복제본 검증을 더한다:

```js
// 복제본(copies)은 배열이고, 각 항목의 world는 geometry.kind의 점 개수 규칙을 따르며 dwg는
// null이거나 world와 점 개수가 같다 — geometry와 똑같은 규칙이다(설계 2장). kind는 따로 두지
// 않는다: 복제본은 언제나 첫 도형과 같은 모양이다.
function validateCopies(damage, type, path, errors) {
  const copies = damage.copies;
  if (!Array.isArray(copies)) {
    errors.push(`${path}.copies는 배열이어야 합니다.`);
    return;
  }
  const pointCount = pointCountFor(type.kind === 'line' ? 'polyline' : 'rect');
  copies.forEach((copy, i) => {
    const where = `${path}.copies[${i}]`;
    if (typeof copy !== 'object' || copy === null) {
      errors.push(`${where}가 객체가 아닙니다.`);
      return;
    }
    if (!isPointList(copy.world, pointCount)) {
      errors.push(
        pointCount === 4
          ? `${where}.world는 유효한 점 4개여야 합니다.`
          : `${where}.world는 유효한 점 2개 이상이어야 합니다.`,
      );
      return;
    }
    if (copy.dwg === null) return;
    if (!isPointList(copy.dwg, copy.world.length)) {
      errors.push(`${where}.dwg는 world와 점 개수가 같아야 합니다.`);
    }
  });
}
```

`validateDamage` 안, `const hasDwg = validateGeometry(...)` 바로 다음 줄에 `validateCopies(damage, type, path, errors);`를 넣는다.

`migrateV3ToV4` 다음에 이행 한 단계를 더한다:

```js
// v4의 각 손상에 copies = []를 채워 v5로 올린다(설계 2장). 복제본이 없는 손상은 이 값만 더해질
// 뿐 지금까지와 완전히 같이 동작한다. 입력 doc과 손상 객체는 바꾸지 않는다.
function migrateV4ToV5(doc) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    ...doc,
    schemaVersion: 5,
    damages: damages.map((damage) => ({ ...damage, copies: [] })),
  };
}
```

`migrateDoc`의 마지막 줄을 잇는다(주석의 v4도 v5로 고친다):

```js
// 예전 문서를 읽을 때 한 단계씩 이어 붙여 v5로 올린다. 저장은 항상 v5로 한다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  const v2 = doc.schemaVersion === 1 ? migrateV1ToV2(doc, drawingId) : doc;
  const v3 = v2.schemaVersion === 2 ? migrateV2ToV3(v2) : v2;
  const v4 = v3.schemaVersion === 3 ? migrateV3ToV4(v3) : v3;
  return v4.schemaVersion === 4 ? migrateV4ToV5(v4) : v4;
}
```

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npm --prefix server test -- damageDoc`
Expected: Step 1에서 더한 테스트는 PASS. 아직 `editor` 쪽 새 연산 테스트는 없다.

- [ ] **Step 5: 새로 그린 손상에도 `copies: []`를 넣는다**

`server/public/viewer/crackTool.js`의 `emptyDamage`:

```js
function emptyDamage(typeId, worldPoints, dwgPoints, kind, options) {
  return {
    id: options.newId(),
    type: typeId,
    createdAt: options.now,
    geometry: { kind, world: normalizePoints(worldPoints), dwg: dwgPoints ? normalizePoints(dwgPoints) : null },
    // 복제본은 처음에는 없다. 사용자가 `복제`를 눌러야 늘어난다(설계 3.2).
    copies: [],
    // 측정값은 아직 없음(null)이다. 0과 구분한다 — 0은 "재 보니 0"이라는 뜻이다.
    measured: { width: null, length: null, count: null },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}
```

`server/test/crackTool.test.ts:185-216`의 `describe('v4 document validation')`을 `v5`로 바꾸고 두 곳의 `schemaVersion: 4`를 `5`로, 테스트 제목의 `v4 문서`를 `v5 문서`로 고친다.

- [ ] **Step 6: 서버 쪽 픽스처의 스키마 리터럴을 올린다**

`server/test/app.test.ts`:
- `:79`(`crackDoc`), `:98`(`spallingDoc`), `:533`(`exportDoc`)의 `schemaVersion: 4` → `5`, 각 문서의 손상 객체에 `geometry` 다음 줄로 `copies: [],`를 더한다.
- `:457` `expect(empty.body).toEqual({ schemaVersion: 4, ... })` → `5`.
- `:471-474` `schemaVersion: 9` 거부 테스트의 기대 문구 → `'schemaVersion은 5이어야 합니다.'`.

`server/test/stores.test.ts`:
- `:154`(빈 문서), `:164`(저장·재읽기용 문서)의 `schemaVersion: 4` → `5`. `:164`의 문서는 검증을 거치지 않고 그대로 저장·재읽기만 하므로 `damages: [{ id: 'x' }]`는 그대로 둔다(이미 v5면 `migrateDoc`이 손대지 않는다는 사실도 함께 고정된다).
- `:189`, `:227`, `:265`의 `expect(doc.schemaVersion).toBe(4)` → `5`, 그 아래 `expect(doc.damages[0]).toEqual({...})` 기대 객체마다 `geometry` 다음 줄에 `copies: [],`를 더한다.

- [ ] **Step 7: 전체 테스트를 돌린다**

Run: `npm --prefix server test`
Expected: PASS (여기서 실패하는 것이 있으면 스키마 리터럴을 빠뜨린 곳이다 — 실패 메시지가 파일과 줄을 그대로 알려준다).

- [ ] **Step 8: 편집 연산(도형 단위)의 실패하는 테스트를 쓴다**

`server/test/damageDoc.test.ts`의 import에 `duplicateShape, removeShape, shapeCountOf, shapesOf, updateShape`를 더하고, `describe('editor')` 다음에 새 describe를 더한다. 값은 손으로 계산한다 — `areaDamage`의 첫 도형은 world `[[0,0],[2,0],[2,1],[0,1]]`, dwg `[[10,10],[12,10],[12,11],[10,11]]`이고 넓이는 2다.

```ts
describe('도형 단위 편집', () => {
  const COPY_1 = { world: [[5, 0], [7, 0], [7, 1], [5, 1]], dwg: [[15, 10], [17, 10], [17, 11], [15, 11]] };
  const COPY_2 = { world: [[9, 0], [11, 0], [11, 1], [9, 1]], dwg: [[19, 10], [21, 10], [21, 11], [19, 11]] };

  it('shapesOf는 첫 도형을 0번으로, 복제본을 1번부터 돌려준다', () => {
    const damage = areaDamage('a', { copies: [COPY_1] });
    expect(shapeCountOf(damage)).toBe(2);
    expect(shapesOf(damage)).toEqual([
      { world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: [[10, 10], [12, 10], [12, 11], [10, 11]] },
      { world: [[5, 0], [7, 0], [7, 1], [5, 1]], dwg: [[15, 10], [17, 10], [17, 11], [15, 11]] },
    ]);
  });

  it('복제본이 없으면 도형은 하나이고 dwg가 없으면 null이다', () => {
    expect(shapeCountOf(areaDamage('a'))).toBe(1);
    expect(shapesOf(areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: null } }))).toEqual([
      { world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: null },
    ]);
  });

  it('duplicateShape는 복제본을 맨 뒤에 붙이고 개소를 도형 수로 맞춘다', () => {
    const editor = createEditor(docWith([areaDamage('a')]));
    const next = duplicateShape(editor, 'a', COPY_1, T1);
    expect(next.doc.damages[0].copies).toEqual([COPY_1]);
    expect(next.doc.damages[0].measured.count).toBe(2);
    expect(next.doc.updatedAt).toBe(T1);
    // 사용자가 고친 개소도 다음 복제 때 도형 수로 덮인다(설계 2장 "항상").
    const third = duplicateShape(next, 'a', COPY_2, T2);
    expect(third.doc.damages[0].measured.count).toBe(3);
    expect(validateDamageDoc(third.doc, DRAWING)).toEqual([]);
  });

  it('duplicateShape는 없는 id면 같은 editor를 돌려주고 원본을 바꾸지 않는다', () => {
    const editor = createEditor(docWith([areaDamage('a')]));
    expect(duplicateShape(editor, 'nope', COPY_1, T1)).toBe(editor);
    expect(editor.doc.damages[0].copies).toEqual([]);
  });

  it('removeShape는 복제본 하나만 지우고 개소를 줄인다', () => {
    const editor = createEditor(docWith([areaDamage('a', { copies: [COPY_1, COPY_2], measured: { width: 1.2, length: 1.5, count: 3 } })]));
    const next = removeShape(editor, 'a', 1, T1);
    expect(next.doc.damages[0].copies).toEqual([COPY_2]);
    expect(next.doc.damages[0].measured.count).toBe(2);
  });

  it('removeShape로 첫 도형을 지우면 copies[0]이 새 geometry가 되고 computed를 다시 센다', () => {
    const editor = createEditor(docWith([areaDamage('a', { copies: [COPY_1], measured: { width: 1.2, length: 1.5, count: 2 } })]));
    const next = removeShape(editor, 'a', 0, T1);
    const damage = next.doc.damages[0];
    expect(damage.geometry).toEqual({ kind: 'rect', world: COPY_1.world, dwg: COPY_1.dwg });
    expect(damage.copies).toEqual([]);
    // 승격된 도형의 dwg 넓이 = 2 × 1 = 2
    expect(damage.computed).toEqual({ lengthDwg: null, areaDwg: 2 });
    expect(damage.measured.count).toBe(1);
  });

  it('dwg가 없는 복제본이 승격되면 computed는 모두 null이 되어 검증을 통과한다', () => {
    const noDwg = { world: [[5, 0], [7, 0], [7, 1], [5, 1]], dwg: null };
    const editor = createEditor(docWith([areaDamage('a', { copies: [noDwg] })]));
    const next = removeShape(editor, 'a', 0, T1);
    expect(next.doc.damages[0].computed).toEqual({ lengthDwg: null, areaDwg: null });
    expect(validateDamageDoc(next.doc, DRAWING)).toEqual([]);
  });

  it('removeShape로 마지막 남은 도형을 지우면 손상 자체가 사라진다', () => {
    const editor = createEditor(docWith([areaDamage('a'), lineDamage('b')]));
    const next = removeShape(editor, 'a', 0, T1);
    expect(next.doc.damages.map((d: { id: string }) => d.id)).toEqual(['b']);
  });

  it('removeShape는 없는 도형 번호면 같은 editor를 돌려준다', () => {
    const editor = createEditor(docWith([areaDamage('a', { copies: [COPY_1] })]));
    expect(removeShape(editor, 'a', 2, T1)).toBe(editor);
    expect(removeShape(editor, 'a', -1, T1)).toBe(editor);
    expect(removeShape(editor, 'nope', 0, T1)).toBe(editor);
  });

  it('복제와 복제본 삭제는 한 번에 되돌려진다', () => {
    const editor = createEditor(docWith([areaDamage('a')]));
    const afterCopy = duplicateShape(editor, 'a', COPY_1, T1);
    const afterRemove = removeShape(afterCopy, 'a', 1, T2);
    expect(afterRemove.doc.damages[0].copies).toEqual([]);
    const undone = undo(afterRemove, T2);
    expect(undone.doc.damages[0].copies).toEqual([COPY_1]);
    expect(undone.doc.damages[0].measured.count).toBe(2);
    expect(undo(undone, T2).doc.damages[0].copies).toEqual([]);
  });

  it('updateShape는 첫 도형을 바꿀 때만 computed를 다시 센다', () => {
    const editor = createEditor(docWith([areaDamage('a', { copies: [COPY_1] })]));
    // 첫 도형을 가로 4로 넓히면 dwg 넓이 = 4 × 1 = 4
    const moved = updateShape(editor, 'a', 0, { world: [[0, 0], [4, 0], [4, 1], [0, 1]], dwg: [[10, 10], [14, 10], [14, 11], [10, 11]] }, T1);
    expect(moved.doc.damages[0].computed).toEqual({ lengthDwg: null, areaDwg: 4 });
    // 복제본을 옮겨도 computed와 개소는 그대로다
    const copyMoved = updateShape(moved, 'a', 1, COPY_2, T2);
    expect(copyMoved.doc.damages[0].copies).toEqual([COPY_2]);
    expect(copyMoved.doc.damages[0].computed).toEqual({ lengthDwg: null, areaDwg: 4 });
    expect(copyMoved.doc.damages[0].measured).toEqual({ width: 1.2, length: 1.5, count: 1 });
  });

  it('updateShape는 선형 손상의 첫 도형에서 길이를 다시 센다', () => {
    const editor = createEditor(docWith([lineDamage('a')]));
    // dwg [[0,0],[30,40]] 의 길이 = 50
    const next = updateShape(editor, 'a', 0, { world: [[0, 0], [3, 4]], dwg: [[0, 0], [30, 40]] }, T1);
    expect(next.doc.damages[0].computed).toEqual({ lengthDwg: 50, areaDwg: null });
  });

  it('updateShape는 없는 도형 번호면 같은 editor를 돌려준다', () => {
    const editor = createEditor(docWith([areaDamage('a')]));
    expect(updateShape(editor, 'a', 1, COPY_1, T1)).toBe(editor);
  });
});
```

- [ ] **Step 9: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- damageDoc`
Expected: FAIL — `duplicateShape is not a function`류의 import 오류.

- [ ] **Step 10: 편집 연산을 구현한다**

`damageDoc.js`의 `updateDamage` 다음, `undo` 앞에 넣는다:

```js
function copiesOf(damage) {
  return Array.isArray(damage?.copies) ? damage.copies : [];
}

/**
 * 손상의 도형 목록. 0번이 geometry(첫 도형), 1번부터 copies다(설계 2장). 복제본의 kind는 따로
 * 두지 않는다 — 언제나 geometry.kind와 같다.
 * @type {(damage: any) => Array<{ world: number[][], dwg: number[][] | null }>}
 */
export function shapesOf(damage) {
  const first = {
    world: Array.isArray(damage?.geometry?.world) ? damage.geometry.world : [],
    dwg: Array.isArray(damage?.geometry?.dwg) ? damage.geometry.dwg : null,
  };
  return [
    first,
    ...copiesOf(damage).map((copy) => ({
      world: Array.isArray(copy?.world) ? copy.world : [],
      dwg: Array.isArray(copy?.dwg) ? copy.dwg : null,
    })),
  ];
}

/** @type {(damage: any) => number} */
export function shapeCountOf(damage) {
  return 1 + copiesOf(damage).length;
}

// 첫 도형이 바뀌면 computed도 같이 바꾼다. dwg가 없으면 둘 다 null이어야 한다 — validateComputed의
// 규칙이라, 승격된 복제본에 dwg가 없는데 옛 값을 남겨 두면 저장이 통째로 막힌다.
function computedFor(kind, dwg) {
  if (!Array.isArray(dwg)) return { lengthDwg: null, areaDwg: null };
  return kind === 'rect'
    ? { lengthDwg: null, areaDwg: polygonArea(dwg) }
    : { lengthDwg: polylineLength(dwg), areaDwg: null };
}

/**
 * 복제본을 하나 더한다. 도형(world·dwg)은 부르는 쪽이 만들어 넘긴다 — 오른쪽으로 옮긴 자리의 dwg는
 * 뷰어의 좌표 변환기(mapper)가 있어야 구할 수 있고, 이 파일은 서버도 쓰므로 mapper를 모른다.
 * 개소는 그 시점의 도형 수로 맞춘다(설계 2장 "항상").
 * @type {(editor: Editor, damageId: string, shape: { world: number[][], dwg: number[][] | null }, now: string) => Editor}
 */
export function duplicateShape(editor, damageId, shape, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  const copies = [...copiesOf(current), { world: shape.world, dwg: shape.dwg ?? null }];
  const updated = { ...current, copies, measured: { ...current.measured, count: copies.length + 1 } };
  return commit(editor, editor.doc.damages.map((damage, i) => (i === index ? updated : damage)), now);
}

/**
 * 도형 하나만 지운다(설계 3.3). 첫 도형(0번)을 지우면 copies[0]이 새 geometry가 되고 — 번호 라벨이
 * 그 도형으로 옮겨간다 — 마지막 남은 도형을 지우면 손상 자체가 사라진다. 지운 뒤 개소를 도형 수로 맞춘다.
 * @type {(editor: Editor, damageId: string, shapeIndex: number, now: string) => Editor}
 */
export function removeShape(editor, damageId, shapeIndex, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  if (!Number.isInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= shapeCountOf(current)) return editor;
  if (shapeCountOf(current) === 1) return removeDamage(editor, damageId, now);

  const copies = copiesOf(current);
  let updated;
  if (shapeIndex === 0) {
    const [promoted, ...rest] = copies;
    updated = {
      ...current,
      geometry: { ...current.geometry, world: promoted.world, dwg: promoted.dwg ?? null },
      copies: rest,
      computed: computedFor(current.geometry.kind, promoted.dwg ?? null),
    };
  } else {
    updated = { ...current, copies: copies.filter((_, i) => i !== shapeIndex - 1) };
  }
  updated = { ...updated, measured: { ...current.measured, count: shapeCountOf(updated) } };
  return commit(editor, editor.doc.damages.map((damage, i) => (i === index ? updated : damage)), now);
}

/**
 * 도형 하나(첫 도형이든 복제본이든)의 좌표만 바꾼다. computed는 첫 도형을 바꿨을 때만 다시 센다
 * (설계 3.3). 개소는 건드리지 않는다 — 도형 수가 변하지 않기 때문이다.
 * @type {(editor: Editor, damageId: string, shapeIndex: number, shape: { world: number[][], dwg: number[][] | null }, now: string) => Editor}
 */
export function updateShape(editor, damageId, shapeIndex, shape, now) {
  const current = editor.doc.damages.find((damage) => damage.id === damageId);
  if (!current) return editor;
  if (!Number.isInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= shapeCountOf(current)) return editor;
  const dwg = shape.dwg ?? null;
  if (shapeIndex === 0) {
    const changes = { geometry: { world: shape.world, dwg }, computed: computedFor(current.geometry.kind, dwg) };
    return updateDamage(editor, damageId, changes, now);
  }
  const copies = copiesOf(current).map((copy, i) => (i === shapeIndex - 1 ? { world: shape.world, dwg } : copy));
  return updateDamage(editor, damageId, { copies }, now);
}
```

- [ ] **Step 11: 테스트와 타입 검사를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck && node --check server/public/viewer/damageDoc.js`
Expected: 모두 PASS

- [ ] **Step 12: 커밋**

```bash
git add server/public/viewer/damageDoc.js server/public/viewer/crackTool.js server/test/damageDoc.test.ts server/test/crackTool.test.ts server/test/app.test.ts server/test/stores.test.ts
git commit -m "$(cat <<'EOF'
손상 하나가 도형을 여러 개 갖도록 저장 형식을 5로 올린다

첫 도형은 geometry 그대로 두고 복제본을 copies에 담는다. v4 문서는 copies: []로 올라오므로
복제본이 없는 손상의 동작은 지금과 완전히 같다. 도형 단위 편집(duplicateShape·removeShape·
updateShape)을 문서 편집 함수로 더해 되돌리기 한 번에 되돌아가게 했다. 첫 도형을 지우면
copies[0]이 승격되고 computed를 다시 센다 — dwg가 없는 도형이 올라오면 computed도 null이어야
검증을 통과하기 때문이다.

서버는 이 파일을 그대로 쓰므로 **서버를 다시 시작해야** 저장이 막히지 않는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 복제본을 담을 수 있는 저장 형식과, 되돌리기까지 동작하는 도형 단위 편집 연산. 화면·산출은 아직 첫 도형만 쓴다.

---

## Task 2: 라벨 겹침 장애물에 복제본을 넣는다 (화면·DXF 한 벌)

**Files:**
- Modify: `server/public/viewer/labelCollision.js:132-197` (`placeLabels`)
- Modify: `server/public/viewer/overlay.js:322-380` (`computeLabelPlacements`)
- Modify: `server/src/export/labelPlacement.ts:59-106` (`damageLabels`)
- Test: `server/test/labelCollision.test.ts`, `server/test/overlay.test.ts`, `server/test/labelPlacement.test.ts`

**Interfaces:**
- Consumes: Task 1의 `shapesOf(damage)`; 기존 `boundsOf(points)`(`geometry.js`), `boxOfBounds(bounds)`.
- Produces:
  - `placeLabels(items, { gap, font, obstacles })` — `obstacles?: Array<{ minX, minY, maxX, maxY }>`, 기본값 `[]`. **라벨을 받지 않고 막기만 하는 상자**다. 자기 손상 제외 규칙(4.1)은 이 상자들에 적용되지 않는다 — 복제본은 자기 손상의 라벨도 막아야 한다.
  - `copyBoundsOf(damage): Array<{ minX, minY, maxX, maxY }>`(`overlay.js`에서 내보낸다) — 복제본(1번부터)의 **dwg** 경계상자. dwg가 없는 복제본은 건너뛴다. 화면과 DXF가 같은 함수를 쓴다.

- [ ] **Step 1: `placeLabels`의 obstacles 실패 테스트를 쓴다**

`server/test/labelCollision.test.ts`의 `describe('placeLabels')` 안에 더한다. 손으로 계산한 값: 손상 경계상자 `(0,0)-(200,200)`, 블록 100×100, 간격 100 → 기본 자리 anchor `[100, 300]`, 상자 `{x:50, y:300, w:100, h:100}`. 장애물 `(0,250)-(300,400)` = 상자 `{x:0,y:250,w:300,h:150}`는 이 기본 자리와 겹치므로 다음 후보인 위 k=1(`[100, 300+100]`)로 밀린다. 그 상자 `{x:50,y:400,...}`는 장애물 위쪽 끝 400과 **닿기만** 하므로 통과한다(`boxesOverlap`은 닿는 것을 겹침으로 보지 않는다).

```ts
it('obstacles는 라벨을 받지 않고 막기만 한다', () => {
  const items = [{ id: 'a', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) }];
  const free = placeLabels(items, { gap: GAP, font: FONT }).get('a')!;
  expect(free.anchor).toEqual([100, 300]);
  expect(free.displaced).toBe(false);

  const blocked = placeLabels(items, { gap: GAP, font: FONT, obstacles: [bounds(0, 250, 300, 400)] });
  expect(blocked.size).toBe(1); // 장애물은 라벨을 받지 않는다
  expect(blocked.get('a')!.anchor).toEqual([100, 400]);
  expect(blocked.get('a')!.displaced).toBe(true);
});

it('obstacles는 자기 손상의 라벨도 막는다 (자기 제외 규칙은 items에만 적용된다)', () => {
  const items = [{ id: 'a', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) }];
  const placed = placeLabels(items, { gap: GAP, font: FONT, obstacles: [bounds(0, 250, 300, 400)] }).get('a')!;
  expect(placed.anchor).toEqual([100, 400]);
});

it('obstacles를 주지 않으면 지금과 같다', () => {
  const items = [{ id: 'a', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) }];
  expect(placeLabels(items, { gap: GAP, font: FONT, obstacles: [] }).get('a')!.anchor).toEqual([100, 300]);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- labelCollision`
Expected: FAIL — obstacles를 무시하므로 `[100, 300]`이 나온다(기대는 `[100, 400]`).

- [ ] **Step 3: `placeLabels`에 obstacles를 더한다**

`server/public/viewer/labelCollision.js`의 JSDoc과 서명, obstacles 조립부만 고친다:

```js
/**
 * 손상마다 라벨 자리를 정한다. 번호 순서대로 자리를 잡고(앞번호가 좋은 자리를 먼저 차지한다),
 * 앞서 잡은 라벨 상자는 뒷번호의 장애물이 된다. 같은 손상 집합이면 넣은 순서와 상관없이 항상
 * 같은 결과가 나온다.
 *
 * obstacles는 **라벨을 받지 않고 막기만 하는** 상자다(2026-09-16 복제 설계 3.4). 복제본의 경계상자가
 * 여기로 들어온다 — items에 넣으면 복제본마다 라벨이 하나씩 생겨 버린다. 자기 손상 제외 규칙(4.1)도
 * 적용하지 않는다: 자기 복제본 위에도 라벨이 놓이면 안 되기 때문이다(id를 null로 둬 어떤 item의
 * id와도 같지 않게 한다).
 *
 * @param {Array<{ id: string, number: number|null, bounds: object, block: object }>} items
 * @param {{ gap: number, font: number, obstacles?: Array<{ minX: number, minY: number, maxX: number, maxY: number }> }} sizes
 * @returns {Map<string, { anchor: number[], box: object, displaced: boolean, leader: object|null }>}
 */
export function placeLabels(items, { gap, font, obstacles: extraObstacles = [] }) {
  const order = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.bounds && item.block)
    .slice()
    .sort((a, b) => orderKey(a) - orderKey(b) || compareId(String(a.id), String(b.id)));

  const obstacles = [
    ...order.map((item) => ({ id: String(item.id), box: boxOfBounds(item.bounds) })),
    ...(Array.isArray(extraObstacles) ? extraObstacles : []).map((bounds) => ({ id: null, box: boxOfBounds(bounds) })),
  ];
```

나머지(`placedBoxes`부터)는 그대로 둔다 — `near` 필터의 `o.id !== id`가 `null !== '문자열'`이라 항상 참이므로 추가 장애물은 모든 손상을 막는다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npm --prefix server test -- labelCollision`
Expected: PASS (기존 테스트도 전부 — obstacles를 안 주면 기본값 `[]`라 결과가 같다)

- [ ] **Step 5: 화면·DXF가 복제본을 장애물로 넘기는 실패 테스트를 쓴다**

`server/test/overlay.test.ts`의 `describe('computeLabelPlacements')` 안에. `rectDamage('a', 0)`은 world·dwg가 `[[0,0],[1000,0],[1000,400],[0,400]]`이라 기본 라벨 자리는 그 위(`y ≥ 500`, 간격 100)다. 복제본 경계상자를 그 위쪽 전체(`y 450~6000`, `x -5000~5000`)로 두면 위쪽 후보가 모두 막혀 오른쪽·왼쪽으로 밀린다. 정확한 자리 대신 **"복제본 상자와 겹치지 않는다"**는 규칙 자체를 검사한다(축척이 섞인 좌표를 손으로 풀지 않아도 되고, 그게 진짜 요구사항이다).

```ts
it('복제본 경계상자 위에는 라벨을 놓지 않는다', () => {
  const COPY_BOUNDS = { minX: -5000, minY: 450, maxX: 5000, maxY: 6000 };
  const base = rectDamage('a', 0) as Record<string, unknown>;
  const withCopy = { ...base, copies: [{ world: [[-5000, 450], [5000, 450], [5000, 6000], [-5000, 6000]], dwg: [[-5000, 450], [5000, 450], [5000, 6000], [-5000, 6000]] }] };

  const plain = computeLabelPlacements([base], new Map([['a', 1]]), identity)!.get('a')!;
  expect(plain.displaced).toBe(false); // 막는 것이 없으면 도형 바로 위

  const placed = computeLabelPlacements([withCopy], new Map([['a', 1]]), identity)!.get('a')!;
  expect(placed.displaced).toBe(true);
  expect(boxesOverlap(placed.box, boxOfBounds(COPY_BOUNDS))).toBe(false);
});

it('dwg가 없는 복제본은 장애물로 세지 않는다', () => {
  const base = rectDamage('a', 0) as Record<string, unknown>;
  const withCopy = { ...base, copies: [{ world: [[-5000, 450], [5000, 450], [5000, 6000], [-5000, 6000]], dwg: null }] };
  expect(computeLabelPlacements([withCopy], new Map([['a', 1]]), identity)!.get('a')!.displaced).toBe(false);
});
```

`overlay.test.ts` 맨 위 import에 `import { boxesOverlap, boxOfBounds } from '../public/viewer/labelCollision.js';`를 더한다.

`server/test/labelPlacement.test.ts`에도 같은 규칙을 건다. 이 파일의 `rect()` 헬퍼가 만드는 손상은 dwg가 `[[0,0],[1000,0],[1000,400],[0,400]]`이라 **기본 라벨 자리는 y ≥ 500**(위쪽 경계 400 + 간격 100)이다. 복제본 경계상자를 `y 450` 위쪽 전체로 두면 위쪽 후보가 모두 막혀 오른쪽(세로가 경계상자 중앙, y ≈ 200)으로 비켜난다.

```ts
it('복제본 경계상자를 장애물로 넣어 라벨이 복제본 위로 가지 않는다', () => {
  const copyPoints: Pt[] = [[-5000, 450], [5000, 450], [5000, 6000], [-5000, 6000]];
  const measured = { width: 1.2, length: 1.5, count: 2 };
  const plain = damageLabels([{ id: 'r1', number: 1, damage: rect('spalling', measured) }]).get('r1')!;
  const blocked = damageLabels([
    { id: 'r1', number: 1, damage: { ...rect('spalling', measured), copies: [{ world: copyPoints, dwg: copyPoints }] } },
  ]).get('r1')!;

  // 막는 것이 없으면 도형 바로 위(y ≥ 500)다
  for (const line of plain.lines) expect(line.position[1]).toBeGreaterThan(400);
  // 복제본에 막히면 그 상자(y ≥ 450) 아래로 비켜난다
  for (const line of blocked.lines) expect(line.position[1]).toBeLessThan(450);
  expect(blocked.circle!.center[1]).toBeLessThan(450);
});
```

> 화살표(`leader`) 유무는 검사하지 않는다 — 오른쪽으로 간격 100만 밀린 라벨은 화살대가 화살촉(150)보다 짧아 `leaderFor`가 `null`을 돌려주는 것이 정상이다(`labelCollision.js`의 주석).

화면과 DXF가 같은 답을 내는지는 `overlay.test.ts`가 이미 `crossCheckAgainstDxf`로 확인하고 있고, 두 경로가 **같은 `copyBoundsOf` 함수를 같은 자리에서 부르도록** 구현하는 것이 이 Task의 요구사항이다(Step 7).

- [ ] **Step 6: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- overlay labelPlacement`
Expected: FAIL — `displaced`가 `false`(복제본을 모르므로 기본 자리를 그대로 쓴다).

- [ ] **Step 7: 복제본 경계상자를 뽑아 양쪽에서 넘긴다**

`server/public/viewer/overlay.js`: import에 `shapesOf`를 더하고(`import { shapesOf } from './damageDoc.js';`), `computeLabelPlacements` 바로 앞에 공용 함수를 둔다.

```js
// 복제본(1번 도형부터)의 도면 좌표 경계상자. 라벨이 복제본 위에 놓이지 않도록 겹침 방지의
// 장애물로 넣는다(설계 3.4). 화면(computeLabelPlacements)과 DXF(labelPlacement.damageLabels)가
// 이 함수 하나를 같이 써야 두 곳의 라벨 자리가 갈리지 않는다. dwg가 없는 복제본은 도면에 놓지
// 못하므로 건너뛴다 — 첫 도형에 적용하는 규칙과 같다.
/** @type {(damage: any) => Array<{ minX: number, minY: number, maxX: number, maxY: number }>} */
export function copyBoundsOf(damage) {
  const list = [];
  for (const shape of shapesOf(damage).slice(1)) {
    const bounds = boundsOf(shape.dwg);
    if (bounds) list.push(bounds);
  }
  return list;
}
```

`computeLabelPlacements` 안에서 장애물을 모아 넘긴다 — `items.push(...)` 다음 줄에 `obstacles.push(...copyBoundsOf(damage));`를 넣고, 반복문 앞에 `const obstacles = [];`를 선언한 뒤 호출을 고친다:

```js
  const items = [];
  const obstacles = [];
  for (const damage of Array.isArray(damages) ? damages : []) {
    // labelPlacement.ts의 dwgPointsOf/damageLabels와 같은 건너뛰기 규칙: dwg 좌표가 없는 손상은
    // 도면에 놓지 못하므로 뺀다. 복제본의 장애물도 같이 빠진다 — 그 손상은 아예 그려지지 않는다.
    const bounds = boundsOf(damage?.geometry?.dwg);
    if (!bounds) continue;
    obstacles.push(...copyBoundsOf(damage));
    const id = String(damage?.id);
    ...
  }
  const placements = placeLabels(items, { gap: LABEL_GAP_MM, font: FONT_HEIGHT_MM, obstacles });
```

`server/src/export/labelPlacement.ts`의 `damageLabels`도 같은 자리에서 같은 값을 만든다:

```ts
import { CIRCLE_RADIUS_FACTOR, copyBoundsOf, FONT_HEIGHT_MM, LABEL_GAP_MM } from '../../public/viewer/overlay.js';
```

```ts
export function damageLabels(items: LabelItem[]): Map<string, DamageLabel> {
  const entries = [];
  const obstacles = [];
  for (const item of items) {
    const points = dwgPointsOf(item.damage);
    if (!points) continue;
    const bounds = boundsOf(points);
    if (!bounds) continue;
    // 복제본 경계상자는 라벨을 받지 않고 막기만 한다(설계 3.4). 화면의 computeLabelPlacements와
    // 같은 함수(copyBoundsOf)로 같은 순서에 넣어야 두 곳이 같은 답을 낸다.
    obstacles.push(...copyBoundsOf(item.damage));
    entries.push({ ... });   // 기존 그대로
  }

  const placements = placeLabels(entries, { gap: LABEL_GAP_MM, font: FONT_HEIGHT_MM, obstacles });
```

- [ ] **Step 8: 테스트·타입 검사를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck && node --check server/public/viewer/labelCollision.js && node --check server/public/viewer/overlay.js`
Expected: 모두 PASS. 기존 라벨 테스트(`labelCollision`·`overlay`·`labelPlacement`·`exportDrawing`)는 복제본이 없으면 장애물이 비어 결과가 그대로다.

- [ ] **Step 9: 커밋**

```bash
git add server/public/viewer/labelCollision.js server/public/viewer/overlay.js server/src/export/labelPlacement.ts server/test/labelCollision.test.ts server/test/overlay.test.ts server/test/labelPlacement.test.ts
git commit -m "$(cat <<'EOF'
라벨이 복제본 위에 놓이지 않게 겹침 장애물에 복제본을 넣는다

placeLabels에 obstacles를 더했다 — 라벨을 받지 않고 막기만 하는 상자다. 복제본을 items에 넣으면
복제본마다 라벨이 하나씩 생기므로 넣을 수 없다. 자기 손상 제외 규칙도 적용하지 않는다: 자기
복제본 위에도 라벨이 가면 안 된다. 화면과 DXF가 copyBoundsOf 하나를 같이 써 같은 답을 낸다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 복제본이 생겨도 라벨이 그 위에 얹히지 않고, 화면과 산출이 같은 자리를 고른다.

---

## Task 3: 화면 — 도형 단위 선택·그리기 (순수 함수)

**Files:**
- Modify: `server/public/viewer/crackTool.js:98-114` (`pickDamage`), 새 `offsetShape`
- Modify: `server/public/viewer/overlay.js:288-311` (`describeDamageRender`), `renderDamage`, `createOverlay`의 `setSelected`
- Test: `server/test/crackTool.test.ts`, `server/test/overlay.test.ts`

**Interfaces:**
- Consumes: Task 1의 `shapesOf(damage)`, 기존 `boundsOf`·`translatePoints`(`geometry.js`), `mapper.worldToClient`·`worldToDwg`. **`overlay.js`에는 Task 2가 이미 `import { shapesOf } from './damageDoc.js';`를 넣어 뒀다** — 없으면 더한다. `crackTool.js`에는 이 Task에서 새로 넣는다.
- Produces:
  - `pickDamage(damages, clientPoint, mapper, radiusPx?) → { id: string, shapeIndex: number } | null` — 어느 도형을 눌렀는지까지 돌려준다
  - `DUPLICATE_OFFSET_FACTOR = 1.2`
  - `offsetShape(worldPoints, mapper, factor?) → { world: number[][], dwg: number[][] | null } | null` — 경계상자 너비 × factor만큼 오른쪽으로 옮긴 도형. 옮길 수 없으면 `null`
  - `describeDamageRender(damage, selectedId, number = null, selectedShapeIndex = 0)` — `handleShapeIndex: number | null`이 늘어난다(나머지 필드는 그대로)
  - `overlay.setSelected(id, shapeIndex = 0)`
  - `overlay.setDraft({ kind, points, activeId, activeShape })` — `activeShape`는 미리보기 중이라 화면에서 뺄 도형 번호

- [ ] **Step 1: `pickDamage`와 `offsetShape`의 실패 테스트를 쓴다**

`server/test/crackTool.test.ts`의 `describe('pickDamage')`를 고친다(**반환 모양이 바뀌었으므로 기존 기대값도 함께 바뀐다** — 도형 번호 없이는 어느 복제본을 눌렀는지 알 수 없다):

```ts
describe('pickDamage', () => {
  const line = {
    id: 'a',
    type: 'crack',
    geometry: { kind: 'polyline', world: [[0, -5], [10, -5]] as Pt[] },
    copies: [],
  };
  // 복제본은 화면 x 200~300, y 100~200 자리다(world [[20,-10],[30,-10],[30,-20],[20,-20]]).
  const area = {
    id: 'b',
    type: 'spalling',
    geometry: { kind: 'rect', world: [[0, -10], [10, -10], [10, -20], [0, -20]] as Pt[] },
    copies: [{ world: [[20, -10], [30, -10], [30, -20], [20, -20]] as Pt[], dwg: null }],
  };

  it('선형은 선 가까이를 누르면 선택된다', () => {
    expect(pickDamage([line, area], [50, 55], mapper)).toEqual({ id: 'a', shapeIndex: 0 });
    expect(pickDamage([line, area], [50, 20], mapper)).toBeNull();
  });

  it('면형은 안쪽을 눌러도 선택된다', () => {
    expect(pickDamage([line, area], [50, 150], mapper)).toEqual({ id: 'b', shapeIndex: 0 });
  });

  it('면형 테두리 근처도 선택된다', () => {
    expect(pickDamage([line, area], [50, 95], mapper)).toEqual({ id: 'b', shapeIndex: 0 });
  });

  it('복제본을 누르면 그 도형 번호가 나온다', () => {
    expect(pickDamage([line, area], [250, 150], mapper)).toEqual({ id: 'b', shapeIndex: 1 });
    expect(pickDamage([line, area], [295, 105], mapper)).toEqual({ id: 'b', shapeIndex: 1 });
  });

  it('아무것도 없으면 null', () => {
    expect(pickDamage([], [0, 0], mapper)).toBeNull();
  });
});
```

새 describe를 더한다. 픽스처 mapper는 `dwg = world + (1000, 2000)`이다. world 사각형 `[[0,0],[2,0],[2,1],[0,1]]`의 너비는 2 → 이동량 `2 × 1.2 = 2.4`.

```ts
describe('offsetShape', () => {
  it('경계상자 너비의 1.2배만큼 오른쪽으로 옮기고 dwg를 다시 구한다', () => {
    expect(DUPLICATE_OFFSET_FACTOR).toBe(1.2);
    expect(offsetShape([[0, 0], [2, 0], [2, 1], [0, 1]], mapper)).toEqual({
      world: [[2.4, 0], [4.4, 0], [4.4, 1], [2.4, 1]],
      dwg: [[1002.4, 2000], [1004.4, 2000], [1004.4, 2001], [1002.4, 2001]],
    });
  });

  it('세로로만 그은 선(너비 0)은 높이로 대신 옮긴다 — 그러지 않으면 복제본이 원본에 완전히 겹친다', () => {
    expect(offsetShape([[5, 0], [5, 10]], mapper)).toEqual({
      world: [[17, 0], [17, 10]],
      dwg: [[1017, 2000], [1017, 2010]],
    });
  });

  it('dwg를 못 구하면 world만 있는 복제본이 된다', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    expect(offsetShape([[0, 0], [2, 0], [2, 1], [0, 1]], noDwg)).toEqual({
      world: [[2.4, 0], [4.4, 0], [4.4, 1], [2.4, 1]],
      dwg: null,
    });
  });

  it('점이 모자라거나 크기가 0이면 null', () => {
    expect(offsetShape([[1, 1]], mapper)).toBeNull();
    expect(offsetShape([[1, 1], [1, 1]], mapper)).toBeNull();
    expect(offsetShape(null as unknown as Pt[], mapper)).toBeNull();
  });
});
```

import에 `DUPLICATE_OFFSET_FACTOR, offsetShape`를 더한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- crackTool`
Expected: FAIL — `pickDamage`가 문자열을 돌려주고 `offsetShape`는 없다.

- [ ] **Step 3: `crackTool.js`를 고친다**

import 두 줄을 늘린다:

```js
import { shapesOf } from './damageDoc.js';
import {
  angleOf,
  boundsOf,
  distanceToPolyline,
  ...
```

`pickDamage`를 도형 단위로 바꾼다:

```js
// 누른 자리에서 가장 가까운 손상과 **그 도형 번호**를 돌려준다(설계 3.3). 사각형 안쪽을 누르면
// 거리를 따지지 않고 그 도형이 이긴다 — 겹쳐 놓인 도형 중 위에 있는 것을 고르는 기존 규칙 그대로다.
/** @type {(damages: any[], clientPoint: number[], mapper: any, radiusPx?: number) => { id: string, shapeIndex: number } | null} */
export function pickDamage(damages, clientPoint, mapper, radiusPx = PICK_RADIUS_PX) {
  let best = null;
  let bestDistance = radiusPx;
  for (const damage of damages) {
    const kind = damage.geometry.kind;
    const shapes = shapesOf(damage);
    for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex++) {
      const screen = shapes[shapeIndex].world.map((p) => mapper.worldToClient(p));
      if (screen.length < 2) continue;
      if (kind === 'rect' && pointInPolygon(clientPoint, screen)) return { id: damage.id, shapeIndex };
      const distance =
        kind === 'rect'
          ? distanceToPolyline(clientPoint, [...screen, screen[0]])
          : distanceToPolyline(clientPoint, screen);
      if (distance <= bestDistance) {
        best = { id: damage.id, shapeIndex };
        bestDistance = distance;
      }
    }
  }
  return best;
}
```

`hitSelectedShape` 다음에 복제본 자리 계산을 더한다:

```js
// 복제본을 놓을 자리(설계 3.2): 고른 도형을 그 경계상자 너비의 1.2배(너비 + 20%)만큼 오른쪽으로
// 옮긴다. world에서 옮긴 뒤 dwg를 다시 구한다 — world→dwg 변환에 회전·반전이 있을 수 있어 dwg를
// 같은 만큼 옮기면 엉뚱한 방향으로 밀린다(finalizeStroke가 dwg를 만드는 방식과 같다).
// 세로로만 그은 선은 너비가 0이라 복제본이 원본에 완전히 겹쳐 사용자가 찾지 못한다 — 그때는 높이로
// 대신한다(스펙에 없는 경우라 여기서 정한다).
export const DUPLICATE_OFFSET_FACTOR = 1.2;

/** @type {(worldPoints: number[][], mapper: any, factor?: number) => { world: number[][], dwg: number[][] | null } | null} */
export function offsetShape(worldPoints, mapper, factor = DUPLICATE_OFFSET_FACTOR) {
  if (!Array.isArray(worldPoints) || worldPoints.length < 2 || !worldPoints.every(isFinitePoint)) return null;
  const bounds = boundsOf(worldPoints);
  if (!bounds) return null;
  const span = bounds.maxX - bounds.minX || bounds.maxY - bounds.minY;
  const dx = span * factor;
  if (!(dx > 0)) return null;
  const world = normalizePoints(translatePoints(worldPoints, dx, 0));
  const dwg = toDwg(world, mapper);
  return { world, dwg: dwg ? normalizePoints(dwg) : null };
}
```

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npm --prefix server test -- crackTool`
Expected: PASS

- [ ] **Step 5: `overlay`의 도형 단위 그리기 실패 테스트를 쓴다**

`server/test/overlay.test.ts`의 `describe('describeDamageRender')`에 더한다:

```ts
it('선택된 도형 번호를 handleShapeIndex로 돌려준다 — 핸들은 그 도형에만 그린다', () => {
  const rect = { id: 'x', type: 'spalling', geometry: { kind: 'rect', world: [] }, copies: [] };
  expect(describeDamageRender(rect, 'x', null, 1).handleShapeIndex).toBe(1);
  expect(describeDamageRender(rect, 'x', null).handleShapeIndex).toBe(0);
  // 선택되지 않았거나 선형이면 핸들 자체가 없다
  expect(describeDamageRender(rect, null, null, 1).handleShapeIndex).toBeNull();
  const line = { id: 'y', type: 'crack', geometry: { kind: 'polyline', world: [] }, copies: [] };
  expect(describeDamageRender(line, 'y', null, 0).handleShapeIndex).toBeNull();
});

it('선택된 손상은 도형이 몇 개든 모두 강조색이다 — 색은 손상 단위다', () => {
  const rect = { id: 'x', type: 'spalling', geometry: { kind: 'rect', world: [] }, copies: [{ world: [], dwg: null }] };
  expect(describeDamageRender(rect, 'x', null, 1).color).toBe(SELECTED_COLOR);
  expect(describeDamageRender(rect, 'other', null, 0).color).toBe(CRACK_COLOR);
});
```

- [ ] **Step 6: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- overlay`
Expected: FAIL — `handleShapeIndex`가 `undefined`다.

- [ ] **Step 7: `overlay.js`를 도형 단위로 고친다**

`describeDamageRender`:

```js
/** @type {(damage: any, selectedId: string | null, number?: number | null, selectedShapeIndex?: number) => any} */
export function describeDamageRender(damage, selectedId, number = null, selectedShapeIndex = 0) {
  const type = getDamageType(damage.type);
  const selected = damage.id === selectedId;
  const isRect = damage.geometry.kind === 'rect';
  return {
    known: type !== null,
    shape: isRect ? 'polygon' : 'polyline',
    // 색은 손상 단위다 — 선택하면 복제본까지 모두 주황이다(설계 3.3).
    color: selected ? SELECTED_COLOR : CRACK_COLOR,
    selected,
    fillPattern: type && type.fill ? type.fill.pattern : null,
    fillSpacingMm: type && type.fill ? type.fill.spacingMm : null,
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    showHandles: selected && isRect,
    // 핸들은 선택된 **도형 하나**에만 그린다. 선택되지 않았거나 선형이면 null이다.
    handleShapeIndex: selected && isRect ? selectedShapeIndex : null,
  };
}
```

`createOverlay` 안의 상태와 `renderDamage`:

```js
  let selectedId = null;
  let selectedShape = 0;
```

```js
  // skipShape: 미리보기(draft)가 대신 보여주는 도형 번호. 그 도형만 빼고 나머지는 그대로 그린다 —
  // 예전에는 손상 전체를 건너뛰었지만, 복제본이 있으면 같이 사라져 보인다.
  function renderDamage(damage, number, elements, sizes, patternsNeeded, skipShape) {
    const plan = describeDamageRender(damage, selectedId, number, selectedShape);
    const width = plan.selected ? sizes.selectedLineWidthPx : sizes.lineWidthPx;

    let fillPatternId = null;
    if (plan.fillPattern) {
      // resolveFillPattern이 null이면(간격이 1px 미만) 무늬를 그리지 않고 테두리만 그린다.
      const resolved = resolveFillPattern(plan.fillPattern, plan.fillSpacingMm, sizes.pxPerMm);
      if (resolved) {
        fillPatternId = resolved.id;
        if (!patternsNeeded.has(resolved.id)) {
          patternsNeeded.set(resolved.id, { pattern: plan.fillPattern, sizePx: resolved.sizePx, lineWidthPx: resolved.lineWidthPx });
        }
      }
    }

    const shapes = shapesOf(damage);
    for (let index = 0; index < shapes.length; index++) {
      if (index === skipShape) continue;
      const screen = shapes[index].world.map((p) => mapper.worldToClient(p));
      if (plan.shape === 'polyline') {
        elements.push(polylineElement(screen, plan.color, width, 1));
      } else {
        elements.push(polygonElement(screen, plan.color, width, fillPatternId, 1));
      }

      // 번호 라벨은 첫 도형 위에만 그린다(설계 3.4). 복제본은 도형만이다.
      if (index === 0) renderLabel(damage, plan, screen, elements, sizes, width);

      if (plan.showHandles && index === plan.handleShapeIndex) {
        const handles = rectHandlePositions(screen);
        for (const corner of handles.corners) elements.push(handleElement(corner, 'rect'));
        elements.push(handleElement(handles.rotate, 'circle'));
      }
    }
  }
```

라벨 그리기는 함수로 뺀다(내용은 지금 코드 그대로다 — `placements` 조회부터 화살표까지):

```js
  function renderLabel(damage, plan, screen, elements, sizes, width) {
    // 겹침 방지를 한 도면은 미리 구해 둔 world 기준점을 화면 좌표로 옮겨 쓴다. 못 구한 도면은
    // 예전처럼 화면 좌표에서 도형 바로 위를 잡는다.
    const placement = placements ? placements.get(String(damage.id)) ?? null : null;
    const anchor = placement ? mapper.worldToClient(placement.anchor) : labelAnchor(screen, sizes.labelGapPx);
    const layout = labelLayout({
      anchor,
      name: plan.name,
      dimension: plan.dimension,
      photo: plan.photo,
      number: plan.number,
      fontPx: sizes.fontPx,
      circleRPx: sizes.circleRPx,
    });
    if (layout.circle) elements.push(numberCircleElement(layout.circle, plan.color, width));
    for (const textLine of layout.lines) {
      // 사진 줄만 노란색이다(도면의 `사진번호` 레이어와 같아 보이게). 선택해도 바뀌지 않는다.
      const color = textLine.key === 'photo' ? PHOTO_COLOR : plan.color;
      elements.push(labelTextElement(textLine, color, sizes.fontPx));
    }
    // 기본 자리를 벗어난 라벨에는 손상을 가리키는 화살표를 그린다(설계 4.4). 화살대와 화살촉을
    // 폴리라인 둘로 그린다 — 산출 DXF의 LINE 3개와 같은 모양이다.
    if (placement && placement.leader) {
      const from = mapper.worldToClient(placement.leader.from);
      const to = mapper.worldToClient(placement.leader.to);
      const head = placement.leader.head.map((point) => mapper.worldToClient(point));
      elements.push(polylineElement([from, to], plan.color, width, 1));
      elements.push(polylineElement([head[0], to, head[1]], plan.color, width, 1));
    }
  }
```

`render()`의 손상 반복문:

```js
    for (const damage of damages) {
      // 크기·회전·이동 중인 도형은 움직이는 draft가 대신 보여준다 — 그대로 두면 손 떼기 전 원래
      // 자리의 도형·핸들과 draft가 겹쳐 두 개로 보인다. 그 **도형 하나만** 뺀다.
      const skipShape = draft && draft.activeId != null && damage.id === draft.activeId ? draft.activeShape ?? 0 : null;
      renderDamage(damage, numbers.get(damage.id) ?? null, elements, sizes, patternsNeeded, skipShape);
    }
```

`setSelected`:

```js
    setSelected(id, shapeIndex = 0) {
      selectedId = id;
      selectedShape = shapeIndex;
      requestRender();
    },
```

- [ ] **Step 8: 테스트·문법 검사를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck && node --check server/public/viewer/crackTool.js && node --check server/public/viewer/overlay.js`
Expected: 모두 PASS

- [ ] **Step 9: 커밋**

```bash
git add server/public/viewer/crackTool.js server/public/viewer/overlay.js server/test/crackTool.test.ts server/test/overlay.test.ts
git commit -m "$(cat <<'EOF'
선택과 그리기를 도형 단위로 바꾼다

pickDamage가 손상 id와 함께 누른 도형 번호를 돌려주고, overlay는 손상의 도형을 전부 그린다.
선택된 손상은 복제본까지 모두 주황이고 핸들은 선택된 도형 하나에만 붙는다. 번호 라벨은 첫
도형 위에만 그린다. 복제본 자리(경계상자 너비의 1.2배 오른쪽)를 구하는 offsetShape를 더했다 —
세로로만 그은 선은 너비가 0이라 높이로 대신 옮긴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 복제본이 있는 손상을 화면에 제대로 그리고 도형 단위로 고를 수 있는 순수 로직. 아직 복제 버튼은 없다.

---

## Task 4: 도구막대 — 복제 버튼, 도형 단위 삭제, 첫 그리기 속성창

**Files:**
- Modify: `server/public/viewer/main.js`
- Modify: `server/public/viewer.html:16-24` (도구막대)
- 검증: 읽기 + `node --check`(DOM이 없어 node 테스트로는 확인할 수 없다 — 이 Task의 로직은 전부 앞 Task들에서 이미 단위 테스트된 함수를 잇는 글루다)

**Interfaces:**
- Consumes: `damageDoc.js`의 `duplicateShape(editor, damageId, shape, now)`·`removeShape(editor, damageId, shapeIndex, now)`·`updateShape(editor, damageId, shapeIndex, shape, now)`·`shapesOf(damage)`·`shapeCountOf(damage)`; `crackTool.js`의 `offsetShape(worldPoints, mapper)`·`pickDamage(...) → { id, shapeIndex } | null`; `overlay.setSelected(id, shapeIndex)`·`setDraft({ kind, points, activeId, activeShape })`.
- Produces: 없음(화면 글루).

- [ ] **Step 1: 도구막대에 버튼을 더한다**

`server/public/viewer.html`의 `#delete` 버튼 **앞**에 넣는다(복제 → 삭제 순서가 손에 익는 순서다):

```html
      <button id="undo" type="button" disabled>마지막 취소</button>
      <button id="duplicate" type="button" disabled>복제</button>
      <button id="delete" type="button" disabled>선택 삭제</button>
```

CSS는 손대지 않는다 — `viewer.css`의 `#toolbar button`·`#toolbar button:disabled` 규칙이 자식 버튼 전부에 이미 적용된다.

- [ ] **Step 2: `main.js`의 import와 선택 상태를 바꾼다**

첫 줄의 import를 고친다(`removeDamage`는 더 이상 쓰지 않는다 — `removeShape`가 마지막 도형일 때 안에서 부른다):

```js
import {
  addDamage,
  canUndo,
  createEditor,
  duplicateShape,
  migrateDoc,
  removeShape,
  shapeCountOf,
  shapesOf,
  undo,
  updateDamage,
  updateShape,
  validateDamageDoc,
} from './damageDoc.js';
```

`crackTool` import에 `offsetShape`를 더한다:

```js
import { createCrackInput, finalizeRect, finalizeStroke, offsetShape, pickDamage } from './crackTool.js';
```

`isFinitePoint`는 `onTransform`에서 계속 쓰므로 그대로 둔다.

선택 상태(`:171-174` 부근):

```js
  let editor = createEditor(initial.doc);
  // 선택은 (손상 id, 도형 번호)다. 0이 geometry, 1부터 copies[i-1](설계 3.3).
  let selectedId = null;
  let selectedShape = 0;
  // 유형 셀렉트박스를 조작한 뒤 **처음 그린** 손상에만 속성창을 연다(설계 3.1). 한 번 쓰면 꺼진다.
  let openPropsOnNextDamage = false;
```

- [ ] **Step 3: 유형 셀렉트박스에 깃발을 붙인다**

`:184-186`을 고친다. `change`가 나지 않는 "같은 값 다시 고르기"도 잡아야 하므로 `pointerup`도 본다:

```js
  $('damageType').value = activeTypeId;
  function armProps() {
    activeTypeId = $('damageType').value;
    openPropsOnNextDamage = true;
  }
  $('damageType').addEventListener('change', armProps);
  // 같은 유형을 다시 골라도 change가 나지 않으므로 pointerup도 본다(설계 3.1).
  $('damageType').addEventListener('pointerup', armProps);
```

- [ ] **Step 4: 선택 상태를 쓰는 함수들을 도형 단위로 고친다**

```js
  const selectedDamage = () => editor.doc.damages.find((damage) => damage.id === selectedId) ?? null;

  // 선택된 **도형**의 화면 좌표. crackTool의 getSelectedScreenShape로 넘긴다 — 모서리·회전 핸들
  // 판정은 kind === 'rect'일 때만 하고, 몸통을 끌어 옮기는 판정(hitSelectedShape)은 선·사각형
  // 모두에서 한다(설계 §4 "선택한 손상 이동"). 복제본도 첫 도형과 똑같이 끌 수 있다.
  function selectedScreenShape() {
    const damage = selectedDamage();
    if (!damage) return null;
    const shape = shapesOf(damage)[selectedShape];
    if (!shape) return null;
    return { kind: damage.geometry.kind, points: shape.world.map((point) => mapper.worldToClient(point)) };
  }

  // 선택 상태를 바꾸는 유일한 곳. 속성창은 선택이 바뀔 때마다 닫는다(다른 손상의 값이 남아있지
  // 않도록). 선택 자체가 속성창을 여는 일은 없다 — 여는 것은 사용자가 "속성"을 눌렀을 때와,
  // 유형을 고른 뒤 처음 그렸을 때(openPropsOnNextDamage)뿐이다.
  function setSelection(id, shapeIndex = 0) {
    selectedId = id;
    selectedShape = shapeIndex;
    $('propsPanel').hidden = true;
  }
```

`refresh()`:

```js
  function refresh() {
    overlay.setDamages(editor.doc.damages);
    overlay.setSelected(selectedId, selectedShape);
    $('undo').disabled = !canUndo(editor);
    $('delete').disabled = selectedId === null;
    $('duplicate').disabled = selectedId === null;
    $('props').disabled = selectedId === null;
    ...
  }
```

`handleTap`:

```js
  function handleTap(point) {
    if (coordCheck) {
      showCoordinates(point);
      return true;
    }
    const picked = pickDamage(editor.doc.damages, point, mapper);
    setSelection(picked ? picked.id : null, picked ? picked.shapeIndex : 0);
    refresh();
    return selectedId !== null;
  }
```

- [ ] **Step 5: 새로 그린 손상에 속성창을 연다**

`onStroke`·`onRect`의 마지막 두 줄(`setSelection(null); apply(addDamage(...));`)을 같은 도우미로 바꾼다. `createCrackInput({...})` 호출 **앞**에 둔다:

```js
  // 새 손상을 문서에 넣는다. 유형을 고른 뒤 처음 그린 손상이면 선택하고 속성창까지 연다(설계 3.1).
  // 깃발은 한 번 쓰면 꺼지므로 두 번째부터는 예전처럼 선택 없이 끝난다.
  function addNewDamage(damage) {
    const openNow = openPropsOnNextDamage;
    openPropsOnNextDamage = false;
    setSelection(openNow ? damage.id : null, 0);
    apply(addDamage(editor, damage, nowIso()));
    // apply → refresh가 overlay.setDamages로 번호를 다시 계산한 뒤라야 요약줄의 번호가 맞는다.
    if (openNow) openProps();
  }
```

`onStroke`·`onRect` 안에서:

```js
      setSelection(null);
      apply(addDamage(editor, damage, nowIso()));
```
→
```js
      addNewDamage(damage);
```

- [ ] **Step 6: 이동·크기·회전이 선택된 도형만 바꾸게 한다**

`onTransform`(`:292-316`)의 마지막 부분을 `updateShape`로 바꾼다. `computed` 계산은 `damageDoc.updateShape`가 갖는다(첫 도형일 때만 다시 센다 — 여기서 하면 복제본을 옮겨도 첫 도형 기준 값이 덮여 버린다):

```js
    onTransform: (screenPoints, status) => {
      const damage = selectedDamage();
      if (status === 'preview') {
        // activeId·activeShape를 같이 넘겨, 움직이는 draft 밑에 손 떼기 전 원래 도형·핸들이
        // 겹쳐 보이지 않게 한다. 같은 손상의 다른 도형은 그대로 보인다.
        const kind = damage ? damage.geometry.kind : 'rect';
        overlay.setDraft({ kind, points: screenPoints, activeId: selectedId, activeShape: selectedShape });
        return;
      }
      overlay.setDraft(null);
      // 취소는 아무것도 저장하지 않는다 — draft를 지운 것만으로 원래 문서 그대로 복원된다.
      if (status === 'cancel') return;
      if (!damage) return;
      const world = screenPoints.map(([x, y]) => mapper.clientToWorld(x, y));
      if (world.some((point) => point === null || !isFinitePoint(point))) return;
      const dwgPoints = world.map((point) => mapper.worldToDwg(point));
      const dwg = dwgPoints.every((point) => point !== null && isFinitePoint(point)) ? dwgPoints : null;
      // measured(사용자가 입력한 물량)는 건드리지 않는다 — 도형 수가 변하지 않으므로 개소도 그대로다.
      apply(updateShape(editor, damage.id, selectedShape, { world, dwg }, nowIso()));
    },
```

- [ ] **Step 7: 복제·삭제 버튼을 잇는다**

`$('undo')` 핸들러 다음에 복제를 넣고, `$('delete')` 핸들러를 고친다:

```js
  // 선택된 도형을 오른쪽으로 옮긴 자리에 복제한다(설계 3.2). 새 복제본을 선택해 두므로 사용자는
  // 바로 끌어서 제자리로 옮길 수 있다. 개소는 duplicateShape가 도형 수로 맞춘다.
  $('duplicate').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const shape = shapesOf(damage)[selectedShape];
    if (!shape) return;
    const copy = offsetShape(shape.world, mapper);
    // 크기가 0인 도형은 옮길 자리를 정할 수 없다 — 아무 일도 하지 않는다.
    if (!copy) return;
    // 복제본은 맨 뒤에 붙으므로 새 도형 번호는 지금 도형 수와 같다.
    setSelection(damage.id, shapeCountOf(damage));
    apply(duplicateShape(editor, damage.id, copy, nowIso()));
  });
  $('delete').addEventListener('click', () => {
    if (selectedId === null) return;
    const id = selectedId;
    const shapeIndex = selectedShape;
    setSelection(null);
    // 선택된 도형만 지운다. 첫 도형이면 복제본이 승격되고, 마지막 하나면 손상 자체가 사라진다.
    apply(removeShape(editor, id, shapeIndex, nowIso()));
  });
```

- [ ] **Step 8: 문법을 확인하고 눈으로 읽어 본다**

Run: `node --check server/public/viewer/main.js && npm --prefix server test && npm --prefix server run typecheck`
Expected: 모두 PASS

읽으며 확인할 것(체크리스트):
- `removeDamage`를 import에서 뺐는데 남아 있는 호출이 없는가 (`grep -n "removeDamage" server/public/viewer/main.js` → 0건)
- `setSelection`을 부르는 모든 자리가 새 서명과 맞는가 (`grep -n "setSelection(" server/public/viewer/main.js` — `undo`·`delete`·`handleTap`·`addNewDamage`·`duplicate`)
- `pickDamage` 결과를 문자열처럼 쓰는 곳이 남아 있지 않은가 (`grep -n "pickDamage" server/public/viewer/main.js` → `handleTap` 한 곳)
- `openProps()`가 `addNewDamage`보다 위에 선언돼 있는가 — 함수 선언(`function openProps`)이라 호이스팅되므로 순서와 무관하지만, 읽는 사람을 위해 확인한다

- [ ] **Step 9: 실기기에서 확인한다 (사용자와 함께)**

**서버를 다시 시작한 뒤**(schemaVersion 5) 태블릿에서:
1. 유형을 고르고 처음 그리면 속성창이 뜨고, 같은 유형으로 두 번째를 그리면 안 뜬다. 유형을 다시 고르면 또 뜬다.
2. 손상을 탭 → `복제` → 복제본이 오른쪽에 생기고 선택돼 있다 → 끌어서 제자리로 옮긴다 → 속성창의 개소가 2다.
3. 복제본 하나를 탭 → `선택 삭제` → 그 도형만 사라지고 개소가 1로 준다.
4. 첫 도형을 탭 → `선택 삭제` → 복제본이 남고 번호 라벨이 그 도형으로 옮겨간다.
5. `마지막 취소`로 복제가 한 번에 되돌아간다.

- [ ] **Step 10: 커밋**

```bash
git add server/public/viewer/main.js server/public/viewer.html
git commit -m "$(cat <<'EOF'
도구막대에 복제를 더하고 선택·삭제를 도형 단위로 바꾼다

유형 셀렉트박스를 조작한 뒤 처음 그린 손상에서만 속성창이 저절로 열린다(change가 나지 않는
같은 값 다시 고르기도 잡으려고 pointerup도 본다). 복제는 선택된 도형을 오른쪽으로 옮겨 붙이고
새 복제본을 선택해 둔다. 선택 삭제는 고른 도형 하나만 지운다. 이동·크기·회전도 고른 도형만
바꾸고, computed는 첫 도형일 때만 updateShape가 다시 센다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 태블릿에서 복제·도형 단위 삭제·첫 그리기 속성창이 실제로 동작한다. 산출 DXF는 아직 첫 도형만 그린다.

---

## Task 5: DXF 산출 — 도형 전부 그리기

**Files:**
- Modify: `server/src/export/damageEntities.ts:31-40, 158-205`
- Modify: `server/src/export/exportDrawing.ts:312-323`
- Test: `server/test/damageEntities.test.ts`, `server/test/exportDrawing.test.ts`

**Interfaces:**
- Consumes: Task 1의 `shapesOf(damage)`; 기존 `dwgPointsOf(damage)`(그대로 남는다 — `labelPlacement.ts`와 `exportDrawing.ts`가 첫 도형 판정에 쓴다).
- Produces:
  - `dwgShapesOf(damage): Array<Point[] | null>` — 도형 번호를 **그대로 유지한** dwg 점 목록. 좌표가 없는 도형은 `null`(걸러 내면 번호가 밀려 복제본을 첫 도형으로 오인한다)
  - `damageEntities(damage, alloc, owner, warnings?, points?)` — `points`를 주면 그 좌표로 그린다. 안 주면 지금처럼 `dwgPointsOf(damage)`를 쓴다

- [ ] **Step 1: `dwgShapesOf`의 실패 테스트를 쓴다**

`server/test/damageEntities.test.ts`에 더한다:

이 파일에는 이미 `damage(type, kind, dwg)` 헬퍼와 `RECT`·`owner` 상수, `new HandleAllocator(0x100)` 패턴이 있다. 그대로 쓰고 `copies`만 얹는다. import에 `dwgShapesOf`를 더한다.

```ts
describe('dwgShapesOf', () => {
  const COPY: Pt[] = [[20, 0], [30, 0], [30, 5], [20, 5]];

  it('첫 도형과 복제본을 도형 번호 순서대로 돌려준다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', RECT), copies: [{ world: COPY, dwg: COPY }] })).toEqual([RECT, COPY]);
  });

  it('좌표가 없는 도형은 번호 자리를 지키며 null이다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', null), copies: [{ world: COPY, dwg: COPY }] })).toEqual([null, COPY]);
  });

  it('복제본이 없으면 첫 도형 하나뿐이다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', RECT), copies: [] })).toEqual([RECT]);
    // copies가 아예 없는 옛 객체도 첫 도형 하나로 본다
    expect(dwgShapesOf(damage('spalling', 'rect', RECT))).toEqual([RECT]);
  });
});

describe('damageEntities(shapePoints)', () => {
  it('점 목록을 주면 그 자리에 그린다', () => {
    const moved = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner, undefined, [
      [20, 0], [30, 0], [30, 5], [20, 5],
    ]);
    // LWPOLYLINE 첫 꼭짓점(코드 10)이 옮긴 자리다
    expect(moved.find((p) => p.code === 10)!.value).toBe('20.0');
  });

  it('점 목록을 주지 않으면 지금처럼 첫 도형을 쓴다', () => {
    const first = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(first.find((p) => p.code === 10)!.value).toBe(`${RECT[0][0]}.0`);
  });
});
```

`RECT`의 첫 꼭짓점 x가 0이 아니면 마지막 기대값을 그 값으로 맞춘다(이 파일 위쪽에 선언된 상수를 그대로 읽는다).

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- damageEntities`
Expected: FAIL — `dwgShapesOf` 없음, `damageEntities`가 5번째 인자를 무시한다.

- [ ] **Step 3: `damageEntities.ts`를 고친다**

`dwgPointsOf`를 공용 변환기 위에 다시 쌓는다:

```ts
import { shapesOf } from '../../public/viewer/damageDoc.js';
```

```ts
// 점 배열 하나를 검사해 Point[]로 바꾼다. 한 점이라도 숫자가 아니면 그 도형은 그리지 않는다.
function pointsFrom(raw: unknown): Point[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const points: Point[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) return null;
    points.push([entry[0] as number, entry[1] as number]);
  }
  return points;
}

/** 첫 도형(geometry.dwg)의 점. 틀 배정·라벨 자리처럼 "손상 하나의 대표 좌표"가 필요한 곳이 쓴다. */
export function dwgPointsOf(damage: unknown): Point[] | null {
  return pointsFrom((damage as { geometry?: { dwg?: unknown } } | null)?.geometry?.dwg);
}

/**
 * 손상의 모든 도형(첫 도형 + 복제본)의 도면 좌표. **도형 번호를 그대로 유지한다** — 좌표가 없는
 * 도형을 걸러 내면 번호가 밀려 복제본이 첫 도형 자리로 올라온다(라벨·장애물 계산이 어긋난다).
 */
export function dwgShapesOf(damage: unknown): Array<Point[] | null> {
  return shapesOf(damage).map((shape) => pointsFrom(shape.dwg));
}
```

`damageEntities`에 점 목록 인자를 더한다:

```ts
export function damageEntities(
  damage: unknown,
  alloc: HandleAllocator,
  owner: string,
  warnings?: DamageEntitiesWarnings,
  shapePoints?: Point[] | null,
): DxfPair[] {
  // 도형이 여럿인 손상은 도형마다 한 번씩 부른다(설계 4장). 안 주면 첫 도형이다.
  const points = shapePoints ?? dwgPointsOf(damage);
  if (!points) return [];
  ...
```

나머지 본문은 그대로다 — 해치·기호는 이미 `points`만 보고 그린다.

- [ ] **Step 4: 테스트가 통과하는지 본다**

Run: `npm --prefix server test -- damageEntities`
Expected: PASS

- [ ] **Step 5: 산출 전체의 실패 테스트를 쓴다**

`server/test/exportDrawing.test.ts`의 `damage()` 헬퍼에 `copies`를 넣을 수 있게 고친다(기본은 빈 배열이라 기존 호출은 그대로다):

```ts
function damage(id: string, type: string, worldX: number, dwg: Pt[] | null, measured: Record<string, number | null> = {}, copies: Array<{ world: Pt[]; dwg: Pt[] | null }> = []) {
  const world: Pt[] = [[worldX, 0], [worldX + 10, 0], [worldX + 10, 10], [worldX, 10]];
  return {
    id,
    type,
    createdAt: '2026-09-15T00:00:00.000Z',
    geometry: { kind: 'rect', world, dwg },
    copies,
    measured: { width: null, length: null, count: null, ...measured },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}
```

그리고 테스트를 더한다. 기준값은 기존 `'도형·해치·라벨·표 글자를 모두 만든다'`(:80-91)에서 그대로 가져온다 — 박락(`spalling`) 손상 하나가 LWPOLYLINE 1·HATCH 1·CIRCLE 1(번호 원)·TEXT 9(라벨 3줄 + 표 6칸)를 만든다. 도형이 3개가 되면 **도형·해치만 3배**가 되고 라벨·표는 그대로다. 개소를 3으로 두면 `'3'` 글자는 개소 칸에만 나온다(번호는 1, 물량은 `1.2 × 1.5 × 3 = 5.4`, 단위는 `㎡`).

```ts
it('복제본이 있으면 도형·해치를 도형마다 그리고 라벨은 한 번만 그린다', async () => {
  const COPY_1: Pt[] = [[3200, 3200], [4200, 3200], [4200, 3300], [3200, 3300]];
  const COPY_2: Pt[] = [[4300, 3200], [5300, 3200], [5300, 3300], [4300, 3300]];
  const result = exportDamagesToDxf(await template(), [
    damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 3 }, [
      { world: COPY_1, dwg: COPY_1 },
      { world: COPY_2, dwg: COPY_2 },
    ]),
  ]);
  // 도형 3벌
  expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(3);
  expect(entityCount(result.dxfText, 'HATCH')).toBe(3);
  // 라벨은 첫 도형에 한 번 — 번호 원 1개, 글자는 라벨 3줄 + 표 6칸
  expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1);
  expect(entityCount(result.dxfText, 'TEXT')).toBe(9);
  // 물량표는 한 행이고 개소는 measured.count 그대로다
  expect(texts(result.dxfText).filter((t) => t.value === '3')).toHaveLength(1);
  expect(result.warnings).toEqual([]);
});

it('dwg가 없는 복제본은 건너뛰고 나머지는 그린다', async () => {
  const COPY_1: Pt[] = [[3200, 3200], [4200, 3200], [4200, 3300], [3200, 3300]];
  const result = exportDamagesToDxf(await template(), [
    damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 2 }, [
      { world: COPY_1, dwg: null },
    ]),
  ]);
  expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
  expect(result.skipped).toBe(0); // 첫 도형이 있으므로 손상 자체는 빠지지 않는다
});
```

넘침 장 복사에서도 복제본이 같이 옮겨지는지 본다. `describe('망도틀 넘침 — 틀을 통째로 복사한다')` 안에서 이미 쓰는 `twoFrames()`·`rightDamage(n)`를 그대로 쓴다(4개면 2장이 된다). 복제본 하나를 더하면 **장마다** 그려지므로 LWPOLYLINE이 2개 늘어난다:

```ts
it('넘침 장 복사에서 복제본도 장마다 같이 그려진다', async () => {
  const text = await twoFrames();
  const plain = exportDamagesToDxf(text, [1, 2, 3, 4].map(rightDamage));
  const copyPoints: Pt[] = [[52000, 3200], [52050, 3200], [52050, 3300], [52000, 3300]];
  const withCopy = exportDamagesToDxf(text, [
    { ...rightDamage(1), copies: [{ world: copyPoints, dwg: copyPoints }] },
    rightDamage(2),
    rightDamage(3),
    rightDamage(4),
  ]);
  // 틀이 2장이 되므로 도형 하나를 더하면 2벌이 늘어난다(장마다 그 틀의 손상 전부를 그린다).
  expect(entityCount(withCopy.dxfText, 'LWPOLYLINE') - entityCount(plain.dxfText, 'LWPOLYLINE')).toBe(2);
});
```

- [ ] **Step 6: 테스트를 돌려 실패를 확인한다**

Run: `npm --prefix server test -- exportDrawing`
Expected: FAIL — LWPOLYLINE이 1(기대 3), 넘침 차이가 0(기대 2).

- [ ] **Step 7: `exportDrawing.ts`의 그리기 반복문을 고친다**

import에 `dwgShapesOf`를 더하고(`import { damageEntities, dwgPointsOf, dwgShapesOf, type DamageEntitiesWarnings } from './damageEntities.js';`) 반복문을 고친다:

```ts
  for (const entry of included) {
    const label = labels.get(entry.id);
    // 손상 하나가 도형을 여럿 가질 수 있다(설계 4장). 도형마다 그리고 라벨은 첫 도형에 한 번만
    // 그린다. 넘침 장 복사는 손상 단위 이동량이므로 도형 반복을 dx 안쪽에 둔다 — 복제본도 장마다
    // 같이 옮겨진다.
    const shapes = dwgShapesOf(entry.damage);
    for (const dx of damageShiftsOf(entry)) {
      for (const points of shapes) {
        if (!points) continue;
        appendAll(pairs, translatePairs(damageEntities(entry.damage, alloc, owner, circleWarnings, points), dx, 0));
      }
      if (label) appendAll(pairs, translatePairs(labelEntities(label, alloc, owner), dx, 0));
    }
  }
```

`Included.points`(첫 도형)·`damageShiftsOf`·`frameIndexOf`·`boundsCenter`는 **손대지 않는다** — 틀 배정·이동량·표 고르기는 첫 도형으로 정한다는 규칙 그대로다(설계 4장).

- [ ] **Step 8: 테스트·타입 검사를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: 모두 PASS

- [ ] **Step 9: 커밋**

```bash
git add server/src/export/damageEntities.ts server/src/export/exportDrawing.ts server/test/damageEntities.test.ts server/test/exportDrawing.test.ts
git commit -m "$(cat <<'EOF'
산출 DXF에 복제본 도형도 그린다

damageEntities가 점 목록을 받을 수 있게 하고, dwgShapesOf가 도형 번호를 유지한 채 도형별 좌표를
준다(좌표가 없는 도형을 걸러 내면 번호가 밀려 복제본이 첫 도형으로 오인된다). 라벨은 첫 도형에
한 번, 표는 한 행(개소 = measured.count) 그대로다. 도형 반복을 넘침 이동량 안쪽에 둬 복제본도
장마다 같이 옮겨진다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 복제본 2개짜리 손상이 DXF에 도형 3벌·라벨 1벌·표 1행(개소 3)으로 나온다.

---

## Task 6: 문서 — 사용법·캐드 확인표·대체된 설계

**Files:**
- Modify: `README.md:63-95` (사용 절)
- Modify: `docs/DXF산출-테스트-결과.md` (확인표 **끝에 행만** 덧붙인다)
- Modify: `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` (개소 절)

**Interfaces:**
- Consumes: 앞 Task들에서 정해진 화면 문구(`복제`, `선택 삭제`)와 동작.
- Produces: 없음(문서).

- [ ] **Step 1: README에 복제와 속성창 자동 열기를 적는다**

`3. 아래 도구막대에서 …` 목록 안, `선택한 상태에서 **속성**을 열어 …` 줄 **앞**에 넣는다:

```markdown
   - 손상 유형을 고른 뒤 **처음 그린 손상**은 저절로 선택되고 속성창이 열립니다. 같은 유형으로 이어 그리면 열리지 않습니다(유형을 다시 고르면 또 열립니다)
   - 같은 크기의 손상이 여러 개면(사내 표기의 `2EA`, `3EA`) 하나를 그린 뒤 탭해 선택하고 **복제**를 누릅니다. 복제본이 오른쪽에 생기고 선택된 채로 있으니 그대로 끌어서 제자리로 옮기면 됩니다. **개소는 도형 수에 맞춰 저절로 바뀝니다**(속성창에서 직접 고칠 수도 있고, 다음 복제·삭제 때 다시 도형 수로 덮입니다)
   - 번호 라벨은 **첫 도형 위에만** 붙습니다. 복제본은 도형만 그려집니다
   - `선택 삭제`는 **고른 도형 하나만** 지웁니다. 첫 도형을 지우면 복제본 하나가 그 자리를 이어받아 번호 라벨이 그쪽으로 옮겨가고, 마지막 도형을 지우면 손상이 사라집니다
```

`손상을 탭 → \`선택 삭제\`, \`마지막 취소\`` 줄은 `손상을 탭 → \`복제\`, \`선택 삭제\`, \`마지막 취소\``로 고친다.

`5. 표기가 끝나면 …` 목록의 `- 손상마다 도형(선/사각형 + 유형별 해치·기호)과 라벨이 들어갑니다 …` 줄 다음에 넣는다:

```markdown
   - 복제한 손상은 **도형이 개수만큼** 그려지고 라벨과 물량표 행은 **하나**입니다(물량표의 개소가 그 개수입니다)
```

- [ ] **Step 2: 캐드 확인표에 행을 덧붙인다**

`docs/DXF산출-테스트-결과.md`의 마지막 표(43번으로 끝난다) **바로 뒤에** 행 네 줄을 잇는다. 표 아래의 `## 라벨 겹침 어림값` 이후 절과 사용자가 적어 둔 메모는 **건드리지 않는다.**

```markdown
| 44 | 복제한 손상의 도형이 **개수만큼** 그려져 있다 (3EA면 도형 3개) | | |
| 45 | 복제본에는 번호 라벨이 없고 **첫 도형에만** 번호 원·글자가 붙어 있다 | | |
| 46 | 물량표에 그 손상이 **한 행**만 있고 개소 칸이 도형 수와 같다 | | |
| 47 | 라벨이 복제본 도형 위에 얹히지 않았다 (겹치면 그 손상의 유형·위치를 적어 둘 것) | | |
```

- [ ] **Step 3: 대체된 설계에 안내 줄을 남긴다**

`docs/superpowers/specs/2026-09-13-damage-attributes-design.md`의 개소를 설명하는 표(`| 개소 | 개 | 개 | 0 이상의 정수 또는 빈 값 |`가 있는 표) **바로 아래**에 넣는다:

```markdown
> **2026-09-16 갱신:** 개소는 더 이상 손으로만 적는 값이 아니다. 손상 하나가 도형을 여럿 가질 수
> 있게 되면서(복제), **복제하거나 도형을 지울 때 개소가 그 시점의 도형 수로 자동으로 맞춰진다.**
> 사용자가 속성창에서 고친 값은 그대로 저장되지만 다음 복제·삭제 때 다시 도형 수로 덮인다.
> 복제본이 없는 손상은 이 문서 그대로 직접 적는다. 근거: `2026-09-16-duplicate-damage-design.md` 2장.
```

- [ ] **Step 4: 테스트를 돌려 아무것도 깨지지 않았는지 본다**

Run: `npm --prefix server test`
Expected: PASS (문서만 고쳤으니 그대로여야 한다)

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/DXF산출-테스트-결과.md docs/superpowers/specs/2026-09-13-damage-attributes-design.md
git commit -m "$(cat <<'EOF'
복제와 첫 그리기 속성창을 README와 캐드 확인표에 반영한다

확인표에 44~47번(도형 개수, 라벨 하나, 표 한 행·개소, 라벨-복제본 겹침)을 더했다. 개소가
도형 수로 자동으로 맞춰진다는 규칙을 2026-09-13 설계의 개소 절에 안내 줄로 남긴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 사용자가 복제를 어떻게 쓰는지, 캐드에서 무엇을 확인해야 하는지 알 수 있고, 옛 설계를 읽어도 새 규칙으로 안내된다.

---

## 검증 명령 모음

작업 중 언제든 아래를 돌린다.

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/viewer/damageDoc.js
node --check server/public/viewer/crackTool.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/labelCollision.js
node --check server/public/viewer/main.js
```

한 Task만 빨리 보고 싶으면 `npm --prefix server test -- damageDoc`처럼 파일 이름 조각을 붙인다.

**실기기 확인 전에 서버를 반드시 다시 시작한다.** 서버는 `damageDoc.js`를 그대로 import해 검증하므로, 켜 둔 채로 앱을 새로 고치면 저장이 `schemaVersion은 5여야 합니다`(또는 그 반대)로 막힌다.

실기기·캐드 확인은 Task 4 Step 9의 다섯 가지와 Task 6의 확인표(`docs/DXF산출-테스트-결과.md` 44~47번)로 사용자와 함께 본다. **핵심은 복제 → 끌어 옮기기 → 개소가 저절로 2·3으로 바뀌는지**와 **복제본 하나만 지웠을 때 그것만 사라지는지**다.

## 손으로 계산한 테스트 리터럴 (출처)

| 값 | 출처 |
|---|---|
| `offsetShape` 이동량 2.4 | world 사각형 `[[0,0],[2,0],[2,1],[0,1]]`의 너비 2 × `DUPLICATE_OFFSET_FACTOR` 1.2 |
| `offsetShape` dwg `[[1002.4, 2000], …]` | 픽스처 mapper의 `worldToDwg = world + (1000, 2000)` |
| 세로선 이동량 12 | world `[[5,0],[5,10]]`의 너비 0 → 높이 10 × 1.2 |
| `pickDamage` 복제본 화면 좌표 x 200~300, y 100~200 | 픽스처 mapper(화면 10px = world 1, y 반전)로 world `[[20,-10],[30,-10],[30,-20],[20,-20]]`을 옮긴 값 |
| `placeLabels` 기본 자리 `[100, 300]` | 경계상자 `(0,0)-(200,200)`의 가운데 x = 100, `maxY + gap` = 200 + 100 |
| `placeLabels` 위 k=1 `[100, 400]` | 기본 자리에서 블록 높이 100만큼 위 |
| 장애물 `(0,250)-(300,400)`이 기본 자리를 막는 이유 | 기본 상자 `{x:50,y:300,w:100,h:100}`과 장애물 상자 `{x:0,y:250,w:300,h:150}`이 겹친다. 위 k=1 상자 `{x:50,y:400,…}`는 장애물 위쪽 끝 400과 **닿기만** 하므로 `boxesOverlap`이 false다 |
| 승격된 복제본의 `areaDwg` 2 | dwg 사각형 `[[15,10],[17,10],[17,11],[15,11]]`의 넓이 = 2 × 1 |
| `updateShape` 후 `areaDwg` 4 | dwg `[[10,10],[14,10],[14,11],[10,11]]`의 넓이 = 4 × 1 |
| `updateShape` 후 `lengthDwg` 50 | dwg `[[0,0],[30,40]]`의 길이 = √(30² + 40²) |
| 산출 LWPOLYLINE 3·HATCH 3·CIRCLE 1·TEXT 9 | 기존 테스트 `'도형·해치·라벨·표 글자를 모두 만든다'`(박락 1개 = 1·1·1·9)에서 도형 수만 3배 |
| 산출 TEXT `'3'`이 한 번 | 번호 1, 개소 3, 물량 `1.2 × 1.5 × 3 = 5.4`, 단위 `㎡` — `3`은 개소 칸에만 나온다 |
| 넘침 LWPOLYLINE 차이 2 | 픽스처 데이터 행 3 + 손상 4개 → 2장. 도형 하나를 더하면 장마다 한 벌씩 = 2 |

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 1장 사용자 요구 ①(유형 고른 뒤 첫 그리기 속성창) | 4 |
| 1장 사용자 요구 ②(같은 손상 nEA를 복제로) | 1·3·4·5 |
| 1장 결정 — 라벨은 첫 도형에만 | 3(화면) · 5(산출) |
| 1장 결정 — 개소는 도형 수 자동, 속성창에서 수정 가능 | 1(`duplicateShape`·`removeShape`) |
| 1장 결정 — 복제본 하나만 삭제 | 1(`removeShape`) · 4(버튼) |
| 1장 결정 — 사진번호는 그대로 | — (건드리지 않음) |
| 2장 `copies` 형식(kind는 geometry와 같음) | 1 |
| 2장 검증 규칙(배열·점 개수·dwg) | 1 |
| 2장 v4 → v5 이행, `SCHEMA_VERSION = 5` | 1 |
| 2장 **서버 재시작 필수** | 1(커밋 메시지) · 6(확인 절차) · 검증 명령 모음 |
| 2장 `shapeCountOf` | 1 |
| 2장 개소 자동 규칙(복제·삭제 때 항상 덮어쓴다) | 1 |
| 2장 `dimensionTextOf`의 ` nEA`는 그대로 | — (건드리지 않음) |
| 3.1 셀렉트박스 `change`·`pointerup`으로 깃발을 켠다 | 4 |
| 3.1 새 손상 저장 때 한 번만 쓰고 끈다 | 4 |
| 3.1 복제·이동·탭은 깃발과 무관 | 4 (깃발을 건드리지 않는다) |
| 3.2 복제 버튼(선택 있을 때만 활성) | 4 |
| 3.2 경계상자 너비 + 20% 오른쪽 | 3(`offsetShape`) |
| 3.2 복제본의 dwg는 `worldToDwg`로 만든다 | 3(`offsetShape`) |
| 3.2 새 복제본을 선택한다 | 4 |
| 3.2 되돌리기가 복제·삭제를 한 번에 되돌린다 | 1(`commit` 한 번) |
| 3.3 선택 = (id, shapeIndex), `pickDamage`가 도형 번호도 준다 | 3 · 4 |
| 3.3 선택된 손상의 모든 도형 주황, 핸들은 선택 도형만 | 3 |
| 3.3 이동·크기·회전은 선택 도형만, computed는 첫 도형일 때만 | 1(`updateShape`) · 4 |
| 3.3 선택 삭제 = 도형 하나, 첫 도형이면 승격, 마지막이면 손상 삭제 | 1 · 4 |
| 3.3 속성창은 손상 단위 | 4 (`selectedDamage()`가 id만 본다 — 바꿀 것이 없다) |
| 3.4 overlay가 모든 도형을 같은 스타일로 | 3 |
| 3.4 라벨은 첫 도형 위에만 | 3 |
| 3.4 겹침 장애물에 복제본 경계상자 | 2 |
| 3.4 번호·틀 배정은 첫 도형(`computeNumbers`·`frameIndexOf` 불변) | — (건드리지 않음, Task 5에서 확인) |
| 4장 산출에서 도형마다 그린다 | 5 |
| 4장 라벨은 첫 도형에 한 번 | 5 |
| 4장 겹침 장애물(화면과 같은 입력) | 2 |
| 4장 물량표 한 행, 개소 = `measured.count` | 5(테스트로 고정) |
| 4장 넘침 장 복사·틀 이동은 손상 단위 | 5 |
| 4장 틀 밖 판정은 첫 도형으로 | 5(`Included.points`를 그대로 둔다) |
| 5장 바뀌지 않는 것(문구·라벨 모양·번호·틀·표·속성창) | — (건드리지 않음) |
| 6장 `damageDoc` 단위 테스트 | 1 |
| 6장 `pickDamage` 단위 테스트 | 3 |
| 6장 `overlay` 단위 테스트 | 2 · 3 |
| 6장 산출 단위 테스트 | 5 |
| 6장 화면 글루는 읽기 + `node --check` | 4 |
| 6장 실기기 확인 | 4(Step 9) · 6(확인표) |
| 7장 미해결 — 복제본이 다른 틀에 걸치면 첫 도형의 틀 | 5(구현) |
| 7장 미해결 — 복제본에 번호가 없다 | 6(확인표 45번으로 사용자와 확인) |
| 7장 미해결 — 첫 도형을 지우면 번호가 바뀔 수 있다 | 1(승격) · 6(README에 명시) |
