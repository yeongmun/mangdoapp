# 모델 공간 손상물량표 셀 채우기·표 복제 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표가 망도틀 블록 밖(모델 공간)에 놓인 새 템플릿에서 틀을 알아보고, 손상물량표를 선 위 글자가 아니라 **표 셀에 직접** 채우며, 넘침 복사본의 표를 **진짜 표 객체로 복제**한다.

**Architecture:** `findFrames`가 "블록 영역 안에 놓인 모델 공간 `ACAD_TABLE`"도 틀의 표로 받아 `tableKind`를 붙인다. 새 모듈 `tableCells.ts`(셀 값 묶음 교체 + `*T` 글자 블록에 `MTEXT` 추가 + 그래픽 캐시 제거)와 `tableClone.ts`(새 `BLOCK_RECORD`·`BLOCK`·`ACAD_TABLE` 묶음 생성)가 `DxfPair[]`만 다루는 순수 함수이고, `documentEdits.ts`가 여러 구역(TABLES·BLOCKS·ENTITIES)의 삽입·교체를 모아 인덱스 내림차순으로 한 번에 적용한다. `exportDrawing.ts`는 뒤 틀 밀기를 복사보다 **먼저** 한 뒤 `tableKind`별로 갈라진다.

**Tech Stack:** Node 24 · TypeScript(NodeNext, import는 `.js` 접미사) · vitest · 기존 `server/src/export/*` 모듈(`dxfDocument.ts`의 `DxfPair`/`pair`/`HandleAllocator`, `tableGrid.ts`의 `TableGrid`/`EntityRange`/`rawEntityAt`/`indexOfBand`).

**Spec:** `docs/superpowers/specs/2026-10-02-table-cells-design.md`

## Global Constraints

- 커밋 트레일러는 정확히 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 파일은 이름으로 스테이징(`git add <path>`); `git add .`/`-A`/`commit -a`/`checkout`/`restore`/`stash` 금지.
- `server/test/fixtures/mangdo-template.dxf`와 `server/data/`는 고치지 않는다. 픽스처 변형은 `server/test/fixtureDocs.ts`의 글자 치환 함수로만 만든다.
- 모든 작업은 `server/` 안에서 `npm test`(vitest)로 확인한다. 테스트 실행은 `cd server && npx vitest run <파일>`.
- 셀 값 묶음 형식(설계 2장): 문자열 칸 `301 CELL_VALUE / 93 '        0' / 90 '        4' / 1 글자 / 94 '        0' / 302 글자 / 304 ACVALUE_END`, 정수 칸 `301 CELL_VALUE / 93 '        0' / 90 '        1' / 91 n / 94 '        0' / 300 '' / 302 'n' / 304 ACVALUE_END`.
- 글자 블록 `MTEXT`(설계 4.2): `71 5`, `72 5`, `73 1`, `44 1.0`, 레이어 `0`, `62 0`, `40` = `grid.textHeight`, `41` = 열 너비 − 2 × 여백, 여백 = (번호 열 너비 − 번호 글자 `41`) / 2(없으면 0), `330` = 그 블록의 `BLOCK_RECORD` 핸들.
- 표 엔티티의 `160`·`310`(그래픽 캐시)과 복제본의 `102 {ACAD_XDICTIONARY … 102 }`는 지운다.
- `ACAD_TABLE`은 `translateEntityPairs`에서 `10/20`만 옮기고 `11/21`은 그대로. `isCopyable('ACAD_TABLE')`은 **false**.
- 복제 블록 이름은 문서의 `*T<숫자>` 가운데 가장 큰 숫자 + 1부터.
- 주석·문서는 한국어, 기존 파일의 주석 밀도와 어조를 따른다. 숫자를 코드에 박아 두지 않는다(여백·글자 높이는 블록에서 읽는다).

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `server/src/export/entityTransform.ts` (수정) | `ROLES`에 `ACAD_TABLE` 추가, `isCopyable`에서 제외 |
| `server/src/export/dxfDocument.ts` (수정) | `findBlock(doc, name)`, `symbolTableInfo(doc, name)` |
| `server/src/export/documentEdits.ts` (신규) | `DocumentEdits` — 삽입·교체를 모아 뒤에서 앞으로 적용 |
| `server/src/export/frames.ts` (수정) | 모델 공간 표를 틀의 표로 받기, `tableKind`·`tableEntityIndex` |
| `server/src/export/tableGrid.ts` (수정) | `BlockText.width`, `TableGrid.textWidth`, `isPrintedNumber` 이전 |
| `server/src/export/tableCells.ts` (신규) | `cellWritesFor`, `writeCellValues`, `stripGraphicsCache`, `cellMtextPairs`, `cellMargin`, `appendBeforeEndblk` |
| `server/src/export/tableClone.ts` (신규) | `usedTableNames`, `nextTableName`, `cloneTable` |
| `server/src/export/sheetCopy.ts` (수정) | `resolvedBounds`의 표 분기, `copyRegion`의 `exclude`, `copyFrameInsert`, `isPrintedNumber`를 tableGrid에서 가져오기 |
| `server/src/export/exportDrawing.ts` (수정) | 밀기 먼저, `tableKind`별 표 채우기·복제 |
| `server/test/fixtureDocs.ts` (수정) | `modelSpaceTemplate(frameCount)` 빌더 |
| `server/test/{entityTransform,dxfDocument,documentEdits,frames,tableCells,tableClone,sheetCopy,exportDrawing}.test.ts` | 테스트 |
| `README.md`, `docs/DXF산출-테스트-결과.md` | 문서 |

---

### Task 1: `ACAD_TABLE`의 이동 규칙과 복사 금지 (`entityTransform.ts`)

**Files:**
- Modify: `server/src/export/entityTransform.ts:44-66` (`ROLES`), `:393-415` (`isCopyable`)
- Test: `server/test/entityTransform.test.ts`

**Interfaces:**
- Produces: `translateEntityPairs(ACAD_TABLE pairs, dx, 0)` → `10` += dx, `11` 그대로; `entityPointsOf` → `[[x10, y20]]`; `isCopyable(ACAD_TABLE)` → `false`.

- [ ] **Step 1: 실패하는 테스트 추가**

`server/test/entityTransform.test.ts` 끝에 추가(기존 import에 `entityPointsOf`, `isCopyable`, `translateEntityPairs`가 있는지 확인하고 없으면 추가):

```ts
describe('ACAD_TABLE — 삽입점만 옮기고 방향 벡터는 두며, 복사하지 않는다', () => {
  const TABLE: DxfPair[] = [
    pair(0, 'ACAD_TABLE'), pair(5, 'A0'), pair(330, '1F'), pair(100, 'AcDbEntity'), pair(8, '0'),
    pair(100, 'AcDbBlockReference'), pair(2, '*T1'), pair(10, '2000.0'), pair(20, '3400.0'), pair(30, '0.0'),
    pair(100, 'AcDbTable'), pair(342, '88'), pair(343, '31'), pair(11, '1.0'), pair(21, '0.0'), pair(31, '0.0'),
    pair(91, '        5'), pair(92, '        8'), pair(141, '40.0'), pair(142, '100.0'),
  ];

  it('translateEntityPairs는 10/20만 옮기고 11/21(방향)은 그대로 둔다', () => {
    const moved = translateEntityPairs(TABLE, 500, 0);
    expect(moved.find((p) => p.code === 10)!.value).toBe('2500.0');
    expect(moved.find((p) => p.code === 20)!.value).toBe('3400.0');
    expect(moved.find((p) => p.code === 11)!.value).toBe('1.0');
    expect(moved.find((p) => p.code === 21)!.value).toBe('0.0');
  });

  it('entityPointsOf는 삽입점 하나만 낸다', () => {
    expect(entityPointsOf(TABLE)).toEqual([[2000, 3400]]);
  });

  it('isCopyable은 false다 — 표는 tableClone으로만 복제한다', () => {
    expect(isCopyable(TABLE)).toBe(false);
  });
});
```

`pair`는 `../src/export/dxfDocument.js`에서, `DxfPair` 타입도 거기서 가져온다.

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run test/entityTransform.test.ts`
Expected: FAIL — `11`이 `501.0`으로 바뀌고, `isCopyable`이 true.

- [ ] **Step 3: 구현**

`ROLES` 맵의 `HATCH` 항목 뒤에 추가:

```ts
  // ACAD_TABLE의 10/20은 삽입점, 11/21은 가로 방향 벡터(1,0)다 — 일반 규칙은 11/21까지 점으로
  // 보고 옮겨 표를 깨뜨린다(2026-10-02 설계 5.3). 열 너비·행 높이(141/142)는 배율과 무관한
  // 표 로컬 값이라 lengths에 넣지 않는다(transform은 표에 쓰지 않는다 — 복제는 tableClone이 한다).
  ['ACAD_TABLE', { ...NONE, points: [[10, 20]], vectors: [[11, 21]] }],
```

`isCopyable` 첫 줄 `if (!ROLES.has(type)) return false;` 바로 뒤에:

```ts
  // 표는 글자 블록·블록 레코드까지 한 벌이라 엔티티만 베끼면 안 된다 — tableClone.ts가 맡는다.
  if (type === 'ACAD_TABLE') return false;
```

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run test/entityTransform.test.ts test/sheetCopy.test.ts`
Expected: PASS (기존 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/entityTransform.ts server/test/entityTransform.test.ts
git commit -m "ACAD_TABLE은 삽입점만 옮기고 방향 벡터는 두며, 엔티티 단독 복사는 막는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 블록·심볼 표 위치 조회 (`dxfDocument.ts`)

**Files:**
- Modify: `server/src/export/dxfDocument.ts` (끝에 추가)
- Test: `server/test/dxfDocument.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BlockLocation {
    /** (0, BLOCK) 쌍의 인덱스 */ start: number;
    /** (0, ENDBLK) 쌍의 인덱스 — 이 앞에 엔티티를 끼워 넣는다 */ endblkIndex: number;
    /** ENDBLK 엔티티 다음 (0, …) 쌍의 인덱스 — 여기에 다음 블록을 넣는다 */ end: number;
    /** BLOCK 머리의 330 = 이 블록의 BLOCK_RECORD 핸들 */ recordHandle: string;
  }
  export function findBlock(doc: DxfDocument, name: string): BlockLocation | null
  export interface SymbolTableInfo { handle: string; /** (70, 개수) 쌍의 인덱스, 없으면 -1 */ countIndex: number; /** (0, ENDTAB) 쌍의 인덱스 */ end: number }
  export function symbolTableInfo(doc: DxfDocument, tableName: string): SymbolTableInfo | null
  ```

- [ ] **Step 1: 실패하는 테스트**

`server/test/dxfDocument.test.ts`에 추가(파일 상단 import에 `findBlock`, `symbolTableInfo` 추가; `templateText`는 `./fixtureDocs.js`):

```ts
describe('findBlock · symbolTableInfo', () => {
  it('블록의 BLOCK/ENDBLK 자리와 레코드 핸들을 돌려준다', async () => {
    const doc = parseDxf(await templateText());
    const block = findBlock(doc, '*TX')!;
    expect(block).not.toBeNull();
    expect(doc.pairs[block.start]).toMatchObject({ code: 0, value: 'BLOCK' });
    expect(doc.pairs[block.endblkIndex]).toMatchObject({ code: 0, value: 'ENDBLK' });
    // *TX는 마지막 블록이라 ENDBLK 다음 (0, …)은 ENDSEC이다
    expect(doc.pairs[block.end]).toMatchObject({ code: 0, value: 'ENDSEC' });
    expect(block.recordHandle).toBe('31');
    expect(findBlock(doc, '없는블록')).toBeNull();
  });

  it('심볼 표의 핸들·개수 자리·ENDTAB 자리를 돌려준다', async () => {
    const doc = parseDxf(await templateText());
    const info = symbolTableInfo(doc, 'BLOCK_RECORD')!;
    expect(info.handle).toBe('1');
    expect(doc.pairs[info.countIndex]).toMatchObject({ code: 70 });
    expect(doc.pairs[info.countIndex].value.trim()).toBe('3');
    expect(doc.pairs[info.end]).toMatchObject({ code: 0, value: 'ENDTAB' });
    expect(symbolTableInfo(doc, 'NOPE')).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd server && npx vitest run test/dxfDocument.test.ts`
Expected: FAIL — export 없음.

- [ ] **Step 3: 구현** — `dxfDocument.ts` 끝에:

```ts
export interface BlockLocation {
  /** (0, BLOCK) 쌍의 인덱스 */
  start: number;
  /** (0, ENDBLK) 쌍의 인덱스 — 이 앞에 엔티티를 끼워 넣는다 */
  endblkIndex: number;
  /** ENDBLK 엔티티 다음 (0, …) 쌍의 인덱스 — 여기에 다음 블록을 넣는다 */
  end: number;
  /** BLOCK 머리의 330 = 이 블록의 BLOCK_RECORD 핸들 */
  recordHandle: string;
}

// BLOCKS 구역에서 이름이 name인 블록의 자리. 이름은 BLOCK 머리의 코드 2로 본다(코드 3도 같은
// 이름이지만 2가 먼저 온다).
export function findBlock(doc: DxfDocument, name: string): BlockLocation | null {
  const section = findSection(doc, 'BLOCKS');
  if (!section) return null;
  const { pairs } = doc;
  for (let i = section.start; i < section.end; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'BLOCK') continue;
    let recordHandle = '';
    let found = false;
    let j = i + 1;
    for (; j < section.end && pairs[j].code !== 0; j++) {
      if (pairs[j].code === 330 && !recordHandle) recordHandle = pairs[j].value.trim();
      else if (pairs[j].code === 2 && pairs[j].value === name) found = true;
    }
    if (!found) continue;
    let endblkIndex = -1;
    for (let k = j; k < section.end; k++) {
      if (pairs[k].code === 0 && pairs[k].value === 'ENDBLK') {
        endblkIndex = k;
        break;
      }
    }
    if (endblkIndex < 0) return null;
    let end = endblkIndex + 1;
    while (end < pairs.length && pairs[end].code !== 0) end += 1;
    return { start: i, endblkIndex, end, recordHandle };
  }
  return null;
}

export interface SymbolTableInfo {
  /** 표 자신의 핸들(코드 5) — 새 레코드의 소유자(330) */
  handle: string;
  /** 표 머리의 (70, 개수) 쌍 인덱스. 없으면 -1 */
  countIndex: number;
  /** (0, ENDTAB) 쌍의 인덱스 — 새 레코드는 여기에 넣는다 */
  end: number;
}

export function symbolTableInfo(doc: DxfDocument, tableName: string): SymbolTableInfo | null {
  const table = findTable(doc, tableName);
  if (!table) return null;
  let handle = '';
  let countIndex = -1;
  for (let i = table.start + 2; i < table.end && doc.pairs[i].code !== 0; i++) {
    if (doc.pairs[i].code === 5 && !handle) handle = doc.pairs[i].value.trim();
    else if (doc.pairs[i].code === 70 && countIndex < 0) countIndex = i;
  }
  return { handle, countIndex, end: table.end };
}
```

- [ ] **Step 4: 통과 확인** — `cd server && npx vitest run test/dxfDocument.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/dxfDocument.ts server/test/dxfDocument.test.ts
git commit -m "블록 자리와 심볼 표 머리를 찾는 findBlock·symbolTableInfo를 더한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 편집 큐 (`documentEdits.ts`)

**Files:**
- Create: `server/src/export/documentEdits.ts`
- Test: `server/test/documentEdits.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class DocumentEdits {
    insert(at: number, pairs: DxfPair[]): void;        // [at, at) 자리에 끼워 넣기
    replace(start: number, end: number, pairs: DxfPair[]): void;  // [start, end)를 pairs로
    get size(): number;
    apply(doc: DxfDocument): void;                       // doc.pairs를 새 배열로 바꾼다
  }
  ```
  규칙: 모든 인덱스는 **적용 전 원본 `doc.pairs`** 기준. 교체 구간은 서로 겹치면 던진다. 같은 자리의 삽입 여러 개는 추가한 순서대로 놓인다. 인자 전개(`splice(...)`) 없이 slice/concat으로 조립한다.

- [ ] **Step 1: 실패하는 테스트** — `server/test/documentEdits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DocumentEdits } from '../src/export/documentEdits.js';
import { pair, type DxfDocument, type DxfPair } from '../src/export/dxfDocument.js';

function docOf(values: string[]): DxfDocument {
  return { pairs: values.map((v) => pair(0, v)), eol: '\n', trailingEol: true };
}
function valuesOf(doc: DxfDocument): string[] {
  return doc.pairs.map((p) => p.value);
}
const P = (v: string): DxfPair => pair(1, v);

describe('DocumentEdits', () => {
  it('삽입·교체를 원본 인덱스 기준으로 한꺼번에 적용한다', () => {
    const doc = docOf(['a', 'b', 'c', 'd', 'e']);
    const edits = new DocumentEdits();
    edits.replace(3, 4, [P('D1'), P('D2')]); // d → D1 D2
    edits.insert(1, [P('x')]);              // a | x | b
    edits.insert(5, [P('end')]);            // 맨 뒤
    edits.replace(0, 1, []);                // a 삭제
    expect(edits.size).toBe(4);
    edits.apply(doc);
    expect(valuesOf(doc)).toEqual(['x', 'b', 'c', 'D1', 'D2', 'e', 'end']);
  });

  it('같은 자리의 삽입은 추가한 순서대로 놓인다', () => {
    const doc = docOf(['a', 'b']);
    const edits = new DocumentEdits();
    edits.insert(1, [P('1')]);
    edits.insert(1, [P('2')]);
    edits.apply(doc);
    expect(valuesOf(doc)).toEqual(['a', '1', '2', 'b']);
  });

  it('교체 구간이 겹치면 apply가 던진다', () => {
    const doc = docOf(['a', 'b', 'c']);
    const edits = new DocumentEdits();
    edits.replace(0, 2, []);
    edits.replace(1, 3, []);
    expect(() => edits.apply(doc)).toThrow(/겹/);
  });

  it('편집이 없으면 배열을 바꾸지 않는다', () => {
    const doc = docOf(['a']);
    const before = doc.pairs;
    new DocumentEdits().apply(doc);
    expect(doc.pairs).toBe(before);
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run test/documentEdits.test.ts` → 모듈 없음.

- [ ] **Step 3: 구현** — `server/src/export/documentEdits.ts`:

```ts
// 여러 구역(TABLES·BLOCKS·ENTITIES)에 흩어진 삽입·교체를 모아 두었다가 한 번에 적용한다.
// 인덱스는 전부 적용 전 원본 doc.pairs 기준이다 — 앞 구역에 끼워 넣어도 뒤 구역의 범위
// (EntityRange)가 밀리지 않도록, 적용은 한 번만 하고 호출부는 그 뒤로 범위를 쓰지 않는다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 6장 4단계

import type { DxfDocument, DxfPair } from './dxfDocument.js';

interface Edit {
  start: number;
  end: number;
  pairs: DxfPair[];
  /** 추가한 순서. 같은 자리의 삽입이 추가한 순서대로 놓이게 한다 */
  seq: number;
}

export class DocumentEdits {
  private readonly edits: Edit[] = [];

  insert(at: number, pairs: DxfPair[]): void {
    this.replace(at, at, pairs);
  }

  replace(start: number, end: number, pairs: DxfPair[]): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`잘못된 편집 구간입니다: [${start}, ${end})`);
    }
    this.edits.push({ start, end, pairs, seq: this.edits.length });
  }

  get size(): number {
    return this.edits.length;
  }

  // 앞에서 뒤로 한 번 훑으며 원본 조각과 새 조각을 번갈아 이어 붙인다. 인자 전개 없음 —
  // 손상 수천 개 분량의 쌍을 다룰 수 있어야 한다(exportDrawing.ts의 appendAll 주석 참고).
  apply(doc: DxfDocument): void {
    if (this.edits.length === 0) return;
    const sorted = [...this.edits].sort((a, b) => a.start - b.start || a.seq - b.seq);
    const source = doc.pairs;
    const out: DxfPair[] = [];
    let cursor = 0;
    for (const edit of sorted) {
      if (edit.start < cursor) throw new Error(`편집 구간이 겹칩니다: [${edit.start}, ${edit.end})`);
      if (edit.end > source.length) throw new Error(`편집 구간이 문서를 벗어납니다: [${edit.start}, ${edit.end})`);
      for (let i = cursor; i < edit.start; i++) out.push(source[i]);
      for (const p of edit.pairs) out.push(p);
      cursor = edit.end;
    }
    for (let i = cursor; i < source.length; i++) out.push(source[i]);
    doc.pairs = out;
  }
}
```

- [ ] **Step 4: 통과 확인** — `cd server && npx vitest run test/documentEdits.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/documentEdits.ts server/test/documentEdits.test.ts
git commit -m "여러 구역의 삽입·교체를 모아 한 번에 적용하는 DocumentEdits를 더한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 모델 공간 표 픽스처 빌더 + 틀 인식 (`fixtureDocs.ts`, `frames.ts`)

**Files:**
- Modify: `server/test/fixtureDocs.ts` (끝에 추가)
- Modify: `server/src/export/frames.ts`
- Test: `server/test/frames.test.ts`

**Interfaces:**
- Produces (fixtureDocs): `modelSpaceTemplate(frameCount = 1): Promise<string>` — 템플릿에서 블록 안 표를 빼고, 블록에 LINE (0,0)-(2000,2000)을 넣고, 틀 k(0부터)마다 `망도틀` INSERT(x = 1000 + 50000k, y 2000, 배율 2)와 모델 공간 `ACAD_TABLE`(핸들 `A${k}`, 삽입점 (2000 + 50000k, 3400), 글자 블록 k=0 → `*TX`(레코드 31), k≥1 → `*TX${k}`(레코드 `${k}31`, 블록 엔티티 핸들 `${k}60`~`${k}76`))을 넣는다. 셀 묶음은 5행 × 8열 = 40개(0행 0열 `손상물량표`, 1행 머리글 8개, 2~4행 0열 정수 1·2·3, 나머지 빈 칸).
  틀 k 영역: x 1000+50000k ~ 5000+50000k, y 2000~6000. 표 영역: x 2000+50000k ~ 3140+50000k, y 3280~3400. 표 로컬 격자: 열 경계 0,100,250,550,670,790,890,1030,1140; 행 경계 0,−40,−60,−80,−100,−120; `firstDataRow` 2, 데이터 행 3, 번호 열 0, 글자 높이 10, 번호 글자 `41` 없음(여백 0).
- Produces (frames): `Frame.tableKind: 'inBlock' | 'modelSpace'`, `Frame.tableEntityIndex: number | null`.

- [ ] **Step 1: 픽스처 빌더** — `server/test/fixtureDocs.ts` 끝에 추가:

```ts
// ───────── 모델 공간 표 템플릿(2026-10-02 설계) ─────────
// 새 사내 템플릿은 망도틀 블록 안에 표가 없고 모델 공간에 틀마다 ACAD_TABLE이 놓인다.
// 픽스처 템플릿을 그 모양으로 바꾼다: 블록 안 표를 빼고 LINE 하나로 영역을 만들고, 틀마다
// INSERT + 표(셀 묶음 포함)를 넣는다. 글자 블록은 틀 0이 *TX를 그대로 쓰고 틀 k≥1은 *TXk 사본.

const CELL_ATTRS = ['171', '     1', '172', '     0', '173', '     0', '174', '     0', '175', '     1', '176', '     1', ' 91', '        32', '178', '     0', ' 92', '        0'];

function stringCell(text: string): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        0', ' 90', '        4', '  1', text, ' 94', '        0', '302', text, '304', 'ACVALUE_END'];
}
function intCell(n: number): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        0', ' 90', '        1', ' 91', String(n).padStart(9, ' '), ' 94', '        0', '300', '', '302', String(n), '304', 'ACVALUE_END'];
}
function emptyCell(): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        3', ' 90', '        0', ' 91', '        0', ' 94', '        0', '300', '', '302', '', '304', 'ACVALUE_END'];
}

const MODEL_TABLE_HEADERS = ['번호', '손상위치', '손상현황', '가로/폭', '세로/길이', '개소', '면적/연장', '단위'];

// 모델 공간 ACAD_TABLE 한 벌. 5행 × 8열, 행 높이 40·20×4, 열 너비는 템플릿 표와 같다.
function modelTableText(handle: string, x: number, blockName: string, recordHandle: string): string {
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      if (row === 0) cells.push(...(col === 0 ? stringCell('손상물량표') : emptyCell()));
      else if (row === 1) cells.push(...stringCell(MODEL_TABLE_HEADERS[col]));
      else cells.push(...(col === 0 ? intCell(row - 1) : emptyCell()));
    }
  }
  return [
    '  0', 'ACAD_TABLE', '  5', handle, '102', '{ACAD_XDICTIONARY', '360', 'FF', '102', '}', '330', '1F',
    '100', 'AcDbEntity', '  8', '0', '160', '                 4', '310', '00000000',
    '100', 'AcDbBlockReference', '  2', blockName, ' 10', x.toFixed(1), ' 20', '3400.0', ' 30', '0.0',
    '100', 'AcDbTable', '342', '88', '343', recordHandle, ' 11', '1.0', ' 21', '0.0', ' 31', '0.0',
    ' 90', '       22', ' 91', '        5', ' 92', '        8', ' 93', '       24', ' 94', '        0',
    '141', '40.0', '141', '20.0', '141', '20.0', '141', '20.0', '141', '20.0',
    '142', '100.0', '142', '150.0', '142', '300.0', '142', '120.0', '142', '120.0', '142', '100.0', '142', '140.0', '142', '110.0',
    ...cells, '',
  ].join('\n');
}

// *TX 블록(BLOCK…ENDBLK)을 이름 *TXk·레코드 k31·핸들 k60~k76으로 베낀다.
function tableBlockCopy(text: string, k: number): string {
  const start = text.indexOf('  0\nBLOCK\n  5\n60\n');
  const end = text.indexOf('  0\nENDSEC\n', start);
  if (start < 0 || end < 0) throw new Error('픽스처의 *TX 블록을 찾지 못했습니다');
  return text
    .slice(start, end)
    .replace(/\n  5\n([67][0-9A-F])\n/g, (_m, h: string) => `\n  5\n${k}${h}\n`)
    .replace(/\n330\n31\n/g, `\n330\n${k}31\n`)
    .replace(/\n  2\n\*TX\n/g, `\n  2\n*TX${k}\n`)
    .replace(/\n  3\n\*TX\n/g, `\n  3\n*TX${k}\n`);
}

function blockRecordText(handle: string, name: string): string {
  return ['  0', 'BLOCK_RECORD', '  5', handle, '330', '1', '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', name, ' 70', '     1', ''].join('\n');
}

/** 표가 블록 밖(모델 공간)에 있는 새 템플릿 모양. frameCount개의 틀을 x = 1000 + 50000k에 놓는다. */
export async function modelSpaceTemplate(frameCount = 1): Promise<string> {
  let text = await templateText();
  // 블록 안 표를 빼고 LINE으로 영역을 만든다(블록 좌표 (0,0)-(2000,2000) → 모델 (1000,2000)-(5000,6000)).
  const tableStart = text.indexOf('  0\nACAD_TABLE\n');
  const tableEnd = text.indexOf('  0\nENDBLK\n  5\n52\n');
  if (tableStart < 0 || tableEnd < tableStart) throw new Error('픽스처의 ACAD_TABLE을 찾지 못했습니다');
  text = text.slice(0, tableStart) + FRAME_LINE + text.slice(tableEnd);
  // 원본 INSERT(x 1000)를 지우고 틀마다 INSERT + 표를 LINE 81 앞에 넣는다.
  text = replaceOnce(text, FRAME_INSERT, '');
  let entities = '';
  let blocks = '';
  let records = '';
  for (let k = 0; k < frameCount; k++) {
    const x = 1000 + 50000 * k;
    const insertHandle = k === 0 ? '80' : `8${k}0`;
    entities += FRAME_INSERT.replace('\n80\n', `\n${insertHandle}\n`).replace('\n1000.0\n', `\n${x.toFixed(1)}\n`);
    const blockName = k === 0 ? '*TX' : `*TX${k}`;
    const record = k === 0 ? '31' : `${k}31`;
    entities += modelTableText(`A${k}`, 2000 + 50000 * k, blockName, record);
    if (k > 0) {
      blocks += tableBlockCopy(text, k);
      records += blockRecordText(record, blockName);
    }
  }
  text = replaceOnce(text, '  0\nLINE\n  5\n81\n', entities + '  0\nLINE\n  5\n81\n');
  if (blocks) text = replaceOnce(text, '  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n', blocks + '  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n');
  if (records) text = replaceOnce(text, '  0\nENDTAB\n  0\nENDSEC\n  0\nSECTION\n  2\nBLOCKS\n', records + '  0\nENDTAB\n  0\nENDSEC\n  0\nSECTION\n  2\nBLOCKS\n');
  return text;
}
```

주의: `FRAME_LINE`·`FRAME_INSERT`·`replaceOnce`는 이미 이 파일에 있다. `tableBlockCopy`의 핸들 정규식은 템플릿 `*TX` 블록 핸들(60~76)만 잡는다 — `6`·`7`로 시작하는 두 자리 16진수. `k31`·`k60` 같은 핸들은 HANDSEED(0x200)보다 클 수 있지만 `createHandleAllocator`가 최대 핸들 + 1에서 시작하므로 겹치지 않는다.

- [ ] **Step 2: 실패하는 테스트** — `server/test/frames.test.ts`에 추가(import에 `modelSpaceTemplate` 추가):

```ts
describe('findFrames — 표가 블록 밖(모델 공간)에 놓인 새 템플릿', () => {
  it('블록 영역 안에 놓인 모델 공간 표를 틀의 표로 받는다', async () => {
    const frames = await framesOf(await modelSpaceTemplate());
    expect(frames).toHaveLength(1);
    expect(frames[0].tableKind).toBe('modelSpace');
    expect(frames[0].bounds).toEqual({ minX: 1000, minY: 2000, maxX: 5000, maxY: 6000 });
    expect(frames[0].table.blockName).toBe('*TX');
    expect(frames[0].table.position).toEqual([2000, 3400]);
    expect(frames[0].table.transform).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: 0 });
    expect(frames[0].entityIndex).toBe(0);
    expect(frames[0].tableEntityIndex).toBe(1); // INSERT 다음이 그 틀의 표
  });

  it('틀마다 자기 영역 안의 표를 가진다 — 왼쪽부터 0번', async () => {
    const frames = await framesOf(await modelSpaceTemplate(2));
    expect(frames.map((f) => f.index)).toEqual([0, 1]);
    expect(frames[1].bounds.minX).toBe(51000);
    expect(frames[1].table.blockName).toBe('*TX1');
    expect(frames[1].table.position).toEqual([52000, 3400]);
    expect(frames[1].tableEntityIndex).toBe(3);
  });

  it('옛 구조(블록 안 표)는 inBlock이고 tableEntityIndex가 null이다', async () => {
    const frames = await framesOf(await templateText());
    expect(frames[0].tableKind).toBe('inBlock');
    expect(frames[0].tableEntityIndex).toBeNull();
  });

  it('표 중심이 어느 블록 영역에도 없으면 틀이 아니다', async () => {
    // 표 삽입점을 영역 밖(x 20000)으로 옮긴다.
    const text = (await modelSpaceTemplate()).replace('\n 10\n2000.0\n 20\n3400.0\n', '\n 10\n20000.0\n 20\n3400.0\n');
    expect(await framesOf(text)).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd server && npx vitest run test/frames.test.ts` → 틀 0개·`tableKind` 없음.

- [ ] **Step 4: 구현** — `server/src/export/frames.ts`:

`Frame` 인터페이스에 추가:

```ts
  /** 표가 블록 안에 있는 옛 구조인지, 블록 밖 모델 공간에 놓인 새 구조인지(2026-10-02 설계 3장) */
  tableKind: 'inBlock' | 'modelSpace';
  /** modelSpace일 때 그 ACAD_TABLE의 모델 공간 최상위 순번. inBlock이면 null */
  tableEntityIndex: number | null;
```

`import { IDENTITY, … } from './tableGrid.js'`에 `IDENTITY`·`tableCenter` 추가. 파일 머리 주석 첫 줄을 `// 망도틀을 찾아 영역과 그 틀의 손상물량표를 돌려준다. 표는 블록 안에 들어 있거나(옛 구조) 블록 영역 안의 모델 공간에 놓여 있다(새 구조, 2026-10-02 설계).`로 바꾼다.

`findFrames` 본문을 이렇게 바꾼다:

```ts
export function findFrames(doc: DxfDocument): Frame[] {
  const model = readModelSpace(doc);
  if (!model) return [];

  // 모델 공간 최상위 표(새 구조). 블록 안에 표가 없는 INSERT가 영역 안의 표를 고를 때 쓴다.
  const looseTables: Array<{ entityIndex: number; candidate: TableCandidate; center: Point }> = [];
  for (let i = 0; i < model.entities.length; i++) {
    const entity = model.entities[i];
    if (entity.type !== 'ACAD_TABLE') continue;
    const candidate = tableCandidateOf(entity, IDENTITY);
    if (candidate) looseTables.push({ entityIndex: i, candidate, center: tableCenter(candidate) });
  }
  const claimed = new Set<number>();

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
    const tables: TableCandidate[] = [];
    const transform = insertTransform(entity);

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

    if (tables.length > 0) {
      found.push({ bounds: { minX, minY, maxX, maxY }, table: tables[0], blockName: name, entityIndex, transform, tableKind: 'inBlock', tableEntityIndex: null });
      continue;
    }
    if (minX === Infinity) continue; // 점이 없는 블록은 영역이 없다

    // 블록 안에 표가 없으면 영역 안(경계 포함)에 중심이 놓인 모델 공간 표를 찾는다. 여럿이면
    // 왼쪽 것. 한 표는 한 틀에만 속한다.
    let picked: (typeof looseTables)[number] | null = null;
    for (const loose of looseTables) {
      if (claimed.has(loose.entityIndex)) continue;
      const [cx, cy] = loose.center;
      if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
      if (!picked || cx < picked.center[0]) picked = loose;
    }
    if (!picked) continue;
    claimed.add(picked.entityIndex);
    found.push({
      bounds: { minX, minY, maxX, maxY },
      table: picked.candidate,
      blockName: name,
      entityIndex,
      transform,
      tableKind: 'modelSpace',
      tableEntityIndex: picked.entityIndex,
    });
  }

  found.sort((a, b) => a.bounds.minX - b.bounds.minX || b.bounds.maxY - a.bounds.maxY);
  return found.map((frame, index) => ({ ...frame, index }));
}
```

- [ ] **Step 5: 통과 확인** — `cd server && npx vitest run test/frames.test.ts test/sheetCopy.test.ts test/exportDrawing.test.ts`
Expected: PASS. (`sheetCopy.test.ts`·`exportDrawing.test.ts`에서 `Frame`을 직접 만드는 곳이 있으면 `tableKind: 'inBlock', tableEntityIndex: null`을 더한다.)

- [ ] **Step 6: 커밋**

```bash
git add server/src/export/frames.ts server/test/fixtureDocs.ts server/test/frames.test.ts
git commit -m "블록 영역 안에 놓인 모델 공간 표도 망도틀의 표로 알아본다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 셀 채우기 순수 함수 (`tableCells.ts`, `tableGrid.ts` 보강)

**Files:**
- Modify: `server/src/export/tableGrid.ts` (`BlockText.width`, `TableGrid.textWidth`, `isPrintedNumber` 이전)
- Modify: `server/src/export/sheetCopy.ts` (`isPrintedNumber`를 tableGrid에서 import)
- Create: `server/src/export/tableCells.ts`
- Test: `server/test/tableCells.test.ts`

**Interfaces:**
- Produces (tableGrid): `BlockText.width: number`(코드 41, 없으면 0), `TableGrid.textWidth: number`(번호 `1` 글자의 41, 없으면 0), `export function isPrintedNumber(grid, entity): boolean`(sheetCopy에서 이전, 동작 같음).
- Produces (tableCells):
  ```ts
  export interface CellWrite { /** 표 행 인덱스(0부터, 머리글 포함) */ row: number; column: number; value: string | number }
  export function cellWritesFor(grid: TableGrid, rows: TableRow[]): CellWrite[]
  export function numberColumnWrites(grid: TableGrid, page: number): CellWrite[]   // 데이터 행 i → page·N + i (정수)
  export function writeCellValues(tablePairs: DxfPair[], columnCount: number, writes: CellWrite[]): DxfPair[]
  export function stripGraphicsCache(tablePairs: DxfPair[]): DxfPair[]
  export function cellMargin(grid: TableGrid): number
  export function cellMtextPairs(grid: TableGrid, write: CellWrite, handle: string, recordHandle: string): DxfPair[]
  export function appendBeforeEndblk(blockPairs: DxfPair[], extra: DxfPair[]): DxfPair[]
  ```

- [ ] **Step 1: tableGrid 보강**

`BlockText`에 `/** MTEXT 너비(코드 41). 없으면 0 */ width: number;` 추가. `buildGrid`의 `texts.push({...})`에 `width: numberAt(entity, 41, 0),` 추가. `TableGrid`에 `/** 번호 '1' 글자의 너비(코드 41). 없으면 0 — 셀 글자 여백 계산에 쓴다 */ textWidth: number;` 추가하고, `firstDataRow`를 고르는 루프에서 `textHeight = text.height;` 옆에 `textWidth = text.width;`(변수 `let textWidth = 0;` 선언), 반환 객체에 `textWidth,` 추가.

`sheetCopy.ts`의 `isPrintedNumber` 함수(201~207행)를 **삭제**하고 `tableGrid.ts` 끝에 export로 옮긴다:

```ts
/** 이 글자가 번호 열의 **데이터 행** 칸에 있는가(= 미리 인쇄된 번호인가). 좌표는 표 로컬이다. */
export function isPrintedNumber(grid: TableGrid, entity: RawEntity): boolean {
  const local: Point = [numberAt(entity, 10, 0), numberAt(entity, 20, 0)];
  if (indexOfBand(grid.colBoundaries, local[0]) !== grid.numberColumn) return false;
  const row = indexOfBand(grid.rowBoundaries, local[1]);
  return row >= grid.firstDataRow;
}
```

`sheetCopy.ts`의 `tableGrid.js` import 목록에 `isPrintedNumber`를 더한다.

- [ ] **Step 2: 실패하는 테스트** — `server/test/tableCells.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pair, parseDxf, type DxfPair } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import {
  appendBeforeEndblk,
  cellMargin,
  cellMtextPairs,
  cellWritesFor,
  numberColumnWrites,
  stripGraphicsCache,
  writeCellValues,
} from '../src/export/tableCells.js';
import { rowValuesOf } from '../src/export/tableFill.js';
import { buildGrid, modelSpaceRanges, type TableGrid } from '../src/export/tableGrid.js';
import { modelSpaceTemplate } from './fixtureDocs.js';

async function setup() {
  const doc = parseDxf(await modelSpaceTemplate());
  const frame = findFrames(doc)[0];
  const grid = buildGrid(doc, frame.table)!;
  const range = modelSpaceRanges(doc)[frame.tableEntityIndex!];
  return { doc, grid, tablePairs: doc.pairs.slice(range.start, range.end) };
}

// 셀 순번 n(행 우선)의 CELL_VALUE 묶음(301~304)을 돌려준다.
function cellGroup(pairs: DxfPair[], n: number): DxfPair[] {
  let index = -1;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code === 171) index += 1;
    if (index === n && pairs[i].code === 301) {
      const end = pairs.findIndex((p, j) => j > i && p.code === 304);
      return pairs.slice(i, end + 1);
    }
  }
  throw new Error(`셀 ${n} 없음`);
}

const DAMAGE = {
  id: 'd1', type: 'spalling', geometry: { kind: 'rect', world: [], dwg: [] }, copies: [],
  measured: { width: 1.2, length: 1.5, count: 2 }, computed: {}, attrs: { note: '', statusText: '', photoNumbers: [] },
};

describe('cellWritesFor · numberColumnWrites', () => {
  it('번호 행을 표 행 인덱스로 옮기고 값이 있는 열만 낸다', async () => {
    const { grid } = await setup();
    const writes = cellWritesFor(grid, [rowValuesOf(DAMAGE, 2)]);
    // firstDataRow 2 → 번호 2는 행 3. 손상현황(2)·가로(3)·세로(4)·개소(5)·면적(6)·단위(7)
    expect(writes.map((w) => [w.row, w.column])).toEqual([[3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7]]);
    expect(writes.find((w) => w.column === 5)!.value).toBe('2');
    expect(writes.every((w) => typeof w.value === 'string' && w.value !== '')).toBe(true);
  });

  it('빈 행(필드 없음)은 아무 것도 내지 않는다', async () => {
    const { grid } = await setup();
    expect(cellWritesFor(grid, [{ number: 1, fields: {} }])).toEqual([]);
  });

  it('번호 열은 장 번호에 맞춰 정수로 낸다', async () => {
    const { grid } = await setup();
    expect(numberColumnWrites(grid, 1)).toEqual([
      { row: 2, column: 0, value: 4 }, { row: 3, column: 0, value: 5 }, { row: 4, column: 0, value: 6 },
    ]);
  });
});

describe('writeCellValues · stripGraphicsCache', () => {
  it('문자열 칸은 93 0 / 90 4 / 1 / 94 / 302 형식으로, 정수 칸은 90 1 / 91 / 300 / 302 형식으로 바뀐다', async () => {
    const { tablePairs } = await setup();
    const out = writeCellValues(tablePairs, 8, [{ row: 2, column: 2, value: '박락' }, { row: 3, column: 0, value: 36 }]);
    const text = cellGroup(out, 2 * 8 + 2).map((p) => [p.code, p.value]);
    expect(text).toEqual([[301, 'CELL_VALUE'], [93, '        0'], [90, '        4'], [1, '박락'], [94, '        0'], [302, '박락'], [304, 'ACVALUE_END']]);
    const num = cellGroup(out, 3 * 8 + 0).map((p) => [p.code, p.value]);
    expect(num).toEqual([[301, 'CELL_VALUE'], [93, '        0'], [90, '        1'], [91, '       36'], [94, '        0'], [300, ''], [302, '36'], [304, 'ACVALUE_END']]);
  });

  it('쓰지 않은 칸과 셀 속성(171~178)은 그대로다 — 쌍 수가 묶음 교체분만큼만 바뀐다', async () => {
    const { tablePairs } = await setup();
    const out = writeCellValues(tablePairs, 8, [{ row: 2, column: 2, value: '박락' }]);
    // 빈 칸 묶음 7쌍 → 문자열 묶음 7쌍: 길이 같다
    expect(out).toHaveLength(tablePairs.length);
    expect(cellGroup(out, 2 * 8 + 3)).toEqual(cellGroup(tablePairs, 2 * 8 + 3));
    expect(out.filter((p) => p.code === 171)).toHaveLength(40);
    expect(out).not.toBe(tablePairs);
  });

  it('stripGraphicsCache는 160·310을 지우고 나머지는 둔다', async () => {
    const { tablePairs } = await setup();
    const out = stripGraphicsCache(tablePairs);
    expect(out.some((p) => p.code === 160 || p.code === 310)).toBe(false);
    expect(out).toHaveLength(tablePairs.length - 2);
  });
});

describe('cellMargin · cellMtextPairs · appendBeforeEndblk', () => {
  it('번호 글자의 41이 없으면 여백은 0, 있으면 (열 너비 − 41) / 2', async () => {
    const { grid } = await setup();
    expect(cellMargin(grid)).toBe(0);
    expect(cellMargin({ ...grid, textWidth: 80 })).toBe(10); // 번호 열 너비 100
  });

  it('칸 가운데에 MTEXT를 만든다(표 로컬 좌표)', async () => {
    const { grid } = await setup();
    const pairs = cellMtextPairs({ ...grid, textWidth: 80 }, { row: 2, column: 2, value: '박락' }, '1A2', '31');
    const at = (code: number) => pairs.find((p) => p.code === code)!.value;
    expect(pairs[0]).toEqual(pair(0, 'MTEXT'));
    expect(at(5)).toBe('1A2');
    expect(at(330)).toBe('31');
    expect(at(8)).toBe('0');
    expect(at(10)).toBe('400.0'); // (250 + 550) / 2
    expect(at(20)).toBe('-70.0'); // (−60 + −80) / 2
    expect(at(40)).toBe('10.0');
    expect(at(41)).toBe('280.0'); // 300 − 2 × 10
    expect(at(71).trim()).toBe('5');
    expect(at(72).trim()).toBe('5');
    expect(at(1)).toBe('박락');
    expect(at(73).trim()).toBe('1');
    expect(at(44)).toBe('1.0');
    // 정수 값은 글자로
    expect(cellMtextPairs(grid, { row: 2, column: 0, value: 36 }, '1A3', '31').find((p) => p.code === 1)!.value).toBe('36');
  });

  it('appendBeforeEndblk는 (0, ENDBLK) 바로 앞에 끼운다', () => {
    const block = [pair(0, 'BLOCK'), pair(2, '*T1'), pair(0, 'LINE'), pair(0, 'ENDBLK'), pair(5, '9')];
    const out = appendBeforeEndblk(block, [pair(0, 'MTEXT')]);
    expect(out.map((p) => p.value)).toEqual(['BLOCK', '*T1', 'LINE', 'MTEXT', 'ENDBLK', '9']);
    expect(() => appendBeforeEndblk([pair(0, 'BLOCK')], [])).toThrow(/ENDBLK/);
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd server && npx vitest run test/tableCells.test.ts` → 모듈 없음.

- [ ] **Step 4: 구현** — `server/src/export/tableCells.ts`:

```ts
// 모델 공간에 놓인 손상물량표(ACAD_TABLE)의 셀을 직접 채운다. 표 엔티티의 셀 값 묶음을 바꾸고,
// 캐드가 실제로 그리는 `*T` 글자 블록에 같은 글자의 MTEXT를 넣고, 그래픽 캐시는 지운다.
// 지스타캐드 시험(2026-10-02): 셀 값만 바꾸면 보이지 않고, 글자 블록까지 넣어야 보이며 더블클릭
// 편집도 된다. 전부 DxfPair[]만 다루는 순수 함수다 — 문서에 적용하는 일은 exportDrawing.ts가 한다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 2·4장

import { formatInt, formatReal, pair, type DxfPair } from './dxfDocument.js';
import { resolvedColumnMap, type RowField, type TableRow } from './tableFill.js';
import type { TableGrid } from './tableGrid.js';

export interface CellWrite {
  /** 표 행 인덱스(0부터, 머리글 행 포함) */
  row: number;
  column: number;
  /** 문자열은 문자열 칸, 숫자는 정수 칸(번호 열)으로 쓴다 */
  value: string | number;
}

/** 번호 행 목록을 셀 쓰기로 바꾼다. 열은 머리글 키워드로 찾고(tableFill과 같다), 값이 있는 칸만 낸다. */
export function cellWritesFor(grid: TableGrid, rows: TableRow[]): CellWrite[] {
  const columnCount = grid.colBoundaries.length - 1;
  const { map } = resolvedColumnMap(grid.headers);
  const entries = Object.entries(map) as Array<[RowField, number]>;
  const writes: CellWrite[] = [];
  for (const row of rows) {
    if (row.number < 1 || row.number > grid.dataRowCount) continue;
    const rowIndex = grid.firstDataRow + row.number - 1;
    for (const [field, column] of entries) {
      if (column < 0 || column >= columnCount) continue;
      const value = row.fields[field];
      if (!value) continue;
      writes.push({ row: rowIndex, column, value });
    }
  }
  return writes;
}

/** 번호 열의 데이터 행 전부를 장 번호에 맞춰 `page·N + i`로 쓴다(복제 표용). */
export function numberColumnWrites(grid: TableGrid, page: number): CellWrite[] {
  const writes: CellWrite[] = [];
  for (let i = 1; i <= grid.dataRowCount; i++) {
    writes.push({ row: grid.firstDataRow + i - 1, column: grid.numberColumn, value: page * grid.dataRowCount + i });
  }
  return writes;
}

// 셀 값 묶음(설계 2장). 93 플래그·90 자료형·값·94·302 표시 글자·304 끝.
function valueGroup(value: string | number): DxfPair[] {
  if (typeof value === 'number') {
    return [
      pair(301, 'CELL_VALUE'),
      pair(93, '        0'),
      pair(90, '        1'),
      pair(91, formatInt(value).padStart(9, ' ')),
      pair(94, '        0'),
      pair(300, ''),
      pair(302, formatInt(value)),
      pair(304, 'ACVALUE_END'),
    ];
  }
  return [
    pair(301, 'CELL_VALUE'),
    pair(93, '        0'),
    pair(90, '        4'),
    pair(1, value),
    pair(94, '        0'),
    pair(302, value),
    pair(304, 'ACVALUE_END'),
  ];
}

/**
 * 표 엔티티 한 벌에서 지정한 셀의 CELL_VALUE 묶음(301 … 304)만 새 값으로 바꾼다. 셀은 171로
 * 시작하며 행 우선으로 늘어선다 — n번째 171이 셀 n이다. 묶음 밖의 셀 속성은 그대로 둔다.
 */
export function writeCellValues(tablePairs: DxfPair[], columnCount: number, writes: CellWrite[]): DxfPair[] {
  if (writes.length === 0) return tablePairs;
  const byCell = new Map<number, string | number>();
  for (const write of writes) byCell.set(write.row * columnCount + write.column, write.value);

  const out: DxfPair[] = [];
  let cell = -1;
  for (let i = 0; i < tablePairs.length; i++) {
    const p = tablePairs[i];
    if (p.code === 171) cell += 1;
    const value = byCell.get(cell);
    if (value !== undefined && p.code === 301 && p.value.trim() === 'CELL_VALUE') {
      let j = i;
      while (j < tablePairs.length && tablePairs[j].code !== 304) j += 1;
      for (const q of valueGroup(value)) out.push(q);
      i = j;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** 표의 그래픽 캐시(160 크기, 310 바이트)를 지운다 — 바뀐 셀과 어긋난 옛 그림이 남지 않게. */
export function stripGraphicsCache(tablePairs: DxfPair[]): DxfPair[] {
  return tablePairs.filter((p) => p.code !== 160 && p.code !== 310);
}

/** 글자 블록의 칸 안 여백 = (번호 열 너비 − 번호 글자 너비) / 2. 번호 글자 너비를 모르면 0. */
export function cellMargin(grid: TableGrid): number {
  if (!(grid.textWidth > 0)) return 0;
  const width = grid.colBoundaries[grid.numberColumn + 1] - grid.colBoundaries[grid.numberColumn];
  return Math.max(0, (width - grid.textWidth) / 2);
}

/**
 * 글자 블록(`*T`)에 넣을 MTEXT 한 벌(표 로컬 좌표, 칸 가운데). 모양은 원본 블록의 인쇄된 번호
 * 글자를 따른다 — 가운데 정렬(71 5), 글자 높이는 격자에서 읽은 값, 너비는 열 너비에서 여백을 뺀 값.
 */
export function cellMtextPairs(grid: TableGrid, write: CellWrite, handle: string, recordHandle: string): DxfPair[] {
  const left = grid.colBoundaries[write.column];
  const right = grid.colBoundaries[write.column + 1];
  const top = grid.rowBoundaries[write.row];
  const bottom = grid.rowBoundaries[write.row + 1];
  const width = Math.max(0, right - left - 2 * cellMargin(grid));
  const text = typeof write.value === 'number' ? formatInt(write.value) : write.value;
  return [
    pair(0, 'MTEXT'),
    pair(5, handle),
    pair(330, recordHandle),
    pair(100, 'AcDbEntity'),
    pair(8, '0'),
    pair(62, '     0'),
    pair(100, 'AcDbMText'),
    pair(10, formatReal((left + right) / 2)),
    pair(20, formatReal((top + bottom) / 2)),
    pair(30, '0.0'),
    pair(40, formatReal(grid.textHeight)),
    pair(41, formatReal(width)),
    pair(46, '0.0'),
    pair(71, '     5'),
    pair(72, '     5'),
    pair(1, text),
    pair(73, '     1'),
    pair(44, '1.0'),
  ];
}

/** BLOCK … ENDBLK 한 벌에서 (0, ENDBLK) 바로 앞에 엔티티들을 끼운다. */
export function appendBeforeEndblk(blockPairs: DxfPair[], extra: DxfPair[]): DxfPair[] {
  const at = blockPairs.findIndex((p) => p.code === 0 && p.value === 'ENDBLK');
  if (at < 0) throw new Error('블록에 ENDBLK가 없습니다');
  return blockPairs.slice(0, at).concat(extra, blockPairs.slice(at));
}
```

- [ ] **Step 5: 통과 확인** — `cd server && npx vitest run test/tableCells.test.ts test/tableGrid.test.ts test/sheetCopy.test.ts`

- [ ] **Step 6: 커밋**

```bash
git add server/src/export/tableCells.ts server/src/export/tableGrid.ts server/src/export/sheetCopy.ts server/test/tableCells.test.ts
git commit -m "표 셀 값 묶음과 글자 블록 MTEXT를 만드는 tableCells 순수 함수를 더한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 표 복제 (`tableClone.ts`)

**Files:**
- Create: `server/src/export/tableClone.ts`
- Test: `server/test/tableClone.test.ts`

**Interfaces:**
- Consumes: `findBlock`, `symbolTableInfo`(Task 2), `writeCellValues`, `stripGraphicsCache`, `numberColumnWrites`(Task 5), `isPrintedNumber`(Task 5), `entityRanges`/`rawEntityAt`/`indexOfBand`(tableGrid), `HandleAllocator`.
- Produces:
  ```ts
  export function usedTableNames(doc: DxfDocument): Set<string>           // 코드 2·3 값 중 /^\*T\d+$/
  export function nextTableName(used: Set<string>): string                 // 최대 번호 + 1, used에 넣고 돌려줌
  export interface TableClone {
    blockName: string; recordHandle: string; tableHandle: string;
    recordPairs: DxfPair[];   // BLOCK_RECORD 한 벌 (ENDTAB 앞에)
    blockPairs: DxfPair[];    // BLOCK … ENDBLK 한 벌 (원본 블록 뒤에)
    tablePairs: DxfPair[];    // ACAD_TABLE 한 벌 (ENTITIES 끝에) — 번호 열은 page·N+i, 캐시·확장 사전 없음
  }
  export interface CloneOptions { dx: number; page: number; name: string; alloc: HandleAllocator; recordTableHandle: string }
  export function cloneTable(doc: DxfDocument, tablePairs: DxfPair[], grid: TableGrid, options: CloneOptions): TableClone | null
  ```
  `null`은 글자 블록(`grid.blockName`)을 못 찾았을 때.

- [ ] **Step 1: 실패하는 테스트** — `server/test/tableClone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createHandleAllocator, findBlock, parseDxf, symbolTableInfo, type DxfPair } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import { cloneTable, nextTableName, usedTableNames } from '../src/export/tableClone.js';
import { buildGrid, modelSpaceRanges } from '../src/export/tableGrid.js';
import { modelSpaceTemplate } from './fixtureDocs.js';

async function setup() {
  const doc = parseDxf(await modelSpaceTemplate());
  const frame = findFrames(doc)[0];
  const grid = buildGrid(doc, frame.table)!;
  const range = modelSpaceRanges(doc)[frame.tableEntityIndex!];
  const alloc = createHandleAllocator(doc);
  const info = symbolTableInfo(doc, 'BLOCK_RECORD')!;
  const clone = cloneTable(doc, doc.pairs.slice(range.start, range.end), grid, { dx: 50000, page: 1, name: '*T7', alloc, recordTableHandle: info.handle })!;
  return { doc, grid, clone, alloc, original: doc.pairs.slice(range.start, range.end) };
}
const at = (pairs: DxfPair[], code: number) => pairs.filter((p) => p.code === code).map((p) => p.value);
function handlesOf(pairs: DxfPair[]): string[] {
  return at(pairs, 5).map((v) => v.trim());
}

describe('usedTableNames · nextTableName', () => {
  it('문서의 *T<숫자> 이름을 모으고 다음 번호를 낸다', async () => {
    const doc = parseDxf(await modelSpaceTemplate());
    const used = usedTableNames(doc); // 픽스처는 *TX라 비어 있다
    expect(used.size).toBe(0);
    expect(nextTableName(used)).toBe('*T1');
    expect(nextTableName(used)).toBe('*T2');
    used.add('*T19');
    expect(nextTableName(used)).toBe('*T20');
  });
});

describe('cloneTable', () => {
  it('새 레코드·블록·표가 서로를 가리키고 핸들이 전부 새 것이다', async () => {
    const { clone, original, doc } = await setup();
    expect(clone.blockName).toBe('*T7');
    expect(at(clone.recordPairs, 0)).toEqual(['BLOCK_RECORD']);
    expect(at(clone.recordPairs, 2)).toEqual(['*T7']);
    expect(at(clone.recordPairs, 331)).toEqual([clone.tableHandle]);
    expect(at(clone.recordPairs, 330)).toEqual(['1']);
    expect(handlesOf(clone.recordPairs)).toEqual([clone.recordHandle]);

    expect(clone.blockPairs[0].value).toBe('BLOCK');
    expect(clone.blockPairs[clone.blockPairs.length - 1].code).not.toBe(0);
    expect(at(clone.blockPairs, 2)).toEqual(['*T7']);
    expect(at(clone.blockPairs, 3)).toEqual(['*T7']);
    expect(new Set(at(clone.blockPairs, 330))).toEqual(new Set([clone.recordHandle]));
    const originalBlock = findBlock(doc, '*TX')!;
    const originalHandles = handlesOf(doc.pairs.slice(originalBlock.start, originalBlock.end));
    for (const h of handlesOf(clone.blockPairs)) expect(originalHandles).not.toContain(h);
    expect(new Set(handlesOf(clone.blockPairs)).size).toBe(handlesOf(clone.blockPairs).length);

    expect(at(clone.tablePairs, 2)).toEqual(['*T7']);
    expect(at(clone.tablePairs, 343)).toEqual([clone.recordHandle]);
    expect(handlesOf(clone.tablePairs)).toEqual([clone.tableHandle]);
    expect(clone.tableHandle).not.toBe(handlesOf(original)[0]);
    expect(at(clone.tablePairs, 330)).toEqual(['1F']); // 소유자는 모델 공간 그대로
  });

  it('삽입점은 dx만큼 옮기고 방향 벡터·캐시·확장 사전은 없거나 그대로다', async () => {
    const { clone } = await setup();
    expect(at(clone.tablePairs, 10)).toEqual(['52000.0']);
    expect(at(clone.tablePairs, 20)).toEqual(['3400.0']);
    expect(at(clone.tablePairs, 11)).toEqual(['1.0']);
    expect(clone.tablePairs.some((p) => p.code === 160 || p.code === 310 || p.code === 360)).toBe(false);
    expect(clone.tablePairs.some((p) => p.code === 102)).toBe(false);
  });

  it('번호 열 데이터 행은 셀 값과 글자 블록 둘 다 page·N + i다', async () => {
    const { clone } = await setup(); // page 1, N 3 → 4·5·6
    expect(at(clone.tablePairs, 302).filter((v) => /^\d+$/.test(v))).toEqual(['4', '5', '6']);
    expect(at(clone.tablePairs, 91).map((v) => v.trim()).filter((v) => ['4', '5', '6'].includes(v))).toHaveLength(3);
    const blockTexts = at(clone.blockPairs, 1);
    expect(blockTexts).toContain('4');
    expect(blockTexts).toContain('6');
    expect(blockTexts).not.toContain('1');
    expect(blockTexts).toContain('가로/폭'); // 머리글은 그대로
  });

  it('글자 블록이 없으면 null', async () => {
    const { doc, grid, original, alloc } = await setup();
    expect(cloneTable(doc, original, { ...grid, blockName: '*NOPE' }, { dx: 0, page: 1, name: '*T8', alloc, recordTableHandle: '1' })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run test/tableClone.test.ts`

- [ ] **Step 3: 구현** — `server/src/export/tableClone.ts`:

```ts
// 손상물량표(ACAD_TABLE)를 통째로 복제한다 — 표 엔티티 + 글자 블록(*T) + 그 블록 레코드.
// 넘침 복사본의 표가 진짜 표 객체여야 캐드에서 셀 편집이 된다(사용자 결정 2026-10-02 ②).
// 지스타캐드 시험 E(2026-10-02)에서 이 세 벌을 넣은 파일이 열리고 편집·이동이 됐다.
// 전부 DxfPair[]를 만들기만 한다 — 문서에 넣는 자리는 exportDrawing.ts가 DocumentEdits로 정한다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 5.2

import { findBlock, pair, type DxfDocument, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { numberColumnWrites, stripGraphicsCache, writeCellValues } from './tableCells.js';
import { entityRanges, isPrintedNumber, rawEntityAt, type TableGrid } from './tableGrid.js';

const TABLE_BLOCK_NAME = /^\*T(\d+)$/;

/** 문서에 이미 있는 `*T<숫자>` 블록 이름. 코드 2·3 어디든 본다(BLOCK 머리·레코드·표 참조). */
export function usedTableNames(doc: DxfDocument): Set<string> {
  const used = new Set<string>();
  for (const p of doc.pairs) {
    if ((p.code === 2 || p.code === 3) && TABLE_BLOCK_NAME.test(p.value)) used.add(p.value);
  }
  return used;
}

/** 가장 큰 번호 + 1의 이름을 만들고 used에 넣는다. */
export function nextTableName(used: Set<string>): string {
  let max = 0;
  for (const name of used) {
    const n = Number(TABLE_BLOCK_NAME.exec(name)?.[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const name = `*T${max + 1}`;
  used.add(name);
  return name;
}

export interface TableClone {
  blockName: string;
  recordHandle: string;
  tableHandle: string;
  /** BLOCK_RECORD 한 벌 — BLOCK_RECORD 표의 ENDTAB 앞에 */
  recordPairs: DxfPair[];
  /** BLOCK … ENDBLK 한 벌 — 원본 글자 블록 뒤에 */
  blockPairs: DxfPair[];
  /** ACAD_TABLE 한 벌 — ENTITIES 끝에. 번호 열은 page·N + i, 캐시·확장 사전 없음 */
  tablePairs: DxfPair[];
}

export interface CloneOptions {
  /** 원본 표에서 x로 얼마나 옮기는가 */
  dx: number;
  /** 0이 원본 장. 번호 열에 page·N + i를 쓴다 */
  page: number;
  /** 새 글자 블록 이름(nextTableName) */
  name: string;
  alloc: HandleAllocator;
  /** BLOCK_RECORD 표의 핸들 = 새 레코드의 소유자 */
  recordTableHandle: string;
}

// 표 엔티티 사본: 첫 5는 새 핸들, 102 {…} 묶음 제거, 343·2는 새 블록, 첫 10은 dx만큼.
function cloneTablePairs(source: DxfPair[], options: CloneOptions, tableHandle: string, recordHandle: string): DxfPair[] {
  const out: DxfPair[] = [];
  let handleDone = false;
  let nameDone = false;
  let positionDone = false;
  for (let i = 0; i < source.length; i++) {
    const p = source[i];
    if (p.code === 102 && p.value.startsWith('{')) {
      let j = i + 1;
      while (j < source.length && !(source[j].code === 102 && source[j].value.trim() === '}')) j += 1;
      i = j;
      continue;
    }
    if (p.code === 5 && !handleDone) {
      handleDone = true;
      out.push({ ...p, value: tableHandle });
    } else if (p.code === 343) {
      out.push({ ...p, value: recordHandle });
    } else if (p.code === 2 && !nameDone) {
      nameDone = true;
      out.push({ ...p, value: options.name });
    } else if (p.code === 10 && !positionDone) {
      positionDone = true;
      const x = Number(p.value.trim());
      out.push({ ...p, value: Number.isFinite(x) ? String(x + options.dx + 0) : p.value });
      if (!p.value.includes('.') && Number.isFinite(x)) out[out.length - 1] = { ...p, value: `${x + options.dx}.0` };
    } else {
      out.push(p);
    }
  }
  return stripGraphicsCache(out);
}

// 글자 블록 사본: 모든 5는 새 핸들, 330이 원본 레코드면 새 레코드, 2·3의 이름은 새 이름,
// 번호 열 데이터 행의 MTEXT/TEXT 글자는 page·N + i.
function cloneBlockPairs(doc: DxfDocument, grid: TableGrid, originalRecord: string, options: CloneOptions, recordHandle: string): DxfPair[] | null {
  const block = findBlock(doc, grid.blockName);
  if (!block) return null;
  const source = doc.pairs.slice(block.start, block.end);
  const out: DxfPair[] = [];
  for (const range of entityRanges(source, 0, source.length)) {
    const entity = rawEntityAt(source, range);
    const printed = (range.type === 'MTEXT' || range.type === 'TEXT') && isPrintedNumber(grid, entity);
    let number = 0;
    if (printed) {
      const y = Number(entity.values.get(20)?.[0]?.trim());
      const row = grid.rowBoundaries.findIndex((top, i) => i + 1 < grid.rowBoundaries.length && y <= top && y >= grid.rowBoundaries[i + 1]);
      number = options.page * grid.dataRowCount + (row - grid.firstDataRow + 1);
    }
    let textDone = false;
    for (let i = range.start; i < range.end; i++) {
      const p = source[i];
      if (p.code === 5) out.push({ ...p, value: options.alloc.next() });
      else if (p.code === 330 && p.value.trim() === originalRecord) out.push({ ...p, value: recordHandle });
      else if ((p.code === 2 || p.code === 3) && p.value === grid.blockName) out.push({ ...p, value: options.name });
      else if (printed && p.code === 3) continue; // 긴 글 조각은 버린다 — 번호는 한 조각이다
      else if (printed && p.code === 1 && !textDone) {
        textDone = true;
        out.push({ ...p, value: String(number) });
      } else out.push(p);
    }
  }
  return out;
}

export function cloneTable(doc: DxfDocument, tablePairs: DxfPair[], grid: TableGrid, options: CloneOptions): TableClone | null {
  const block = findBlock(doc, grid.blockName);
  if (!block) return null;
  const recordHandle = options.alloc.next();
  const tableHandle = options.alloc.next();
  const blockPairs = cloneBlockPairs(doc, grid, block.recordHandle, options, recordHandle);
  if (!blockPairs) return null;

  const recordPairs: DxfPair[] = [
    pair(0, 'BLOCK_RECORD'),
    pair(5, recordHandle),
    pair(330, options.recordTableHandle),
    pair(100, 'AcDbSymbolTableRecord'),
    pair(100, 'AcDbBlockTableRecord'),
    pair(2, options.name),
    pair(340, '0'),
    pair(102, '{BLKREFS'),
    pair(331, tableHandle),
    pair(102, '}'),
    pair(70, '     0'),
    pair(280, '     1'),
    pair(281, '     0'),
  ];

  const columnCount = grid.colBoundaries.length - 1;
  const table = writeCellValues(cloneTablePairs(tablePairs, options, tableHandle, recordHandle), columnCount, numberColumnWrites(grid, options.page));
  return { blockName: options.name, recordHandle, tableHandle, recordPairs, blockPairs, tablePairs: table };
}
```

`cloneTablePairs`의 `10` 처리는 두 줄이 어색하다 — 구현할 때 `formatReal(x + options.dx)`(dxfDocument의 `formatReal`) 한 줄로 쓴다: `out.push({ ...p, value: formatReal(x + options.dx) })`(x가 NaN이면 원래 값). `formatReal`을 import에 더한다.

- [ ] **Step 4: 통과 확인** — `cd server && npx vitest run test/tableClone.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/tableClone.ts server/test/tableClone.test.ts
git commit -m "손상물량표를 글자 블록·레코드까지 통째로 복제하는 cloneTable을 더한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 영역 판정·복사 도구 보강 (`sheetCopy.ts`)

**Files:**
- Modify: `server/src/export/sheetCopy.ts`
- Test: `server/test/sheetCopy.test.ts`

**Interfaces:**
- Produces: `resolvedBounds`가 `ACAD_TABLE`을 표 영역(삽입점 + 너비·높이)으로 잰다; `copyRegion(ctx, ranges, dx, exclude?: EntityRange)`; `copyFrameInsert(ctx, frame, dx): CopyResult`(틀 INSERT 한 벌을 새 핸들로 베껴 dx 옮김; INSERT가 없거나 복사 불가면 `skipped 1`).

- [ ] **Step 1: 실패하는 테스트** — `server/test/sheetCopy.test.ts`에 추가(import에 `modelSpaceTemplate`, `copyFrameInsert` 추가; `contextOf`는 이 파일에 이미 있는 헬퍼 — `readSheetContext`로 ctx와 frames를 만든다):

```ts
describe('모델 공간 표가 있는 틀 (2026-10-02)', () => {
  it('indexRegions는 표를 그 틀 영역에 넣는다(표 영역의 중심으로 판정)', async () => {
    const { frames, ctx } = await contextOf(await modelSpaceTemplate(2));
    const regions = indexRegions(ctx, frames);
    expect(regions.inFrame[0]).toContain(ctx.ranges[frames[0].tableEntityIndex!]);
    expect(regions.inFrame[1]).toContain(ctx.ranges[frames[1].tableEntityIndex!]);
  });

  it('copyRegion은 exclude로 넘긴 표를 베끼지 않고 skipped에도 세지 않는다', async () => {
    const { frames, ctx } = await contextOf(await modelSpaceTemplate());
    const regions = indexRegions(ctx, frames);
    const table = ctx.ranges[frames[0].tableEntityIndex!];
    const result = copyRegion(ctx, regions.inFrame[0], 100, table);
    expect(result.pairs.some((p) => p.code === 0 && p.value === 'ACAD_TABLE')).toBe(false);
    expect(result.skipped).toBe(0);
    // exclude 없이 부르면 표는 복사 불가라 skipped에 센다
    expect(copyRegion(ctx, regions.inFrame[0], 100).skipped).toBe(1);
  });

  it('copyFrameInsert는 틀 INSERT를 새 핸들로 베껴 dx만큼 옮긴다', async () => {
    const { frames, ctx } = await contextOf(await modelSpaceTemplate());
    const result = copyFrameInsert(ctx, frames[0], 50000);
    expect(result.skipped).toBe(0);
    expect(result.pairs[0]).toMatchObject({ code: 0, value: 'INSERT' });
    expect(result.pairs.find((p) => p.code === 2)!.value).toBe('망도틀');
    expect(result.pairs.find((p) => p.code === 10)!.value).toBe('51000.0');
    expect(result.pairs.find((p) => p.code === 41)!.value).toBe('2.0');
    expect(result.pairs.find((p) => p.code === 5)!.value).not.toBe('80');
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run test/sheetCopy.test.ts`

- [ ] **Step 3: 구현**

`resolvedBounds`(119행 부근) 첫 줄을 바꾼다:

```ts
function resolvedBounds(model: ModelSpace, entity: RawEntity, pairs: DxfPair[]): EntityBounds | null {
  if (entity.type === 'ACAD_TABLE') {
    // 표는 삽입점 하나가 아니라 표가 차지하는 영역으로 잰다(frames.ts와 같은 규칙) — 모델 공간
    // 표의 틀 소속은 표 중심으로 판정해야 틀 가장자리에 걸친 삽입점 때문에 틀리지 않는다.
    const points = boundsPointsOf(entity);
    if (points.length === 0) return null;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  if (entity.type !== 'INSERT') return entityBoundsOf(pairs);
  …
```

`copyRegion`에 `exclude` 인자를 더한다:

```ts
/** 최상위 엔티티 여러 개를 새 핸들로 베껴 x로 dx만큼 옮긴다(설계 5.1). exclude는 베끼지 않고 세지도 않는다(모델 공간 표 — tableClone이 따로 복제한다). */
export function copyRegion(ctx: SheetContext, ranges: EntityRange[], dx: number, exclude?: EntityRange): CopyResult {
  const pairs: DxfPair[] = [];
  let skipped = 0;
  for (const range of ranges) {
    if (range === exclude) continue;
    …
```

`flattenFrameBlock` 뒤에 추가:

```ts
/**
 * 틀 INSERT 자체를 한 벌 더 넣는다(새 구조 — 블록 안에 표가 없어 번호 1~N이 따라오지 않으므로
 * 펼칠 필요가 없다, 2026-10-02 설계 5.1). 블록 정의는 공유된다.
 */
export function copyFrameInsert(ctx: SheetContext, frame: Frame, dx: number): CopyResult {
  const range = ctx.ranges[frame.entityIndex];
  if (!range || range.type !== 'INSERT') return { pairs: [], skipped: 1 };
  const source = ctx.doc.pairs.slice(range.start, range.end);
  if (!isCopyable(source)) return { pairs: [], skipped: 1 };
  return { pairs: translateEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), dx, 0), skipped: 0 };
}
```

- [ ] **Step 4: 통과 확인** — `cd server && npx vitest run test/sheetCopy.test.ts`

- [ ] **Step 5: 커밋**

```bash
git add server/src/export/sheetCopy.ts server/test/sheetCopy.test.ts
git commit -m "모델 공간 표의 틀 소속을 표 영역으로 판정하고 틀 INSERT 복사·표 제외 복사를 더한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 산출 흐름 통합 (`exportDrawing.ts`)

**Files:**
- Modify: `server/src/export/exportDrawing.ts`
- Test: `server/test/exportDrawing.test.ts`

**Interfaces:**
- Consumes: Task 3~7 전부. `EXPORT_WARNINGS`는 그대로.
- Produces: `modelSpace` 틀에서 (a) 셀 값 + 글자 블록 MTEXT + 캐시 제거, 선 위 글자 없음(`손상물량표` 레이어 엔티티 0개); (b) 넘침 시 틀 INSERT 복사 + 복제 표(번호 N+1…, 그 장의 값) + 영역 복사(표 제외); (c) 뒤 틀 밀기는 복사보다 먼저이고 복사 dx는 `page × pitch`.

- [ ] **Step 1: 실패하는 테스트** — `server/test/exportDrawing.test.ts`에 추가(import에 `modelSpaceTemplate` 추가; `TABLE_LAYER`는 `dxfDocument.js`에서):

```ts
describe('모델 공간 표 — 셀 직접 채우기와 표 복제 (2026-10-02)', () => {
  // 틀 0 영역 x 1000~5000, y 2000~6000. 표 로컬 격자: 데이터 행 3(firstDataRow 2), 번호 열 0.
  function inFrame(n: number, frame = 0) {
    const x = 1500 + n * 100 + frame * 50000;
    const dwg: Pt[] = [[x, 2500], [x + 50, 2500], [x + 50, 2600], [x, 2600]];
    return damage(`m${frame}-${n}`, 'spalling', n * 10 + frame * 1000, dwg, { width: 1.2, length: 1.5, count: 2 });
  }
  function entities(text: string, type: string) {
    const doc = parseDxf(text);
    const out: DxfPair[][] = [];
    for (let i = 0; i < doc.pairs.length; i++) {
      if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== type) continue;
      let j = i + 1;
      while (j < doc.pairs.length && doc.pairs[j].code !== 0) j += 1;
      out.push(doc.pairs.slice(i, j));
      i = j - 1;
    }
    return out;
  }
  const at = (pairs: DxfPair[], code: number) => pairs.filter((p) => p.code === code).map((p) => p.value);

  it('값이 선 위 글자가 아니라 표 셀과 글자 블록에 들어가고 캐시는 없다', async () => {
    const result = exportDamagesToDxf(await modelSpaceTemplate(), [inFrame(1), inFrame(2)]);
    const tables = entities(result.dxfText, 'ACAD_TABLE');
    expect(tables).toHaveLength(1);
    const strings = at(tables[0], 302);
    expect(strings).toContain('박락'); // 손상현황 (statusTextOf(spalling) = 박락)
    expect(strings.filter((v) => v === '1.2')).toHaveLength(2); // 가로 두 행
    expect(tables[0].some((p) => p.code === 160 || p.code === 310)).toBe(false);
    // 글자 블록 *TX에 MTEXT가 늘었다(머리글 9 + 번호 3 = 12 → + 2행 × 6칸 = 24)
    const doc = parseDxf(result.dxfText);
    const block = findBlock(doc, '*TX')!;
    const blockText = doc.pairs.slice(block.start, block.end);
    expect(blockText.filter((p) => p.code === 0 && p.value === 'MTEXT')).toHaveLength(24);
    expect(at(blockText, 330).every((v) => v.trim() === '31')).toBe(true);
    // 선 위 글자(손상물량표 레이어 TEXT)는 없다. 레이어 자체는 만든다.
    expect(entities(result.dxfText, 'TEXT').filter((e) => at(e, 8)[0] === TABLE_LAYER)).toHaveLength(0);
    expect(layerNames(doc)).toContain(TABLE_LAYER);
    expect(result.warnings).toEqual([]);
  });

  it('데이터 행을 넘으면 틀 INSERT와 표를 복제하고 뒤 틀을 민다', async () => {
    const result = exportDamagesToDxf(await modelSpaceTemplate(2), [1, 2, 3, 4].map((n) => inFrame(n, 0)));
    expect(result.warnings).toEqual([EXPORT_WARNINGS.sheetCopied(0, 2)]);
    const doc = parseDxf(result.dxfText);
    // 틀 INSERT 3개: 원본 x 1000, 복사본 51000, 밀린 틀 1은 101000
    const inserts = entities(result.dxfText, 'INSERT').filter((e) => at(e, 2)[0] === '망도틀');
    expect(inserts.map((e) => Number(at(e, 10)[0])).sort((a, b) => a - b)).toEqual([1000, 51000, 101000]);
    // 표 3개: 원본 2000, 복제 52000, 밀린 틀 1의 표 102000(방향 11은 그대로 1.0)
    const tables = entities(result.dxfText, 'ACAD_TABLE');
    expect(tables.map((e) => Number(at(e, 10)[0])).sort((a, b) => a - b)).toEqual([2000, 52000, 102000]);
    expect(tables.every((e) => at(e, 11)[0] === '1.0')).toBe(true);
    const clone = tables.find((e) => at(e, 10)[0] === '52000.0')!;
    expect(at(clone, 302).filter((v) => /^\d+$/.test(v))).toEqual(['4', '5', '6']);
    expect(at(clone, 302)).toContain('박락'); // 4번 손상의 값
    expect(at(clone, 2)).toEqual(['*T1']);
    // 새 레코드·블록
    const record = symbolTableInfo(doc, 'BLOCK_RECORD')!;
    expect(doc.pairs[record.countIndex].value.trim()).toBe('4'); // 3 + 1
    const block = findBlock(doc, '*T1')!;
    expect(block).not.toBeNull();
    expect(at(clone, 343)).toEqual([block.recordHandle]);
    const blockPairs = doc.pairs.slice(block.start, block.end);
    expect(at(blockPairs, 1)).toContain('4');
    expect(at(blockPairs, 1)).toContain('박락');
    // 원본 표에는 1~3번만
    const original = tables.find((e) => at(e, 10)[0] === '2000.0')!;
    expect(at(original, 302).filter((v) => v === '박락')).toHaveLength(3);
    // 핸들 유일, 다시 읽힘
    const handles = doc.pairs.filter((p) => p.code === 5).map((p) => p.value.trim());
    expect(new Set(handles).size).toBe(handles.length);
    expect(findFrames(doc)).toHaveLength(3);
  });

  it('옛 구조(블록 안 표) 도면은 전과 같이 선 위 글자로 채운다', async () => {
    const result = exportDamagesToDxf(await template(), [damage('a', 'spalling', 0, RECT_A, { width: 1.2 })]);
    expect(entities(result.dxfText, 'TEXT').filter((e) => at(e, 8)[0] === TABLE_LAYER).length).toBeGreaterThan(0);
  });
});
```

`findBlock`·`symbolTableInfo`·`TABLE_LAYER`·`DxfPair`를 import에 더한다. 손상현황 문구 `'박락'`는 `quantities.js`의 `statusTextOf`가 `spalling`에 내는 값이다 — 다르면 실제 값으로 고친다(`node -e` 또는 기존 테스트에서 확인).

- [ ] **Step 2: 실패 확인** — `cd server && npx vitest run test/exportDrawing.test.ts`

- [ ] **Step 3: 구현** — `exportDrawing.ts`:

import 추가:

```ts
import { DocumentEdits } from './documentEdits.js';
import { findBlock, symbolTableInfo } from './dxfDocument.js';   // 기존 dxfDocument import에 합친다
import { copyFrameInsert } from './sheetCopy.js';                 // 기존 sheetCopy import에 합친다
import { appendBeforeEndblk, cellMtextPairs, cellWritesFor, stripGraphicsCache, writeCellValues } from './tableCells.js';
import { cloneTable, nextTableName, usedTableNames } from './tableClone.js';
```

(1) 장 수 계산(263~267행)에서 `modelSpace` 틀은 펼칠 수 있는지 보지 않는다:

```ts
    if (grid && dataRows > 0 && frameMax > dataRows) {
      if (frame.tableKind === 'modelSpace' || isFlattenable(frame.transform)) pages = pagesOf(frameMax, dataRows);
      else warnings.push(EXPORT_WARNINGS.sheetCopyUnsupported(frame.index));
    }
```

(2) 문맥 읽기 조건(277행): `modelSpace` 틀에 채울 것이 있으면 넘치지 않아도 문맥이 필요하다.

```ts
  const needsContext = plans.some((plan) => plan.pages > 1 || (plan.frame.tableKind === 'modelSpace' && plan.entries.length > 0 && plan.grid));
  if (needsContext) {
    ctx = readSheetContext(doc, alloc, owner);
    if (ctx && plans.some((plan) => plan.pages > 1)) regions = indexRegions(ctx, frames);
    if (!ctx) for (const plan of plans) plan.pages = 1;
  }
```

(3) **뒤 틀 밀기를 손상 도형 다음, 표 작업 앞으로 옮긴다**(지금 381~395행 블록을 329행 `circlesTruncated` 경고 다음, `outside` 경고 앞으로). 주석을 고친다: "복사·셀 채우기보다 **먼저** 민다 — 그 뒤의 복사는 밀린 원본에서 베끼므로 dx가 `page × pitch`만이면 된다(2026-10-02 설계 6장). insertEntities보다도 먼저여야 하는 이유는 전과 같다(범위 인덱스)."

(4) 넘침 복사(345~359행)와 표 채우기(361~379행)를 `tableKind`로 가른다. `frames.length > 0` 분기 전체를 아래로 바꾼다:

```ts
  } else {
    const edits = new DocumentEdits();
    const tableNames = ctx ? usedTableNames(doc) : new Set<string>();
    const recordTable = symbolTableInfo(doc, 'BLOCK_RECORD');
    let newRecords = 0;

    // 넘치는 틀은 장마다 복사본을 만든다(설계 7장 4단계). 밀기는 이미 끝났으므로 복사 dx는 장
    // 간격만이다(원본이 offset만큼 밀려 있다). flattenFrameBlock만 틀 변환(밀기 전 좌표)을
    // 쓰므로 offset을 더해 준다.
    let copySkipped = 0;
    for (const plan of plans) {
      if (plan.pages <= 1 || !plan.grid || !ctx || !regions) continue;
      warnings.push(EXPORT_WARNINGS.sheetCopied(plan.frame.index, plan.pages));
      const tableRange = plan.frame.tableEntityIndex === null ? undefined : ctx.ranges[plan.frame.tableEntityIndex];
      for (let page = 1; page < plan.pages; page++) {
        const dx = page * plan.pitch;
        const region = copyRegion(ctx, regions.inFrame[plan.frame.index], dx, tableRange);
        appendAll(pairs, region.pairs);
        copySkipped += region.skipped;
        if (plan.frame.tableKind === 'inBlock') {
          const block = flattenFrameBlock(ctx, plan.frame, plan.grid, page, plan.offset + dx);
          appendAll(pairs, block.pairs);
          copySkipped += block.skipped;
          continue;
        }
        const insert = copyFrameInsert(ctx, plan.frame, dx);
        appendAll(pairs, insert.pairs);
        copySkipped += insert.skipped;
        if (!tableRange || !recordTable) continue;
        // 표는 통째로 복제한다(설계 5.2). 밀린 원본에서 베끼므로 dx는 장 간격.
        const clone = cloneTable(doc, doc.pairs.slice(tableRange.start, tableRange.end), plan.grid, {
          dx,
          page,
          name: nextTableName(tableNames),
          alloc,
          recordTableHandle: recordTable.handle,
        });
        if (!clone) continue;
        const pageEntries = plan.entries
          .filter((entry) => pageOf(entry.number, plan.dataRows) === page)
          .map((entry) => ({ ...entry, number: entry.number - page * plan.dataRows }));
        const pageMax = Math.min(plan.dataRows, plan.maxNumber - page * plan.dataRows);
        const writes = cellWritesFor(plan.grid, rowsFor(pageEntries, pageMax));
        const mtexts: DxfPair[] = [];
        for (const write of writes) appendAll(mtexts, cellMtextPairs(plan.grid, write, alloc.next(), clone.recordHandle));
        const originalBlock = findBlock(doc, plan.grid.blockName);
        if (!originalBlock) continue;
        edits.insert(originalBlock.end, appendBeforeEndblk(clone.blockPairs, mtexts));
        edits.insert(recordTable.end, clone.recordPairs);
        newRecords += 1;
        appendAll(pairs, writeCellValues(clone.tablePairs, plan.grid.colBoundaries.length - 1, writes));
      }
    }
    if (copySkipped > 0) warnings.push(EXPORT_WARNINGS.sheetCopySkipped(copySkipped));

    // 틀마다 자기 표에 그 틀 손상만 1번부터 채운다. 손상이 없는 틀의 표는 건드리지 않는다.
    for (const plan of plans) {
      if (plan.entries.length === 0 || !plan.grid) continue;
      const pageZero = plan.pages <= 1
        ? { entries: plan.entries, max: plan.maxNumber }
        : { entries: plan.entries.filter((entry) => pageOf(entry.number, plan.dataRows) === 0), max: Math.min(plan.dataRows, plan.maxNumber) };

      if (plan.frame.tableKind === 'modelSpace' && ctx && plan.frame.tableEntityIndex !== null) {
        // 원본 표를 제자리에서 고친다(설계 4장): 셀 값 + 글자 블록 MTEXT + 캐시 제거.
        const tableRange = ctx.ranges[plan.frame.tableEntityIndex];
        const block = findBlock(doc, plan.grid.blockName);
        if (!block) continue;
        const writes = cellWritesFor(plan.grid, rowsFor(pageZero.entries, pageZero.max));
        const mtexts: DxfPair[] = [];
        for (const write of writes) appendAll(mtexts, cellMtextPairs(plan.grid, write, alloc.next(), block.recordHandle));
        const source = doc.pairs.slice(tableRange.start, tableRange.end);
        edits.replace(tableRange.start, tableRange.end, stripGraphicsCache(writeCellValues(source, plan.grid.colBoundaries.length - 1, writes)));
        if (mtexts.length > 0) edits.insert(block.endblkIndex, mtexts);
        continue;
      }

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

    if (newRecords > 0 && recordTable && recordTable.countIndex >= 0) {
      const count = Number(doc.pairs[recordTable.countIndex].value.trim());
      if (Number.isFinite(count)) edits.replace(recordTable.countIndex, recordTable.countIndex + 1, [pair(70, String(count + newRecords).padStart(6, ' '))]);
    }
    edits.apply(doc);
  }
```

`pair`를 dxfDocument import에 더한다. `inBlock` 경로의 `copyRegion` dx가 `page × pitch`로 바뀐 것은 밀기를 앞으로 옮긴 데 따른 것이다(밀린 원본에서 베낀다) — 기존 넘침 테스트(`복사본 표의 번호 칸 x 100100` 등)가 그대로 통과해야 한다.

`edits.apply(doc)` 뒤의 `insertEntities(doc, pairs)`는 그대로(ENTITIES 끝을 다시 찾는다).

- [ ] **Step 4: 통과 확인** — `cd server && npm test`
Expected: 전부 PASS(기존 1079 + 새 테스트). 실패하면 `inBlock` 넘침 테스트부터 본다(dx 변경).

- [ ] **Step 5: 실제 템플릿으로 손수 확인(선택, 결과는 커밋하지 않는다)**

`C:\Users\FastPc\Desktop\빈도면(V_Table35).dxf`를 읽어 `exportDamagesToDxf`에 틀 0 안 손상 2개를 넣고 결과를 `C:\Users\FastPc\Desktop\표셀시험\산출-확인.dxf`로 저장하는 일회성 스크립트(`npx tsx`)를 돌려 `parseDxf`로 다시 읽히고 핸들이 유일한지 본다.

- [ ] **Step 6: 커밋**

```bash
git add server/src/export/exportDrawing.ts server/test/exportDrawing.test.ts
git commit -m "모델 공간 표는 셀에 직접 채우고 넘침 복사본의 표는 통째로 복제한다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 문서

**Files:**
- Modify: `README.md`(97~109행 부근 산출 설명, 17행 설계 목록), `docs/DXF산출-테스트-결과.md`(표 끝에 행 추가)

- [ ] **Step 1: README**

- 17행 설계 목록 끝에 `, docs/superpowers/specs/2026-10-02-table-cells-design.md(모델 공간 표 셀 채우기·표 복제)` 추가.
- 100행: `틀은 "안에 손상물량표가 들어 있는 블록" 또는 "블록 영역 안에 손상물량표(ACAD_TABLE)가 놓인 블록"으로 알아보므로 …`.
- 101행 뒤에 추가: `   - 표가 **블록 밖(모델 공간)** 에 놓인 새 템플릿(2026-10)에서는 값이 **표 셀에 직접** 들어갑니다 — 캐드에서 셀을 더블클릭해 고칠 수 있고 표를 옮겨도 따라옵니다. 표가 블록 안에 든 옛 템플릿은 전처럼 칸 위에 글자를 얹습니다.`
- 103행 뒤에 추가: `   - 셀에 직접 채운 표에는 `손상물량표` 레이어 글자가 없습니다(레이어는 만들어 둡니다).`
- 104행 넘침 설명 끝에 추가: ` 새 템플릿에서는 복사본의 표도 **진짜 표 객체**로 복제됩니다(글자 블록·블록 레코드 포함).`

- [ ] **Step 2: 테스트 결과표 행 추가**

`docs/DXF산출-테스트-결과.md`의 표 마지막 행(`| 83 |`로 시작) 뒤에 아래 네 행을 **CRLF**로 덧붙인다(python으로 `newline=''` 읽기/쓰기, 열 수는 기존 행과 같게):

- 84: 새 템플릿(빈도면(V_Table35).dxf) 업로드 → 앱에서 틀 7개 페이지 보기 — 결과 빈칸
- 85: 손상 2~3개 산출 → 지스타캐드에서 셀에 값 보임·더블클릭 편집됨·표 옮겨도 따라옴 — 빈칸
- 86: 한 틀에 36개 넘게 → 복사본 틀(INSERT)+복제 표(36~)·뒤 틀 밀림·AUDIT 오류 0 — 빈칸
- 87: 옛 템플릿(함양~창녕) 산출 결과가 전과 같음 — 빈칸

- [ ] **Step 3: 커밋**

```bash
git add README.md "docs/DXF산출-테스트-결과.md"
git commit -m "모델 공간 표 셀 채우기·표 복제를 README와 실기기 확인표에 적는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** 3장 틀 인식 → Task 4; 4장 셀 채우기(4.1 값, 4.2 글자 블록, 4.3 옛 구조 유지) → Task 5·8; 5.1 틀 INSERT 복사 → Task 7·8; 5.2 표 복제 → Task 6·8; 5.3 이동 규칙·isCopyable·resolvedBounds → Task 1·7; 6장 순서(밀기 먼저·편집 큐) → Task 3·8; 8장 검증 항목 → 각 Task 테스트 + Task 9 확인표.
- **Placeholder scan:** 없음. Task 8 Step 5는 선택 확인이며 결과물을 커밋하지 않는다.
- **Type consistency:** `Frame.tableKind`/`tableEntityIndex`(Task 4) ↔ Task 7·8; `CellWrite`·`cellWritesFor`·`numberColumnWrites`·`writeCellValues`·`stripGraphicsCache`·`cellMtextPairs`·`appendBeforeEndblk`(Task 5) ↔ Task 6·8; `TableClone`·`CloneOptions`(Task 6) ↔ Task 8; `findBlock`/`symbolTableInfo`(Task 2) ↔ Task 6·8; `DocumentEdits.insert/replace/apply`(Task 3) ↔ Task 8; `copyRegion(…, exclude)`·`copyFrameInsert`(Task 7) ↔ Task 8; `TableGrid.textWidth`(Task 5) ↔ `cellMargin`.
