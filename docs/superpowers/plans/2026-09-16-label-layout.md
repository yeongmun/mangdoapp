# 라벨 배치 개정 구현 계획 — 원 옆 글자, 들여쓰기, 사진번호 레이어, 겹침 방지

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 손상 라벨을 사내 망도 표기에 맞춘다 — 번호 원 **옆**에 첫 줄 글자를 붙이고(균열은 치수), 둘째 줄부터 그 글자의 x에 들여쓰며, 사진번호는 `#12, #13` 형식으로 노란 `사진번호` 레이어에 넣고, 붙어 있는 손상들의 라벨이 겹치면 빈 자리로 옮기고 화살표로 손상을 가리킨다. 앱 화면과 산출 DXF가 **같은 배치 코드 한 벌**을 쓴다.

**Architecture:** 배치 규칙을 두 벌로 베끼지 않는다. 순수 JS 모듈 두 개(`server/public/viewer/labelLayout.js` — 줄 구성·들여쓰기·블록 경계상자, `server/public/viewer/labelCollision.js` — 후보 자리 탐색·겹침 판정·화살표 기하)가 **단위와 좌표계를 가리지 않고** 계산하고, 화면(`overlay.js`)과 DXF(`server/src/export/labelPlacement.ts`)는 그 결과를 각자의 좌표로 옮겨 그리는 **얇은 어댑터**가 된다. 순수 모듈의 좌표계는 **도면 방향(y가 위로 증가)** 하나뿐이다 — 앱의 world 좌표도 같은 방향이므로 화면도 그대로 쓰고, 화면 픽셀(y가 아래로 증가)로의 뒤집기는 `placeBlock(block, anchor, yDir)`의 `yDir = -1` **한 곳에서만** 일어난다. 겹침 계산은 손상 목록이 바뀔 때 번호 캐시와 같은 자리에서 **한 번만** 돌고(매 프레임이 아니다), 도면 좌표 변환을 구하지 못한 도면(`mmPerWorld` 없음)에서는 아예 돌지 않는다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict), Express 5, vitest, 빌드 없는 ES 모듈 브라우저 JS(`server/public/viewer/*.js`, `allowJs: true`). 테스트는 **DOM 없이 node에서** 돌므로 배치·겹침 로직은 전부 순수 함수여야 하고, `createOverlay`의 DOM 코드와 `main.js`는 읽기 + `node --check`로 확인한다. Expo 앱은 이번 계획에서 **변경 없음**.

**Spec:** `docs/superpowers/specs/2026-09-16-label-layout-design.md`
이 문서가 아래 두 곳의 라벨 배치 규칙을 **대체**한다(문구 생성 함수와 크기 값은 그대로):
- `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` §5.2·§9.5
- `docs/superpowers/specs/2026-09-15-dxf-export-design.md` 6장

그대로 유효해 이 계획이 따르는 앞선 설계:
- `docs/superpowers/specs/2026-09-12-damage-types-design.md` 5장 — 실치수 기준 표시(확대·축소하면 글자·무늬가 같이 커진다), 조작 핸들은 화면 고정, 도면 좌표 변환을 못 구한 도면은 화면 고정 크기

---

## Global Constraints

스펙에서 그대로 옮긴 구속값이다. 구현 중 판단이 갈리면 여기를 기준으로 한다.

### 작업 안전 규칙 (모든 Task에 적용)

- **`git checkout` / `git restore` / `git stash`를 절대 실행하지 않는다.** 앞선 작업에서 이 명령이 작성 중이던 문서를 통째로 날린 적이 있다. 되돌리고 싶으면 파일을 직접 고쳐라.
- `git add .` / `git add -A` / `git commit -a`를 쓰지 않는다. **파일 이름을 하나씩 적어** `git add <경로> <경로>` 로만 스테이징한다.
- `server/data/`, `.env`, `docs/*.dxf`, `docs/*.bak`는 커밋 대상이 아니다(`.gitignore`).
- 모든 커밋 메시지의 마지막 줄은 정확히 다음과 같다(글자 하나도 다르면 안 된다):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- 커밋 제목과 본문은 한국어로 쓴다.
- 작업 브랜치는 `feat/label-layout`이다.

### 라벨 모양 (스펙 2장)

```
⑰ 0.2/0.3            ⑰ 파손               ⑰ 표면 오염
   #12                   0.3x0.3               1.2x1.2
                         #12, #13
```

- **첫 줄**: 번호 원 + 글자 A. 균열(`crack`)은 A = 치수(`dimensionTextOf`). 다른 유형은 A = 이름(`drawingNameOf`; 기타는 손상현황).
- **둘째 줄부터**: 균열은 사진 줄. 다른 유형은 치수 줄, 사진 줄. 없는 줄은 건너뛰어 **빈 줄을 남기지 않는다.**
- **정렬**: 둘째 줄부터는 A의 왼쪽 x에 맞춘다(왼쪽 정렬). 첫 줄의 원은 A 왼쪽에 놓인다. 라벨 블록 전체(원 + 가장 긴 줄)는 기준점 x에 **가운데 맞춘다.**
- 번호가 없으면 **원 없이** A부터 시작한다. A가 없으면 **원만** 그린다.
- 글자 높이 300, 원 반지름 255(= 300 × 0.85), 줄 간격 `LINE_GAP_FACTOR`(1.3), 원과 글자 사이 간격 `CIRCLE_TEXT_GAP_FACTOR`(0.5 × 원 반지름), 베이스라인→중심 `BASELINE_CENTER_FACTOR`(0.35). **도면 실치수 기준**이며 확대·축소에 따라 같이 커진다.

### 사진번호 (스펙 3장)

- 문구: 입력값 앞에 `#`만 붙이고 여러 장은 `, `로 잇는다 — `#12, #13`. **`사진 ` 접두어는 없앤다.**
- DXF: 사진 줄 `TEXT`는 레이어 **`사진번호`**, 색 **2(노랑)**. 레이어가 없으면 `신규손상`과 같은 방식으로 추가한다.
- 화면: 사진 줄 글자를 **노란색 `#f5c400`**으로 그린다. **선택 시에도 노란색 그대로.**
- 물량표에는 넣지 않는다(변함없음).

### 겹침 방지 (스펙 4장)

- 라벨 블록 경계상자는 **다른 손상의 도형 경계상자**(자기 손상 제외)·**이미 자리를 잡은 다른 라벨의 경계상자**와 겹치면 안 된다.
- **번호 순서**(`computeNumbers`)대로 한 손상씩 자리를 잡는다. 앞번호가 좋은 자리를 먼저 차지한다. 같은 손상 집합이면 **넣은 순서와 상관없이 항상 같은 결과**가 나온다.
- 기본 자리 = 손상 경계상자 **바로 위**, 간격 100, 가운데 맞춤. 비어 있으면 그대로 쓴다.
- 막혀 있으면 `k = 1..8`마다 **위 → 오른쪽 → 왼쪽 → 아래** 차례로 본다(`h` = 라벨 블록 높이).
  - 위 `k`: 기본 자리에서 위로 `k·h`
  - 오른쪽 `k`: 경계상자 오른쪽에 간격 100, 세로는 경계상자 중앙, `k`마다 오른쪽으로 `h` 더
  - 왼쪽 `k`: 왼쪽에 같은 방식
  - 아래 `k`: 경계상자 아래 간격 100, `k`마다 아래로 `h` 더
- 처음 비어 있는 자리를 쓴다. **`k = 8`까지 다 막혀 있으면 위로 `8h` 자리를 그냥 쓴다**(겹치더라도 라벨은 반드시 그린다).
- **화살표**(기본 자리를 벗어난 라벨에만):
  - 시작 = 라벨 블록 경계상자에서 손상에 가장 가까운 변의 **중점**
  - 끝 = 손상 경계상자에서 시작점에 가장 가까운 점(변 위)
  - 화살촉 = 끝점에서 길이 **150**(글자 높이의 절반), 벌어진 각 **30°**인 짧은 선 **두 개**
  - 화면: 빨간 선, 굵기는 손상 선과 같음. DXF: `LINE` **3개**, 레이어 `신규손상`, 색 1
  - **기본 자리에 놓인 라벨에는 그리지 않는다**
- **계산 단위와 시점**:
  - 배치 함수는 단위를 가리지 않는다 — 경계상자와 라벨 크기를 **같은 단위**로 받아 그 단위로 답한다.
  - DXF: `geometry.dwg`(mm)와 mm 치수(글자 300 등)를 그대로 넣는다.
  - 화면: `geometry.world`와, mm 치수를 `mmPerWorld`로 나눈 값을 넣는다. **손상 목록이 바뀔 때 한 번만** 계산해 두고 매 프레임은 옮겨 그리기만 한다.
  - `mmPerWorld`를 구하지 못한 도면은 지금처럼 화면 고정 크기로 그리고 **겹침 방지를 하지 않는다.**
  - 글자 폭은 지금처럼 어림한다(아스키 0.55배, 그 밖 1.0배). 조금 겹칠 수 있고 그 정도는 받아들인다.
- 라벨 자리는 **저장하지 않는다.** 손상 목록이 바뀔 때마다 다시 돌린다.

### 바뀌지 않는 것 (스펙 5장)

- 번호 규칙(`computeNumbers`), 손상현황·치수 문구(`statusTextOf`·`drawingNameOf`·`dimensionTextOf`), 글자 높이·원 반지름·간격 값
- 물량표 채우기(2026-09-15 7장), 손상 도형·해치·기호 출력

### 좌표계 규칙 (이 계획이 정한 구현 규약)

- **순수 모듈(`labelLayout.js`·`labelCollision.js`)의 좌표계는 도면 방향 하나뿐이다 — y가 위로 증가한다.** 앱의 world 좌표도 같은 방향이라 화면 계산도 그대로 쓴다.
- 화면 픽셀(y가 아래로 증가)로의 **뒤집기는 `placeBlock(block, anchor, yDir)`의 `yDir = -1` 한 곳에서만** 일어난다. 호출하는 곳은 `overlay.js`의 `labelLayout` 하나뿐이다.
- 상자는 언제나 `{ x, y, width, height }`이고 `(x, y)`는 **그 좌표계에서 작은 쪽 모서리**다(y가 위로면 아래 변, 아래로면 위 변).

---

## File Structure

```
server/public/viewer/labelLayout.js       생성: 라벨 줄 구성·들여쓰기·블록 경계상자. 단위·좌표계 무관 순수 함수
server/public/viewer/labelCollision.js    생성: 후보 자리 탐색·상자 겹침 판정·화살표 기하. 단위 무관 순수 함수
server/public/viewer/geometry.js          수정: boundsOf(점 목록 → 경계상자) 추가
server/public/viewer/quantities.js        수정: photoTextOf가 '#12, #13'을 만든다 ('사진 ' 접두어 제거)
server/public/viewer/overlay.js           수정: 배치 모듈의 화면 어댑터로 얇게. 배치 캐시·화살표·노란 사진 줄
server/src/export/labelPlacement.ts       수정: 같은 모듈의 DXF 어댑터. y 뒤집기 제거, 줄별 레이어, 화살표 LINE
server/src/export/dxfDocument.ts          수정: PHOTO_LAYER('사진번호')·PHOTO_COLOR(2) 상수 추가
server/src/export/exportDrawing.ts        수정: 손상 전체를 모아 한 번에 배치, 사진번호 레이어 추가

server/test/labelLayout.test.ts           생성: 줄 구성·들여쓰기·블록 상자·좌표계 뒤집기
server/test/labelCollision.test.ts        생성: 겹침 판정·후보 순서·자리 잡기·화살표
server/test/geometry.test.ts              수정: boundsOf
server/test/quantities.test.ts            수정: photoTextOf 문구
server/test/overlay.test.ts               수정: 새 라벨 배치, computeLabelPlacements
server/test/labelPlacement.test.ts        수정: 새 라벨 배치, 사진 레이어, 화살표 엔티티
server/test/exportDrawing.test.ts         수정: 붙어 있는 손상 두 개의 라벨 어긋남과 화살표 LINE 3개

README.md                                 수정: 라벨 설명(원 옆 글자, 사진번호 레이어, 화살표)
docs/DXF산출-테스트-결과.md                수정: 확인표에 라벨 어긋남·화살표·사진번호 레이어 행 추가
docs/superpowers/specs/2026-09-13-damage-attributes-design.md   수정: §5.2·§9.5에 대체 안내 한 줄
docs/superpowers/specs/2026-09-15-dxf-export-design.md          수정: 6장에 대체 안내 한 줄
```

책임 한 줄 요약:

- `labelLayout.js` — **한 손상의 라벨이 어떻게 생겼는가.** 줄 목록, 들여쓰기 x, 원 위치, 블록 경계상자를 기준점 대비 상대 좌표로 낸다. 다른 손상을 모른다.
- `labelCollision.js` — **그 블록을 어디에 놓을 것인가.** 여러 손상의 경계상자와 블록을 받아 손상마다 기준점·상자·어긋남 여부·화살표를 낸다. 글자 내용을 모른다.
- `overlay.js` — 위 둘을 **화면 픽셀**로 옮겨 SVG로 그린다. 배치 캐시를 들고 있다.
- `labelPlacement.ts` — 위 둘을 **도면 mm**로 옮겨 DXF 엔티티 쌍으로 만든다.
- `exportDrawing.ts` — 산출할 손상을 **모두 모은 뒤** 한 번에 배치를 구해 각 손상의 엔티티를 만든다.

> 이름이 같고 뜻이 다른 상수가 하나 생긴다: `overlay.js`의 `PHOTO_COLOR`는 화면 색 `'#f5c400'`이고, `dxfDocument.ts`의 `PHOTO_COLOR`는 DXF 색 번호 `2`다. 같은 노란색을 각 세계의 표현으로 적은 것이다. **한 파일에서 둘을 같이 가져오지 않는다** — `labelPlacement.ts`와 `exportDrawing.ts`는 DXF 쪽만, `overlay.js`는 화면 쪽만 쓴다.

---

## Task 1: 사진번호 문구를 `#12, #13`으로 바꾼다

가장 작고 독립적인 변경이라 먼저 한다. 문구를 만드는 함수는 화면과 DXF가 **같은 파일**을 쓰므로 여기 한 곳만 고치면 둘 다 바뀐다. 테스트 세 파일의 기대 문구도 같이 고친다.

**Files:**
- Modify: `server/public/viewer/quantities.js`
- Modify: `server/test/quantities.test.ts`
- Modify: `server/test/overlay.test.ts`
- Modify: `server/test/labelPlacement.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `photoTextOf(damage: unknown): string` — `['12','13']` → `'#12, #13'`, 빈 배열·`attrs` 없음 → `''`

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`server/test/quantities.test.ts`의 `describe('photoTextOf', ...)` 블록(408행부터)을 아래로 **교체**한다:

```ts
describe('photoTextOf', () => {
  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
  // '사진 ' 접두어를 없애고 번호마다 '#'를 붙인다.
  it('번호마다 #를 붙이고 쉼표+공백으로 잇는다', () => {
    const damage = { id: 'a', type: 'crack', attrs: { note: '', statusText: '', photoNumbers: ['12', '13', '15'] } };
    expect(photoTextOf(damage)).toBe('#12, #13, #15');
  });

  it('한 장이면 #만 붙는다', () => {
    const damage = { id: 'a', type: 'crack', attrs: { note: '', statusText: '', photoNumbers: ['12'] } };
    expect(photoTextOf(damage)).toBe('#12');
  });

  it('숫자가 아닌 번호(P-013·012)도 그대로 둔다 — 사진 파일 이름과 짝을 맞춰야 한다', () => {
    const damage = { id: 'a', type: 'crack', attrs: { note: '', statusText: '', photoNumbers: ['012', 'P-013'] } };
    expect(photoTextOf(damage)).toBe('#012, #P-013');
  });

  it('photoNumbers가 빈 배열이면 빈 문자열', () => {
    const damage = { id: 'a', type: 'crack', attrs: { note: '', statusText: '', photoNumbers: [] } };
    expect(photoTextOf(damage)).toBe('');
  });

  it('attrs나 photoNumbers가 없어도 던지지 않고 빈 문자열', () => {
    expect(photoTextOf({ id: 'a', type: 'crack' })).toBe('');
    expect(photoTextOf({ id: 'a', type: 'crack', attrs: {} })).toBe('');
  });
```

(닫는 `});`는 원래 것을 그대로 둔다.)

`server/test/overlay.test.ts` 150행의 기대값을 바꾼다:

```ts
    expect(describeDamageRender(withPhotos, null).photo).toBe('#12, #13');
```

`server/test/labelPlacement.test.ts`의 사진 문구 세 군데를 바꾼다(78~94행):

```ts
  it('사진번호가 있으면 맨 아래 줄이 사진 줄이다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const photo = label.lines.find((l) => l.text === '#12, #13')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    expect(dimension.position[1] - photo.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('치수가 없으면 사진 줄이 그 자리로 올라온다 — 빈 줄을 남기지 않는다', () => {
    const label = damageLabel(rect('spalling', {}, { photoNumbers: ['12'] }), 7)!;
    expect(label.lines.map((l) => l.text)).toEqual(['7', '박락', '#12']);
    const photo = label.lines.find((l) => l.text === '#12')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
  });
```

`server/test/overlay.test.ts`의 `labelLayout` 테스트에 들어 있는 `'사진 12, 13'`·`'사진 5'`·`'사진 1'` 문자열은 **함수에 직접 넘기는 값**이라 동작이 바뀌지 않는다. Task 2에서 그 블록을 통째로 다시 쓰므로 지금은 건드리지 않는다.

```bash
npm --prefix server test
```

기대: `quantities.test.ts`·`overlay.test.ts`·`labelPlacement.test.ts`의 사진 문구 테스트가 실패한다.

- [ ] **Step 2: `photoTextOf`를 고친다**

`server/public/viewer/quantities.js`의 196~202행을 아래로 교체한다:

```js
// 도면 라벨의 사진 줄 문구(2026-09-16 설계 3장). 번호마다 '#'를 붙이고 ', '로 잇는다:
// ['12','13'] → '#12, #13'. 없거나 비어 있으면 빈 문자열. attrs가 없는 손상도 던지지 않는다.
// '사진 ' 접두어는 2026-09-16에 없앴다 — 사내 망도 표기가 '#001' 형식이다.
// 번호를 숫자로 바꾸지 않는다('012'·'P-013'을 그대로 둔다, 9.2).
export function photoTextOf(damage) {
  const photoNumbers = damage?.attrs?.photoNumbers;
  if (!Array.isArray(photoNumbers) || photoNumbers.length === 0) return '';
  return photoNumbers.map((value) => `#${value}`).join(', ');
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/viewer/quantities.js
```

```bash
git add server/public/viewer/quantities.js server/test/quantities.test.ts server/test/overlay.test.ts server/test/labelPlacement.test.ts
git commit -m "$(printf '%s\n' '사진번호 문구를 #12, #13으로 바꾼다' '' '사내 망도 표기에 맞춰 사진 접두어를 없애고 번호마다 #를 붙인다.' '문구 함수는 화면과 DXF가 같은 파일을 쓰므로 한 곳만 고치면 둘 다 바뀐다.' '' '근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 화면과 DXF의 사진 줄이 `#12, #13`으로 나온다.

---

## Task 2: 라벨 줄 구성·들여쓰기를 순수 모듈로 빼고 규칙을 바꾼다

배치 규칙을 `labelLayout.js` 한 벌로 모은다. 단위를 가리지 않고(글자 높이·원 반지름을 넣은 단위 그대로 답한다), 좌표계는 **도면 방향(y가 위로)** 하나다. 화면 픽셀로의 뒤집기는 `placeBlock`의 `yDir = -1` 한 곳에서만 일어나고, 그래서 `labelPlacement.ts`에 있던 y 부호 뒤집기가 **사라진다.**

규칙이 바뀌는 지점은 셋이다.

1. 첫 줄 글자 A = 이름이 있으면 이름, 없으면 치수(균열은 `drawingNameOf`가 `''`을 주므로 자동으로 치수가 올라온다). A가 치수로 올라가면 치수 줄을 또 그리지 않는다.
2. 모든 글자 줄이 **왼쪽 정렬**이고 x가 같다(A의 왼쪽 x). 가운데 정렬은 번호 글자(원 안)뿐이다.
3. 블록 전체(원 + 가장 긴 줄)를 기준점 x에 가운데 맞춘다.

경계상자도 여기서 낸다 — Task 3의 겹침 판정이 쓸 `h`(블록 높이)와 `w`(블록 폭)가 이 상자에서 나온다.

**Files:**
- Create: `server/public/viewer/labelLayout.js`
- Create: `server/test/labelLayout.test.ts`
- Modify: `server/public/viewer/geometry.js`
- Modify: `server/test/geometry.test.ts`
- Modify: `server/public/viewer/overlay.js`
- Modify: `server/test/overlay.test.ts`
- Modify: `server/src/export/labelPlacement.ts`
- Modify: `server/test/labelPlacement.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 모듈)
- Produces (`server/public/viewer/geometry.js`):
  - `boundsOf(points: number[][]): { minX, minY, maxX, maxY } | null` — 유한하지 않은 점은 건너뛰고, 쓸 점이 하나도 없으면 `null`
- Produces (`server/public/viewer/labelLayout.js`):
  - `CIRCLE_TEXT_GAP_FACTOR = 0.5`, `LINE_GAP_FACTOR = 1.3`, `BASELINE_CENTER_FACTOR = 0.35`
  - `estimateTextWidth(text: string, font: number): number`
  - `labelBlock({ name, dimension, photo, number, font, circleR }): LabelBlock`
    - `LabelBlock = { circle: { dx, dy, r } | null, lines: Array<{ dx, dy, text, align: 'middle' | 'start', key: 'number'|'name'|'dimension'|'photo' }>, box: { dx, dy, width, height }, height: number }`
    - `dx`·`dy`는 **기준점 대비 상대 좌표(y가 위로)**. `box.dy`는 상자 **아래 변**, `box.dx = -width / 2`.
  - `placeBlock(block: LabelBlock, anchor: [number, number], yDir?: 1 | -1)` → `{ circle: { cx, cy, r } | null, lines: Array<{ x, y, text, anchor, key }>, box: { x, y, width, height } }` — `yDir` 기본값 1(도면·world), `-1`이면 화면 픽셀
  - `blockBoxAt(block: LabelBlock, anchor: [number, number])` → `{ x, y, width, height }` (y가 위로)
  - `anchorForBox(block: LabelBlock, x: number, y: number): [number, number]` — 상자의 작은 쪽 모서리를 주면 기준점을 돌려준다
  - `baseAnchor(bounds, gap: number): [number, number]` — 손상 경계상자 바로 위 가운데(스펙 4.3 기본 자리)
- Produces (`server/public/viewer/overlay.js`, 얇은 어댑터):
  - `labelLayout({ anchor, name, dimension, photo, number, fontPx, circleRPx })` → `placeBlock(labelBlock(...), anchor, -1)`
  - `estimateTextWidthPx(text, fontPx)` — `estimateTextWidth`의 이름만 다른 겉포장(기존 호출부 유지)
  - `BASELINE_CENTER_FACTOR` 재수출(기존 테스트·`labelPlacement.ts`가 여기서 가져온다)
- Produces (`server/src/export/labelPlacement.ts`):
  - `LabelTextLine` 에 `key: string` 추가. y 뒤집기 제거.

- [ ] **Step 1: `geometry.js`에 `boundsOf`를 더한다 (테스트 먼저)**

`server/test/geometry.test.ts` 맨 아래에 붙인다(`boundsOf`를 import 목록에 더한다):

```ts
describe('boundsOf', () => {
  it('점들의 경계상자를 준다', () => {
    expect(boundsOf([[0, 0], [1000, 0], [1000, 400], [0, 400]])).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 400 });
  });

  it('선(두 점)도 같은 방식이다', () => {
    expect(boundsOf([[60, 20], [0, 100]])).toEqual({ minX: 0, minY: 20, maxX: 60, maxY: 100 });
  });

  it('숫자가 아닌 점은 건너뛴다', () => {
    expect(boundsOf([[0, 0], ['a', 1] as unknown as number[], [10, 10]])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('쓸 점이 하나도 없으면 null', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf(null as unknown as number[][])).toBeNull();
  });
});
```

`server/public/viewer/geometry.js` 맨 아래에 붙인다:

```js
// 점 목록의 경계상자. 숫자가 아닌 점은 건너뛰고, 쓸 점이 하나도 없으면 null이다.
// 라벨 배치(labelCollision.js)와 화면·도면 어댑터가 모두 이 함수를 쓴다.
export function boundsOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of Array.isArray(points) ? points : []) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}
```

- [ ] **Step 2: `labelLayout.js`의 실패하는 테스트를 쓴다**

`server/test/labelLayout.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import {
  anchorForBox,
  baseAnchor,
  BASELINE_CENTER_FACTOR,
  blockBoxAt,
  estimateTextWidth,
  labelBlock,
  LINE_GAP_FACTOR,
  placeBlock,
} from '../public/viewer/labelLayout.js';

// 도면 실치수와 같은 값으로 검사한다: 글자 높이 300, 원 반지름 255.
const FONT = 300;
const R = 255;
// 어림 폭: 아스키 0.55배(= 165), 한글 등 1.0배(= 300)
const ASCII = FONT * 0.55;
const WIDE = FONT;
const LINE_GAP = FONT * LINE_GAP_FACTOR; // 390
const CIRCLE_GAP = R * 0.5; // 127.5
const CIRCLE_WIDTH = R * 2 + CIRCLE_GAP; // 637.5

describe('estimateTextWidth', () => {
  it('아스키는 글자 높이의 0.55배, 그 밖은 1.0배', () => {
    expect(estimateTextWidth('ab', 100)).toBeCloseTo(110, 6);
    expect(estimateTextWidth('균열', 100)).toBeCloseTo(200, 6);
    expect(estimateTextWidth('a균', 100)).toBeCloseTo(155, 6);
    expect(estimateTextWidth('', 100)).toBe(0);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
describe('labelBlock 줄 구성', () => {
  it('균열(이름 없음)은 첫 줄 글자가 치수이고 치수 줄을 또 그리지 않는다', () => {
    const block = labelBlock({ name: '', dimension: '0.2/0.3', photo: '#12', number: 17, font: FONT, circleR: R });
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['dimension', '0.2/0.3'],
      ['photo', '#12'],
    ]);
  });

  it('다른 유형은 첫 줄이 이름이고 치수·사진이 뒤따른다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['name', '파손'],
      ['dimension', '0.3x0.3'],
      ['photo', '#12, #13'],
    ]);
  });

  it('없는 줄은 건너뛰어 빈 줄을 남기지 않는다 (치수 없음)', () => {
    const block = labelBlock({ name: '박락', dimension: '', photo: '#12', number: 7, font: FONT, circleR: R });
    expect(block.lines.map((l) => l.text)).toEqual(['7', '박락', '#12']);
    // 사진 줄이 치수 자리(맨 아래, dy = 0)로 올라온다
    expect(block.lines.find((l) => l.key === 'photo')!.dy).toBe(0);
    expect(block.lines.find((l) => l.key === 'name')!.dy).toBeCloseTo(LINE_GAP, 6);
  });

  it('사진이 없으면 두 줄만 그린다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.2', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.lines.map((l) => l.text)).toEqual(['7', '박락', '1.2x1.2']);
  });

  it('번호가 없으면 원 없이 A부터 시작한다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.2', photo: '', number: null, font: FONT, circleR: R });
    expect(block.circle).toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['name', '박락'],
      ['dimension', '1.2x1.2'],
    ]);
    // 원이 없으므로 글자 줄이 블록 왼쪽 끝에서 시작한다
    expect(block.lines[0].dx).toBeCloseTo(-block.box.width / 2, 6);
  });

  it('A가 없으면(이름·치수 둘 다 없음) 원만 그린다', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '', number: 1, font: FONT, circleR: R });
    expect(block.circle).not.toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([['number', '1']]);
    // 글자가 없으면 원 폭만으로 가운데 맞춘다 — 원 중심이 기준점과 같다
    expect(block.circle!.dx).toBeCloseTo(0, 6);
    expect(block.lines[0].dx).toBeCloseTo(0, 6);
  });

  it('이름·치수·번호가 모두 없고 사진만 있으면 사진이 첫 줄이 된다', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '#12', number: null, font: FONT, circleR: R });
    expect(block.circle).toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([['photo', '#12']]);
  });

  it('그릴 것이 하나도 없으면 빈 블록', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '', number: null, font: FONT, circleR: R });
    expect(block).toEqual({ circle: null, lines: [], box: { dx: 0, dy: 0, width: 0, height: 0 }, height: 0 });
  });
});

describe('labelBlock 들여쓰기와 가운데 맞춤', () => {
  it('둘째 줄부터 x가 A의 왼쪽 x와 같다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    const name = block.lines.find((l) => l.key === 'name')!;
    const dimension = block.lines.find((l) => l.key === 'dimension')!;
    const photo = block.lines.find((l) => l.key === 'photo')!;
    expect(dimension.dx).toBe(name.dx);
    expect(photo.dx).toBe(name.dx);
    expect([name.align, dimension.align, photo.align]).toEqual(['start', 'start', 'start']);
  });

  it('번호 글자만 가운데 정렬이고 원 중심에 놓인다', () => {
    const block = labelBlock({ name: '파손', dimension: '', photo: '', number: 17, font: FONT, circleR: R });
    const number = block.lines.find((l) => l.key === 'number')!;
    expect(number.align).toBe('middle');
    expect(number.dx).toBeCloseTo(block.circle!.dx, 6);
  });

  it('블록 폭은 원 + 가장 긴 줄이고 기준점 x에 가운데 맞춘다', () => {
    // '0.3x0.3'(아스키 7) = 1155, '파손' = 600, '#12, #13'(아스키 8) = 1320 → 가장 긴 줄은 사진 줄
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    expect(block.box.width).toBeCloseTo(CIRCLE_WIDTH + 8 * ASCII, 6);
    expect(block.box.dx).toBeCloseTo(-block.box.width / 2, 6);
    // 원 왼쪽 끝이 블록 왼쪽 끝이고, 글자는 그 오른쪽으로 원 폭 + 간격만큼 들어간다
    expect(block.circle!.dx - R).toBeCloseTo(block.box.dx, 6);
    expect(block.lines.find((l) => l.key === 'name')!.dx).toBeCloseTo(block.box.dx + CIRCLE_WIDTH, 6);
  });

  it('한글 이름 한 줄짜리도 같은 규칙이다', () => {
    const block = labelBlock({ name: '표면 오염', dimension: '', photo: '', number: null, font: FONT, circleR: R });
    // '표면 오염' = 한글 4 + 공백(아스키) 1
    expect(block.box.width).toBeCloseTo(4 * WIDE + ASCII, 6);
  });
});

describe('labelBlock 줄 쌓기와 경계상자', () => {
  it('맨 아래 줄이 기준점(dy = 0)이고 위로 한 줄 간격씩 쌓인다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12', number: 17, font: FONT, circleR: R });
    expect(block.lines.find((l) => l.key === 'photo')!.dy).toBe(0);
    expect(block.lines.find((l) => l.key === 'dimension')!.dy).toBeCloseTo(LINE_GAP, 6);
    expect(block.lines.find((l) => l.key === 'name')!.dy).toBeCloseTo(LINE_GAP * 2, 6);
  });

  it('원 중심은 첫 줄 베이스라인에서 글자 높이의 0.35배 위다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '', number: 17, font: FONT, circleR: R });
    const name = block.lines.find((l) => l.key === 'name')!;
    expect(block.circle!.dy).toBeCloseTo(name.dy + FONT * BASELINE_CENTER_FACTOR, 6);
    expect(BASELINE_CENTER_FACTOR).toBe(0.35);
  });

  it('경계상자는 맨 아래 줄 베이스라인부터 글자 윗변까지이고 번호 원을 품는다', () => {
    // 두 줄(이름·치수) + 원: 위 = max(390 + 300, 495 + 255) = 750, 아래 = min(0, 240) = 0
    const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.box.dy).toBe(0);
    expect(block.box.height).toBeCloseTo(750, 6);
    expect(block.height).toBe(block.box.height);
  });

  it('한 줄짜리는 원이 베이스라인 아래로 내려가 상자가 아래로 늘어난다', () => {
    // 원 중심 105, 반지름 255 → 아래 -150, 위 360
    const block = labelBlock({ name: '박락', dimension: '', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.box.dy).toBeCloseTo(-150, 6);
    expect(block.box.height).toBeCloseTo(510, 6);
  });

  it('번호가 없으면 상자가 글자만 감싼다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: null, font: FONT, circleR: R });
    expect(block.box.dy).toBe(0);
    expect(block.box.height).toBeCloseTo(LINE_GAP + FONT, 6);
  });

  it('단위를 가리지 않는다 — 크기를 반으로 넣으면 결과도 반이다', () => {
    const big = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });
    const small = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT / 2, circleR: R / 2 });
    expect(small.box.width).toBeCloseTo(big.box.width / 2, 6);
    expect(small.box.height).toBeCloseTo(big.box.height / 2, 6);
  });
});

describe('placeBlock', () => {
  const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });

  it('도면 좌표(y가 위로)에서는 윗줄의 y가 더 크다', () => {
    const placed = placeBlock(block, [500, 500]);
    const name = placed.lines.find((l) => l.key === 'name')!;
    const dimension = placed.lines.find((l) => l.key === 'dimension')!;
    expect(dimension.y).toBe(500);
    expect(name.y).toBeCloseTo(500 + LINE_GAP, 6);
    expect(placed.circle!.cy).toBeGreaterThan(name.y);
    // 상자의 (x, y)는 작은 쪽 모서리 = 아래 변
    expect(placed.box).toEqual({ x: 500 + block.box.dx, y: 500, width: block.box.width, height: block.box.height });
  });

  it('yDir = -1이면 화면 픽셀(y가 아래로)로 뒤집는다 — 뒤집기는 여기 한 곳에서만 일어난다', () => {
    const placed = placeBlock(block, [500, 500], -1);
    const name = placed.lines.find((l) => l.key === 'name')!;
    const dimension = placed.lines.find((l) => l.key === 'dimension')!;
    expect(dimension.y).toBe(500);
    expect(name.y).toBeCloseTo(500 - LINE_GAP, 6);
    expect(placed.circle!.cy).toBeLessThan(name.y);
    // 화면에서도 (x, y)는 작은 쪽 모서리 = 위 변
    expect(placed.box.y).toBeCloseTo(500 - (block.box.dy + block.box.height), 6);
    expect(placed.box.height).toBe(block.box.height);
  });

  it('x는 뒤집지 않는다', () => {
    expect(placeBlock(block, [500, 500]).lines[0].x).toBe(placeBlock(block, [500, 500], -1).lines[0].x);
  });
});

describe('blockBoxAt · anchorForBox · baseAnchor', () => {
  const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });

  it('blockBoxAt은 placeBlock의 상자와 같다', () => {
    expect(blockBoxAt(block, [500, 500])).toEqual(placeBlock(block, [500, 500]).box);
  });

  it('anchorForBox는 blockBoxAt의 역이다', () => {
    const box = blockBoxAt(block, [500, 500]);
    expect(anchorForBox(block, box.x, box.y)).toEqual([500, 500]);
  });

  it('baseAnchor는 손상 경계상자 바로 위 가운데다', () => {
    expect(baseAnchor({ minX: 0, minY: 0, maxX: 1000, maxY: 400 }, 100)).toEqual([500, 500]);
  });
});
```

```bash
npm --prefix server test -- labelLayout
```

기대: 모듈이 없어 전부 실패한다.

- [ ] **Step 3: `labelLayout.js`를 쓴다**

`server/public/viewer/labelLayout.js` (새 파일):

```js
// 라벨 한 덩어리(원 + 글자 줄들)가 어떻게 생겼는지 정하는 순수 함수. DOM도, 다른 손상도 모른다.
//
// 단위를 가리지 않는다 — 글자 높이·원 반지름을 넣은 단위 그대로 답한다(mm을 넣으면 mm,
// world를 넣으면 world). 좌표계는 도면 방향 하나뿐이다: y가 위로 증가한다. 앱의 world 좌표도
// 같은 방향이라 화면 계산도 그대로 쓰고, 화면 픽셀(y가 아래로 증가)로의 뒤집기는 placeBlock의
// yDir = -1 한 곳에서만 일어난다.
//
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
// (이 문서가 2026-09-13 설계 §5.2·§9.5의 라벨 배치 규칙을 대체한다)

// 브라우저에 실제 글자 폭을 물어볼 수 없어(DOM 밖에서도 계산해야 한다) 어림한다.
// 아스키 글자는 글자 높이의 0.55배, 그 밖(한글 등)은 1.0배로 본다. 어림이라 아주 긴 이름은
// 조금 겹칠 수 있고, 그 정도는 받아들인다(설계 4.5·7장).
const ASCII_CHAR_WIDTH_FACTOR = 0.55;
const WIDE_CHAR_WIDTH_FACTOR = 1.0;

export const CIRCLE_TEXT_GAP_FACTOR = 0.5; // 원과 글자 사이 간격 (원 반지름의 배수)
export const LINE_GAP_FACTOR = 1.3; // 줄 간격 (글자 높이의 배수)
// 텍스트 베이스라인에서 글자 세로 중심(= 번호 원 중심)까지 거리 (글자 높이의 배수).
// 산출 DXF는 TEXT를 중간 정렬(73=2)로 놓으므로 이 값을 그대로 쓴다 — server/src/export/labelPlacement.ts
export const BASELINE_CENTER_FACTOR = 0.35;

export function estimateTextWidth(text, font) {
  let width = 0;
  for (const ch of String(text ?? '')) {
    const isAscii = ch.charCodeAt(0) < 128;
    width += font * (isAscii ? ASCII_CHAR_WIDTH_FACTOR : WIDE_CHAR_WIDTH_FACTOR);
  }
  return width;
}

function textOf(value) {
  return typeof value === 'string' ? value : '';
}

const EMPTY_BLOCK = { circle: null, lines: [], box: { dx: 0, dy: 0, width: 0, height: 0 }, height: 0 };

// 라벨 한 덩어리의 상대 좌표를 낸다. 기준점은 "맨 아래 줄의 베이스라인 × 블록 가로 가운데"다.
//
// 첫 줄 글자 A는 이름이 있으면 이름, 없으면 치수다 — 균열(crack)은 drawingNameOf가 빈 문자열을
// 주므로 치수가 자동으로 첫 줄로 올라오고(설계 2장 `⑰ 0.2/0.3`), 그때 치수 줄을 또 그리지 않는다.
// 둘째 줄부터는 A의 왼쪽 x에 맞춰 왼쪽 정렬한다. 가운데 정렬은 원 안의 번호 글자뿐이고,
// 블록 전체(원 + 가장 긴 줄)를 기준점 x에 가운데 맞춘다.
export function labelBlock({ name, dimension, photo, number, font, circleR }) {
  const nameText = textOf(name);
  const dimensionText = textOf(dimension);
  const photoText = textOf(photo);
  const hasNumber = number !== null && number !== undefined;

  // 위(첫 줄)에서 아래로. 없는 줄은 넣지 않아 빈 줄이 남지 않는다.
  const rows = [];
  if (nameText !== '') {
    rows.push({ key: 'name', text: nameText });
    if (dimensionText !== '') rows.push({ key: 'dimension', text: dimensionText });
  } else if (dimensionText !== '') {
    rows.push({ key: 'dimension', text: dimensionText });
  }
  if (photoText !== '') rows.push({ key: 'photo', text: photoText });
  // 글자가 하나도 없어도 번호가 있으면 원은 그린다(빈 첫 줄을 자리로 둔다).
  if (rows.length === 0) {
    if (!hasNumber) return EMPTY_BLOCK;
    rows.push({ key: 'name', text: '' });
  }

  let textWidth = 0;
  for (const row of rows) textWidth = Math.max(textWidth, estimateTextWidth(row.text, font));
  // 글자가 없으면 원 폭만으로 가운데 맞춘다(간격을 0으로 둔다) — 원 중심이 기준점과 같아진다.
  const circleGap = hasNumber && textWidth > 0 ? circleR * CIRCLE_TEXT_GAP_FACTOR : 0;
  const circleWidth = hasNumber ? circleR * 2 + circleGap : 0;
  const width = circleWidth + textWidth;
  const left = -width / 2;
  const textX = left + circleWidth; // 모든 글자 줄의 왼쪽 x = 들여쓰기 기준

  const lineGap = font * LINE_GAP_FACTOR;
  const last = rows.length - 1;
  const lines = [];
  let circle = null;
  for (let index = 0; index <= last; index++) {
    // 맨 아래 줄(index = last)이 기준점(dy = 0)이고, 위로 갈수록 한 줄 간격씩 커진다.
    const dy = (last - index) * lineGap;
    if (index === 0 && hasNumber) {
      const cx = left + circleR;
      circle = { dx: cx, dy: dy + font * BASELINE_CENTER_FACTOR, r: circleR };
      lines.push({ dx: cx, dy, text: String(number), align: 'middle', key: 'number' });
    }
    if (rows[index].text !== '') {
      lines.push({ dx: textX, dy, text: rows[index].text, align: 'start', key: rows[index].key });
    }
  }

  // 경계상자: 맨 아래 줄 베이스라인부터 첫 줄 글자 윗변까지. 번호 원이 그보다 튀어나오면 넓힌다
  // (한 줄짜리 라벨은 원이 베이스라인 아래로 내려간다).
  let top = last * lineGap + font;
  let bottom = 0;
  if (circle) {
    top = Math.max(top, circle.dy + circle.r);
    bottom = Math.min(bottom, circle.dy - circle.r);
  }
  const box = { dx: left, dy: bottom, width, height: top - bottom };
  return { circle, lines, box, height: box.height };
}

// 상대 좌표를 기준점에 얹어 실제 좌표로 만든다.
// yDir = 1: 도면·world 좌표(y가 위로) / yDir = -1: 화면 픽셀(y가 아래로).
// **화면과 도면 사이의 y 뒤집기는 이 함수 한 곳에서만 일어난다.**
export function placeBlock(block, anchor, yDir = 1) {
  const [ax, ay] = anchor;
  const circle = block.circle
    ? { cx: ax + block.circle.dx, cy: ay + yDir * block.circle.dy, r: block.circle.r }
    : null;
  const lines = block.lines.map((line) => ({
    x: ax + line.dx,
    y: ay + yDir * line.dy,
    text: line.text,
    anchor: line.align,
    key: line.key,
  }));
  // 상자의 (x, y)는 언제나 그 좌표계에서 작은 쪽 모서리다 — y가 위로면 아래 변, 아래로면 위 변.
  const y = yDir === 1 ? ay + block.box.dy : ay - (block.box.dy + block.box.height);
  return { circle, lines, box: { x: ax + block.box.dx, y, width: block.box.width, height: block.box.height } };
}

// 후보 자리를 훑을 때는 글자를 만들 필요가 없다 — 상자만 옮겨 본다(y가 위로).
export function blockBoxAt(block, [ax, ay]) {
  return { x: ax + block.box.dx, y: ay + block.box.dy, width: block.box.width, height: block.box.height };
}

// blockBoxAt의 역. 상자를 놓고 싶은 자리(작은 쪽 모서리)를 주면 기준점을 돌려준다.
export function anchorForBox(block, x, y) {
  return [x - block.box.dx, y - block.box.dy];
}

// 기본 자리(설계 4.3): 손상 경계상자 바로 위, 간격 gap, 가로 가운데 맞춤. y가 위로 증가한다.
export function baseAnchor(bounds, gap) {
  return [(bounds.minX + bounds.maxX) / 2, bounds.maxY + gap];
}
```

```bash
npm --prefix server test -- labelLayout
node --check server/public/viewer/labelLayout.js
```

기대: `labelLayout.test.ts`와 `geometry.test.ts`가 모두 통과한다.

- [ ] **Step 4: `overlay.js`를 얇은 어댑터로 바꾼다**

`server/public/viewer/overlay.js`에서:

1. import에 더한다(7행 아래):

```js
import { boundsOf, rectCenter } from './geometry.js';
import { estimateTextWidth, labelBlock, placeBlock } from './labelLayout.js';
```

(기존 `import { rectCenter } from './geometry.js';`를 위 줄로 합친다.)

2. 35~42행의 어림값 상수 블록(`ASCII_CHAR_WIDTH_FACTOR`·`WIDE_CHAR_WIDTH_FACTOR`·`CIRCLE_TEXT_GAP_FACTOR`·`LINE_GAP_FACTOR`·`BASELINE_CENTER_FACTOR`)을 아래로 교체한다:

```js
// 라벨 배치 규칙과 그 상수는 labelLayout.js에 있다(화면·DXF가 같은 한 벌을 쓴다).
// BASELINE_CENTER_FACTOR는 산출 DXF(server/src/export/labelPlacement.ts)와 기존 테스트가
// overlay.js에서 가져오므로 여기서 그대로 다시 내보낸다.
export { BASELINE_CENTER_FACTOR, CIRCLE_TEXT_GAP_FACTOR, LINE_GAP_FACTOR } from './labelLayout.js';
```

3. 121~130행의 `estimateTextWidthPx`를 아래로 교체한다:

```js
// 이름만 다른 겉포장. 화면은 픽셀을 넣으므로 Px를 붙여 부른다(규칙은 labelLayout.js 한 벌뿐이다).
export function estimateTextWidthPx(text, fontPx) {
  return estimateTextWidth(text, fontPx);
}
```

4. 206~220행의 `labelAnchor`를 아래로 교체한다:

```js
// 겹침 방지를 하지 않는 도면(mmPerWorld 없음)에서 쓰는 화면 기준 기본 자리. 화면 좌표는 y가
// 아래로 증가하므로 도형 위쪽(작은 y)으로 gapPx만큼 뗀다. 겹침 방지를 하는 도면은 대신
// labelCollision이 world 좌표로 구해 둔 기준점을 쓴다(createOverlay).
export function labelAnchor(screenPoints, gapPx) {
  const bounds = boundsOf(screenPoints);
  if (!bounds) return [0, 0];
  return [(bounds.minX + bounds.maxX) / 2, bounds.minY - gapPx];
}
```

5. 222~275행의 `labelLayout` 전체를 아래로 교체한다:

```js
// 라벨 배치의 화면 어댑터. 규칙은 labelLayout.js에 있고 여기서는 화면 픽셀(y가 아래로 증가)로
// 옮기기만 한다 — 그 뒤집기는 placeBlock(yDir = -1) 한 곳에서만 일어난다.
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
export function labelLayout({ anchor, name, dimension, photo = '', number, fontPx, circleRPx }) {
  const block = labelBlock({ name, dimension, photo, number, font: fontPx, circleR: circleRPx });
  return placeBlock(block, anchor, -1);
}
```

- [ ] **Step 5: `overlay.test.ts`의 `labelLayout` 블록을 새 규칙으로 다시 쓴다**

`server/test/overlay.test.ts`의 `describe('labelLayout', ...)` 블록(347~481행) 전체를 아래로 교체한다:

```ts
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
// (이 규칙이 2026-09-13 설계 §5.2·§9.5의 라벨 배치를 대체한다)
describe('labelLayout (화면 어댑터)', () => {
  const anchor: Pt = [100, 50];
  const fontPx = 20;
  const circleRPx = 17;
  const lineGap = fontPx * 1.3; // 26
  const circleWidth = circleRPx * 2 + circleRPx * 0.5; // 42.5

  it('화면은 y가 아래로 증가한다 — 윗줄일수록 y가 작다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '1.2x1.2', photo: '#5', number: 17, fontPx, circleRPx });
    const name = layout.lines.find((l) => l.key === 'name')!;
    const dimension = layout.lines.find((l) => l.key === 'dimension')!;
    const photo = layout.lines.find((l) => l.key === 'photo')!;
    expect(photo.y).toBe(anchor[1]);
    expect(dimension.y).toBeCloseTo(anchor[1] - lineGap, 6);
    expect(name.y).toBeCloseTo(anchor[1] - lineGap * 2, 6);
    expect(layout.circle!.cy).toBeCloseTo(name.y - fontPx * 0.35, 6);
  });

  it('번호가 없으면 원 없이 이름부터 시작하고 블록이 기준점에 가운데 맞춰진다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    // '균열/백태' = 한글 4 + 아스키 1 = 4*20 + 11 = 91
    expect(layout.lines).toEqual([{ x: 100 - 91 / 2, y: 50, text: '균열/백태', anchor: 'start', key: 'name' }]);
  });

  it('균열(이름 없음)은 치수가 원 옆 첫 줄로 올라오고 사진이 그 아래 들여쓰기된다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '0.2/0.3', photo: '#12', number: 17, fontPx, circleRPx });
    expect(layout.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['dimension', '0.2/0.3'],
      ['photo', '#12'],
    ]);
    const dimension = layout.lines.find((l) => l.key === 'dimension')!;
    const photo = layout.lines.find((l) => l.key === 'photo')!;
    // 둘째 줄부터 A의 왼쪽 x에 맞춘다
    expect(photo.x).toBe(dimension.x);
    expect(photo.y).toBe(anchor[1]);
    expect(dimension.y).toBeCloseTo(anchor[1] - lineGap, 6);
  });

  it('첫 줄의 원은 A 왼쪽에 놓이고 번호 글자만 가운데 정렬이다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: 17, fontPx, circleRPx });
    const number = layout.lines.find((l) => l.key === 'number')!;
    const name = layout.lines.find((l) => l.key === 'name')!;
    expect(number.anchor).toBe('middle');
    expect(number.x).toBeCloseTo(layout.circle!.cx, 6);
    expect(name.anchor).toBe('start');
    expect(name.x).toBeCloseTo(layout.circle!.cx + circleRPx + circleRPx * 0.5, 6);
  });

  it('블록 전체(원 + 가장 긴 줄)를 기준점 x에 가운데 맞춘다', () => {
    const layout = labelLayout({ anchor, name: '균열', dimension: '', number: 5, fontPx, circleRPx });
    const name = layout.lines.find((l) => l.key === 'name')!;
    const left = layout.circle!.cx - circleRPx;
    const right = name.x + estimateTextWidthPx('균열', fontPx);
    expect((left + right) / 2).toBeCloseTo(anchor[0], 6);
    expect(layout.box.x).toBeCloseTo(left, 6);
    expect(layout.box.width).toBeCloseTo(circleWidth + estimateTextWidthPx('균열', fontPx), 6);
  });

  it('번호가 있고 이름·치수가 없으면 원만 그린다 (원 중심 = 기준점 x)', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: 1, fontPx, circleRPx });
    expect(layout.circle!.cx).toBeCloseTo(anchor[0], 6);
    expect(layout.lines).toEqual([{ x: layout.circle!.cx, y: anchor[1], text: '1', anchor: 'middle', key: 'number' }]);
  });

  it('이름·번호가 둘 다 없으면 아무것도 그리지 않는다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    expect(layout.lines).toEqual([]);
  });

  it('없는 줄은 건너뛰어 빈 줄을 남기지 않는다 (치수 없이 사진만)', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '', photo: '#5', number: 3, fontPx, circleRPx });
    expect(layout.lines.map((l) => l.text)).toEqual(['3', '망상균열', '#5']);
    expect(layout.lines.find((l) => l.key === 'photo')!.y).toBe(anchor[1]);
  });

  it('화면 상자의 (x, y)는 위 변이다 (y가 아래로 증가하므로)', () => {
    const layout = labelLayout({ anchor, name: '박락', dimension: '1.2x1.2', number: 7, fontPx, circleRPx });
    expect(layout.box.y).toBeLessThan(anchor[1]);
    expect(layout.box.y + layout.box.height).toBeGreaterThanOrEqual(anchor[1]);
  });
});
```

- [ ] **Step 6: `labelPlacement.ts`에서 y 뒤집기를 걷어낸다**

`server/src/export/labelPlacement.ts`의 1~73행을 아래로 교체한다(`baseFor`·`labelEntities`는 Task 5에서 고치므로 지금은 그대로 둔다):

```ts
// 손상 옆 라벨을 도면 실치수(mm)로 배치한다.
//
// 배치 규칙을 베껴 쓰지 않는다 — 앱 화면이 쓰는 labelLayout.js를 그대로 부른다. 그 모듈의
// 좌표계가 도면 방향(y가 위로 증가)이라 여기서는 부호를 건드릴 일이 없다. 화면 픽셀로의
// 뒤집기는 overlay.js가 placeBlock(yDir = -1)로 할 뿐이다.
//
// placeBlock이 주는 y는 글자의 베이스라인이다. 산출 TEXT는 수직 중간 정렬(73=2)을 쓰므로
// 정렬점은 베이스라인에서 글자 높이 × BASELINE_CENTER_FACTOR만큼 위다 — 번호 원의 중심을
// 잡는 데 쓰는 바로 그 값이라 원과 글자가 같은 줄에 놓인다.
//
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2~4장

import { boundsOf } from '../../public/viewer/geometry.js';
import {
  baseAnchor,
  BASELINE_CENTER_FACTOR,
  labelBlock,
  placeBlock,
} from '../../public/viewer/labelLayout.js';
import { CIRCLE_RADIUS_FACTOR, FONT_HEIGHT_MM, LABEL_GAP_MM } from '../../public/viewer/overlay.js';
import { dimensionTextOf, drawingNameOf, photoTextOf } from '../../public/viewer/quantities.js';
import { dwgPointsOf } from './damageEntities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';

export interface LabelTextLine {
  position: Point;
  text: string;
  align: 'center' | 'left';
  /** 'number' | 'name' | 'dimension' | 'photo' — 사진 줄만 다른 레이어·색으로 나간다 */
  key: string;
}

export interface DamageLabel {
  circle: { center: Point; radius: number } | null;
  lines: LabelTextLine[];
  height: number;
}

const CIRCLE_RADIUS_MM = FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR;
// 베이스라인 → 중간 정렬점까지의 거리(도면 mm)
const BASELINE_TO_MIDDLE_MM = FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR;

export function damageLabel(damage: unknown, number: number | null): DamageLabel | null {
  const points = dwgPointsOf(damage);
  if (!points) return null;
  const bounds = boundsOf(points);
  if (!bounds) return null;

  const block = labelBlock({
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    font: FONT_HEIGHT_MM,
    circleR: CIRCLE_RADIUS_MM,
  });
  const placed = placeBlock(block, baseAnchor(bounds, LABEL_GAP_MM));

  const circle = placed.circle ? { center: [placed.circle.cx, placed.circle.cy] as Point, radius: placed.circle.r } : null;
  const lines: LabelTextLine[] = placed.lines.map((line) => ({
    position: [line.x, line.y + BASELINE_TO_MIDDLE_MM] as Point,
    text: line.text,
    align: line.anchor === 'middle' ? 'center' : 'left',
    key: line.key,
  }));

  return { circle, lines, height: FONT_HEIGHT_MM };
}
```

- [ ] **Step 7: `labelPlacement.test.ts`의 기대값을 새 규칙에 맞춘다**

`server/test/labelPlacement.test.ts`의 30~105행(`describe('damageLabel', ...)`) 전체를 아래로 교체한다. import 줄에서 `CIRCLE_RADIUS_FACTOR`·`LABEL_GAP_MM`·`FONT_HEIGHT_MM`·`BASELINE_CENTER_FACTOR`는 그대로 쓴다.

```ts
describe('damageLabel', () => {
  it('dwg가 없으면 null', () => {
    const damage = { id: 'a', type: 'crack', geometry: { kind: 'polyline', world: RECT, dwg: null } };
    expect(damageLabel(damage, 1)).toBeNull();
  });

  it('맨 아래 줄이 도형 위쪽 경계에서 100만큼 떨어진 자리다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    expect(label.lines).toHaveLength(3); // 번호 + 이름 + 치수
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    // 베이스라인은 400 + 100, 중간 정렬점은 거기서 글자 높이 × 0.35 위
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.align).toBe('left');
  });

  it('윗줄은 한 줄 간격(글자 높이 × 1.3)만큼 위에 있다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(name.position[1] - dimension.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('번호 원의 반지름은 글자 높이 × 0.85이고 중심은 첫 줄과 같은 높이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(label.circle!.radius).toBeCloseTo(FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR, 6);
    expect(label.circle!.center[1]).toBeCloseTo(name.position[1], 6);
    expect(label.circle!.center[0]).toBeLessThan(name.position[0]);
  });

  it('번호 글자는 원 가운데, 첫 줄 글자는 원 오른쪽에서 왼쪽 정렬이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const number = label.lines.find((l) => l.text === '7')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(number.align).toBe('center');
    expect(number.position[0]).toBeCloseTo(label.circle!.center[0], 6);
    expect(name.align).toBe('left');
  });

  // 근거: 2026-09-16 설계 2장 — 균열은 A = 치수라 원 옆에 치수가 붙는다.
  it('균열은 치수가 원 옆 첫 줄이고 치수 줄을 또 그리지 않는다', () => {
    const label = damageLabel(rect('crack', { width: 0.2, length: 1.5, count: 1 }), 3)!;
    expect(label.lines.map((l) => l.text)).toEqual(['3', '0.2/1.5']);
    const dimension = label.lines.find((l) => l.text === '0.2/1.5')!;
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.key).toBe('dimension');
  });

  it('둘째 줄부터 첫 줄 글자의 x에 맞춰 들여쓴다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const name = label.lines.find((l) => l.text === '박락')!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const photo = label.lines.find((l) => l.text === '#12, #13')!;
    expect(dimension.position[0]).toBeCloseTo(name.position[0], 6);
    expect(photo.position[0]).toBeCloseTo(name.position[0], 6);
  });

  it('사진번호가 있으면 맨 아래 줄이 사진 줄이고 key가 photo다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const photo = label.lines.find((l) => l.text === '#12, #13')!;
    expect(photo.key).toBe('photo');
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    expect(dimension.position[1] - photo.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('치수가 없으면 사진 줄이 그 자리로 올라온다 — 빈 줄을 남기지 않는다', () => {
    const label = damageLabel(rect('spalling', {}, { photoNumbers: ['12'] }), 7)!;
    expect(label.lines.map((l) => l.text)).toEqual(['7', '박락', '#12']);
    const photo = label.lines.find((l) => l.text === '#12')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
  });

  it('번호가 없고 이름도 치수도 없으면 그릴 것이 없다', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(label.circle).toBeNull();
    expect(label.lines).toEqual([]);
  });

  it('글자 높이는 300이다', () => {
    expect(damageLabel(rect('spalling', {}), 1)!.height).toBe(300);
  });
});
```

- [ ] **Step 8: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/viewer/labelLayout.js
node --check server/public/viewer/geometry.js
node --check server/public/viewer/overlay.js
```

```bash
git add server/public/viewer/labelLayout.js server/public/viewer/geometry.js server/public/viewer/overlay.js server/src/export/labelPlacement.ts server/test/labelLayout.test.ts server/test/geometry.test.ts server/test/overlay.test.ts server/test/labelPlacement.test.ts
git commit -m "$(printf '%s\n' '라벨 줄 구성을 순수 모듈로 빼고 원 옆 글자·들여쓰기로 바꾼다' '' '첫 줄 글자는 이름이 있으면 이름, 없으면 치수다 — 균열은 원 옆에 치수가 붙는다.' '둘째 줄부터 그 글자의 왼쪽 x에 맞춰 들여쓰고, 블록 전체를 기준점 x에 가운데 맞춘다.' '' 'labelLayout.js는 단위와 좌표계를 가리지 않는다. 좌표계는 도면 방향(y가 위로)' '하나뿐이고, 화면 픽셀로의 뒤집기는 placeBlock(yDir = -1) 한 곳에서만 일어난다.' '그래서 labelPlacement.ts의 y 부호 뒤집기가 사라졌다.' '' '근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 화면과 DXF의 라벨이 새 모양(원 옆 글자, 들여쓰기)으로 나온다. 겹침 방지는 아직 없다.

---

## Task 3: 겹치지 않는 자리를 찾는 순수 모듈

`labelCollision.js`는 손상들의 **경계상자**와 **블록**만 받는다 — 글자 내용도, 단위도, DOM도 모른다. 번호 순서대로 한 손상씩 자리를 잡고, 앞번호가 잡은 자리는 뒷번호의 장애물이 된다.

후보 상자를 먼저 전부 만들어(기본 자리 + `k = 1..8` × 네 방향 = 33개) 그 상자들을 감싸는 범위 밖의 장애물은 아예 검사하지 않는다. 손상 3,000개 스트레스 테스트(`exportDrawing.test.ts`)가 손상마다 3,000개를 다 훑으면 느려지기 때문이다.

**Files:**
- Create: `server/public/viewer/labelCollision.js`
- Create: `server/test/labelCollision.test.ts`

**Interfaces:**
- Consumes: `blockBoxAt`, `anchorForBox`, `baseAnchor` from `./labelLayout.js`
- Produces:
  - `MAX_STEPS = 8`, `ARROW_HEAD_FACTOR = 0.5`, `ARROW_HEAD_ANGLE = Math.PI / 6`
  - `boxOfBounds(bounds): { x, y, width, height }`
  - `boxesOverlap(a, b): boolean` — 닿기만 하면 **겹치지 않은 것**으로 본다
  - `nearestPointOnBox(point, box): [number, number]`
  - `candidatePlacements(bounds, block, gap): Array<{ place: 'base'|'up'|'right'|'left'|'down', anchor: [number, number], box }>` — 스펙 4.3 순서 그대로
  - `leaderFor(labelBox, bounds, font): { from: Point, to: Point, head: [Point, Point] }`
  - `placeLabels(items, { gap, font }): Map<string, { anchor, box, displaced, leader }>`
    - `items`: `Array<{ id: string, number: number | null, bounds, block }>` — 넣은 순서는 상관없다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/labelCollision.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  boxOfBounds,
  candidatePlacements,
  leaderFor,
  MAX_STEPS,
  nearestPointOnBox,
  placeLabels,
} from '../public/viewer/labelCollision.js';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// 글자 내용과 상관없이 폭 w · 높이 h인 블록. 배치 계산만 따로 본다.
// (진짜 블록은 labelLayout.labelBlock이 만들고 labelLayout.test.ts가 검사한다.)
function block(width: number, height: number) {
  return { circle: null, lines: [], box: { dx: -width / 2, dy: 0, width, height }, height };
}

function bounds(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return { minX, minY, maxX, maxY };
}

const GAP = 100;
const FONT = 300;

describe('boxesOverlap', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };

  it('겹치면 true', () => {
    expect(boxesOverlap(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(boxesOverlap(a, { x: 10, y: 10, width: 10, height: 10 })).toBe(true); // 안에 든 상자
  });

  it('닿기만 하면 false — 간격 100이 딱 맞는 자리를 막지 않아야 한다', () => {
    expect(boxesOverlap(a, { x: 100, y: 0, width: 100, height: 100 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: 100, width: 100, height: 100 })).toBe(false);
  });

  it('떨어져 있으면 false', () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 100, height: 100 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: -300, width: 100, height: 100 })).toBe(false);
  });
});

describe('boxOfBounds', () => {
  it('경계상자를 상자로 바꾼다', () => {
    expect(boxOfBounds(bounds(0, 0, 1000, 400))).toEqual({ x: 0, y: 0, width: 1000, height: 400 });
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.3
describe('candidatePlacements', () => {
  const b = bounds(0, 0, 200, 200);
  const blk = block(100, 100);
  const list = candidatePlacements(b, blk, GAP);

  it('기본 자리가 맨 앞이고 손상 바로 위 가운데다', () => {
    expect(list[0].place).toBe('base');
    expect(list[0].anchor).toEqual([100, 300]);
    expect(list[0].box).toEqual({ x: 50, y: 300, width: 100, height: 100 });
  });

  it('k마다 위·오른쪽·왼쪽·아래 차례로 본다', () => {
    expect(list.slice(1, 5).map((c) => c.place)).toEqual(['up', 'right', 'left', 'down']);
    expect(list.slice(5, 9).map((c) => c.place)).toEqual(['up', 'right', 'left', 'down']);
    expect(list).toHaveLength(1 + MAX_STEPS * 4);
  });

  it('위 k는 기본 자리에서 위로 k·h다', () => {
    expect(list[1].anchor).toEqual([100, 400]); // k = 1
    expect(list[5].anchor).toEqual([100, 500]); // k = 2
    expect(list[list.length - 4].anchor).toEqual([100, 300 + 8 * 100]); // k = 8
  });

  it('오른쪽 k는 경계상자 오른쪽에 간격 100, 세로는 경계상자 중앙이다', () => {
    expect(list[2].box).toEqual({ x: 300, y: 50, width: 100, height: 100 });
    expect(list[6].box).toEqual({ x: 400, y: 50, width: 100, height: 100 }); // h 더
  });

  it('왼쪽 k는 왼쪽에 같은 방식이다', () => {
    expect(list[3].box).toEqual({ x: -200, y: 50, width: 100, height: 100 });
    expect(list[7].box).toEqual({ x: -300, y: 50, width: 100, height: 100 });
  });

  it('아래 k는 경계상자 아래 간격 100이다', () => {
    expect(list[4].box).toEqual({ x: 50, y: -200, width: 100, height: 100 });
    expect(list[8].box).toEqual({ x: 50, y: -300, width: 100, height: 100 });
  });
});

describe('placeLabels', () => {
  it('막는 것이 없으면 기본 자리를 쓰고 화살표가 없다', () => {
    const result = placeLabels([{ id: 'a', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) }], { gap: GAP, font: FONT });
    const placed = result.get('a')!;
    expect(placed.anchor).toEqual([100, 300]);
    expect(placed.displaced).toBe(false);
    expect(placed.leader).toBeNull();
  });

  // 붙어 있는 손상 둘: 라벨 상자가 가로로 겹쳐 2번이 위로 h 올라간다.
  it('나란히 붙은 손상 둘이면 2번 라벨이 위로 h 올라간다', () => {
    const items = [
      { id: 'a', number: 1, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) },
      { id: 'b', number: 2, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) },
    ];
    const result = placeLabels(items, { gap: GAP, font: FONT });
    expect(result.get('a')!.anchor).toEqual([500, 500]);
    expect(result.get('a')!.displaced).toBe(false);
    expect(result.get('b')!.anchor).toEqual([1550, 500 + 750]);
    expect(result.get('b')!.displaced).toBe(true);
    expect(result.get('b')!.leader).not.toBeNull();
  });

  it('넣은 순서를 섞어도 같은 결과다 — 번호 순서대로 자리를 잡는다', () => {
    const a = { id: 'a', number: 1, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) };
    const b = { id: 'b', number: 2, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) };
    const forward = placeLabels([a, b], { gap: GAP, font: FONT });
    const backward = placeLabels([b, a], { gap: GAP, font: FONT });
    expect(backward.get('a')!.anchor).toEqual(forward.get('a')!.anchor);
    expect(backward.get('b')!.anchor).toEqual(forward.get('b')!.anchor);
  });

  // 위쪽이 통째로 막힌 손상: 세로로 긴 손상(벽)이 위 k = 1..8을 모두 가린다.
  it('위가 막히면 오른쪽으로 간다', () => {
    const items = [
      { id: 'wall', number: 1, bounds: bounds(40, 250, 160, 2000), block: block(100, 100) },
      { id: 'b', number: 2, bounds: bounds(0, 0, 200, 200), block: block(100, 100) },
    ];
    const placed = placeLabels(items, { gap: GAP, font: FONT }).get('b')!;
    // 오른쪽 k = 1: 상자 왼쪽 300, 세로 중앙 100 → 기준점 [350, 50]
    expect(placed.anchor).toEqual([350, 50]);
    expect(placed.displaced).toBe(true);
  });

  it('8단계가 다 막히면 위로 8h 자리를 그냥 쓴다 (겹치더라도 라벨은 반드시 그린다)', () => {
    const items = [
      { id: 'b', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) },
      { id: 'huge', number: 2, bounds: bounds(-5000, -5000, 5000, 5000), block: block(100, 100) },
    ];
    const placed = placeLabels(items, { gap: GAP, font: FONT }).get('b')!;
    expect(placed.anchor).toEqual([100, 200 + GAP + MAX_STEPS * 100]);
    expect(placed.displaced).toBe(true);
  });

  it('자기 손상의 경계상자는 장애물로 보지 않는다', () => {
    // 블록이 손상보다 크고 원이 베이스라인 아래로 내려가도 기본 자리를 쓴다
    const items = [{ id: 'a', number: 1, bounds: bounds(0, 0, 100, 100), block: { circle: null, lines: [], box: { dx: -500, dy: -300, width: 1000, height: 900 }, height: 900 } }];
    expect(placeLabels(items, { gap: GAP, font: FONT }).get('a')!.displaced).toBe(false);
  });

  it('번호가 없는 손상은 뒤로 미룬다 (같으면 id 순서)', () => {
    const items = [
      { id: 'z', number: null, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) },
      { id: 'a', number: 1, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) },
    ];
    const result = placeLabels(items, { gap: GAP, font: FONT });
    expect(result.get('a')!.displaced).toBe(false);
    expect(result.get('z')!.displaced).toBe(true);
  });

  it('경계상자나 블록이 없는 항목은 건너뛴다', () => {
    const result = placeLabels(
      [{ id: 'a', number: 1, bounds: null, block: block(100, 100) } as never, { id: 'b', number: 2, bounds: bounds(0, 0, 10, 10), block: block(100, 100) }],
      { gap: GAP, font: FONT },
    );
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(true);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.4
describe('nearestPointOnBox', () => {
  const box = { x: 0, y: 0, width: 200, height: 200 };

  it('상자 밖의 점은 가장 가까운 테두리 점으로 눌린다', () => {
    expect(nearestPointOnBox([300, 100], box)).toEqual([200, 100]);
    expect(nearestPointOnBox([-50, 300], box)).toEqual([0, 200]);
  });

  it('상자 안의 점은 가장 가까운 변으로 밀려난다', () => {
    expect(nearestPointOnBox([10, 100], box)).toEqual([0, 100]);
    expect(nearestPointOnBox([100, 190], box)).toEqual([100, 200]);
  });
});

describe('leaderFor', () => {
  // 라벨 상자 x 300..400 · y 50..150, 손상 경계상자 0..200 × 0..200
  const labelBox = { x: 300, y: 50, width: 100, height: 100 };
  const target = bounds(0, 0, 200, 200);
  const leader = leaderFor(labelBox, target, FONT);

  it('시작은 손상에 가장 가까운 변의 중점이다', () => {
    expect(leader.from).toEqual([300, 100]);
  });

  it('끝은 손상 경계상자 위에서 시작점에 가장 가까운 점이다', () => {
    expect(leader.to).toEqual([200, 100]);
  });

  it('화살촉은 끝점에서 길이 150(글자 높이의 절반), 화살대에서 30°씩 벌어진 점 둘이다', () => {
    // 화살대 방향은 -x. 150 × cos30° = 129.9038, 150 × sin30° = 75
    expect(leader.head).toHaveLength(2);
    expect(leader.head[0][0]).toBeCloseTo(329.9038, 3);
    expect(leader.head[0][1]).toBeCloseTo(175, 6);
    expect(leader.head[1][0]).toBeCloseTo(329.9038, 3);
    expect(leader.head[1][1]).toBeCloseTo(25, 6);
  });

  it('위로 올라간 라벨은 아래 변 중점에서 손상 윗변으로 내려온다', () => {
    const above = leaderFor({ x: 50, y: 500, width: 100, height: 100 }, bounds(0, 0, 200, 200), FONT);
    expect(above.from).toEqual([100, 500]);
    expect(above.to).toEqual([100, 200]);
    expect(above.head[0][1]).toBeCloseTo(200 + 150 * Math.cos(Math.PI / 6), 3);
  });
});
```

```bash
npm --prefix server test -- labelCollision
```

기대: 모듈이 없어 전부 실패한다.

- [ ] **Step 2: `labelCollision.js`를 쓴다**

`server/public/viewer/labelCollision.js` (새 파일):

```js
// 라벨이 다른 손상·다른 라벨과 겹치지 않을 자리를 찾는다. 순수 함수이고 단위를 가리지 않는다 —
// 경계상자와 라벨 크기를 같은 단위로 받아 그 단위로 답한다(DXF는 mm, 화면은 world).
// 좌표계는 도면 방향(y가 위로 증가) 하나다.
//
// 라벨 자리는 저장하지 않는다. 손상 목록이 바뀔 때마다 처음부터 다시 돌린다(설계 4.6).
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4장

import { anchorForBox, baseAnchor, blockBoxAt } from './labelLayout.js';

export const MAX_STEPS = 8; // 4.3: k = 1..8까지만 찾는다
export const ARROW_HEAD_FACTOR = 0.5; // 화살촉 길이 = 글자 높이 × 0.5 (= 150)
export const ARROW_HEAD_ANGLE = Math.PI / 6; // 화살대에서 벌어진 각 30°

export function boxOfBounds(bounds) {
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

// 닿기만 한 상자는 겹치지 않은 것으로 본다(설계 6장 검증). 간격 100이 딱 맞게 떨어진 자리를
// "막혔다"고 보면 기본 자리가 쓸데없이 밀려난다.
export function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function distanceToBox([x, y], box) {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

// 상자 테두리 위에서 점에 가장 가까운 점. 점이 상자 안이면 가장 가까운 변으로 밀어낸다.
export function nearestPointOnBox([x, y], box) {
  const left = box.x;
  const right = box.x + box.width;
  const bottom = box.y;
  const top = box.y + box.height;
  const cx = clamp(x, left, right);
  const cy = clamp(y, bottom, top);
  if (cx !== x || cy !== y) return [cx, cy];
  const distances = [x - left, right - x, y - bottom, top - y];
  const nearest = Math.min(...distances);
  if (nearest === distances[0]) return [left, y];
  if (nearest === distances[1]) return [right, y];
  if (nearest === distances[2]) return [x, bottom];
  return [x, top];
}

function upAnchor(bounds, block, gap, k) {
  const [x, y] = baseAnchor(bounds, gap);
  return [x, y + k * block.box.height];
}

// 시도 순서(4.3): 기본 자리 → k = 1..8마다 위 → 오른쪽 → 왼쪽 → 아래, 점점 멀리.
export function candidatePlacements(bounds, block, gap) {
  const w = block.box.width;
  const h = block.box.height;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const list = [{ place: 'base', anchor: baseAnchor(bounds, gap) }];
  for (let k = 1; k <= MAX_STEPS; k++) {
    list.push({ place: 'up', anchor: upAnchor(bounds, block, gap, k) });
    // 오른쪽·왼쪽은 세로가 경계상자 중앙이고, 아래는 가로가 경계상자 가운데다.
    list.push({ place: 'right', anchor: anchorForBox(block, bounds.maxX + gap + (k - 1) * h, centerY - h / 2) });
    list.push({ place: 'left', anchor: anchorForBox(block, bounds.minX - gap - (k - 1) * h - w, centerY - h / 2) });
    list.push({ place: 'down', anchor: anchorForBox(block, (bounds.minX + bounds.maxX) / 2 - w / 2, bounds.minY - gap - (k - 1) * h - h) });
  }
  return list.map((candidate) => ({ ...candidate, box: blockBoxAt(block, candidate.anchor) }));
}

// 화살표(4.4). 기본 자리를 벗어난 라벨에만 그린다.
export function leaderFor(labelBox, bounds, font) {
  const target = boxOfBounds(bounds);
  // 변의 중점: 위 → 오른쪽 → 아래 → 왼쪽. 거리가 같으면 이 순서에서 앞선 것을 쓴다(결정적).
  const mids = [
    [labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height],
    [labelBox.x + labelBox.width, labelBox.y + labelBox.height / 2],
    [labelBox.x + labelBox.width / 2, labelBox.y],
    [labelBox.x, labelBox.y + labelBox.height / 2],
  ];
  let from = mids[0];
  let best = Infinity;
  for (const mid of mids) {
    const distance = distanceToBox(mid, target);
    if (distance < best) {
      best = distance;
      from = mid;
    }
  }
  const to = nearestPointOnBox(from, target);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const headLength = font * ARROW_HEAD_FACTOR;
  // 라벨이 손상에 맞닿아 시작점과 끝점이 같으면 방향을 정할 수 없다 — 화살촉을 끝점에 모은다.
  if (dx === 0 && dy === 0) return { from, to, head: [to, to] };
  const angle = Math.atan2(dy, dx);
  const head = [angle + ARROW_HEAD_ANGLE, angle - ARROW_HEAD_ANGLE].map((a) => [
    to[0] - headLength * Math.cos(a),
    to[1] - headLength * Math.sin(a),
  ]);
  return { from, to, head };
}

function orderKey(item) {
  return Number.isFinite(item.number) ? item.number : Number.POSITIVE_INFINITY;
}

function compareId(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// 후보 상자 전체를 감싸는 범위. 이 범위 밖의 장애물은 어떤 후보와도 겹칠 수 없으므로 검사에서 뺀다.
// 손상 수천 개짜리 도면에서 손상마다 전체 목록을 훑지 않게 하는 유일한 장치다.
function windowOf(candidates) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { box } of candidates) {
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 손상마다 라벨 자리를 정한다. 번호 순서대로 자리를 잡고(앞번호가 좋은 자리를 먼저 차지한다),
 * 앞서 잡은 라벨 상자는 뒷번호의 장애물이 된다. 같은 손상 집합이면 넣은 순서와 상관없이 항상
 * 같은 결과가 나온다.
 *
 * @param {Array<{ id: string, number: number|null, bounds: object, block: object }>} items
 * @param {{ gap: number, font: number }} sizes - 손상과 라벨 사이 간격, 글자 높이(화살촉 크기)
 * @returns {Map<string, { anchor: number[], box: object, displaced: boolean, leader: object|null }>}
 */
export function placeLabels(items, { gap, font }) {
  const order = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.bounds && item.block)
    .slice()
    .sort((a, b) => orderKey(a) - orderKey(b) || compareId(String(a.id), String(b.id)));

  const obstacles = order.map((item) => ({ id: String(item.id), box: boxOfBounds(item.bounds) }));
  const placedBoxes = [];
  const result = new Map();

  for (const item of order) {
    const id = String(item.id);
    const candidates = candidatePlacements(item.bounds, item.block, gap);
    const window = windowOf(candidates);
    // 자기 손상은 장애물에서 뺀다(4.1).
    const near = obstacles.filter((o) => o.id !== id && boxesOverlap(window, o.box)).map((o) => o.box);
    const nearPlaced = placedBoxes.filter((box) => boxesOverlap(window, box));

    let chosen = null;
    for (const candidate of candidates) {
      let free = true;
      for (const box of near) {
        if (boxesOverlap(candidate.box, box)) {
          free = false;
          break;
        }
      }
      if (free) {
        for (const box of nearPlaced) {
          if (boxesOverlap(candidate.box, box)) {
            free = false;
            break;
          }
        }
      }
      if (free) {
        chosen = candidate;
        break;
      }
    }
    // k = 8까지 다 막혀 있으면 위로 8h 자리를 그냥 쓴다 — 겹치더라도 라벨은 반드시 그린다(4.3).
    if (!chosen) {
      const anchor = upAnchor(item.bounds, item.block, gap, MAX_STEPS);
      chosen = { place: 'up', anchor, box: blockBoxAt(item.block, anchor) };
    }

    const displaced = chosen.place !== 'base';
    placedBoxes.push(chosen.box);
    result.set(id, {
      anchor: chosen.anchor,
      box: chosen.box,
      displaced,
      leader: displaced ? leaderFor(chosen.box, item.bounds, font) : null,
    });
  }

  return result;
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/viewer/labelCollision.js
```

```bash
git add server/public/viewer/labelCollision.js server/test/labelCollision.test.ts
git commit -m "$(printf '%s\n' '라벨이 겹치지 않을 자리를 찾는 순수 모듈' '' '번호 순서대로 한 손상씩 자리를 잡는다. 기본 자리(도형 바로 위)가 막혀 있으면' 'k = 1..8마다 위·오른쪽·왼쪽·아래를 차례로 보고, 다 막혀 있으면 위로 8h를 그냥 쓴다.' '기본 자리를 벗어난 라벨에는 손상을 가리키는 화살표 좌표를 함께 낸다.' '' '단위를 가리지 않는다 — 경계상자와 라벨 크기를 같은 단위로 받아 그 단위로 답한다.' '후보 상자 전체를 감싸는 범위 밖의 장애물은 검사하지 않는다(손상 수천 개 도면).' '' '근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4장' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 자리 잡기와 화살표 기하가 단위 테스트로 고정된다. 아직 화면·DXF에 붙지 않았다.

---

## Task 4: 화면에 붙인다 — 배치 캐시, 화살표, 노란 사진 줄

`setDamages`에서 번호를 다시 계산하는 바로 그 자리에서 배치도 한 번만 계산한다(설계 4.5). 배치는 world 단위라 확대·축소해도 바뀌지 않으므로 매 프레임은 기준점을 화면 좌표로 옮겨 그리기만 한다. `mmPerWorld`가 없는 도면은 배치를 `null`로 두고 지금처럼 `labelAnchor`로 그린다 — 겹침 방지를 하지 않는다.

배치 계산은 DOM을 쓰지 않는 `computeLabelPlacements`로 빼서 테스트한다. `createOverlay` 안의 그리기 코드는 읽기 + `node --check`로 확인한다.

**Files:**
- Modify: `server/public/viewer/overlay.js`
- Modify: `server/test/overlay.test.ts`

**Interfaces:**
- Consumes: `boundsOf` from `./geometry.js`, `labelBlock` from `./labelLayout.js`, `placeLabels` from `./labelCollision.js`, `computeNumbers` from `./quantities.js`
- Produces:
  - `PHOTO_COLOR = '#f5c400'`
  - `computeLabelPlacements(damages, numbers, mmPerWorld)` → `Map<id, { anchor, box, displaced, leader }> | null` — `mmPerWorld`가 없거나 유한하지 않거나 0 이하면 `null`(겹침 방지 안 함)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/overlay.test.ts`의 import 목록에 `computeLabelPlacements`·`PHOTO_COLOR`를 더하고, 파일 끝(`describe('ANCHORLK 화면 근사 무늬', ...)` 앞)에 붙인다:

```ts
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.5
describe('computeLabelPlacements', () => {
  type Pt2 = [number, number];

  function rectDamage(id: string, x: number): unknown {
    const world: Pt2[] = [[x, 0], [x + 1000, 0], [x + 1000, 400], [x, 400]];
    return {
      id,
      type: 'spalling',
      geometry: { kind: 'rect', world, dwg: world },
      measured: { width: 1.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    };
  }

  const damages = [rectDamage('a', 0), rectDamage('b', 1050)];
  const numbers = computeNumbers(damages);

  it('mmPerWorld가 없으면 null — 겹침 방지를 하지 않는다', () => {
    expect(computeLabelPlacements(damages, numbers, null)).toBeNull();
    expect(computeLabelPlacements(damages, numbers, 0)).toBeNull();
    expect(computeLabelPlacements(damages, numbers, Infinity)).toBeNull();
  });

  it('나란히 붙은 손상 둘이면 2번 라벨이 위로 블록 높이만큼 올라가고 화살표가 붙는다', () => {
    // mmPerWorld = 1이면 world 단위가 곧 mm다. 블록 높이 750(labelLayout.test.ts 실측).
    const placements = computeLabelPlacements(damages, numbers, 1)!;
    expect(placements.get('a')!.anchor).toEqual([500, 500]);
    expect(placements.get('a')!.displaced).toBe(false);
    expect(placements.get('a')!.leader).toBeNull();
    expect(placements.get('b')!.anchor).toEqual([1550, 1250]);
    expect(placements.get('b')!.displaced).toBe(true);
    expect(placements.get('b')!.leader!.to[1]).toBe(400); // 손상 윗변을 가리킨다
  });

  it('world 단위가 작아지면(mmPerWorld가 커지면) 라벨도 그만큼 작아진다', () => {
    const half = computeLabelPlacements(damages, numbers, 2)!;
    expect(half.get('a')!.box.width).toBeCloseTo(computeLabelPlacements(damages, numbers, 1)!.get('a')!.box.width / 2, 6);
  });

  it('world 좌표가 없는 손상은 건너뛴다', () => {
    const broken = { id: 'x', type: 'spalling', geometry: { kind: 'rect', world: [] }, attrs: {} };
    const placements = computeLabelPlacements([...damages, broken], computeNumbers([...damages, broken]), 1)!;
    expect(placements.has('x')).toBe(false);
  });

  it('사진 줄 색은 선택과 상관없이 노란색이다', () => {
    expect(PHOTO_COLOR).toBe('#f5c400');
  });
});
```

- [ ] **Step 2: `overlay.js`에 배치 계산과 그리기를 더한다**

1. import를 더한다:

```js
import { placeLabels } from './labelCollision.js';
```

2. 색 상수를 더한다(`SELECTED_COLOR` 옆):

```js
// 사진 줄은 도면의 `사진번호` 레이어(노랑, 색 2)와 같아 보이게 그린다. 선택해도 노란색 그대로다.
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
export const PHOTO_COLOR = '#f5c400';
```

3. `describeDamageRender` 아래에 붙인다:

```js
// 손상 목록이 바뀔 때 한 번만 부른다(설계 4.5) — 확대·축소해도 결과가 같으므로 매 프레임 다시
// 계산하지 않는다. 계산은 world 단위로 한다: 도면 mm 치수를 mmPerWorld로 나눠 넣고, 답도
// world 좌표로 받아 그릴 때 화면 좌표로 옮긴다.
//
// mmPerWorld를 구하지 못한 도면(도면 좌표 변환 불가)은 null을 돌려준다 — 그런 도면은 화면 고정
// 크기로 그리고 겹침 방지를 하지 않는다(산출도 되지 않으므로 화면과 도면이 어긋날 일이 없다).
export function computeLabelPlacements(damages, numbers, mmPerWorld) {
  if (mmPerWorld === null || mmPerWorld === undefined || !Number.isFinite(mmPerWorld) || !(mmPerWorld > 0)) return null;
  const font = FONT_HEIGHT_MM / mmPerWorld;
  const circleR = font * CIRCLE_RADIUS_FACTOR;
  const gap = LABEL_GAP_MM / mmPerWorld;

  const items = [];
  for (const damage of Array.isArray(damages) ? damages : []) {
    const bounds = boundsOf(damage?.geometry?.world);
    if (!bounds) continue;
    const id = String(damage?.id);
    const number = numbers.get(id) ?? null;
    const plan = describeDamageRender(damage, null, number);
    items.push({
      id,
      number,
      bounds,
      block: labelBlock({ name: plan.name, dimension: plan.dimension, photo: plan.photo, number, font, circleR }),
    });
  }
  return placeLabels(items, { gap, font });
}
```

4. `createOverlay` 안을 고친다. `let numbers = new Map();` 아래에 더한다:

```js
  // 라벨 자리도 번호와 같은 자리에서 한 번만 계산한다(설계 4.5). null이면 겹침 방지를 하지
  // 않는 도면이라는 뜻이고, 그때는 예전처럼 도형에서 바로 위 자리에 그린다.
  let placements = null;
```

5. `renderDamage`의 라벨 그리는 부분(402~413행)을 아래로 교체한다:

```js
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
```

6. `setDamages`를 고친다:

```js
    setDamages(list) {
      // 참조가 같으면(선택만 바뀌는 등) 목록 자체는 안 바뀐 것이다 — editor의 모든 변경 함수는
      // 항상 새 배열을 만드므로(damageDoc.js) 참조 비교로 충분하다.
      if (list !== damages) {
        damages = list;
        numbers = computeNumbers(damages);
        // 라벨 자리는 저장하지 않는다 — 목록이 바뀔 때마다 처음부터 다시 잡는다(설계 4.6).
        // 손상 하나를 옮기면 이웃 라벨의 자리도 바뀔 수 있고, 그게 맞는 동작이다.
        placements = computeLabelPlacements(damages, numbers, computeScale(mapper).mmPerWorld);
      }
      requestRender();
    },
```

- [ ] **Step 3: 읽어서 확인하고 검증한다**

`node`에는 DOM이 없어 `createOverlay`는 단위 테스트로 돌릴 수 없다. 아래를 **읽어서** 확인한다:

1. `renderDamage`가 `placements`를 닫아 읽고 있고, `placements`가 `null`일 때 `labelAnchor` 경로로 떨어지는가.
2. 크기·회전 조절 중인 손상(`draft.activeId`)은 여전히 건너뛰므로 화살표도 그려지지 않는가.
3. `setDamages`가 참조가 같을 때는 다시 계산하지 않는가(팬·줌으로 배치가 다시 돌면 안 된다).
4. `render()` 안에는 `computeLabelPlacements` 호출이 **없는가**(매 프레임 계산 금지).

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/viewer/overlay.js
node --check server/public/viewer/main.js
```

- [ ] **Step 4: 커밋한다**

```bash
git add server/public/viewer/overlay.js server/test/overlay.test.ts
git commit -m "$(printf '%s\n' '화면 라벨에 겹침 방지와 화살표를 붙인다' '' '손상 목록이 바뀔 때 번호와 같은 자리에서 라벨 자리를 한 번만 계산한다.' '배치는 world 단위라 확대·축소해도 바뀌지 않으므로 매 프레임은 옮겨 그리기만 한다.' '' '도면 좌표 변환을 구하지 못한 도면은 배치를 계산하지 않고 예전처럼 그린다.' '사진 줄은 노란색으로, 기본 자리를 벗어난 라벨에는 화살표를 그린다.' '' '근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3·4장' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 앱 화면에서 붙어 있는 손상들의 라벨이 겹치지 않고, 옮겨진 라벨에 화살표가 붙고, 사진 줄이 노랗다.

---

## Task 5: DXF에 붙인다 — 사진번호 레이어, 화살표 LINE, 손상 전체를 모아 한 번 배치

겹침 방지는 **손상을 전부 알아야** 계산할 수 있으므로, `exportDrawing`이 산출할 손상을 모두 모은 뒤 `damageLabels`를 한 번 부르고 그 결과를 손상마다 꺼내 쓴다.

`ensureLayer(doc, alloc, name, colorIndex)`는 이미 이름과 색을 인자로 받는다(일반화 완료 상태) — **함수는 손대지 않고** `사진번호`·색 2 상수를 더해 한 번 더 부른다. 레이어는 사진 줄이 있든 없든 항상 만든다(있는지 미리 훑어 조건을 나누면 같은 도면을 두 번 산출했을 때 레이어 목록이 달라진다).

**Files:**
- Modify: `server/src/export/dxfDocument.ts`
- Modify: `server/src/export/labelPlacement.ts`
- Modify: `server/src/export/exportDrawing.ts`
- Modify: `server/test/labelPlacement.test.ts`
- Modify: `server/test/exportDrawing.test.ts`
- Modify: `server/test/dxfDocument.test.ts`

**Interfaces:**
- Consumes: `boundsOf`, `labelBlock`, `placeBlock`, `placeLabels`, `lineEntity`
- Produces (`dxfDocument.ts`): `PHOTO_LAYER = '사진번호'`, `PHOTO_COLOR = 2`
- Produces (`labelPlacement.ts`):
  - `interface LabelLeader { from: Point; to: Point; head: [Point, Point] }`
  - `DamageLabel`에 `leader: LabelLeader | null` 추가
  - `damageLabels(items: Array<{ id: string; number: number | null; damage: unknown }>): Map<string, DamageLabel>` — `dwg`가 없는 손상은 Map에 들어가지 않는다
  - `damageLabel(damage, number)` — 손상 하나짜리 겉포장(장애물이 없으니 항상 기본 자리)
  - `labelEntities(label, alloc, owner): DxfPair[]` — 원 + 줄마다 TEXT(사진 줄만 `사진번호`/색 2) + 화살표 LINE 3개

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/dxfDocument.test.ts`의 `describe('ensureLayer', ...)` 안, `'없으면 LAYER 표의 ENDTAB 앞에 추가한다'` 바로 아래에 붙인다(import 목록에 `PHOTO_COLOR`·`PHOTO_LAYER`를 더한다):

```ts
  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
  // ensureLayer는 이미 이름과 색을 인자로 받는다 — 사진번호 레이어도 같은 함수로 더한다.
  it('사진번호 레이어도 같은 방식으로 더한다 (노랑, 색 2)', async () => {
    const doc = parseDxf(await templateText());
    ensureLayer(doc, createHandleAllocator(doc), PHOTO_LAYER, PHOTO_COLOR);
    expect(layerNames(doc)).toEqual(['0', PHOTO_LAYER]);
    expect(serializeDxf(doc)).toContain('  2\n사진번호\n 70\n     0\n 62\n     2\n  6\nContinuous\n');
  });

  it('두 레이어를 잇달아 더하면 둘 다 남고 핸들이 다르다', async () => {
    const doc = parseDxf(await templateText());
    const alloc = createHandleAllocator(doc);
    ensureLayer(doc, alloc, DAMAGE_LAYER, 1);
    ensureLayer(doc, alloc, PHOTO_LAYER, PHOTO_COLOR);
    expect(layerNames(doc)).toEqual(['0', DAMAGE_LAYER, PHOTO_LAYER]);
    const handles = doc.pairs.filter((p) => p.code === 5).map((p) => p.value.trim());
    expect(new Set(handles).size).toBe(handles.length);
  });
```

`server/test/labelPlacement.test.ts`의 `describe('labelEntities', ...)`를 아래로 교체한다:

```ts
describe('labelEntities', () => {
  function layerOf(pairs: DxfPair[], text: string): { layer: string; color: string } {
    const start = pairs.findIndex((p) => p.code === 1 && p.value === text);
    // 코드 8(레이어)·62(색)는 같은 엔티티의 코드 1보다 앞에 있다.
    let layer = '';
    let color = '';
    for (let i = start; i >= 0; i--) {
      if (pairs[i].code === 62 && color === '') color = pairs[i].value.trim();
      if (pairs[i].code === 8 && layer === '') layer = pairs[i].value;
      if (pairs[i].code === 0) break;
    }
    return { layer, color };
  }

  it('원 하나와 글자들을 만들고 핸들을 하나씩 받는다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const alloc = new HandleAllocator(0x300);
    const pairs = labelEntities(label, alloc, '1F');

    expect(entityTypes(pairs)).toEqual(['CIRCLE', 'TEXT', 'TEXT', 'TEXT']);
    expect(pairs.filter((p) => p.code === 5).map((p) => p.value)).toEqual(['300', '301', '302', '303']);
    expect(alloc.seed).toBe('304');
    expect(pairs.filter((p) => p.code === 40).some((p) => p.value === '300.0')).toBe(true);
  });

  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
  it('사진 줄만 레이어 사진번호·색 2로 나가고 나머지는 신규손상·색 1이다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const pairs = labelEntities(label, new HandleAllocator(0x300), '1F');
    expect(layerOf(pairs, '#12, #13')).toEqual({ layer: '사진번호', color: '2' });
    expect(layerOf(pairs, '박락')).toEqual({ layer: '신규손상', color: '1' });
    expect(layerOf(pairs, '7')).toEqual({ layer: '신규손상', color: '1' });
  });

  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.4
  it('화살표가 있으면 LINE 3개를 신규손상 레이어에 더한다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const head: [Pt, Pt] = [[50, 50], [50, -50]];
    const withLeader = { ...label, leader: { from: [0, 0] as Pt, to: [100, 0] as Pt, head } };
    const pairs = labelEntities(withLeader, new HandleAllocator(0x300), '1F');
    expect(entityTypes(pairs).filter((t) => t === 'LINE')).toHaveLength(3);
    expect(layerOf(pairs, '박락').layer).toBe('신규손상');
  });

  it('기본 자리에 놓인 라벨에는 화살표가 없다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    expect(label.leader).toBeNull();
    expect(entityTypes(labelEntities(label, new HandleAllocator(0x300), '1F'))).not.toContain('LINE');
  });

  it('그릴 것이 없으면 빈 배열', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(labelEntities(label, new HandleAllocator(0x300), '1F')).toEqual([]);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.2~4.3
describe('damageLabels', () => {
  function sideBySide(id: string, x: number) {
    const points: Pt[] = [[x, 0], [x + 1000, 0], [x + 1000, 400], [x, 400]];
    return {
      id,
      type: 'spalling',
      geometry: { kind: 'rect', world: points, dwg: points },
      measured: { width: 1.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    };
  }

  it('붙어 있는 손상 둘이면 2번 라벨이 위로 블록 높이(750)만큼 올라가고 화살표가 붙는다', () => {
    const a = sideBySide('a', 0);
    const b = sideBySide('b', 1050);
    const labels = damageLabels([
      { id: 'a', number: 1, damage: a },
      { id: 'b', number: 2, damage: b },
    ]);
    const first = labels.get('a')!.lines.find((l) => l.text === '1.2x1.5')!;
    const second = labels.get('b')!.lines.find((l) => l.text === '1.2x1.5')!;
    expect(second.position[1] - first.position[1]).toBeCloseTo(750, 6);
    expect(labels.get('a')!.leader).toBeNull();
    expect(labels.get('b')!.leader).not.toBeNull();
    expect(labels.get('b')!.leader!.to[1]).toBeCloseTo(400, 6); // 손상 윗변을 가리킨다
  });

  it('dwg가 없는 손상은 Map에 들어가지 않는다', () => {
    const labels = damageLabels([
      { id: 'a', number: 1, damage: { id: 'a', type: 'crack', geometry: { kind: 'polyline', world: RECT, dwg: null } } },
    ]);
    expect(labels.size).toBe(0);
  });
});
```

(파일 위쪽 import에 `damageLabels`를 더하고, `type Pt = [number, number];`는 이미 있다.)

`server/test/exportDrawing.test.ts`에 붙인다:

```ts
  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3·4장
  describe('라벨 겹침 방지와 사진번호 레이어', () => {
    function wide(id: string, x: number, photoNumbers: string[] = []) {
      const points: Pt[] = [[x, 0], [x + 1000, 0], [x + 1000, 400], [x, 400]];
      return {
        id,
        type: 'spalling',
        createdAt: '2026-09-16T00:00:00.000Z',
        geometry: { kind: 'rect', world: points, dwg: points },
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers },
      };
    }

    // TEXT 엔티티마다 값·레이어·색·정렬점을 모아 준다.
    function texts(dxfText: string) {
      const doc = parseDxf(dxfText);
      const out: Array<{ value: string; layer: string; color: number; y: number }> = [];
      for (let i = 0; i < doc.pairs.length; i++) {
        if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'TEXT') continue;
        const entry = { value: '', layer: '', color: 0, y: 0 };
        let j = i + 1;
        for (; j < doc.pairs.length && doc.pairs[j].code !== 0; j++) {
          const p = doc.pairs[j];
          if (p.code === 8) entry.layer = p.value;
          else if (p.code === 62) entry.color = Number(p.value);
          else if (p.code === 1) entry.value = p.value;
          else if (p.code === 21) entry.y = Number(p.value);
        }
        out.push(entry);
        i = j - 1;
      }
      return out;
    }

    it('나란히 붙은 손상 둘이면 2번 라벨이 위로 블록 높이만큼 어긋나고 화살표 LINE 3개가 생긴다', async () => {
      const original = await template();
      const result = exportDamagesToDxf(original, [wide('a', 0), wide('b', 1050)]);
      const dimensions = texts(result.dxfText)
        .filter((t) => t.value === '1.2x1.5')
        .map((t) => t.y)
        .sort((x, y) => x - y);
      expect(dimensions).toHaveLength(2);
      expect(dimensions[1] - dimensions[0]).toBeCloseTo(750, 6);
      // 원본 LINE은 그대로 있고 화살표 3개만 늘어난다
      expect(entityCount(result.dxfText, 'LINE') - entityCount(original, 'LINE')).toBe(3);
      expect(result.warnings).toEqual([]);
    });

    it('사진 줄은 사진번호 레이어·색 2로 나가고 레이어가 없으면 더해진다', async () => {
      const result = exportDamagesToDxf(await template(), [wide('a', 0, ['12', '13'])]);
      expect(layerNames(parseDxf(result.dxfText))).toContain('사진번호');
      const photo = texts(result.dxfText).find((t) => t.value === '#12, #13')!;
      expect(photo.layer).toBe('사진번호');
      expect(photo.color).toBe(2);
      // 다른 줄은 그대로 신규손상이다
      expect(texts(result.dxfText).find((t) => t.value === '박락')!.layer).toBe('신규손상');
    });

    it('사진이 없는 도면에도 사진번호 레이어는 만들어 둔다 (같은 도면이 두 번 다르게 나오지 않게)', async () => {
      const result = exportDamagesToDxf(await template(), [wide('a', 0)]);
      expect(layerNames(parseDxf(result.dxfText))).toContain('사진번호');
    });
  });
```

- [ ] **Step 2: `dxfDocument.ts`에 상수를 더한다**

`server/src/export/dxfDocument.ts` 26~27행 아래에 붙인다:

```ts
// 사진번호는 손상과 따로 켜고 끌 수 있게 별도 레이어·색으로 낸다(노랑).
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
export const PHOTO_LAYER = '사진번호';
export const PHOTO_COLOR = 2;
```

`ensureLayer`는 이미 이름과 색을 인자로 받으므로 **고치지 않는다.**

- [ ] **Step 3: `labelPlacement.ts`가 여러 손상을 한 번에 배치하게 한다**

Task 2에서 쓴 `labelPlacement.ts`의 `damageLabel` 이후를 아래로 교체한다(import에 `placeLabels`, `lineEntity`, `PHOTO_COLOR`, `PHOTO_LAYER`를 더한다):

```ts
export interface LabelLeader {
  from: Point;
  to: Point;
  /** 끝점에서 뻗는 화살촉 점 둘 */
  head: [Point, Point];
}

export interface DamageLabel {
  circle: { center: Point; radius: number } | null;
  lines: LabelTextLine[];
  height: number;
  /** 기본 자리를 벗어난 라벨에만 있다(설계 4.4) */
  leader: LabelLeader | null;
}

export interface LabelItem {
  id: string;
  number: number | null;
  damage: unknown;
}

// 손상 전체를 한 번에 배치한다 — 겹침 방지는 다른 손상을 모두 알아야 계산할 수 있다.
// dwg 좌표가 없는 손상은 도면에 놓지 못하므로 Map에 넣지 않는다.
export function damageLabels(items: LabelItem[]): Map<string, DamageLabel> {
  const entries = [];
  for (const item of items) {
    const points = dwgPointsOf(item.damage);
    if (!points) continue;
    const bounds = boundsOf(points);
    if (!bounds) continue;
    entries.push({
      id: item.id,
      number: item.number,
      bounds,
      block: labelBlock({
        name: drawingNameOf(item.damage),
        dimension: dimensionTextOf(item.damage),
        photo: photoTextOf(item.damage),
        number: item.number,
        font: FONT_HEIGHT_MM,
        circleR: CIRCLE_RADIUS_MM,
      }),
    });
  }

  const placements = placeLabels(entries, { gap: LABEL_GAP_MM, font: FONT_HEIGHT_MM });
  const labels = new Map<string, DamageLabel>();
  for (const entry of entries) {
    const placement = placements.get(entry.id);
    if (!placement) continue;
    // 도면은 y가 위로 증가하고 배치 모듈도 같은 방향이라 부호를 건드릴 일이 없다.
    const placed = placeBlock(entry.block, placement.anchor);
    labels.set(entry.id, {
      circle: placed.circle ? { center: [placed.circle.cx, placed.circle.cy] as Point, radius: placed.circle.r } : null,
      lines: placed.lines.map((line) => ({
        // TEXT는 수직 중간 정렬(73=2)이라 정렬점은 베이스라인에서 글자 높이 × 0.35 위다.
        position: [line.x, line.y + BASELINE_TO_MIDDLE_MM] as Point,
        text: line.text,
        align: line.anchor === 'middle' ? 'center' : 'left',
        key: line.key,
      })),
      height: FONT_HEIGHT_MM,
      leader: placement.leader as LabelLeader | null,
    });
  }
  return labels;
}

// 손상 하나짜리 겉포장. 막는 것이 없으므로 언제나 기본 자리에 놓인다.
export function damageLabel(damage: unknown, number: number | null): DamageLabel | null {
  const id = String((damage as { id?: unknown } | null)?.id ?? '');
  return damageLabels([{ id, number, damage }]).get(id) ?? null;
}

function baseFor(alloc: HandleAllocator, owner: string, layer: string, colorIndex: number): EntityBase {
  return { handle: alloc.next(), owner, layer, colorIndex };
}

export function labelEntities(label: DamageLabel, alloc: HandleAllocator, owner: string): DxfPair[] {
  const pairs: DxfPair[] = [];
  if (label.circle) {
    pairs.push(...circleEntity(baseFor(alloc, owner, DAMAGE_LAYER, DAMAGE_COLOR), label.circle.center, label.circle.radius));
  }
  for (const line of label.lines) {
    if (line.text === '') continue;
    // 사진 줄만 노란 `사진번호` 레이어로 낸다 — 캐드에서 따로 켜고 끌 수 있어야 한다(설계 3장).
    const isPhoto = line.key === 'photo';
    const base = baseFor(alloc, owner, isPhoto ? PHOTO_LAYER : DAMAGE_LAYER, isPhoto ? PHOTO_COLOR : DAMAGE_COLOR);
    pairs.push(...textEntity(base, line.position, label.height, line.text, line.align));
  }
  // 화살대 1개 + 화살촉 2개 = LINE 3개(설계 4.4).
  if (label.leader) {
    const { from, to, head } = label.leader;
    for (const [a, b] of [[from, to], [head[0], to], [head[1], to]] as Array<[Point, Point]>) {
      pairs.push(...lineEntity(baseFor(alloc, owner, DAMAGE_LAYER, DAMAGE_COLOR), a, b));
    }
  }
  return pairs;
}
```

- [ ] **Step 4: `exportDrawing.ts`가 손상을 모두 모은 뒤 배치하게 한다**

1. import를 고친다:

```ts
import { damageLabels, labelEntities } from './labelPlacement.js';
```

`dxfDocument.js`에서 가져오는 목록에 `PHOTO_COLOR`, `PHOTO_LAYER`를 더한다.

2. `included` 항목에 `id`를 담는다(111~122행):

```ts
  const included: Array<{ id: string; damage: unknown; number: number; points: Point[] }> = [];
  let skipped = 0;
  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id);
    const number = numbers.get(id) ?? 0;
    const points = dwgPointsOf(damage);
    if (!points) {
      skipped += 1;
      continue;
    }
    included.push({ id, damage, number, points });
  }
  included.sort((a, b) => a.number - b.number);
```

3. 레이어를 둘 다 만든다(126행):

```ts
  ensureLayer(doc, alloc, DAMAGE_LAYER, DAMAGE_COLOR);
  // 사진 줄이 있든 없든 만들어 둔다 — 있는지 미리 훑어 조건을 나누면 같은 도면을 두 번 산출했을
  // 때 레이어 목록이 달라진다.
  ensureLayer(doc, alloc, PHOTO_LAYER, PHOTO_COLOR);
```

4. 라벨을 먼저 한 번에 구한다(129~135행):

```ts
  const pairs: DxfPair[] = [];
  const circleWarnings: DamageEntitiesWarnings = { circlesTruncated: false };
  // 겹침 방지는 다른 손상을 모두 알아야 계산할 수 있으므로, 도형을 만들기 전에 한 번에 구한다
  // (설계 4.2: 번호 순서대로 자리를 잡는다).
  const labels = damageLabels(
    included.map((entry) => ({ id: entry.id, number: entry.number > 0 ? entry.number : null, damage: entry.damage })),
  );
  for (const entry of included) {
    appendAll(pairs, damageEntities(entry.damage, alloc, owner, circleWarnings));
    const label = labels.get(entry.id);
    if (label) appendAll(pairs, labelEntities(label, alloc, owner));
  }
```

- [ ] **Step 5: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

손상 3,000개 스트레스 테스트(`exportDrawing.test.ts`의 `넘침 표가 아주 많아도…`)가 **몇 초 안에** 끝나는지 본다. 크게 느려졌다면 `labelCollision.js`의 후보 범위 거르기(`windowOf`)가 제대로 걸리는지 확인한다.

```bash
git add server/src/export/dxfDocument.ts server/src/export/labelPlacement.ts server/src/export/exportDrawing.ts server/test/dxfDocument.test.ts server/test/labelPlacement.test.ts server/test/exportDrawing.test.ts
git commit -m "$(printf '%s\n' 'DXF 라벨에 겹침 방지·화살표·사진번호 레이어를 붙인다' '' '겹침 방지는 다른 손상을 모두 알아야 계산할 수 있어, 산출할 손상을 모은 뒤' 'damageLabels로 한 번에 자리를 잡고 손상마다 꺼내 쓴다.' '' '사진 줄 TEXT는 레이어 사진번호·색 2로 낸다(ensureLayer는 이미 이름·색을 받는다).' '기본 자리를 벗어난 라벨에는 화살대 1개 + 화살촉 2개 = LINE 3개를 더한다.' '' '근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3·4장' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 산출 DXF의 라벨이 화면과 같은 자리에 놓이고, 사진번호가 노란 별도 레이어로 나가고, 옮겨진 라벨에 화살표가 붙는다.

---

## Task 6: 문서 — README, 캐드 확인표, 대체된 설계 안내

**Files:**
- Modify: `README.md`
- Modify: `docs/DXF산출-테스트-결과.md`
- Modify: `docs/superpowers/specs/2026-09-13-damage-attributes-design.md`
- Modify: `docs/superpowers/specs/2026-09-15-dxf-export-design.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음(문서)

- [ ] **Step 1: README의 라벨 설명을 고친다**

`README.md` 81~82행 언저리의 두 줄을 아래로 교체한다:

```markdown
   - `<도면이름>_손상.dxf`가 저장됩니다. 원본은 그대로 있고 `신규손상` 레이어에 빨간색으로 손상이 더해집니다
   - 손상마다 도형(선/사각형 + 유형별 해치·기호)과 라벨이 들어갑니다. 라벨은 번호 원 옆에 첫 줄 글자(균열은 치수, 다른 유형은 이름)가 붙고 둘째 줄부터 그 글자에 맞춰 들여씁니다
   - 사진번호는 `#12, #13` 형식으로 **노란색 `사진번호` 레이어**에 따로 들어갑니다 — 캐드에서 이 레이어만 끄면 사진번호만 사라집니다
   - 손상이 붙어 있어 라벨이 겹칠 자리면 빈 자리로 옮기고 손상을 가리키는 **화살표**를 그립니다. 앱 화면에서 보이는 라벨 자리와 같습니다
```

- [ ] **Step 2: 캐드 확인표에 행을 더한다**

`docs/DXF산출-테스트-결과.md`의 표 끝(25번 아래)에 붙인다:

```markdown
| 26 | 라벨 첫 줄이 번호 원 **옆**에 붙어 있다 (균열은 치수 `⑰ 0.2/0.3`, 다른 유형은 이름 `⑰ 파손`) | | |
| 27 | 둘째 줄부터 첫 줄 글자의 왼쪽에 맞춰 들여쓰기가 되어 있다 (빈 줄이 없다) | | |
| 28 | 사진번호가 `#12, #13` 형식이다 (`사진 ` 접두어가 없다) | | |
| 29 | 사진번호가 **노란색**이고 `사진번호` 레이어에 있다 (그 레이어만 끄면 사진번호만 사라진다) | | |
| 30 | 붙어 있는 손상들의 라벨이 서로 겹치지 않는다 | | |
| 31 | 자리를 옮긴 라벨에 **화살표**가 있고 그 손상을 가리킨다 (화살촉이 손상 경계에 닿는다) | | |
| 32 | 앱 화면에서 본 라벨 자리·화살표와 내려받은 DXF가 **같다** | | |
```

같은 문서의 `## 발견한 문제` 앞에 붙인다:

```markdown
## 라벨 겹침 어림값

설계 7장에서 미뤄 둔 항목이다. 글자 폭을 어림해서 잡으므로 아주 긴 이름(기타 손상현황)은 조금 겹칠 수 있다.

- 겹쳐 보이는 라벨이 있었는가(있다면 그 손상의 유형·손상현황):
- 화살표가 다른 손상을 가로질러 보기 나빴는가(사내 망도도 그렇게 그린다면 그대로 둔다):
```

- [ ] **Step 3: 대체된 설계 두 곳에 안내를 붙인다**

`docs/superpowers/specs/2026-09-13-damage-attributes-design.md`의 `### 5.2 도면 위 표시` 바로 아래에 붙인다:

```markdown
> **2026-09-16 대체:** 라벨 배치 규칙(줄 구성·정렬·겹침)은 `2026-09-16-label-layout-design.md`가 대체한다. 문구를 만드는 함수(`drawingNameOf`·`dimensionTextOf`)와 글자 높이·원 반지름·간격 값은 그대로다.
```

같은 파일의 `### 9.5 표시` 바로 아래에 붙인다:

```markdown
> **2026-09-16 대체:** 사진 줄 문구와 자리는 `2026-09-16-label-layout-design.md`가 대체한다(`사진 12, 13` → `#12, #13`, 별도 `사진번호` 레이어·노란색). 물량표에 넣지 않는 것은 그대로다.
```

`docs/superpowers/specs/2026-09-15-dxf-export-design.md`의 `## 6. 라벨 출력` 바로 아래에 붙인다:

```markdown
> **2026-09-16 대체:** 라벨 배치와 레이어는 `2026-09-16-label-layout-design.md`가 대체한다(원 옆 글자, 들여쓰기, 사진번호 레이어, 겹침 방지와 화살표). 글자 높이 300·원 반지름 255·간격 100·`TEXT` 정렬 코드와 "앱과 같은 파일을 서버가 그대로 불러 쓴다"는 방침은 그대로다.
```

- [ ] **Step 4: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add README.md docs/DXF산출-테스트-결과.md docs/superpowers/specs/2026-09-13-damage-attributes-design.md docs/superpowers/specs/2026-09-15-dxf-export-design.md
git commit -m "$(printf '%s\n' '라벨 배치 개정 문서와 확인표' '' 'README의 라벨 설명을 새 모양으로 고치고, 지스타캐드 확인표에 라벨 어긋남·화살표·' '사진번호 레이어 행을 더한다.' '' '대체된 설계 두 곳(2026-09-13 §5.2·§9.5, 2026-09-15 6장)에 새 설계를 가리키는' '한 줄을 붙여, 옛 문구를 보고 구현하는 일이 없게 한다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 사용자가 지스타캐드에서 무엇을 볼지 알 수 있고, 옛 설계를 읽어도 새 설계로 안내된다.

---

## 검증 명령 모음

작업 중 언제든 아래를 돌린다.

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/viewer/labelLayout.js
node --check server/public/viewer/labelCollision.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/quantities.js
node --check server/public/viewer/geometry.js
node --check server/public/viewer/main.js
```

실기기·캐드 확인은 Task 6의 확인표(`docs/DXF산출-테스트-결과.md` 26~32번)로 사용자와 함께 본다. 붙어 있는 손상을 여러 개 그려 화면과 내려받은 DXF의 라벨 자리가 같은지 보는 것이 핵심이다(설계 6장).

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 2장 첫 줄 A(균열=치수, 그 밖=이름) | 2 |
| 2장 둘째 줄부터 들여쓰기(A의 왼쪽 x) | 2 |
| 2장 블록 전체를 기준점 x에 가운데 맞춤 | 2 |
| 2장 없는 줄 건너뛰기(빈 줄 없음) | 2 |
| 2장 번호 없으면 원 없이 A부터 / A 없으면 원만 | 2 |
| 2장 글자 높이·원 반지름·줄 간격·원-글자 간격 그대로 | 2 |
| 3장 `#12, #13` 문구 | 1 |
| 3장 DXF 사진 줄 레이어 `사진번호`·색 2, 레이어 추가 | 5 |
| 3장 화면 사진 줄 노란색(선택해도 그대로) | 4 |
| 3장 물량표에 넣지 않음(변함없음) | — (건드리지 않음) |
| 4.1 장애물(다른 손상 경계상자, 이미 놓인 라벨), 자기 손상 제외 | 3 |
| 4.2 번호 순서대로, 입력 순서 무관 | 3 |
| 4.3 기본 자리, k = 1..8 위·오른쪽·왼쪽·아래 | 3 |
| 4.3 k = 8까지 다 막히면 위로 8h를 그냥 씀 | 3 |
| 4.4 화살표 시작·끝·화살촉(150, 30°), 기본 자리면 없음 | 3(기하) · 4(화면) · 5(DXF) |
| 4.5 단위 무관, DXF는 mm / 화면은 world | 2, 3 |
| 4.5 손상 목록이 바뀔 때 한 번만 계산 | 4 |
| 4.5 `mmPerWorld` 없으면 겹침 방지 안 함 | 4 |
| 4.5 글자 폭 어림(단위 무관) | 2 |
| 4.6 라벨 자리를 저장하지 않고 매번 다시 계산 | 3, 4 |
| 5장 번호·문구·크기 값 불변, 물량표 불변 | — (건드리지 않음) |
| 6장 단위 테스트 전부 | 1~5의 각 테스트 파일 |
| 6장 실기기·캐드 확인 | 6 |
| 7장 어림 계수 조정·화살표 가로지름 | 6(확인표에 적어 둠) |
