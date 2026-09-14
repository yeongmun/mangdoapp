import { describe, expect, it } from 'vitest';
import { getDamageType } from '../public/viewer/damageTypes.js';
import {
  computeNumbers,
  CRACK_WIDTH_BREAKS,
  dimensionTextOf,
  drawingNameOf,
  formatQuantity,
  medianHeight,
  quantityOf,
  statusTextOf,
  unitOf,
  widthUnitOf,
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
    expect((Object.values(first) as number[]).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
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

describe('widthUnitOf', () => {
  it('균열류(quantityUnit이 m인 선형 유형)는 mm', () => {
    expect(widthUnitOf(getDamageType('crack'))).toBe('mm');
    expect(widthUnitOf(getDamageType('crack_efflorescence'))).toBe('mm');
  });

  it('나머지 유형(면형)은 m', () => {
    expect(widthUnitOf(getDamageType('spalling'))).toBe('m');
    expect(widthUnitOf(getDamageType('etc'))).toBe('m');
  });

  it('유형을 알 수 없으면(삭제·이름바뀜) mm으로 잘못 보여주지 않도록 m', () => {
    expect(widthUnitOf(getDamageType('no_such_type'))).toBe('m');
    expect(widthUnitOf(null)).toBe('m');
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

describe('dimensionTextOf', () => {
  it('균열(m)의 치수 문구는 / 구분자를 쓴다', () => {
    expect(dimensionTextOf(crack('a', { width: 0.2, length: 0.8, count: 1 }))).toBe('0.2/0.8');
  });

  it('개소가 2 이상이면 뒤에  2EA를 붙인다', () => {
    expect(dimensionTextOf(crack('a', { width: 0.2, length: 0.8, count: 2 }))).toBe('0.2/0.8 2EA');
    expect(dimensionTextOf(crack('b', { width: 1.2, length: 1.2, count: 3 }))).toBe('1.2/1.2 3EA');
  });

  it('개소가 1이거나 null이면 EA를 붙이지 않는다', () => {
    expect(dimensionTextOf(crack('a', { width: 0.2, length: 0.8, count: 1 }))).toBe('0.2/0.8');
    expect(dimensionTextOf(crack('b', { width: 0.2, length: 0.8, count: null }))).toBe('0.2/0.8');
  });

  it('면형(m2)의 치수 문구는 x 구분자를 쓴다', () => {
    expect(dimensionTextOf(area('a', { width: 1.2, length: 1.2, count: 1 }))).toBe('1.2x1.2');
    expect(dimensionTextOf(area('b', { width: 1.2, length: 1.2, count: 3 }))).toBe('1.2x1.2 3EA');
  });

  it('width나 length 중 하나라도 null이면 빈 문자열을 돌려준다', () => {
    expect(dimensionTextOf(crack('a', { width: null, length: 0.8, count: 1 }))).toBe('');
    expect(dimensionTextOf(crack('b', { width: 0.2, length: null, count: 1 }))).toBe('');
    expect(dimensionTextOf(area('c', { width: null, length: 1.2, count: 1 }))).toBe('');
    expect(dimensionTextOf(area('d', { width: 1.2, length: null, count: 1 }))).toBe('');
  });

  it('0은 유효한 값이다', () => {
    expect(dimensionTextOf(crack('a', { width: 0, length: 0.5, count: 1 }))).toBe('0/0.5');
    expect(dimensionTextOf(area('b', { width: 0, length: 0.5, count: 1 }))).toBe('0x0.5');
  });

  it('숫자는 formatQuantity로 다듬는다(소수 3자리, 뒤 0 제거)', () => {
    const damage = {
      id: 'a',
      type: 'crack',
      geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
      measured: { width: 0.20000000000000004, length: 0.80000000000000004, count: 1 },
      attrs: { note: '', statusText: '' },
    };
    expect(dimensionTextOf(damage)).toBe('0.2/0.8');
  });

  it('유형을 찾을 수 없으면 구분자는 x를 쓴다', () => {
    const damage = {
      id: 'a',
      type: 'no_such_type',
      geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
      measured: { width: 0.2, length: 0.8, count: 1 },
      attrs: { note: '', statusText: '' },
    };
    expect(dimensionTextOf(damage)).toBe('0.2x0.8');
  });
});

describe('drawingNameOf', () => {
  it('균열류(quantityUnit이 m)는 유형 이름 그대로, 구간 없이', () => {
    expect(drawingNameOf(crack('a', { width: 0.2, length: null, count: null }))).toBe('균열');
    const ceType = {
      id: 'a',
      type: 'crack_efflorescence',
      geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
      measured: { width: 0.6, length: null, count: null },
      attrs: { note: '', statusText: '' },
    };
    expect(drawingNameOf(ceType)).toBe('균열/백태');
  });

  it('면형 유형(quantityUnit이 m2)은 유형 이름 그대로', () => {
    expect(drawingNameOf(area('a', { width: 1, length: 1, count: 1 }))).toBe('박락');
    expect(drawingNameOf(area('b', { width: null, length: null, count: null }, 'map_crack'))).toBe('망상균열');
    expect(drawingNameOf(area('c', { width: null, length: null, count: null }, 'efflorescence'))).toBe('백태·열화');
  });

  it('기타는 사용자가 적은 손상현황을 이름으로 쓴다', () => {
    const written = area('a', { width: null, length: null, count: null }, 'etc');
    written.attrs.statusText = '표면 오염';
    expect(drawingNameOf(written)).toBe('표면 오염');
  });

  it('기타에서 손상현황이 비어 있으면 유형 이름을 쓴다', () => {
    const blank = area('b', { width: null, length: null, count: null }, 'etc');
    expect(drawingNameOf(blank)).toBe('기타');

    const spaces = area('c', { width: null, length: null, count: null }, 'etc');
    spaces.attrs.statusText = '   ';
    expect(drawingNameOf(spaces)).toBe('기타');
  });

  it('유형을 찾을 수 없으면 저장된 type 문자열을 그대로 돌려준다', () => {
    const damage = {
      id: 'x',
      type: 'no_such_type',
      geometry: { kind: 'polyline', world: [[0, 0], [1, 0]] as Pt[], dwg: null },
      measured: { width: null, length: null, count: null },
      attrs: { note: '', statusText: '' },
    };
    expect(drawingNameOf(damage)).toBe('no_such_type');
  });
});
