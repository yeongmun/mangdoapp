import { describe, expect, it } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import type { Transform } from '../src/export/tableGrid.js';
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
});

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
