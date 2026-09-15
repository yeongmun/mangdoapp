# 망도틀별 번호 매기기 구현 계획 — 틀 인식, 틀마다 1번부터, 틀마다 자기 물량표

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사내 망도 한 장에 가로로 늘어선 `망도틀` 7개를 도면에서 알아보고, 손상 번호를 **틀마다 1번부터** 다시 매기며, 산출 DXF에서도 **틀마다 자기 안의 물량표**에 그 틀 손상만 채운다.

**Architecture:** 틀을 알아보는 일은 서버의 순수 함수 하나(`server/src/export/frames.ts`의 `findFrames`)가 맡는다 — 블록 이름이 아니라 "안에 `ACAD_TABLE`이 든 최상위 `INSERT`"로 알아보므로 다른 현장 도면에서도 동작한다. 그 결과의 **영역만**(`FrameBounds[]`) 도면 레코드에 실려 앱까지 가고, 손상을 틀에 배정하는 규칙과 번호를 매기는 규칙은 화면과 서버가 **같은 순수 모듈**(`server/public/viewer/quantities.js`)을 쓴다. 배정 입력은 `geometry.dwg` 하나뿐이라 화면과 산출이 같은 답을 낸다. `frames`가 비어 있으면(DWG 도면, 표 없는 도면, 옛 레코드) 코드는 **지금과 똑같이** 동작한다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict, `checkJs: false`), Express 5, vitest, 빌드 없는 ES 모듈 브라우저 JS(`server/public/viewer/*.js`, `allowJs: true`). 테스트는 **DOM 없이 node에서** 돌므로 새 로직은 전부 순수 함수여야 하고, `createOverlay`의 DOM 코드와 `main.js`는 읽기 + `node --check`로 확인한다. Expo 앱(`App.tsx` 등)은 이번 계획에서 **변경 없음**.

**Spec:** `docs/superpowers/specs/2026-09-16-frame-numbering-design.md`
이 문서가 아래 세 곳을 **대체**한다(번호 순서 규칙과 표 칸 매핑 7.2는 그대로다):
- `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` §3.1 — "도면 한 장 안에서 1부터"
- `docs/superpowers/specs/2026-09-15-dxf-export-design.md` 7.3 — "가장 가까운 표 하나"
- `docs/superpowers/specs/2026-09-15-dxf-export-design.md` 7.4 — "넘침 표를 오른쪽에"

그대로 유효해 이 계획이 따르는 앞선 설계:
- `docs/superpowers/specs/2026-09-16-label-layout-design.md` — 라벨 모양·겹침 방지·화살표. **번호가 없으면 원 없이 글자만 그린다**는 규칙이 이미 있어, 틀 밖 손상의 라벨은 따로 손댈 것이 없다.
- `docs/superpowers/specs/2026-09-15-dxf-export-design.md` 4장·7.1·7.2 — DXF 읽기·쓰기, 표 격자 읽기, 열 매핑

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
- 작업 브랜치는 `feat/frame-numbering`이다(이미 체크아웃돼 있다).
- `docs/DXF산출-테스트-결과.md`는 **Task 7이 지시하는 자리 말고는 건드리지 않는다.**

### 코드 규약 (기존 코드에서 그대로 이어받는다)

- TypeScript는 NodeNext다 — **상대 경로 import에 `.js` 확장자를 붙인다**(`./tableGrid.js`). 빼먹으면 `npm --prefix server run typecheck`가 바로 잡아낸다.
- 뷰어 JS(`server/public/viewer/*.js`)는 브라우저가 그대로 읽는 순수 ES 모듈이고, 서버 TS는 이를 `../../public/viewer/*.js`로 가져다 쓴다. `checkJs`는 꺼져 있지만 **TS가 소비하는 JS 내보내기에는 JSDoc `@type`/`@typedef`를 단다**(기존 `overlay.js`와 같은 방식). 타입 없이 두면 호출부에서 조용히 `any`가 된다.
- 숫자·문구를 코드에 박아 두지 않는다. 표의 열 너비·행 높이·글자 높이는 원본 DXF에서 그때그때 읽는다(2026-09-15 설계 7.1).

### 틀 인식 (스펙 2장)

- 틀 = 모델 공간(`ENTITIES`)의 **최상위 `INSERT`** 중, 그 블록 안(중첩 `INSERT` 포함, **깊이 4까지** — `findTableCandidates`와 같은 규칙)에 `ACAD_TABLE`이 하나라도 있는 것.
- 틀의 영역 = 블록 안 도형의 점들을 삽입 변환(위치·배율·회전)으로 옮긴 뒤 감싼 **축 정렬 경계상자**. 점을 뽑는 도형: `LINE`(10/20, 11/21), `LWPOLYLINE`(10/20 반복), `CIRCLE`·`ARC`(중심 ± 반지름), `TEXT`·`MTEXT`(10/20), `ACAD_TABLE`(삽입점과 열 너비 합·행 높이 합으로 만든 **네 모서리**), 중첩 `INSERT`(재귀). **`HATCH`는 뺀다.**
- 틀 안의 표 = 그 `INSERT`를 따라 내려가며 **처음 만난** `ACAD_TABLE`의 후보(`TableCandidate`, 절대 좌표 변환 포함). 둘 이상이면 처음 것만 쓴다.
- 틀 순서 = 경계상자 `minX` 오름차순, 같으면 `maxY` 내림차순. 이 순서가 `index`(0부터)다.

### 틀 정보 전달 (스펙 3장)

- `DrawingRecord`에 `frames?: FrameBounds[]`. **표는 넣지 않는다** — 앱은 영역만 쓴다.
- DXF 업로드: 계산해 넣는다. 파싱 실패 → `frames: []` + `console.error`만 남기고 **업로드는 계속된다**.
- DWG 업로드: `frames: []`.
- `frames` 필드가 없는 옛 레코드: `GET /api/drawings`가 목록을 돌려주기 전에 한 번 계산해 저장한다. 원본이 없거나 DWG면 `[]`로 저장해 **다시 시도하지 않는다.**

### 배정과 번호 (스펙 4·5장)

- **틀 배정은 `geometry.dwg`만 본다.** 손상의 `geometry.dwg` 경계상자 **중심**이 틀 경계상자 안(**경계 포함**)이면 그 틀. 여러 틀에 들어가면 **인덱스가 작은 틀**. `geometry.dwg`가 없거나 어느 틀에도 없으면 `null`. world 좌표는 쓰지 않는다(페이지→모델 변환의 회전·반전 때문 — 2026-09-16 label-layout 설계 4.5와 같은 이유).
- **틀 안에서의 번호 순서는 지금 그대로다**: `geometry.world` 중심 X 오름차순 → 같으면 Y 내림차순 → 같으면 `id` 오름차순.
- `frames`가 **빈 배열이면 결과가 지금과 완전히 같다** — 전체를 한 묶음으로 1부터, `dwg`가 없는 손상도 번호를 받는다. 기존 테스트는 **어떤 Task가 명시적으로 고치고 이유를 적지 않는 한 그대로 통과해야 한다.**
- 번호는 저장하지 않는다(변함없음). 틀 밖 손상은 Map에 넣지 않는다 → 소비자는 `numbers.get(id) ?? null`로 "번호 없음"을 받는다.

### 산출 (스펙 6장)

- 번호용 `frames`는 **원본에서 `findFrames`로 다시 구한다** — 레코드의 값을 믿지 않는다(원본이 곧 진실이다).
- 틀마다 자기 표에 그 틀 손상만 1번부터 최댓값까지 채운다. 손상이 없는 틀의 표는 **건드리지 않는다.**
- 틀 밖 손상: 도형은 그리고 라벨은 번호 원 없이 그린다. 어느 표에도 넣지 않고 경고 `망도틀 밖 손상 N개는 번호 없이 그려지고 물량표에서 빠집니다`(`EXPORT_WARNINGS.outsideFrames(n)`).
- 틀이 하나도 없는 도면: 지금 규칙 그대로(전체 한 묶음 번호, `nearestTable` 하나, 표가 없으면 `noTable`).
- 표 배율 검사(`hasUniformScale`)는 틀마다 한다. 하나라도 어긋나면 지금처럼 `ExportError`.
- **넘침 표는 원본 표 바로 아래**: 위쪽 끝은 원본 표 아래쪽 끝에서 원본 **첫 행(머리글 행) 높이**만큼 띄운 곳, 왼쪽 끝은 원본과 같다. 열 너비·행 높이·머리글·`LINE`+`TEXT` 방식·이어지는 번호는 그대로. 틀 밖으로 나가도 된다(사용자 확인).

### 바뀌지 않는 것 (스펙 7장)

- 번호 **순서** 규칙(왼쪽 우선), 손상현황·치수 문구, 라벨 모양·겹침 방지·화살표(겹침 장애물은 **틀과 무관하게 도면 전체 손상**)
  - `labelCollision.js`의 `placeLabels`는 **손대지 않는다.** 번호 오름차순(번호 없으면 맨 뒤)으로 자리를 잡고 같은 번호는 `id` 오름차순으로 가른다 — 틀마다 1번이 생겨 번호가 겹쳐도 화면과 DXF가 같은 입력(같은 id·번호)을 주므로 답이 갈리지 않는다. 번호가 없는 손상은 이미 맨 뒤로 밀려 원 없이 그려진다.
- 표 칸 매핑(2026-09-15 7.2), 손상 도형·해치·기호 출력, 저장 형식(`schemaVersion` 4)
- DWG 업로드는 화면 표기만 되고 산출은 안 된다

### 검증 명령

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/viewer/quantities.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/main.js
```

---

## File Structure

```
server/src/export/frames.ts            생성: 망도틀 인식. findFrames(doc) → 영역 AABB + 틀 안의 표
server/src/export/tableGrid.ts         수정: INSERT 보행기를 공용으로 빼고(readModelSpace·walkInserts)
                                             내부 도우미(RawEntity·numberAt·textAt·numbersAt·
                                             insertTransform·tableCandidateOf)를 내보낸다
server/public/viewer/quantities.js     수정: frameIndexOf·countOutsideFrames 추가,
                                             computeNumbers(damages, frames = [])
server/src/drawingsStore.ts            수정: DrawingRecord.frames?, DrawingPatch에 frames
server/src/app.ts                      수정: 업로드 때 계산, GET /drawings에서 옛 레코드 지연 계산·저장
server/public/viewer/overlay.js        수정: setFrames·번호 재계산·outsideFrameCount
server/public/viewer/main.js           수정: 레코드의 frames를 오버레이에 넘기고 경고 배지를 갱신
server/public/viewer.html              수정: 저장 배지 옆 경고 배지 요소
server/public/viewer/viewer.css        수정: 경고 배지 색
server/src/export/tableFill.ts         수정: 넘침 표를 오른쪽이 아니라 아래에
server/src/export/exportDrawing.ts     수정: 틀별 번호·틀별 표 채우기·틀 밖 경고

server/test/fixtureDocs.ts             생성: 픽스처 변형 도우미(틀 2개·회전·중첩·표 최상위)
server/test/frames.test.ts             생성: findFrames
server/test/tableGrid.test.ts          수정: readModelSpace·walkInserts
server/test/quantities.test.ts         수정: frameIndexOf·frames 있는 computeNumbers·countOutsideFrames
server/test/app.test.ts                수정: 업로드·목록의 frames
server/test/overlay.test.ts            수정: 번호 없는 손상의 라벨(원만 빠진다)
server/test/tableFill.test.ts          수정: 넘침 표가 아래
server/test/exportDrawing.test.ts      수정: 틀별 표·틀 밖 경고·틀 없는 도면

README.md                                                       수정: 산출 설명과 경고 표
docs/DXF산출-테스트-결과.md                                      수정: 확인표 18행 문구 + 33~36행 추가
docs/superpowers/specs/2026-09-13-damage-attributes-design.md    수정: §3.1에 대체 안내 한 줄
docs/superpowers/specs/2026-09-15-dxf-export-design.md           수정: 7.3·7.4에 대체 안내 한 줄
```

책임 한 줄 요약:

- `frames.ts` — **도면에서 틀이 어디인가.** DXF만 알고 손상은 모른다.
- `quantities.js` — **이 손상이 어느 틀이고 몇 번인가.** DXF도 DOM도 모른다. 화면과 서버가 같이 쓴다.
- `app.ts` — 틀 영역을 레코드에 실어 앱까지 보낸다.
- `overlay.js` / `main.js` — 받은 영역으로 화면 번호와 경고 배지를 낸다.
- `exportDrawing.ts` — 산출할 때 원본에서 틀을 다시 구해 번호와 표를 틀 단위로 돌린다.
- `tableFill.ts` — 표 한 장을 채운다. 틀은 모른다(넘치면 아래로 쌓을 뿐이다).

### Task를 7개로 나눈 이유 (요청한 6단계와 다른 점)

요청받은 5번 항목("산출")에 들어 있던 **넘침 표를 아래로 옮기는 변경을 Task 5로 떼어 냈다.** `tableFill.ts`는 틀을 전혀 모르는 파일이고 그 변경은 `fillTable` 한 함수와 `tableFill.test.ts`만 건드린다 — 리뷰어가 "틀별 표 채우기"는 되돌리면서 "넘침 표 아래"는 승인할 수 있는, 독립적으로 테스트되는 변경이다. 나머지 경계는 요청과 같다.

---

## Task 1: 망도틀을 알아본다 (`findFrames`) + INSERT 보행기 공용화

`findTableCandidates`가 이미 "모델 공간의 INSERT를 따라 내려가며 블록 안을 훑는" 코드를 갖고 있다. 틀 인식도 같은 보행이 필요하므로 **두 벌로 베끼지 않고** 그 보행을 `tableGrid.ts`에서 공용 함수로 빼낸 뒤 양쪽이 쓴다. 보행기 자체는 동작이 그대로라 기존 테스트가 전부 통과해야 한다.

**Files:**
- Modify: `server/src/export/tableGrid.ts:138-252`
- Create: `server/src/export/frames.ts`
- Create: `server/test/fixtureDocs.ts`
- Create: `server/test/frames.test.ts`
- Modify: `server/test/tableGrid.test.ts:1-25, 83-110`

**Interfaces:**
- Consumes: 기존 `tableGrid.ts`의 `Transform`, `IDENTITY`, `applyTransform(t, point)`, `composeTransform(outer, inner)`, `TableCandidate`, `findSection(doc, name)`, `parseDxf(text)`, `DxfDocument`, `Point`(= `[number, number]`)
- Produces:
  - `tableGrid.ts`에서 새로 내보내는 것:
    - `interface RawEntity { type: string; values: Map<number, string[]> }`
    - `function numberAt(entity: RawEntity, code: number, fallback: number): number`
    - `function textAt(entity: RawEntity, code: number): string | null`
    - `function numbersAt(entity: RawEntity, code: number): number[]`
    - `function insertTransform(entity: RawEntity): Transform`
    - `function tableCandidateOf(entity: RawEntity, transform: Transform): TableCandidate | null`
    - `interface ModelSpace { entities: RawEntity[]; blocks: Map<string, RawEntity[]> }`
    - `function readModelSpace(doc: DxfDocument): ModelSpace | null`
    - `function walkInserts(model: ModelSpace, entities: RawEntity[], transform: Transform, depth: number, seen: ReadonlySet<string>, visit: (entity: RawEntity, transform: Transform) => void): void`
  - `frames.ts`:
    - `interface FrameBounds { minX: number; minY: number; maxX: number; maxY: number }`
    - `interface Frame { index: number; bounds: FrameBounds; table: TableCandidate }`
    - `function findFrames(doc: DxfDocument): Frame[]`
  - `test/fixtureDocs.ts`:
    - `function templateText(): Promise<string>`
    - `function withSecondFrame(text: string, insertX: number): string`
    - `function rotatedFrame(text: string, degrees: number): string`
    - `function withoutTable(text: string): string`
    - `function flatTable(text: string): string`
    - `function withFrameLine(text: string): string`
    - `function withNestedInsert(text: string): string`

- [ ] **Step 1: 픽스처 변형 도우미를 만든다**

틀 2개짜리·회전한 틀·표가 최상위에 있는 도면을 **테스트 안에서** 만든다. 픽스처 파일(`server/test/fixtures/mangdo-template.dxf`)은 **고치지 않는다** — 그 파일의 값(틀 1개, 8열, 데이터 3행)에 기대고 있는 기존 테스트가 여럿이고, 틀을 하나 더 넣으면 `findTableCandidates`·`nearestTable`·산출 테스트가 한꺼번에 흔들린다. 기존 `tableGrid.test.ts`가 이미 같은 방식(INSERT 블록을 복사해 x만 바꾸기)으로 두 개짜리 도면을 만들고 있으므로 그 기법을 한 곳에 모은다.

`server/test/fixtureDocs.ts`를 새로 만든다(vitest의 `include`는 `test/**/*.test.ts`라 이 파일은 테스트로 수집되지 않는다):

```ts
// 테스트용 픽스처 변형. server/test/fixtures/mangdo-template.dxf 한 장을 글자 치환으로
// 여러 모양(틀 2개, 회전한 틀, 표가 최상위에 있는 도면 …)으로 바꿔 준다.
// 픽스처 파일 자체는 고치지 않는다 — 그 값에 기대는 기존 테스트가 여럿이다.
// 치환 대상이 실제로 있는지 매번 확인한다. 픽스처가 바뀌면 조용히 지나가지 않고 던진다.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

export async function templateText(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`픽스처에서 찾지 못했습니다: ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

/** 모델 공간의 망도틀 INSERT 한 벌 (ENTITIES의 첫 엔티티) */
function insertBlockOf(text: string): string {
  const start = text.indexOf('  0\nINSERT\n');
  const end = text.indexOf('  0\nLINE\n  5\n81\n');
  if (start < 0 || end < start) throw new Error('픽스처의 망도틀 INSERT를 찾지 못했습니다');
  return text.slice(start, end);
}

/** 같은 망도틀을 x = insertX에 한 벌 더 삽입한다(틀 2개짜리 도면). */
export function withSecondFrame(text: string, insertX: number): string {
  const insert = insertBlockOf(text);
  // INSERT 블록 안에서 처음 나오는 '1000.0'이 코드 10(삽입점 x)이다.
  const second = replaceOnce(insert, '\n1000.0\n', `\n${insertX.toFixed(1)}\n`);
  return replaceOnce(text, insert, insert + second);
}

/** 망도틀 INSERT를 도(度) 단위로 회전시킨다(코드 50). */
export function rotatedFrame(text: string, degrees: number): string {
  return replaceOnce(text, ' 43\n2.0\n 50\n0.0\n', ` 43\n2.0\n 50\n${degrees.toFixed(1)}\n`);
}

/** 망도틀 안의 ACAD_TABLE을 POINT로 바꿔 "표가 없는 블록"을 만든다. */
export function withoutTable(text: string): string {
  return replaceOnce(text, '  0\nACAD_TABLE\n', '  0\nPOINT\n');
}

/**
 * ACAD_TABLE을 망도틀 블록 밖(ENTITIES 맨 앞)으로 옮긴다 — 틀이 0개이고 표는 하나인 옛 도면.
 * 소유자(330)는 여전히 망도틀 블록 레코드를 가리키지만 읽는 쪽(readEntities)은 보지 않는다.
 */
export function flatTable(text: string): string {
  const start = text.indexOf('  0\nACAD_TABLE\n');
  const end = text.indexOf('  0\nENDBLK\n  5\n52\n');
  if (start < 0 || end < start) throw new Error('픽스처의 ACAD_TABLE을 찾지 못했습니다');
  const table = text.slice(start, end);
  const without = text.slice(0, start) + text.slice(end);
  const marker = '  0\nSECTION\n  2\nENTITIES\n';
  const at = without.indexOf(marker) + marker.length;
  return without.slice(0, at) + table + without.slice(at);
}

// 망도틀 블록 안에 넣을 LINE 하나. 블록 좌표 (0,0)-(2000,2000).
const FRAME_LINE = [
  '  0', 'LINE', '  5', '53', '330', '30', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
  ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 11', '2000.0', ' 21', '2000.0', ' 31', '0.0', '',
].join('\n');

/** 망도틀 블록 안에 LINE을 하나 넣는다(틀 영역이 표보다 넓어지는 경우). */
export function withFrameLine(text: string): string {
  return replaceOnce(text, '  0\nENDBLK\n  5\n52\n', FRAME_LINE + '  0\nENDBLK\n  5\n52\n');
}

// 망도틀 블록 안에 넣을 중첩 INSERT. 표 모양 블록(*TX)을 블록 좌표 (0, 5000)에 배율 1로.
const NESTED_INSERT = [
  '  0', 'INSERT', '  5', '54', '330', '30', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockReference',
  '  2', '*TX', ' 10', '0.0', ' 20', '5000.0', ' 30', '0.0', ' 41', '1.0', ' 42', '1.0', ' 43', '1.0',
  ' 50', '0.0', '',
].join('\n');

/** 망도틀 블록 안에 블록(*TX)을 한 번 더 삽입한다 — 중첩 INSERT 재귀 확인용. */
export function withNestedInsert(text: string): string {
  return replaceOnce(text, '  0\nENDBLK\n  5\n52\n', NESTED_INSERT + '  0\nENDBLK\n  5\n52\n');
}
```

- [ ] **Step 2: 실패하는 `findFrames` 테스트를 쓴다**

`server/test/frames.test.ts`를 새로 만든다. 좌표는 전부 손으로 계산했고 계산 과정을 주석에 남긴다.

```ts
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import {
  flatTable,
  rotatedFrame,
  templateText,
  withFrameLine,
  withNestedInsert,
  withoutTable,
  withSecondFrame,
} from './fixtureDocs.js';

// 픽스처 실측값:
//   망도틀 블록 안에는 ACAD_TABLE 하나뿐. 삽입점(블록 좌표) (500, 700),
//   열 너비 합 100+150+300+120+120+100+140+110 = 1140, 행 높이 합 40+20+20+20+20 = 120
//   → 블록 좌표 네 모서리: (500,580) (1640,580) (1640,700) (500,700)
//   망도틀 INSERT: 삽입점 (1000, 2000), 배율 2, 회전 0
//   → 모델 좌표: x 1000+2*500=2000 ~ 1000+2*1640=4280, y 2000+2*580=3160 ~ 2000+2*700=3400
const FRAME_0 = { minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 };

async function framesOf(text: string) {
  return findFrames(parseDxf(text));
}

describe('findFrames', () => {
  it('표가 든 최상위 INSERT를 틀로 보고 영역과 표를 함께 돌려준다', async () => {
    const frames = await framesOf(await templateText());
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(0);
    expect(frames[0].bounds).toEqual(FRAME_0);
    expect(frames[0].table.blockName).toBe('*TX');
    expect(frames[0].table.position).toEqual([500, 700]);
    expect(frames[0].table.transform).toMatchObject({ x: 1000, y: 2000, scaleX: 2, scaleY: 2 });
  });

  it('틀이 여러 개면 왼쪽(minX가 작은) 틀이 0번이다 — 도면에 적힌 순서가 아니다', async () => {
    // 두 번째 망도틀을 원본보다 왼쪽(x = -9000)에 삽입한다.
    // → 영역 x -9000+1000 = -8000 ~ -9000+3280 = -5720, y는 원본과 같다.
    const frames = await framesOf(withSecondFrame(await templateText(), -9000));
    expect(frames.map((frame) => frame.index)).toEqual([0, 1]);
    expect(frames[0].bounds).toEqual({ minX: -8000, minY: 3160, maxX: -5720, maxY: 3400 });
    expect(frames[1].bounds).toEqual(FRAME_0);
    // 틀마다 자기 표를 들고 있다(표의 절대 변환이 서로 다르다).
    expect(frames[0].table.transform.x).toBe(-9000);
    expect(frames[1].table.transform.x).toBe(1000);
  });

  it('표가 없는 블록은 틀이 아니다', async () => {
    expect(await framesOf(withoutTable(await templateText()))).toEqual([]);
  });

  it('표가 최상위에 그냥 놓인 도면은 틀이 0개다', async () => {
    expect(await framesOf(flatTable(await templateText()))).toEqual([]);
  });

  it('블록 안의 다른 도형까지 감싼다 — 표보다 넓은 틀', async () => {
    // 블록 좌표 (0,0)-(2000,2000) LINE을 더하면 블록 좌표 AABB가 x 0~2000, y 0~2000이 된다.
    // → 모델 좌표 x 1000+0=1000 ~ 1000+4000=5000, y 2000+0=2000 ~ 2000+4000=6000
    const frames = await framesOf(withFrameLine(await templateText()));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds).toEqual({ minX: 1000, minY: 2000, maxX: 5000, maxY: 6000 });
  });

  it('중첩 INSERT 안의 도형도 변환을 겹쳐 감싼다', async () => {
    // *TX 블록의 도형은 블록 좌표 x 0~1140, y -120~0이다(격자 LINE 6개의 범위).
    // 이를 (0, 5000)에 배율 1로 삽입 → 망도틀 좌표 x 0~1140, y 4880~5000.
    // 표(500~1640, 580~700)와 합치면 x 0~1640, y 580~5000
    // → 모델 좌표 x 1000~4280, y 3160~12000
    const frames = await framesOf(withNestedInsert(await templateText()));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds).toEqual({ minX: 1000, minY: 3160, maxX: 4280, maxY: 12000 });
  });

  it('회전한 삽입은 회전한 네 모서리를 감싼 축 정렬 상자다', async () => {
    // 90도 회전, 배율 2, 삽입점 (1000, 2000). 각 모서리 (x,y) → (1000 - 2y, 2000 + 2x)
    //   (500,700)  → (1000-1400, 2000+1000) = (-400, 3000)
    //   (1640,700) → (1000-1400, 2000+3280) = (-400, 5280)
    //   (1640,580) → (1000-1160, 2000+3280) = (-160, 5280)
    //   (500,580)  → (1000-1160, 2000+1000) = (-160, 3000)
    // → AABB x -400 ~ -160, y 3000 ~ 5280. 대각 두 점만 봤다면 이 답이 나오지 않는다.
    const frames = await framesOf(rotatedFrame(await templateText(), 90));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds.minX).toBeCloseTo(-400, 6);
    expect(frames[0].bounds.maxX).toBeCloseTo(-160, 6);
    expect(frames[0].bounds.minY).toBeCloseTo(3000, 6);
    expect(frames[0].bounds.maxY).toBeCloseTo(5280, 6);
  });

  it('ENTITIES 구역이 없으면 빈 배열', () => {
    expect(findFrames(parseDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n'))).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- frames`
Expected: FAIL — `Failed to resolve import "../src/export/frames.js"`

- [ ] **Step 4: `tableGrid.ts`에서 보행기를 공용으로 뺀다**

`server/src/export/tableGrid.ts`의 138행 `interface RawEntity`에 `export`를 붙이고, 그 아래 도우미 네 개도 내보낸다. 아래 네 군데를 **그대로 치환**한다(본문은 바뀌지 않는다 — `export` 한 단어만 붙는다):

```ts
export interface RawEntity {
  type: string;
  values: Map<number, string[]>;
}

export function numberAt(entity: RawEntity, code: number, fallback: number): number {
```

```ts
export function textAt(entity: RawEntity, code: number): string | null {
```

```ts
export function numbersAt(entity: RawEntity, code: number): number[] {
```

```ts
export function insertTransform(entity: RawEntity): Transform {
```

`tableOf`는 이름이 모호하니 내보내면서 이름을 바꾼다(호출부는 Step 5에서 함께 바뀐다). 211행을 치환:

```ts
export function tableCandidateOf(entity: RawEntity, transform: Transform): TableCandidate | null {
```

- [ ] **Step 5: `readModelSpace`·`walkInserts`를 만들고 `findTableCandidates`를 그 위에 다시 쓴다**

226~252행(`// 모델 공간의 INSERT를 따라 내려가며 …` 주석부터 `findTableCandidates`의 닫는 `}`까지)을 **아래로 통째로 교체**한다:

```ts
/** 모델 공간 최상위 엔티티와 블록 목차. 한 번 읽어 두고 여러 번 훑는다. */
export interface ModelSpace {
  entities: RawEntity[];
  blocks: Map<string, RawEntity[]>;
}

export function readModelSpace(doc: DxfDocument): ModelSpace | null {
  const section = findSection(doc, 'ENTITIES');
  if (!section) return null;
  return {
    entities: readEntities(doc.pairs, section.start, section.end),
    blocks: new Map(readBlocks(doc).map((b) => [b.name, b.entities])),
  };
}

/**
 * entities를 훑으며 엔티티마다 절대 변환과 함께 visit을 부른다. INSERT를 만나면 그 블록 안으로
 * 내려간다 — visit은 INSERT 자체도 본다(내려가는 일은 이 함수가 맡는다).
 *
 * depth는 이미 내려온 INSERT 수(최상위에서 시작하면 0), seen은 지나온 블록 이름이다(자기 자신을
 * 삽입한 블록에서 무한히 도는 것을 막는다). 어느 곳에도 삽입되지 않은 블록은 훑지 않는다 —
 * 도면에 보이지 않기 때문이다.
 */
export function walkInserts(
  model: ModelSpace,
  entities: RawEntity[],
  transform: Transform,
  depth: number,
  seen: ReadonlySet<string>,
  visit: (entity: RawEntity, transform: Transform) => void,
): void {
  for (const entity of entities) {
    visit(entity, transform);
    if (entity.type !== 'INSERT' || depth >= MAX_INSERT_DEPTH) continue;
    const name = textAt(entity, 2);
    if (!name || seen.has(name)) continue;
    const contents = model.blocks.get(name);
    if (!contents) continue;
    walkInserts(
      model,
      contents,
      composeTransform(transform, insertTransform(entity)),
      depth + 1,
      new Set([...seen, name]),
      visit,
    );
  }
}

// 모델 공간의 INSERT를 따라 내려가며 블록 안의 ACAD_TABLE을 절대 좌표로 옮긴다.
// 어느 곳에도 삽입되지 않은 블록 안의 표는 도면에 보이지 않으므로 후보가 아니다.
export function findTableCandidates(doc: DxfDocument): TableCandidate[] {
  const model = readModelSpace(doc);
  if (!model) return [];
  const candidates: TableCandidate[] = [];
  walkInserts(model, model.entities, IDENTITY, 0, new Set(), (entity, transform) => {
    if (entity.type !== 'ACAD_TABLE') return;
    const table = tableCandidateOf(entity, transform);
    if (table) candidates.push(table);
  });
  return candidates;
}
```

- [ ] **Step 6: `frames.ts`를 만든다**

`server/src/export/frames.ts`:

```ts
// 망도틀(= 안에 손상물량표가 든 삽입 블록)을 찾아 영역과 그 안의 표를 돌려준다.
// 블록 이름으로 찾지 않는다 — 다른 현장 도면에서도 동작해야 한다(설계 1장 사용자 결정).
// 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 2장

import type { DxfDocument } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import {
  applyTransform,
  insertTransform,
  numberAt,
  numbersAt,
  readModelSpace,
  tableCandidateOf,
  textAt,
  walkInserts,
  type RawEntity,
  type TableCandidate,
} from './tableGrid.js';

/** 틀의 영역(mm, 모델 좌표). 앱까지 이 모양 그대로 간다(DrawingRecord.frames) */
export interface FrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Frame {
  /** 왼쪽부터 0. 화면·산출이 손상을 배정할 때 쓰는 번호다 */
  index: number;
  bounds: FrameBounds;
  /** 이 틀 안에서 처음 만난 표 */
  table: TableCandidate;
}

// 축 정렬 상자의 네 모서리. 회전한 삽입에서는 대각 두 점만으로 영역이 좁아진다.
function corners(minX: number, minY: number, maxX: number, maxY: number): Point[] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

// 경계상자를 만들 때 쓰는 점(블록 좌표). HATCH는 뺀다 — 경계가 복잡하고 늘 다른 도형과
// 겹치므로 영역을 넓히는 데 보탬이 되지 않는다(설계 2장). INSERT는 walkInserts가 안으로
// 내려가 주므로 여기서는 점을 내지 않는다.
function entityPoints(entity: RawEntity): Point[] {
  switch (entity.type) {
    case 'LINE':
      return [
        [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        [numberAt(entity, 11, 0), numberAt(entity, 21, 0)],
      ];
    case 'LWPOLYLINE': {
      const xs = numbersAt(entity, 10);
      const ys = numbersAt(entity, 20);
      const points: Point[] = [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) points.push([xs[i], ys[i]]);
      return points;
    }
    case 'CIRCLE':
    case 'ARC': {
      // 호도 원 전체로 넉넉히 잡는다 — 영역이 조금 넓은 것은 괜찮지만 좁으면 손상을 놓친다.
      const x = numberAt(entity, 10, 0);
      const y = numberAt(entity, 20, 0);
      const r = Math.abs(numberAt(entity, 40, 0));
      return corners(x - r, y - r, x + r, y + r);
    }
    case 'TEXT':
    case 'MTEXT':
      return [[numberAt(entity, 10, 0), numberAt(entity, 20, 0)]];
    case 'ACAD_TABLE': {
      // 표는 삽입점에서 오른쪽·아래로 자란다(열 너비 합 × 행 높이 합).
      const x = numberAt(entity, 10, 0);
      const y = numberAt(entity, 20, 0);
      const width = numbersAt(entity, 142).reduce((sum, w) => sum + w, 0);
      const height = numbersAt(entity, 141).reduce((sum, h) => sum + h, 0);
      return corners(x, y - height, x + width, y);
    }
    default:
      return [];
  }
}

export function findFrames(doc: DxfDocument): Frame[] {
  const model = readModelSpace(doc);
  if (!model) return [];

  const found: Array<{ bounds: FrameBounds; table: TableCandidate }> = [];
  for (const entity of model.entities) {
    if (entity.type !== 'INSERT') continue;
    const name = textAt(entity, 2);
    if (!name) continue;
    const contents = model.blocks.get(name);
    if (!contents) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    // 표는 배열에 담는다 — let 변수에 콜백 안에서 대입하면 TypeScript의 흐름 분석이 그 대입을
    // 보지 못해 호출 뒤에도 타입이 null로 남는다.
    const tables: TableCandidate[] = [];

    // 최상위 INSERT는 이미 한 단계 내려온 것이므로 depth 1, seen에 자기 블록 이름을 넣고 시작한다.
    walkInserts(model, contents, insertTransform(entity), 1, new Set([name]), (child, transform) => {
      if (child.type === 'ACAD_TABLE' && tables.length === 0) {
        const candidate = tableCandidateOf(child, transform);
        if (candidate) tables.push(candidate);
      }
      for (const point of entityPoints(child)) {
        const [x, y] = applyTransform(transform, point);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    });

    if (tables.length === 0) continue;
    found.push({ bounds: { minX, minY, maxX, maxY }, table: tables[0] });
  }

  // 왼쪽 → 오른쪽, 같으면 위 → 아래. 이 순서가 인덱스다(설계 2장).
  found.sort((a, b) => a.bounds.minX - b.bounds.minX || b.bounds.maxY - a.bounds.maxY);
  return found.map((frame, index) => ({ index, bounds: frame.bounds, table: frame.table }));
}
```

- [ ] **Step 7: 테스트를 돌려 통과를 확인한다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — `frames.test.ts` 8개가 통과하고, `tableGrid.test.ts`·`tableFill.test.ts`·`exportDrawing.test.ts`를 포함한 **기존 테스트가 하나도 깨지지 않는다**(보행기 교체는 동작이 같다).

- [ ] **Step 8: 공용 보행기 자체의 테스트를 더한다**

`server/test/tableGrid.test.ts`의 import 블록(6~19행)에 `readModelSpace`, `walkInserts`를 더한다:

```ts
import {
  applyTransform,
  buildGrid,
  cellCenter,
  composeTransform,
  findTableCandidates,
  hasUniformScale,
  IDENTITY,
  modelTextHeight,
  mtextPlainText,
  nearestTable,
  readModelSpace,
  tableCenter,
  walkInserts,
  type Transform,
} from '../src/export/tableGrid.js';
```

`describe('findTableCandidates', …)` 블록(83행) **바로 앞에** 아래를 넣는다:

```ts
describe('readModelSpace / walkInserts', () => {
  it('모델 공간 엔티티와 블록 목차를 읽는다', async () => {
    const model = readModelSpace(await templateDoc())!;
    expect(model.entities.map((e) => e.type)).toEqual(['INSERT', 'LINE']);
    expect([...model.blocks.keys()]).toEqual(['*Model_Space', '망도틀', '*TX']);
  });

  it('ENTITIES 구역이 없으면 null', () => {
    expect(readModelSpace(parseDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n'))).toBeNull();
  });

  it('INSERT 안으로 내려가며 절대 변환을 겹쳐 준다 (INSERT 자체도 visit이 본다)', async () => {
    const model = readModelSpace(await templateDoc())!;
    const seen: Array<{ type: string; x: number }> = [];
    walkInserts(model, model.entities, IDENTITY, 0, new Set(), (entity, transform) => {
      seen.push({ type: entity.type, x: transform.x });
    });
    // 최상위 INSERT(변환 없음) → 그 안의 ACAD_TABLE(삽입점 1000) → 최상위 LINE(변환 없음)
    expect(seen).toEqual([
      { type: 'INSERT', x: 0 },
      { type: 'ACAD_TABLE', x: 1000 },
      { type: 'LINE', x: 0 },
    ]);
  });

  it('seen에 든 블록으로는 내려가지 않는다 (순환 방지)', async () => {
    const model = readModelSpace(await templateDoc())!;
    const types: string[] = [];
    walkInserts(model, model.entities, IDENTITY, 0, new Set(['망도틀']), (entity) => types.push(entity.type));
    expect(types).toEqual(['INSERT', 'LINE']);
  });
});
```

- [ ] **Step 9: 테스트를 돌린다**

Run: `npm --prefix server test -- tableGrid frames`
Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add server/src/export/tableGrid.ts server/src/export/frames.ts server/test/fixtureDocs.ts server/test/frames.test.ts server/test/tableGrid.test.ts
git commit -m "$(cat <<'EOF'
feat: 망도틀 인식(findFrames) 추가와 INSERT 보행기 공용화

블록 이름이 아니라 "안에 ACAD_TABLE이 든 최상위 INSERT"로 틀을 알아본다.
틀 영역은 블록 안 도형(LINE·LWPOLYLINE·CIRCLE·ARC·TEXT·MTEXT·ACAD_TABLE·중첩
INSERT)의 점을 삽입 변환으로 옮긴 뒤 감싼 축 정렬 상자이고, 순서는 minX 오름차순
(같으면 maxY 내림차순)이다.

findTableCandidates가 갖고 있던 INSERT 보행을 readModelSpace·walkInserts로 빼
frames.ts와 나눠 쓴다 — 보행 동작은 그대로다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 빈도면을 넣으면 틀 목록이 나온다. 아직 아무도 쓰지 않는다.

---

## Task 2: 손상을 틀에 배정하고 틀마다 1번부터 매긴다

화면과 서버가 같이 쓰는 순수 모듈이라 **여기 한 곳만 고치면 양쪽이 같이 바뀐다.** `frames`를 넘기지 않으면 결과가 지금과 완전히 같아야 한다 — 기존 `computeNumbers` 테스트가 한 줄도 바뀌지 않고 통과하는 것이 이 Task의 합격 조건이다.

**Files:**
- Modify: `server/public/viewer/quantities.js:22, 63-77`
- Modify: `server/test/quantities.test.ts:1-64, 66-138`

**Interfaces:**
- Consumes: `server/public/viewer/geometry.js`의 `boundsOf(points): { minX, minY, maxX, maxY } | null`
- Produces (전부 `server/public/viewer/quantities.js`에서):
  - `@typedef {{ minX: number, minY: number, maxX: number, maxY: number }} FrameBounds` — `server/src/export/frames.ts`의 `FrameBounds`와 **구조가 같다**(구조적 타입이라 서로 그대로 쓸 수 있다)
  - `frameIndexOf(damage: any, frames: FrameBounds[]): number | null`
  - `computeNumbers(damages: any[], frames?: FrameBounds[]): Map<string, number>` — 기본값 `[]`
  - `countOutsideFrames(damages: any[], frames: FrameBounds[]): number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/quantities.test.ts`의 import 블록(3~15행)에 세 이름을 더한다:

```ts
import {
  computeNumbers,
  countOutsideFrames,
  CRACK_WIDTH_BREAKS,
  dimensionTextOf,
  drawingNameOf,
  formatQuantity,
  frameIndexOf,
  parsePhotoNumbers,
  photoTextOf,
  quantityOf,
  statusTextOf,
  unitOf,
  widthUnitOf,
} from '../public/viewer/quantities.js';
```

`describe('computeNumbers', …)` 블록(66행) **바로 앞에** 아래를 넣는다:

```ts
// 틀 배정은 geometry.dwg만 본다(설계 4장). world는 번호 순서에만 쓴다.
// 중심이 (x, y)이고 한 변이 h인 사각형의 dwg 좌표.
function withDwg(id: string, worldX: number, dwgX: number | null, dwgY = 50, h = 10) {
  const half = h / 2;
  const world: Pt[] = [
    [worldX - half, -half],
    [worldX + half, -half],
    [worldX + half, half],
    [worldX - half, half],
  ];
  const dwg: Pt[] | null =
    dwgX === null
      ? null
      : [
          [dwgX - half, dwgY - half],
          [dwgX + half, dwgY - half],
          [dwgX + half, dwgY + half],
          [dwgX - half, dwgY + half],
        ];
  return {
    id,
    type: 'spalling',
    geometry: { kind: 'rect', world, dwg },
    measured: { width: null, length: null, count: null },
    attrs: { note: '', statusText: '' },
  };
}

// 왼쪽 틀 0과 오른쪽 틀 1. 붙어 있지 않고 사이에 빈 자리가 있다.
const FRAMES = [
  { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  { minX: 200, minY: 0, maxX: 300, maxY: 100 },
];

describe('frameIndexOf', () => {
  it('dwg 경계상자 중심이 든 틀의 인덱스를 준다', () => {
    expect(frameIndexOf(withDwg('a', 0, 50), FRAMES)).toBe(0);
    expect(frameIndexOf(withDwg('b', 0, 250), FRAMES)).toBe(1);
  });

  it('어느 틀에도 없으면 null', () => {
    expect(frameIndexOf(withDwg('a', 0, 150), FRAMES)).toBeNull();
  });

  it('경계 위(중심이 꼭 모서리)도 안쪽으로 본다', () => {
    // 중심 x = 100, y = 100 → 틀 0의 오른쪽 위 모서리
    expect(frameIndexOf(withDwg('a', 0, 100, 100), FRAMES)).toBe(0);
  });

  it('틀이 겹치면 인덱스가 작은 틀이 이긴다', () => {
    const overlapping = [
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { minX: 40, minY: 0, maxX: 140, maxY: 100 },
    ];
    expect(frameIndexOf(withDwg('a', 0, 50), overlapping)).toBe(0);
  });

  it('dwg가 없으면 null', () => {
    expect(frameIndexOf(withDwg('a', 0, null), FRAMES)).toBeNull();
  });

  it('틀 목록이 비어 있거나 배열이 아니면 null', () => {
    expect(frameIndexOf(withDwg('a', 0, 50), [])).toBeNull();
    expect(frameIndexOf(withDwg('a', 0, 50), undefined as never)).toBeNull();
  });
});

describe('countOutsideFrames', () => {
  it('틀 밖 손상 수를 센다 (dwg 없는 손상도 센다)', () => {
    const damages = [withDwg('a', 0, 50), withDwg('b', 10, 150), withDwg('c', 20, null)];
    expect(countOutsideFrames(damages, FRAMES)).toBe(2);
  });

  it('틀이 없으면 0이다 — 그런 도면은 전체가 한 묶음이라 틀 밖이라는 개념이 없다', () => {
    expect(countOutsideFrames([withDwg('a', 0, null)], [])).toBe(0);
  });
});
```

`describe('computeNumbers', …)` 블록 **안쪽 맨 끝**(138행 `});` 앞)에 아래를 넣는다:

```ts
  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 5장
  describe('망도틀이 있으면 틀마다 1번부터', () => {
    it('틀마다 따로 1번부터 매긴다', () => {
      const damages = [
        withDwg('r1', 100, 210), // 틀 1, world x 100
        withDwg('l1', 0, 10), //    틀 0, world x 0
        withDwg('r2', 300, 290), // 틀 1, world x 300
        withDwg('l2', 200, 90), //  틀 0, world x 200
      ];
      expect(Object.fromEntries(computeNumbers(damages, FRAMES))).toEqual({ l1: 1, l2: 2, r1: 1, r2: 2 });
    });

    it('틀 안 순서는 지금 규칙 그대로다 — world 중심 X 오름차순', () => {
      // dwg에서는 b가 왼쪽이지만 world에서는 a가 왼쪽이다. 번호는 world를 따른다.
      const damages = [withDwg('a', 0, 90), withDwg('b', 500, 10)];
      expect(Object.fromEntries(computeNumbers(damages, FRAMES))).toEqual({ a: 1, b: 2 });
    });

    it('틀 밖 손상은 Map에 없다', () => {
      const numbers = computeNumbers([withDwg('in', 0, 50), withDwg('out', 10, 150)], FRAMES);
      expect(numbers.get('in')).toBe(1);
      expect(numbers.has('out')).toBe(false);
      expect(numbers.get('out') ?? null).toBeNull();
    });

    it('dwg가 없는 손상도 틀 밖이라 번호를 받지 못한다', () => {
      const numbers = computeNumbers([withDwg('a', 0, 50), withDwg('b', 10, null)], FRAMES);
      expect(Object.fromEntries(numbers)).toEqual({ a: 1 });
    });

    it('frames가 빈 배열이면 옛 결과와 같다 — dwg 없는 손상도 번호를 받는다', () => {
      const damages = [withDwg('a', 0, null), withDwg('b', 10, 150)];
      expect(Object.fromEntries(computeNumbers(damages, []))).toEqual({ a: 1, b: 2 });
      expect(Object.fromEntries(computeNumbers(damages))).toEqual({ a: 1, b: 2 });
    });

    it('손상이 없는 틀이 있어도 다른 틀의 번호는 1부터다', () => {
      expect(Object.fromEntries(computeNumbers([withDwg('r', 0, 250)], FRAMES))).toEqual({ r: 1 });
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- quantities`
Expected: FAIL — `frameIndexOf is not a function`

- [ ] **Step 3: `quantities.js`를 고친다**

22행의 import 아래에 `geometry.js` import를 더한다(`geometry.js`는 아무것도 import하지 않으므로 순환이 생기지 않는다):

```js
import { getDamageType } from './damageTypes.js';
import { boundsOf } from './geometry.js';
```

63~77행의 `computeNumbers` 주석과 본문을 아래로 **교체**한다:

```js
/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} FrameBounds
 * 망도틀 영역(mm, 도면 좌표). 서버의 server/src/export/frames.ts가 만드는 것과 같은 모양이고,
 * 도면 레코드(DrawingRecord.frames)에 실려 화면까지 온다.
 */

// 손상이 어느 망도틀에 들어가는지. geometry.dwg 경계상자의 중심이 틀 안(경계 포함)이면 그 틀이다.
// world가 아니라 dwg를 쓴다 — 페이지→모델 변환(coords.js)에 회전·반전이 있으면 world 경계상자가
// 서버가 보는 도면 좌표와 달라져 화면과 산출의 답이 갈린다(설계 4장).
// 여러 틀에 들어가면(틀이 겹치는 도면) 인덱스가 작은 틀이 이긴다.
/** @type {(damage: any, frames: FrameBounds[]) => number | null} */
export function frameIndexOf(damage, frames) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) return null;
  const bounds = boundsOf(damage?.geometry?.dwg);
  if (!bounds) return null;
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  for (let index = 0; index < list.length; index++) {
    const frame = list[index];
    if (!frame) continue;
    if (x >= frame.minX && x <= frame.maxX && y >= frame.minY && y <= frame.maxY) return index;
  }
  return null;
}

// 어느 틀에도 들어가지 않는 손상 수. 틀이 없는 도면은 "틀 밖"이라는 개념이 없어 늘 0이다.
// 화면 경고 배지(overlay.js)와 산출 경고(exportDrawing.ts)가 같이 쓴다.
/** @type {(damages: any[], frames: FrameBounds[]) => number} */
export function countOutsideFrames(damages, frames) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) return 0;
  let count = 0;
  for (const damage of Array.isArray(damages) ? damages : []) {
    if (frameIndexOf(damage, list) === null) count += 1;
  }
  return count;
}

// 도면 위 위치로 번호를 정한다(왼쪽 우선, 2026-09-14 변경). 왼쪽(X가 작은 쪽)이 앞번호,
// X가 같으면 위쪽(Y가 큰 쪽)이 앞, 그것도 같으면 id 오름차순. 사내 망도가 교량 입면도처럼
// 가로로 길어 줄을 나누지 않고 왼쪽부터 훑는 편이 실제 보는 순서와 맞는다(설계 3.1).
// 같은 손상 집합이면 넣은 순서와 상관없이 항상 같은 번호가 나온다.
//
// frames를 주면 **틀마다 1번부터** 다시 매긴다(2026-09-16 설계 5장). 사내 표기가 그렇다 —
// 첫 틀이 15번에서 끝나도 다음 틀은 1번이다. 틀 밖 손상은 Map에 넣지 않는다(번호 없음).
// frames가 비어 있으면 예전과 똑같다 — 전체를 한 묶음으로 1부터, dwg가 없는 손상도 번호를 받는다.
/** @type {(damages: any[], frames?: FrameBounds[]) => Map<string, number>} */
export function computeNumbers(damages, frames = []) {
  const list = Array.isArray(damages) ? damages : [];
  const frameList = Array.isArray(frames) ? frames : [];
  const sorted = list
    // 틀이 없는 도면은 모두 같은 묶음(0)에 넣어 예전 동작을 그대로 낸다.
    .map((damage) => ({
      id: String(damage?.id),
      frame: frameList.length === 0 ? 0 : frameIndexOf(damage, frameList),
      ...centerOf(damage),
    }))
    .filter((entry) => entry.frame !== null)
    .sort((a, b) => a.frame - b.frame || a.x - b.x || b.y - a.y || compareId(a.id, b.id));

  const numbers = new Map();
  let group = sorted.length > 0 ? sorted[0].frame : 0;
  let next = 1;
  for (const entry of sorted) {
    if (entry.frame !== group) {
      group = entry.frame;
      next = 1;
    }
    numbers.set(entry.id, next++);
  }
  return numbers;
}
```

- [ ] **Step 4: 테스트와 문법을 확인한다**

Run: `npm --prefix server test && npm --prefix server run typecheck && node --check server/public/viewer/quantities.js`
Expected: PASS — 새 테스트가 통과하고 **기존 `computeNumbers` 테스트 11개가 한 줄도 바뀌지 않은 채 통과한다.** `exportDrawing.test.ts`도 그대로 통과한다(`exportDrawing.ts`는 아직 인자를 하나만 넘긴다).

- [ ] **Step 5: 커밋**

```bash
git add server/public/viewer/quantities.js server/test/quantities.test.ts
git commit -m "$(cat <<'EOF'
feat: 손상을 망도틀에 배정하고 틀마다 1번부터 번호를 매긴다

frameIndexOf(손상, 틀들)는 geometry.dwg 경계상자의 중심이 든 틀을 준다(경계 포함,
겹치면 작은 인덱스). computeNumbers는 frames를 받으면 틀마다 1번부터 다시 매기고
틀 밖 손상은 Map에 넣지 않는다. frames가 비면 결과가 예전과 완전히 같다.

countOutsideFrames는 화면 경고 배지와 산출 경고가 같이 쓴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 틀 목록만 주면 화면이든 서버든 틀별 번호를 낼 수 있다. 아직 아무도 주지 않는다.

---

## Task 3: 틀 영역을 도면 레코드에 실어 앱까지 보낸다

**Files:**
- Modify: `server/src/drawingsStore.ts:6-17`
- Modify: `server/src/app.ts:1-10, 28-44, 82-135`
- Modify: `server/test/app.test.ts:262-290`(GET 목록 테스트 2개), 새 테스트 추가

**Interfaces:**
- Consumes: `findFrames(doc): Frame[]`, `FrameBounds`(Task 1), `parseDxf(text): DxfDocument`, `OriginalsStore.read(objectKey): Promise<Buffer | null>`, `DrawingsStore.update(id, patch): Promise<DrawingRecord | null>`
- Produces:
  - `DrawingRecord.frames?: FrameBounds[]`
  - `DrawingPatch = Partial<Pick<DrawingRecord, 'status' | 'progress' | 'error' | 'frames'>>`
  - `POST /api/drawings` 응답 본문에 `frames`(DXF는 계산값, DWG는 `[]`)
  - `GET /api/drawings` 응답의 모든 레코드에 `frames`가 있다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/app.test.ts`의 `describe('POST /api/drawings', …)` 안 맨 끝(`'원본 저장이 실패해도 …'` 테스트 다음, 그 describe의 닫는 `});` 앞)에 넣는다. `templatePath`는 파일 아래쪽에 선언돼 있지만 `it` 본문은 모듈이 다 읽힌 뒤 실행되므로 그대로 쓸 수 있다:

```ts
  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 3장
  it('DXF를 올리면 망도틀 영역을 계산해 레코드에 넣는다', async () => {
    const { app, drawings } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '망도.dxf')
      .attach('file', await readFile(templatePath), 'template.dxf');

    expect(res.status).toBe(201);
    // 픽스처의 틀 하나(frames.test.ts에서 손으로 계산한 값)
    expect(res.body.frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await drawings.get(res.body.id))?.frames).toEqual(res.body.frames);
  });

  it('DWG 업로드는 원본을 읽을 수 없으므로 frames가 빈 배열이다', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('dwg'), 'a.dwg');
    expect(res.body.frames).toEqual([]);
  });

  it('읽을 수 없는 DXF는 frames를 빈 배열로 두고 업로드는 계속된다', async () => {
    const { app } = setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 코드·값 짝이 맞지 않는(홀수 줄) 파일이라 parseDxf가 던진다.
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('  0'), 'a.dxf');
    expect(res.status).toBe(201);
    expect(res.body.frames).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[frames]', expect.any(String), expect.stringContaining('홀수'));
    errorSpy.mockRestore();
  });
```

`describe('GET /api/drawings', …)`의 기존 테스트 두 개는 기대값에 `frames`가 더해진다. **바꾸는 이유:** 옛 레코드(`frames` 없음)는 목록을 돌려주기 전에 한 번 계산해 저장하고, DWG·원본 없음은 `[]`로 저장해 다시 시도하지 않는다(설계 3장). 아래 두 줄을 치환한다:

```ts
    expect(byId[done.id]).toEqual({ ...done, frames: [] });
```

```ts
    expect(res.body).toEqual([{ ...pending, frames: [] }]);
```

그리고 그 describe 안 맨 끝에 새 테스트 셋을 넣는다:

```ts
  it('frames가 없는 옛 DXF 레코드는 목록에서 한 번 계산해 저장한다', async () => {
    const { app, drawings, originals } = setup();
    const old = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    await originals.save(old.objectKey, await readFile(templatePath));

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.body[0].frames).toEqual([{ minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 }]);
    expect((await drawings.get(old.id))?.frames).toEqual(res.body[0].frames);
  });

  it('DWG 옛 레코드는 원본을 읽지 않고 빈 배열로 저장한다', async () => {
    const { app, drawings, originals } = setup();
    const old = await seed(drawings, { name: '교량.dwg', status: 'success', progress: 'complete' });
    const readSpy = vi.spyOn(originals, 'read');

    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(res.body[0].frames).toEqual([]);
    expect(readSpy).not.toHaveBeenCalled();
    expect((await drawings.get(old.id))?.frames).toEqual([]);
  });

  it('원본이 없는 DXF 레코드도 빈 배열로 저장해 다시 시도하지 않는다', async () => {
    const { app, drawings } = setup();
    const old = await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete' });
    const res = await request(app).get('/api/drawings').set('x-access-key', KEY);
    expect(res.body[0].frames).toEqual([]);
    expect((await drawings.get(old.id))?.frames).toEqual([]);
  });

  it('이미 frames가 있는 레코드는 다시 계산하지 않는다', async () => {
    const { app, drawings, originals } = setup();
    await seed(drawings, { name: '망도.dxf', status: 'success', progress: 'complete', frames: [] });
    const readSpy = vi.spyOn(originals, 'read');
    const updateSpy = vi.spyOn(drawings, 'update');

    await request(app).get('/api/drawings').set('x-access-key', KEY);

    expect(readSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- app`
Expected: FAIL — `expected undefined to deeply equal [ … ]` (레코드에 `frames`가 없다) 그리고 `seed(… { frames: [] })`에서 타입 오류

- [ ] **Step 3: `DrawingRecord`에 `frames`를 더한다**

`server/src/drawingsStore.ts` 1~17행을 아래로 교체한다:

```ts
import { randomUUID } from 'node:crypto';
import type { FrameBounds } from './export/frames.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export type DrawingStatus = 'pending' | 'inprogress' | 'success' | 'failed';

export interface DrawingRecord {
  id: string;
  name: string;
  objectKey: string;
  urn: string;
  status: DrawingStatus;
  progress: string;
  error: string | null;
  uploadedAt: string;
  /**
   * 망도틀 영역(mm). DXF 업로드 때 원본에서 계산한다. DWG·계산 실패는 빈 배열이다.
   * 이 필드가 **없는** 레코드는 이 기능이 생기기 전에 올린 도면이고, GET /api/drawings가
   * 한 번 계산해 채운다(설계 3장). 표는 넣지 않는다 — 앱은 영역만 쓴다.
   */
  frames?: FrameBounds[];
}

export type DrawingPatch = Partial<Pick<DrawingRecord, 'status' | 'progress' | 'error' | 'frames'>>;
```

- [ ] **Step 4: 업로드에서 계산하고, 목록에서 옛 레코드를 채운다**

`server/src/app.ts`의 import 블록(1~10행)에 두 줄을 더한다:

```ts
import { ExportError, exportDamagesToDxf } from './export/exportDrawing.js';
import { parseDxf } from './export/dxfDocument.js';
import { findFrames, type FrameBounds } from './export/frames.js';
```

`refreshStatus` 다음(44행 뒤)에 도우미 둘을 넣는다:

```ts
// 원본 DXF 글자에서 망도틀 영역만 뽑는다. 읽지 못해도 업로드·목록은 계속된다 — 틀이 없으면
// 도면 전체에서 1번부터 매기는 예전 동작이 될 뿐이다(설계 3장).
function framesOf(original: Buffer, objectKey: string): FrameBounds[] {
  try {
    return findFrames(parseDxf(original.toString('utf8'))).map((frame) => frame.bounds);
  } catch (err) {
    console.error('[frames]', objectKey, messageOf(err));
    return [];
  }
}

// frames 필드가 없는 옛 레코드를 목록을 돌려주기 전에 한 번 채운다. 원본이 없거나 DWG면
// 빈 배열로 저장해 다시 시도하지 않는다(설계 3장).
async function ensureFrames(deps: AppDeps, record: DrawingRecord): Promise<DrawingRecord> {
  if (record.frames !== undefined) return record;
  let frames: FrameBounds[] = [];
  if (record.objectKey.toLowerCase().endsWith('.dxf')) {
    try {
      const original = await deps.originals.read(record.objectKey);
      if (original) frames = framesOf(original, record.objectKey);
    } catch (err) {
      console.error('[frames]', record.objectKey, messageOf(err));
    }
  }
  return (await deps.drawings.update(record.id, { frames })) ?? { ...record, frames };
}
```

업로드 라우트에서 레코드를 만드는 자리(114~123행)를 아래로 교체한다. **디스크에 저장한 사본이 아니라 방금 받은 버퍼로 계산한다** — 사본 저장이 실패해도(디스크 꽉 참) 틀은 그대로 얻을 수 있고, 두 번 읽지 않는다:

```ts
      const record: DrawingRecord = {
        id,
        name,
        objectKey,
        urn,
        status: 'pending',
        progress: '',
        error: null,
        uploadedAt: new Date(now()).toISOString(),
        // DWG는 원본을 읽을 수 없으므로 틀이 없다(설계 3장).
        frames: isDxf ? framesOf(file.buffer, objectKey) : [],
      };
```

목록 라우트(132~135행)를 교체한다:

```ts
  api.get('/drawings', async (_req, res) => {
    const records = await deps.drawings.list();
    res.json(
      await Promise.all(records.map(async (record) => ensureFrames(deps, await refreshStatus(deps, record)))),
    );
  });
```

- [ ] **Step 5: 테스트를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add server/src/drawingsStore.ts server/src/app.ts server/test/app.test.ts
git commit -m "$(cat <<'EOF'
feat: 도면 레코드에 망도틀 영역(frames)을 싣는다

DXF 업로드 때 받은 버퍼에서 바로 계산하고, DWG나 읽기 실패는 빈 배열로 둔다.
frames가 없는 옛 레코드는 GET /api/drawings가 한 번 계산해 저장하고, 원본이 없거나
DWG면 빈 배열로 저장해 다시 시도하지 않는다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 앱이 `/drawings`를 받으면 자기 도면의 틀 영역이 들어 있다. 화면은 아직 쓰지 않는다.

---

## Task 4: 화면 — 틀별 번호와 "망도틀 밖 손상" 경고 배지

**Files:**
- Modify: `server/public/viewer/overlay.js:370-382, 472-507`
- Modify: `server/public/viewer/main.js:107-131, 210-216`
- Modify: `server/public/viewer.html:22`
- Modify: `server/public/viewer/viewer.css:71-74`
- Modify: `server/test/overlay.test.ts:439-455`

**Interfaces:**
- Consumes: `computeNumbers(damages, frames)`, `countOutsideFrames(damages, frames)`(Task 2), `GET /api/drawings` 레코드의 `frames`(Task 3), 기존 `computeLabelPlacements(damages, numbers, dwgToWorld)`
- Produces:
  - `createOverlay(svg, mapper)`가 돌려주는 객체에 `setFrames(frames: FrameBounds[]): void`와 `outsideFrameCount(): number`가 더해진다. 기존 `setDamages`·`setSelected`·`setDraft`·`requestRender`·`numberOf`는 그대로다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

번호가 없는 손상의 라벨이 **원만 빠진 채 그대로 그려지는지**가 화면 쪽의 유일한 순수 확인거리다(`createOverlay`는 DOM이 필요해 node에서 돌릴 수 없다). `server/test/overlay.test.ts`의 `describe('computeLabelPlacements', …)` 안, `const identity = …` 줄 다음에 넣는다:

```ts
  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 5장
  // 틀 밖 손상은 numbers에 없다. 라벨은 그대로 그리고 번호 원만 빠진다.
  it('번호가 없는 손상도 라벨 자리를 받고 블록이 원 너비만큼 좁아진다', () => {
    const damage = rectDamage('a', 0);
    const withNumber = computeLabelPlacements([damage], new Map([['a', 1]]), identity)!.get('a')!;
    const without = computeLabelPlacements([damage], new Map(), identity)!.get('a')!;

    expect(without).toBeDefined();
    // 원 너비 = 반지름 255 × 2 + 원-글자 간격(반지름의 0.5배) 127.5 = 637.5 (도면 mm)
    expect(withNumber.box.width - without.box.width).toBeCloseTo(637.5, 6);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- overlay`
Expected: 이 테스트는 **이미 통과한다**(라벨 쪽은 2026-09-16 label-layout에서 이미 번호 없음을 다루고 있다). 통과를 확인하고 넘어간다 — 확인해 두지 않으면 앞으로 이 동작이 깨져도 아무도 모른다.

- [ ] **Step 3: `overlay.js`에 틀을 들린다**

370~382행(`export function createOverlay(svg, mapper) {`부터 `let placements = null;`까지)을 교체한다:

```js
export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;
  // 번호는 damages가 실제로 바뀔 때만(setDamages) 다시 계산해 여기 담아 둔다. CAMERA_CHANGE는
  // 팬·줌마다 한 번씩(때로는 초당 여러 번) requestRender를 부르므로, render()마다 다시 계산하면
  // 값은 같더라도 매 프레임 불필요한 계산이 반복된다.
  let numbers = new Map();
  // 라벨 자리도 번호와 같은 자리에서 한 번만 계산한다(설계 4.5). null이면 겹침 방지를 하지
  // 않는 도면이라는 뜻이고, 그때는 예전처럼 도형에서 바로 위 자리에 그린다.
  let placements = null;
  // 망도틀 영역(도면 좌표 mm). 도면을 열 때 setFrames로 한 번 받는다. 비어 있으면 도면 전체가
  // 한 묶음이라 예전과 똑같이 동작한다(2026-09-16 frame-numbering 설계 5장).
  let frames = [];
  let outsideCount = 0;

  // 번호·라벨 자리·틀 밖 개수는 셋 다 (손상 목록, 틀 목록)에서만 정해진다. 한 자리에서 같이 구한다.
  function recompute() {
    numbers = computeNumbers(damages, frames);
    outsideCount = countOutsideFrames(damages, frames);
    // 도면 좌표 변환이 있는 도면에서만 dwgToWorld를 넘긴다 — mapper.dwgToWorld 자체는 항상
    // 함수이지만(createCoordinateMapper), dwgStatus.matrix가 없으면 늘 null을 돌려줄 뿐이다.
    // 여기서 미리 null로 걸러 둬야 computeLabelPlacements가 "변환 불가 = 겹침 방지 안 함"과
    // "이 점만 변환 실패"를 구분할 수 있다(전자는 함수 자체가 없을 때만 판단한다).
    const dwgToWorld = mapper.dwgStatus?.matrix ? (point) => mapper.dwgToWorld(point) : null;
    placements = computeLabelPlacements(damages, numbers, dwgToWorld);
  }
```

9행의 import에 `countOutsideFrames`를 더한다:

```js
import { computeNumbers, countOutsideFrames, dimensionTextOf, drawingNameOf, photoTextOf } from './quantities.js';
```

돌려주는 객체(472행 `return {`부터)의 `setDamages`를 교체하고 `setFrames`·`outsideFrameCount`를 더한다:

```js
  return {
    setDamages(list) {
      // 참조가 같으면(선택만 바뀌는 등) 목록 자체는 안 바뀐 것이다 — editor의 모든 변경 함수는
      // 항상 새 배열을 만들므로(damageDoc.js) 참조 비교로 충분하다.
      if (list !== damages) {
        damages = list;
        // 라벨 자리는 저장하지 않는다 — 목록이 바뀔 때마다 처음부터 다시 잡는다(설계 4.6).
        // 손상 하나를 옮기면 이웃 라벨의 자리도 바뀔 수 있고, 그게 맞는 동작이다.
        recompute();
      }
      requestRender();
    },
    // 도면을 열 때 한 번 부른다(main.js). 틀이 바뀌면 번호가 통째로 달라지므로 다시 계산한다.
    setFrames(list) {
      frames = Array.isArray(list) ? list : [];
      recompute();
      requestRender();
    },
    setSelected(id) {
      selectedId = id;
      requestRender();
    },
    setDraft(value) {
      draft = value;
      requestRender();
    },
    requestRender,
    // main.js의 속성 패널 요약줄(번호 표시)이 render()와 같은 캐시를 쓰도록 내보낸다 —
    // 따로 computeNumbers를 다시 부르면 캐시를 둔 의미가 없다. 틀 밖 손상은 null이 나오고
    // 요약줄은 그 자리에 '-'를 보여준다.
    numberOf(id) {
      return numbers.get(id) ?? null;
    },
    // 저장 배지 옆 경고용. 틀이 없는 도면에서는 늘 0이다.
    outsideFrameCount() {
      return outsideCount;
    },
  };
}
```

- [ ] **Step 4: 화면에 경고 배지 자리를 만든다**

`server/public/viewer.html` 22행 다음에 한 줄을 더한다:

```html
      <span id="saveStatus" class="status saved">저장됨</span>
      <span id="frameWarning" class="status outside" hidden></span>
```

`server/public/viewer/viewer.css`의 `.status.error` 줄(74행) 다음에 한 줄을 더한다:

```css
.status.outside { background: #b26a00; }
```

- [ ] **Step 5: `main.js`에서 틀을 넘기고 배지를 갱신한다**

129행(`const overlay = createOverlay($('overlay'), mapper);`) 다음에 한 줄을 넣는다:

```js
  const overlay = createOverlay($('overlay'), mapper);
  // 레코드에 frames가 없으면(옛 도면·DWG) 빈 배열이고, 그때는 도면 전체에서 1번부터 매긴다.
  overlay.setFrames(Array.isArray(drawing.frames) ? drawing.frames : []);
```

`refresh()`(210~216행)를 교체한다:

```js
  function refresh() {
    overlay.setDamages(editor.doc.damages);
    overlay.setSelected(selectedId);
    $('undo').disabled = !canUndo(editor);
    $('delete').disabled = selectedId === null;
    $('props').disabled = selectedId === null;
    // 망도틀 밖에 그린 손상은 번호를 받지 못한다 — 개수를 저장 배지 옆에 알린다(설계 5장).
    const outside = overlay.outsideFrameCount();
    $('frameWarning').textContent = `망도틀 밖 손상 ${outside}개 — 번호 없음`;
    $('frameWarning').hidden = outside === 0;
  }
```

- [ ] **Step 6: 속성 패널의 번호 자리를 확인한다 (고칠 것이 없다)**

`main.js` 385행은 이미 아래와 같다 — `numberOf`가 `null`을 주면 `-`가 찍힌다. **고치지 말고 확인만 한다.**

```js
    $('propsSummary').textContent = `번호 ${number ?? '-'} · 손상현황 ${statusTextOf(draft)} · 물량 ${quantityText}`;
```

- [ ] **Step 7: 문법과 테스트를 확인한다**

Run:
```bash
node --check server/public/viewer/overlay.js
node --check server/public/viewer/main.js
npm --prefix server test && npm --prefix server run typecheck
```
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add server/public/viewer/overlay.js server/public/viewer/main.js server/public/viewer.html server/public/viewer/viewer.css server/test/overlay.test.ts
git commit -m "$(cat <<'EOF'
feat: 화면 번호를 망도틀별로 매기고 틀 밖 손상을 배지로 알린다

createOverlay가 setFrames를 받아 두고, 손상 목록이나 틀이 바뀔 때 번호·라벨 자리·
틀 밖 개수를 한 자리에서 같이 구한다. 틀 밖 손상은 번호 원 없이 그려지고 속성 패널
번호 자리에는 '-'가 나온다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 실기기에서 틀 두 개에 걸쳐 손상을 그리면 각각 1번부터 보이고, 틀 밖에 그리면 번호 없이 그려지며 배지가 뜬다. 산출 DXF는 아직 옛 방식이다.

---

## Task 5: 넘침 표를 오른쪽이 아니라 바로 아래에 그린다

오른쪽은 다음 망도틀 자리다(설계 6장). 이 Task는 틀을 전혀 모른다 — 표 한 장이 넘칠 때 다음 장을 어디 두느냐만 바꾼다.

**Files:**
- Modify: `server/src/export/tableFill.ts:1-3, 56-75, 88-121, 123-163`
- Modify: `server/test/tableFill.test.ts:130-155`

**Interfaces:**
- Consumes: `TableGrid`(`rowBoundaries`·`colBoundaries`·`position`·`transform`·`firstDataRow`·`dataRowCount`), `applyTransform`
- Produces: `fillTable(grid, rows, alloc, owner): DxfPair[]` — **시그니처와 호출 규칙은 그대로다.** 넘침 표의 자리만 바뀐다.

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`server/test/tableFill.test.ts` 131행의 주석과 147~155행의 테스트를 교체한다:

```ts
  // 픽스처의 데이터 행 수는 3이다. 번호 4부터는 원본 표 바로 아래에 새 표가 생긴다.
```

```ts
  it('새 표는 원본 표 바로 아래, 머리글 행 높이만큼 띄운 자리에 있고 왼쪽 끝이 같다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    const value = textsOf(pairs).find((t) => t.text === '박락')!;
    // 왼쪽 끝은 원본과 같다 — x는 원본 표의 2열 중앙 그대로다.
    expect(value.x).toBeCloseTo(2800, 6);
    // 표 높이 120 + 머리글 행 높이 40 = 160만큼 로컬로 내려간다 → 모델에서는 배율 2를 곱해 320
    expect(value.y).toBeCloseTo(3260 - 320, 6);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- tableFill`
Expected: FAIL — `expected 5280 to be close to 2800` (아직 오른쪽으로 간다)

- [ ] **Step 3: `tableFill.ts`를 고친다**

2행 주석을 고친다:

```ts
// 데이터 행 수를 넘으면 원본 표 바로 아래에 같은 모양의 표를 LINE·TEXT로 직접 그린다.
```

56~67행(`offsetOf`와 `localToModel`)을 교체한다:

```ts
// 넘침 표 k장째(k ≥ 1)가 원본에서 아래로 얼마나 내려가는지(표 로컬 단위, 음수다 — 표는
// 위에서 아래로 자란다). 원본 표 아래쪽 끝에서 원본 첫 행(머리글 행) 높이만큼 더 띄운다.
// 오른쪽은 다음 망도틀 자리라 아래로 쌓는다(2026-09-16 frame-numbering 설계 6장,
// 2026-09-15 설계 7.4를 대체한다). 왼쪽 끝은 원본과 같다.
function offsetOf(grid: TableGrid, tableIndex: number): number {
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];
  const headerRowHeight = grid.rowBoundaries[0] - grid.rowBoundaries[1];
  return tableIndex * (bottom - headerRowHeight);
}

function localToModel(grid: TableGrid, local: Point, dy: number): Point {
  return applyTransform(grid.transform, [grid.position[0] + local[0], grid.position[1] + local[1] + dy]);
}
```

69~75행의 `textAt`·`lineAt` 매개변수 이름을 `dx`에서 `dy`로 바꾼다(뜻이 달라졌다):

```ts
function textAt(grid: TableGrid, local: Point, dy: number, value: string, alloc: HandleAllocator, owner: string): DxfPair[] {
  return textEntity(baseFor(alloc, owner), localToModel(grid, local, dy), modelTextHeight(grid), value, 'center');
}

function lineAt(grid: TableGrid, from: Point, to: Point, dy: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  return lineEntity(baseFor(alloc, owner), localToModel(grid, from, dy), localToModel(grid, to, dy));
}
```

`overflowFrame`의 본문(88~121행)을 통째로 교체한다. 바뀌는 것은 `dx` → `dy` 뿐이고 그리는 내용은 같다:

```ts
function overflowFrame(grid: TableGrid, tableIndex: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  const dy = offsetOf(grid, tableIndex);
  const pairs: DxfPair[] = [];

  for (const line of grid.headerLines) pairs.push(...lineAt(grid, line.from, line.to, dy, alloc, owner));
  // 머리글 글자는 각자 원래 높이(BlockText.height × 배율)로 그린다 — 데이터 칸의 글자 높이
  // (grid.textHeight)를 그대로 쓰면 원본에서 머리글과 데이터 칸의 글자 크기가 다를 때 어긋난다.
  for (const text of grid.headerTexts) {
    const height = text.height * Math.abs(grid.transform.scaleX);
    pairs.push(...textEntity(baseFor(alloc, owner), localToModel(grid, text.position, dy), height, text.text, 'center'));
  }

  const left = grid.colBoundaries[0];
  const right = grid.colBoundaries[grid.colBoundaries.length - 1];
  const top = grid.rowBoundaries[grid.firstDataRow];
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];

  // 가로선: 데이터 행 경계. 데이터 시작선은 머리글 선이 이미 그었다.
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const y = grid.rowBoundaries[grid.firstDataRow + row];
    pairs.push(...lineAt(grid, [left, y], [right, y], dy, alloc, owner));
  }
  // 세로선: 모든 열 경계를 데이터 영역만큼
  for (const x of grid.colBoundaries) {
    pairs.push(...lineAt(grid, [x, top], [x, bottom], dy, alloc, owner));
  }
  // 번호 열
  const numberX = columnCenter(grid, grid.numberColumn);
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const number = tableIndex * grid.dataRowCount + row;
    pairs.push(...textAt(grid, [numberX, rowCenter(grid, row)], dy, String(number), alloc, owner));
  }
  return pairs;
}
```

`fillTable`의 아래쪽 반복문(147~162행)도 교체한다:

```ts
  for (const row of rows) {
    if (row.number < 1) continue;
    const tableIndex = Math.floor((row.number - 1) / capacity);
    const dataRow = row.number - tableIndex * capacity;
    const dy = offsetOf(grid, tableIndex);
    const y = rowCenter(grid, dataRow);
    for (let column = 0; column < COLUMN_COUNT; column++) {
      const value = row.cells[column];
      if (!value) continue;
      if (tableIndex === 0) {
        pairs.push(...textEntity(baseFor(alloc, owner), cellCenter(grid, dataRow, column), modelTextHeight(grid), value, 'center'));
      } else {
        pairs.push(...textAt(grid, [columnCenter(grid, column), y], dy, value, alloc, owner));
      }
    }
  }
  return pairs;
}
```

`fillTable`의 JSDoc 첫 줄(124행)에서 "오른쪽 넘침 표"를 고친다:

```ts
 * 표를 채운다. 원본 표는 인쇄된 번호 칸을 건드리지 않고 값 칸만 쓰고, 용량을 넘는 번호는 아래쪽 넘침 표에 넣는다.
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — `tableFill.test.ts`의 나머지 테스트(글자 개수·선 개수·번호 이어붙이기)는 자리만 바뀌었을 뿐이라 그대로 통과하고, `exportDrawing.test.ts`도 넘침 표 **위치**를 보지 않으므로 그대로 통과한다.

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/tableFill.ts server/test/tableFill.test.ts
git commit -m "$(cat <<'EOF'
feat: 넘침 물량표를 원본 표 바로 아래에 그린다

오른쪽은 다음 망도틀 자리라 아래로 쌓는다. 위쪽 끝은 원본 표 아래 끝에서 머리글 행
높이만큼 띄우고 왼쪽 끝은 원본과 같다. 열 너비·행 높이·머리글·이어지는 번호는 그대로다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 36번째 손상부터의 표가 원본 표 아래에 생긴다.

---

## Task 6: 산출 — 틀마다 번호, 틀마다 자기 표, 틀 밖 경고

**Files:**
- Modify: `server/src/export/exportDrawing.ts:1-50, 91-178`
- Modify: `server/test/exportDrawing.test.ts:1-35, 102-117, 151-161, 248-269, 272-284`

**Interfaces:**
- Consumes: `findFrames(doc): Frame[]`(Task 1), `computeNumbers(list, frames)`·`countOutsideFrames(list, frames)`·`frameIndexOf(damage, frames)`(Task 2), `fillTable(grid, rows, alloc, owner)`(Task 5), 기존 `buildGrid`·`findTableCandidates`·`nearestTable`·`hasUniformScale`·`rowValuesOf`·`damageLabels`·`damageEntities`
- Produces:
  - `EXPORT_WARNINGS.outsideFrames: (count: number) => string` — 다른 경고는 지금처럼 문자열 상수 그대로다. `ExportResult.warnings`는 여전히 `string[]`이라 **라우트(`app.ts`)는 고치지 않는다.**
  - `exportDamagesToDxf(dxfText, damages): ExportResult` — 시그니처 그대로

**경고 모양을 이렇게 정한 이유:** `EXPORT_WARNINGS`의 나머지는 개수가 없는 고정 문구라 상수가 맞고, 틀 밖 경고만 개수가 들어간다. 객체 하나에 문자열과 함수가 섞이지만 결과는 여전히 문자열이라 `warnings.join('; ')`로 헤더에 싣는 라우트와 `X-Mangdo-Warning` 계약이 그대로 유지된다. 상수를 `'망도틀 밖 손상 있음'`처럼 개수 없는 문구로 두면 사용자가 몇 개인지 알 수 없다(설계 6장이 개수를 요구한다).

- [ ] **Step 1: 기존 테스트의 좌표를 틀 안으로 옮긴다 (이 Task에서 반드시 먼저)**

`exportDrawing.test.ts`의 손상들은 지금 `dwg` 좌표가 `(0,0)~(1000,400)`이라 **픽스처의 틀 영역(x 2000~4280, y 3160~3400) 밖**이다. 틀별 동작을 넣으면 이 손상들이 전부 "틀 밖"이 되어 번호도 표도 사라진다. 좌표를 틀 안으로 옮기는 것은 **테스트가 검사하려던 동작을 바꾸지 않는다**(평행이동일 뿐이다).

29~30행을 교체한다:

```ts
// 픽스처의 망도틀 영역: x 2000~4280, y 3160~3400 (frames.test.ts에서 손으로 계산).
// 손상의 dwg 경계상자 **중심**이 이 안에 있어야 그 틀의 번호와 표를 받는다.
const RECT_A: Pt[] = [[2100, 3200], [3100, 3200], [3100, 3300], [2100, 3300]]; // 중심 (2600, 3250)
const RECT_B: Pt[] = [[3200, 3200], [4200, 3200], [4200, 3300], [3200, 3300]]; // 중심 (3700, 3250)
```

10~12행의 `template()` 아래에 픽스처 변형 도우미를 가져다 쓴다. 1~8행의 import를 교체한다:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerNames, parseDxf } from '../src/export/dxfDocument.js';
import { EXPORT_WARNINGS, ExportError, exportDamagesToDxf } from '../src/export/exportDrawing.js';
import { flatTable, withSecondFrame } from './fixtureDocs.js';
```

`describe('라벨 겹침 방지와 사진번호 레이어', …)` 안의 `wide` 도우미(273~284행)의 좌표도 틀 안으로 옮긴다:

```ts
    // 세로 3100~3500이라 경계상자 중심 y = 3300이 틀 안(3160~3400)이다. 도형 자체는 틀보다
    // 위아래로 튀어나와도 된다 — 배정은 중심만 본다.
    function wide(id: string, x: number, photoNumbers: string[] = []) {
      const points: Pt[] = [[x, 3100], [x + 1000, 3100], [x + 1000, 3500], [x, 3500]];
```

그리고 그 describe 안 두 테스트의 호출을 옮긴다(`wide('a', 0)` → `wide('a', 2000)`, `wide('b', 1050)` → `wide('b', 3050)`). 세 군데다:

```ts
      const result = exportDamagesToDxf(original, [wide('a', 2000), wide('b', 3050)]);
```

```ts
      const result = exportDamagesToDxf(await template(), [wide('a', 2000, ['12', '13'])]);
```

```ts
      const result = exportDamagesToDxf(await template(), [wide('a', 2000)]);
```

(두 손상 사이 간격은 그대로 1050이라 라벨 어긋남 750과 화살표 3개 기대값은 변하지 않는다 — 평행이동이다.)

Run: `npm --prefix server test -- exportDrawing`
Expected: PASS — 아직 산출 코드는 틀을 모르므로 좌표만 옮긴 지금도 전부 통과해야 한다. 여기서 깨지면 좌표를 잘못 옮긴 것이다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`exportDrawing.test.ts`에서 **틀이 생기면 뜻이 달라지는** 테스트 세 개를 고치고, 새 describe를 더한다.

(a) 102~117행 `'dwg가 없는 손상은 빼고 세어서 알린다. 번호는 그대로 소비한다'`를 아래로 교체한다. **바꾸는 이유:** 설계 6장이 "dwg가 없어 건너뛴 손상은 틀 밖과 같다(번호 없음)"로 규칙을 바꿨다 — 예전처럼 번호를 차지하고 빈 행을 남기지 않는다.

```ts
  it('dwg가 없는 손상은 빼고 세어서 알린다. 번호도 차지하지 않는다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, null, { width: 1, length: 1, count: 1 }),
      damage('b', 'spalling', 500, RECT_A, { width: 2, length: 2, count: 1 }),
    ]);
    expect(result.skipped).toBe(1);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    const doc = parseDxf(result.dxfText);
    // b가 1번이 되어 데이터 1행에 들어간다 (모델 y = 2000 + 2*(700-70) = 3260).
    // 예전 규칙이었다면 b는 2번이라 3220에 들어갔다.
    const ys = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => Number(doc.pairs.slice(i, i + 24).find((p) => p.code === 21)!.value));
    expect(ys).toContain(3260);
    expect(ys).not.toContain(3220);
  });
```

(b) 151~161행의 스트레스 테스트와 248~269행의 R9 테스트는 **틀이 없는 도면**의 동작을 검사한다(번호를 3,000개까지 쭉 매기고, 건너뛴 번호가 빈 행을 남긴다). 픽스처를 `flatTable`로 바꿔 그 뜻을 지킨다. 151~152행을 교체:

```ts
  it('넘침 표가 아주 많아도(인자 전개 없이) 산출되고 다시 읽힌다', async () => {
    // 틀이 없는 도면(표가 최상위)이라 번호가 3,000번까지 쭉 이어지고 넘침 표가 1,000장 생긴다.
    const text = flatTable(await template());
```

254행을 교체:

```ts
    // 틀이 없는 도면에서만 "건너뛴 손상이 번호를 차지한다"는 예전 규칙이 남는다(설계 6장).
    const result = exportDamagesToDxf(flatTable(await template()), damages);
```

(c) 128~133행 `'표의 배율이 가로·세로가 다르면 던진다'`는 세로 배율이 3이 되면 **틀 영역도 세로로 늘어난다**. 손상을 그 안에 둬야 표를 채우려다 배율 검사에 걸린다. 교체:

```ts
  it('표의 배율이 가로·세로가 다르면 던진다', async () => {
    const text = (await template()).replace(' 41\n2.0\n 42\n2.0\n', ' 41\n2.0\n 42\n3.0\n');
    // 세로 배율 3이면 틀 영역은 y 2000+3*580=3740 ~ 2000+3*700=4100이다. 그 안에 손상을 둔다.
    const inStretched: Pt[] = [[2100, 3800], [3100, 3800], [3100, 3900], [2100, 3900]];
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, inStretched)])).toThrow(
      '표의 배율이 가로·세로가 달라 채울 수 없습니다',
    );
  });
```

(d) 파일 맨 끝(`describe('exportDamagesToDxf', …)`의 닫는 `});` 앞)에 새 describe를 더한다:

```ts
  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 5·6장
  describe('망도틀별 번호와 표', () => {
    // 왼쪽 틀(원본, x 2000~4280)과 오른쪽 틀(x 51000~53280)이 있는 도면.
    async function twoFrames(): Promise<string> {
      return withSecondFrame(await template(), 50000);
    }

    const IN_LEFT: Pt[] = [[2100, 3200], [3100, 3200], [3100, 3300], [2100, 3300]];
    const IN_RIGHT: Pt[] = [[51100, 3200], [52100, 3200], [52100, 3300], [51100, 3300]];

    function texts(dxfText: string) {
      const doc = parseDxf(dxfText);
      const out: Array<{ value: string; x: number; y: number }> = [];
      for (let i = 0; i < doc.pairs.length; i++) {
        if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'TEXT') continue;
        const entry = { value: '', x: 0, y: 0 };
        let j = i + 1;
        for (; j < doc.pairs.length && doc.pairs[j].code !== 0; j++) {
          const p = doc.pairs[j];
          if (p.code === 1) entry.value = p.value;
          else if (p.code === 11) entry.x = Number(p.value);
          else if (p.code === 21) entry.y = Number(p.value);
        }
        out.push(entry);
        i = j - 1;
      }
      return out;
    }

    // 주의: '박락'·'1.2x1.5' 같은 글자는 **라벨에도 표에도** 나온다. 표 칸만 가리려면 라벨에
    // 없는 값을 봐야 한다 — 단위 칸('㎡'·'m')과 물량 칸이 그렇다. 개소도 1로 두면 번호 원의
    // '1'과 구별되지 않으므로 2 이상으로 둔다.
    it('틀마다 1번부터 매기고 자기 틀의 표에만 값을 넣는다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [
        damage('l', 'spalling', 0, IN_LEFT, { width: 1.2, length: 1.5, count: 2 }),
        damage('r', 'crack', 500, IN_RIGHT, { width: 0.2, length: 1.5, count: 2 }),
      ]);
      expect(result.warnings).toEqual([]);

      const all = texts(result.dxfText);
      // 번호 원 글자는 둘 다 '1'이다 — 표의 번호 칸은 원본에 인쇄돼 있어 우리가 쓰지 않는다.
      expect(all.filter((t) => t.value === '1')).toHaveLength(2);

      // 왼쪽 틀의 표: 데이터 1행 7열(단위) 중앙 → 모델 (4170, 3260)
      //   7열 중앙 로컬 x = (1030+1140)/2 = 1085 → 1000 + 2*(500+1085) = 4170
      //   데이터 1행 중앙 로컬 y = -70 → 2000 + 2*(700-70) = 3260
      const left = all.find((t) => t.value === '㎡')!;
      expect(left.x).toBeCloseTo(4170, 6);
      expect(left.y).toBeCloseTo(3260, 6);
      // 오른쪽 틀의 표: 같은 칸이 삽입점만 49000 오른쪽 → (53170, 3260)
      const right = all.find((t) => t.value === 'm')!;
      expect(right.x).toBeCloseTo(53170, 6);
      expect(right.y).toBeCloseTo(3260, 6);
    });

    it('손상이 없는 틀의 표는 건드리지 않는다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [
        damage('l', 'spalling', 0, IN_LEFT, { width: 1.2, length: 1.5, count: 2 }),
      ]);
      // 오른쪽 틀 표(x ≈ 51000~53300) 자리에는 글자가 하나도 생기지 않는다.
      expect(texts(result.dxfText).filter((t) => t.x > 40000)).toEqual([]);
    });

    it('틀 밖 손상은 번호 없이 그려지고 경고와 개수를 낸다', async () => {
      const result = exportDamagesToDxf(await template(), [
        damage('in', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 }),
        damage('out', 'spalling', 500, [[0, 0], [100, 0], [100, 100], [0, 100]], { width: 1, length: 1, count: 1 }),
      ]);
      expect(result.warnings).toEqual([EXPORT_WARNINGS.outsideFrames(1)]);
      expect(result.skipped).toBe(0);
      // 도형은 둘 다 그려지고, 번호 원은 틀 안 손상 하나에만 생긴다.
      expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(2);
      expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1);
      // 표에는 틀 안 손상만 들어간다 — 데이터 2행(y 3220)은 비어 있다.
      const ys = texts(result.dxfText).map((t) => t.y);
      expect(ys).toContain(3260);
      expect(ys).not.toContain(3220);
    });

    it('경고 문구에 개수가 그대로 들어간다', () => {
      expect(EXPORT_WARNINGS.outsideFrames(3)).toBe('망도틀 밖 손상 3개는 번호 없이 그려지고 물량표에서 빠집니다');
    });

    it('틀이 없는 도면은 옛 동작 그대로다 — 전체 한 묶음 번호와 가장 가까운 표 하나', async () => {
      // 개소를 3으로 둬 개소 칸('3')이 번호 원의 '1'·'2'와 섞이지 않게 한다.
      const result = exportDamagesToDxf(flatTable(await template()), [
        damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 3 }),
        damage('b', 'spalling', 500, RECT_B, { width: 1.2, length: 1.5, count: 3 }),
      ]);
      expect(result.warnings).toEqual([]);
      const all = texts(result.dxfText);
      // 번호가 1, 2로 이어진다(틀마다 1부터가 아니다).
      expect(all.filter((t) => t.value === '1')).toHaveLength(1);
      expect(all.filter((t) => t.value === '2')).toHaveLength(1);
      // 표는 최상위에 배율·삽입점 없이 놓여 있다 — 단위 칸은 표 삽입점 (500, 700) 기준
      // 7열 중앙 1085, 데이터 1행 중앙 −70 → (1585, 630), 데이터 2행 중앙 −90 → (1585, 610)
      const units = all.filter((t) => t.value === '㎡');
      expect(units).toHaveLength(2);
      expect(units[0].x).toBeCloseTo(1585, 6);
      expect(units[0].y).toBeCloseTo(630, 6);
      expect(units[1].y).toBeCloseTo(610, 6);
    });
  });
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- exportDrawing`
Expected: FAIL — `EXPORT_WARNINGS.outsideFrames is not a function`, 그리고 틀별 표 테스트가 "오른쪽 틀 표가 비어 있다"로 실패한다.

- [ ] **Step 4: `exportDrawing.ts`를 고친다**

import 블록(6~29행)을 교체한다:

```ts
import { computeNumbers, countOutsideFrames, frameIndexOf } from '../../public/viewer/quantities.js';
import { damageEntities, dwgPointsOf, type DamageEntitiesWarnings } from './damageEntities.js';
import {
  createHandleAllocator,
  DAMAGE_COLOR,
  DAMAGE_LAYER,
  ensureLayer,
  findSection,
  findTable,
  headerValue,
  insertEntities,
  parseDxf,
  PHOTO_COLOR,
  PHOTO_LAYER,
  recordHandle,
  serializeDxf,
  setHeaderValue,
  type DxfDocument,
  type DxfPair,
  type HandleAllocator,
} from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { findFrames } from './frames.js';
import { damageLabels, labelEntities } from './labelPlacement.js';
import { COLUMN_COUNT, fillTable, rowValuesOf, type TableRow } from './tableFill.js';
import { buildGrid, findTableCandidates, hasUniformScale, nearestTable, type TableCandidate } from './tableGrid.js';
```

`EXPORT_WARNINGS`(38~43행)를 교체한다:

```ts
export const EXPORT_WARNINGS = {
  noTable: '표 없음',
  unknownTable: '표 모양을 알 수 없음',
  units: '도면 단위 확인 필요',
  circlesTruncated: '균열/백태 원이 1000개에서 잘렸습니다',
  // 개수가 들어가는 유일한 경고라 함수다. 결과는 여전히 문자열이고, 라우트(app.ts)는 그대로
  // warnings.join('; ')으로 X-Mangdo-Warning 헤더에 싣는다.
  outsideFrames: (count: number) =>
    `망도틀 밖 손상 ${count}개는 번호 없이 그려지고 물량표에서 빠집니다`,
} as const;
```

`recordHandleOrThrow` 다음(89행 뒤)에 도우미 둘을 넣는다:

```ts
/** 도면에 놓을 수 있는(도면 좌표가 있는) 손상 하나 */
interface Included {
  id: string;
  damage: unknown;
  /** 틀 안이면 그 틀에서의 번호(1부터), 틀 밖이면 0 */
  number: number;
  points: Point[];
  /** 틀이 없는 도면에서는 모두 null이다 */
  frameIndex: number | null;
}

// 1부터 maxNumber까지 빠짐없는 행 목록. fillTable의 호출 규칙(tableFill.ts의 JSDoc)이다 —
// 번호가 빠지면 그 번호가 속한 넘침 표의 틀이 그려지지 않는다. 틀이 있는 도면에서는 번호를
// 받은 손상이 모두 표에 들어가므로 빈 행이 생기지 않고, 틀이 없는 도면에서만 dwg가 없어
// 건너뛴 손상의 자리가 빈 행으로 남는다.
function rowsFor(entries: Included[], maxNumber: number): TableRow[] {
  const byNumber = new Map(entries.map((entry) => [entry.number, entry.damage] as const));
  const rows: TableRow[] = [];
  for (let number = 1; number <= maxNumber; number++) {
    const damage = byNumber.get(number);
    rows.push(damage !== undefined ? rowValuesOf(damage, number) : { number, cells: new Array(COLUMN_COUNT).fill('') });
  }
  return rows;
}

// 표 하나를 채운다. 배율이 어긋나면 던지고(설계 6장), 격자를 읽지 못하면 경고만 붙인다.
function fillCandidate(
  doc: DxfDocument,
  candidate: TableCandidate,
  rows: TableRow[],
  alloc: HandleAllocator,
  owner: string,
  warnings: string[],
): DxfPair[] {
  if (!hasUniformScale(candidate.transform)) {
    throw new ExportError('표의 배율이 가로·세로가 달라 채울 수 없습니다');
  }
  const grid = buildGrid(doc, candidate);
  if (!grid) {
    // 틀이 여럿이면 같은 경고가 여러 번 나올 수 있다. 한 번만 알린다.
    if (!warnings.includes(EXPORT_WARNINGS.unknownTable)) warnings.push(EXPORT_WARNINGS.unknownTable);
    return [];
  }
  return fillTable(grid, rows, alloc, owner);
}
```

108~125행(번호와 `included` 만들기)을 교체한다:

```ts
  // 틀은 레코드가 아니라 원본에서 다시 구한다 — 원본이 곧 진실이다(설계 6장).
  const frames = findFrames(doc);
  const frameBounds = frames.map((frame) => frame.bounds);

  // 번호는 dwg가 없는 손상까지 포함한 전체 목록에서 world 좌표로 매긴다. 틀이 있으면 틀마다
  // 1번부터이고 틀 밖 손상은 Map에 없다(설계 5장). 틀이 없으면 예전과 똑같다.
  const numbers = computeNumbers(list, frameBounds);
  let maxNumber = 0;
  for (const value of numbers.values()) if (value > maxNumber) maxNumber = value;

  const included: Included[] = [];
  let skipped = 0;
  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id);
    const number = numbers.get(id) ?? 0;
    const points = dwgPointsOf(damage);
    if (!points) {
      skipped += 1;
      continue;
    }
    included.push({ id, damage, number, points, frameIndex: frameIndexOf(damage, frameBounds) });
  }
  included.sort((a, b) => a.number - b.number);
```

`circleWarnings` 경고를 붙이는 줄(146행) 다음에 틀 밖 경고를 붙인다:

```ts
  if (circleWarnings.circlesTruncated) warnings.push(EXPORT_WARNINGS.circlesTruncated);
  // 도면에는 그렸지만 번호를 받지 못한 손상. dwg가 없어 아예 그리지 못한 손상(skipped)은
  // 응답 헤더 X-Mangdo-Skipped로 따로 알리므로 여기서 두 번 세지 않는다.
  const outside = countOutsideFrames(included.map((entry) => entry.damage), frameBounds);
  if (outside > 0) warnings.push(EXPORT_WARNINGS.outsideFrames(outside));
```

148~173행(표 고르기·채우기)을 교체한다:

```ts
  if (frames.length === 0) {
    // 틀이 없는 도면은 예전 규칙 그대로 — 전체 한 묶음 번호, 손상 중심에서 가장 가까운 표 하나.
    const candidates = findTableCandidates(doc);
    if (candidates.length === 0) {
      warnings.push(EXPORT_WARNINGS.noTable);
    } else {
      const candidate = nearestTable(candidates, boundsCenter(included.map((entry) => entry.points)))!;
      appendAll(pairs, fillCandidate(doc, candidate, rowsFor(included, maxNumber), alloc, owner, warnings));
    }
  } else {
    // 틀마다 자기 표에 그 틀 손상만 1번부터 채운다. 손상이 없는 틀의 표는 건드리지 않는다.
    for (const frame of frames) {
      const entries = included.filter((entry) => entry.frameIndex === frame.index);
      if (entries.length === 0) continue;
      let frameMax = 0;
      for (const entry of entries) if (entry.number > frameMax) frameMax = entry.number;
      appendAll(pairs, fillCandidate(doc, frame.table, rowsFor(entries, frameMax), alloc, owner, warnings));
    }
  }
```

- [ ] **Step 5: 테스트를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — 산출 테스트 전부와 `app.test.ts`의 산출 라우트 테스트(경고 헤더 포함)가 통과한다.

- [ ] **Step 6: 커밋**

```bash
git add server/src/export/exportDrawing.ts server/test/exportDrawing.test.ts
git commit -m "$(cat <<'EOF'
feat: 산출 DXF도 망도틀 단위로 번호와 물량표를 만든다

원본에서 findFrames로 틀을 다시 구해 틀마다 1번부터 번호를 매기고, 틀마다 자기 안의
표에 그 틀 손상만 채운다. 손상이 없는 틀의 표는 건드리지 않는다. 틀 밖 손상은 번호 원
없이 그려지고 EXPORT_WARNINGS.outsideFrames(n)로 알린다. 틀이 없는 도면은 예전 그대로
전체 한 묶음 번호와 가장 가까운 표 하나를 쓴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 빈도면에서 산출하면 틀 7개의 표가 각각 자기 손상으로 1번부터 채워진다.

---

## Task 7: 문서 — README, 캐드 확인표, 대체된 설계 안내

**Files:**
- Modify: `README.md:17, 85-89, 108-113`
- Modify: `docs/DXF산출-테스트-결과.md:27(18번 행), 41(32번 행 뒤), 50-54`
- Modify: `docs/superpowers/specs/2026-09-13-damage-attributes-design.md:39`(§3.1 바로 아래)
- Modify: `docs/superpowers/specs/2026-09-15-dxf-export-design.md:115, 121`(7.3·7.4 바로 아래)

**Interfaces:**
- Consumes: Task 1~6에서 확정된 동작과 문구(`망도틀 밖 손상 N개는 번호 없이 그려지고 물량표에서 빠집니다`, 화면 배지 `망도틀 밖 손상 N개 — 번호 없음`)
- Produces: 없음(문서만)

- [ ] **Step 1: README를 고친다**

17행의 설계 목록 끝에 이번 설계 둘을 더한다:

```markdown
- 설계: `docs/superpowers/specs/2026-09-10-phase1-poc-design.md`(1단계 PoC), `docs/superpowers/specs/2026-09-12-damage-types-design.md`(손상 유형 체계), `docs/superpowers/specs/2026-09-13-damage-attributes-design.md`(손상 속성·물량), `docs/superpowers/specs/2026-09-15-dxf-export-design.md`(DXF 산출·손상물량표), `docs/superpowers/specs/2026-09-16-label-layout-design.md`(라벨 배치), `docs/superpowers/specs/2026-09-16-frame-numbering-design.md`(망도틀별 번호·표)
```

85~89행(산출 설명)을 교체한다:

```markdown
   - 도면의 **망도틀마다** 번호가 1번부터 다시 시작합니다. 틀은 "안에 손상물량표가 들어 있는 블록"으로 알아보므로 다른 현장 도면에서도 동작합니다
   - 틀 안 **손상물량표**의 각 칸 자리에 그 틀 손상의 손상현황·가로/폭·세로/길이·개소·면적/연장·단위가 얹힙니다
     (표 객체를 고치는 것이 아니라 칸 위에 글자를 놓는 방식입니다 — 캐드에서 표를 더블클릭하면 칸은 비어 있습니다)
   - 손상이 표의 행 수를 넘으면 표를 **바로 아래에** 한 장 더 그립니다(오른쪽은 다음 망도틀 자리입니다)
   - 망도틀 밖에 그린 손상은 번호 원 없이 도형만 그려지고 물량표에서 빠집니다. 앱 화면에서도 저장 배지 옆에 `망도틀 밖 손상 N개 — 번호 없음`이 뜹니다
   - 도면 좌표를 구하지 못한 손상이 있으면 내려받은 뒤 화면에 `… n개는 빠졌습니다`라고 알립니다
   - 도면에 손상물량표가 없으면 `표 없음` 경고가 뜨고 도형·라벨만 들어갑니다
```

경고 표(113행 `균열/백태 원이 …` 줄) 다음에 한 줄을 더한다:

```markdown
| `망도틀 밖 손상 N개는 번호 없이 그려지고 물량표에서 빠집니다` | 망도틀(물량표가 든 블록) 밖에 그린 손상입니다. 도형은 들어가지만 번호와 표 행이 없습니다. 캐드에서 옮기거나 앱에서 틀 안으로 다시 그리세요 |
```

- [ ] **Step 2: 캐드 확인표를 고친다**

`docs/DXF산출-테스트-결과.md`의 18번 행(27행)은 이제 사실과 다르다. 교체한다:

```markdown
| 18 | **손상을 36개 넘게 그린 도면**에서 두 번째 표가 원본 표 **바로 아래**에 생긴다 | | |
```

32번 행 다음(41행 뒤)에 네 줄을 더한다:

```markdown
| 33 | 망도틀마다 번호가 **1번부터** 다시 시작한다 (첫 틀이 15번에서 끝나도 다음 틀은 1번) | | |
| 34 | 틀마다 **자기 안의 물량표**에 그 틀 손상만 들어간다 (손상이 없는 틀의 표는 비어 있다) | | |
| 35 | 망도틀 밖에 그린 손상은 번호 원 없이 도형만 그려지고 `망도틀 밖 손상 N개…` 경고가 뜬다 | | |
| 36 | 앱 화면의 틀별 번호와 내려받은 DXF의 번호가 **같다** | | |
```

`## 두 번째 표 위치` 절(50~54행)을 교체한다:

```markdown
## 두 번째 표 위치

2026-09-16 설계에서 넘침 표를 원본 표 **바로 아래**로 옮겼다(오른쪽은 다음 망도틀 자리다). 틀 밖으로 나갈 수 있고, 그때는 캐드에서 옮기면 된다(사용자 확인).

- 두 번째 표가 아래에 생겼고 왼쪽 끝이 원본과 같은가:
- 아래쪽 여백이 모자라 다른 도형과 겹쳤는가(겹쳤다면 원하는 자리):
```

- [ ] **Step 3: 대체된 설계에 안내를 남긴다**

`docs/superpowers/specs/2026-09-13-damage-attributes-design.md`의 `### 3.1 번호` 줄(39행) 바로 다음에 한 줄을 넣는다:

```markdown
> **2026-09-16 대체:** "도면 한 장 안에서 1부터"는 `2026-09-16-frame-numbering-design.md`가 대체한다 — 망도틀마다 1번부터 다시 매기고, 틀 밖 손상은 번호를 받지 못한다. 번호 **순서** 규칙(왼쪽 우선, X가 같으면 위쪽, 그다음 id)과 `geometry.world`를 쓴다는 점은 그대로다.
```

`docs/superpowers/specs/2026-09-15-dxf-export-design.md`의 `### 7.3 표가 없거나 여러 개일 때` 줄(115행) 바로 다음에 넣는다:

```markdown
> **2026-09-16 대체:** 표 고르기는 `2026-09-16-frame-numbering-design.md`가 대체한다 — 손상마다 자기 망도틀의 표에 들어간다(가장 가까운 표 하나가 아니다). 틀이 하나도 없는 도면에서만 아래 규칙(가장 가까운 표, `표 없음` 경고)이 그대로 남는다. 격자·데이터 1행을 읽는 방법은 그대로다.
```

`### 7.4 35행을 넘을 때` 줄(121행) 바로 다음에 넣는다:

```markdown
> **2026-09-16 대체:** 넘침 표의 **자리**는 `2026-09-16-frame-numbering-design.md`가 대체한다 — 오른쪽이 아니라 원본 표 **바로 아래**(원본 표 아래 끝에서 머리글 행 높이만큼 띄우고, 왼쪽 끝은 원본과 같다)에 그린다. 오른쪽은 다음 망도틀 자리다. 열 너비·행 높이·머리글·이어지는 번호는 그대로다.
```

- [ ] **Step 4: 문서를 눈으로 확인하고 커밋한다**

Run: `npm --prefix server test`
Expected: PASS (문서만 고쳤으니 그대로여야 한다)

```bash
git add README.md docs/DXF산출-테스트-결과.md docs/superpowers/specs/2026-09-13-damage-attributes-design.md docs/superpowers/specs/2026-09-15-dxf-export-design.md
git commit -m "$(cat <<'EOF'
docs: 망도틀별 번호·표를 README와 캐드 확인표에 반영한다

확인표에 33~36번(틀별 1번부터, 틀별 표, 틀 밖 경고, 화면-DXF 일치)을 더하고 넘침 표
자리를 아래로 고쳤다. 대체된 설계 세 곳(2026-09-13 §3.1, 2026-09-15 7.3·7.4)에
안내 줄을 남긴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 사용자가 지스타캐드에서 무엇을 확인해야 하는지 알 수 있고, 옛 설계를 읽어도 새 설계로 안내된다.

---

## 검증 명령 모음

작업 중 언제든 아래를 돌린다.

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/viewer/quantities.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/main.js
```

한 Task만 빨리 보고 싶으면 `npm --prefix server test -- frames`처럼 파일 이름 조각을 붙인다.

실기기·캐드 확인은 Task 7의 확인표(`docs/DXF산출-테스트-결과.md` 33~36번)로 사용자와 함께 본다. **핵심은 틀 두 개에 걸쳐 손상을 그려 보는 것이다** — 화면 번호가 각각 1번부터인지, 내려받은 DXF에서 각 틀 표에 자기 손상만 들어갔는지, 틀 밖에 그린 손상은 원 없이 그려지고 경고가 뜨는지(설계 8장).

## 손으로 계산한 픽스처 값 (테스트 리터럴의 출처)

`server/test/fixtures/mangdo-template.dxf` 실측:

| 값 | 출처 |
|---|---|
| 표 삽입점(블록 좌표) `(500, 700)` | `ACAD_TABLE`의 코드 10/20 |
| 열 너비 합 `1140` | 코드 142 × 8 = 100+150+300+120+120+100+140+110 |
| 행 높이 합 `120` | 코드 141 × 5 = 40+20+20+20+20 |
| 망도틀 INSERT | 삽입점 `(1000, 2000)`, 배율 2, 회전 0 |
| **틀 영역** | x `1000+2*500=2000` ~ `1000+2*1640=4280`, y `2000+2*580=3160` ~ `2000+2*700=3400` |
| 데이터 1행 중앙 y(모델) | `2000 + 2*(700-70) = 3260` (행 경계 −60 ~ −80) |
| 데이터 2행 중앙 y(모델) | `2000 + 2*(700-90) = 3220` |
| 2열 중앙 x(모델) | `1000 + 2*(500+400) = 2800` |
| 넘침 표 1장째 내림 | `−(120 + 40) = −160`(로컬) → 모델에서 `320` |
| 90도 회전 틀 영역 | x `−400 ~ −160`, y `3000 ~ 5280` (네 모서리를 각각 회전) |

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 2장 틀 = 표가 든 최상위 INSERT(깊이 4) | 1 |
| 2장 영역 = 블록 도형의 변환 후 AABB(HATCH 제외) | 1 |
| 2장 틀 안의 표 = 처음 만난 ACAD_TABLE | 1 |
| 2장 틀 순서 = minX 오름차순, 같으면 maxY 내림차순 | 1 |
| 3장 `DrawingRecord.frames?: FrameBounds[]` | 3 |
| 3장 DXF 업로드에서 계산, 파싱 실패는 `[]` + `console.error` | 3 |
| 3장 DWG 업로드는 `[]` | 3 |
| 3장 옛 레코드는 `GET /drawings`에서 한 번 계산해 저장 | 3 |
| 3장 앱은 레코드의 `frames`(없으면 `[]`)를 그대로 쓴다 | 4 |
| 4장 `frameIndexOf` — dwg 중심, 경계 포함, 겹치면 작은 인덱스, dwg 없으면 null | 2 |
| 4장 world를 쓰지 않는 이유(회전·반전) | 2 (주석) |
| 5장 `computeNumbers(damages, frames = [])` — 틀마다 1부터 | 2 |
| 5장 `frames`가 비면 지금과 같다 | 2 |
| 5장 틀 밖은 Map에 없음 → `?? null` | 2 |
| 5장 번호를 저장하지 않는다(변함없음) | — (건드리지 않음) |
| 5장 화면 `setFrames` | 4 |
| 5장 저장 배지 옆 `망도틀 밖 손상 N개 — 번호 없음`, 0개면 숨김 | 4 |
| 5장 속성 패널 번호 자리 `-` | 4 (이미 그렇게 동작한다 — 확인만) |
| 6장 번호는 원본에서 다시 구한 틀로 매긴다 | 6 |
| 6장 도형·라벨은 그대로, 틀 밖도 도형은 그린다 | 6 (기존 동작 유지) |
| 6장 틀마다 자기 표, 손상 없는 틀은 건드리지 않음 | 6 |
| 6장 틀 밖 경고 `EXPORT_WARNINGS.outsideFrames(n)` | 6 |
| 6장 `skipped`는 틀 밖과 같다(번호 없음) | 6 |
| 6장 틀 0개 도면은 옛 동작(`nearestTable`·`noTable`) | 6 |
| 6장 `hasUniformScale`을 틀마다, 어긋나면 `ExportError` | 6 |
| 6장 넘침 표를 바로 아래, 머리글 행 높이만큼 띄움 | 5 |
| 6장 넘침 표 번호 이어붙이기·70행 넘으면 또 아래 | 5 (기존 규칙 유지) |
| 7장 번호 순서·문구·라벨·표 칸 매핑·저장 형식 불변 | — (건드리지 않음) |
| 8장 단위 테스트 전부 | 1~6의 각 테스트 파일 |
| 8장 실기기·캐드 확인 | 7 |
| 9장 미해결(겹친 틀은 작은 인덱스, 튀어나온 글자로 영역이 넓어짐) | 2(구현) · 7(확인표에서 사용자와 확인) |
