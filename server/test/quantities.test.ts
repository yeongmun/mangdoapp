import { describe, expect, it } from 'vitest';
import { getDamageType } from '../public/viewer/damageTypes.js';
import {
  computeNumbers,
  CRACK_WIDTH_BREAKS,
  dimensionTextOf,
  drawingNameOf,
  formatQuantity,
  parsePhotoNumbers,
  photoTextOf,
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

describe('computeNumbers', () => {
  it('손상이 없으면 빈 결과', () => {
    expect(computeNumbers([]).size).toBe(0);
  });

  it('손상이 하나면 1번', () => {
    expect(numbersOf([rectAt('only', -500, -900, 4)])).toEqual({ only: 1 });
  });

  it('x가 다른 손상 3개가 위아래로 흩어져도 높이·Y와 무관하게 x 순서대로 매긴다', () => {
    // Y 순서(위→아래)는 b, c, a인데 X 순서(왼쪽→오른쪽)는 a, b, c다 — 줄 단위 규칙이었다면
    // Y 순서대로 b·c·a가 나왔을 자리에서, 왼쪽 우선 규칙은 X 순서 a·b·c를 내야 한다.
    const damages = [
      rectAt('c', 100, 0, 4),
      rectAt('a', 0, -900, 1),
      rectAt('b', 50, 500, 30),
    ];
    expect(numbersOf(damages)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('X가 같고 Y가 다르면 Y가 큰(위쪽) 쪽이 앞번호', () => {
    const damages = [rectAt('low', 10, 0, 10), rectAt('high', 10, 500, 10)];
    expect(numbersOf(damages)).toEqual({ high: 1, low: 2 });
  });

  it('X도 Y도 같으면 id 오름차순', () => {
    const damages = [rectAt('b2', 10, 100, 10), rectAt('a1', 10, 100, 10)];
    expect(numbersOf(damages)).toEqual({ a1: 1, b2: 2 });
  });

  it('X가 아주 조금만 달라도 허용 폭 없이 그 차이대로 갈린다', () => {
    // 같은 수직선상으로 보이는 높이 차이라도(둘 다 높이 10) 줄 개념이 없으므로
    // X가 조금이라도 작은 쪽이 그대로 앞번호다.
    const damages = [rectAt('right', 0.001, 100, 10), rectAt('left', 0, 90, 10)];
    expect(numbersOf(damages)).toEqual({ left: 1, right: 2 });
  });

  it('같은 손상 집합이면 순서를 바꿔 넣어도 같은 번호가 나온다', () => {
    const damages = [
      rectAt('a', 0, 100, 10),
      rectAt('b', 50, 95, 30),
      rectAt('c', 0, -200, 10),
      rectAt('d', 60, 5, 4),
      rectAt('e', 30, 40, 1),
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

  it('비유한 좌표가 섞인 손상은 유한한 점만으로 중심을 구한다', () => {
    const nanMixed = {
      id: 'y',
      type: 'crack',
      geometry: { kind: 'polyline', world: [[NaN, NaN], [10, 10], [20, 20]], dwg: null },
    };
    // NaN인 점은 걸러지고 남은 (10,10)-(20,20)의 중심 x=15 → x=0인 손상보다 뒤.
    const damages = [rectAt('left', 0, 0, 10), nanMixed];
    expect(numbersOf(damages)).toEqual({ left: 1, y: 2 });
  });

  it('원본 배열과 각 손상 객체를 바꾸지 않는다', () => {
    const damages = [rectAt('a', 10, 10, 10), rectAt('b', 0, 0, 10)];
    const snapshot = JSON.parse(JSON.stringify(damages));
    computeNumbers(damages);
    expect(damages).toEqual(snapshot);
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
  it('정수도 최소한 소수 첫째 자리까지 표시한다', () => {
    expect(formatQuantity(1)).toBe('1.0');
    expect(formatQuantity(0)).toBe('0.0');
    expect(formatQuantity(1.25)).toBe('1.25');
    expect(formatQuantity(1.2345)).toBe('1.234'); // 1.2345는 부동소수 표현 특성상 1.234로 반올림됨
  });

  it('부동소수 꼬리를 정리해서 보여준다', () => {
    const value = quantityOf(area('a', { width: 0.2, length: 1.5, count: 1 })) as number;
    expect(value).not.toBe(0.3); // 0.30000000000000004
    expect(formatQuantity(value)).toBe('0.3');
  });

  it('0은 0.0, 계산할 수 없으면 -', () => {
    expect(formatQuantity(0)).toBe('0.0');
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
    expect(dimensionTextOf(crack('a', { width: 0, length: 0.5, count: 1 }))).toBe('0.0/0.5');
    expect(dimensionTextOf(area('b', { width: 0, length: 0.5, count: 1 }))).toBe('0.0x0.5');
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
  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2 예외.
  // 균열(crack)만 이름을 빼고 번호 원만 그린다 — 사내 망도의 `(17) 0.2/1.5` 표기와 같다.
  it('균열(crack)은 이름 없이 빈 문자열을 돌려준다', () => {
    expect(drawingNameOf(crack('a', { width: 0.2, length: null, count: null }))).toBe('');
  });

  it('균열/백태(crack_efflorescence)는 균열류지만 이름을 그대로 둔다(구간 없이)', () => {
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

// 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 9.2
describe('parsePhotoNumbers', () => {
  it('쉼표로 나누고 앞뒤 공백을 지운다', () => {
    expect(parsePhotoNumbers('12, 13, 15')).toEqual(['12', '13', '15']);
    expect(parsePhotoNumbers(' 12 ,13,  15 ')).toEqual(['12', '13', '15']);
  });

  it('빈 항목은 버린다', () => {
    expect(parsePhotoNumbers('12,,13,')).toEqual(['12', '13']);
  });

  it('같은 번호가 두 번 나오면 처음 나온 것만 남긴다', () => {
    expect(parsePhotoNumbers('12, 13, 12')).toEqual(['12', '13']);
  });

  it('숫자로 바꾸지 않는다 — 앞자리 0과 접두어를 보존한다', () => {
    expect(parsePhotoNumbers('012, P-013')).toEqual(['012', 'P-013']);
  });

  it('빈 문자열·공백뿐인 문자열·쉼표뿐인 문자열은 빈 배열', () => {
    expect(parsePhotoNumbers('')).toEqual([]);
    expect(parsePhotoNumbers('   ')).toEqual([]);
    expect(parsePhotoNumbers(',')).toEqual([]);
  });

  it('null·undefined·문자열이 아닌 값은 빈 배열', () => {
    expect(parsePhotoNumbers(null)).toEqual([]);
    expect(parsePhotoNumbers(undefined)).toEqual([]);
    expect(parsePhotoNumbers(42)).toEqual([]);
  });
});

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
});
