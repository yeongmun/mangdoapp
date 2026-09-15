# 망도틀 넘침 구현 계획 — 틀을 통째로 복사해 오른쪽에 붙이고 뒤 틀을 민다

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 망도틀의 손상이 그 틀 물량표의 데이터 행 수(사내 템플릿 35)를 넘으면, 산출 DXF에서 **그 틀을 통째로 오른쪽에 복사**하고(구조물 도면 + 펼친 틀 블록 + 그 장의 손상·라벨·표) **뒤에 있던 틀들을 한 틀씩 오른쪽으로 민다.**

**Architecture:** 세 겹으로 나눈다. (1) `entityTransform.ts` — (코드, 값) 쌍 배열만 아는 순수 모듈. 엔티티 하나를 옮기고(이동), 변환하고(삽입 변환 펼치기), 복사하고(새 핸들·참조 정리), 경계상자를 낸다. 문서도 틀도 모른다. (2) `sheetCopy.ts` — 문서와 틀을 알고 "어떤 엔티티가 어느 틀 영역인가", "틀 블록을 어떻게 펼쳐 넣는가", "장 수·간격은 얼마인가"를 답한다. 손상은 모른다. (3) `exportDrawing.ts` — 틀마다 장 수·이동량 계획을 세우고 두 모듈을 불러 붙인다. **넘치는 틀이 하나도 없으면 이동량이 전부 0이고, 이동량 0은 원본 쌍 객체를 그대로 돌려주므로 결과가 지금과 한 바이트도 다르지 않다.**

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict), Express 5, vitest. 뷰어 JS(`server/public/viewer/*.js`)와 Expo 앱(`App.tsx` 등)은 **이번 계획에서 변경 없음**(설계 5.3 "앱 화면은 바뀌지 않는다").

**Spec:** `docs/superpowers/specs/2026-09-16-sheet-overflow-design.md`
이 문서가 아래 두 곳의 **넘침 처리**를 대체한다(틀 인식·틀별 번호·틀별 표 채우기는 그대로다):
- `docs/superpowers/specs/2026-09-16-frame-numbering-design.md` 6장 "넘침 표 (7.4 대체)"
- `docs/superpowers/specs/2026-09-15-dxf-export-design.md` 7.4

근거로 삼는 실측 조사:
- `.superpowers/sdd/2026-09-16-frame-numbering/sheet-overflow-probe.md` — 틀 영역·간격(1장), 영역별 최상위 엔티티(2장), 연관 해치·확장 사전(3장), 틀 블록 내용(4장), `dataRowCount = 35`(5장), **그룹 코드별 절대 점/방향 구분표(6장)**

---

## Global Constraints

스펙과 사용자 지시에서 그대로 옮긴 구속값이다. 구현 중 판단이 갈리면 여기를 기준으로 한다. **모든 Task의 요구사항에 이 절이 암묵적으로 포함된다.**

### 작업 안전 규칙 (모든 Task에 적용)

- **`git checkout` / `git restore` / `git stash`를 절대 실행하지 않는다.** 앞선 작업에서 이 명령이 작성 중이던 문서를 통째로 날린 적이 있다. 되돌리고 싶으면 파일을 직접 고쳐라.
- `git add .` / `git add -A` / `git commit -a`를 쓰지 않는다. **파일 이름을 하나씩 적어** `git add <경로> <경로>` 로만 스테이징한다.
- `server/data/`, `.env`, `docs/*.dxf`, `docs/*.bak`는 커밋 대상이 아니다(`.gitignore`). `server/test/fixtures/*.dxf`만 예외로 커밋된다.
- 모든 커밋 메시지의 마지막 줄은 정확히 다음과 같다(글자 하나도 다르면 안 된다):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- 커밋 제목과 본문, 화면 문구는 한국어로 쓴다. 코드와 식별자는 코드의 언어(영어)로 쓴다.
- 작업 브랜치는 `feat/sheet-overflow`다(이미 체크아웃돼 있다).
- `docs/DXF산출-테스트-결과.md`는 **Task 5가 지시하는 자리 말고는 건드리지 않는다.**

### 코드 규약 (기존 코드에서 그대로 이어받는다)

- TypeScript는 NodeNext다 — **상대 경로 import에 `.js` 확장자를 붙인다**(`./tableGrid.js`). 빼먹으면 `npm --prefix server run typecheck`가 바로 잡아낸다.
- `tsc --noEmit`이 strict로 돈다. `any`를 새로 만들지 않는다.
- 숫자·문구를 코드에 박아 두지 않는다. 표의 열 너비·행 높이·글자 높이·데이터 행 수는 원본 DXF에서 그때그때 읽는다(2026-09-15 설계 7.1). 틀 간격(pitch)도 실제 틀 위치에서 구한다 — 조사 1장에서 간격이 74,943~76,617로 **균일하지 않음**이 확인됐다.
- **모든 기하·변환 로직은 순수 함수여야 하고, 테스트 리터럴은 손으로 계산한 값이어야 한다**(계산 과정을 주석에 적는다). 코드가 낸 값을 그대로 기대값에 박아 넣지 않는다.

### DXF 글자 규약 (`dxfDocument.ts` · `dxfEntities.ts`에서 그대로 이어받는다)

- 실수는 `formatReal`로 쓴다 — 지수 표기 없음, `-0`은 `0`으로 눕힌다, 소수점이 없으면 `.0`을 붙인다.
- 정수는 16비트 값이면 6칸(`int16`), 32비트 값이면 9칸(`int32`) 오른쪽 정렬이다. **이미 있는 쌍의 값을 고칠 때는 원래 값 글자 길이에 맞춰 `padStart`한다**(`'     1'` → `'     0'`).
- 핸들은 `HandleAllocator`가 주는 **대문자 16진** 문자열이다. 같은 핸들이 두 번 나오면 캐드가 파일을 열지 못한다.
- `$HANDSEED`는 **맨 마지막에** `alloc.seed`로 올린다(`setHeaderValue`).
- **건드리지 않은 엔티티의 원본 바이트는 한 글자도 바뀌면 안 된다.** `DxfPair.rawCode`가 원본 코드 줄을 들고 있으므로, 쌍을 고칠 때는 `{ ...p, value: 새값 }`으로 `rawCode`를 살려 쓰고, **값이 수치적으로 같으면 아예 고치지 않는다**(`'3200.00'`을 `'3200.0'`으로 다시 쓰지 않는다).

### 이 계획이 지켜야 할 불변식

- **틀이 없는 도면과 미지원 틀(회전·비균일 배율)은 오늘의 동작 그대로다** — 넘침 표를 원본 표 바로 아래에 그린다(`tableFill.ts`의 `fillTable`은 이 계획에서 **고치지 않는다**).
- **넘치는 틀이 하나도 없으면 산출 결과가 바이트 단위로 지금과 같다.** 기존 테스트는 어떤 Task가 명시적으로 고치고 이유를 적지 않는 한 전부 통과해야 한다.
- 앱 화면·저장 형식·번호 규칙·라벨 배치는 바뀌지 않는다. 라벨 겹침 방지(`placeLabels`)는 지금처럼 **원본 좌표에서 도면 전체 손상을 한 번에** 계산한다(설계 5.3).

### 좌표 옮기기 규칙 (설계 5.1 + 조사 6장)

- **절대 점 코드만** 이동량을 더한다: `LINE` 10/20·11/21, `LWPOLYLINE` 반복 10/20, `CIRCLE`·`ARC` 10/20, `SOLID` 10/20·11/21·12/22·13/23, `TEXT` 10/20·11/21, `MTEXT` 10/20, `INSERT` 10/20, `HATCH`의 경계 점·씨앗점과 패턴 기준점 43/44.
- **건드리지 않는다**: `MTEXT` 11/21(방향 벡터), `INSERT` 41/42/43(배율)·50(회전), `HATCH` 45/46(패턴 오프셋)·52/53(각도), 40대 크기 값, `LWPOLYLINE` 42(bulge), 210/220/230(돌출 방향).
- `HATCH`의 **첫 10/20은 고도 기준점**이라 옮기지 않는다(규격상 x·y가 늘 0이다). 그 뒤의 10/20과 11/21만 옮긴다.

### 검증 명령

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
```

---

## File Structure

```
server/src/export/entityTransform.ts   생성: 쌍 배열 하나를 옮기고·변환하고·복사한다. 순수.
server/src/export/sheetCopy.ts         생성: 영역 판정·틀 블록 펼치기·장 수/간격 계산.
server/src/export/tableGrid.ts         수정: 엔티티 범위 읽기(entityRanges·modelSpaceRanges·
                                             blockEntityRanges·rawEntityAt)를 내보낸다.
                                             indexOfBand도 내보낸다.
server/src/export/frames.ts            수정: Frame에 blockName·entityIndex·transform을 더하고
                                             boundsPointsOf를 내보낸다.
server/src/export/exportDrawing.ts     수정: 틀별 장 계획 → 복사본 → 오른쪽 틀 밀기 → 표 채우기.
                                             EXPORT_WARNINGS 3개 추가.

server/test/fixtureDocs.ts             수정: withFrameAt(핸들이 다른 틀 추가), withFrameLine 유지
server/test/entityTransform.test.ts    생성
server/test/sheetCopy.test.ts          생성
server/test/exportDrawing.test.ts      수정: 넘침 장 복사·밀기·누적·실제 템플릿 통합
server/test/frames.test.ts             수정: Frame의 새 필드

README.md                                                        수정: 산출 설명·경고 표
docs/DXF산출-테스트-결과.md                                       수정: 18~20행 교체 + 37~40행 추가
docs/superpowers/specs/2026-09-16-frame-numbering-design.md       수정: 6장에 대체 안내
docs/superpowers/specs/2026-09-15-dxf-export-design.md            수정: 7.4 안내 한 줄 더
```

책임 한 줄 요약:

- `entityTransform.ts` — **쌍 하나를 어떻게 옮기는가.** DXF 문서도 틀도 손상도 모른다.
- `sheetCopy.ts` — **무엇이 이 틀에 속하고, 틀 블록을 어떻게 펼치는가.** 손상은 모른다.
- `tableGrid.ts` — 엔티티를 어떻게 잘라 읽는가(이미 하던 일에 "쌍 범위"를 더한다).
- `frames.ts` — 틀이 어디이고 어떤 블록·어떤 변환인가.
- `exportDrawing.ts` — 틀마다 몇 장이고 얼마나 미는가, 그 계획대로 붙인다.
- `tableFill.ts` — **이 계획에서 고치지 않는다.** 표 한 장 채우기와 옛 넘침(아래로)만 담당한다.

### Task를 5개로 나눈 이유

요청받은 3번(산출 통합)이 너무 커서 **복사본 만들기(Task 3)** 와 **오른쪽 틀 밀기(Task 4)** 로 갈랐다. Task 3만 끝나면 "맨 오른쪽 틀이 넘치는 도면"이 완전히 동작하고(오른쪽에 밀 것이 없으므로) 리뷰어가 독립적으로 승인/거절할 수 있다. Task 4는 원본 엔티티를 **제자리에서** 고치는, 성격이 다른 위험한 변경이라 따로 본다.

---

## Task 1: 엔티티 쌍을 옮기고·변환하고·복사한다 (`entityTransform.ts`)

**Files:**
- Create: `server/src/export/entityTransform.ts`
- Test: `server/test/entityTransform.test.ts`

**Interfaces:**
- Consumes: `dxfDocument.ts`의 `DxfPair`, `formatInt`, `formatReal`, `HandleAllocator`; `tableGrid.ts`의 `Transform`, `applyTransform`; `dxfEntities.ts`의 `Point`
- Produces:
  - `interface EntityBounds { minX: number; minY: number; maxX: number; maxY: number }`
  - `function isCopyable(pairs: DxfPair[]): boolean`
  - `function entityPointsOf(pairs: DxfPair[]): Point[]`
  - `function entityBoundsOf(pairs: DxfPair[]): EntityBounds | null`
  - `function translateEntityPairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[]`
  - `function translatePairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[]`
  - `function transformEntityPairs(pairs: DxfPair[], t: Transform): DxfPair[]`
  - `function copyEntityPairs(pairs: DxfPair[], alloc: HandleAllocator, owner?: string): DxfPair[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다 — 이동**

`server/test/entityTransform.test.ts`를 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import {
  copyEntityPairs,
  entityBoundsOf,
  isCopyable,
  transformEntityPairs,
  translateEntityPairs,
  translatePairs,
} from '../src/export/entityTransform.js';

// 손으로 쓴 쌍 배열. 실제 DXF와 같은 코드 줄 모양(rawCode)을 넣어 원본 바이트 보존을 확인한다.
function pairsOf(...entries: Array<[number, string]>): DxfPair[] {
  return entries.map(([code, value]) => ({ code, value, rawCode: String(code).padStart(3, ' ') }));
}

const LINE = pairsOf(
  [0, 'LINE'], [5, 'A1'], [330, '1F'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbLine'],
  [10, '100.0'], [20, '200.0'], [30, '0.0'], [11, '300.0'], [21, '400.0'], [31, '0.0'],
);

function valueAt(pairs: DxfPair[], code: number, occurrence = 0): string {
  const hits = pairs.filter((p) => p.code === code);
  return hits[occurrence].value;
}

describe('translateEntityPairs', () => {
  it('LINE의 두 점만 x로 옮기고 나머지 쌍은 원본 객체 그대로다', () => {
    const moved = translateEntityPairs(LINE, 1000, 0);
    // 100 + 1000 = 1100, 300 + 1000 = 1300
    expect(valueAt(moved, 10)).toBe('1100.0');
    expect(valueAt(moved, 11)).toBe('1300.0');
    // y는 값이 그대로라 쌍 객체까지 원본과 같아야 한다(바이트 보존)
    expect(moved[7]).toBe(LINE[7]);
    expect(moved[10]).toBe(LINE[10]);
    // 코드 줄(rawCode)은 살아 있다
    expect(moved.find((p) => p.code === 10)!.rawCode).toBe(' 10');
  });

  it('이동량이 0이면 배열 자체를 그대로 돌려준다', () => {
    expect(translateEntityPairs(LINE, 0, 0)).toBe(LINE);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npm --prefix server test -- entityTransform`
Expected: FAIL — `Failed to resolve import "../src/export/entityTransform.js"`

- [ ] **Step 3: `entityTransform.ts`의 뼈대와 이동을 구현한다**

`server/src/export/entityTransform.ts`를 만든다.

```ts
// 엔티티 한 벌의 (코드, 값) 쌍을 옮기거나(이동) 변환한다(삽입 변환 펼치기), 복사한다.
// 쌍 배열만 다루는 순수 모듈이다 — 문서·핸들 표·틀을 모른다. 건드리지 않은 쌍은 원본 객체를
// 그대로 돌려줘 rawCode(원본 바이트)가 보존된다.
//
// 어떤 그룹 코드가 절대 점이고 어떤 것이 방향·크기인지는 실측 조사표를 그대로 옮긴 것이다.
// 근거: docs/superpowers/specs/2026-09-16-sheet-overflow-design.md 5.1·5.2,
//       .superpowers/sdd/2026-09-16-frame-numbering/sheet-overflow-probe.md 6장

import { formatInt, formatReal, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { applyTransform, type Transform } from './tableGrid.js';

export interface EntityBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 종류별 그룹 코드의 역할.
 * - points: 절대 점 (x코드, y코드) — 이동량을 더하고 변환을 적용한다
 * - vectors: 방향 벡터 (x코드, y코드) — 회전만 적용하고 이동하지 않는다
 * - lengths: 길이·높이·반지름 — 배율만 곱한다
 * - angles: 도(度) 단위 각도 — 회전각을 더한다
 */
interface CodeRoles {
  points: ReadonlyArray<readonly [number, number]>;
  vectors: ReadonlyArray<readonly [number, number]>;
  lengths: readonly number[];
  angles: readonly number[];
}

const NONE: CodeRoles = { points: [], vectors: [], lengths: [], angles: [] };

// 여기 없는 종류는 복사하지 않는다(허용 목록). DIMENSION·LEADER·MLEADER·VIEWPORT처럼 다른
// 객체를 가리키는 엔티티, ATTRIB/SEQEND처럼 여러 엔티티가 한 벌을 이루는 것이 모두 빠진다.
// 실제 사내 도면에서 관찰된 종류는 전부 들어 있다(조사 2장).
const ROLES: ReadonlyMap<string, CodeRoles> = new Map([
  ['LINE', { ...NONE, points: [[10, 20], [11, 21]] }],
  ['POINT', { ...NONE, points: [[10, 20]] }],
  ['LWPOLYLINE', { ...NONE, points: [[10, 20]], lengths: [40, 41, 43] }],
  ['CIRCLE', { ...NONE, points: [[10, 20]], lengths: [40] }],
  ['ARC', { ...NONE, points: [[10, 20]], lengths: [40], angles: [50, 51] }],
  ['SOLID', { ...NONE, points: [[10, 20], [11, 21], [12, 22], [13, 23]] }],
  ['TEXT', { ...NONE, points: [[10, 20], [11, 21]], lengths: [40], angles: [50] }],
  // MTEXT의 11/21은 글자 방향 벡터다 — 옮기면 글자가 날아간다(조사 6장).
  ['MTEXT', { ...NONE, points: [[10, 20]], vectors: [[11, 21]], lengths: [40, 41, 42, 43], angles: [50] }],
  // INSERT의 41/42/43은 배율이라 이동에서는 그대로, 변환에서는 곱한다.
  ['INSERT', { ...NONE, points: [[10, 20]], lengths: [41, 42, 43], angles: [50] }],
  // HATCH의 10/20·11/21은 아래 xyRoleOf가 따로 판단한다(첫 10/20은 고도 기준점이라 뺀다).
  ['HATCH', { ...NONE, points: [[43, 44]], vectors: [[45, 46]], lengths: [41, 47, 49], angles: [52, 53] }],
]);

function typeOf(pairs: DxfPair[]): string {
  return pairs.length > 0 && pairs[0].code === 0 ? pairs[0].value : '';
}

// 나란한 두 쌍이 점인지 벡터인지 판단한다. HATCH만 특별 규칙이다.
function xyRoleOf(
  type: string,
  roles: CodeRoles,
  x: number,
  y: number,
  hatchElevationSeen: boolean,
): 'point' | 'vector' | null {
  if (type === 'HATCH') {
    // 첫 (10,20)은 고도 기준점 — 규격상 x·y가 늘 0이라 옮기면 안 된다.
    if (x === 10 && y === 20) return hatchElevationSeen ? 'point' : null;
    // 경계 경로의 점들(10/20 반복)과 호 경계의 '다른 점'(11/21), 마지막 씨앗점이 모두 절대 점이다.
    if (x === 11 && y === 21) return 'point';
  }
  for (const [px, py] of roles.points) if (px === x && py === y) return 'point';
  for (const [vx, vy] of roles.vectors) if (vx === x && vy === y) return 'vector';
  return null;
}

interface Mapper {
  point(x: number, y: number): Point;
  vector(x: number, y: number): Point;
  length(value: number): number;
  angle(degrees: number): number;
}

// 값이 수치적으로 그대로면 쌍을 고치지 않는다 — 원본 바이트를 살리기 위해서다.
// ('3200.00'을 formatReal(3200) = '3200.0'으로 다시 쓰면 안 건드린 엔티티가 바뀐다.)
function put(out: DxfPair[], index: number, source: DxfPair, value: number): boolean {
  const parsed = Number(source.value.trim());
  if (!Number.isFinite(value) || parsed === value) return false;
  out[index] = { ...source, value: formatReal(value) };
  return true;
}

function mapPairs(pairs: DxfPair[], m: Mapper): DxfPair[] {
  const type = typeOf(pairs);
  const roles = ROLES.get(type);
  if (!roles) return pairs;

  const out = pairs.slice();
  let changed = false;
  let hatchElevationSeen = false;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (next) {
      if (type === 'HATCH' && p.code === 10 && next.code === 20 && !hatchElevationSeen) {
        hatchElevationSeen = true;
        i += 1; // 고도 기준점은 두 쌍 모두 건너뛴다
        continue;
      }
      const role = xyRoleOf(type, roles, p.code, next.code, hatchElevationSeen);
      if (role) {
        const x = Number(p.value.trim());
        const y = Number(next.value.trim());
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const [nx, ny] = role === 'point' ? m.point(x, y) : m.vector(x, y);
          if (put(out, i, p, nx)) changed = true;
          if (put(out, i + 1, next, ny)) changed = true;
          i += 1;
          continue;
        }
      }
    }
    if (roles.lengths.includes(p.code)) {
      const value = Number(p.value.trim());
      if (Number.isFinite(value) && put(out, i, p, m.length(value))) changed = true;
      continue;
    }
    if (roles.angles.includes(p.code)) {
      const value = Number(p.value.trim());
      if (Number.isFinite(value) && put(out, i, p, m.angle(value))) changed = true;
    }
  }
  return changed ? out : pairs;
}

/** 엔티티 한 벌을 (dx, dy)만큼 옮긴다. 이동량이 0이면 입력 배열을 그대로 돌려준다. */
export function translateEntityPairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[] {
  if (dx === 0 && dy === 0) return pairs;
  return mapPairs(pairs, {
    point: (x, y) => [x + dx, y + dy],
    vector: (x, y) => [x, y],
    length: (value) => value,
    angle: (degrees) => degrees,
  });
}

/** 엔티티 여러 벌이 이어진 쌍 배열을 옮긴다((0, 타입)마다 잘라 translateEntityPairs에 넘긴다). */
export function translatePairs(pairs: DxfPair[], dx: number, dy: number): DxfPair[] {
  if (dx === 0 && dy === 0) return pairs;
  const out: DxfPair[] = [];
  let start = 0;
  // 첫 (0, 타입) 앞에 붙은 쌍은 그대로 둔다(정상 입력에는 없다).
  while (start < pairs.length && pairs[start].code !== 0) out.push(pairs[start++]);
  for (let i = start; i < pairs.length; ) {
    let end = i + 1;
    while (end < pairs.length && pairs[end].code !== 0) end += 1;
    for (const p of translateEntityPairs(pairs.slice(i, end), dx, dy)) out.push(p);
    i = end;
  }
  return out;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm --prefix server test -- entityTransform`
Expected: PASS (2개)

- [ ] **Step 5: 종류별 이동 테스트를 더한다(실패 확인 포함)**

`entityTransform.test.ts`의 `describe('translateEntityPairs')` 안에 이어 붙인다.

```ts
  it('LWPOLYLINE은 반복되는 10/20을 모두 옮기고 42(bulge)는 그대로다', () => {
    const poly = pairsOf(
      [0, 'LWPOLYLINE'], [5, 'A2'], [330, '1F'], [90, '        3'], [70, '     1'], [43, '0.0'],
      [10, '0.0'], [20, '0.0'], [42, '0.5'], [10, '10.0'], [20, '0.0'], [10, '10.0'], [20, '10.0'],
    );
    const moved = translateEntityPairs(poly, 100, 5);
    expect(moved.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['100.0', '110.0', '110.0']);
    expect(moved.filter((p) => p.code === 20).map((p) => p.value)).toEqual(['5.0', '5.0', '15.0']);
    expect(valueAt(moved, 42)).toBe('0.5');
    expect(valueAt(moved, 43)).toBe('0.0'); // 이동에서는 길이도 그대로
  });

  it('MTEXT의 11/21(방향 벡터)은 옮기지 않는다', () => {
    const mtext = pairsOf(
      [0, 'MTEXT'], [5, 'A3'], [330, '1F'], [10, '50.0'], [20, '60.0'], [40, '10.0'],
      [11, '1.0'], [21, '0.0'], [1, '가나'],
    );
    const moved = translateEntityPairs(mtext, 1000, 0);
    expect(valueAt(moved, 10)).toBe('1050.0');
    expect(valueAt(moved, 11)).toBe('1.0');
    expect(valueAt(moved, 40)).toBe('10.0');
  });

  it('INSERT는 삽입점만 옮기고 배율·회전은 그대로다', () => {
    const insert = pairsOf(
      [0, 'INSERT'], [5, 'A4'], [330, '1F'], [2, '망도틀'], [10, '1000.0'], [20, '2000.0'],
      [41, '2.0'], [42, '2.0'], [43, '2.0'], [50, '0.0'],
    );
    const moved = translateEntityPairs(insert, 49000, 0);
    expect(valueAt(moved, 10)).toBe('50000.0');
    expect(valueAt(moved, 41)).toBe('2.0');
    expect(valueAt(moved, 50)).toBe('0.0');
  });

  it('HATCH는 첫 10/20(고도)을 빼고 경계·씨앗·43/44만 옮긴다', () => {
    const moved = translateEntityPairs(HATCH, 1000, 0);
    // 10 코드 등장 순서: [0] 고도, [1][2][3] 경계 세 점, [4] 씨앗점
    expect(moved.filter((p) => p.code === 10).map((p) => p.value)).toEqual([
      '0.0', '1010.0', '1020.0', '1010.0', '1010.0',
    ]);
    expect(valueAt(moved, 43)).toBe('1005.0'); // 패턴 기준점 5 + 1000
    expect(valueAt(moved, 44)).toBe('6.0');
    expect(valueAt(moved, 45)).toBe('0.0'); // 패턴 오프셋은 그대로
    expect(valueAt(moved, 46)).toBe('3.0');
    expect(valueAt(moved, 52)).toBe('45.0'); // 각도도 그대로
  });

  it('여러 엔티티가 이어진 쌍 배열도 한 번에 옮긴다', () => {
    const both = [...LINE, ...pairsOf([0, 'CIRCLE'], [5, 'A9'], [330, '1F'], [10, '5.0'], [20, '5.0'], [40, '2.0'])];
    const moved = translatePairs(both, 10, 0);
    expect(moved.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['110.0', '15.0']);
    expect(moved.filter((p) => p.code === 40).map((p) => p.value)).toEqual(['2.0']);
  });
```

그리고 파일 위쪽(`LINE` 정의 아래)에 손으로 쓴 연관 해치를 더한다.

```ts
// 연관 해치(71=1) + 경계 원본 참조(97/330). 조사 3장에서 실제 도면에 있던 모양 그대로다.
// 경계는 (10,10)-(20,10)-(10,20) 삼각형, 씨앗점은 무게중심 근처 (10,10).
const HATCH = pairsOf(
  [0, 'HATCH'], [5, 'A5'], [330, '1F'], [100, 'AcDbEntity'], [8, '!2026년 신규 손상'], [100, 'AcDbHatch'],
  [10, '0.0'], [20, '0.0'], [30, '0.0'], [2, 'ANSI31'], [70, '     0'], [71, '     1'],
  [91, '        1'], [92, '        7'], [72, '     0'], [73, '     1'], [93, '        3'],
  [10, '10.0'], [20, '10.0'], [10, '20.0'], [20, '10.0'], [10, '10.0'], [20, '20.0'],
  [97, '        1'], [330, '39AA'],
  [75, '     0'], [76, '     1'], [52, '45.0'], [41, '1.0'], [77, '     0'], [78, '     1'],
  [53, '45.0'], [43, '5.0'], [44, '6.0'], [45, '0.0'], [46, '3.0'], [79, '     0'],
  [47, '0.115'], [98, '        1'], [10, '10.0'], [20, '10.0'],
);
```

- [ ] **Step 6: 테스트를 돌려 실패를 확인하고 통과시킨다**

Run: `npm --prefix server test -- entityTransform`
Expected: 처음에는 HATCH 테스트만 실패할 수 있다(위 구현이 이미 옳다면 전부 PASS). 실패하면 `xyRoleOf`의 HATCH 분기를 고쳐 통과시킨다.

- [ ] **Step 7: 커밋**

```bash
git add server/src/export/entityTransform.ts server/test/entityTransform.test.ts
git commit -m "$(cat <<'EOF'
feat: 엔티티 쌍을 절대 점만 골라 옮기는 순수 모듈을 만든다

종류별로 어떤 그룹 코드가 절대 점이고 어떤 것이 방향 벡터·크기·각도인지 실측 조사표대로
표에 담아 두고, 점만 이동량을 더한다. MTEXT 11/21과 HATCH 45/46·52/53, INSERT 41/42/50은
건드리지 않고 HATCH의 첫 10/20(고도 기준점)도 뺀다. 값이 그대로인 쌍은 객체째 돌려줘
원본 바이트가 보존된다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 경계상자와 복사 가능 판정 테스트를 쓴다**

```ts
describe('entityBoundsOf · isCopyable', () => {
  it('LINE의 두 점을 감싸는 경계상자를 낸다', () => {
    expect(entityBoundsOf(LINE)).toEqual({ minX: 100, minY: 200, maxX: 300, maxY: 400 });
  });

  it('HATCH는 고도 기준점을 빼고 경계·씨앗·43/44로 경계상자를 낸다', () => {
    // 경계 (10,10) (20,10) (10,20), 씨앗 (10,10), 패턴 기준점 (5,6)
    expect(entityBoundsOf(HATCH)).toEqual({ minX: 5, minY: 6, maxX: 20, maxY: 20 });
  });

  it('점이 없으면 null이다', () => {
    expect(entityBoundsOf(pairsOf([0, 'LINE'], [5, 'B1']))).toBeNull();
  });

  it('허용 목록 밖의 종류는 복사하지 않는다', () => {
    expect(isCopyable(LINE)).toBe(true);
    expect(isCopyable(HATCH)).toBe(true);
    expect(isCopyable(pairsOf([0, 'DIMENSION'], [5, 'B2'], [2, '*D1']))).toBe(false);
    expect(isCopyable(pairsOf([0, 'ACAD_TABLE'], [5, 'B3']))).toBe(false);
  });

  it('속성이 따라오는 INSERT(66=1)는 복사하지 않는다 — ATTRIB이 따로 떨어져 나간다', () => {
    const withAttribs = pairsOf([0, 'INSERT'], [5, 'B4'], [66, '     1'], [2, '틀'], [10, '0.0'], [20, '0.0']);
    expect(isCopyable(withAttribs)).toBe(false);
  });

  it('폴리라인 경계가 아닌 HATCH(92에 폴리라인 비트 없음)는 복사하지 않는다', () => {
    const edges = HATCH.map((p) => (p.code === 92 ? { ...p, value: '        1' } : p));
    expect(isCopyable(edges)).toBe(false);
  });
});
```

- [ ] **Step 9: 실패를 확인한다**

Run: `npm --prefix server test -- entityTransform`
Expected: FAIL — `entityBoundsOf is not a function`

- [ ] **Step 10: 구현한다**

`entityTransform.ts`에 이어 붙인다.

```ts
/** 엔티티가 가진 절대 점을 전부 모은다(INSERT는 삽입점 하나만 — 블록 안은 여기서 모른다). */
export function entityPointsOf(pairs: DxfPair[]): Point[] {
  const type = typeOf(pairs);
  const roles = ROLES.get(type);
  if (!roles) return [];
  const points: Point[] = [];
  let hatchElevationSeen = false;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const next = pairs[i + 1];
    if (!next) break;
    if (type === 'HATCH' && p.code === 10 && next.code === 20 && !hatchElevationSeen) {
      hatchElevationSeen = true;
      i += 1;
      continue;
    }
    if (xyRoleOf(type, roles, p.code, next.code, hatchElevationSeen) !== 'point') continue;
    const x = Number(p.value.trim());
    const y = Number(next.value.trim());
    if (Number.isFinite(x) && Number.isFinite(y)) points.push([x, y]);
    i += 1;
  }
  return points;
}

export function entityBoundsOf(pairs: DxfPair[]): EntityBounds | null {
  const points = entityPointsOf(pairs);
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function intAt(pairs: DxfPair[], code: number): number | null {
  const p = pairs.find((entry) => entry.code === code);
  if (!p) return null;
  const value = Number(p.value.trim());
  return Number.isFinite(value) ? value : null;
}

// 경계 경로 종류 플래그(92)의 2번 비트가 폴리라인이다. 그 비트가 없는 경로(선·호·타원호
// 조각으로 이뤄진 경계)는 11/21이 '중심 기준 상대 벡터'로 쓰이는 자리가 있어 단순 이동으로는
// 옳게 옮길 수 없다 — 복사하지 않고 경고로 센다(설계 5.1 마지막 항목과 같은 취급).
const HATCH_POLYLINE_BIT = 2;

export function isCopyable(pairs: DxfPair[]): boolean {
  const type = typeOf(pairs);
  if (!ROLES.has(type)) return false;
  // 속성(ATTRIB)이 따라오는 INSERT는 ATTRIB…SEQEND까지 한 벌이라 이 모듈이 다루지 못한다.
  if (type === 'INSERT' && intAt(pairs, 66) === 1) return false;
  if (type === 'HATCH') {
    for (const p of pairs) {
      if (p.code !== 92) continue;
      const flags = Number(p.value.trim());
      if (!Number.isFinite(flags) || (flags & HATCH_POLYLINE_BIT) === 0) return false;
    }
  }
  return true;
}
```

- [ ] **Step 11: 통과를 확인하고 커밋한다**

Run: `npm --prefix server test -- entityTransform && npm --prefix server run typecheck`
Expected: PASS

```bash
git add server/src/export/entityTransform.ts server/test/entityTransform.test.ts
git commit -m "$(cat <<'EOF'
feat: 엔티티 경계상자와 복사 가능 판정을 더한다

절대 점만 모아 축 정렬 경계상자를 낸다. 복사는 허용 목록(LINE·LWPOLYLINE·CIRCLE·ARC·
TEXT·MTEXT·SOLID·POINT·HATCH·INSERT)으로 제한하고, 속성이 따라오는 INSERT와 폴리라인이
아닌 경계를 가진 HATCH는 뺀다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 12: 변환(펼치기)과 복사 테스트를 쓴다**

```ts
describe('transformEntityPairs', () => {
  // 배율 2, 회전 0, 삽입점 (10, 20) — 픽스처 망도틀과 같은 모양의 변환이다.
  const SCALE2: Transform = { x: 10, y: 20, scaleX: 2, scaleY: 2, rotationRad: 0 };

  it('점은 변환하고 길이는 배율을 곱한다', () => {
    const circle = pairsOf([0, 'CIRCLE'], [5, 'C1'], [330, '30'], [10, '100.0'], [20, '200.0'], [40, '5.0']);
    const out = transformEntityPairs(circle, SCALE2);
    // x = 10 + 2*100 = 210, y = 20 + 2*200 = 420, r = 5*2 = 10
    expect(valueAt(out, 10)).toBe('210.0');
    expect(valueAt(out, 20)).toBe('420.0');
    expect(valueAt(out, 40)).toBe('10.0');
  });

  it('TEXT의 두 정렬점과 글자 높이를 함께 변환한다', () => {
    const text = pairsOf(
      [0, 'TEXT'], [5, 'C2'], [330, '30'], [10, '50.0'], [20, '-70.0'], [40, '10.0'], [1, '1'],
      [11, '50.0'], [21, '-70.0'],
    );
    const out = transformEntityPairs(text, SCALE2);
    // 10 + 2*50 = 110, 20 + 2*(-70) = -120, 높이 10*2 = 20
    expect(valueAt(out, 10)).toBe('110.0');
    expect(valueAt(out, 20)).toBe('-120.0');
    expect(valueAt(out, 11)).toBe('110.0');
    expect(valueAt(out, 40)).toBe('20.0');
  });

  it('중첩 INSERT는 삽입점을 변환하고 배율을 곱하고 회전을 더한다', () => {
    const insert = pairsOf(
      [0, 'INSERT'], [5, 'C3'], [330, '30'], [2, '*TX'], [10, '0.0'], [20, '5000.0'],
      [41, '1.0'], [42, '1.0'], [43, '1.0'], [50, '0.0'],
    );
    const rotated: Transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: Math.PI / 2 };
    const out = transformEntityPairs(insert, rotated);
    // 90도 회전: (0, 5000) → (-5000, 0). 배율 1*2 = 2, 회전 0 + 90 = 90
    expect(Number(valueAt(out, 10))).toBeCloseTo(-10000, 6); // 2*5000 = 10000을 회전
    expect(Number(valueAt(out, 20))).toBeCloseTo(0, 6);
    expect(valueAt(out, 41)).toBe('2.0');
    expect(valueAt(out, 50)).toBe('90.0');
  });

  it('ARC의 시작·끝 각도에 회전각을 더한다', () => {
    const arc = pairsOf([0, 'ARC'], [5, 'C4'], [330, '30'], [10, '0.0'], [20, '0.0'], [40, '10.0'], [50, '30.0'], [51, '300.0']);
    const out = transformEntityPairs(arc, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: Math.PI / 2 });
    // 30 + 90 = 120, 300 + 90 = 390 → 360으로 나눈 나머지 30
    expect(Number(valueAt(out, 50))).toBeCloseTo(120, 6);
    expect(Number(valueAt(out, 51))).toBeCloseTo(30, 6);
  });
});

describe('copyEntityPairs', () => {
  it('새 핸들을 받고 소유자를 바꾼다', () => {
    const alloc = new HandleAllocator(0x300);
    const copy = copyEntityPairs(LINE, alloc, '1F');
    expect(valueAt(copy, 5)).toBe('300');
    expect(valueAt(copy, 330)).toBe('1F');
    expect(valueAt(copy, 10)).toBe('100.0'); // 좌표는 그대로(옮기는 것은 호출부 몫)
  });

  it('ACAD_REACTORS·ACAD_XDICTIONARY 묶음을 통째로 뺀다', () => {
    const withGroups = pairsOf(
      [0, 'LWPOLYLINE'], [5, 'D1'], [330, '1F'],
      [102, '{ACAD_REACTORS'], [330, '39A9'], [330, '1F'], [102, '}'],
      [102, '{ACAD_XDICTIONARY'], [360, 'ABC'], [102, '}'],
      [10, '0.0'], [20, '0.0'], [10, '10.0'], [20, '0.0'],
    );
    const copy = copyEntityPairs(withGroups, new HandleAllocator(0x300), '1F');
    expect(copy.some((p) => p.code === 102)).toBe(false);
    expect(copy.some((p) => p.code === 360)).toBe(false);
    expect(copy.filter((p) => p.code === 330).map((p) => p.value)).toEqual(['1F']);
  });

  it('연관 해치를 비연관으로 바꾸고 경계 원본 참조를 지운다', () => {
    const copy = copyEntityPairs(HATCH, new HandleAllocator(0x300), '1F');
    expect(valueAt(copy, 71)).toBe('     0'); // 자리 맞춤을 원래 길이(6칸) 그대로 지킨다
    expect(valueAt(copy, 97)).toBe('        0');
    expect(copy.filter((p) => p.code === 330).map((p) => p.value)).toEqual(['1F']); // 39AA가 사라졌다
    // 경계 점은 그대로라 모양이 같다
    expect(copy.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['0.0', '10.0', '20.0', '10.0', '10.0']);
  });
});
```

`import type { Transform } from '../src/export/tableGrid.js';`를 테스트 맨 위에 더한다.

- [ ] **Step 13: 실패를 확인한다**

Run: `npm --prefix server test -- entityTransform`
Expected: FAIL — `transformEntityPairs is not a function`

- [ ] **Step 14: 구현한다**

`entityTransform.ts`에 이어 붙인다.

```ts
function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

/**
 * 블록 안 엔티티를 삽입 변환으로 모델 좌표로 펼친다. 배율은 가로·세로가 같아야 한다
 * (`isFlattenable`로 미리 거른다 — 비균일 배율에서는 각도가 보존되지 않는다).
 */
export function transformEntityPairs(pairs: DxfPair[], t: Transform): DxfPair[] {
  const scale = t.scaleX;
  const degrees = (t.rotationRad * 180) / Math.PI;
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return mapPairs(pairs, {
    point: (x, y) => applyTransform(t, [x, y]),
    // 방향 벡터는 회전만 한다(배율을 곱해도 뜻이 같고, 캐드가 어차피 정규화한다).
    vector: (x, y) => [x * cos - y * sin, x * sin + y * cos],
    length: (value) => value * scale,
    angle: (value) => normalizeDegrees(value + degrees),
  });
}

// 원래 값의 글자 길이에 맞춰 정수를 다시 쓴다('     1' → '     0').
function paddedInt(source: string, value: number): string {
  return formatInt(value).padStart(source.length, ' ');
}

/**
 * 엔티티 한 벌을 복사본으로 만든다 — 새 핸들(5), 새 소유자(330), 원본을 가리키는 참조 제거.
 * 좌표는 건드리지 않는다(옮기는 것은 호출부가 translate/transform으로 한다).
 *
 * - `102 {...} … 102 }` 묶음은 통째로 뺀다. ACAD_REACTORS(연관 해치가 되가리키는 반응자)와
 *   ACAD_XDICTIONARY(주석 축척용 확장 사전)가 여기 들어 있는데 둘 다 **원본 엔티티**를 가리켜
 *   복사본에서는 뜻이 없다(조사 3장).
 * - 연관 해치(71=1)는 비연관(71=0)으로 바꾸고 경계 경로의 원본 객체 수(97)를 0으로 만든 뒤
 *   그 뒤에 이어지는 330들을 지운다. 경계 점은 해치 안에 이미 있으므로 모양은 같다.
 */
export function copyEntityPairs(pairs: DxfPair[], alloc: HandleAllocator, owner?: string): DxfPair[] {
  const isHatch = typeOf(pairs) === 'HATCH';
  const associative = isHatch && intAt(pairs, 71) === 1;

  const out: DxfPair[] = [];
  let handleDone = false;
  let ownerDone = false;
  let dropReferences = 0;

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];

    // 102 { … 102 } 묶음 건너뛰기
    if (p.code === 102 && p.value.startsWith('{')) {
      let j = i + 1;
      while (j < pairs.length && !(pairs[j].code === 102 && pairs[j].value.trim() === '}')) j += 1;
      i = j;
      continue;
    }

    if (dropReferences > 0 && p.code === 330) {
      dropReferences -= 1;
      continue;
    }

    if (p.code === 5 && !handleDone) {
      out.push({ ...p, value: alloc.next() });
      handleDone = true;
      continue;
    }
    if (p.code === 330 && handleDone && !ownerDone) {
      ownerDone = true;
      out.push(owner === undefined ? p : { ...p, value: owner });
      continue;
    }
    if (associative && p.code === 71) {
      out.push({ ...p, value: paddedInt(p.value, 0) });
      continue;
    }
    if (associative && p.code === 97) {
      const count = Number(p.value.trim());
      if (Number.isFinite(count) && count > 0) dropReferences = count;
      out.push({ ...p, value: paddedInt(p.value, 0) });
      continue;
    }
    out.push(p);
  }
  return out;
}
```

- [ ] **Step 15: 통과를 확인하고 커밋한다**

Run: `npm --prefix server test -- entityTransform && npm --prefix server run typecheck`
Expected: PASS (전체 15개 안팎)

```bash
git add server/src/export/entityTransform.ts server/test/entityTransform.test.ts
git commit -m "$(cat <<'EOF'
feat: 블록 펼치기 변환과 엔티티 복사를 더한다

삽입 변환(위치·균일 배율·회전)으로 점을 옮기고 길이에 배율을 곱하고 각도에 회전을 더한다.
복사는 새 핸들·새 소유자를 주고 102 묶음(ACAD_REACTORS·ACAD_XDICTIONARY)을 빼며 연관
해치를 비연관으로 바꾸고 경계 원본 참조를 지운다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 쌍 배열 하나를 옮기고·펼치고·복사하는 순수 함수 묶음이 종류별 단위 테스트와 함께 있다.

---

## Task 2: 영역 판정과 틀 블록 펼치기 (`sheetCopy.ts`)

`entityTransform.ts`는 쌍만 안다. 이 Task는 **문서와 틀**을 붙인다 — 어떤 최상위 엔티티가 어느 틀 영역인지, 틀 블록을 어떻게 펼쳐 넣는지, 장 수와 간격이 얼마인지.

그러려면 엔티티의 **쌍 범위**(`doc.pairs`에서 몇 번째부터 몇 번째까지)를 알아야 한다. `tableGrid.ts`의 `readEntities`가 이미 "(0, 타입)부터 다음 (0, …) 직전까지"로 자르고 있으므로, **자르는 규칙을 두 벌로 베끼지 않고** 그 함수를 범위 기반으로 다시 쓰고 범위를 내보낸다.

**Files:**
- Modify: `server/src/export/tableGrid.ts:158-199, 226-242, 325-332`
- Modify: `server/src/export/frames.ts:28-34, 46-49, 87-129`
- Create: `server/src/export/sheetCopy.ts`
- Modify: `server/test/fixtureDocs.ts:21-35`
- Create: `server/test/sheetCopy.test.ts`
- Modify: `server/test/frames.test.ts:26-36`

**Interfaces:**
- Consumes: Task 1의 `copyEntityPairs(pairs, alloc, owner?)`, `entityBoundsOf(pairs)`, `isCopyable(pairs)`, `transformEntityPairs(pairs, t)`, `translateEntityPairs(pairs, dx, dy)`, `EntityBounds`
- Produces:
  - `tableGrid.ts`:
    - `interface EntityRange { type: string; start: number; end: number }`
    - `function entityRanges(pairs: DxfPair[], from: number, to: number): EntityRange[]`
    - `function rawEntityAt(pairs: DxfPair[], range: EntityRange): RawEntity`
    - `function modelSpaceRanges(doc: DxfDocument): EntityRange[]`
    - `function blockEntityRanges(doc: DxfDocument): Map<string, EntityRange[]>`
    - `function indexOfBand(boundaries: number[], value: number): number` (이미 있는 내부 함수를 내보내기만 한다)
  - `frames.ts`:
    - `Frame`에 `blockName: string`, `entityIndex: number`, `transform: Transform` 추가
    - `function boundsPointsOf(entity: RawEntity): Point[]` (기존 내부 `entityPoints`를 내보내기만 한다)
  - `sheetCopy.ts`:
    - `function pageOf(damageNumber: number, dataRows: number): number`
    - `function pagesOf(maxNumber: number, dataRows: number): number`
    - `function pitchOf(frames: Frame[], index: number): number`
    - `function isFlattenable(t: Transform): boolean`
    - `function shiftGrid(grid: TableGrid, dx: number): TableGrid`
    - `interface SheetContext { doc: DxfDocument; model: ModelSpace; ranges: EntityRange[]; blocks: Map<string, EntityRange[]>; alloc: HandleAllocator; owner: string }`
    - `function readSheetContext(doc: DxfDocument, alloc: HandleAllocator, owner: string): SheetContext | null`
    - `interface RegionIndex { inFrame: EntityRange[][]; frameInsert: Array<EntityRange | null>; loose: Array<{ range: EntityRange; centerX: number }> }`
    - `function indexRegions(ctx: SheetContext, frames: Frame[]): RegionIndex`
    - `interface CopyResult { pairs: DxfPair[]; skipped: number }`
    - `function copyRegion(ctx: SheetContext, ranges: EntityRange[], dx: number): CopyResult`
    - `function flattenFrameBlock(ctx: SheetContext, frame: Frame, grid: TableGrid, page: number, dx: number): CopyResult`
    - `function shiftRangesInPlace(doc: DxfDocument, ranges: EntityRange[], dx: number): void`
  - `test/fixtureDocs.ts`:
    - `function withFrameAt(text: string, insertX: number, handle: string): string`
    - `withSecondFrame(text, insertX)`은 그대로 남되 `withFrameAt(text, insertX, '8A')`로 구현이 바뀐다

- [ ] **Step 1: `tableGrid.ts`의 엔티티 읽기를 범위 기반으로 바꾼다**

`server/src/export/tableGrid.ts`의 `readEntities`(158~175행)를 아래로 **교체**한다. 동작은 그대로다 — 기존 테스트가 전부 통과해야 한다.

```ts
/** doc.pairs 안에서 엔티티 하나가 차지하는 구간. start는 (0, 타입) 쌍, end는 그 다음 엔티티의 시작이다. */
export interface EntityRange {
  type: string;
  start: number;
  end: number;
}

// (0, 타입)부터 다음 (0, …) 직전까지를 한 엔티티로 본다. 첫 (0, …) 앞의 쌍은 버린다.
export function entityRanges(pairs: DxfPair[], from: number, to: number): EntityRange[] {
  const ranges: EntityRange[] = [];
  for (let i = from; i < to; i++) {
    if (pairs[i].code !== 0) continue;
    if (ranges.length > 0) ranges[ranges.length - 1].end = i;
    ranges.push({ type: pairs[i].value, start: i, end: to });
  }
  return ranges;
}

export function rawEntityAt(pairs: DxfPair[], range: EntityRange): RawEntity {
  const entity: RawEntity = { type: range.type, values: new Map() };
  for (let i = range.start + 1; i < range.end; i++) {
    const p = pairs[i];
    const list = entity.values.get(p.code);
    if (list) list.push(p.value);
    else entity.values.set(p.code, [p.value]);
  }
  return entity;
}

function readEntities(pairs: DxfPair[], from: number, to: number): RawEntity[] {
  return entityRanges(pairs, from, to).map((range) => rawEntityAt(pairs, range));
}
```

- [ ] **Step 2: 블록·모델 공간의 범위를 내보낸다**

같은 파일의 `readBlocks`(182~199행) 바로 아래에 더한다.

```ts
/** 블록 이름 → 그 블록 안 엔티티들의 쌍 범위(BLOCK 머리말은 뺀다). */
export function blockEntityRanges(doc: DxfDocument): Map<string, EntityRange[]> {
  const section = findSection(doc, 'BLOCKS');
  const blocks = new Map<string, EntityRange[]>();
  if (!section) return blocks;
  let start = -1;
  for (let i = section.start; i < section.end; i++) {
    const p = doc.pairs[i];
    if (p.code !== 0) continue;
    if (p.value === 'BLOCK') start = i;
    else if (p.value === 'ENDBLK' && start >= 0) {
      const ranges = entityRanges(doc.pairs, start, i);
      const name = textAt(rawEntityAt(doc.pairs, ranges[0]), 2) ?? '';
      blocks.set(name, ranges.slice(1));
      start = -1;
    }
  }
  return blocks;
}

/** 모델 공간(ENTITIES) 최상위 엔티티들의 쌍 범위. readModelSpace().entities와 순서가 같다. */
export function modelSpaceRanges(doc: DxfDocument): EntityRange[] {
  const section = findSection(doc, 'ENTITIES');
  if (!section) return [];
  return entityRanges(doc.pairs, section.start + 1, section.end);
}
```

그리고 325행의 `function indexOfBand(`를 `export function indexOfBand(`로 바꾼다.

- [ ] **Step 3: 기존 테스트가 그대로 통과하는지 확인한다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — 자르는 규칙이 같으므로 `tableGrid.test.ts`·`frames.test.ts`·`exportDrawing.test.ts`가 전부 그대로 통과한다. 실패하면 `entityRanges`의 `end` 처리를 다시 본다(마지막 범위의 `end`는 `to`여야 한다).

- [ ] **Step 4: 커밋**

```bash
git add server/src/export/tableGrid.ts
git commit -m "$(cat <<'EOF'
refactor: 엔티티를 자를 때 쌍 범위를 함께 내보낸다

readEntities를 entityRanges + rawEntityAt으로 다시 쓰고, 블록별·모델 공간의 범위를
내보낸다. 넘침 장 복사가 원본 쌍을 그대로 베끼려면 값 Map이 아니라 쌍 구간이 필요하다.
자르는 규칙은 그대로라 기존 테스트가 전부 통과한다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: `Frame`에 블록 이름·엔티티 순번·삽입 변환을 더한다**

`server/src/export/frames.ts`를 고친다. 먼저 46~49행의 주석 아래 `function entityPoints`를 내보낸다.

```ts
export function boundsPointsOf(entity: RawEntity): Point[] {
```

`Frame` 인터페이스(28~34행)를 교체한다.

```ts
export interface Frame {
  /** 왼쪽부터 0. 화면·산출이 손상을 배정할 때 쓰는 번호다 */
  index: number;
  bounds: FrameBounds;
  /** 이 틀 안에서 처음 만난 표 */
  table: TableCandidate;
  /** 이 틀을 만든 INSERT가 가리키는 블록 이름 (넘침 장에서 이 블록을 펼친다) */
  blockName: string;
  /** 모델 공간 최상위 엔티티 목록에서 이 틀 INSERT의 순번. 핸들이 겹쳐도 틀리지 않는다 */
  entityIndex: number;
  /** 틀 INSERT의 삽입 변환(블록 좌표 → 모델 좌표) */
  transform: Transform;
}
```

`findFrames`(87~129행)를 교체한다.

```ts
export function findFrames(doc: DxfDocument): Frame[] {
  const model = readModelSpace(doc);
  if (!model) return [];

  const found: Array<Omit<Frame, 'index'>> = [];
  for (let entityIndex = 0; entityIndex < model.entities.length; entityIndex++) {
    const entity = model.entities[entityIndex];
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
    const transform = insertTransform(entity);

    // 최상위 INSERT는 이미 한 단계 내려온 것이므로 depth 1, seen에 자기 블록 이름을 넣고 시작한다.
    walkInserts(model, contents, transform, 1, new Set([name]), (child, childTransform) => {
      if (child.type === 'ACAD_TABLE' && tables.length === 0) {
        const candidate = tableCandidateOf(child, childTransform);
        if (candidate) tables.push(candidate);
      }
      for (const point of boundsPointsOf(child)) {
        const [x, y] = applyTransform(childTransform, point);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    });

    if (tables.length === 0) continue;
    found.push({
      bounds: { minX, minY, maxX, maxY },
      table: tables[0],
      blockName: name,
      entityIndex,
      transform,
    });
  }

  // 왼쪽 → 오른쪽, 같으면 위 → 아래. 이 순서가 인덱스다(설계 2장).
  found.sort((a, b) => a.bounds.minX - b.bounds.minX || b.bounds.maxY - a.bounds.maxY);
  return found.map((frame, index) => ({ ...frame, index }));
}
```

`import type { Transform }`을 `tableGrid.js`에서 함께 가져오도록 상단 import에 `type Transform,`을 더한다.

- [ ] **Step 6: `frames.test.ts`에 새 필드 확인을 더한다**

`server/test/frames.test.ts`의 첫 `it`(26~36행) 안, `expect(frames[0].table.transform)...` 다음에 세 줄을 더한다.

```ts
    expect(frames[0].blockName).toBe('망도틀');
    expect(frames[0].entityIndex).toBe(0); // ENTITIES의 첫 엔티티가 망도틀 INSERT다
    expect(frames[0].transform).toMatchObject({ x: 1000, y: 2000, scaleX: 2, scaleY: 2, rotationRad: 0 });
```

- [ ] **Step 7: 테스트를 돌리고 커밋한다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS

```bash
git add server/src/export/frames.ts server/test/frames.test.ts
git commit -m "$(cat <<'EOF'
feat: Frame에 블록 이름·엔티티 순번·삽입 변환을 더한다

넘침 장에서 틀 블록을 펼치려면 블록 이름과 삽입 변환이 필요하고, 틀 INSERT를 모델 공간
목록에서 다시 찾으려면 순번이 필요하다(핸들은 도면에 따라 겹칠 수 있다). 경계상자용 점
뽑기(boundsPointsOf)도 내보내 영역 판정에서 다시 쓴다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 픽스처 도우미가 틀마다 다른 핸들을 주도록 고친다**

`server/test/fixtureDocs.ts`의 `insertBlockOf`·`withSecondFrame`(21~35행)을 교체한다. 지금은 INSERT 한 벌을 **핸들까지 그대로** 복사해 같은 핸들이 둘 생긴다. 틀이 셋 이상인 도면을 만들 수도 없다(두 번째 호출 때 첫 INSERT 구간에 이미 둘이 들어 있어 넷이 된다).

```ts
// 픽스처의 망도틀 INSERT를 글자 그대로 옮겨 놓은 것. 핸들과 삽입점 x만 바꿔 쓴다.
const FRAME_INSERT = [
  '  0', 'INSERT', '  5', '80', '330', '1F', '100', 'AcDbEntity', '  8', '0',
  '100', 'AcDbBlockReference', '  2', '망도틀', ' 10', '1000.0', ' 20', '2000.0', ' 30', '0.0',
  ' 41', '2.0', ' 42', '2.0', ' 43', '2.0', ' 50', '0.0', '',
].join('\n');

/** 같은 망도틀을 x = insertX에, 주어진 핸들로 한 벌 더 삽입한다. */
export function withFrameAt(text: string, insertX: number, handle: string): string {
  const insert = FRAME_INSERT.replace('\n80\n', `\n${handle}\n`).replace('\n1000.0\n', `\n${insertX.toFixed(1)}\n`);
  // 원본 INSERT 바로 뒤(최상위 LINE 앞)에 넣는다 — 예전 withSecondFrame과 같은 자리다.
  return replaceOnce(text, '  0\nLINE\n  5\n81\n', insert + '  0\nLINE\n  5\n81\n');
}

/** 같은 망도틀을 x = insertX에 한 벌 더 삽입한다(틀 2개짜리 도면). */
export function withSecondFrame(text: string, insertX: number): string {
  return withFrameAt(text, insertX, '8A');
}
```

- [ ] **Step 9: 기존 테스트가 통과하는지 확인한다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — `frames.test.ts`·`exportDrawing.test.ts`의 `withSecondFrame` 테스트는 틀 위치만 보고 핸들은 보지 않으므로 그대로다.

- [ ] **Step 10: `sheetCopy.ts`의 장 수·간격 테스트를 쓴다**

`server/test/sheetCopy.test.ts`를 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import { isFlattenable, pageOf, pagesOf, pitchOf, shiftGrid } from '../src/export/sheetCopy.js';
import { buildGrid, cellCenter } from '../src/export/tableGrid.js';
import { templateText, withSecondFrame } from './fixtureDocs.js';

// 픽스처 실측값(frames.test.ts와 같은 계산):
//   틀 0 영역 x 2000~4280 (너비 2280), y 3160~3400. 틀 INSERT (1000, 2000) 배율 2.
//   표: *TX, 삽입점(블록 좌표) (500, 700), 열 경계 0/100/250/550/670/790/890/1030/1140,
//       행 경계 0/−40/−60/−80/−100/−120, 데이터 1행 = 행 인덱스 2, 데이터 행 수 3, 글자 높이 10.
// withSecondFrame(t, 50000) → 틀 1 영역 x 51000~53280. 간격(pitch) = 51000 − 2000 = 49000.

async function framesOf(text: string) {
  return findFrames(parseDxf(text));
}

describe('pageOf · pagesOf · pitchOf', () => {
  it('번호를 장에 나눈다 — 장 p는 번호 p·N+1 … (p+1)·N', () => {
    expect(pageOf(1, 35)).toBe(0);
    expect(pageOf(35, 35)).toBe(0);
    expect(pageOf(36, 35)).toBe(1); // 36 → (36−1)/35 = 1
    expect(pageOf(70, 35)).toBe(1);
    expect(pageOf(71, 35)).toBe(2);
  });

  it('최대 번호로 장 수를 센다', () => {
    expect(pagesOf(0, 35)).toBe(1);
    expect(pagesOf(35, 35)).toBe(1);
    expect(pagesOf(36, 35)).toBe(2); // ceil(36/35) = 2
    expect(pagesOf(71, 35)).toBe(3); // ceil(71/35) = 3
  });

  it('간격은 다음 틀 기준, 마지막 틀은 앞 쌍, 틀 하나면 너비 × 1.1', async () => {
    const two = await framesOf(withSecondFrame(await templateText(), 50000));
    expect(pitchOf(two, 0)).toBeCloseTo(49000, 6); // 51000 − 2000
    expect(pitchOf(two, 1)).toBeCloseTo(49000, 6); // 마지막 틀 → 앞 쌍의 간격

    const one = await framesOf(await templateText());
    expect(pitchOf(one, 0)).toBeCloseTo(2508, 6); // 너비 2280 × 1.1
  });

  it('회전·비균일 배율·뒤집힌 배율은 펼치지 않는다', () => {
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 })).toBe(true);
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 3, rotationRad: 0 })).toBe(false);
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0.1 })).toBe(false);
    expect(isFlattenable({ x: 0, y: 0, scaleX: -2, scaleY: -2, rotationRad: 0 })).toBe(false);
  });

  it('shiftGrid는 x만 옮기고 이동량이 0이면 같은 격자를 돌려준다', async () => {
    const doc = parseDxf(await templateText());
    const grid = buildGrid(doc, (await framesOf(await templateText()))[0].table)!;
    expect(shiftGrid(grid, 0)).toBe(grid);
    const moved = shiftGrid(grid, 49000);
    // 데이터 1행 번호 칸 중앙: 1000 + 2*(500+50) = 2100 → +49000 = 51100
    expect(cellCenter(moved, 1, 0)[0]).toBeCloseTo(51100, 6);
    expect(cellCenter(moved, 1, 0)[1]).toBeCloseTo(3260, 6); // 2000 + 2*(700−70)
  });
});
```

- [ ] **Step 11: 실패를 확인한다**

Run: `npm --prefix server test -- sheetCopy`
Expected: FAIL — `Failed to resolve import "../src/export/sheetCopy.js"`

- [ ] **Step 12: `sheetCopy.ts`의 앞부분(계산·문맥)을 구현한다**

`server/src/export/sheetCopy.ts`를 만든다.

```ts
// 한 망도틀을 통째로 오른쪽에 복사하기 위한 도구들.
// 어떤 최상위 엔티티가 어느 틀 영역인지 가르고, 틀 블록을 펼쳐 모델 공간 엔티티로 만들고,
// 장 수와 틀 간격을 센다. 손상은 모른다 — 손상을 붙이는 일은 exportDrawing.ts가 한다.
// 근거: docs/superpowers/specs/2026-09-16-sheet-overflow-design.md 3~6장

import { type DxfDocument, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { textEntity, type EntityBase, type Point } from './dxfEntities.js';
import {
  copyEntityPairs,
  entityBoundsOf,
  isCopyable,
  transformEntityPairs,
  translateEntityPairs,
  type EntityBounds,
} from './entityTransform.js';
import { boundsPointsOf, type Frame } from './frames.js';
import {
  applyTransform,
  blockEntityRanges,
  cellCenter,
  composeTransform,
  hasUniformScale,
  indexOfBand,
  insertTransform,
  modelSpaceRanges,
  modelTextHeight,
  numberAt,
  rawEntityAt,
  readModelSpace,
  textAt,
  walkInserts,
  type EntityRange,
  type ModelSpace,
  type RawEntity,
  type TableGrid,
  type Transform,
} from './tableGrid.js';

/** 틀이 하나뿐일 때 쓰는 간격 = 틀 너비의 배수(설계 4장) */
const LONE_FRAME_PITCH_FACTOR = 1.1;
/** 색이 적혀 있지 않은 엔티티의 기본 색(ByLayer) */
const BY_LAYER = 256;

/** 번호가 몇 번째 장에 들어가는가. 0장이 원본 틀이다. */
export function pageOf(damageNumber: number, dataRows: number): number {
  if (dataRows <= 0) return 0;
  return Math.max(0, Math.floor((damageNumber - 1) / dataRows));
}

/** 최대 번호가 maxNumber일 때 필요한 장 수. 손상이 없어도 원본 한 장은 있다. */
export function pagesOf(maxNumber: number, dataRows: number): number {
  if (dataRows <= 0 || maxNumber <= 0) return 1;
  return Math.max(1, Math.ceil(maxNumber / dataRows));
}

/**
 * 틀 k의 간격. 다음 틀이 있으면 그 틀과의 minX 차이, 마지막 틀이면 바로 앞 쌍의 간격,
 * 틀이 하나뿐이면 틀 너비 × 1.1이다(설계 4장). 실제 도면의 간격은 균일하지 않으므로
 * 상수 하나로 두지 않는다(조사 1장: 74,943~76,617).
 */
export function pitchOf(frames: Frame[], index: number): number {
  const here = frames[index];
  if (!here) return 0;
  const next = frames[index + 1];
  if (next) return next.bounds.minX - here.bounds.minX;
  const previous = frames[index - 1];
  if (previous) return here.bounds.minX - previous.bounds.minX;
  return (here.bounds.maxX - here.bounds.minX) * LONE_FRAME_PITCH_FACTOR;
}

/**
 * 이 틀 블록을 펼칠 수 있는가. 배율이 가로·세로 같고 양수이며 회전이 0이어야 한다
 * (설계 5.2). 실제 사내 템플릿은 배율 1.2685 균일·회전 0이다.
 */
export function isFlattenable(t: Transform): boolean {
  return hasUniformScale(t) && t.scaleX > 0 && t.rotationRad === 0;
}

/** 표 격자를 x로 dx만큼 옮긴 사본. 이동량이 0이면 원래 격자를 그대로 돌려준다. */
export function shiftGrid(grid: TableGrid, dx: number): TableGrid {
  if (dx === 0) return grid;
  return { ...grid, transform: { ...grid.transform, x: grid.transform.x + dx } };
}

/** 한 번 읽어 두고 여러 장에서 다시 쓰는 문서 색인 */
export interface SheetContext {
  doc: DxfDocument;
  model: ModelSpace;
  /** 모델 공간 최상위 엔티티의 쌍 범위. model.entities와 순서가 같다 */
  ranges: EntityRange[];
  /** 블록 이름 → 그 안 엔티티의 쌍 범위 */
  blocks: Map<string, EntityRange[]>;
  alloc: HandleAllocator;
  /** 새 엔티티의 소유자 = 모델 공간 블록 레코드 핸들 */
  owner: string;
}

export function readSheetContext(doc: DxfDocument, alloc: HandleAllocator, owner: string): SheetContext | null {
  const model = readModelSpace(doc);
  if (!model) return null;
  return { doc, model, ranges: modelSpaceRanges(doc), blocks: blockEntityRanges(doc), alloc, owner };
}
```

- [ ] **Step 13: 테스트를 돌려 앞부분 통과를 확인한다**

Run: `npm --prefix server test -- sheetCopy && npm --prefix server run typecheck`
Expected: PASS (5개). **아직 없는 이름을 import하면 모듈 전체가 로드에 실패하므로, import 목록은 Task마다 실제로 만든 것만 담는다** — 아래 Step에서 하나씩 늘린다.

- [ ] **Step 14: 영역 판정 테스트를 쓴다**

`sheetCopy.test.ts`의 import 두 줄을 늘린다.

```ts
import { createHandleAllocator, parseDxf, recordHandle } from '../src/export/dxfDocument.js';
import { indexRegions, isFlattenable, pageOf, pagesOf, pitchOf, readSheetContext, shiftGrid } from '../src/export/sheetCopy.js';
```

그리고 파일 끝에 이어 붙인다.

```ts
describe('indexRegions', () => {
  async function contextOf(text: string) {
    const doc = parseDxf(text);
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const owner = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!;
    const ctx = readSheetContext(doc, alloc, owner)!;
    return { doc, frames, ctx };
  }

  it('틀 INSERT는 영역에서 빼고 따로 들고 있는다', async () => {
    const { frames, ctx } = await contextOf(await templateText());
    const regions = indexRegions(ctx, frames);
    expect(regions.frameInsert[0]).not.toBeNull();
    expect(regions.frameInsert[0]!.type).toBe('INSERT');
    expect(regions.inFrame[0]).toEqual([]);
  });

  it('틀 영역 밖 최상위 엔티티는 loose로, 중심 x와 함께 들어간다', async () => {
    const { frames, ctx } = await contextOf(await templateText());
    const regions = indexRegions(ctx, frames);
    // 픽스처의 최상위 LINE은 (0,0)-(10,10) → 중심 (5, 5), 틀 영역(x 2000~4280) 밖이다.
    expect(regions.loose).toHaveLength(1);
    expect(regions.loose[0].range.type).toBe('LINE');
    expect(regions.loose[0].centerX).toBeCloseTo(5, 6);
  });

  it('경계상자 중심이 틀 안이면 그 틀 영역이다', async () => {
    // 틀 영역(x 2000~4280, y 3160~3400) 안에 최상위 LINE을 하나 더 넣는다.
    // (2100, 3200)-(2300, 3300) → 중심 (2200, 3250)
    const extra = [
      '  0', 'LINE', '  5', '90', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
      ' 10', '2100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '2300.0', ' 21', '3300.0', ' 31', '0.0', '',
    ].join('\n');
    const text = (await templateText()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
    const { frames, ctx } = await contextOf(text);
    const regions = indexRegions(ctx, frames);
    expect(regions.inFrame[0]).toHaveLength(1);
    expect(regions.inFrame[0][0].type).toBe('LINE');
  });
});
```

- [ ] **Step 15: 영역 판정을 구현한다**

`sheetCopy.ts`에 이어 붙인다.

```ts
export interface RegionIndex {
  /** 틀 인덱스별, 그 틀 영역에 속하는 최상위 엔티티(틀 INSERT는 뺀다) */
  inFrame: EntityRange[][];
  /** 틀 인덱스별 틀 INSERT 자신 */
  frameInsert: Array<EntityRange | null>;
  /** 어느 틀에도 속하지 않는 최상위 엔티티와 그 경계상자 중심 x */
  loose: Array<{ range: EntityRange; centerX: number }>;
}

function inside(bounds: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/**
 * 최상위 엔티티의 경계상자. INSERT는 삽입점이 '블록 좌표에 더하는 벡터'라 그대로 쓰면 안 된다
 * (조사 2장 주의) — 블록 안 도형을 삽입 변환으로 옮겨 감싼다. findFrames와 같은 방식이다.
 */
function resolvedBounds(model: ModelSpace, entity: RawEntity, pairs: DxfPair[]): EntityBounds | null {
  if (entity.type !== 'INSERT') return entityBoundsOf(pairs);
  const name = textAt(entity, 2);
  const contents = name ? model.blocks.get(name) : undefined;
  if (!name || !contents) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walkInserts(model, contents, insertTransform(entity), 1, new Set([name]), (child, transform) => {
    for (const point of boundsPointsOf(child)) {
      const [x, y] = applyTransform(transform, point);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * 최상위 엔티티를 한 번만 훑어 틀별로 가른다. 소속 판정은 손상 배정과 같은 규칙이다 —
 * 경계상자 **중심**이 틀 영역 안(경계 포함)이면 그 틀, 여러 틀에 들면 인덱스가 작은 틀(설계 5.1).
 */
export function indexRegions(ctx: SheetContext, frames: Frame[]): RegionIndex {
  const inFrame: EntityRange[][] = frames.map(() => []);
  const frameInsert: Array<EntityRange | null> = frames.map(() => null);
  const loose: Array<{ range: EntityRange; centerX: number }> = [];
  const frameAtEntity = new Map<number, number>();
  for (const frame of frames) frameAtEntity.set(frame.entityIndex, frame.index);

  for (let i = 0; i < ctx.ranges.length; i++) {
    const range = ctx.ranges[i];
    const asFrame = frameAtEntity.get(i);
    if (asFrame !== undefined) {
      frameInsert[asFrame] = range;
      continue;
    }
    const entity = ctx.model.entities[i] ?? rawEntityAt(ctx.doc.pairs, range);
    const bounds = resolvedBounds(ctx.model, entity, ctx.doc.pairs.slice(range.start, range.end));
    if (!bounds) continue; // 점이 없는 엔티티는 옮길 것도 복사할 것도 없다
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const frame = frames.find((f) => inside(f.bounds, centerX, centerY));
    if (frame) inFrame[frame.index].push(range);
    else loose.push({ range, centerX });
  }
  return { inFrame, frameInsert, loose };
}
```

- [ ] **Step 16: 테스트를 돌린다**

Run: `npm --prefix server test -- sheetCopy && npm --prefix server run typecheck`
Expected: PASS (`indexRegions` 3개 포함)

- [ ] **Step 17: 커밋**

```bash
git add server/src/export/sheetCopy.ts server/test/sheetCopy.test.ts server/test/fixtureDocs.ts
git commit -m "$(cat <<'EOF'
feat: 장 수·틀 간격 계산과 틀 영역 판정을 만든다

번호를 장에 나누고(pageOf·pagesOf), 틀 간격을 실제 틀 위치에서 구하고(pitchOf), 최상위
엔티티를 한 번만 훑어 틀별로 가른다(indexRegions). INSERT는 삽입점이 아니라 블록을 펼친
경계상자로 판정한다. 픽스처 도우미가 틀마다 다른 핸들을 주도록 고쳤다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 18: 복사·펼치기 테스트를 쓴다**

`sheetCopy.test.ts`에 이어 붙인다.

```ts
describe('copyRegion · flattenFrameBlock', () => {
  async function setup(text: string) {
    const doc = parseDxf(text);
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const owner = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!;
    const ctx = readSheetContext(doc, alloc, owner)!;
    const grid = buildGrid(doc, frames[0].table)!;
    return { doc, frames, ctx, grid, owner };
  }

  // 펼친 쌍 배열에서 (0, 타입) 단위로 갈라 값·좌표를 꺼내 준다.
  function entitiesOf(pairs: ReturnType<typeof flattenFrameBlock>['pairs']) {
    const out: Array<{ type: string; text: string; x: number; y: number; handle: string; owner: string }> = [];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].code !== 0) continue;
      const entry = { type: pairs[i].value, text: '', x: NaN, y: NaN, handle: '', owner: '' };
      let j = i + 1;
      for (; j < pairs.length && pairs[j].code !== 0; j++) {
        const p = pairs[j];
        if (p.code === 5 && entry.handle === '') entry.handle = p.value;
        else if (p.code === 330 && entry.owner === '') entry.owner = p.value;
        else if (p.code === 1) entry.text = p.value;
        else if (p.code === 10 && Number.isNaN(entry.x)) entry.x = Number(p.value);
        else if (p.code === 20 && Number.isNaN(entry.y)) entry.y = Number(p.value);
      }
      out.push(entry);
      i = j - 1;
    }
    return out;
  }

  it('영역 엔티티를 새 핸들·같은 소유자로 베껴 x만큼 옮긴다', async () => {
    // 틀 영역 안에 최상위 LINE (2100,3200)-(2300,3300)을 하나 넣는다.
    const extra = [
      '  0', 'LINE', '  5', '90', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
      ' 10', '2100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '2300.0', ' 21', '3300.0', ' 31', '0.0', '',
    ].join('\n');
    const text = (await templateText()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
    const { ctx, frames, owner } = await setup(text);
    const regions = indexRegions(ctx, frames);
    const result = copyRegion(ctx, regions.inFrame[0], 49000);
    expect(result.skipped).toBe(0);
    const [line] = entitiesOf(result.pairs);
    expect(line.type).toBe('LINE');
    expect(line.x).toBeCloseTo(51100, 6); // 2100 + 49000
    expect(line.handle).not.toBe('90');
    expect(line.owner).toBe(owner);
  });

  it('틀 블록을 펼치면 표 블록의 글자·선이 모델 좌표로 들어온다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    const result = flattenFrameBlock(ctx, frames[0], grid, 1, 49000);
    const entities = entitiesOf(result.pairs);
    // 표 블록 → 모델 변환: 틀 변환(x 1000 + 49000 = 50000, 배율 2) ∘ 표 삽입점 (500, 700)
    //   → x = 50000 + 2*500 = 51000, y = 2000 + 2*700 = 3400
    // '손상물량표' MTEXT는 블록 좌표 (570, -20) → (51000 + 2*570, 3400 + 2*(-20)) = (52140, 3360)
    const title = entities.find((e) => e.text.includes('손상물량'))!;
    expect(title.x).toBeCloseTo(52140, 6);
    expect(title.y).toBeCloseTo(3360, 6);
    // ACAD_TABLE 엔티티 자체는 넣지 않는다
    expect(entities.some((e) => e.type === 'ACAD_TABLE')).toBe(false);
  });

  it('번호 열 데이터 행 글자는 빼고 그 장의 번호를 새로 쓴다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    // 데이터 행 3개짜리 픽스처에서 1장(page = 1)이면 번호는 1*3+1 … 1*3+3 = 4, 5, 6이다.
    const result = flattenFrameBlock(ctx, frames[0], grid, 1, 49000);
    const numbers = entitiesOf(result.pairs).filter((e) => /^[0-9]+$/.test(e.text));
    expect(numbers.map((e) => e.text)).toEqual(['4', '5', '6']);
    // 인쇄돼 있던 1·2·3은 사라졌다
    expect(numbers.some((e) => ['1', '2', '3'].includes(e.text))).toBe(false);
    // 번호 칸 중앙 x = 1000 + 2*(500+50) = 2100 → +49000 = 51100
    // 데이터 1·2·3행 중앙 y = 2000 + 2*(700−70) = 3260, 3220, 3180
    expect(numbers.map((e) => e.x)).toEqual([51100, 51100, 51100]);
    expect(numbers.map((e) => e.y)).toEqual([3260, 3220, 3180]);
  });

  it('머리글 글자(번호·손상위치…)는 그대로 남는다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    const entities = entitiesOf(flattenFrameBlock(ctx, frames[0], grid, 1, 49000).pairs);
    // '번호' 머리글은 블록 좌표 (50, −50) → x = 51000 + 2*50 = 51100, y = 3400 + 2*(−50) = 3300
    const header = entities.find((e) => e.text.includes('번'))!;
    expect(header.x).toBeCloseTo(51100, 6);
    expect(header.y).toBeCloseTo(3300, 6);
  });
});
```

테스트 상단 import에 `copyRegion`과 `flattenFrameBlock`을 더한다.

```ts
import {
  copyRegion,
  flattenFrameBlock,
  indexRegions,
  isFlattenable,
  pageOf,
  pagesOf,
  pitchOf,
  readSheetContext,
  shiftGrid,
} from '../src/export/sheetCopy.js';
```

- [ ] **Step 19: 실패를 확인한다**

Run: `npm --prefix server test -- sheetCopy`
Expected: FAIL — `copyRegion is not a function`

- [ ] **Step 20: 복사와 펼치기를 구현한다**

`sheetCopy.ts`에 이어 붙인다.

```ts
export interface CopyResult {
  pairs: DxfPair[];
  /** 복사하지 못하고 뺀 엔티티 수(치수·지시선 등) */
  skipped: number;
}

// 인자 전개(push(...source))는 배열이 아주 클 때 호출 스택을 넘긴다(exportDrawing.ts의 주석 참고).
function appendAll(target: DxfPair[], source: DxfPair[]): void {
  for (const p of source) target.push(p);
}

/** 최상위 엔티티 여러 개를 새 핸들로 베껴 x로 dx만큼 옮긴다(설계 5.1). */
export function copyRegion(ctx: SheetContext, ranges: EntityRange[], dx: number): CopyResult {
  const pairs: DxfPair[] = [];
  let skipped = 0;
  for (const range of ranges) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    appendAll(pairs, translateEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), dx, 0));
  }
  return { pairs, skipped };
}

function baseFor(ctx: SheetContext, layer: string, colorIndex: number): EntityBase {
  return { handle: ctx.alloc.next(), owner: ctx.owner, layer, colorIndex };
}

// 이 글자가 번호 열의 **데이터 행** 칸에 있는가(= 미리 인쇄된 번호인가).
function isPrintedNumber(grid: TableGrid, entity: RawEntity): boolean {
  const local: Point = [numberAt(entity, 10, 0), numberAt(entity, 20, 0)];
  if (indexOfBand(grid.colBoundaries, local[0]) !== grid.numberColumn) return false;
  const row = indexOfBand(grid.rowBoundaries, local[1]);
  return row >= grid.firstDataRow;
}

/**
 * 표가 가리키는 `*T` 블록을 펼쳐 넣는다. `ACAD_TABLE` 엔티티 자체는 넣지 않는다 —
 * 한 번 더 INSERT하면 번호 열에 1~N이 그대로 인쇄되기 때문이다(설계 5.2).
 * 이 틀의 표(`grid`)일 때만 번호 열 데이터 행 글자를 빼고 `page·N+1 … page·N+N`을 새로 쓴다.
 */
function flattenTable(
  ctx: SheetContext,
  tablePairs: DxfPair[],
  frameTransform: Transform,
  grid: TableGrid,
  page: number,
  dx: number,
): CopyResult {
  const table = rawEntityAt(tablePairs, { type: 'ACAD_TABLE', start: 0, end: tablePairs.length });
  const blockName = textAt(table, 2);
  const position: Point = [numberAt(table, 10, 0), numberAt(table, 20, 0)];
  const pairs: DxfPair[] = [];
  let skipped = 0;
  if (!blockName) return { pairs, skipped };

  // 표 블록 좌표 → 모델 좌표 = 틀 삽입 변환 ∘ 표 삽입점(배율 1, 회전 0)
  const tableTransform = composeTransform(frameTransform, {
    x: position[0],
    y: position[1],
    scaleX: 1,
    scaleY: 1,
    rotationRad: 0,
  });
  const isFrameTable =
    blockName === grid.blockName && position[0] === grid.position[0] && position[1] === grid.position[1];

  let numberLayer: string | null = null;
  let numberColor = BY_LAYER;
  for (const range of ctx.blocks.get(blockName) ?? []) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (isFrameTable && (range.type === 'TEXT' || range.type === 'MTEXT')) {
      const entity = rawEntityAt(ctx.doc.pairs, range);
      if (isPrintedNumber(grid, entity)) {
        // 새 번호가 원본 번호와 같은 레이어·색으로 나가게 첫 번째 것에서 읽어 둔다.
        if (numberLayer === null) {
          numberLayer = textAt(entity, 8) ?? '0';
          numberColor = numberAt(entity, 62, BY_LAYER);
        }
        continue;
      }
    }
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    appendAll(pairs, transformEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), tableTransform));
  }

  if (isFrameTable) {
    const shifted = shiftGrid(grid, dx);
    const height = modelTextHeight(grid);
    const layer = numberLayer ?? '0';
    // 빈 행이라도 번호는 쓴다 — 원본이 1~N을 미리 인쇄한 것과 같다(설계 5.2).
    for (let row = 1; row <= grid.dataRowCount; row++) {
      const value = String(page * grid.dataRowCount + row);
      const center = cellCenter(shifted, row, grid.numberColumn);
      appendAll(pairs, textEntity(baseFor(ctx, layer, numberColor), center, height, value, 'center'));
    }
  }
  return { pairs, skipped };
}

/**
 * 틀 블록을 펼쳐 모델 공간 엔티티로 만든다. 블록을 한 번 더 INSERT하지 않는 이유는
 * 표의 번호 열을 바꿔야 하기 때문이다(설계 5.2).
 *
 * @param page 0이 원본 장, 1부터가 복사본
 * @param dx   이 장이 원본 틀에서 x로 얼마나 떨어져 있는가
 */
export function flattenFrameBlock(
  ctx: SheetContext,
  frame: Frame,
  grid: TableGrid,
  page: number,
  dx: number,
): CopyResult {
  const frameTransform: Transform = { ...frame.transform, x: frame.transform.x + dx };
  const pairs: DxfPair[] = [];
  let skipped = 0;

  for (const range of ctx.blocks.get(frame.blockName) ?? []) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (range.type === 'ACAD_TABLE') {
      const table = flattenTable(ctx, source, frameTransform, grid, page, dx);
      appendAll(pairs, table.pairs);
      skipped += table.skipped;
      continue;
    }
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    // 중첩 INSERT도 여기로 온다 — transformEntityPairs가 삽입점을 옮기고 배율을 곱하고
    // 회전을 더하므로 블록 정의는 그대로 공유된다(설계 5.2).
    appendAll(pairs, transformEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), frameTransform));
  }
  return { pairs, skipped };
}

/** 원본 엔티티를 제자리에서 옮긴다(복사가 아니다 — 핸들·참조는 그대로다, 설계 6장). */
export function shiftRangesInPlace(doc: DxfDocument, ranges: EntityRange[], dx: number): void {
  if (dx === 0) return;
  for (const range of ranges) {
    const source = doc.pairs.slice(range.start, range.end);
    const moved = translateEntityPairs(source, dx, 0);
    if (moved === source) continue;
    for (let i = 0; i < moved.length; i++) doc.pairs[range.start + i] = moved[i];
  }
}
```

- [ ] **Step 21: 테스트를 돌린다**

Run: `npm --prefix server test -- sheetCopy && npm --prefix server run typecheck`
Expected: PASS

- [ ] **Step 22: 제자리 옮기기 테스트를 더하고 커밋한다**

`sheetCopy.test.ts`에 더한다.

```ts
describe('shiftRangesInPlace', () => {
  it('원본 쌍을 제자리에서 고치고 핸들은 그대로 둔다', async () => {
    const doc = parseDxf(await templateText());
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const ctx = readSheetContext(doc, alloc, recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!)!;
    const insert = indexRegions(ctx, frames).frameInsert[0]!;

    shiftRangesInPlace(doc, [insert], 49000);
    const moved = findFrames(doc);
    // 삽입점 1000 + 49000 = 50000 → 영역 x 50000 + 2*500 = 51000 ~ 50000 + 2*1640 = 53280
    expect(moved[0].bounds.minX).toBeCloseTo(51000, 6);
    expect(moved[0].bounds.maxX).toBeCloseTo(53280, 6);
    // 핸들은 그대로다
    expect(doc.pairs[insert.start + 1].value).toBe('80');
    // y는 값이 그대로라 쌍 객체도 원본이다(바이트 보존)
    expect(doc.pairs.filter((p) => p.code === 20)[0].rawCode).toBe(' 20');
  });
});
```

`shiftRangesInPlace`를 `sheetCopy.js` import 목록에 더한다(알파벳 순서상 `shiftGrid` 다음).

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS (전체)

```bash
git add server/src/export/sheetCopy.ts server/test/sheetCopy.test.ts
git commit -m "$(cat <<'EOF'
feat: 틀 영역 복사와 틀 블록 펼치기를 만든다

영역 엔티티는 새 핸들로 베껴 옮기고, 틀 블록은 펼쳐 모델 공간 엔티티로 넣는다. 표는
ACAD_TABLE 대신 *T 블록의 내용을 옮기되 번호 열 데이터 행 글자를 빼고 그 장의 번호를
칸 중앙에 새로 쓴다. 원본을 제자리에서 미는 함수도 함께 만든다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 픽스처 틀 하나를 오른쪽 49000만큼 떨어진 자리에 "번호 4~6짜리 표가 달린 똑같은 틀"로 펼쳐 낼 수 있고, 원본 틀을 제자리에서 밀 수 있다.

---

## Task 3: 산출에 넘침 장 복사를 붙인다 (`exportDrawing.ts`)

여기서는 **복사본을 만드는 것까지만** 한다. 오른쪽 틀을 미는 일은 Task 4다. 그래서 이 Task의 테스트는 **맨 오른쪽 틀이 넘치는 도면**을 쓴다 — 밀 것이 없어 결과가 완결된다.

**Files:**
- Modify: `server/src/export/exportDrawing.ts:40-49, 122-141, 191-227`
- Modify: `server/test/exportDrawing.test.ts:347-463`(그 describe 뒤에 새 describe 추가)

**Interfaces:**
- Consumes: Task 1의 `translatePairs(pairs, dx, dy)`; Task 2의 `pageOf`, `pagesOf`, `pitchOf`, `isFlattenable`, `shiftGrid`, `readSheetContext`, `indexRegions`, `copyRegion`, `flattenFrameBlock`, `SheetContext`, `RegionIndex`
- Produces:
  - `EXPORT_WARNINGS.sheetCopied(index: number, pages: number): string`
  - `EXPORT_WARNINGS.sheetCopySkipped(count: number): string`
  - `EXPORT_WARNINGS.sheetCopyUnsupported(index: number): string`
  - (`exportDamagesToDxf`의 시그니처·반환 타입은 그대로다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/exportDrawing.test.ts`의 `describe('망도틀별 번호와 표')`가 끝나는 곳(462행 `});` 다음, 파일 마지막 `});` 앞)에 새 describe를 더한다.

```ts
  // 근거: docs/superpowers/specs/2026-09-16-sheet-overflow-design.md 3~5장
  describe('망도틀 넘침 — 틀을 통째로 복사한다', () => {
    // 픽스처의 데이터 행 수는 3이다(tableGrid.test.ts 실측). 4개를 넣으면 2장이 된다.
    // 틀 0: x 2000~4280, 틀 1: x 51000~53280 → 간격 49000.
    async function twoFrames(): Promise<string> {
      return withSecondFrame(await template(), 50000);
    }

    // 틀 1 안쪽(x 51000~53280, y 3160~3400)에 n번째 사각형을 그린 손상
    function rightDamage(n: number) {
      const x = 51100 + n * 100;
      const dwg: Pt[] = [[x, 3200], [x + 50, 3200], [x + 50, 3300], [x, 3300]];
      return damage(`r${n}`, 'spalling', n * 10, dwg, { width: 1.2, length: 1.5, count: 2 });
    }

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

    it('데이터 행 수를 넘으면 그 틀을 오른쪽에 한 장 더 만든다', async () => {
      const damages = [1, 2, 3, 4].map(rightDamage);
      const result = exportDamagesToDxf(await twoFrames(), damages);
      expect(result.warnings).toEqual([EXPORT_WARNINGS.sheetCopied(1, 2)]);

      const all = texts(result.dxfText);
      // 복사본 표의 번호 칸: 틀 1 삽입점 50000 + 간격 49000 = 99000
      //   → 표 원점 x = 99000 + 2*500 = 100000, 번호 칸 중앙 = 100000 + 2*50 = 100100
      //   데이터 1행 중앙 y = 2000 + 2*(700−70) = 3260
      const four = all.filter((t) => t.value === '4');
      expect(four).toHaveLength(1);
      expect(four[0].x).toBeCloseTo(100100, 6);
      expect(four[0].y).toBeCloseTo(3260, 6);
      // 5·6도 함께 인쇄된다(빈 행이라도 번호는 쓴다)
      expect(all.filter((t) => t.value === '5')).toHaveLength(1);
      expect(all.filter((t) => t.value === '6')).toHaveLength(1);
    });

    it('4번 손상의 도형·라벨이 복사본 자리로 옮겨 그려진다', async () => {
      const damages = [1, 2, 3, 4].map(rightDamage);
      const result = exportDamagesToDxf(await twoFrames(), damages);
      const doc = parseDxf(result.dxfText);
      // LWPOLYLINE의 첫 10 좌표를 모아 본다. 4번(x 51500)만 +49000 = 100500이다.
      const xs: number[] = [];
      for (let i = 0; i < doc.pairs.length; i++) {
        if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'LWPOLYLINE') continue;
        const x = doc.pairs.slice(i, i + 30).find((p) => p.code === 10)!.value;
        xs.push(Number(x));
      }
      expect(xs).toContain(51200); // 1번은 제자리(51100 + 1*100)
      expect(xs).toContain(100500); // 4번은 51500 + 49000
      expect(xs).not.toContain(51500);
    });

    it('복사본 표에는 그 장의 손상만 들어간다', async () => {
      const damages = [1, 2, 3, 4].map(rightDamage);
      const result = exportDamagesToDxf(await twoFrames(), damages);
      // 단위 칸('㎡')은 라벨에 없는 값이라 표 칸만 가리킨다.
      // 원본 장: 7열 중앙 = 50000 + 2*(500+1085) = 53170, 복사본: +49000 = 102170
      const units = texts(result.dxfText).filter((t) => t.value === '㎡').map((t) => t.x).sort((a, b) => a - b);
      expect(units).toHaveLength(4);
      expect(units.slice(0, 3)).toEqual([53170, 53170, 53170]);
      expect(units[3]).toBeCloseTo(102170, 6);
    });

    it('복사본에는 그 틀 영역의 최상위 도형도 함께 온다', async () => {
      // 틀 1 영역 안에 최상위 LINE (51100,3200)-(51300,3300)을 넣는다 → 중심 (51200, 3250)
      const extra = [
        '  0', 'LINE', '  5', '91', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
        ' 10', '51100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '51300.0', ' 21', '3300.0', ' 31', '0.0', '',
      ].join('\n');
      const text = (await twoFrames()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
      const before = entityCount(text, 'LINE');
      const result = exportDamagesToDxf(text, [1, 2, 3, 4].map(rightDamage));
      // 원본 LINE은 그대로 있고 복사본이 하나 늘어난다(표 격자 선은 *TX 블록 안이라 따로다)
      const doc = parseDxf(result.dxfText);
      const xs = doc.pairs
        .map((p, i) => (p.code === 0 && p.value === 'LINE' ? i : -1))
        .filter((i) => i >= 0)
        .map((i) => Number(doc.pairs.slice(i, i + 20).find((p) => p.code === 10)!.value));
      expect(xs).toContain(51100); // 원본
      expect(xs).toContain(100100); // 복사본 51100 + 49000
      expect(entityCount(result.dxfText, 'LINE')).toBeGreaterThan(before);
    });

    it('넘치지 않으면 경고도 복사본도 없다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [1, 2, 3].map(rightDamage));
      expect(result.warnings).toEqual([]);
      expect(texts(result.dxfText).some((t) => t.value === '4')).toBe(false);
    });

    it('경고 문구에 틀 번호와 장 수가 들어간다', () => {
      expect(EXPORT_WARNINGS.sheetCopied(1, 2)).toBe(
        '망도틀 2을(를) 2장으로 나눴습니다 (복사본 1장, 뒤 틀 이동)',
      );
      expect(EXPORT_WARNINGS.sheetCopySkipped(3)).toBe(
        '복사할 수 없는 엔티티 3개(치수·지시선 등)는 복사본에서 빠졌습니다',
      );
      expect(EXPORT_WARNINGS.sheetCopyUnsupported(0)).toBe(
        '망도틀 1은(는) 회전·비균일 배율이라 복사하지 못해 표를 아래에 그렸습니다',
      );
    });

    it('회전한 틀은 복사하지 않고 옛 넘침(표를 아래에)으로 간다', async () => {
      // 90도 회전한 틀 하나짜리 도면. 영역은 x −400~−160, y 3000~5280(frames.test.ts 실측).
      const text = rotatedFrame(await template(), 90);
      const inRotated: Pt[] = [[-350, 4000], [-250, 4000], [-250, 4100], [-350, 4100]];
      const damages = [1, 2, 3, 4].map((n) =>
        damage(`x${n}`, 'spalling', n * 10, inRotated.map(([x, y]) => [x, y + n]) as Pt[], {
          width: 1.2, length: 1.5, count: 2,
        }),
      );
      const result = exportDamagesToDxf(text, damages);
      expect(result.warnings).toContain(EXPORT_WARNINGS.sheetCopyUnsupported(0));
      expect(result.warnings).not.toContain(EXPORT_WARNINGS.sheetCopied(0, 2));
    });
  });
```

테스트 상단 import에 `rotatedFrame`을 더한다: `import { flatTable, rotatedFrame, withSecondFrame } from './fixtureDocs.js';`

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- exportDrawing`
Expected: FAIL — `EXPORT_WARNINGS.sheetCopied is not a function`

- [ ] **Step 3: 경고를 더한다**

`server/src/export/exportDrawing.ts`의 `EXPORT_WARNINGS`(40~49행) 안, `outsideFrames` 다음에 세 항목을 더한다.

```ts
  // 넘침 장(설계 7장). 셋 다 정보성이지만 사용자가 알아야 캐드에서 무엇을 볼지 안다.
  sheetCopied: (index: number, pages: number) =>
    `망도틀 ${index + 1}을(를) ${pages}장으로 나눴습니다 (복사본 ${pages - 1}장, 뒤 틀 이동)`,
  sheetCopySkipped: (count: number) =>
    `복사할 수 없는 엔티티 ${count}개(치수·지시선 등)는 복사본에서 빠졌습니다`,
  sheetCopyUnsupported: (index: number) =>
    `망도틀 ${index + 1}은(는) 회전·비균일 배율이라 복사하지 못해 표를 아래에 그렸습니다`,
```

- [ ] **Step 4: import와 격자 만들기를 정리한다**

`exportDrawing.ts`의 import에 더한다.

```ts
import { translatePairs } from './entityTransform.js';
import type { Frame } from './frames.js';
import {
  copyRegion,
  flattenFrameBlock,
  indexRegions,
  isFlattenable,
  pageOf,
  pagesOf,
  pitchOf,
  readSheetContext,
  shiftGrid,
  type RegionIndex,
  type SheetContext,
} from './sheetCopy.js';
import { buildGrid, findTableCandidates, hasUniformScale, nearestTable, type TableCandidate, type TableGrid } from './tableGrid.js';
```

`fillCandidate`(122~141행)를 **둘로 가른다**. 격자를 틀마다 **한 번만** 만들어 여러 장이 나눠 쓰기 위해서다(`buildGrid`는 호출마다 BLOCKS 구역을 통째로 훑는다 — 4 MB 템플릿에서 장마다 부르면 느리다).

```ts
// 표 격자를 만든다. 배율이 어긋나면 던지고(설계 6장), 격자를 읽지 못하면 경고만 붙인다.
function gridFor(doc: DxfDocument, candidate: TableCandidate, warnings: string[]): TableGrid | null {
  if (!hasUniformScale(candidate.transform)) {
    throw new ExportError('표의 배율이 가로·세로가 달라 채울 수 없습니다');
  }
  const grid = buildGrid(doc, candidate);
  if (!grid) {
    // 틀이 여럿이면 같은 경고가 여러 번 나올 수 있다. 한 번만 알린다.
    if (!warnings.includes(EXPORT_WARNINGS.unknownTable)) warnings.push(EXPORT_WARNINGS.unknownTable);
    return null;
  }
  return grid;
}

// 틀이 없는 도면 전용 — 표 하나를 골라 채운다.
function fillCandidate(
  doc: DxfDocument,
  candidate: TableCandidate,
  rows: TableRow[],
  alloc: HandleAllocator,
  owner: string,
  warnings: string[],
): DxfPair[] {
  const grid = gridFor(doc, candidate, warnings);
  return grid ? fillTable(grid, rows, alloc, owner) : [];
}
```

- [ ] **Step 5: 틀별 장 계획을 세운다**

`exportDamagesToDxf` 안, `const owner = recordHandleOrThrow(doc);`(189행) 바로 다음에 넣는다.

```ts
  /** 틀 하나가 몇 장이 되고 얼마나 오른쪽으로 가는가(설계 7장 2단계) */
  interface FramePlan {
    frame: Frame;
    entries: Included[];
    grid: TableGrid | null;
    /** 표 데이터 행 수 N */
    dataRows: number;
    /** 이 틀에서 가장 큰 손상 번호 */
    maxNumber: number;
    pages: number;
    pitch: number;
    /** 이 틀 자신이 오른쪽으로 가는 거리 = 왼쪽 틀들이 늘어난 만큼의 합 */
    offset: number;
  }

  const plans: FramePlan[] = [];
  let running = 0;
  for (const frame of frames) {
    const entries = included.filter((entry) => entry.frameIndex === frame.index);
    let frameMax = 0;
    for (const entry of entries) if (entry.number > frameMax) frameMax = entry.number;
    // 손상이 없는 틀의 표는 건드리지 않는다 — 격자도 만들지 않는다(기존 동작 그대로).
    const grid = entries.length > 0 ? gridFor(doc, frame.table, warnings) : null;
    const dataRows = grid?.dataRowCount ?? 0;
    let pages = 1;
    if (grid && dataRows > 0 && frameMax > dataRows) {
      if (isFlattenable(frame.transform)) pages = pagesOf(frameMax, dataRows);
      // 회전·비균일 배율인 틀은 펼치지 못한다 — 옛 넘침(표를 아래에)으로 간다(설계 5.2).
      else warnings.push(EXPORT_WARNINGS.sheetCopyUnsupported(frame.index));
    }
    const pitch = pitchOf(frames, frame.index);
    plans.push({ frame, entries, grid, dataRows, maxNumber: frameMax, pages, pitch, offset: running });
    running += (pages - 1) * pitch;
  }

  const planByFrame = new Map(plans.map((plan) => [plan.frame.index, plan] as const));
  // 넘치는 틀이 하나도 없으면 문서를 다시 훑지 않는다 — 4 MB 템플릿에서 헛일이 크다.
  let ctx: SheetContext | null = null;
  let regions: RegionIndex | null = null;
  if (plans.some((plan) => plan.pages > 1)) {
    ctx = readSheetContext(doc, alloc, owner);
    if (ctx) regions = indexRegions(ctx, frames);
    // 문맥을 읽지 못하면(ENTITIES가 없는 파일 — 위에서 이미 막았다) 복사를 포기하고 옛 길로 간다.
    else for (const plan of plans) plan.pages = 1;
  }

  /** 어느 틀에도 속하지 않는 것(틀 밖 손상·잡다한 글자)이 오른쪽으로 가는 거리(설계 6장) */
  function looseShift(centerX: number): number {
    let dx = 0;
    for (const plan of plans) {
      if (plan.pages > 1 && plan.frame.bounds.maxX < centerX) dx += (plan.pages - 1) * plan.pitch;
    }
    return dx;
  }

  /** 이 손상을 어디에 그릴 것인가 */
  function damageShiftOf(entry: Included): number {
    if (entry.frameIndex === null) return looseShift(boundsCenter([entry.points])[0]);
    const plan = planByFrame.get(entry.frameIndex);
    if (!plan) return 0;
    if (plan.pages <= 1 || plan.dataRows <= 0) return plan.offset;
    return plan.offset + pageOf(entry.number, plan.dataRows) * plan.pitch;
  }
```

- [ ] **Step 6: 손상 그리기에 이동량을 붙인다**

같은 함수의 손상 그리기 반복문(198~202행)을 교체한다. **순서는 지금과 똑같이 두고** 이동량만 더한다 — 넘치는 틀이 없으면 이동량이 전부 0이고, `translatePairs`는 0이면 입력 배열을 그대로 돌려주므로 결과가 한 바이트도 달라지지 않는다.

```ts
  for (const entry of included) {
    const dx = damageShiftOf(entry);
    appendAll(pairs, translatePairs(damageEntities(entry.damage, alloc, owner, circleWarnings), dx, 0));
    const label = labels.get(entry.id);
    if (label) appendAll(pairs, translatePairs(labelEntities(label, alloc, owner), dx, 0));
  }
```

- [ ] **Step 7: 복사본과 표 채우기를 붙인다**

같은 함수의 `} else { ... }` 블록(218~227행 — 틀이 있는 도면의 표 채우기)을 교체한다.

```ts
  } else {
    // 넘치는 틀은 장마다 복사본을 만든다(설계 7장 4단계).
    let copySkipped = 0;
    for (const plan of plans) {
      if (plan.pages <= 1 || !plan.grid || !ctx || !regions) continue;
      warnings.push(EXPORT_WARNINGS.sheetCopied(plan.frame.index, plan.pages));
      for (let page = 1; page < plan.pages; page++) {
        const dx = plan.offset + page * plan.pitch;
        const region = copyRegion(ctx, regions.inFrame[plan.frame.index], dx);
        appendAll(pairs, region.pairs);
        const block = flattenFrameBlock(ctx, plan.frame, plan.grid, page, dx);
        appendAll(pairs, block.pairs);
        copySkipped += region.skipped + block.skipped;
      }
    }
    if (copySkipped > 0) warnings.push(EXPORT_WARNINGS.sheetCopySkipped(copySkipped));

    // 틀마다 자기 표에 그 틀 손상만 1번부터 채운다. 손상이 없는 틀의 표는 건드리지 않는다.
    for (const plan of plans) {
      if (plan.entries.length === 0 || !plan.grid) continue;
      if (plan.pages <= 1) {
        // 넘치지 않는 틀(과 미지원 틀)은 지금까지와 같다 — 넘치면 fillTable이 표를 아래에 쌓는다.
        appendAll(pairs, fillTable(shiftGrid(plan.grid, plan.offset), rowsFor(plan.entries, plan.maxNumber), alloc, owner));
        continue;
      }
      // 장마다 그 장의 표에 1행부터 채운다. 번호 열은 flattenFrameBlock이 이미 썼다(설계 5.4).
      for (let page = 0; page < plan.pages; page++) {
        const dx = plan.offset + page * plan.pitch;
        const pageEntries = plan.entries
          .filter((entry) => pageOf(entry.number, plan.dataRows) === page)
          .map((entry) => ({ ...entry, number: entry.number - page * plan.dataRows }));
        const pageMax = Math.min(plan.dataRows, plan.maxNumber - page * plan.dataRows);
        appendAll(pairs, fillTable(shiftGrid(plan.grid, dx), rowsFor(pageEntries, pageMax), alloc, owner));
      }
    }
  }
```

- [ ] **Step 8: 테스트를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS — 새 describe 7개와 기존 테스트 전부. 실패하면 먼저 `넘치지 않으면 경고도 복사본도 없다`와 기존 `틀마다 1번부터 매기고…`를 본다(이동량 0 경로가 깨졌다는 뜻이다).

- [ ] **Step 9: 커밋**

```bash
git add server/src/export/exportDrawing.ts server/test/exportDrawing.test.ts
git commit -m "$(cat <<'EOF'
feat: 표 행 수를 넘친 망도틀을 오른쪽에 한 장 더 만든다

틀마다 장 수·간격·이동량을 먼저 계산하고, 넘치는 틀은 장마다 영역 엔티티를 베끼고 틀
블록을 펼쳐 넣는다. 그 장의 손상·라벨은 원본 좌표로 만든 뒤 옮겨 넣고 표는 장마다 1행부터
채운다. 회전·비균일 배율 틀은 옛 넘침(표를 아래에)으로 가고 경고를 낸다. 넘치는 틀이
없으면 이동량이 전부 0이라 결과가 지금과 한 바이트도 다르지 않다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 맨 오른쪽 망도틀에 손상을 표 행 수보다 많이 그리면, 내려받은 DXF에 그 틀이 오른쪽에 한 장 더 생기고 넘친 손상과 이어지는 번호의 표가 함께 들어 있다.

---

## Task 4: 오른쪽 틀을 민다 + 실제 템플릿 통합 확인

Task 3까지는 복사본이 **다음 틀 위에 겹쳐** 놓인다. 여기서 원본 엔티티를 제자리에서 옮겨 자리를 낸다.

**Files:**
- Modify: `server/src/export/exportDrawing.ts`(Task 3에서 만든 `} else {` 블록 뒤, `insertEntities` 앞)
- Modify: `server/test/exportDrawing.test.ts`(Task 3의 describe 안에 이어서)

**Interfaces:**
- Consumes: Task 2의 `shiftRangesInPlace(doc, ranges, dx)`, `RegionIndex`; Task 3의 `plans`·`regions`·`looseShift`
- Produces: 없음(동작만 바뀐다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Task 3에서 만든 `describe('망도틀 넘침 — 틀을 통째로 복사한다')` 안에 이어 붙인다.

```ts
    // 틀 0 안쪽(x 2000~4280, y 3160~3400)
    function leftDamage(n: number) {
      const x = 2100 + n * 100;
      const dwg: Pt[] = [[x, 3200], [x + 50, 3200], [x + 50, 3300], [x, 3300]];
      return damage(`l${n}`, 'spalling', n * 10, dwg, { width: 1.2, length: 1.5, count: 2 });
    }

    it('앞 틀이 넘치면 뒤 틀의 INSERT가 간격만큼 오른쪽으로 간다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [1, 2, 3, 4].map(leftDamage));
      const moved = findFrames(parseDxf(result.dxfText));
      // 틀 0은 제자리, 틀 1의 삽입점 50000 + 49000 = 99000 → 영역 99000 + 2*500 = 100000
      expect(moved).toHaveLength(2);
      expect(moved[0].bounds.minX).toBeCloseTo(2000, 6);
      expect(moved[1].bounds.minX).toBeCloseTo(100000, 6);
    });

    it('복사본이 원래 뒤 틀 자리에 온다', async () => {
      const result = exportDamagesToDxf(await twoFrames(), [1, 2, 3, 4].map(leftDamage));
      // 틀 0의 복사본: 삽입점 1000 + 49000 = 50000 → 표 원점 51000, 번호 칸 51100
      const four = texts(result.dxfText).filter((t) => t.value === '4');
      expect(four).toHaveLength(1);
      expect(four[0].x).toBeCloseTo(51100, 6);
      expect(four[0].y).toBeCloseTo(3260, 6);
    });

    it('뒤 틀의 영역 도형·손상·표 글자도 함께 밀린다', async () => {
      // 틀 1 영역 안에 최상위 LINE (51100,3200)-(51300,3300)을 넣는다.
      const extra = [
        '  0', 'LINE', '  5', '91', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
        ' 10', '51100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '51300.0', ' 21', '3300.0', ' 31', '0.0', '',
      ].join('\n');
      const text = (await twoFrames()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
      const result = exportDamagesToDxf(text, [...[1, 2, 3, 4].map(leftDamage), rightDamage(1)]);

      const doc = parseDxf(result.dxfText);
      const lineXs = doc.pairs
        .map((p, i) => (p.code === 0 && p.value === 'LINE' ? i : -1))
        .filter((i) => i >= 0)
        .map((i) => Number(doc.pairs.slice(i, i + 20).find((p) => p.code === 10)!.value));
      // 원본 LINE이 51100 → 100100으로 옮겨졌고, 51100에는 아무것도 남지 않았다.
      expect(lineXs).toContain(100100);
      expect(lineXs).not.toContain(51100);

      // 틀 1의 손상 도형도 +49000
      const polyXs = doc.pairs
        .map((p, i) => (p.code === 0 && p.value === 'LWPOLYLINE' ? i : -1))
        .filter((i) => i >= 0)
        .map((i) => Number(doc.pairs.slice(i, i + 30).find((p) => p.code === 10)!.value));
      expect(polyXs).toContain(100200); // 51200 + 49000

      // 틀 1의 표 단위 칸: 53170 + 49000 = 102170
      expect(texts(result.dxfText).filter((t) => t.value === '㎡').map((t) => t.x)).toContain(102170);
    });

    it('틀 둘이 모두 넘치면 이동량이 누적된다', async () => {
      // 틀 셋: x 2000 / 51000 / 100000. 간격은 모두 49000이다.
      const three = withFrameAt(await twoFrames(), 99000, '8B');
      const result = exportDamagesToDxf(three, [...[1, 2, 3, 4].map(leftDamage), ...[1, 2, 3, 4].map(rightDamage)]);
      expect(result.warnings).toEqual([
        EXPORT_WARNINGS.sheetCopied(0, 2),
        EXPORT_WARNINGS.sheetCopied(1, 2),
      ]);

      const moved = findFrames(parseDxf(result.dxfText));
      expect(moved).toHaveLength(3);
      expect(moved[0].bounds.minX).toBeCloseTo(2000, 6); // 틀 0 제자리
      expect(moved[1].bounds.minX).toBeCloseTo(100000, 6); // 틀 1은 49000
      expect(moved[2].bounds.minX).toBeCloseTo(198000, 6); // 틀 2는 49000 + 49000
    });

    it('틀이 없는 도면은 옛 넘침(표를 아래에) 그대로다', async () => {
      const result = exportDamagesToDxf(flatTable(await template()), [1, 2, 3, 4].map(leftDamage));
      expect(result.warnings).toEqual([]);
      // 넘침 표 1장째는 로컬로 −(120 + 40) = −160만큼 내려간다(tableFill.test.ts 실측).
      // 표가 최상위(배율 1, 삽입점 (500,700))이므로 데이터 1행 중앙 y = 700 − 70 = 630 → 630 − 160 = 470
      const ys = texts(result.dxfText).filter((t) => t.value === '4').map((t) => t.y);
      expect(ys).toContain(470);
    });
```

테스트 상단 import에 `findFrames`와 `withFrameAt`을 더한다.

```ts
import { findFrames } from '../src/export/frames.js';
import { flatTable, rotatedFrame, withFrameAt, withSecondFrame } from './fixtureDocs.js';
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm --prefix server test -- exportDrawing`
Expected: FAIL — `expected 51000 to be close to 100000`(뒤 틀이 아직 밀리지 않는다)

- [ ] **Step 3: 밀기를 구현한다**

`exportDrawing.ts`에서 표 채우기 블록이 끝난 뒤, `insertEntities(doc, pairs);`(229행) **바로 앞**에 넣는다.

```ts
  // 오른쪽 틀과 그 영역의 원본 엔티티를 제자리에서 옮긴다(설계 6장).
  // insertEntities보다 **먼저** 해야 한다 — 범위(EntityRange)는 ENTITIES 구역 안의 인덱스이고,
  // insertEntities는 그 구역 끝에 쌍을 이어 붙여 배열을 새로 만든다.
  if (regions && running > 0) {
    for (const plan of plans) {
      if (plan.offset === 0) continue;
      shiftRangesInPlace(doc, regions.inFrame[plan.frame.index], plan.offset);
      const insert = regions.frameInsert[plan.frame.index];
      if (insert) shiftRangesInPlace(doc, [insert], plan.offset);
    }
    // 어느 틀에도 속하지 않는 최상위 엔티티(틀 사이의 글자 등)도 오른쪽에 있으면 같이 민다.
    for (const entry of regions.loose) {
      shiftRangesInPlace(doc, [entry.range], looseShift(entry.centerX));
    }
  }
```

`import { ..., shiftRangesInPlace, ... } from './sheetCopy.js';`를 import에 더한다.

- [ ] **Step 4: 테스트를 돌린다**

Run: `npm --prefix server test && npm --prefix server run typecheck`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/exportDrawing.ts server/test/exportDrawing.test.ts
git commit -m "$(cat <<'EOF'
feat: 넘친 망도틀 뒤의 틀들을 오른쪽으로 민다

틀이 늘어난 만큼 뒤 틀의 INSERT와 그 틀 영역의 최상위 엔티티, 그 틀 손상·라벨·표 글자를
같은 거리만큼 옮긴다. 원본 엔티티는 복사가 아니라 제자리에서 고쳐 핸들과 참조가 그대로
남는다. 여러 틀이 넘치면 이동량이 누적된다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 실제 템플릿 통합 테스트를 쓴다**

`server/test/exportDrawing.test.ts` 맨 아래(가장 바깥 `describe`가 닫히기 전)에 더한다. 사내 원본은 커밋되지 않으므로(`.gitignore`) 파일이 있을 때만 돈다.

```ts
  // 사내 템플릿은 커밋하지 않는다(.gitignore의 *.dxf). 있을 때만 도는 통합 확인이다.
  // 실측(조사 1·5장): 틀 7개, 데이터 행 수 35, 틀 0 minX 76627.54, 간격(0→1) 74943.26.
  const realTemplatePath = join(fileURLToPath(new URL('../../', import.meta.url)), 'docs', '빈도면(테이블버전).dxf');

  describe.skipIf(!existsSync(realTemplatePath))('실제 사내 템플릿', () => {
    it('틀 0에 손상 40개를 그리면 복사본이 틀 1 자리에 오고 틀 1~6이 밀린다', async () => {
      const text = await readFile(realTemplatePath, 'utf8');
      // 틀 0 영역(x 76627.54~144365.14, y 35.53~45701.33) 안에 40개
      const damages = [];
      for (let i = 0; i < 40; i++) {
        const x = 77000 + i * 100;
        const dwg: Pt[] = [[x, 5000], [x + 50, 5000], [x + 50, 5100], [x, 5100]];
        damages.push(damage(`d${i}`, 'spalling', i * 10, dwg, { width: 1.2, length: 1.5, count: 2 }));
      }

      const started = Date.now();
      const result = exportDamagesToDxf(text, damages);
      const elapsed = Date.now() - started;
      console.log(`[실제 템플릿] 손상 40개 산출 ${elapsed}ms, ${result.dxfText.length}자`);
      expect(elapsed).toBeLessThan(60_000);

      // 35행을 넘겨 2장이 된다
      expect(result.warnings).toContain(EXPORT_WARNINGS.sheetCopied(0, 2));

      // 다시 읽히고 핸들이 유일하다
      const doc = parseDxf(result.dxfText);
      const handles = doc.pairs.filter((p) => p.code === 5).map((p) => p.value.trim());
      expect(new Set(handles).size).toBe(handles.length);

      // 틀은 여전히 7개(복사본은 펼쳐 넣었으므로 INSERT가 아니다)이고, 틀 1~6이 간격만큼 밀렸다.
      const moved = findFrames(doc);
      expect(moved).toHaveLength(7);
      expect(moved[0].bounds.minX).toBeCloseTo(76627.54, 1); // 틀 0은 제자리
      expect(moved[1].bounds.minX).toBeCloseTo(151570.79 + 74943.26, 1);

      // 복사본 표의 36번이 원래 틀 1 자리(x ≈ 151570)에 있다
      const numbers = doc.pairs
        .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
        .filter((i) => i >= 0)
        .map((i) => doc.pairs.slice(i, i + 24))
        .filter((slice) => slice.find((p) => p.code === 1)?.value === '36')
        .map((slice) => Number(slice.find((p) => p.code === 10)!.value));
      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toBeGreaterThan(151000);
      expect(numbers[0]).toBeLessThan(220000);
    }, 120_000);
  });
```

파일 맨 위의 import에 더한다.

```ts
import { existsSync } from 'node:fs';
```

- [ ] **Step 7: 테스트를 돌린다**

Run: `npm --prefix server test -- exportDrawing`
Expected: PASS. 사내 템플릿이 없는 기계에서는 그 describe가 통째로 건너뛴다(`skipped`로 표시된다).

시간이 60초를 넘으면 멈추고 어디가 느린지 잰다. 가장 흔한 원인은 `gridFor`가 틀마다 `buildGrid`를 부르며 BLOCKS를 다시 훑는 것이다(틀 7개 × 3 MB). 그때는 `readSheetContext`가 이미 만든 `ctx.blocks`를 `buildGrid`가 받도록 바꾸는 것을 **별도 커밋**으로 한다.

- [ ] **Step 8: 커밋**

```bash
git add server/test/exportDrawing.test.ts
git commit -m "$(cat <<'EOF'
test: 실제 사내 템플릿으로 넘침 장 복사를 통합 확인한다

틀 0에 손상 40개(데이터 행 35 초과)를 그려 복사본이 원래 틀 1 자리에 오고 틀 1~6이
간격만큼 밀리는지, 결과가 다시 읽히고 핸들이 유일한지, 걸린 시간이 얼마인지 잰다.
원본은 커밋하지 않으므로 파일이 있을 때만 돈다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Deliverable:** 실제 사내 도면에서 한 틀에 36개 이상을 그리면, 복사본이 뒤 틀 자리에 놓이고 뒤 틀들이 한 칸씩 밀린 DXF가 나온다.

---

## Task 5: 문서 — README, 캐드 확인표, 대체된 설계 안내

**Files:**
- Modify: `README.md:17, 88, 113`
- Modify: `docs/DXF산출-테스트-결과.md:27-29, 45(뒤), 54-59`
- Modify: `docs/superpowers/specs/2026-09-16-frame-numbering-design.md:84`(### 넘침 표 바로 아래)
- Modify: `docs/superpowers/specs/2026-09-15-dxf-export-design.md:121`(기존 대체 안내 뒤)

**Interfaces:**
- Consumes: Task 3·4에서 확정된 경고 문구 세 개(`sheetCopied`·`sheetCopySkipped`·`sheetCopyUnsupported`)
- Produces: 없음(문서만)

- [ ] **Step 1: README를 고친다**

17행의 설계 목록 끝에 이번 설계를 더한다(줄 전체를 아래로 교체한다).

```markdown
- 설계: `docs/superpowers/specs/2026-09-10-phase1-poc-design.md`(1단계 PoC), `docs/superpowers/specs/2026-09-12-damage-types-design.md`(손상 유형 체계), `docs/superpowers/specs/2026-09-13-damage-attributes-design.md`(손상 속성·물량), `docs/superpowers/specs/2026-09-15-dxf-export-design.md`(DXF 산출·손상물량표), `docs/superpowers/specs/2026-09-16-label-layout-design.md`(라벨 배치), `docs/superpowers/specs/2026-09-16-frame-numbering-design.md`(망도틀별 번호·표), `docs/superpowers/specs/2026-09-16-sheet-overflow-design.md`(넘침 장 복사)
```

88행(`- 손상이 표의 행 수를 넘으면 표를 **바로 아래에** 한 장 더 그립니다…`)을 아래 세 줄로 교체한다.

```markdown
   - 한 망도틀의 손상이 그 틀 물량표의 행 수를 넘으면 **그 틀을 통째로 오른쪽에 복사**합니다(사내 방식). 복사된 틀에는 테두리·표·구조물 도면과 36번 이후의 손상이 들어가고 표 번호는 36부터 이어집니다
   - 복사된 만큼 **뒤에 있던 망도틀들이 오른쪽으로 밀립니다**. 여러 틀이 넘치면 이동량이 쌓입니다
   - 망도틀이 없는 도면이나 회전·비균일 배율로 삽입된 틀에서는 예전처럼 표만 **바로 아래에** 한 장 더 그립니다
```

113행(`| 망도틀 밖 손상 N개는 …` 줄) 다음에 세 줄을 더한다.

```markdown
| `망도틀 N을(를) M장으로 나눴습니다 (복사본 …장, 뒤 틀 이동)` | 손상이 표 행 수를 넘어 그 틀을 오른쪽에 복사했습니다. 뒤 틀들이 한 칸씩 밀렸으니 캐드에서 전체 배치를 확인하세요 |
| `복사할 수 없는 엔티티 N개(치수·지시선 등)는 복사본에서 빠졌습니다` | 치수·지시선처럼 다른 객체를 가리키는 도형은 복사본에 넣지 못했습니다. 캐드에서 직접 복사해 주세요 |
| `망도틀 N은(는) 회전·비균일 배율이라 복사하지 못해 표를 아래에 그렸습니다` | 그 틀이 돌아가 있거나 가로·세로 배율이 다르게 삽입돼 있습니다. 표만 원본 표 아래에 한 장 더 그렸습니다 |
```

- [ ] **Step 2: 캐드 확인표의 18~20번을 새 규칙으로 고쳐 쓴다**

`docs/DXF산출-테스트-결과.md`의 27~29행(18·19·20번)을 교체한다.

```markdown
| 18 | **한 망도틀에 손상을 36개 넘게 그린 도면**에서 그 틀이 **오른쪽에 통째로 복사**된다 (테두리·표·구조물 도면까지 똑같이) | | |
| 19 | 복사된 틀의 표 번호가 **36~70**으로 이어지고, 36번 이후 손상의 도형·라벨이 복사된 틀 위에 그려져 있다 | | |
| 20 | 복사된 틀 **뒤에 있던 망도틀들이 한 틀씩 오른쪽으로 밀렸다** (구조물 도면·도면 번호·표가 함께 이동) | | |
```

45행(36번 행) 다음에 네 줄을 더한다.

```markdown
| 37 | 망도틀 **둘이 동시에 넘치면** 뒤 틀의 이동량이 **누적**된다 (두 칸 밀린다) | | |
| 38 | 복사된 틀의 표를 캐드에서 눌러 보면 **표 객체가 아니라 선·글자**다 (번호를 바꾸려고 펼쳐 넣었기 때문 — 원본 틀의 표는 그대로 표 객체다) | | |
| 39 | 복사된 틀의 해치가 원본과 **같은 무늬·간격**이다 (연관이 풀렸어도 모양이 같다) | | |
| 40 | `망도틀 N을(를) M장으로 나눴습니다` 경고가 뜨고 내려받기 자체는 성공한다 | | |
```

- [ ] **Step 3: `## 두 번째 표 위치` 절을 새 규칙으로 바꾼다**

54~59행을 교체한다.

```markdown
## 넘침 장 복사

2026-09-16 설계에서 넘침 처리를 "표만 아래에 한 장 더"에서 **"틀을 통째로 오른쪽에 복사하고 뒤 틀을 민다"**로 바꿨다(사내 방식, 사용자 확인).

- 복사된 틀이 원래 뒤 틀이 있던 자리에 정확히 놓였는가(간격이 도면마다 조금씩 달라 어긋날 수 있다):
- 복사된 틀의 도면 번호 글자(`4-1` 등)가 원본과 같다 — 구분이 필요한가(필요하면 `4-1(2)` 같은 표기를 검토한다):
- 밀린 틀들 사이 간격이 원본과 같은가:
- 복사본에서 빠진 도형이 있었는가(경고에 개수가 나온다):

옛 방식(표를 원본 표 바로 아래에 한 장 더)은 **망도틀이 없는 도면**과 **회전·비균일 배율 틀**에만 남아 있다.

- 틀 없는 도면에서 두 번째 표가 아래에 생겼고 왼쪽 끝이 원본과 같은가:
```

- [ ] **Step 4: 대체된 설계에 안내를 남긴다**

`docs/superpowers/specs/2026-09-16-frame-numbering-design.md`의 `### 넘침 표 (7.4 대체)` 줄(84행) 바로 다음에 넣는다.

```markdown
> **2026-09-16 재대체:** 이 절은 `2026-09-16-sheet-overflow-design.md`가 대체한다 — 표만 아래에 한 장 더 그리는 것이 아니라 **틀을 통째로 오른쪽에 복사하고 뒤 틀을 민다**(사내 방식). 아래 규칙은 **망도틀이 없는 도면**과 **회전·비균일 배율이라 펼치지 못하는 틀**에서만 그대로 남는다.
```

`docs/superpowers/specs/2026-09-15-dxf-export-design.md`의 7.4 안내(121행 다음의 `> **2026-09-16 대체:**` 줄) 바로 다음에 한 줄을 더한다.

```markdown
> **2026-09-16 재대체:** 넘침 처리 자체를 `2026-09-16-sheet-overflow-design.md`가 다시 대체한다 — 표를 한 장 더 그리는 것이 아니라 **망도틀을 통째로 오른쪽에 복사하고 뒤 틀을 민다.** 표를 아래에 그리는 규칙은 틀이 없는 도면과 미지원 틀에만 남는다.
```

- [ ] **Step 5: 문서를 눈으로 확인하고 커밋한다**

Run: `npm --prefix server test`
Expected: PASS (문서만 고쳤으니 그대로여야 한다)

```bash
git add README.md docs/DXF산출-테스트-결과.md docs/superpowers/specs/2026-09-16-frame-numbering-design.md docs/superpowers/specs/2026-09-15-dxf-export-design.md
git commit -m "$(cat <<'EOF'
docs: 넘침 장 복사를 README와 캐드 확인표에 반영한다

확인표 18~20번을 "틀을 통째로 복사하고 뒤 틀을 민다"로 고쳐 쓰고 37~40번(누적 이동,
펼친 표, 해치, 경고)을 더했다. 두 번째 표 위치 절을 넘침 장 복사 절로 바꾸고, 대체된
설계 두 곳(2026-09-16 frame-numbering 6장, 2026-09-15 7.4)에 재대체 안내를 남긴다.

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
```

한 Task만 빨리 보고 싶으면 파일 이름 조각을 붙인다.

```bash
npm --prefix server test -- entityTransform
npm --prefix server test -- sheetCopy
npm --prefix server test -- exportDrawing
```

뷰어 JS(`server/public/viewer/*.js`)와 Expo 앱은 이번 계획에서 **건드리지 않으므로** `node --check`는 돌릴 것이 없다.

실기기·캐드 확인은 Task 5의 확인표(`docs/DXF산출-테스트-결과.md` 18~20·37~40번)로 사용자와 함께 본다. **핵심은 한 망도틀에 손상을 36개 넘게 그려 보는 것이다** — 그 틀이 오른쪽에 복사됐는지, 복사본에 구조물 도면·36번 이후 손상·36~70 표가 있는지, 뒤 틀들이 한 칸씩 밀렸는지, 지스타캐드에서 왕복되는지(설계 8장).

## 손으로 계산한 픽스처 값 (테스트 리터럴의 출처)

`server/test/fixtures/mangdo-template.dxf` 실측:

| 값 | 출처 |
|---|---|
| 표 삽입점(망도틀 블록 좌표) `(500, 700)` | `ACAD_TABLE`의 코드 10/20 |
| 열 너비 `100/150/300/120/120/100/140/110`, 합 `1140` | 코드 142 × 8 |
| 행 높이 `40/20/20/20/20`, 합 `120` | 코드 141 × 5 |
| 열 경계 `0/100/250/550/670/790/890/1030/1140` | 열 너비 누적 |
| 행 경계 `0/−40/−60/−80/−100/−120` | 행 높이 누적(아래로) |
| 데이터 1행 = 행 인덱스 `2`, **데이터 행 수 `3`** | 번호 열의 인쇄된 `1`이 `−70`(행 2) → `6 − 1 − 2 = 3` |
| 표 글자 높이(로컬) `10`, 모델 `20` | `1` MTEXT의 코드 40 × 배율 2 |
| 망도틀 INSERT | 삽입점 `(1000, 2000)`, 배율 2, 회전 0 |
| **틀 0 영역** | x `1000+2*500=2000` ~ `1000+2*1640=4280`, y `2000+2*580=3160` ~ `2000+2*700=3400`. 너비 `2280` |
| 번호 칸 중앙(모델) | x `1000+2*(500+50)=2100`, 1행 y `2000+2*(700−70)=3260`, 2행 `3220`, 3행 `3180` |
| 7열(단위) 중앙 x(모델) | `1000+2*(500+1085)=4170` |
| `withSecondFrame(t, 50000)` 틀 1 영역 | x `50000+1000=51000` ~ `50000+3280=53280` → **간격 `49000`** |
| 틀 하나뿐일 때 간격 | 너비 `2280 × 1.1 = 2508` |
| 펼친 표의 원점(복사본, dx=49000, 틀 0) | 틀 변환 x `1000+49000=50000` → 표 원점 `50000+2*500=51000`, y `2000+2*700=3400` |
| 복사본 번호 칸 x | `51000+2*50=51100` |
| `손상물량표` 머리글(복사본, 틀 0, dx=49000) | 로컬 `(570, −20)` → `(51000+1140, 3400−40)` = `(52140, 3360)` |
| 옛 넘침 표 1장째 내림(로컬) | `−(120 + 40) = −160` |

실제 사내 템플릿(`docs/빈도면(테이블버전).dxf`, 조사 1·5장):

| 값 | 출처 |
|---|---|
| 틀 7개, 배율 1.268494382022469 균일, 회전 0 | 조사 1장 |
| **데이터 행 수 35** (`firstDataRow = 3`, 행 38개, 열 8개) | 조사 5장 |
| 틀 0 영역 minX `76627.54`, 너비 `67737.60` | 조사 1장 |
| 간격 0→1 `74943.26`, 그 뒤 `76455~76617` (**균일하지 않다**) | 조사 1장 |
| 틀 블록 `망도틀` 148개 엔티티(LINE 61·TEXT 42·HATCH 8·LWPOLYLINE 35·MTEXT 1·ACAD_TABLE 1) | 조사 4장 |
| 구조물 도면은 **블록 밖** 최상위 (틀 2는 LINE 1992개 등) | 조사 2장 |

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 3장 `pages = ceil(count / N)`, 장 p는 번호 `p·N+1 … (p+1)·N` | 2 (`pageOf`·`pagesOf`) · 3 |
| 3장 여러 틀이 넘치면 왼쪽부터 이동량 누적 | 3 (계획) · 4 (밀기·누적 테스트) |
| 4장 `pitch(k)` — 다음 틀 / 마지막은 앞 쌍 / 하나면 너비 × 1.1 | 2 (`pitchOf`) |
| 4장 장 p의 자리 = `p × pitch(k)`, y는 그대로 | 3 |
| 4장 뒤 틀 이동량 `(pages(k) − 1) × pitch(k)` 누적 | 3 (`offset`) · 4 |
| 5.1 영역 = 경계상자 중심이 틀 안, 틀 INSERT 제외 | 2 (`indexRegions`) |
| 5.1 새 핸들(5), 같은 소유자(330) | 1 (`copyEntityPairs`) · 2 (`copyRegion`) |
| 5.1 `{ACAD_REACTORS}`·`{ACAD_XDICTIONARY}` 제거 | 1 |
| 5.1 연관 해치 → 비연관(71=0), 97/330 제거 | 1 |
| 5.1 절대 점 코드만 이동, `MTEXT` 11/21·`INSERT` 41/42/50·`HATCH` 45/46·52/53 제외, 43/44는 이동 | 1 (`ROLES`·`xyRoleOf`) |
| 5.1 `DIMENSION`·`LEADER`·`MLEADER`·`VIEWPORT`는 복사 안 함 + `sheetCopySkipped` | 1 (`isCopyable` 허용 목록) · 3 (경고) |
| 5.1 이전 산출의 손상 레이어가 남아 있으면 같이 복사된다(미해결) | — (9장, 운영 규칙) |
| 5.2 틀 블록을 펼친다(재INSERT 아님) | 2 (`flattenFrameBlock`) |
| 5.2 점 변환·길이 × 배율·각도 + 회전 | 1 (`transformEntityPairs`) |
| 5.2 중첩 `INSERT`는 삽입점 변환 + 배율 곱 + 회전 더함(정의 공유) | 1 · 2 |
| 5.2 `ACAD_TABLE`은 넣지 않고 `*T` 블록을 옮김, 번호 열 데이터 행 글자 제거 | 2 (`flattenTable`) |
| 5.2 새 번호 `p·N+1 … p·N+N`을 `cellCenter`에 같은 높이·가운데 정렬로 | 2 |
| 5.2 회전·비균일 배율 틀은 펼치지 않고 옛 방식 + `sheetCopyUnsupported` | 2 (`isFlattenable`) · 3 |
| 5.3 장 p의 손상·라벨을 원본 좌표로 만든 뒤 `p × pitch` 이동 | 3 |
| 5.3 `placeLabels`는 원본 좌표에서 전체를 한 번에 | 3 (기존 호출 유지) |
| 5.3 앱 화면은 바뀌지 않는다 | — (뷰어 JS 미변경) |
| 5.4 장 p의 표를 `fillTable`로 채운다, 번호 열은 건드리지 않는다 | 3 |
| 5.4 옛 넘침은 틀 없는 도면·미지원 틀에서만 | 3 (`pages <= 1` 경로) · 4 (테스트) |
| 6장 오른쪽 틀 INSERT·영역 엔티티를 **제자리에서** 이동 | 2 (`shiftRangesInPlace`) · 4 |
| 6장 어느 틀에도 없는 엔티티 중 중심 x > `maxX(k)`인 것도 이동 | 3 (`looseShift`) · 4 |
| 6장 오른쪽 틀의 손상·라벨·표 글자도 같은 이동량 | 3 (`damageShiftOf`·`shiftGrid(offset)`) |
| 7장 산출 흐름 1~6단계 | 3 · 4 |
| 7장 경고 `sheetCopied`·`sheetCopySkipped`·`sheetCopyUnsupported` | 3 |
| 8장 엔티티 옮기기 단위 테스트(종류별) | 1 |
| 8장 복사 단위 테스트(핸들·102 묶음·연관 해치) | 1 |
| 8장 영역 판정 단위 테스트 | 2 |
| 8장 블록 펼치기 단위 테스트(번호 열 교체 포함) | 2 |
| 8장 장 나누기·밀기·누적·pitch 테스트 | 2 · 3 · 4 |
| 8장 틀 없는 도면·미지원 틀은 옛 넘침 그대로 | 3 · 4 |
| 8장 픽스처 변형(틀 안 `LINE`·`TEXT`·연관 `HATCH`) | 2 · 3 (테스트 안에서 최상위 엔티티를 덧붙인다) |
| 8장 실제 템플릿 통합(손상 40개, 재파싱·핸들 유일·시간) | 4 |
| 8장 실기기·캐드 확인표 | 5 |
| 9장 미해결(두 번 산출, 여러 틀에 걸친 엔티티, 도면 번호 글자, 참조 엔티티) | 5 (확인표에서 사용자와 확인) |
