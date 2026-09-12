# 손상 속성·물량 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 길이·면적을 하나씩 직접 적던 입력을 실제 조사 방식(가로·세로·개소)으로 바꾸고, 번호·손상현황·물량·단위를 규칙으로 계산해 화면과 2단계 물량표가 같은 함수를 쓰게 한다.

**Architecture:** 계산으로 정해지는 값(번호·손상현황·물량·단위)은 새 순수 모듈 `quantities.js` 한 곳에 모으고 **저장하지 않는다**. 저장 형식은 `schemaVersion: 3`으로 올리며, 읽을 때 v1 → v2 → v3 단계를 이어 붙여 변환한다(서버와 뷰어가 각자 변환 — 이중 방어). 속성 패널은 네 칸(가로/폭·세로/길이·개소·비고)과 `기타` 전용 손상현황 칸을 갖고, 맨 윗줄에 번호·손상현황·물량을 읽기 전용으로 즉시 갱신해 보여준다. 도면 위 라벨은 번호 + 손상현황이 된다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript, Express 5, vitest, APS Viewer v7, 빌드 없는 ES 모듈 브라우저 JS, Expo SDK 57 앱(이번 계획에서는 변경 없음)

**Spec:** `docs/superpowers/specs/2026-09-13-damage-attributes-design.md`
(앞 설계 `docs/superpowers/specs/2026-09-12-damage-types-design.md`의 유형표·입력 방식·표시는 그대로 유효하고, 6장 물량과 7장 저장 형식만 새 설계가 대체한다.)

## Global Constraints

스펙에서 그대로 옮긴 구속값이다. 구현 중 판단이 갈리면 여기를 기준으로 한다.

**사용자가 입력하는 것 (스펙 2장)**

| 칸 | 균열·균열/백태 | 나머지 여덟 유형 | 비고 |
|---|---|---|---|
| 가로/폭 | mm | m | 0 이상 또는 빈 값 |
| 세로/길이 | m | m | 0 이상 또는 빈 값 |
| 개소 | 개 | 개 | 0 이상의 정수 또는 빈 값 |
| 비고 | 자유 문자열 | 자유 문자열 | 빈 문자열 허용 |

- `기타` 유형에만 **손상현황** 입력 칸이 하나 더 붙는다(자유 문자열).
- 빈 값은 "아직 측정하지 않음"이며 `null`로 저장한다. **0과 구분한다.**
- 화면에는 항상 단위를 함께 보여준다(`가로/폭 (mm)` / `가로/폭 (m)`).

**자동으로 정해지는 것 (스펙 3장) — 네 가지 모두 저장하지 않는다. 필요할 때마다 같은 함수로 계산한다.**

- 번호(3.1): 좌표는 `geometry.world`를 쓴다. 손상마다 경계상자의 중심과 높이를 구한다. 중심 Y가 큰 것(도면 위쪽)부터 줄을 만들고, 줄의 기준 Y에서 **허용 폭** 안에 드는 손상은 같은 줄로 본다. 한 줄 안에서는 중심 X가 작은 것(왼쪽)이 앞번호다. 줄이 끝나면 다음 줄 왼쪽으로 내려가 이어서 매긴다. 번호는 1부터 시작하는 연속된 정수다.
- **허용 폭**은 전체 손상 높이의 중앙값이다. 손상이 없거나 중앙값이 0이면 허용 폭을 0으로 두고 Y가 정확히 같을 때만 같은 줄로 본다.
- 동점 처리: 같은 줄에서 X가 같으면 Y가 큰 것이 앞, 그것도 같으면 `id` 오름차순. **같은 손상 집합이면 항상 같은 번호가 나와야 한다.**
- 손상현황(3.2): 균열 → 폭 < 0.3 `균열(0.3mm미만)` / 0.3 ≤ 폭 < 0.5 `균열(0.3mm이상)` / 0.5 ≤ 폭 `균열(0.5mm이상)`. 균열/백태는 같은 경계로 `균열/백태(…)`. 기타는 사용자가 적은 손상현황, 비어 있으면 `기타`. 나머지 일곱은 유형 이름 그대로. **균열류인데 폭이 비어 있으면 구간을 붙이지 않고 유형 이름 그대로 쓴다.**
- 물량(3.3): 단위가 `m`인 유형(균열, 균열/백태) → **세로/길이 × 개소**. 단위가 `㎡`인 유형(나머지 여덟) → **가로/폭 × 세로/길이 × 개소**. 계산에 필요한 값 중 하나라도 비어 있으면 물량도 `null`. 0은 유효한 값이다. **균열류의 가로/폭은 mm이고 물량 계산에 쓰이지 않는다. 손상현황 구간을 정하는 데만 쓴다.**
- 단위(3.4): 유형표의 `quantityUnit`을 그대로 쓴다(`m` 또는 `㎡`). 사용자가 바꾸지 않는다.

**저장 형식 (스펙 4장)**

```json
{
  "schemaVersion": 3,
  "drawingId": "...",
  "updatedAt": "2026-09-13T01:23:45.000Z",
  "damages": [
    {
      "id": "...",
      "type": "crack",
      "createdAt": "2026-09-13T01:23:45.000Z",
      "geometry": { "kind": "polyline", "world": [[0, 0]], "dwg": [[0, 0]] },
      "measured": { "width": 0.2, "length": 1.5, "count": 1 },
      "computed": { "lengthDwg": 4098.47, "areaDwg": null },
      "attrs": { "note": "", "statusText": "" }
    }
  ]
}
```

- `measured.width` / `measured.length` / `measured.count`: 0 이상의 숫자 또는 `null`. `count`는 정수.
- `computed`: v2와 같다. 도면에서 계산한 참고값이며 물량표에는 쓰지 않는다.
- `attrs.note`: 비고. `attrs.statusText`: `기타` 유형의 손상현황이며 **다른 유형에서는 빈 문자열이어야 한다.**
- v2의 `measured.lengthM` / `measured.areaM2` / `attrs.widthMm` / `attrs.member`는 없어진다.

**변환 (스펙 4.1, 4.2)**

| v2 | v3 |
|---|---|
| `attrs.widthMm` | `measured.width` (균열류는 mm 그대로, 면형 유형은 값이 없었으므로 `null`) |
| `measured.lengthM` | `measured.length` |
| `measured.areaM2` (값이 있을 때) | `measured`는 모두 `null`, 비고 앞에 `이전 면적 입력값: 1.8㎡` 를 붙인다 |
| `attrs.member` (값이 있을 때) | 비고 앞에 `부재명: 기둥` 을 붙인다 |
| `attrs.note` | `attrs.note` |
| 없음 | `attrs.statusText` = `""` |
| 없음 | `measured.count` = `null` |

- **면적에서 가로와 세로를 되돌릴 수 없으므로 지어내지 않는다. 값을 조용히 버리지도 않는다.** 비고가 이미 있으면 줄바꿈으로 잇는다.
- v1 → v3는 v1 → v2를 먼저 적용한 뒤 v2 → v3를 적용한다.

**화면 (스펙 5장)**

```
[유형이름] 속성
번호 17 · 손상현황 균열(0.3mm미만) · 물량 1.5 m
가로/폭 (mm) [     ]
세로/길이 (m) [     ]
개소        [     ]
비고        [     ]
(기타일 때만) 손상현황 [     ]
[저장] [닫기]
```

- 맨 윗줄의 번호·손상현황·물량은 읽기 전용이며 입력에 따라 즉시 갱신된다.
- 값이 부족해 물량을 계산할 수 없으면 물량 자리에 `-` 를 보여준다.
- 0 이상이 아닌 값을 넣고 저장하면 v2와 같이 **패널을 열어둔 채** 알린다. 개소에 정수가 아닌 값을 넣어도 같은 방식으로 거부한다.
- 도면 위 라벨을 **번호 + 손상현황**으로 바꾼다(예: `17 균열(0.3mm미만)`).

**검증 (스펙 6장)**

- `schemaVersion`이 3이어야 한다.
- `measured.width` / `length`: 0 이상의 유한한 숫자 또는 `null`.
- `measured.count`: 0 이상의 정수 또는 `null`.
- `attrs.note`: 문자열. `attrs.statusText`: 문자열이고, `기타`가 아닌 유형에서는 빈 문자열.
- 나머지(id, createdAt, type, geometry, computed)는 v2와 같다. v2에 있던 "선형에서 areaM2는 null" 류의 규칙은 항목이 없어져 함께 사라진다.

**코드베이스 규칙**

- `server/public/viewer/*.js`는 **빌드 단계가 없는 순수 ES 모듈**이고 정적으로 서빙된다. `server/test/`의 TypeScript 테스트가 이 파일들을 직접 import한다(`allowJs: true`, `checkJs: false`).
- 테스트 환경에 **DOM이 없다**(vitest, node 환경, jsdom 없음). `main.js`와 `crackTool.js`의 제스처 코드는 브라우저 전용이라 **읽기 + `node --check`로만 검증한다. 가짜 DOM 하네스를 만들지 않는다.**
- 손상 도형은 도면(DWG) 좌표로 저장한다. JSON이 원본이고 DWG는 산출물이다.
- 서버와 뷰어가 **둘 다** 읽을 때 변환한다(의도된 이중 방어).
- 화면 문구는 한국어.
- 모든 커밋 메시지 마지막 줄: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

```
server/public/viewer/quantities.js   생성: 번호·손상현황·물량·단위 계산(순수 함수). 저장하지 않는 파생값의 유일한 정의
server/public/viewer/damageDoc.js    수정: SCHEMA_VERSION 3, v1→v2→v3 변환 연결, v3 검증 규칙
server/public/viewer/crackTool.js    수정: emptyDamage가 v3 형태(measured width/length/count, attrs note/statusText)를 만든다
server/public/viewer/overlay.js      수정: 라벨을 번호 + 손상현황으로, 라벨 위치 계산(labelAnchor) 추가
server/public/viewer/main.js         수정: 속성 패널 네 칸 + 기타 전용 손상현황, 요약줄 즉시 갱신, 개소 정수 검증
server/public/viewer.html            수정: 속성 패널 마크업 교체(면적·부재명 제거, 개소·요약줄·손상현황 추가)
server/public/viewer/viewer.css      수정: 요약줄 스타일 추가
server/src/damagesStore.ts           수정: 주석만(변환 단계 설명). 동작은 migrateDoc이 담당
server/test/quantities.test.ts       생성: 번호·손상현황·물량·단위 규칙 테스트
server/test/damageDoc.test.ts        수정: v3 검증과 v2→v3·v1→v3 변환 테스트(파일 전체 교체)
server/test/crackTool.test.ts        수정: 새 손상의 v3 형태 기대값
server/test/overlay.test.ts          수정: 번호 + 손상현황 라벨과 labelAnchor 테스트
server/test/stores.test.ts           수정: v1·v2 파일을 읽으면 v3로 변환
server/test/app.test.ts              수정: v3 문서 PUT/GET, schemaVersion 오류 문구
README.md                            수정: 사용 절의 속성 패널 설명
docs/손상속성-테스트-결과.md          생성: 실기기 확인용 빈 체크 표(결과는 사용자가 채운다)
```

---

### Task 1: 파생값 계산 모듈 (번호·손상현황·물량·단위)

**Files:**
- Create: `server/public/viewer/quantities.js`
- Test: `server/test/quantities.test.ts` (생성)

**Interfaces:**
- Consumes: `getDamageType(id)` from `./damageTypes.js` — 유형 객체 `{ id, label, kind, fill, decoration, layer, colorIndex, quantityUnit }` 또는 `null`. `quantityUnit`은 `'m'` 또는 `'m2'`.
- Produces (모두 순수 함수. 손상 객체는 `{ id, type, geometry: { world }, measured: { width, length, count }, attrs: { note, statusText } }` 형태를 읽기만 한다):
  - `CRACK_WIDTH_BREAKS: [0.3, 0.5]` — 균열 폭 구간 경계(mm)
  - `medianHeight(damages): number` — 모든 손상 경계상자 높이의 중앙값. 빈 배열이면 `0`
  - `computeNumbers(damages): Map<string, number>` — 손상 `id` → 1부터의 번호
  - `statusTextOf(damage): string` — 손상현황. 유형 목록에 없는 type이면 저장된 type 문자열 그대로
  - `quantityOf(damage): number | null` — 물량(숫자). 계산에 필요한 값이 하나라도 없으면 `null`
  - `unitOf(damage): string | null` — `'m'` | `'㎡'`. 유형 목록에 없으면 `null`
  - `formatQuantity(value): string` — 화면·물량표 표기용 문자열. `null`이면 `'-'`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/quantities.test.ts` (새 파일):
```ts
import { describe, expect, it } from 'vitest';
import {
  computeNumbers,
  CRACK_WIDTH_BREAKS,
  formatQuantity,
  medianHeight,
  quantityOf,
  statusTextOf,
  unitOf,
} from '../public/viewer/quantities.js';

type Pt = [number, number];

// 중심 (x, y), 높이 h, 너비 h인 사각형 손상. 번호 규칙은 경계상자의 중심과 높이만 본다.
function rectAt(id: string, x: number, y: number, h: number, type = 'spalling') {
  const half = h / 2;
  const world: Pt[] = [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ];
  return {
    id,
    type,
    geometry: { kind: 'rect', world, dwg: null },
    measured: { width: null, length: null, count: null },
    attrs: { note: '', statusText: '' },
  };
}

function crack(id: string, measured: { width: number | null; length: number | null; count: number | null }) {
  return {
    id,
    type: 'crack',
    geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
    measured,
    attrs: { note: '', statusText: '' },
  };
}

function area(
  id: string,
  measured: { width: number | null; length: number | null; count: number | null },
  type = 'spalling',
) {
  return {
    id,
    type,
    geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1], [0, 1]] as Pt[], dwg: null },
    measured,
    attrs: { note: '', statusText: '' },
  };
}

function numbersOf(damages: unknown[]) {
  const map = computeNumbers(damages);
  return Object.fromEntries(map.entries());
}

describe('medianHeight', () => {
  it('손상이 없으면 0', () => {
    expect(medianHeight([])).toBe(0);
  });

  it('하나면 그 높이', () => {
    expect(medianHeight([rectAt('a', 0, 0, 7)])).toBeCloseTo(7, 10);
  });

  it('홀수 개는 가운데, 짝수 개는 가운데 둘의 평균', () => {
    expect(medianHeight([rectAt('a', 0, 0, 2), rectAt('b', 0, 0, 10), rectAt('c', 0, 0, 6)])).toBeCloseTo(6, 10);
    expect(medianHeight([rectAt('a', 0, 0, 2), rectAt('b', 0, 0, 10)])).toBeCloseTo(6, 10);
  });
});

describe('computeNumbers', () => {
  it('손상이 없으면 빈 결과', () => {
    expect(computeNumbers([]).size).toBe(0);
  });

  it('손상이 하나면 1번', () => {
    expect(numbersOf([rectAt('only', -500, -900, 4)])).toEqual({ only: 1 });
  });

  it('위쪽 줄부터, 줄 안에서는 왼쪽부터 매긴다', () => {
    // 높이는 모두 10 → 허용 폭(중앙값) 10.
    const damages = [
      rectAt('d', 60, 88, 10),
      rectAt('b', 50, 95, 10),
      rectAt('a', 0, 100, 10),
      rectAt('c', 0, 88, 10),
    ];
    // 윗줄 기준 Y = 100. b는 차이 5라 같은 줄, c·d는 차이 12라 다음 줄.
    expect(numbersOf(damages)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
  });

  it('허용 폭과 차이가 정확히 같으면 같은 줄, 조금이라도 넘으면 다음 줄', () => {
    const sameRow = [rectAt('top', 100, 100, 10), rectAt('edge', 0, 90, 10)];
    // 차이 10 = 허용 폭 10 → 같은 줄이므로 X가 작은 edge가 1번.
    expect(numbersOf(sameRow)).toEqual({ edge: 1, top: 2 });

    const nextRow = [rectAt('top', 100, 100, 10), rectAt('edge', 0, 89.9, 10)];
    // 차이 10.1 > 허용 폭 10 → 다음 줄이므로 위에 있는 top이 1번.
    expect(numbersOf(nextRow)).toEqual({ top: 1, edge: 2 });
  });

  it('같은 줄에서 X가 같으면 Y가 큰 것이 앞, 그것도 같으면 id 오름차순', () => {
    const sameX = [rectAt('low', 10, 95, 10), rectAt('high', 10, 100, 10)];
    expect(numbersOf(sameX)).toEqual({ high: 1, low: 2 });

    const samePoint = [rectAt('b2', 10, 100, 10), rectAt('a1', 10, 100, 10)];
    expect(numbersOf(samePoint)).toEqual({ a1: 1, b2: 2 });
  });

  it('높이 중앙값이 0이면 Y가 정확히 같을 때만 같은 줄', () => {
    // 가로선 세 개는 높이가 0 → 허용 폭 0.
    const flat = (id: string, x: number, y: number) => ({
      id,
      type: 'crack',
      geometry: { kind: 'polyline', world: [[x - 5, y], [x + 5, y]] as Pt[], dwg: null },
      measured: { width: null, length: null, count: null },
      attrs: { note: '', statusText: '' },
    });
    const damages = [flat('c', 0, 10), flat('b', 50, 20), flat('a', 0, 20)];
    expect(numbersOf(damages)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('같은 손상 집합이면 순서를 바꿔 넣어도 같은 번호가 나온다', () => {
    const damages = [
      rectAt('a', 0, 100, 10),
      rectAt('b', 50, 95, 10),
      rectAt('c', 0, 88, 10),
      rectAt('d', 60, 88, 10),
      rectAt('e', 30, 40, 30),
    ];
    const first = numbersOf(damages);
    const shuffled = [damages[3], damages[0], damages[4], damages[2], damages[1]];
    expect(numbersOf(shuffled)).toEqual(first);
    expect(Object.values(first).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it('좌표가 없는 손상도 번호를 받는다', () => {
    const broken = { id: 'x', type: 'crack', geometry: { kind: 'polyline', world: [], dwg: null } };
    expect(computeNumbers([broken]).get('x')).toBe(1);
  });
});

describe('statusTextOf', () => {
  it('균열은 폭 구간으로 이름이 갈린다', () => {
    expect(CRACK_WIDTH_BREAKS).toEqual([0.3, 0.5]);
    expect(statusTextOf(crack('a', { width: 0.2, length: null, count: null }))).toBe('균열(0.3mm미만)');
    expect(statusTextOf(crack('a', { width: 0.3, length: null, count: null }))).toBe('균열(0.3mm이상)');
    expect(statusTextOf(crack('a', { width: 0.49, length: null, count: null }))).toBe('균열(0.3mm이상)');
    expect(statusTextOf(crack('a', { width: 0.5, length: null, count: null }))).toBe('균열(0.5mm이상)');
    expect(statusTextOf(crack('a', { width: 3, length: null, count: null }))).toBe('균열(0.5mm이상)');
  });

  it('폭이 비어 있으면 구간을 붙이지 않는다', () => {
    expect(statusTextOf(crack('a', { width: null, length: 2, count: 1 }))).toBe('균열');
  });

  it('균열/백태도 같은 경계를 쓴다', () => {
    const damage = {
      id: 'a',
      type: 'crack_efflorescence',
      geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
      measured: { width: 0.6, length: null, count: null },
      attrs: { note: '', statusText: '' },
    };
    expect(statusTextOf(damage)).toBe('균열/백태(0.5mm이상)');
  });

  it('기타는 사용자가 적은 손상현황을 쓰고, 비어 있으면 기타', () => {
    const written = area('a', { width: null, length: null, count: null }, 'etc');
    written.attrs.statusText = '표면 오염';
    expect(statusTextOf(written)).toBe('표면 오염');

    const blank = area('b', { width: null, length: null, count: null }, 'etc');
    expect(statusTextOf(blank)).toBe('기타');

    const spaces = area('c', { width: null, length: null, count: null }, 'etc');
    spaces.attrs.statusText = '   ';
    expect(statusTextOf(spaces)).toBe('기타');
  });

  it('나머지 유형은 유형 이름 그대로', () => {
    expect(statusTextOf(area('a', { width: 1, length: 1, count: 1 }))).toBe('박락');
    expect(statusTextOf(area('b', { width: null, length: null, count: null }, 'map_crack'))).toBe('망상균열');
    expect(statusTextOf(area('c', { width: null, length: null, count: null }, 'efflorescence'))).toBe('백태·열화');
  });

  it('유형 목록에 없으면 저장된 type 문자열을 그대로 보여준다', () => {
    expect(statusTextOf({ id: 'x', type: 'no_such_type' })).toBe('no_such_type');
  });
});

describe('quantityOf', () => {
  it('균열류는 세로/길이 × 개소이고 가로/폭은 쓰지 않는다', () => {
    expect(quantityOf(crack('a', { width: 0.2, length: 1.5, count: 2 }))).toBeCloseTo(3, 10);
    expect(quantityOf(crack('b', { width: null, length: 1.5, count: 2 }))).toBeCloseTo(3, 10);
  });

  it('면형은 가로/폭 × 세로/길이 × 개소', () => {
    expect(quantityOf(area('a', { width: 2, length: 1.5, count: 3 }))).toBeCloseTo(9, 10);
  });

  it('필요한 값이 하나라도 비면 null', () => {
    expect(quantityOf(crack('a', { width: 0.2, length: null, count: 2 }))).toBeNull();
    expect(quantityOf(crack('b', { width: 0.2, length: 1.5, count: null }))).toBeNull();
    expect(quantityOf(area('c', { width: null, length: 1.5, count: 1 }))).toBeNull();
    expect(quantityOf(area('d', { width: 1, length: null, count: 1 }))).toBeNull();
    expect(quantityOf(area('e', { width: 1, length: 1, count: null }))).toBeNull();
  });

  it('0은 유효한 값이다', () => {
    expect(quantityOf(crack('a', { width: 0.2, length: 0, count: 5 }))).toBe(0);
    expect(quantityOf(area('b', { width: 0, length: 2, count: 1 }))).toBe(0);
    expect(quantityOf(area('c', { width: 2, length: 2, count: 0 }))).toBe(0);
  });

  it('개소가 정수가 아니거나 음수면 null', () => {
    expect(quantityOf(crack('a', { width: null, length: 2, count: 1.5 }))).toBeNull();
    expect(quantityOf(crack('b', { width: null, length: 2, count: -1 }))).toBeNull();
  });

  it('유형 목록에 없으면 null', () => {
    expect(quantityOf({ id: 'x', type: 'nope', measured: { width: 1, length: 1, count: 1 } })).toBeNull();
  });
});

describe('unitOf', () => {
  it('유형표의 단위를 그대로 쓴다', () => {
    expect(unitOf(crack('a', { width: null, length: null, count: null }))).toBe('m');
    expect(unitOf(area('b', { width: null, length: null, count: null }))).toBe('㎡');
    expect(unitOf({ id: 'x', type: 'nope' })).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('부동소수 꼬리를 정리해서 보여준다', () => {
    const value = quantityOf(area('a', { width: 0.2, length: 1.5, count: 1 })) as number;
    expect(value).not.toBe(0.3); // 0.30000000000000004
    expect(formatQuantity(value)).toBe('0.3');
  });

  it('0은 0, 계산할 수 없으면 -', () => {
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(null)).toBe('-');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/quantities.test.ts`
Expected: FAIL — `Failed to load ../public/viewer/quantities.js` (모듈이 아직 없다)

- [ ] **Step 3: 구현**

`server/public/viewer/quantities.js` (새 파일):
```js
// 손상에서 자동으로 정해지는 값(번호·손상현황·물량·단위). 저장하지 않고 필요할 때마다 계산한다.
// 저장하면 손상을 하나 지울 때마다 뒷번호를 전부 다시 써야 하고, 값과 위치가 어긋날 수 있다.
//
// 2단계 DWG 물량표도 같은 함수를 쓴다. 표 한 행의 칸은 다음과 같이 대응한다.
//   번호 computeNumbers / 손상현황 statusTextOf / 가로·폭 measured.width / 세로·길이 measured.length
//   / 개소 measured.count / 물량 quantityOf / 단위 unitOf / 비고 attrs.note
//
// 값의 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 3장

import { getDamageType } from './damageTypes.js';

// 균열 폭(mm) 구간 경계. 이 두 값이 균열류의 손상현황 이름을 가른다.
export const CRACK_WIDTH_BREAKS = [0.3, 0.5];

const UNIT_LABELS = { m: 'm', m2: '㎡' };

function isAmount(value) {
  return Number.isFinite(value) && value >= 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function compareId(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// 번호 규칙은 경계상자의 중심과 높이만 본다. 좌표계는 geometry.world 하나로 통일한다
// (모든 손상이 항상 갖고 있고, 도면을 확대·회전해도 값이 변하지 않는다).
function centerAndHeight(damage) {
  const world = Array.isArray(damage?.geometry?.world) ? damage.geometry.world : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of world) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  // 좌표가 없거나 숫자가 아니면 원점·높이 0으로 본다. 번호를 못 받는 손상이 생기면
  // 화면에 라벨이 비고 물량표에서도 빠지므로, 값을 정해서라도 번호는 매긴다.
  if (minX === Infinity) return { x: 0, y: 0, height: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, height: maxY - minY };
}

// 줄의 허용 폭. 도면마다 손상 크기가 달라 고정값을 쓰면 어떤 도면에서는 전부 한 줄이 되고
// 어떤 도면에서는 전부 따로 놀게 된다.
export function medianHeight(damages) {
  const list = Array.isArray(damages) ? damages : [];
  if (list.length === 0) return 0;
  const heights = list.map((damage) => centerAndHeight(damage).height).sort((a, b) => a - b);
  const middle = Math.floor(heights.length / 2);
  return heights.length % 2 === 1 ? heights[middle] : (heights[middle - 1] + heights[middle]) / 2;
}

// 도면 위 위치로 번호를 정한다. 같은 손상 집합이면 넣은 순서와 상관없이 항상 같은 번호가 나온다.
export function computeNumbers(damages) {
  const list = Array.isArray(damages) ? damages : [];
  const tolerance = medianHeight(list);
  // 위(Y가 큰 쪽)에서 아래로. 이 정렬 덕분에 남은 것 중 첫 번째가 언제나 다음 줄의 기준이 된다.
  let remaining = list
    .map((damage) => ({ id: String(damage?.id), ...centerAndHeight(damage) }))
    .sort((a, b) => b.y - a.y || a.x - b.x || compareId(a.id, b.id));

  const numbers = new Map();
  let next = 1;
  while (remaining.length > 0) {
    const rowY = remaining[0].y;
    const row = [];
    const rest = [];
    for (const entry of remaining) {
      if (rowY - entry.y <= tolerance) row.push(entry);
      else rest.push(entry);
    }
    // 한 줄 안에서는 왼쪽부터. X가 같으면 위쪽이 앞, 그것도 같으면 id 오름차순.
    row.sort((a, b) => a.x - b.x || b.y - a.y || compareId(a.id, b.id));
    for (const entry of row) numbers.set(entry.id, next++);
    remaining = rest;
  }
  return numbers;
}

export function statusTextOf(damage) {
  const type = getDamageType(damage?.type);
  // 유형 목록에 없는 손상은 저장된 type을 그대로 보여준다 — 화면에서 사라지면 지울 수도 없다.
  if (!type) return String(damage?.type ?? '');
  if (type.id === 'etc') {
    const written = typeof damage?.attrs?.statusText === 'string' ? damage.attrs.statusText.trim() : '';
    return written === '' ? type.label : written;
  }
  if (type.quantityUnit !== 'm') return type.label;
  const width = damage?.measured?.width;
  // 균열류인데 폭이 비어 있으면 구간을 붙이지 않는다.
  if (!isAmount(width)) return type.label;
  if (width < CRACK_WIDTH_BREAKS[0]) return `${type.label}(${CRACK_WIDTH_BREAKS[0]}mm미만)`;
  if (width < CRACK_WIDTH_BREAKS[1]) return `${type.label}(${CRACK_WIDTH_BREAKS[0]}mm이상)`;
  return `${type.label}(${CRACK_WIDTH_BREAKS[1]}mm이상)`;
}

// 물량. 계산에 필요한 값 중 하나라도 비어 있으면 null이고, 0은 유효한 값이다.
export function quantityOf(damage) {
  const type = getDamageType(damage?.type);
  if (!type) return null;
  const measured = damage?.measured ?? {};
  if (!isAmount(measured.length) || !isCount(measured.count)) return null;
  // 균열류의 가로/폭은 mm이고 손상현황 구간에만 쓴다. 물량에는 넣지 않는다.
  if (type.quantityUnit === 'm') return measured.length * measured.count;
  if (!isAmount(measured.width)) return null;
  return measured.width * measured.length * measured.count;
}

export function unitOf(damage) {
  const type = getDamageType(damage?.type);
  if (!type) return null;
  return UNIT_LABELS[type.quantityUnit] ?? null;
}

// 물량은 저장하지 않고 보여줄 때만 문자열로 만든다. 소수 넷째 자리에서 반올림하고 뒤의 0은 지운다
// (0.2 × 1.5 × 1이 0.30000000000000004로 보이지 않게).
export function formatQuantity(value) {
  if (value === null || !Number.isFinite(value)) return '-';
  return String(Number(value.toFixed(3)));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/quantities.test.ts`
Expected: PASS (26 tests)

Run: `node --check server/public/viewer/quantities.js`
Expected: 출력 없음

Run: `npm --prefix server test`
Expected: PASS — 기존 테스트는 아직 v2 형식 그대로이고 이 태스크는 아무것도 바꾸지 않았으므로 전체가 통과해야 한다

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/quantities.js server/test/quantities.test.ts
git commit -m "feat(viewer): 번호·손상현황·물량·단위 계산 모듈" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 손상 문서 v3 (검증 규칙과 v1→v2→v3 변환)

**Files:**
- Modify: `server/public/viewer/damageDoc.js`
- Test: `server/test/damageDoc.test.ts` (기존 파일 전체 교체)

**Interfaces:**
- Consumes: `getDamageType` from `./damageTypes.js`
- Produces:
  - `SCHEMA_VERSION = 3`, `MAX_HISTORY = 50`
  - `createEmptyDoc(drawingId, updatedAt)` — `{ schemaVersion: 3, drawingId, updatedAt, damages: [] }`
  - `validateDamageDoc(doc, drawingId): string[]` — v3 규칙
  - `migrateDoc(doc, drawingId)` — v1은 v2를 거쳐 v3로, v2는 v3로, 이미 v3면 **같은 객체 그대로**, 객체가 아니면 `null`, 모르는 버전이면 받은 것 그대로
  - `createEditor`, `addDamage`, `removeDamage`, `updateDamage`, `undo`, `canUndo` — 시그니처 변경 없음
  - v3 손상 한 건:
    ```js
    {
      id, type, createdAt,
      geometry: { kind: 'polyline' | 'rect', world: [[x, y], …], dwg: [[x, y], …] | null },
      measured: { width: number | null, length: number | null, count: number | null },
      computed: { lengthDwg: number | null, areaDwg: number | null },
      attrs: { note: string, statusText: string },
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
  updateDamage,
  validateDamageDoc,
} from '../public/viewer/damageDoc.js';

const DRAWING = 'd_0123456789abcdef0123456789abcdef';
const T0 = '2026-09-13T00:00:00.000Z';
const T1 = '2026-09-13T00:00:01.000Z';
const T2 = '2026-09-13T00:00:02.000Z';

function lineDamage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'crack',
    createdAt: T0,
    geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
    measured: { width: 0.3, length: 5, count: 2 },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { note: '', statusText: '' },
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
    measured: { width: 1.2, length: 1.5, count: 1 },
    computed: { lengthDwg: null, areaDwg: 2 },
    attrs: { note: '', statusText: '' },
    ...overrides,
  };
}

function docWith(damages: unknown[]) {
  return { ...createEmptyDoc(DRAWING, T0), damages };
}

describe('createEmptyDoc', () => {
  it('schemaVersion 3인 빈 문서를 만든다', () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(createEmptyDoc(DRAWING, T0)).toEqual({
      schemaVersion: 3,
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
      validateDamageDoc({ schemaVersion: 2, drawingId: 'd_other', updatedAt: 'nope', damages: 'x' }, DRAWING),
    ).toEqual([
      'schemaVersion은 3이어야 합니다.',
      'drawingId가 주소와 다릅니다.',
      'updatedAt이 올바른 날짜가 아닙니다.',
      'damages는 배열이어야 합니다.',
    ]);
  });

  it('유형 목록에 없는 type을 거부한다', () => {
    const errors = validateDamageDoc(docWith([lineDamage('a', { type: 'nope' })]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
  });

  it('유형이 잘못돼도 날짜·속성 오류를 함께 알려준다', () => {
    const broken = lineDamage('a', {
      type: 'nope',
      createdAt: 3,
      attrs: { note: 3, statusText: '' },
    });
    const errors = validateDamageDoc(docWith([broken]), DRAWING);
    expect(errors).toContain('damages[0].type이 손상 유형 목록에 없습니다.');
    expect(errors).toContain('damages[0].createdAt이 올바른 날짜가 아닙니다.');
    expect(errors).toContain('damages[0].attrs.note와 statusText는 문자열이어야 합니다.');
  });

  it('선형은 polyline 2점 이상, 면형은 rect 4점이어야 한다', () => {
    const wrongKind = validateDamageDoc(
      docWith([lineDamage('a', { geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1], [0, 1]], dwg: null } })]),
      DRAWING,
    );
    expect(wrongKind).toContain('damages[0].geometry.kind는 선형 손상이면 polyline이어야 합니다.');

    const shortRect = validateDamageDoc(
      docWith([
        areaDamage('a', {
          geometry: { kind: 'rect', world: [[0, 0], [1, 0], [1, 1]], dwg: null },
          computed: { lengthDwg: null, areaDwg: null },
        }),
      ]),
      DRAWING,
    );
    expect(shortRect).toContain('damages[0].geometry.world는 유효한 점 4개여야 합니다.');

    const shortLine = validateDamageDoc(
      docWith([
        lineDamage('a', {
          geometry: { kind: 'polyline', world: [[0, 0]], dwg: null },
          computed: { lengthDwg: null, areaDwg: null },
        }),
      ]),
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

  it('가로·세로는 0 이상의 숫자, 개소는 0 이상의 정수이거나 null이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: null, length: null, count: null } })]), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 0, length: 0, count: 0 } })]), DRAWING)).toEqual([]);
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: -1, length: 1, count: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.width는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: Infinity, count: 1 } })]), DRAWING)).toContain(
      'damages[0].measured.length는 0 이상의 숫자이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: 1, count: 1.5 } })]), DRAWING)).toContain(
      'damages[0].measured.count는 0 이상의 정수이거나 null이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { measured: { width: 1, length: 1, count: -2 } })]), DRAWING)).toContain(
      'damages[0].measured.count는 0 이상의 정수이거나 null이어야 합니다.',
    );
  });

  it('비고와 손상현황은 문자열이어야 한다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: 3, statusText: '' } })]), DRAWING)).toContain(
      'damages[0].attrs.note와 statusText는 문자열이어야 합니다.',
    );
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: null } })]), DRAWING)).toContain(
      'damages[0].attrs.note와 statusText는 문자열이어야 합니다.',
    );
  });

  it('손상현황은 기타 유형에서만 채울 수 있다', () => {
    expect(validateDamageDoc(docWith([lineDamage('a', { attrs: { note: '', statusText: '메모' } })]), DRAWING)).toContain(
      'damages[0].attrs.statusText는 기타 유형에서만 쓸 수 있습니다.',
    );
    const etc = areaDamage('a', { type: 'etc', attrs: { note: '', statusText: '표면 오염' } });
    expect(validateDamageDoc(docWith([etc]), DRAWING)).toEqual([]);
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

  const v2Doc = {
    schemaVersion: 2,
    drawingId: DRAWING,
    updatedAt: T1,
    damages: [
      {
        id: 'v2-crack',
        type: 'crack',
        createdAt: T0,
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
        measured: { lengthM: 1.5, areaM2: null },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { widthMm: 0.2, member: '', note: '재확인' },
      },
      {
        id: 'v2-area',
        type: 'spalling',
        createdAt: T0,
        geometry: {
          kind: 'rect',
          world: [[0, 0], [2, 0], [2, 1], [0, 1]],
          dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
        },
        measured: { lengthM: null, areaM2: 1.8 },
        computed: { lengthDwg: null, areaDwg: 2 },
        attrs: { widthMm: null, member: '기둥', note: '사진 있음' },
      },
    ],
  };

  it('v2의 폭·길이를 v3 측정값으로 옮기고 그 결과는 검증을 통과한다', () => {
    const migrated = migrateDoc(v2Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.drawingId).toBe(DRAWING);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'v2-crack',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { width: 0.2, length: 1.5, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '재확인', statusText: '' },
    });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('면적과 부재명은 지어내지 않고 비고에 옮겨 적는다', () => {
    const migrated = migrateDoc(v2Doc, DRAWING);
    expect(migrated.damages[1].measured).toEqual({ width: null, length: null, count: null });
    expect(migrated.damages[1].attrs).toEqual({
      note: '이전 면적 입력값: 1.8㎡\n부재명: 기둥\n사진 있음',
      statusText: '',
    });
  });

  it('비고가 비어 있으면 옮겨 적은 줄만 남는다', () => {
    const doc = {
      ...v2Doc,
      damages: [{ ...v2Doc.damages[1], attrs: { widthMm: null, member: '', note: '' } }],
    };
    expect(migrateDoc(doc, DRAWING).damages[0].attrs.note).toBe('이전 면적 입력값: 1.8㎡');
  });

  it('v1 문서는 v2를 거쳐 v3까지 변환된다', () => {
    const migrated = migrateDoc(v1Doc, DRAWING);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.updatedAt).toBe(T1);
    expect(migrated.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: T0,
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[100, 100], [103, 104]] },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '', statusText: '' },
    });
    expect(migrated.damages[1].computed).toEqual({ lengthDwg: null, areaDwg: null });
    expect(validateDamageDoc(migrated, DRAWING)).toEqual([]);
  });

  it('이미 v3면 그대로 돌려준다', () => {
    const doc = docWith([areaDamage('a')]);
    expect(migrateDoc(doc, DRAWING)).toBe(doc);
  });

  it('객체가 아니면 null', () => {
    expect(migrateDoc(null, DRAWING)).toBeNull();
    expect(migrateDoc('x', DRAWING)).toBeNull();
  });

  it('v1·v2 백업은 그대로 검증하면 거부되지만, migrateDoc 후에는 통과한다 (로컬 백업 복구 경로)', () => {
    // 뷰어는 로컬 백업을 서버 문서와 같은 방식으로 먼저 migrateDoc에 통과시킨 뒤 validateDamageDoc으로 검사해야 한다.
    // 예전 문서를 그대로 validateDamageDoc에 넘기면 schemaVersion 검사만으로 거부되어 백업이 버려진다.
    expect(validateDamageDoc(v1Doc, DRAWING).length).toBeGreaterThan(0);
    expect(validateDamageDoc(v2Doc, DRAWING).length).toBeGreaterThan(0);
    expect(validateDamageDoc(migrateDoc(v1Doc, DRAWING), DRAWING)).toEqual([]);
    expect(validateDamageDoc(migrateDoc(v2Doc, DRAWING), DRAWING)).toEqual([]);
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

  it('updateDamage는 값을 병합하고 updatedAt을 올린다', () => {
    let editor = createEditor(createEmptyDoc(DRAWING, T0));
    editor = addDamage(editor, areaDamage('a'), T1);

    editor = updateDamage(editor, 'a', { measured: { count: 3 }, attrs: { note: '확인 필요' } }, T2);

    expect(editor.doc.damages[0].measured).toEqual({ width: 1.2, length: 1.5, count: 3 });
    expect(editor.doc.damages[0].attrs).toEqual({ note: '확인 필요', statusText: '' });
    expect(editor.doc.damages[0].geometry).toEqual(areaDamage('a').geometry);
    expect(editor.doc.updatedAt).toBe(T2);
    expect(canUndo(editor)).toBe(true);
  });

  it('updateDamage는 없는 id면 같은 editor를 돌려준다', () => {
    const editor = createEditor(createEmptyDoc(DRAWING, T0));
    expect(updateDamage(editor, 'nope', { measured: { count: 1 } }, T1)).toBe(editor);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: FAIL — `SCHEMA_VERSION`이 2라 `createEmptyDoc`·문서 수준 오류 문구 테스트가 깨지고, `measured.width`/`attrs.statusText` 검증과 v2→v3 변환이 없어 대부분의 테스트가 실패

- [ ] **Step 3: 구현**

`server/public/viewer/damageDoc.js` — `SCHEMA_VERSION`, 검증 함수들, `migrateDoc`을 아래로 바꾼다. `createEditor`·`commit`·`addDamage`·`removeDamage`·`updateDamage`·`undo`·`canUndo`와 `isDateString`·`isPointList`·`validateGeometry`·`validateComputed`는 **그대로 둔다**.

버전 상수:
```js
export const SCHEMA_VERSION = 3;
```

`isNullableAmount` 아래에 개소 검사를 추가한다:
```js
// null이거나 0 이상의 정수 (개소)
function isNullableCount(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}
```

`validateMeasured`를 통째로 바꾼다(유형과 무관해졌으므로 `type` 인자를 받지 않는다):
```js
function validateMeasured(damage, path, errors) {
  const measured = damage.measured;
  if (typeof measured !== 'object' || measured === null) {
    errors.push(`${path}.measured가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(measured.width)) {
    errors.push(`${path}.measured.width는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableAmount(measured.length)) {
    errors.push(`${path}.measured.length는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableCount(measured.count)) {
    errors.push(`${path}.measured.count는 0 이상의 정수이거나 null이어야 합니다.`);
  }
}
```

`validateAttrs`를 통째로 바꾼다(유형을 알아야 손상현황 규칙을 볼 수 있다. 유형을 모를 때는 `type`이 `null`로 들어온다):
```js
function validateAttrs(damage, type, path, errors) {
  const attrs = damage.attrs;
  if (typeof attrs !== 'object' || attrs === null) {
    errors.push(`${path}.attrs가 객체가 아닙니다.`);
    return;
  }
  if (typeof attrs.note !== 'string' || typeof attrs.statusText !== 'string') {
    errors.push(`${path}.attrs.note와 statusText는 문자열이어야 합니다.`);
    return;
  }
  // 손상현황은 기타에서만 사용자가 적는다. 다른 유형은 유형 이름·균열 폭 구간으로 계산되므로
  // 값이 들어 있으면 화면에 보이지 않는 값이 조용히 남아 물량표와 어긋난다.
  if (type !== null && type.id !== 'etc' && attrs.statusText !== '') {
    errors.push(`${path}.attrs.statusText는 기타 유형에서만 쓸 수 있습니다.`);
  }
}
```

`validateDamage`에서 호출부를 바꾼다:
```js
function validateDamage(damage, path, errors) {
  if (typeof damage !== 'object' || damage === null) {
    errors.push(`${path}가 객체가 아닙니다.`);
    return;
  }
  if (typeof damage.id !== 'string' || damage.id === '') errors.push(`${path}.id가 비어 있습니다.`);
  if (!isDateString(damage.createdAt)) errors.push(`${path}.createdAt이 올바른 날짜가 아닙니다.`);
  const type = typeof damage.type === 'string' ? getDamageType(damage.type) : null;
  if (!type) {
    errors.push(`${path}.type이 손상 유형 목록에 없습니다.`);
    validateAttrs(damage, null, path, errors);
    return;
  }

  const hasDwg = validateGeometry(damage, type, path, errors);
  validateMeasured(damage, path, errors);
  validateComputed(damage, hasDwg, path, errors);
  validateAttrs(damage, type, path, errors);
}
```

`validateDamageDoc`의 버전 문구:
```js
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion은 3이어야 합니다.');
```

`migrateDoc`을 단계별 함수로 나눈다(기존 `migrateDoc` 전체를 아래로 교체):
```js
// v1 문서(균열만, lengthDwg 한 개)를 v2 형태로 바꾼다.
function migrateV1ToV2(doc, drawingId) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    schemaVersion: 2,
    drawingId: doc.drawingId ?? drawingId,
    updatedAt: doc.updatedAt,
    damages: damages.map((damage) => ({
      id: damage.id,
      type: 'crack',
      createdAt: damage.createdAt,
      geometry: damage.geometry,
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: damage.lengthDwg ?? null, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    })),
  };
}

// v2의 면적·부재명은 v3에 들어갈 칸이 없다. 면적에서 가로·세로를 되돌릴 수 없으므로 지어내지 않고,
// 조용히 버리지도 않는다. 사용자가 보고 다시 입력할 수 있게 비고에 옮겨 적는다.
function carriedNote(damage) {
  const measured = damage.measured ?? {};
  const attrs = damage.attrs ?? {};
  const lines = [];
  if (Number.isFinite(measured.areaM2)) lines.push(`이전 면적 입력값: ${measured.areaM2}㎡`);
  if (typeof attrs.member === 'string' && attrs.member !== '') lines.push(`부재명: ${attrs.member}`);
  if (typeof attrs.note === 'string' && attrs.note !== '') lines.push(attrs.note);
  return lines.join('\n');
}

function migrateV2ToV3(doc) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    ...doc,
    schemaVersion: 3,
    damages: damages.map((damage) => {
      const measured = damage.measured ?? {};
      const attrs = damage.attrs ?? {};
      const hadArea = Number.isFinite(measured.areaM2);
      return {
        id: damage.id,
        type: damage.type,
        createdAt: damage.createdAt,
        geometry: damage.geometry,
        measured: {
          width: !hadArea && Number.isFinite(attrs.widthMm) ? attrs.widthMm : null,
          length: !hadArea && Number.isFinite(measured.lengthM) ? measured.lengthM : null,
          count: null,
        },
        computed: damage.computed ?? { lengthDwg: null, areaDwg: null },
        attrs: { note: carriedNote(damage), statusText: '' },
      };
    }),
  };
}

// 예전 문서를 읽을 때 한 단계씩 이어 붙여 v3로 올린다. 저장은 항상 v3로 한다.
// 단계를 나눠 두면 새 버전이 생겨도 각 단계를 따로 검증할 수 있다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  const v2 = doc.schemaVersion === 1 ? migrateV1ToV2(doc, drawingId) : doc;
  return v2.schemaVersion === 2 ? migrateV2ToV3(v2) : v2;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/damageDoc.test.ts`
Expected: PASS (23 tests)

Run: `node --check server/public/viewer/damageDoc.js`
Expected: 출력 없음

- [ ] **Step 5: 남은 실패 확인 (다음 태스크에서 고친다)**

Run: `npm --prefix server test`
Expected: `test/crackTool.test.ts`, `test/stores.test.ts`, `test/app.test.ts`가 아직 v2 형태를 기대해 실패한다. `test/quantities.test.ts`, `test/damageDoc.test.ts`, `test/overlay.test.ts`, 나머지는 통과. 실패한 테스트 이름을 적어 두고 다음 태스크로 넘어간다 — `crackTool.test.ts`는 Task 4, `stores`·`app`은 Task 3에서 초록으로 돌아온다.

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```
git add server/public/viewer/damageDoc.js server/test/damageDoc.test.ts
git commit -m "feat(viewer): 손상 문서 v3 (가로·세로·개소 측정값, v1→v2→v3 변환)" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 서버 읽기 경로를 v3로

**Files:**
- Modify: `server/src/damagesStore.ts` (주석만)
- Test: `server/test/stores.test.ts`, `server/test/app.test.ts`

**Interfaces:**
- Consumes: `createEmptyDoc`, `migrateDoc`, `validateDamageDoc` (Task 2)
- Produces:
  - `DamagesStore.get(drawingId)` — 파일이 v1이든 v2든 **v3로 변환해서** 돌려준다. 파일이 없으면 `updatedAt`이 `1970-01-01T00:00:00.000Z`인 빈 v3 문서
  - `DamagesStore.save(doc)` — 변경 없음(받은 문서를 그대로 저장)
  - `PUT /api/drawings/:id/damages`는 v3 규칙으로 검증한다(코드 변경 없음, 동작만 바뀜)

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/stores.test.ts`의 `describe('DamagesStore', …)` 안에서 세 군데를 고친다.

`'없는 문서는 1970년 updatedAt을 가진 빈 문서'` 기대값의 `schemaVersion`을 `3`으로:
```ts
    expect(await new DamagesStore(join(dir, 'damages')).get(id)).toEqual({
      schemaVersion: 3,
      drawingId: id,
      updatedAt: '1970-01-01T00:00:00.000Z',
      damages: [],
    });
```

`'저장한 문서를 다시 읽는다'`의 문서를 v3로:
```ts
    const doc = { schemaVersion: 3, drawingId: id, updatedAt: '2026-09-10T00:00:00.000Z', damages: [{ id: 'x' }] };
```

`'v1 문서를 읽으면 v2로 변환해서 돌려준다'` 테스트를 아래 두 테스트로 교체한다:
```ts
  it('v1 문서를 읽으면 v3로 변환해서 돌려준다', async () => {
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

    expect(doc.schemaVersion).toBe(3);
    expect(doc.damages[0]).toEqual({
      id: 'old-1',
      type: 'crack',
      createdAt: '2026-09-10T00:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 5, areaDwg: null },
      attrs: { note: '', statusText: '' },
    });
  });

  it('v2 문서를 읽으면 v3로 변환하고 면적·부재명을 비고에 남긴다', async () => {
    const store = new DamagesStore(join(dir, 'damages'));
    const id = newDrawingId();
    await writeJsonFileAtomic(join(dir, 'damages', `${id}.json`), {
      schemaVersion: 2,
      drawingId: id,
      updatedAt: '2026-09-12T00:00:00.000Z',
      damages: [
        {
          id: 'v2-area',
          type: 'spalling',
          createdAt: '2026-09-12T00:00:00.000Z',
          geometry: {
            kind: 'rect',
            world: [[0, 0], [2, 0], [2, 1], [0, 1]],
            dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
          },
          measured: { lengthM: null, areaM2: 1.8 },
          computed: { lengthDwg: null, areaDwg: 2 },
          attrs: { widthMm: null, member: '기둥', note: '' },
        },
      ],
    });

    const doc = await store.get(id);

    expect(doc.schemaVersion).toBe(3);
    expect(doc.damages[0]).toEqual({
      id: 'v2-area',
      type: 'spalling',
      createdAt: '2026-09-12T00:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, 1], [0, 1]],
        dwg: [[10, 10], [12, 10], [12, 11], [10, 11]],
      },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { note: '이전 면적 입력값: 1.8㎡\n부재명: 기둥', statusText: '' },
    });
  });
```

`server/test/app.test.ts`의 `crackDoc`·`spallingDoc` 헬퍼를 v3 형태로 바꾼다:
```ts
function crackDoc(drawingId: string) {
  return {
    schemaVersion: 3,
    drawingId,
    updatedAt: '2026-09-10T01:00:00.000Z',
    damages: [
      {
        id: 'c1',
        type: 'crack',
        createdAt: '2026-09-10T01:00:00.000Z',
        geometry: { kind: 'polyline', world: [[0, 0], [3, 4]], dwg: [[10, 10], [13, 14]] },
        measured: { width: 0.3, length: 5, count: 2 },
        computed: { lengthDwg: 5, areaDwg: null },
        attrs: { note: '', statusText: '' },
      },
    ],
  };
}

function spallingDoc(drawingId: string) {
  return {
    schemaVersion: 3,
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
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: 2 },
        attrs: { note: '', statusText: '' },
      },
    ],
  };
}
```

같은 파일 `'저장 전에는 빈 문서, 저장 후에는 저장한 문서'`의 빈 문서 기대값:
```ts
    expect(empty.body).toEqual({ schemaVersion: 3, drawingId: drawing.id, updatedAt: '1970-01-01T00:00:00.000Z', damages: [] });
```

`'형식이 틀리면 400과 상세 오류'`의 기대 문구:
```ts
    expect(res.body).toEqual({ error: '손상 데이터 형식이 올바르지 않습니다.', details: ['schemaVersion은 3이어야 합니다.'] });
```

`describe('손상 문서 API', …)`에 손상현황 규칙이 API에서도 막히는지 확인하는 테스트를 추가한다:
```ts
  it('기타가 아닌 유형에 손상현황이 들어 있으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings);
    const bad = crackDoc(drawing.id);
    bad.damages[0].attrs.statusText = '직접 적은 값';

    const res = await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(bad);

    expect(res.status).toBe(400);
    expect(res.body.details).toContain('damages[0].attrs.statusText는 기타 유형에서만 쓸 수 있습니다.');
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Step 1을 하기 **전에** 같은 명령을 돌리면 두 파일 모두 실패한다(`schemaVersion`이 2가 아니라 3, `measured`가 `lengthM`이 아니라 `width` 등 — Task 2 Step 5에서 이미 본 실패다). 그것이 이 태스크가 고치는 실패다.

Run: `npm --prefix server test -- test/stores.test.ts test/app.test.ts`
Expected: Step 1을 마친 뒤에는 **모두 통과한다**. `DamagesStore`는 `migrateDoc`을 그대로 쓰고 있어 Task 2의 변경만으로 v3가 나오기 때문이다. 즉 이 태스크는 "서버 읽기 경로가 v1·v2 파일을 v3로 올려 준다"를 **테스트로 고정하는** 것이 목적이다. Step 1을 마쳤는데도 실패가 남으면 그것은 Task 2의 변환 규칙 오류이므로, 다음 단계로 넘어가지 말고 `damageDoc.js`를 고친다.

- [ ] **Step 3: 구현 (주석 갱신)**

`server/src/damagesStore.ts`의 `get` 안 주석 한 줄만 바꾼다:
```ts
    // 예전에 저장된 v1·v2 문서는 읽을 때 v3로 바꿔서 돌려준다. 저장은 항상 v3로 한다.
```

- [ ] **Step 4: 전체 확인**

Run: `npm --prefix server test`
Expected: `test/crackTool.test.ts`만 실패(Task 4에서 고친다). 나머지 전부 통과

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/src/damagesStore.ts server/test/stores.test.ts server/test/app.test.ts
git commit -m "feat(server): 손상 문서 v3 읽기·검증과 v1·v2 자동 변환" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 새 손상이 v3 형태로 만들어지게

**Files:**
- Modify: `server/public/viewer/crackTool.js`
- Test: `server/test/crackTool.test.ts`

**Interfaces:**
- Consumes: `getDamageType` (`damageTypes.js`), 기하 함수들(`geometry.js`) — 변경 없음
- Produces: `finalizeStroke(clientPoints, mapper, options)` / `finalizeRect(startClient, endClient, mapper, options)`가 만드는 손상이 v3 형태다.
  - `measured: { width: null, length: null, count: null }`
  - `attrs: { note: '', statusText: '' }`
  - 나머지(`id`, `type`, `createdAt`, `geometry`, `computed`)는 그대로
  - `pickDamage`, `hitHandle`, `createCrackInput`, 상수들은 변경 없음

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/crackTool.test.ts`에서 두 기대값의 `measured`·`attrs` 줄을 바꾼다.

`'선형 손상을 v2 형태로 만든다'` 테스트 이름과 기대값:
```ts
  it('선형 손상을 v3 형태로 만든다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    expect(finalizeStroke(stroke, mapper, options)).toEqual({
      id: 'new-id',
      type: 'crack',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, -5], [10, -5]], dwg: [[1000, 1995], [1010, 1995]] },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 10, areaDwg: null },
      attrs: { note: '', statusText: '' },
    });
  });
```

`'드래그한 두 점으로 네 꼭짓점 사각형을 만든다'` 기대값:
```ts
    expect(finalizeRect([0, 0], [20, 10], mapper, areaOptions)).toEqual({
      id: 'new-id',
      type: 'spalling',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, -1], [0, -1]],
        dwg: [[1000, 2000], [1002, 2000], [1002, 1999], [1000, 1999]],
      },
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { note: '', statusText: '' },
    });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/crackTool.test.ts`
Expected: FAIL — 두 테스트에서 `measured`가 `{ lengthM: null, areaM2: null }`, `attrs`가 `{ widthMm: null, member: '', note: '' }`로 나와 기대값과 다르다

- [ ] **Step 3: 구현**

`server/public/viewer/crackTool.js`의 `emptyDamage`에서 두 줄을 바꾼다:
```js
function emptyDamage(typeId, worldPoints, dwgPoints, kind, options) {
  return {
    id: options.newId(),
    type: typeId,
    createdAt: options.now,
    geometry: { kind, world: normalizePoints(worldPoints), dwg: dwgPoints ? normalizePoints(dwgPoints) : null },
    // 측정값은 아직 없음(null)이다. 0과 구분한다 — 0은 "재 보니 0"이라는 뜻이다.
    measured: { width: null, length: null, count: null },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '' },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test`
Expected: PASS — 전체 통과 (Task 2 이후 처음으로 전부 초록)

Run: `node --check server/public/viewer/crackTool.js`
Expected: 출력 없음

Run: `npm --prefix server run typecheck`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/crackTool.js server/test/crackTool.test.ts
git commit -m "feat(viewer): 새 손상을 v3 형태로 만든다" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 도면 위 라벨을 번호 + 손상현황으로

**Files:**
- Modify: `server/public/viewer/overlay.js`
- Test: `server/test/overlay.test.ts`

**Interfaces:**
- Consumes: `getDamageType` (`damageTypes.js`), `computeNumbers`·`statusTextOf` (Task 1), `rectCenter` (`geometry.js`)
- Produces:
  - `describeDamageRender(damage, selectedId, number = null)` — `number`는 `computeNumbers`가 준 정수 또는 `null`. 결과의 `label`은 **항상 문자열**이며 `번호 + 공백 + 손상현황`, 번호가 없으면 손상현황만
  - `labelAnchor(screenPoints): [number, number]` — 라벨을 놓을 화면 좌표. 도형 경계상자의 위쪽 가운데에서 `LABEL_OFFSET_PX`만큼 위
  - `LABEL_OFFSET_PX = 6`
  - 기존 `CRACK_COLOR`, `SELECTED_COLOR`, `CRACK_WIDTH_PX`, `SELECTED_WIDTH_PX`, `HANDLE_SIZE_PX`, `ROTATE_HANDLE_OFFSET_PX`, `HATCH_PATTERNS`, `rectHandlePositions`, `createOverlay` 유지

- [ ] **Step 1: 실패하는 테스트 작성**

`server/test/overlay.test.ts` 상단 import에 새 이름을 추가한다:
```ts
import {
  CRACK_COLOR,
  describeDamageRender,
  HANDLE_SIZE_PX,
  HATCH_PATTERNS,
  LABEL_OFFSET_PX,
  labelAnchor,
  rectHandlePositions,
  ROTATE_HANDLE_OFFSET_PX,
  SELECTED_COLOR,
} from '../public/viewer/overlay.js';
```

`describe('describeDamageRender', …)` 안의 라벨 관련 기대값을 바꾸고 테스트를 추가한다. 먼저 기존 세 테스트의 라벨 기대값:
```ts
  it('유형 목록에 없는 면형 손상은 테두리만(채우기 없이) 그리고 원본 type을 라벨로 보여준다', () => {
    const unknown = { id: 'x', type: 'no_such_type', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(unknown, null, 2);
    expect(plan.known).toBe(false);
    expect(plan.shape).toBe('polygon');
    expect(plan.fillPattern).toBeNull();
    expect(plan.label).toBe('2 no_such_type');
    expect(plan.color).toBe(CRACK_COLOR);
  });
```
```ts
  it('유형 목록에 없는 선형 손상은 핸들 없이 라벨만 그린다', () => {
    const unknown = { id: 'y', type: 'nope', geometry: { kind: 'polyline', world: [] } };
    const plan = describeDamageRender(unknown, 'y', 1);
    expect(plan.shape).toBe('polyline');
    expect(plan.label).toBe('1 nope');
    expect(plan.showHandles).toBe(false);
  });
```
그리고 `'알려진 유형은 그대로 채우기 여부에 따라 라벨을 정한다'` 테스트를 아래 세 테스트로 교체한다:
```ts
  it('라벨은 번호와 손상현황이다', () => {
    const crack = {
      id: 'a',
      type: 'crack',
      geometry: { kind: 'polyline', world: [] },
      measured: { width: 0.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '' },
    };
    expect(describeDamageRender(crack, null, 17).label).toBe('17 균열(0.3mm미만)');
  });

  it('채우기가 있는 면형도 번호와 손상현황을 보여준다', () => {
    const filled = { id: 'a', type: 'spalling', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(filled, null, 3).label).toBe('3 박락');
    const unfilled = { id: 'b', type: 'breakage', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(unfilled, null, 4).label).toBe('4 파손');
  });

  it('번호가 없으면 손상현황만 보여준다', () => {
    const filled = { id: 'a', type: 'spalling', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(filled, null).label).toBe('박락');
  });
```

파일 끝에 라벨 위치 테스트를 추가한다:
```ts
describe('labelAnchor', () => {
  it('도형 위쪽 가운데에서 조금 위에 놓는다 (화면 좌표는 아래로 갈수록 y가 크다)', () => {
    const rect: Pt[] = [[10, 40], [50, 40], [50, 80], [10, 80]];
    expect(labelAnchor(rect)).toEqual([30, 40 - LABEL_OFFSET_PX]);
  });

  it('선도 경계상자 기준으로 놓는다', () => {
    const line: Pt[] = [[0, 100], [60, 20]];
    expect(labelAnchor(line)).toEqual([30, 20 - LABEL_OFFSET_PX]);
  });

  it('점이 없으면 원점', () => {
    expect(labelAnchor([])).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm --prefix server test -- test/overlay.test.ts`
Expected: FAIL — `labelAnchor`와 `LABEL_OFFSET_PX`를 내보내지 않아 import가 `undefined`가 되고, `describeDamageRender`가 세 번째 인자를 무시해 라벨이 `'박락'`이 아니라 `null`로 나온다

- [ ] **Step 3: 구현**

`server/public/viewer/overlay.js`:

import 줄에 추가:
```js
import { computeNumbers, statusTextOf } from './quantities.js';
```

상수에 추가(`ROTATE_HANDLE_OFFSET_PX` 아래):
```js
export const LABEL_OFFSET_PX = 6;
```

`rectHandlePositions` 아래에 라벨 위치 함수를 추가한다:
```js
// 라벨은 도형 위쪽 바깥에 놓는다. 도형 한가운데에 놓으면 선·무늬와 겹쳐 번호를 읽기 어렵다.
export function labelAnchor(screenPoints) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const [x, y] of screenPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
  }
  if (minX === Infinity) return [0, 0];
  return [(minX + maxX) / 2, minY - LABEL_OFFSET_PX];
}
```

`describeDamageRender`를 바꾼다:
```js
// 손상 하나를 어떻게 그릴지 결정한다. DOM을 만들지 않는 순수 함수라 테스트하기 쉽다.
// type을 손상 유형 목록에서 찾지 못해도(유형이 이름 바뀌거나 삭제된 경우) 그리지 않고 건너뛰지 않는다 —
// 그러면 손상이 화면에서 사라져 선택할 수도, 지울 수도 없게 되어 저장이 영영 막힌다. 대신 테두리만
// 그리고 statusTextOf가 돌려주는 원본 type 문자열을 라벨로 보여줘, 선택해서 `선택 삭제`로 지울 수 있게 한다.
export function describeDamageRender(damage, selectedId, number = null) {
  const type = getDamageType(damage.type);
  const selected = damage.id === selectedId;
  const isRect = damage.geometry.kind === 'rect';
  const status = statusTextOf(damage);
  return {
    known: type !== null,
    shape: isRect ? 'polygon' : 'polyline',
    color: selected ? SELECTED_COLOR : CRACK_COLOR,
    width: selected ? SELECTED_WIDTH_PX : CRACK_WIDTH_PX,
    fillPattern: type && type.fill ? type.fill.pattern : null,
    // 번호가 화면에 있어야 번호 순서가 규칙대로인지 눈으로 확인할 수 있다.
    label: number === null ? status : `${number} ${status}`,
    showHandles: selected && isRect,
  };
}
```

`createOverlay` 안의 `renderDamage`와 `render`를 바꾼다:
```js
  function renderDamage(damage, number, elements) {
    const plan = describeDamageRender(damage, selectedId, number);
    const screen = damage.geometry.world.map((p) => mapper.worldToClient(p));

    if (plan.shape === 'polyline') {
      elements.push(polylineElement(screen, plan.color, plan.width, 1));
    } else {
      elements.push(polygonElement(screen, plan.color, plan.width, plan.fillPattern, 1));
    }
    if (plan.label !== '') elements.push(labelElement(labelAnchor(screen), plan.label));
    if (!plan.showHandles) return;

    const handles = rectHandlePositions(screen);
    for (const corner of handles.corners) elements.push(handleElement(corner, 'rect'));
    elements.push(handleElement(handles.rotate, 'circle'));
  }

  function render() {
    frame = 0;
    const elements = [];
    // 번호는 저장하지 않는다. 그릴 때마다 지금 있는 손상 전체로 다시 계산한다.
    const numbers = computeNumbers(damages);
    for (const damage of damages) {
      // 크기·회전 조절 중인 손상은 움직이는 draft가 대신 보여준다 — 그대로 두면 손 떼기 전
      // 원래 위치의 사각형·핸들과 draft가 겹쳐 두 개로 보인다.
      if (draft && draft.activeId != null && damage.id === draft.activeId) continue;
      renderDamage(damage, numbers.get(damage.id) ?? null, elements);
    }
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
```

`rectCenter`는 더 이상 `renderDamage`에서 쓰지 않지만 `rectHandlePositions`가 계속 쓰므로 import는 그대로 둔다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix server test -- test/overlay.test.ts`
Expected: PASS

Run: `npm --prefix server test`
Expected: PASS — 전체 통과

Run: `node --check server/public/viewer/overlay.js`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```
git add server/public/viewer/overlay.js server/test/overlay.test.ts
git commit -m "feat(viewer): 도면 위 라벨을 번호 + 손상현황으로" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 속성 패널 (네 칸 입력, 즉시 갱신되는 요약줄)

이 태스크를 마쳐야 뷰어가 다시 정상 동작한다(Task 2 이후 `main.js`는 없어진 v2 칸을 읽고 쓰고 있다).

**Files:**
- Modify: `server/public/viewer.html`, `server/public/viewer/viewer.css`, `server/public/viewer/main.js`
- Test: 없음 — `main.js`는 브라우저 전용이고 테스트 환경에 DOM이 없다. **가짜 DOM 하네스를 만들지 않는다.** 읽기 + `node --check` + Task 7의 실기기 확인표로 검증한다.

**Interfaces:**
- Consumes:
  - `computeNumbers(damages): Map<string, number>`, `statusTextOf(damage)`, `quantityOf(damage)`, `unitOf(damage)`, `formatQuantity(value)` (Task 1)
  - `updateDamage(editor, damageId, changes, now)` — `changes.measured`·`changes.attrs`는 얕게 병합된다 (Task 2)
  - `getDamageType(id)`, `DEFAULT_DAMAGE_TYPE_ID` (`damageTypes.js`)
- Produces (HTML 요소 id — 다른 코드가 이 이름으로 찾는다):
  - `propsPanel`, `propsTitle`, `propsSummary`, `widthRow`, `widthLabel`, `widthInput`, `lengthInput`, `countInput`, `noteInput`, `statusRow`, `statusInput`, `computedHint`, `propsSave`, `propsClose`
  - 없어지는 id: `lengthRow`, `areaRow`, `areaInput`, `memberInput`

- [ ] **Step 1: 화면 요소 교체**

`server/public/viewer.html`의 `<div id="propsPanel" hidden>` 블록 전체를 아래로 바꾼다:
```html
    <div id="propsPanel" hidden>
      <h2 id="propsTitle"></h2>
      <p id="propsSummary"></p>
      <label id="widthRow"><span id="widthLabel">가로/폭 (mm)</span> <input id="widthInput" type="number" step="0.01" min="0" inputmode="decimal" /></label>
      <label>세로/길이 (m) <input id="lengthInput" type="number" step="0.01" min="0" inputmode="decimal" /></label>
      <label>개소 <input id="countInput" type="number" step="1" min="0" inputmode="numeric" /></label>
      <label>비고 <input id="noteInput" type="text" /></label>
      <label id="statusRow">손상현황 <input id="statusInput" type="text" /></label>
      <p id="computedHint"></p>
      <div class="row">
        <button id="propsSave" type="button">저장</button>
        <button id="propsClose" type="button">닫기</button>
      </div>
    </div>
```

- [ ] **Step 2: 요약줄 스타일 추가**

`server/public/viewer/viewer.css`의 `#computedHint` 규칙 **앞에** 한 줄 추가한다:
```css
#propsSummary { margin: 0 0 10px; color: #3c4149; font-size: 13px; line-height: 1.4; }
```
(`#propsPanel[hidden], #propsPanel [hidden] { display: none; }` 규칙이 이미 자손 전체를 덮으므로 `statusRow` 숨김에는 CSS 변경이 필요 없다.)

- [ ] **Step 3: main.js 연결**

`server/public/viewer/main.js`의 import 줄 아래에 한 줄 추가한다:
```js
import { computeNumbers, formatQuantity, quantityOf, statusTextOf, unitOf } from './quantities.js';
```

`function openProps()`부터 `$('propsSave')` 리스너의 닫는 `});`까지를 아래 블록으로 **통째로** 바꾼다. 그 사이에 있던 `parseAmount`와 `showSaveError`는 아래 블록에 그대로 다시 들어 있으므로 따로 남기지 않는다(남기면 같은 함수가 두 번 선언된다). 바로 위의 `isCrackLikeType`은 그대로 둔다:
```js
  function openProps() {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    $('propsTitle').textContent = `${type.label} 속성`;
    // 균열류의 가로/폭만 mm다. 0.3mm·0.5mm 경계로 손상현황이 갈리고, 물량 계산에는 쓰이지 않는다.
    $('widthLabel').textContent = isCrackLikeType(type) ? '가로/폭 (mm)' : '가로/폭 (m)';
    // 손상현황을 직접 적는 것은 기타뿐이다. 나머지는 유형 이름·폭 구간으로 자동으로 정해진다.
    $('statusRow').hidden = type.id !== 'etc';
    $('widthInput').value = damage.measured.width ?? '';
    $('lengthInput').value = damage.measured.length ?? '';
    $('countInput').value = damage.measured.count ?? '';
    $('noteInput').value = damage.attrs.note;
    $('statusInput').value = damage.attrs.statusText;
    // 참고값은 도면 단위(설계 8장 미해결)가 정해질 때까지 숨긴다. 도면 단위를 모르는 채 그대로 보여주면
    // (예: mm 도면의 1.8㎡가 1800000.0으로) 실제 크기와 자릿수가 크게 달라 보여 오히려 오해를 준다.
    $('computedHint').hidden = true;
    updateSummary();
    $('propsPanel').hidden = false;
  }

  // 빈 입력은 null(측정 안 함)로 본다. 그 외에는 0 이상의 유한한 숫자여야 하며, 아니면 거부한다.
  function parseAmount(value) {
    const text = value.trim();
    if (text === '') return { ok: true, value: null };
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
  }

  // 개소는 낱개를 세는 값이라 정수여야 한다. 1.5개소는 물량표에 적을 수 없다.
  function parseCount(value) {
    const text = value.trim();
    if (text === '') return { ok: true, value: null };
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed >= 0 ? { ok: true, value: parsed } : { ok: false, value: null };
  }

  // 입력 중인 값으로 만든 임시 손상. 요약줄을 미리 보여주는 데만 쓰고 저장하지 않는다.
  function draftFromInputs(damage) {
    return {
      ...damage,
      measured: {
        width: parseAmount($('widthInput').value).value,
        length: parseAmount($('lengthInput').value).value,
        count: parseCount($('countInput').value).value,
      },
      attrs: { ...damage.attrs, statusText: $('statusInput').value.trim() },
    };
  }

  // 번호·손상현황·물량은 저장하지 않는다. 보여줄 때마다 다시 계산한다.
  function updateSummary() {
    const damage = selectedDamage();
    if (!damage) return;
    const draft = draftFromInputs(damage);
    const number = computeNumbers(editor.doc.damages).get(damage.id) ?? null;
    const quantity = quantityOf(draft);
    const quantityText = quantity === null ? '-' : `${formatQuantity(quantity)} ${unitOf(draft)}`;
    $('propsSummary').textContent = `번호 ${number ?? '-'} · 손상현황 ${statusTextOf(draft)} · 물량 ${quantityText}`;
  }

  function showSaveError(message) {
    $('saveError').textContent = message;
    $('saveError').hidden = false;
  }

  $('props').addEventListener('click', openProps);
  $('propsClose').addEventListener('click', () => {
    $('propsPanel').hidden = true;
  });
  for (const id of ['widthInput', 'lengthInput', 'countInput', 'statusInput']) {
    $(id).addEventListener('input', updateSummary);
  }
  $('propsSave').addEventListener('click', () => {
    const damage = selectedDamage();
    if (!damage) return;
    const type = getDamageType(damage.type) ?? getDamageType(DEFAULT_DAMAGE_TYPE_ID);
    const width = parseAmount($('widthInput').value);
    const length = parseAmount($('lengthInput').value);
    const count = parseCount($('countInput').value);
    // 범위를 벗어난 값을 조용히 null로 바꿔 저장하면(예: -3 입력) 사용자가 적은 값이 사라진 채
    // 패널이 닫혀 저장된 것처럼 보인다. 대신 패널을 열어둔 채 알리고 다시 고치게 한다.
    if (!width.ok || !length.ok) {
      showSaveError('저장하지 못했습니다: 0 이상의 숫자를 입력하세요.');
      return;
    }
    if (!count.ok) {
      showSaveError('저장하지 못했습니다: 개소는 0 이상의 정수를 입력하세요.');
      return;
    }
    apply(
      updateDamage(
        editor,
        damage.id,
        {
          measured: { width: width.value, length: length.value, count: count.value },
          attrs: {
            note: $('noteInput').value.trim(),
            // 손상현황은 기타에서만 저장한다. 다른 유형에 값이 남아 있으면 검증에서 막힌다.
            statusText: type.id === 'etc' ? $('statusInput').value.trim() : '',
          },
        },
        nowIso(),
      ),
    );
    $('saveError').hidden = true;
    $('propsPanel').hidden = true;
  });
```

`isCrackLikeType` 위의 주석은 물량 규칙이 바뀌었으므로 아래로 바꾼다:
```js
  // 균열류(선형 손상: 균열, 균열/백태) — 가로/폭을 mm로 적고 물량 계산에는 쓰지 않는 유형.
  // 유형표의 quantityUnit이 'm'인 유형과 같다(kind: 'line'과 동치).
  const isCrackLikeType = (type) => type.quantityUnit === 'm';
```

- [ ] **Step 4: 남은 v2 참조가 없는지 확인**

Run: `grep -n "lengthM\|areaM2\|widthMm\|memberInput\|areaInput\|lengthRow\|areaRow" server/public/viewer/main.js server/public/viewer.html server/public/viewer/viewer.css`
Expected: 출력 없음 (한 줄이라도 나오면 그 자리를 고친다)

- [ ] **Step 5: 문법·전체 검사**

Run:
```
node --check server/public/viewer/main.js
npm --prefix server test
npm --prefix server run typecheck
npx tsc --noEmit
```
Expected: 모두 통과, 출력 오류 없음

- [ ] **Step 6: 읽어서 확인 (DOM 테스트가 없으므로 눈으로 본다)**

`main.js`의 바뀐 부분을 처음부터 끝까지 읽고 아래를 확인한다.
- `openProps`가 읽는 id와 `viewer.html`에 있는 id가 하나도 빠짐없이 같은가
- `updateSummary`가 `openProps`보다 **아래에** 정의돼 있어도 호출된다(함수 선언은 끌어올려진다). 화살표 함수로 바꾸지 않았는가
- `propsSave`가 `measured`의 세 칸과 `attrs`의 두 칸을 모두 쓰는가, `statusText`가 기타가 아닐 때 `''`인가
- 거부 경로(`return`)에서 패널을 닫지 않는가

- [ ] **Step 7: 커밋**

```
git add server/public/viewer.html server/public/viewer/viewer.css server/public/viewer/main.js
git commit -m "feat(viewer): 가로·세로·개소 속성 패널과 번호·손상현황·물량 요약줄" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 문서 갱신과 실기기 확인표

**Files:**
- Modify: `README.md`
- Create: `docs/손상속성-테스트-결과.md`

**Interfaces:**
- Consumes: Task 1~6 전체
- Produces: 새 속성 패널의 사용 방법과, 사용자가 실기기에서 채울 **빈** 확인표

- [ ] **Step 1: README 갱신**

`README.md`의 설계 목록 줄(`- 설계: …`)에 새 설계를 더한다:
```markdown
- 설계: `docs/superpowers/specs/2026-09-10-phase1-poc-design.md`(1단계 PoC), `docs/superpowers/specs/2026-09-12-damage-types-design.md`(손상 유형 체계), `docs/superpowers/specs/2026-09-13-damage-attributes-design.md`(손상 속성·물량)
```

`## 사용` 3번 항목의 **속성 줄 하나**를 아래 세 줄로 바꾼다(나머지 줄은 그대로 둔다):
```markdown
   - 선택한 상태에서 **속성**을 열어 가로/폭, 세로/길이, 개소, 비고를 적습니다. 빈 칸은 "아직 측정하지 않음"입니다(0과 다릅니다)
   - 균열류(균열, 균열/백태)의 가로/폭은 **mm**이고 0.3mm·0.5mm 경계로 손상현황 이름이 갈립니다. 나머지 유형은 **m**이며 물량 계산에 쓰입니다. `기타`에만 손상현황을 직접 적는 칸이 있습니다
   - 맨 윗줄의 **번호·손상현황·물량**은 입력에 따라 즉시 다시 계산되어 보입니다(저장되지 않고 매번 계산합니다). 물량은 균열류 = 세로/길이 × 개소, 나머지 = 가로/폭 × 세로/길이 × 개소입니다
```

- [ ] **Step 2: 확인표 만들기 (결과는 비워 둔다)**

`docs/손상속성-테스트-결과.md` (새 파일):
```markdown
# 손상 속성·물량 확인 결과

- 확인 일자:
- 커밋:
- 확인 도면:

| # | 확인 항목 | 결과 | 비고 |
|---|---|---|---|
| 1 | 속성 패널에 가로/폭·세로/길이·개소·비고 네 칸이 보인다 | | |
| 2 | 균열류는 `가로/폭 (mm)`, 나머지 유형은 `가로/폭 (m)`으로 단위 표기가 바뀐다 | | |
| 3 | `기타` 유형에서만 손상현황 입력 칸이 보인다 | | |
| 4 | 값을 입력하는 즉시 맨 윗줄의 손상현황·물량이 바뀐다 | | |
| 5 | 값이 부족하면 물량 자리에 `-`가 보인다 | | |
| 6 | 균열 폭 0.2 / 0.3 / 0.5를 넣으면 손상현황이 (0.3mm미만) / (0.3mm이상) / (0.5mm이상)으로 바뀐다 | | |
| 7 | 균열류 물량 = 세로/길이 × 개소이고, 가로/폭을 바꿔도 물량이 변하지 않는다 | | |
| 8 | 면형 물량 = 가로/폭 × 세로/길이 × 개소 | | |
| 9 | 음수를 넣고 저장하면 패널이 열린 채 오류가 보인다 | | |
| 10 | 개소에 1.5를 넣고 저장하면 패널이 열린 채 정수 오류가 보인다 | | |
| 11 | 도면 위 라벨이 `번호 + 손상현황`으로 보인다 | | |
| 12 | **실제 도면에서 번호가 왼쪽 위 → 오른쪽 → 다음 줄 왼쪽 순서로 붙는다** (줄 허용 폭 = 손상 높이 중앙값 규칙. 설계 8장 미해결 항목) | | |
| 13 | 손상을 하나 지우면 뒷번호가 당겨져 1부터 끊김 없이 이어진다 | | |
| 14 | 예전(v1/v2)에 저장한 도면을 열면 손상이 그대로 보인다 | | |
| 15 | v2에서 면적·부재명을 적었던 손상은 비고에 `이전 면적 입력값: …㎡`, `부재명: …`이 남아 있다 | | |
| 16 | 서버 JSON이 `schemaVersion: 3`이고 `measured`에 width/length/count가 들어 있다 | | |
| 17 | 새로고침해도 입력값이 그대로 남아 있다 | | |

## 발견한 문제
```

- [ ] **Step 3: 전체 검증**

Run:
```
npm run server:test
npm --prefix server run typecheck
npx tsc --noEmit
node --check server/public/viewer/quantities.js
node --check server/public/viewer/damageDoc.js
node --check server/public/viewer/crackTool.js
node --check server/public/viewer/overlay.js
node --check server/public/viewer/main.js
```
Expected: 모두 통과, 출력 오류 없음

- [ ] **Step 4: 커밋**

```
git add README.md "docs/손상속성-테스트-결과.md"
git commit -m "docs: 손상 속성·물량 사용 방법과 확인표" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: (사용자 체크포인트) 실기기 확인**

서버를 켜고 태블릿에서 뷰어를 연 뒤, 위 표의 1~17번을 사용자와 함께 확인하고 결과를 채운다. **12번(번호 순서)은 설계 8장이 "실기기 확인에서 본다"고 남긴 미해결 항목이므로, 손상이 여러 줄로 흩어진 실제 도면에서 반드시 본다.** 순서가 어색하면 허용 폭 규칙(중앙값)을 사용자와 다시 정하고 `quantities.js`의 `medianHeight`만 고친다 — 번호는 저장되지 않으므로 규칙을 바꿔도 기존 데이터를 손댈 필요가 없다.

실패 항목이 있으면 superpowers:systematic-debugging으로 원인을 찾아 고친 뒤 그 항목만 다시 확인한다.

다음 단계(2단계 DWG 산출)의 물량표는 `quantities.js`의 `computeNumbers` / `statusTextOf` / `quantityOf` / `unitOf` / `formatQuantity`를 그대로 쓴다(설계 7장).
