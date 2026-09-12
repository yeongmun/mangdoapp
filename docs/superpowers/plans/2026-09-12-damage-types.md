# 손상 유형 체계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 균열 1종만 입력되던 뷰어를 손상 유형 10종으로 확장한다. 유형별 입력(선 / 회전 사각형), 유형별 무늬 표시, 물량 직접 입력, 저장 형식 v2와 기존 v1 호환까지 포함한다.

**Architecture:** 유형 정의를 `damageTypes.js` 한 파일에 모으고 뷰어·서버가 함께 읽는다. 손상 문서는 `schemaVersion: 2`로 올리며, 읽을 때 v1을 자동 변환한다. 면형 손상은 회전 가능한 사각형을 네 꼭짓점으로 저장하고, 화면에는 SVG 패턴으로 무늬를 그린다. 물량은 사용자가 입력한 값이 기준이고 계산값은 참고로만 표시한다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript, Express 5, vitest, APS Viewer v7, 빌드 없는 ES 모듈 브라우저 JS, Expo SDK 57 앱(이번 계획에서는 변경 없음)

**Spec:** `docs/superpowers/specs/2026-09-12-damage-types-design.md`

## Global Constraints

- 손상 유형 10종과 채우기(확정값):
  | id | label | kind | fill | quantityUnit |
  |---|---|---|---|---|
  | `crack` | 균열 | line | 없음 | m |
  | `map_crack` | 망상균열 | area | hatch `NET` | m2 |
  | `breakage` | 파손 | area | 없음(미정) | m2 |
  | `segregation` | 재료분리 | area | hatch `CORK` | m2 |
  | `delamination` | 박리 | area | hatch `ANSI31` | m2 |
  | `spalling` | 박락 | area | hatch `ANSI37` | m2 |
  | `efflorescence` | 백태·열화 | area | hatch `TRIANG` | m2 |
  | `etc` | 기타 | area | hatch `ANSI33` | m2 |
  | `rebar_exposure` | 철근노출 | area | 없음(선·원 모양 미정) | m2 |
  | `crack_efflorescence` | 균열/백태 | line | 없음(선 주위 원 미정) | m |
- 모든 유형의 `layer`는 `'신규손상'`, `colorIndex`는 `1`(빨강)
- `kind: 'line'` → `quantityUnit: 'm'`, `kind: 'area'` → `quantityUnit: 'm2'`
- 물량은 사용자가 입력한 `measured` 값이 기준이다. 앱이 계산한 `computed` 값은 참고 표시 전용이며 물량으로 쓰지 않는다
- 면형 도형은 회전 가능한 사각형을 **네 꼭짓점**으로 저장한다(각도를 따로 저장하지 않는다)
- 저장 형식은 `schemaVersion: 2`. v1 문서를 읽으면 `crack` + `polyline` + `computed.lengthDwg`로 변환해 읽고, 저장은 항상 v2로 한다
- 선·원 도형 유형(`rebar_exposure`, `crack_efflorescence`)의 임시 동작: 균열/백태는 **선만**, 철근노출은 **사각형 테두리만** 그린다
- 원의 지름·간격은 도면 좌표 기준 고정값(mm)이며 실제 숫자는 아직 없다(`null`)
- 브라우저 코드(`server/public/**`)는 빌드 없는 ES 모듈 JS, 화면 문구는 한국어
- 균열 선 굵기는 화면 기준 1px(선택 시 2px), 색은 빨강 `#e53935`(선택 `#fb8c00`)
- 모든 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 파일 구조

```
server/public/viewer/damageTypes.js   생성: 유형 정의와 조회 함수 (뷰어·서버 공용)
server/public/viewer/damageDoc.js     수정: schemaVersion 2, v1 변환, 유형·도형 검증
server/public/viewer/geometry.js      수정: 사각형 생성·회전·면적·포함 판정 추가
server/public/viewer/overlay.js       수정: 면형 사각형과 무늬(SVG 패턴), 선택 핸들 렌더링
server/public/viewer/crackTool.js     수정: 유형별 입력(선 / 사각형 드래그 / 회전·크기 핸들)
server/public/viewer/main.js          수정: 유형 팔레트, 속성 입력창, 저장 연동
server/public/viewer.html             수정: 유형 팔레트와 속성 입력창 요소
server/public/viewer/viewer.css       수정: 팔레트·속성창·핸들 스타일
server/src/app.ts                     수정: PUT 검증에 v2 문서 사용
server/src/damagesStore.ts            수정: 읽을 때 v1 → v2 변환
server/test/damageTypes.test.ts       생성
server/test/damageDoc.test.ts         수정: v2 검증과 v1 변환 테스트
server/test/geometry.test.ts          수정: 사각형 관련 테스트
server/test/stores.test.ts            수정: v1 문서 읽기 변환 테스트
server/test/app.test.ts               수정: v2 문서 PUT/GET 테스트
```

---

### Task 1: 손상 유형 정의 파일

**Files:**
- Create: `server/public/viewer/damageTypes.js`
- Test: `server/test/damageTypes.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `DAMAGE_TYPES`: 위 표 순서 그대로의 배열. 각 항목은 `{ id, label, kind, fill, decoration, layer, colorIndex, quantityUnit }`
  - `fill`: `null` 또는 `{ kind: 'hatch', pattern: string, scale: number, angle: number }`
  - `decoration`: `null` 또는 `{ kind: 'circles', diameterMm: number | null, spacingMm: number | null }`
  - `getDamageType(id): object | null`
  - `isDamageTypeId(value): boolean`
  - `DEFAULT_DAMAGE_TYPE_ID = 'crack'`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/damageTypes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_TYPES,
  DEFAULT_DAMAGE_TYPE_ID,
  getDamageType,
  isDamageTypeId,
} from '../public/viewer/damageTypes.js';

describe('DAMAGE_TYPES', () => {
  it('스펙의 10종을 순서대로 담는다', () => {
    expect(DAMAGE_TYPES.map((t: { id: string }) => t.id)).toEqual([
      'crack',
      'map_crack',
      'breakage',
      'segregation',
      'delamination',
      'spalling',
      'efflorescence',
      'etc',
      'rebar_exposure',
      'crack_efflorescence',
    ]);
  });

  it('id가 중복되지 않는다', () => {
    const ids = DAMAGE_TYPES.map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 유형이 신규손상 레이어와 빨간색(1)을 쓴다', () => {
    for (const type of DAMAGE_TYPES) {
      expect(type.layer).toBe('신규손상');
      expect(type.colorIndex).toBe(1);
    }
  });

  it('선형은 m, 면형은 ㎡ 단위를 쓴다', () => {
    for (const type of DAMAGE_TYPES) {
      expect(['line', 'area']).toContain(type.kind);
      expect(type.quantityUnit).toBe(type.kind === 'line' ? 'm' : 'm2');
    }
  });

  it('각 유형의 이름과 채우기가 스펙과 같다', () => {
    const summary = DAMAGE_TYPES.map((t: { id: string; label: string; kind: string; fill: { pattern?: string } | null }) => [
      t.id,
      t.label,
      t.kind,
      t.fill ? t.fill.pattern : null,
    ]);
    expect(summary).toEqual([
      ['crack', '균열', 'line', null],
      ['map_crack', '망상균열', 'area', 'NET'],
      ['breakage', '파손', 'area', null],
      ['segregation', '재료분리', 'area', 'CORK'],
      ['delamination', '박리', 'area', 'ANSI31'],
      ['spalling', '박락', 'area', 'ANSI37'],
      ['efflorescence', '백태·열화', 'area', 'TRIANG'],
      ['etc', '기타', 'area', 'ANSI33'],
      ['rebar_exposure', '철근노출', 'area', null],
      ['crack_efflorescence', '균열/백태', 'line', null],
    ]);
  });

  it('해치는 패턴 이름·축척·각도를 모두 갖는다', () => {
    for (const type of DAMAGE_TYPES) {
      if (!type.fill) continue;
      expect(type.fill.kind).toBe('hatch');
      expect(type.fill.pattern).toMatch(/^[A-Z0-9_-]+$/);
      expect(typeof type.fill.scale).toBe('number');
      expect(typeof type.fill.angle).toBe('number');
    }
  });

  it('선·원 도형 유형만 decoration을 갖고, 숫자는 아직 비어 있다', () => {
    const withDecoration = DAMAGE_TYPES.filter((t: { decoration: unknown }) => t.decoration !== null);
    expect(withDecoration.map((t: { id: string }) => t.id)).toEqual(['rebar_exposure', 'crack_efflorescence']);
    for (const type of withDecoration) {
      expect(type.decoration).toEqual({ kind: 'circles', diameterMm: null, spacingMm: null });
    }
  });
});

describe('getDamageType / isDamageTypeId', () => {
  it('id로 유형을 찾고, 없으면 null', () => {
    expect(getDamageType('spalling')?.label).toBe('박락');
    expect(getDamageType('nope')).toBeNull();
  });

  it('유형 id 여부를 판정한다', () => {
    expect(isDamageTypeId('crack')).toBe(true);
    expect(isDamageTypeId('nope')).toBe(false);
    expect(isDamageTypeId(null)).toBe(false);
  });

  it('기본 유형은 균열', () => {
    expect(DEFAULT_DAMAGE_TYPE_ID).toBe('crack');
    expect(isDamageTypeId(DEFAULT_DAMAGE_TYPE_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/damageTypes.test.ts`
Expected: FAIL — `../public/viewer/damageTypes.js` 모듈 없음

- [ ] **Step 3: 구현**

`server/public/viewer/damageTypes.js`:
```js
// 손상 유형 정의. 뷰어와 서버가 함께 읽는다. 유형·해치·색을 바꾸려면 이 파일만 고치면 된다.
// 값의 근거: docs/superpowers/specs/2026-09-12-damage-types-design.md

const LAYER = '신규손상';
const COLOR_INDEX = 1; // 캐드 색 번호 1 = 빨강

function hatch(pattern) {
  return { kind: 'hatch', pattern, scale: 1, angle: 0 };
}

// 모양(선·원)이 아직 정해지지 않은 유형. 숫자는 도면 좌표 기준 mm로 나중에 채운다.
function circles() {
  return { kind: 'circles', diameterMm: null, spacingMm: null };
}

export const DAMAGE_TYPES = [
  { id: 'crack', label: '균열', kind: 'line', fill: null, decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm' },
  { id: 'map_crack', label: '망상균열', kind: 'area', fill: hatch('NET'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'breakage', label: '파손', kind: 'area', fill: null, decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'segregation', label: '재료분리', kind: 'area', fill: hatch('CORK'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'delamination', label: '박리', kind: 'area', fill: hatch('ANSI31'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'spalling', label: '박락', kind: 'area', fill: hatch('ANSI37'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'efflorescence', label: '백태·열화', kind: 'area', fill: hatch('TRIANG'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'etc', label: '기타', kind: 'area', fill: hatch('ANSI33'), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  // 모양을 받기 전까지: 사각형 테두리만 그린다
  { id: 'rebar_exposure', label: '철근노출', kind: 'area', fill: null, decoration: circles(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  // 모양을 받기 전까지: 선만 긋는다
  { id: 'crack_efflorescence', label: '균열/백태', kind: 'line', fill: null, decoration: circles(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm' },
];

export const DEFAULT_DAMAGE_TYPE_ID = 'crack';

export function getDamageType(id) {
  return DAMAGE_TYPES.find((type) => type.id === id) ?? null;
}

export function isDamageTypeId(value) {
  return typeof value === 'string' && DAMAGE_TYPES.some((type) => type.id === value);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/damageTypes.test.ts`
Expected: PASS (10 tests)

Run: `node --check server/public/viewer/damageTypes.js`
Expected: 출력 없음

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/damageTypes.js server/test/damageTypes.test.ts
git commit -m "feat(viewer): 손상 유형 10종 정의 파일" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: 손상 문서 v2 (유형·도형·물량 검증과 v1 변환)

**Files:**
- Modify: `server/public/viewer/damageDoc.js`
- Test: `server/test/damageDoc.test.ts` (기존 파일 교체)

**Interfaces:**
- Consumes: `getDamageType`, `isDamageTypeId` (Task 1)
- Produces:
  - `SCHEMA_VERSION = 2`, `MAX_HISTORY = 50` (변경 없음)
  - `createEmptyDoc(drawingId, updatedAt)` — `schemaVersion: 2`
  - `migrateDoc(doc, drawingId)` — v1 문서를 v2 형태로 바꿔 돌려준다. 이미 v2면 그대로, 객체가 아니면 `null`
  - `validateDamageDoc(doc, drawingId): string[]`
  - `createEditor`, `addDamage`, `removeDamage`, `undo`, `canUndo` — 시그니처 변경 없음
  - v2 손상 한 건의 형태:
    ```js
    {
      id, type,                       // type은 damageTypes.js의 id
      createdAt,
      geometry: { kind: 'polyline' | 'rect', world: [[x, y], …], dwg: [[x, y], …] | null },
      measured: { lengthM: number | null, areaM2: number | null },   // 사용자 입력(물량 기준)
      computed: { lengthDwg: number | null, areaDwg: number | null }, // 참고 표시용
      attrs: { widthMm: number | null, member: string, note: string },
    }
    ```

- [ ] **Step 1: 실패하는 테스트 작성 (기존 파일 전체 교체)**

`server/test/damageDoc.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  addDamage,
  canUndo,
  createEditor,
  createEmptyDoc,
  MAX_HISTORY,
  migrateDoc,
  removeDamage,
  SCHEMA_VERSION,
  undo,
  validateDamageDoc,
} from '../public/viewer/damageDoc.js';

const DRAWING = 'd_0123456789abcdef0123456789abcdef';
const T0 = '2026-09-12T00:00:00.000Z';
const T1 = '2026-09-12T00:00:01.000Z';
const T2 = '2026-09-12T00:00:02.000Z';

function lineDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'crack',
    createdAt: T0,
    geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
    measured: { lengthM: 5, areaM2: null },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { widthMm: 0.3, member: '거더 하부', note: '' },
    ...overrides,
  };
}

function areaDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'spalling',
    createdAt: T0,
    geometry: {
      kind: 'rect',
      world: [[0, 0], [2, 0], [2, 1], [0, 1]],
      dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
    },
    measured: { lengthM: null, areaM2: 1.8 },
    computed: { lengthDwg: null, areaDwg: 2 },
    attrs: { widthMm: null, member: '', note: '' },
    ...overrides,
  };
}

function docWith(damages: unknown[]) {
  return { ...createEmptyDoc(DRAWING, T0), damages };
}

describe('createEmptyDoc', () => {
  it('schemaVersion 2인 빈 문서를 만든다', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(createEmptyDoc(DRAWING, T0)).toEqual({
      schemaVersion: 2,
      drawingId: DRAWING,
      updatedAt: T0,
      damages: [],
    });
  });
});

describe('validateDamageDoc', () => {
  it('빈 문서와 선형·면형 손상은 유효', () => {
    expect(validateDamageDoc(createEmptyDoc(DRAWING, T0), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a'), areaDamage('b')]), DRAWING)).toEqual([]);
  });

  it('문서 수준 오류를 알려준다', () => {
    expect(validateDamageDoc(null, DRAWING)).toEqual(['문서가 객체가 아닙니다.']);
    expect(
      validateDamageDoc({ schemaVersion: 1, drawingId: 'd_other', updatedAt: 'nope', damages: 'x' }, DRAWING),
    ).toEqual([
      'schemaVersion은 2이어야 합니다.',
      'drawingId가 주소와 다릅니다.',
      'updatedAt이 올바른 날짜가 아닙니다.',
      'damages는 배열이어야 합니다.',
    ]);
  });

  it('유형 목록에 없는 type을 거부한다', () => {
    const errors = validateDamageDoc(docWith([lineDamage('a', { type: 'nope' })]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });

  it('선형은 polyline 2점 이상, 면형은 rect 4점이어야 한다', () => {
    const wrongKind = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(wrongKind).toContain('damages[0].geometry.kind는 선형 손상이면 polyline이어야 합니다.');

    const shortRect = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1]], dwg: null }, computed: { lengthDwg: null, areaDwg: null } })]),
      DRAWING,
    );
    expect(shortRect).toContain('damages[0].geometry.world는 유효한 점 4개여야 합니다.');

    const shortLine = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'polyline', world: [[0, 0]], dwg: null }, computed: { lengthDwg: null, areaDwg: null } })]),
      DRAWING,
    );
    expect(shortLine).toContain('damages[0].geometry.world는 유효한 점 2개 이상이어야 합니다.');
  });

  it('dwg는 world와 점 개수가 같아야 하고, 없으면 computed도 모두 null이어야 한다', () => {
    const mismatch = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: [[0, 0], [1, 1]] } })]),
      DRAWING,
    );
    expect(mismatch).toContain('damages[0].geometry.dwg는 world와 점 개수가 같아야 합니다.');

    const noDwg = validateDamageDoc(
      docWith([areaDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [2, 0], [2, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(noDwg).toEqual(['damages[0].computed는 dwg가 없으면 모두 null이어야 합니다.']);
  });

  it('물량은 유형의 단위 쪽만 채울 수 있고 0 이상이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: null, areaM2: 2 } })]), DRAWING)).toContain(
      'damages[0].measured.areaM2는 선형 손상에서 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([areaDamage('a', { measured: { lengthM: 3, areaM2: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.lengthM은 면형 손상에서 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: -1, areaM2: null } })]), DRAWING)).toContain(
      'damages[0].measured.lengthM은 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { lengthM: null, areaM2: null } })]), DRAWING)).toEqual([]);
  });

  it('속성 값 형식을 확인한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { widthMm: -2, member: '', note: '' } })]), DRAWING)).toContain(
      'damages[0].attrs.widthMm는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { widthMm: null, member: 3, note: '' } })]), DRAWING)).toContain(
      'damages[0].attrs.member와 note는 문자열이어야 합니다.',
    );
  });

  it('중복 id를 거부한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a'), areaDamage('a')]), DRAWING)).toEqual([
      'damages[1].id가 중복됩니다: a',
    ]);
  });
});

describe('migrateDoc', () => {
  const v1Doc = {
    schemaVersion: 1,
    drawingId: DRAWING,
    updatedAt: T1,
    damages: [
      {
        id: 'old-1',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
        lengthDwg: 5,
      },
      {
        id: 'old-2',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [1, 0]], dwg: null },
        lengthDwg: null,
      },
    ],
  };

  it('v1 문서를 v2로 바꾸고 그 결과는 검증을 통과한다', () => {
    const migrated = migrateDoc(v1Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    });
    expect(migrated.damages[1].computed).toEqual({ lengthDwg: null, areaDwg: null });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('이미 v2면 그대로 돌려준다', () => {
    const doc = docWith([areaDamage('a')]);
    expect(migrateDoc(doc, DRAWING)).toBe(doc);
  });

  it('객체가 아니면 null', () => {
    expect(migrateDoc(null, DRAWING)).toBeNull();
    expect(migrateDoc('x', DRAWING)).toBeNull();
  });
});

describe('editor', () => {
  it('추가·삭제·undo가 문서와 updatedAt을 바꾼다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(canUndo(editor)).toBe(false);

    editor = addDamage(editor, areaDamage('a'), T1);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T1);

    editor = removeDamage(editor, 'a', T2);
    expect(editor.doc.damages).toEqual([]);

    editor = undo(editor, T2);
    expect(editor.doc.damages.map((d: { id: string }) => d.id)).toEqual(['a']);
    expect(editor.doc.updatedAt).toBe(T2);
  });

  it('원본 editor를 변경하지 않고, 없는 id 삭제와 기록 없는 undo는 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    addDamage(editor, lineDamage('a'), T1);
    expect(editor.doc.damages).toEqual([]);
    expect(removeDamage(editor, 'nope', T1)).toBe(editor);
    expect(undo(editor, T1)).toBe(editor);
  });

  it('undo 기록은 최대 MAX_HISTORY개', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    for (let i = 0; i < MAX_HISTORY + 10; i++) editor = addDamage(editor, lineDamage(`c${i}`), T1);
    expect(editor.history.length).toBe(MAX_HISTORY);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: FAIL — `SCHEMA_VERSION`이 1이고 `migrateDoc`이 없어 여러 테스트가 실패

- [ ] **Step 3: 구현**

`server/public/viewer/damageDoc.js` — 상단 import와 검증 부분을 아래로 바꾼다. `createEditor`/`addDamage`/`removeDamage`/`undo`/`canUndo`/`commit`은 그대로 둔다.

```js
// 손상 문서(JSON 원본) 생성·검증·편집. 브라우저와 서버가 함께 쓴다. 모든 함수는 입력을 변경하지 않는다.

import { getDamageType } from './damageTypes.js';

export const SCHEMA_VERSION = 2;
export const MAX_HISTORY = 50;

export function createEmptyDoc(drawingId, updatedAt) {
  return { schemaVersion: SCHEMA_VERSION, drawingId, updatedAt, damages: [] };
}

function isDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPointList(value, exactLength) {
  if (!Array.isArray(value)) return false;
  if (exactLength === null ? value.length < 2 : value.length !== exactLength) return false;
  return value.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// null이거나 0 이상의 유한한 숫자
function isNullableAmount(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function validateGeometry(damage, type, path, errors) {
  const geometry = damage.geometry;
  if (typeof geometry !== 'object' || geometry === null) {
    errors.push(`${path}.geometry가 객체가 아닙니다.`);
    return false;
  }
  const expectedKind = type.kind === 'line' ? 'polyline' : 'rect';
  if (geometry.kind !== expectedKind) {
    const which = type.kind === 'line' ? '선형 손상이면 polyline' : '면형 손상이면 rect';
    errors.push(`${path}.geometry.kind는 ${which}이어야 합니다.`);
    return false;
  }
  const pointCount = expectedKind === 'rect' ? 4 : null;
  if (!isPointList(geometry.world, pointCount)) {
    errors.push(
      pointCount === 4
        ? `${path}.geometry.world는 유효한 점 4개여야 합니다.`
        : `${path}.geometry.world는 유효한 점 2개 이상이어야 합니다.`,
    );
    return false;
  }
  if (geometry.dwg === null) return false;
  if (!isPointList(geometry.dwg, geometry.world.length)) {
    errors.push(`${path}.geometry.dwg는 world와 점 개수가 같아야 합니다.`);
    return false;
  }
  return true;
}

function validateMeasured(damage, type, path, errors) {
  const measured = damage.measured;
  if (typeof measured !== 'object' || measured === null) {
    errors.push(`${path}.measured가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(measured.lengthM)) {
    errors.push(`${path}.measured.lengthM은 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableAmount(measured.areaM2)) {
    errors.push(`${path}.measured.areaM2는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (type.quantityUnit === 'm' && measured.areaM2 !== null) {
    errors.push(`${path}.measured.areaM2는 선형 손상에서 null이어야 합니다.`);
  }
  if (type.quantityUnit === 'm2' && measured.lengthM !== null) {
    errors.push(`${path}.measured.lengthM은 면형 손상에서 null이어야 합니다.`);
  }
}

function validateComputed(damage, hasDwg, path, errors) {
  const computed = damage.computed;
  if (typeof computed !== 'object' || computed === null) {
    errors.push(`${path}.computed가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(computed.lengthDwg) || !isNullableAmount(computed.areaDwg)) {
    errors.push(`${path}.computed 값은 0 이상의 숫자이거나 null이어야 합니다.`);
    return;
  }
  if (!hasDwg && (computed.lengthDwg !== null || computed.areaDwg !== null)) {
    errors.push(`${path}.computed는 dwg가 없으면 모두 null이어야 합니다.`);
  }
}

function validateAttrs(damage, path, errors) {
  const attrs = damage.attrs;
  if (typeof attrs !== 'object' || attrs === null) {
    errors.push(`${path}.attrs가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(attrs.widthMm)) {
    errors.push(`${path}.attrs.widthMm는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (typeof attrs.member !== 'string' || typeof attrs.note !== 'string') {
    errors.push(`${path}.attrs.member와 note는 문자열이어야 합니다.`);
  }
}

function validateDamage(damage, path, errors) {
  if (typeof damage !== 'object' || damage === null) {
    errors.push(`${path}가 객체가 아닙니다.`);
    return;
  }
  if (typeof damage.id !== 'string' || damage.id === '') errors.push(`${path}.id가 비어 있습니다.`);
  const type = typeof damage.type === 'string' ? getDamageType(damage.type) : null;
  if (!type) {
    errors.push(`${path}.type이 손상 유형 목록에 없습니다.`);
    return;
  }
  if (!isDateString(damage.createdAt)) errors.push(`${path}.createdAt이 올바른 날짜가 아닙니다.`);

  const hasDwg = validateGeometry(damage, type, path, errors);
  validateMeasured(damage, type, path, errors);
  validateComputed(damage, hasDwg, path, errors);
  validateAttrs(damage, path, errors);
}

export function validateDamageDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['문서가 객체가 아닙니다.'];
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion은 2이어야 합니다.');
  if (doc.drawingId !== drawingId) errors.push('drawingId가 주소와 다릅니다.');
  if (!isDateString(doc.updatedAt)) errors.push('updatedAt이 올바른 날짜가 아닙니다.');
  if (!Array.isArray(doc.damages)) {
    errors.push('damages는 배열이어야 합니다.');
    return errors;
  }
  const seen = new Set();
  doc.damages.forEach((damage, i) => {
    const path = `damages[${i}]`;
    validateDamage(damage, path, errors);
    if (damage && typeof damage.id === 'string' && damage.id !== '') {
      if (seen.has(damage.id)) errors.push(`${path}.id가 중복됩니다: ${damage.id}`);
      seen.add(damage.id);
    }
  });
  return errors;
}

// v1 문서(균열만, lengthDwg 한 개)를 v2 형태로 바꿔 읽는다. 저장은 항상 v2로 한다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  if (doc.schemaVersion !== 1) return doc;
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    drawingId: doc.drawingId ?? drawingId,
    updatedAt: doc.updatedAt,
    damages: damages.map((damage) => ({
      id: damage.id,
      type: damage.type === 'crack' ? 'crack' : damage.type,
      createdAt: damage.createdAt,
      geometry: damage.geometry,
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: damage.lengthDwg ?? null, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    })),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: PASS (16 tests)

Run: `node --check server/public/viewer/damageDoc.js`
Expected: 출력 없음

- [ ] **Step 5: 남은 참조 정리 확인**

Run: `npm --prefix server test`
Expected: `test/app.test.ts`와 `test/stores.test.ts`가 v1 문서를 쓰고 있어 실패한다. 이 실패는 Task 3에서 고친다. 실패한 테스트 이름을 보고하고 다음 단계로 넘어간다.

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```
git add server/public/viewer/damageDoc.js server/test/damageDoc.test.ts
git commit -m "feat(viewer): 손상 문서 v2 (유형·도형·물량 검증, v1 자동 변환)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: 서버 저장소·API를 v2로 맞추기

**Files:**
- Modify: `server/src/damagesStore.ts`
- Test: `server/test/stores.test.ts`(추가), `server/test/app.test.ts`(수정)

**Interfaces:**
- Consumes: `createEmptyDoc`, `migrateDoc`, `validateDamageDoc` (Task 2)
- Produces:
  - `DamagesStore.get(drawingId)` — 파일이 v1이면 v2로 변환해서 돌려준다. 파일이 없으면 지금처럼 `updatedAt`이 `1970-01-01T00:00:00.000Z`인 빈 v2 문서
  - `DamagesStore.save(doc)` — 변경 없음(받은 문서를 그대로 저장). 저장 전 검증은 `app.ts`의 `PUT`이 한다
  - `PUT /api/drawings/:id/damages`는 Task 2의 v2 규칙으로 검증한다(코드 변경 없음, 동작만 바뀜)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/stores.test.ts`의 `describe('DamagesStore', …)` 안에 아래 테스트를 추가한다. 파일 상단 import에 `writeJsonFileAtomic`이 이미 있고 없으면 추가한다.

```ts
  it('v1 문서를 읽으면 v2로 변환해서 돌려준다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    await writeJsonFileAtomic(join(dir, 'damages', `${id}.json`), {
      schemaVersion: 1,
      drawingId: id,
      updatedAt: '2026-09-10T00:00:00.000Z',
      damages: [
        {
          id: 'old-1',
          type: 'crack',
          createdAt: '2026-09-10T00:00:00.000Z',
          geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
          lengthDwg: 5,
        },
      ],
    });

    const doc = await store.get(id);

    expect(doc.schemaVersion).toBe(2);
    expect(doc.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: '2026-09-10T00:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    });
  });
```

`server/test/app.test.ts`의 `crackDoc` 헬퍼를 v2 형태로 바꾸고, 면형 손상 헬퍼를 추가한다.

```ts
function crackDoc(drawingId: string) {
  return {
    schemaVersion: 2,
    drawingId,
    updatedAt: '2026-09-10T01:00:00.000Z',
    damages: [
      {
        id: 'c1',
        type: 'crack',
        createdAt: '2026-09-10T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
        measured: { lengthM: 5, areaM2: null },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { widthMm: 0.3, member: '거더 하부', note: '' },
      },
    ],
  };
}

function spallingDoc(drawingId: string) {
  return {
    schemaVersion: 2,
    drawingId,
    updatedAt: '2026-09-12T01:00:00.000Z',
    damages: [
      {
        id: 's1',
        type: 'spalling',
        createdAt: '2026-09-12T01:00:00.000Z',
        geometry: {
          kind: 'rect',
          world: [[0, 0], [2, 0], [2, 1], [0, 1]],
          dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
        },
        measured: { lengthM: null, areaM2: 1.8 },
        computed: { lengthDwg: null, areaDwg: 2 },
        attrs: { widthMm: null, member: '', note: '' },
      },
    ],
  };
}
```

같은 파일의 `'저장 전에는 빈 문서, 저장 후에는 저장한 문서'` 테스트에서 빈 문서 기대값의 `schemaVersion`을 `2`로 바꾸고, `'형식이 틀리면 400과 상세 오류'` 테스트의 기대 문구를 `'schemaVersion은 2이어야 합니다.'`로 바꾼다. 그리고 아래 두 테스트를 `describe('손상 문서 API', …)`에 추가한다.

```ts
  it('면형 손상 문서도 저장·조회된다', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const doc = spallingDoc(drawing.id);

    const put = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(doc);
    expect(put.status).toBe(200);

    const saved = await request(app).get(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY);
    expect(saved.body).toEqual(doc);
  });

  it('유형 목록에 없는 type은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const bad = crackDoc(drawing.id);
    bad.damages[0].type = 'nope';

    const res = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(bad);

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/stores.test.ts test/app.test.ts`
Expected: FAIL — v1 문서를 읽는 테스트는 `schemaVersion: 1`이 그대로 나오고, 빈 문서 기대값(`schemaVersion: 2`)도 맞지 않는다

- [ ] **Step 3: 구현**

`server/src/damagesStore.ts`:
```ts
import { join } from 'node:path';
import { createEmptyDoc, migrateDoc } from '../public/viewer/damageDoc.js';
import { isDrawingId } from './drawingsStore.js';
import { readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export interface DamageDoc {
  schemaVersion: number;
  drawingId: string;
  updatedAt: string;
  damages: unknown[];
}

const NEVER_SAVED = new Date(0).toISOString();

export class DamagesStore {
  constructor(private readonly dir: string) {}

  async get(drawingId: string): Promise<DamageDoc> {
    const saved = await readJsonFile<DamageDoc>(this.pathFor(drawingId));
    if (!saved) return createEmptyDoc(drawingId, NEVER_SAVED);
    // 예전에 저장된 v1 문서는 읽을 때 v2로 바꿔서 돌려준다. 저장은 항상 v2로 한다.
    return (migrateDoc(saved, drawingId) as DamageDoc | null) ?? createEmptyDoc(drawingId, NEVER_SAVED);
  }

  async save(doc: DamageDoc): Promise<void> {
    await writeJsonFileAtomic(this.pathFor(doc.drawingId), doc);
  }

  private pathFor(drawingId: string): string {
    if (!isDrawingId(drawingId)) throw new Error(`잘못된 도면 id: ${drawingId}`);
    return join(this.dir, `${drawingId}.json`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test`
Expected: PASS — 전체 통과 (Task 2에서 실패했던 `app.test.ts`, `stores.test.ts` 포함)

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/src/damagesStore.ts server/test/stores.test.ts server/test/app.test.ts
git commit -m "feat(server): 손상 문서 v2 저장·조회와 v1 자동 변환" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: 회전 사각형 계산 함수

**Files:**
- Modify: `server/public/viewer/geometry.js`
- Test: `server/test/geometry.test.ts`(추가)

**Interfaces:**
- Consumes: 기존 `distanceToSegment`(같은 파일)
- Produces (점은 `[x, y]`, 사각형은 시계 방향 또는 반시계 방향으로 이어지는 네 점):
  - `rectFromDrag(start, end): Point[4]` — 드래그한 두 점을 대각선으로 하는 가로·세로 방향 사각형. 순서는 `start`, `(end.x, start.y)`, `end`, `(start.x, end.y)`
  - `rectCenter(points): Point` — 네 점의 평균
  - `angleOf(center, point): number` — 라디안, `Math.atan2` 기준
  - `rotatePoints(points, center, angleRad): Point[]` — 주어진 중심으로 회전한 새 배열
  - `resizeRect(points, cornerIndex, newPoint): Point[4]` — 반대쪽 모서리를 고정한 채 한 모서리를 끌어 크기를 바꾼다. 회전 상태를 유지한다
  - `polygonArea(points): number` — 항상 0 이상
  - `pointInPolygon(point, polygon): boolean` — 경계선 위의 점은 `true`로 본다(선택 판정용)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/geometry.test.ts` 상단 import에 새 함수를 추가하고, 파일 끝에 아래 `describe` 블록들을 추가한다.

```ts
import {
  angleOf,
  distanceToPolyline,
  distanceToSegment,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rectCenter,
  rectFromDrag,
  resizeRect,
  rotatePoints,
  simplifyPolyline,
} from '../public/viewer/geometry.js';
```

```ts
describe('rectFromDrag', () => {
  it('드래그한 두 점을 대각선으로 하는 사각형을 만든다', () => {
    expect(rectFromDrag([1, 2], [5, 6])).toEqual([[1, 2], [5, 2], [5, 6], [1, 6]]);
  });

  it('반대 방향으로 드래그해도 네 점이 이어진 사각형이다', () => {
    expect(rectFromDrag([5, 6], [1, 2])).toEqual([[5, 6], [1, 6], [1, 2], [5, 2]]);
  });
});

describe('rectCenter / angleOf / rotatePoints', () => {
  const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];

  it('네 점의 가운데를 구한다', () => {
    expect(rectCenter(rect)).toEqual([2, 1]);
  });

  it('중심에서 점까지의 각도를 라디안으로 구한다', () => {
    expect(angleOf([0, 0], [1, 0])).toBeCloseTo(0, 10);
    expect(angleOf([0, 0], [0, 2])).toBeCloseTo(Math.PI / 2, 10);
  });

  it('중심을 기준으로 90도 회전한다', () => {
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 2);
    expect(rotated[0][0]).toBeCloseTo(3, 10);
    expect(rotated[0][1]).toBeCloseTo(-1, 10);
    expect(rotated[2][0]).toBeCloseTo(1, 10);
    expect(rotated[2][1]).toBeCloseTo(3, 10);
    expect(polygonArea(rotated)).toBeCloseTo(8, 10);
    expect(rect).toEqual([[0, 0], [4, 0], [4, 2], [0, 2]]);
  });
});

describe('resizeRect', () => {
  it('반대쪽 모서리를 고정한 채 크기를 바꾼다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const resized = resizeRect(rect, 2, [6, 5]);
    expect(resized[0]).toEqual([0, 0]);
    expect(polygonArea(resized)).toBeCloseTo(30, 10);
    expect(resized[2][0]).toBeCloseTo(6, 10);
    expect(resized[2][1]).toBeCloseTo(5, 10);
  });

  it('회전된 사각형은 기울기를 유지한 채 크기만 바뀐다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 2);
    const resized = resizeRect(rotated, 2, rotated[2]);
    for (let i = 0; i < 4; i++) {
      expect(resized[i][0]).toBeCloseTo(rotated[i][0], 8);
      expect(resized[i][1]).toBeCloseTo(rotated[i][1], 8);
    }
  });
});

describe('polygonArea', () => {
  it('사각형 면적을 구하고 도는 방향과 무관하게 0 이상이다', () => {
    const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(polygonArea(rect)).toBeCloseTo(8, 10);
    expect(polygonArea([...rect].reverse())).toBeCloseTo(8, 10);
  });

  it('점이 3개 미만이면 0', () => {
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0);
  });
});

describe('pointInPolygon', () => {
  const rect: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];

  it('안쪽은 true, 바깥은 false', () => {
    expect(pointInPolygon([2, 1], rect)).toBe(true);
    expect(pointInPolygon([5, 1], rect)).toBe(false);
    expect(pointInPolygon([2, 3], rect)).toBe(false);
  });

  it('경계선 위의 점도 true', () => {
    expect(pointInPolygon([0, 1], rect)).toBe(true);
    expect(pointInPolygon([4, 2], rect)).toBe(true);
  });

  it('회전된 사각형에서도 맞는다', () => {
    const rotated = rotatePoints(rect, rectCenter(rect), Math.PI / 4);
    expect(pointInPolygon(rectCenter(rect), rotated)).toBe(true);
    expect(pointInPolygon([rectCenter(rect)[0] + 3, rectCenter(rect)[1] + 3], rotated)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/geometry.test.ts`
Expected: FAIL — `rectFromDrag` 등을 `geometry.js`에서 내보내지 않아 import 오류

- [ ] **Step 3: 구현**

`server/public/viewer/geometry.js` 끝에 추가한다(기존 함수는 그대로 둔다).

```js
// 면형 손상은 회전 가능한 사각형을 네 꼭짓점으로 저장한다. 아래 함수들은 그 네 점을 다룬다.

export function rectFromDrag(start, end) {
  return [
    [start[0], start[1]],
    [end[0], start[1]],
    [end[0], end[1]],
    [start[0], end[1]],
  ];
}

export function rectCenter(points) {
  const sum = points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

export function angleOf(center, point) {
  return Math.atan2(point[1] - center[1], point[0] - center[0]);
}

export function rotatePoints(points, center, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
  });
}

// 끄는 모서리의 대각선 반대 모서리를 고정하고, 사각형이 기울어진 방향(변 방향)을 유지한 채 크기를 바꾼다.
export function resizeRect(points, cornerIndex, newPoint) {
  const fixed = points[(cornerIndex + 2) % 4];
  const next = points[(cornerIndex + 1) % 4];
  const previous = points[(cornerIndex + 3) % 4];

  const uRaw = [next[0] - fixed[0], next[1] - fixed[1]];
  const vRaw = [previous[0] - fixed[0], previous[1] - fixed[1]];
  const uLength = Math.hypot(uRaw[0], uRaw[1]) || 1;
  const vLength = Math.hypot(vRaw[0], vRaw[1]) || 1;
  const u = [uRaw[0] / uLength, uRaw[1] / uLength];
  const v = [vRaw[0] / vLength, vRaw[1] / vLength];

  const d = [newPoint[0] - fixed[0], newPoint[1] - fixed[1]];
  const width = d[0] * u[0] + d[1] * u[1];
  const height = d[0] * v[0] + d[1] * v[1];

  const alongU = [fixed[0] + u[0] * width, fixed[1] + u[1] * width];
  const alongV = [fixed[0] + v[0] * height, fixed[1] + v[1] * height];
  const opposite = [fixed[0] + u[0] * width + v[0] * height, fixed[1] + u[1] * width + v[1] * height];

  const result = [];
  result[(cornerIndex + 2) % 4] = fixed;
  result[(cornerIndex + 1) % 4] = alongU;
  result[cornerIndex] = opposite;
  result[(cornerIndex + 3) % 4] = alongV;
  return result;
}

export function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// 광선 교차 방식. 경계선 위의 점은 안쪽으로 본다(탭으로 고를 때 가장자리를 놓치지 않도록).
export function pointInPolygon(point, polygon) {
  const [px, py] = point;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (distanceToSegment(point, a, b) <= 1e-9) return true;
  }
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/geometry.test.ts`
Expected: PASS (기존 11개 + 추가 11개)

Run: `node --check server/public/viewer/geometry.js`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/geometry.js server/test/geometry.test.ts
git commit -m "feat(viewer): 회전 사각형 생성·회전·크기조절·면적·포함 판정" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: 화면 표시 — 사각형, 유형별 무늬, 선택 핸들

**Files:**
- Modify: `server/public/viewer/overlay.js`
- Test: `server/test/overlay.test.ts`(생성)

**Interfaces:**
- Consumes: `getDamageType` (Task 1), `rectCenter` (Task 4)
- Produces:
  - 기존 `CRACK_COLOR`, `SELECTED_COLOR`, `CRACK_WIDTH_PX`, `SELECTED_WIDTH_PX` 유지
  - `HANDLE_SIZE_PX = 12`, `ROTATE_HANDLE_OFFSET_PX = 28`
  - `HATCH_PATTERNS`: 패턴 이름 → SVG 정의 함수 맵. 키는 `NET`, `CORK`, `ANSI31`, `ANSI33`, `ANSI37`, `TRIANG`
  - `rectHandlePositions(screenRect): { corners: Point[4], rotate: Point }` — 화면 좌표 네 점에서 모서리 핸들 4개와 회전 핸들 1개의 위치를 구한다(순수 함수)
  - `createOverlay(svg, mapper)` — `setDamages(list)`, `setSelected(id)`, `setDraft(draft)`, `requestRender()`
    - `draft`는 `null` 또는 `{ kind: 'polyline' | 'rect', points: Point[] }` (화면 좌표)
- 그리는 규칙
  - 선형: 빨간 폴리라인 (`CRACK_WIDTH_PX`), 선택 시 주황 (`SELECTED_WIDTH_PX`)
  - 면형: 빨간 테두리 + 유형의 해치 패턴으로 채움. 패턴이 없으면 채우지 않는다
  - 채우기가 없는 면형(파손, 철근노출)은 사각형 가운데에 유형 이름을 작게 표시한다
  - 선택된 면형에는 모서리 핸들 4개와 회전 핸들 1개를 그린다
  - 무늬 간격은 화면 픽셀 기준이라 확대해도 촘촘해지지 않는다

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/overlay.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import { HANDLE_SIZE_PX, HATCH_PATTERNS, rectHandlePositions, ROTATE_HANDLE_OFFSET_PX } from '../public/viewer/overlay.js';

type Pt = [number, number];

describe('HATCH_PATTERNS', () => {
  it('유형 정의가 쓰는 모든 해치 패턴의 그림 정의가 있다', () => {
    const used = DAMAGE_TYPES.filter((t: { fill: { pattern?: string } | null }) => t.fill).map(
      (t: { fill: { pattern: string } }) => t.fill.pattern,
    );
    expect(used.length).toBeGreaterThan(0);
    for (const pattern of used) {
      expect(Object.keys(HATCH_PATTERNS)).toContain(pattern);
      expect(typeof HATCH_PATTERNS[pattern]).toBe('function');
    }
  });
});

describe('rectHandlePositions', () => {
  const rect: Pt[] = [[0, 0], [40, 0], [40, 20], [0, 20]];

  it('모서리 핸들은 네 꼭짓점 위치에 있다', () => {
    expect(rectHandlePositions(rect).corners).toEqual(rect);
  });

  it('회전 핸들은 첫 변의 바깥쪽에 일정 거리만큼 떨어져 있다', () => {
    const { rotate } = rectHandlePositions(rect);
    // 첫 변(0→1)의 중점은 (20, 0)이고 사각형 중심은 (20, 10)이므로 바깥은 y가 작아지는 쪽이다.
    expect(rotate[0]).toBeCloseTo(20, 6);
    expect(rotate[1]).toBeCloseTo(-ROTATE_HANDLE_OFFSET_PX, 6);
  });

  it('회전된 사각형에서도 첫 변 바깥쪽을 향한다', () => {
    const rotated: Pt[] = [[0, 0], [0, 40], [-20, 40], [-20, 0]];
    const { rotate } = rectHandlePositions(rotated);
    expect(rotate[0]).toBeCloseTo(ROTATE_HANDLE_OFFSET_PX, 6);
    expect(rotate[1]).toBeCloseTo(20, 6);
  });

  it('핸들 크기 상수는 손가락으로 누를 수 있는 크기다', () => {
    expect(HANDLE_SIZE_PX).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/overlay.test.ts`
Expected: FAIL — `rectHandlePositions`, `HATCH_PATTERNS` 등을 `overlay.js`에서 내보내지 않아 import 오류

- [ ] **Step 3: 구현**

`server/public/viewer/overlay.js` 전체를 아래로 바꾼다.

```js
// 손상을 SVG로 그린다. 저장은 world 좌표로 하고, 그릴 때마다 현재 카메라 기준 화면 좌표로 바꾼다.

import { getDamageType } from './damageTypes.js';
import { rectCenter } from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const CRACK_COLOR = '#e53935';
export const SELECTED_COLOR = '#fb8c00';
// 화면 기준 선 굵기(px). 줌과 무관하게 일정하다. 굵기를 바꾸려면 이 값만 고치면 된다.
export const CRACK_WIDTH_PX = 1;
export const SELECTED_WIDTH_PX = 2;
export const HANDLE_SIZE_PX = 12;
export const ROTATE_HANDLE_OFFSET_PX = 28;

// 해치 패턴의 화면 표현. 캐드 패턴을 그대로 그리는 것이 아니라 구분이 되도록 흉내 낸다.
// 간격 단위는 화면 픽셀이라 도면을 확대해도 촘촘해지지 않는다.
function patternElement(id, size, drawChildren) {
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', String(size));
  pattern.setAttribute('height', String(size));
  for (const child of drawChildren(size)) pattern.append(child);
  return pattern;
}

function line(x1, y1, x2, y2) {
  const el = document.createElementNS(SVG_NS, 'line');
  el.setAttribute('x1', String(x1));
  el.setAttribute('y1', String(y1));
  el.setAttribute('x2', String(x2));
  el.setAttribute('y2', String(y2));
  el.setAttribute('stroke', CRACK_COLOR);
  el.setAttribute('stroke-width', '1');
  return el;
}

function dot(cx, cy, r) {
  const el = document.createElementNS(SVG_NS, 'circle');
  el.setAttribute('cx', String(cx));
  el.setAttribute('cy', String(cy));
  el.setAttribute('r', String(r));
  el.setAttribute('fill', CRACK_COLOR);
  return el;
}

export const HATCH_PATTERNS = {
  ANSI31: (size) => [line(0, size, size, 0)],
  ANSI33: (size) => [line(0, size, size, 0), line(0, size / 2, size / 2, 0)],
  ANSI37: (size) => [line(0, size, size, 0), line(0, 0, size, size)],
  NET: (size) => [line(0, 0, size, 0), line(0, 0, 0, size)],
  CORK: (size) => [line(0, size, size, 0), dot(size / 2, size / 2, 1)],
  TRIANG: (size) => [line(0, size, size / 2, 0), line(size / 2, 0, size, size), line(0, size, size, size)],
};

const PATTERN_SIZE_PX = 10;

function ensurePatternDefs(svg) {
  if (svg.querySelector('defs[data-mangdo-patterns]')) return;
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.setAttribute('data-mangdo-patterns', '');
  for (const [name, draw] of Object.entries(HATCH_PATTERNS)) {
    defs.append(patternElement(`mangdo-hatch-${name}`, PATTERN_SIZE_PX, draw));
  }
  svg.append(defs);
}

// 첫 변(0→1)의 중점에서 사각형 바깥쪽으로 떨어진 지점이 회전 핸들이다.
export function rectHandlePositions(screenRect) {
  const center = rectCenter(screenRect);
  const mid = [(screenRect[0][0] + screenRect[1][0]) / 2, (screenRect[0][1] + screenRect[1][1]) / 2];
  const away = [mid[0] - center[0], mid[1] - center[1]];
  const length = Math.hypot(away[0], away[1]) || 1;
  return {
    corners: screenRect.map((p) => [p[0], p[1]]),
    rotate: [mid[0] + (away[0] / length) * ROTATE_HANDLE_OFFSET_PX, mid[1] + (away[1] / length) * ROTATE_HANDLE_OFFSET_PX],
  };
}

function pointsAttr(points) {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

function polylineElement(points, color, width, opacity) {
  const el = document.createElementNS(SVG_NS, 'polyline');
  el.setAttribute('points', pointsAttr(points));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('opacity', String(opacity));
  return el;
}

function polygonElement(points, color, width, fillPattern, opacity) {
  const el = document.createElementNS(SVG_NS, 'polygon');
  el.setAttribute('points', pointsAttr(points));
  el.setAttribute('fill', fillPattern ? `url(#mangdo-hatch-${fillPattern})` : 'none');
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('opacity', String(opacity));
  return el;
}

function labelElement(point, text) {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', point[0].toFixed(1));
  el.setAttribute('y', point[1].toFixed(1));
  el.setAttribute('fill', CRACK_COLOR);
  el.setAttribute('font-size', '11');
  el.setAttribute('text-anchor', 'middle');
  el.textContent = text;
  return el;
}

function handleElement(point, shape) {
  const half = HANDLE_SIZE_PX / 2;
  const el = document.createElementNS(SVG_NS, shape === 'circle' ? 'circle' : 'rect');
  if (shape === 'circle') {
    el.setAttribute('cx', point[0].toFixed(1));
    el.setAttribute('cy', point[1].toFixed(1));
    el.setAttribute('r', String(half));
  } else {
    el.setAttribute('x', (point[0] - half).toFixed(1));
    el.setAttribute('y', (point[1] - half).toFixed(1));
    el.setAttribute('width', String(HANDLE_SIZE_PX));
    el.setAttribute('height', String(HANDLE_SIZE_PX));
  }
  el.setAttribute('fill', '#fff');
  el.setAttribute('stroke', SELECTED_COLOR);
  el.setAttribute('stroke-width', '2');
  return el;
}

export function createOverlay(svg, mapper) {
  let damages = [];
  let selectedId = null;
  let draft = null;
  let frame = 0;

  ensurePatternDefs(svg);

  function renderDamage(damage, elements) {
    const type = getDamageType(damage.type);
    if (!type) return;
    const selected = damage.id === selectedId;
    const color = selected ? SELECTED_COLOR : CRACK_COLOR;
    const width = selected ? SELECTED_WIDTH_PX : CRACK_WIDTH_PX;
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));

    if (damage.geometry.kind === 'polyline') {
      elements.push(polylineElement(screen, color, width, 1));
      return;
    }

    elements.push(polygonElement(screen, color, width, type.fill ? type.fill.pattern : null, 1));
    if (!type.fill) elements.push(labelElement(rectCenter(screen), type.label));
    if (!selected) return;

    const handles = rectHandlePositions(screen);
    for (const corner of handles.corners) elements.push(handleElement(corner, 'rect'));
    elements.push(handleElement(handles.rotate, 'circle'));
  }

  function render() {
    frame = 0;
    const elements = [];
    for (const damage of damages) renderDamage(damage, elements);
    if (draft && draft.points.length > 1) {
      elements.push(
        draft.kind === 'rect'
          ? polygonElement(draft.points, CRACK_COLOR, CRACK_WIDTH_PX, null, 0.6)
          : polylineElement(draft.points, CRACK_COLOR, CRACK_WIDTH_PX, 0.6),
      );
    }
    const defs = svg.querySelector('defs[data-mangdo-patterns]');
    svg.replaceChildren(defs, ...elements);
  }

  function requestRender() {
    if (frame === 0) frame = requestAnimationFrame(render);
  }

  return {
    setDamages(list) {
      damages = list;
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
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/overlay.test.ts`
Expected: PASS (5 tests)

Run: `node --check server/public/viewer/overlay.js`
Expected: 출력 없음

Run: `npm --prefix server test`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/overlay.js server/test/overlay.test.ts
git commit -m "feat(viewer): 면형 손상 사각형·유형별 무늬·선택 핸들 표시" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: 손상 만들기와 선택 판정 (순수 함수)

**Files:**
- Modify: `server/public/viewer/crackTool.js`
- Test: `server/test/crackTool.test.ts`(교체)

**Interfaces:**
- Consumes: `simplifyPolyline`, `polylineLength`, `distanceToPolyline`, `polygonArea`, `pointInPolygon`, `rectFromDrag` (Task 4), `getDamageType` (Task 1)
- Produces:
  - 기존 상수 유지: `SIMPLIFY_TOLERANCE_PX = 1.5`, `MIN_STROKE_PX = 10`, `PICK_RADIUS_PX = 12`
  - 새 상수: `MIN_RECT_PX = 10` — 드래그한 사각형의 가로·세로가 둘 다 이보다 작으면 버린다
  - `finalizeStroke(clientPoints, mapper, { now, newId, typeId })` → 선형 v2 손상 또는 `null`
  - `finalizeRect(startClient, endClient, mapper, { now, newId, typeId })` → 면형 v2 손상 또는 `null`
  - `pickDamage(damages, clientPoint, mapper, radiusPx?)` → 손상 id 또는 `null`. 면형은 안쪽을 눌러도 선택된다
  - 두 `finalize*`가 만드는 손상은 Task 2의 v2 형태를 그대로 따른다. `measured`는 항상 `{ lengthM: null, areaM2: null }`(사용자가 나중에 입력), `computed`는 dwg가 있으면 길이/면적, 없으면 둘 다 `null`, `attrs`는 `{ widthMm: null, member: '', note: '' }`

- [ ] **Step 1: 실패하는 테스트 작성 (기존 파일 교체)**

`server/test/crackTool.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { polylineLength } from '../public/viewer/geometry.js';
import { finalizeRect, finalizeStroke, MIN_RECT_PX, MIN_STROKE_PX, pickDamage } from '../public/viewer/crackTool.js';

type Pt = [number, number];

// 화면 10px = world 1, y축 반전. DWG = world + (1000, 2000)
const mapper = {
  clientToWorld: (x: number, y: number): Pt => [x / 10, -y / 10],
  worldToClient: ([x, y]: Pt): Pt => [x * 10, -y * 10],
  worldToDwg: ([x, y]: Pt): Pt => [x + 1000, y + 2000],
};

const options = { now: '2026-09-12T03:00:00.000Z', newId: () => 'new-id', typeId: 'crack' };
const areaOptions = { ...options, typeId: 'spalling' };

describe('finalizeStroke', () => {
  it('화면 길이가 10px 미만이면 버린다', () => {
    expect(MIN_STROKE_PX).toBe(10);
    expect(finalizeStroke([[0, 50], [9, 50]], mapper, options)).toBeNull();
    expect(finalizeStroke([[0, 50]], mapper, options)).toBeNull();
  });

  it('제자리에서 떨린 획은 단순화 후 길이가 10px 미만이면 버린다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i < 120; i++) stroke.push([100 + (i / 119) * 4, 100 + (i % 2 === 0 ? 0.3 : -0.3)]);
    expect(polylineLength(stroke)).toBeGreaterThan(MIN_STROKE_PX);
    expect(finalizeStroke(stroke, mapper, options)).toBeNull();
  });

  it('선형 손상을 v2 형태로 만든다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    expect(finalizeStroke(stroke, mapper, options)).toEqual({
      id: 'new-id',
      type: 'crack',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, -5], [10, -5]], dwg: [[1000, 1995], [1010, 1995]] },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: 10, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    });
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeStroke([[0, 50], [100, 50]], noDwg, options);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });

  it('면형 유형으로는 만들지 않는다', () => {
    expect(finalizeStroke([[0, 50], [100, 50]], mapper, areaOptions)).toBeNull();
  });
});

describe('finalizeRect', () => {
  it('드래그한 두 점으로 네 꼭짓점 사각형을 만든다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, areaOptions)).toEqual({
      id: 'new-id',
      type: 'spalling',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, -1], [0, -1]],
        dwg: [[1000, 2000], [1002, 2000], [1002, 1999], [1000, 1999]],
      },
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { widthMm: null, member: '', note: '' },
    });
  });

  it('너무 작은 사각형은 버린다', () => {
    expect(MIN_RECT_PX).toBe(10);
    expect(finalizeRect([0, 0], [9, 9], mapper, areaOptions)).toBeNull();
  });

  it('선형 유형으로는 만들지 않는다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, options)).toBeNull();
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeRect([0, 0], [20, 10], noDwg, areaOptions);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });
});

describe('pickDamage', () => {
  const line = {
    id: 'a',
    type: 'crack',
    geometry: { kind: 'polyline', world: [[0, -5], [10, -5]] as Pt[] },
  };
  const area = {
    id: 'b',
    type: 'spalling',
    geometry: { kind: 'rect', world: [[0, -10], [10, -10], [10, -20], [0, -20]] as Pt[] },
  };

  it('선형은 선 가까이를 누르면 선택된다', () => {
    expect(pickDamage([line, area], [50, 55], mapper)).toBe('a');
    expect(pickDamage([line, area], [50, 20], mapper)).toBeNull();
  });

  it('면형은 안쪽을 눌러도 선택된다', () => {
    expect(pickDamage([line, area], [50, 150], mapper)).toBe('b');
  });

  it('면형 테두리 근처도 선택된다', () => {
    expect(pickDamage([line, area], [50, 95], mapper)).toBe('b');
  });

  it('아무것도 없으면 null', () => {
    expect(pickDamage([], [0, 0], mapper)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/crackTool.test.ts`
Expected: FAIL — `finalizeRect`, `MIN_RECT_PX`가 없고 `finalizeStroke`가 v1 형태를 돌려준다

- [ ] **Step 3: 구현**

`server/public/viewer/crackTool.js`의 상단 import와 세 함수를 아래로 바꾼다. `createCrackInput`은 Task 7에서 고치므로 지금은 그대로 둔다(단, `finalizeStroke` 호출부는 Task 7에서 맞춘다).

```js
// 손상 입력. 펜은 항상 그리기, 손가락은 기본적으로 뷰어 줌·팬.
// "손가락 그리기"를 켜면 한 손가락 드래그와 마우스 드래그로 그리고, 두 손가락 핀치·회전은 뷰어에 넘긴다.

import { getDamageType } from './damageTypes.js';
import {
  distanceToPolyline,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rectFromDrag,
  simplifyPolyline,
} from './geometry.js';

export const SIMPLIFY_TOLERANCE_PX = 1.5;
export const MIN_STROKE_PX = 10;
export const MIN_RECT_PX = 10;
export const PICK_RADIUS_PX = 12;
const TOOL_NAME = 'mangdo-finger-draw';

function isFinitePoint(point) {
  return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

// world 점들을 DWG로 바꾼다. 하나라도 못 바꾸면 null.
function toDwg(worldPoints, mapper) {
  const dwg = worldPoints.map((point) => mapper.worldToDwg(point));
  return dwg.every((point) => point !== null && isFinitePoint(point)) ? dwg : null;
}

function emptyDamage(typeId, worldPoints, dwgPoints, kind, options) {
  return {
    id: options.newId(),
    type: typeId,
    createdAt: options.now,
    geometry: { kind, world: worldPoints, dwg: dwgPoints },
    measured: { lengthM: null, areaM2: null },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { widthMm: null, member: '', note: '' },
  };
}

export function finalizeStroke(clientPoints, mapper, options) {
  const type = getDamageType(options.typeId);
  if (!type || type.kind !== 'line') return null;
  if (clientPoints.length < 2) return null;
  // 화면과 world는 닮은꼴 변환이므로 화면 1.5px로 단순화하면 world에서도 같은 비율의 허용 오차가 된다.
  const simplified = simplifyPolyline(clientPoints, SIMPLIFY_TOLERANCE_PX);
  if (simplified.length < 2 || polylineLength(simplified) < MIN_STROKE_PX) return null;

  const world = simplified.map(([x, y]) => mapper.clientToWorld(x, y));
  if (!world.every((point) => point !== null && isFinitePoint(point))) return null;

  const dwg = toDwg(world, mapper);
  const damage = emptyDamage(options.typeId, world, dwg, 'polyline', options);
  if (dwg) damage.computed.lengthDwg = polylineLength(dwg);
  return damage;
}

export function finalizeRect(startClient, endClient, mapper, options) {
  const type = getDamageType(options.typeId);
  if (!type || type.kind !== 'area') return null;
  if (Math.abs(endClient[0] - startClient[0]) < MIN_RECT_PX && Math.abs(endClient[1] - startClient[1]) < MIN_RECT_PX) {
    return null;
  }

  const clientRect = rectFromDrag(startClient, endClient);
  const world = clientRect.map(([x, y]) => mapper.clientToWorld(x, y));
  if (!world.every((point) => point !== null && isFinitePoint(point))) return null;

  const dwg = toDwg(world, mapper);
  const damage = emptyDamage(options.typeId, world, dwg, 'rect', options);
  if (dwg) damage.computed.areaDwg = polygonArea(dwg);
  return damage;
}

export function pickDamage(damages, clientPoint, mapper, radiusPx = PICK_RADIUS_PX) {
  let bestId = null;
  let bestDistance = radiusPx;
  for (const damage of damages) {
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));
    if (damage.geometry.kind === 'rect' && pointInPolygon(clientPoint, screen)) return damage.id;
    const distance =
      damage.geometry.kind === 'rect'
        ? distanceToPolyline(clientPoint, [...screen, screen[0]])
        : distanceToPolyline(clientPoint, screen);
    if (distance <= bestDistance) {
      bestId = damage.id;
      bestDistance = distance;
    }
  }
  return bestId;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/crackTool.test.ts`
Expected: PASS (13 tests)

Run: `node --check server/public/viewer/crackTool.js`
Expected: 출력 없음

이 시점에는 `main.js`가 아직 예전 인자(`typeId` 없음)로 `finalizeStroke`를 부르므로 브라우저에서 균열이 만들어지지 않는다. Task 7과 8에서 이어 맞춘다.

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/crackTool.js server/test/crackTool.test.ts
git commit -m "feat(viewer): 유형별 손상 생성(선·사각형)과 면형 선택 판정" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: 입력 도구 — 사각형 드래그와 크기·회전 핸들

**Files:**
- Modify: `server/public/viewer/crackTool.js`
- Test: `server/test/crackTool.test.ts`(추가)

**Interfaces:**
- Consumes: `rectHandlePositions`, `HANDLE_SIZE_PX` (Task 5), `rectFromDrag`, `resizeRect`, `rotatePoints`, `rectCenter`, `angleOf` (Task 4)
- Produces:
  - `hitHandle(clientPoint, screenRect, sizePx?): { kind: 'corner', index: number } | { kind: 'rotate' } | null` — 순수 함수. 기본 적중 반경은 `HANDLE_SIZE_PX`
  - `createCrackInput({ viewer, container, isFingerDrawEnabled, getActiveTypeKind, getSelectedScreenRect, onDraft, onStroke, onRect, onTransform, onTap })`
    - `getActiveTypeKind(): 'line' | 'area'` — 지금 고른 유형의 입력 방식
    - `getSelectedScreenRect(): Point[4] | null` — 선택된 면형 손상의 화면 좌표 네 점(없으면 null)
    - `onDraft(draft)` — `null` 또는 `{ kind: 'polyline' | 'rect', points }`
    - `onStroke(clientPoints)` — 선형 입력이 끝났을 때
    - `onRect(startClient, endClient)` — 면형 드래그가 끝났을 때
    - `onTransform(screenRect, done)` — 핸들을 끄는 중(`done: false`)과 손을 뗐을 때(`done: true`)
    - `onTap(clientPoint)` — 탭(선택·좌표 확인)
  - 입력 우선순위: ① 선택된 사각형의 핸들 ② 지금 유형이 면형이면 사각형 드래그 ③ 선형이면 기존 획 그리기

- [ ] **Step 1: 실패하는 테스트 작성 (기존 파일에 추가)**

`server/test/crackTool.test.ts` 상단 import에 `hitHandle`을 추가하고, 파일 끝에 아래를 추가한다.

```ts
describe('hitHandle', () => {
  const rect: Pt[] = [[0, 0], [40, 0], [40, 20], [0, 20]];

  it('모서리 핸들을 누르면 그 번호를 돌려준다', () => {
    expect(hitHandle([0, 0], rect)).toEqual({ kind: 'corner', index: 0 });
    expect(hitHandle([40, 20], rect)).toEqual({ kind: 'corner', index: 2 });
  });

  it('회전 핸들을 누르면 rotate', () => {
    expect(hitHandle([20, -28], rect)).toEqual({ kind: 'rotate' });
  });

  it('핸들에서 멀면 null', () => {
    expect(hitHandle([20, 10], rect)).toBeNull();
    expect(hitHandle([200, 200], rect)).toBeNull();
  });

  it('사각형이 없으면 null', () => {
    expect(hitHandle([0, 0], null)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/crackTool.test.ts`
Expected: FAIL — `hitHandle`을 `crackTool.js`에서 내보내지 않아 import 오류

- [ ] **Step 3: 구현**

`server/public/viewer/crackTool.js`의 import에 아래를 더한다.

```js
import { HANDLE_SIZE_PX, rectHandlePositions } from './overlay.js';
import { angleOf, rectCenter, rectFromDrag, resizeRect, rotatePoints } from './geometry.js';
```

(이미 있는 `geometry.js` import 줄과 합쳐 한 줄로 쓴다.)

`pickDamage` 아래에 추가한다.

```js
export function hitHandle(clientPoint, screenRect, sizePx = HANDLE_SIZE_PX) {
  if (!screenRect) return null;
  const { corners, rotate } = rectHandlePositions(screenRect);
  const near = (point) => Math.hypot(clientPoint[0] - point[0], clientPoint[1] - point[1]) <= sizePx;
  for (let index = 0; index < corners.length; index++) {
    if (near(corners[index])) return { kind: 'corner', index };
  }
  return near(rotate) ? { kind: 'rotate' } : null;
}
```

`createCrackInput`을 아래로 바꾼다. 포인터를 삼키는 규칙(펜 우선, 팜 리젝션, 먼저 닿은 접촉의 up 전달)은 그대로 두고, **무엇을 그리는가**만 달라진다.

```js
export function createCrackInput({
  viewer,
  container,
  isFingerDrawEnabled,
  getActiveTypeKind,
  getSelectedScreenRect,
  onDraft,
  onStroke,
  onRect,
  onTransform,
  onTap,
}) {
  let activePointerId = null;
  let points = [];
  const swallowedPointers = new Set();
  // 지금 진행 중인 동작: null | { kind: 'stroke' } | { kind: 'rect', start }
  //   | { kind: 'resize', index, rect } | { kind: 'rotate', rect, center, startAngle }
  let gesture = null;

  function toCanvas(event) {
    const rect = viewer.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  // window 캡처 단계에서 막으면 뷰어(캔버스 mousedown, Hammer 포인터 입력)가 이벤트를 받지 못한다.
  function swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function inViewer(event) {
    return event.target instanceof Node && container.contains(event.target);
  }

  function wantsDrawing(event) {
    if (event.pointerType === 'pen') return true;
    return event.pointerType === 'mouse' && event.button === 0 && isFingerDrawEnabled();
  }

  function startGesture(point) {
    const selectedRect = getSelectedScreenRect();
    const handle = hitHandle(point, selectedRect);
    if (handle && selectedRect) {
      gesture =
        handle.kind === 'corner'
          ? { kind: 'resize', index: handle.index, rect: selectedRect }
          : { kind: 'rotate', rect: selectedRect, center: rectCenter(selectedRect), startAngle: angleOf(rectCenter(selectedRect), point) };
      return;
    }
    if (getActiveTypeKind() === 'area') {
      gesture = { kind: 'rect', start: point };
      onDraft({ kind: 'rect', points: rectFromDrag(point, point) });
      return;
    }
    gesture = { kind: 'stroke' };
    points = [point];
    onDraft({ kind: 'polyline', points });
  }

  function moveGesture(point, samples) {
    if (!gesture) return;
    if (gesture.kind === 'stroke') {
      for (const sample of samples) points.push(sample);
      onDraft({ kind: 'polyline', points });
      return;
    }
    if (gesture.kind === 'rect') {
      onDraft({ kind: 'rect', points: rectFromDrag(gesture.start, point) });
      return;
    }
    if (gesture.kind === 'resize') {
      onTransform(resizeRect(gesture.rect, gesture.index, point), false);
      return;
    }
    onTransform(rotatePoints(gesture.rect, gesture.center, angleOf(gesture.center, point) - gesture.startAngle), false);
  }

  function endGesture(point, cancelled) {
    const current = gesture;
    gesture = null;
    const stroke = points;
    points = [];
    if (!current) return;
    if (cancelled) {
      onDraft(null);
      if (current.kind === 'resize' || current.kind === 'rotate') onTransform(current.rect, true);
      return;
    }
    if (current.kind === 'stroke') {
      onDraft(null);
      onStroke(stroke);
      return;
    }
    if (current.kind === 'rect') {
      onDraft(null);
      onRect(current.start, point);
      return;
    }
    if (current.kind === 'resize') {
      onTransform(resizeRect(current.rect, current.index, point), true);
      return;
    }
    onTransform(rotatePoints(current.rect, current.center, angleOf(current.center, point) - current.startAngle), true);
  }

  function onPointerDown(event) {
    if (activePointerId !== null) {
      // 펜으로 그리는 중 닿은 손바닥·다른 손가락은 무시한다 (팜 리젝션).
      swallowedPointers.add(event.pointerId);
      swallow(event);
      return;
    }
    if (!inViewer(event) || !wantsDrawing(event)) return;
    swallow(event);
    swallowedPointers.add(event.pointerId);
    activePointerId = event.pointerId;
    startGesture(toCanvas(event));
  }

  function onPointerMove(event) {
    if (activePointerId === null) return;
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = (coalesced.length > 0 ? coalesced : [event]).map((sample) => toCanvas(sample));
    moveGesture(samples[samples.length - 1], samples);
  }

  function onPointerEnd(event) {
    // 펜보다 먼저 닿아 있던 접촉은 뷰어가 down을 이미 받았으므로 up/cancel을 그대로 넘긴다.
    if (!swallowedPointers.has(event.pointerId)) return;
    swallowedPointers.delete(event.pointerId);
    swallow(event);
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    endGesture(toCanvas(event), event.type === 'pointercancel');
  }

  // iOS는 Apple Pencil에 대해 touch 이벤트도 보낸다. 펜 터치와 그리는 중의 터치는 뷰어에 넘기지 않는다.
  function onTouch(event) {
    const hasStylus = Array.from(event.changedTouches).some((touch) => touch.touchType === 'stylus');
    if (activePointerId !== null || (hasStylus && inViewer(event))) swallow(event);
  }

  const listenerOptions = { capture: true, passive: false };
  window.addEventListener('pointerdown', onPointerDown, listenerOptions);
  window.addEventListener('pointermove', onPointerMove, listenerOptions);
  window.addEventListener('pointerup', onPointerEnd, listenerOptions);
  window.addEventListener('pointercancel', onPointerEnd, listenerOptions);
  for (const type of ['touchstart', 'touchmove', 'touchend']) {
    window.addEventListener(type, onTouch, listenerOptions);
  }

  // 손가락 그리기: 뷰어 도구로 등록해 한 손가락 드래그(drag*)만 가져간다.
  const tool = new Autodesk.Viewing.ToolInterface();
  tool.names = [TOOL_NAME];
  tool.getPriority = () => 100;
  tool.handleGesture = (event) => {
    if (!isFingerDrawEnabled()) return false;
    const point = [event.canvasX, event.canvasY];
    switch (event.type) {
      case 'dragstart':
        startGesture(point);
        return true;
      case 'dragmove':
        if (!gesture) return false;
        moveGesture(point, [point]);
        return true;
      case 'dragend':
        if (!gesture) return false;
        endGesture(point, false);
        return true;
      default:
        // 두 손가락 핀치·회전이 시작되면 그리던 것을 버리고 뷰어가 줌·팬하도록 넘긴다.
        if (gesture) endGesture(point, true);
        return false;
    }
  };
  tool.handleSingleTap = (event) => onTap([event.canvasX, event.canvasY]);
  tool.handleSingleClick = (event, button) => {
    if (button !== 0) return false;
    const point = typeof event.canvasX === 'number' ? [event.canvasX, event.canvasY] : toCanvas(event);
    return onTap(point);
  };
  viewer.toolController.registerTool(tool);
  viewer.toolController.activateTool(TOOL_NAME);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/crackTool.test.ts`
Expected: PASS (17 tests)

Run: `node --check server/public/viewer/crackTool.js`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/crackTool.js server/test/crackTool.test.ts
git commit -m "feat(viewer): 면형 사각형 드래그 입력과 크기·회전 핸들 조작" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: 유형 팔레트와 속성 입력창

**Files:**
- Modify: `server/public/viewer.html`, `server/public/viewer/viewer.css`, `server/public/viewer/main.js`, `server/public/viewer/damageDoc.js`
- Test: `server/test/damageDoc.test.ts`(추가)

**Interfaces:**
- Consumes: `DAMAGE_TYPES`, `getDamageType`, `DEFAULT_DAMAGE_TYPE_ID` (Task 1), `migrateDoc`(Task 2), `polygonArea`, `polylineLength`(Task 4), `createOverlay`(Task 5), `finalizeStroke`, `finalizeRect`, `pickDamage`, `createCrackInput`(Task 6·7)
- Produces:
  - `damageDoc.js`에 `updateDamage(editor, damageId, changes, now)` 추가 — 해당 손상에 얕은 병합(`geometry`, `measured`, `computed`, `attrs`는 각각 병합)한 새 editor를 돌려준다. 없는 id면 같은 editor
  - 뷰어 화면: 유형 선택 `<select id="damageType">`, 속성 버튼과 입력창(`#props`)
  - 선택한 손상의 크기·회전 변경과 속성 입력이 저장으로 이어진다

- [ ] **Step 1: 실패하는 테스트 작성 (damageDoc)**

`server/test/damageDoc.test.ts`의 import에 `updateDamage`를 추가하고, `describe('editor', …)` 안에 추가한다.

```ts
  it('updateDamage는 값을 병합하고 updatedAt을 올린다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    editor = addDamage(editor, areaDamage('a'), T1);

    editor = updateDamage(editor, 'a', { measured: { areaM2: 3.5 }, attrs: { note: '확인 필요' } }, T2);

    expect(editor.doc.damages[0].measured).toEqual({ lengthM: null, areaM2: 3.5 });
    expect(editor.doc.damages[0].attrs).toEqual({ widthMm: null, member: '', note: '확인 필요' });
    expect(editor.doc.damages[0].geometry).toEqual(areaDamage('a').geometry);
    expect(editor.doc.updatedAt).toBe(T2);
    expect(canUndo(editor)).toBe(true);
  });

  it('updateDamage는 없는 id면 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(updateDamage(editor, 'nope', { measured: { areaM2: 1 } }, T1)).toBe(editor);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: FAIL — `updateDamage`가 없다

- [ ] **Step 3: damageDoc에 updateDamage 추가**

`server/public/viewer/damageDoc.js`의 `removeDamage` 아래에 넣는다.

```js
// 손상 한 건의 일부만 바꾼다. geometry·measured·computed·attrs는 각각 얕게 병합한다.
export function updateDamage(editor, damageId, changes, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  const updated = {
    ...current,
    ...changes,
    geometry: { ...current.geometry, ...(changes.geometry ?? {}) },
    measured: { ...current.measured, ...(changes.measured ?? {}) },
    computed: { ...current.computed, ...(changes.computed ?? {}) },
    attrs: { ...current.attrs, ...(changes.attrs ?? {}) },
  };
  const damages = editor.doc.damages.map((damage, i) => (i === index ? updated : damage));
  return commit(editor, damages, now);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: PASS (18 tests)

- [ ] **Step 5: 화면 요소 추가**

`server/public/viewer.html`의 `#toolbar` 안, `fingerDraw` 버튼 앞에 유형 선택을 넣고, `#coordPanel` 앞에 속성 입력창을 넣는다.

```html
      <select id="damageType" aria-label="손상 유형"></select>
      <button id="props" type="button" disabled>속성</button>
```

```html
    <div id="propsPanel" hidden>
      <h2 id="propsTitle"></h2>
      <label id="lengthRow">길이 (m) <input id="lengthInput" type="number" step="0.01" min="0" inputmode="decimal" /></label>
      <label id="areaRow">면적 (㎡) <input id="areaInput" type="number" step="0.01" min="0" inputmode="decimal" /></label>
      <label>균열 폭 (mm) <input id="widthInput" type="number" step="0.1" min="0" inputmode="decimal" /></label>
      <label>부재명 <input id="memberInput" type="text" /></label>
      <label>비고 <input id="noteInput" type="text" /></label>
      <p id="computedHint"></p>
      <div class="row">
        <button id="propsSave" type="button">저장</button>
        <button id="propsClose" type="button">닫기</button>
      </div>
    </div>
```

`server/public/viewer/viewer.css`에 추가한다.

```css
#damageType {
  font-size: 15px;
  padding: 9px 8px;
  border-radius: 8px;
  border: 1px solid #c7c9cf;
  background: #fff;
  max-width: 130px;
}

#propsPanel {
  position: absolute;
  right: 12px;
  top: calc(12px + env(safe-area-inset-top));
  z-index: 12;
  width: 240px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  font-size: 14px;
}

#propsPanel h2 { font-size: 15px; margin: 0 0 8px; }
#propsPanel label { display: block; margin-bottom: 8px; }
#propsPanel input { width: 100%; font-size: 15px; padding: 6px 8px; box-sizing: border-box; }
#propsPanel .row { display: flex; gap: 8px; }
#propsPanel button { flex: 1; font-size: 15px; padding: 9px 0; border-radius: 8px; border: 1px solid #c7c9cf; background: #fff; }
#propsSave { background: #1e66f5; border-color: #1e66f5; color: #fff; }
#computedHint { margin: 0 0 8px; color: #8a8f98; font-size: 12px; }

#propsPanel[hidden], #lengthRow[hidden], #areaRow[hidden] { display: none; }
```

- [ ] **Step 6: main.js 연결**

`server/public/viewer/main.js`를 아래와 같이 고친다.

import 줄을 바꾼다.
```js
import { addDamage, canUndo, createEditor, migrateDoc, removeDamage, undo, updateDamage, validateDamageDoc } from './damageDoc.js';
import { DAMAGE_TYPES, DEFAULT_DAMAGE_TYPE_ID, getDamageType } from './damageTypes.js';
import { polygonArea, polylineLength } from './geometry.js';
import { createCoordinateMapper } from './coords.js';
import { createCrackInput, finalizeRect, finalizeStroke, pickDamage } from './crackTool.js';
import { createOverlay } from './overlay.js';
import { chooseInitialDoc, createSyncer } from './sync.js';
```

`start()` 안, 서버 문서를 받은 직후에 v2로 올린다.
```js
  const serverDocV2 = migrateDoc(serverDoc, drawingId) ?? serverDoc;
```
이후 `chooseInitialDoc(serverDoc, …)` 호출을 `chooseInitialDoc(serverDocV2, …)`로 바꾸고, 백업 검증도 v2 기준 그대로 둔다.

상태 변수에 유형을 더한다.
```js
  let activeTypeId = DEFAULT_DAMAGE_TYPE_ID;
```

유형 선택 목록을 채운다(`refresh()` 정의 앞).
```js
  for (const type of DAMAGE_TYPES) {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.label;
    $('damageType').append(option);
  }
  $('damageType').value = activeTypeId;
  $('damageType').addEventListener('change', () => {
    activeTypeId = $('damageType').value;
  });
```

선택된 손상을 찾는 도우미와 화면 좌표 변환을 더한다.
```js
  const selectedDamage = () => editor.doc.damages.find((damage) => damage.id === selectedId) ?? null;

  function selectedScreenRect() {
    const damage = selectedDamage();
    if (!damage || damage.geometry.kind !== 'rect') return null;
    return damage.geometry.world.map((point) => mapper.worldToClient(point));
  }
```

`refresh()`에 속성 버튼 상태를 더한다.
```js
    $('props').disabled = selectedId === null;
```

`createCrackInput` 호출을 바꾼다.
```js
  createCrackInput({
    viewer,
    container: $('viewer'),
    isFingerDrawEnabled: () => fingerDraw,
    getActiveTypeKind: () => getDamageType(activeTypeId)?.kind ?? 'line',
    getSelectedScreenRect: selectedScreenRect,
    onDraft: (draft) => overlay.setDraft(draft),
    onTap: handleTap,
    onStroke: (points) => {
      overlay.setDraft(null);
      const lastPoint = points[points.length - 1];
      if (coordCheck) {
        handleTap(lastPoint);
        return;
      }
      const damage = finalizeStroke(points, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeId });
      if (!damage) {
        // 너무 짧은 획은 탭으로 보고 손상 선택에 쓴다.
        handleTap(lastPoint);
        return;
      }
      selectedId = null;
      apply(addDamage(editor, damage, nowIso()));
    },
    onRect: (start, end) => {
      overlay.setDraft(null);
      if (coordCheck) {
        handleTap(end);
        return;
      }
      const damage = finalizeRect(start, end, mapper, { now: nowIso(), newId: () => crypto.randomUUID(), typeId: activeTypeId });
      if (!damage) {
        handleTap(end);
        return;
      }
      selectedId = null;
      apply(addDamage(editor, damage, nowIso()));
    },
    onTransform: (screenRect, done) => {
      if (!done) {
        overlay.setDraft({ kind: 'rect', points: screenRect });
        return;
      }
      overlay.setDraft(null);
      const damage = selectedDamage();
      if (!damage) return;
      const world = screenRect.map(([x, y]) => mapper.clientToWorld(x, y));
      if (world.some((point) => point === null)) return;
      const dwgPoints = world.map((point) => mapper.worldToDwg(point));
      const dwg = dwgPoints.every((point) => point !== null) ? dwgPoints : null;
      apply(
        updateDamage(
          editor,
          damage.id,
          { geometry: { world, dwg }, computed: { lengthDwg: null, areaDwg: dwg ? polygonArea(dwg) : null } },
          nowIso(),
        ),
      );
    },
  });
```

속성 입력창을 연결한다(버튼 연결부 근처에 추가).
```js
  function openProps() {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type);
    $('propsTitle').textContent = `${type.label} 속성`;
    $('lengthRow').hidden = type.quantityUnit !== 'm';
    $('areaRow').hidden = type.quantityUnit !== 'm2';
    $('lengthInput').value = damage.measured.lengthM ?? '';
    $('areaInput').value = damage.measured.areaM2 ?? '';
    $('widthInput').value = damage.attrs.widthMm ?? '';
    $('memberInput').value = damage.attrs.member;
    $('noteInput').value = damage.attrs.note;
    const computed = type.quantityUnit === 'm' ? damage.computed.lengthDwg : damage.computed.areaDwg;
    $('computedHint').textContent =
      computed === null ? '참고값 없음 (DWG 좌표 변환 불가)' : `참고: 도면에서 계산한 값 ${computed.toFixed(1)} (도면 단위)`;
    $('propsPanel').hidden = false;
  }

  function numberOrNull(value) {
    const text = value.trim();
    if (text === '') return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  $('props').addEventListener('click', openProps);
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
  });
  $('propsSave').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type);
    apply(
      updateDamage(
        editor,
        damage.id,
        {
          measured: {
            lengthM: type.quantityUnit === 'm' ? numberOrNull($('lengthInput').value) : null,
            areaM2: type.quantityUnit === 'm2' ? numberOrNull($('areaInput').value) : null,
          },
          attrs: {
            widthMm: numberOrNull($('widthInput').value),
            member: $('memberInput').value.trim(),
            note: $('noteInput').value.trim(),
          },
        },
        nowIso(),
      ),
    );
    $('propsPanel').hidden = true;
  });
```

`handleTap`에서 선택이 바뀌면 열려 있던 속성창을 닫는다.
```js
    selectedId = pickDamage(editor.doc.damages, point, mapper);
    $('propsPanel').hidden = true;
    refresh();
```

`$('delete')` 처리에서도 속성창을 닫는다(`apply(...)` 앞에 `$('propsPanel').hidden = true;`).

- [ ] **Step 7: 문법·전체 검사**

Run:
```
node --check server/public/viewer/main.js
node --check server/public/viewer/damageDoc.js
npm --prefix server test
npm --prefix server run typecheck
```
Expected: 모두 통과

- [ ] **Step 8: 커밋**

```
git add server/public/viewer.html server/public/viewer/viewer.css server/public/viewer/main.js server/public/viewer/damageDoc.js server/test/damageDoc.test.ts
git commit -m "feat(viewer): 손상 유형 선택과 속성 입력창, 크기·회전 변경 저장" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: 문서 갱신과 확인

**Files:**
- Modify: `README.md`
- Create: `docs/손상유형-테스트-결과.md`

**Interfaces:**
- Consumes: Task 1~8 전체
- Produces: 사용 방법 문서와 유형별 확인 결과 기록

- [ ] **Step 1: README 사용 설명 갱신**

`README.md`의 `## 사용` 절에서 3번 항목을 아래로 바꾼다(나머지 절은 그대로 둔다).

```markdown
3. 아래 도구막대에서 **손상 유형**을 고른 뒤 도면에 표기합니다
   - 선형(균열, 균열/백태): 펜으로 긋습니다. 손가락은 확대·이동입니다
   - 면형(나머지): 드래그해서 사각형을 그리면 유형별 무늬로 채워집니다
   - 사각형을 탭해 선택하면 모서리 핸들로 크기를, 위쪽 둥근 핸들로 기울기를 바꿉니다
   - 선택한 상태에서 **속성**을 열어 길이(m) 또는 면적(㎡), 균열 폭, 부재명, 비고를 적습니다. 물량표에는 여기 적은 값이 들어갑니다
   - `손가락 그리기`: 펜이 없을 때 한 손가락으로 그리기 (두 손가락은 확대·이동)
   - 손상을 탭 → `선택 삭제`, `마지막 취소`
   - `좌표 확인`: 탭한 지점의 뷰어/DWG 좌표 표시
```

- [ ] **Step 2: 확인 결과 문서 틀 만들기**

`docs/손상유형-테스트-결과.md`:
```markdown
# 손상 유형 확인 결과

- 확인 일자:
- 커밋:
- 확인 도면:

| # | 확인 항목 | 결과 | 비고 |
|---|---|---|---|
| 1 | 도구막대에서 유형 10종이 모두 보이고 고를 수 있다 | | |
| 2 | 균열(선형)을 그으면 예전처럼 빨간 선이 그려진다 | | |
| 3 | 면형 유형을 드래그하면 사각형이 그려지고 유형별 무늬가 다르게 보인다 | | |
| 4 | 파손·철근노출은 테두리와 이름만 표시된다 | | |
| 5 | 사각형을 선택해 모서리 핸들로 크기를 바꿀 수 있다 | | |
| 6 | 회전 핸들로 기울일 수 있고, 확대해도 기울기가 유지된다 | | |
| 7 | 속성에서 길이·면적을 입력하면 저장되고, 다시 열어도 남아 있다 | | |
| 8 | 선형에는 면적 칸이, 면형에는 길이 칸이 보이지 않는다 | | |
| 9 | 예전(v1)에 저장한 균열 도면을 열어도 그대로 보인다 | | |
| 10 | 서버 JSON이 `schemaVersion: 2`이고 `measured`에 입력값이 들어 있다 | | |

## 발견한 문제
```

- [ ] **Step 3: 전체 검증**

Run:
```
npm run server:test
npm --prefix server run typecheck
npx tsc --noEmit
node --check server/public/viewer/damageTypes.js
node --check server/public/viewer/damageDoc.js
node --check server/public/viewer/geometry.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/crackTool.js
node --check server/public/viewer/main.js
```
Expected: 모두 통과, 출력 오류 없음

- [ ] **Step 4: 커밋**

```
git add README.md "docs/손상유형-테스트-결과.md"
git commit -m "docs: 손상 유형 사용 방법과 확인 결과 문서" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: (사용자 체크포인트) 실기기 확인**

서버를 켜고 뷰어를 연 뒤, 위 표의 1~10번을 사용자와 함께 확인한다. 확인 결과를 문서에 채우고 커밋한다. 실패 항목이 있으면 superpowers:systematic-debugging으로 원인을 찾아 고친 뒤 그 항목만 다시 확인한다.

다음 단계(2단계 DWG 산출)에서 이 유형 정의와 출력 규칙(스펙 8장)을 그대로 쓴다.
