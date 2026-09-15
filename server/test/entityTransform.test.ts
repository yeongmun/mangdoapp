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

// 네 꼭짓점 (0,0) (10,0) (10,10) (0,10) — 정사각형.
const SOLID = pairsOf(
  [0, 'SOLID'], [5, 'A6'], [330, '30'],
  [10, '0.0'], [20, '0.0'], [11, '10.0'], [21, '0.0'], [12, '10.0'], [22, '10.0'], [13, '0.0'], [23, '10.0'],
);

const POINT_ENTITY = pairsOf([0, 'POINT'], [5, 'A7'], [330, '30'], [10, '3.0'], [20, '4.0'], [30, '0.0']);

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

  it('SOLID은 네 꼭짓점을 모두 옮긴다', () => {
    // (0,0)+(5,7)=(5,7), (10,0)+(5,7)=(15,7), (10,10)+(5,7)=(15,17), (0,10)+(5,7)=(5,17)
    const moved = translateEntityPairs(SOLID, 5, 7);
    expect(valueAt(moved, 10)).toBe('5.0');
    expect(valueAt(moved, 20)).toBe('7.0');
    expect(valueAt(moved, 11)).toBe('15.0');
    expect(valueAt(moved, 21)).toBe('7.0');
    expect(valueAt(moved, 12)).toBe('15.0');
    expect(valueAt(moved, 22)).toBe('17.0');
    expect(valueAt(moved, 13)).toBe('5.0');
    expect(valueAt(moved, 23)).toBe('17.0');
  });

  it('POINT은 점 하나를 옮긴다', () => {
    const moved = translateEntityPairs(POINT_ENTITY, 1, 1);
    expect(valueAt(moved, 10)).toBe('4.0');
    expect(valueAt(moved, 20)).toBe('5.0');
  });

  it('ROLES에 없는 DIMENSION도 일반 규칙(10~18/20~28)으로 점을 전부 옮긴다', () => {
    // fix round 1, controller ruling 1 — indexRegions가 DIMENSION 같은 타입을 완전히 빠뜨리던
    // 결함(review Important)을 고치는 짝. 정의점(10/20)·문자 중점(11/21)·인출선 정의점(13/23,
    // 14/24) 네 점을 모두 옮긴다.
    const dimension = pairsOf(
      [0, 'DIMENSION'], [5, 'D9'], [330, '1F'], [2, '*D1'],
      [10, '0.0'], [20, '0.0'], [11, '5.0'], [21, '5.0'],
      [13, '10.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'],
    );
    const moved = translateEntityPairs(dimension, 1000, 2000);
    expect(valueAt(moved, 10)).toBe('1000.0');
    expect(valueAt(moved, 20)).toBe('2000.0');
    expect(valueAt(moved, 11)).toBe('1005.0');
    expect(valueAt(moved, 21)).toBe('2005.0');
    expect(valueAt(moved, 13)).toBe('1010.0');
    expect(valueAt(moved, 23)).toBe('2000.0');
    expect(valueAt(moved, 14)).toBe('1010.0');
    expect(valueAt(moved, 24)).toBe('2010.0');
    // 블록 이름(2)은 좌표가 아니라 손대지 않는다
    expect(valueAt(moved, 2)).toBe('*D1');
  });

  it('MLEADER는 일반 규칙에서 빠져 손대지 않는다(10/11/12가 점·방향이 뒤섞여 있다)', () => {
    const mleader = pairsOf(
      [0, 'MLEADER'], [5, 'DA'], [330, '1F'],
      [10, '1.0'], [20, '2.0'], [11, '3.0'], [21, '4.0'],
    );
    expect(translateEntityPairs(mleader, 1000, 2000)).toBe(mleader);
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

  it('SOLID의 경계상자는 네 꼭짓점을 모두 감싼다', () => {
    expect(entityBoundsOf(SOLID)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('POINT의 경계상자는 점 자신이다(한 점, 폭·높이 0)', () => {
    expect(entityBoundsOf(POINT_ENTITY)).toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 });
  });

  it('ROLES에 없는 DIMENSION도 일반 규칙으로 경계상자를 낸다(복사는 여전히 안 된다)', () => {
    // fix round 1 — indexRegions가 이 경계상자를 써서 틀 영역의 멤버로 넣을 수 있어야 한다.
    const dimension = pairsOf(
      [0, 'DIMENSION'], [5, 'D9'], [330, '1F'], [2, '*D1'],
      [10, '0.0'], [20, '0.0'], [11, '5.0'], [21, '5.0'],
      [13, '10.0'], [23, '0.0'], [14, '10.0'], [24, '10.0'],
    );
    expect(entityBoundsOf(dimension)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(isCopyable(dimension)).toBe(false); // 멤버는 되지만 복사되지는 않는다
  });

  it('MLEADER는 일반 규칙에서 빠져 경계상자가 없다(점·방향이 뒤섞인 그룹 코드라 신뢰할 수 없다)', () => {
    const mleader = pairsOf(
      [0, 'MLEADER'], [5, 'DA'], [330, '1F'],
      [10, '1.0'], [20, '2.0'], [11, '3.0'], [21, '4.0'],
    );
    expect(entityBoundsOf(mleader)).toBeNull();
  });

  it('허용 목록 밖의 종류는 복사하지 않는다', () => {
    expect(isCopyable(LINE)).toBe(true);
    expect(isCopyable(HATCH)).toBe(true);
    expect(isCopyable(SOLID)).toBe(true);
    expect(isCopyable(POINT_ENTITY)).toBe(true);
    expect(isCopyable(pairsOf([0, 'DIMENSION'], [5, 'B2'], [2, '*D1']))).toBe(false);
    expect(isCopyable(pairsOf([0, 'ACAD_TABLE'], [5, 'B3']))).toBe(false);
  });

  it('102 묶음 밖에서 소유자가 아닌 340을 가진 엔티티는 복사하지 않는다', () => {
    // fix round 1 — controller ruling 3. 340/350/360은 102{...} 묶음(ACAD_REACTORS·
    // ACAD_XDICTIONARY, copyEntityPairs가 통째로 지운다) 밖에 있으면 이 모듈이 다루지 못하는
    // 참조다 — LEADER의 스타일 참조(340) 같은 자리를 흉내낸 합성 픽스처다(조사표는 LEADER를
    // 관찰하지 못했지만 방어 규칙은 340/350/360 전부에 적용된다).
    const strayReference = pairsOf(
      [0, 'LWPOLYLINE'], [5, 'B5'], [330, '1F'], [340, '99'],
      [10, '0.0'], [20, '0.0'], [10, '10.0'], [20, '0.0'],
    );
    expect(isCopyable(strayReference)).toBe(false);
  });

  it('소유자 칸 밖의 두 번째 330(102 묶음도, 연관 HATCH 경계 참조도 아님)은 복사하지 않는다', () => {
    const strayOwner = pairsOf(
      [0, 'LINE'], [5, 'B6'], [330, '1F'], [330, '99'],
      [10, '0.0'], [20, '0.0'], [11, '10.0'], [21, '0.0'],
    );
    expect(isCopyable(strayOwner)).toBe(false);
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

  it('LINE의 두 점을 함께 변환한다', () => {
    // x = 10 + 2*100 = 210, y = 20 + 2*200 = 420 / x = 10 + 2*300 = 610, y = 20 + 2*400 = 820
    const out = transformEntityPairs(LINE, SCALE2);
    expect(valueAt(out, 10)).toBe('210.0');
    expect(valueAt(out, 20)).toBe('420.0');
    expect(valueAt(out, 11)).toBe('610.0');
    expect(valueAt(out, 21)).toBe('820.0');
  });

  it('LWPOLYLINE은 반복되는 10/20을 모두 변환하고 42(bulge)는 그대로, 43(폭)은 배율이 곱해진다', () => {
    const poly = pairsOf(
      [0, 'LWPOLYLINE'], [5, 'F1'], [330, '30'], [90, '        3'], [70, '     1'], [43, '2.5'],
      [10, '0.0'], [20, '0.0'], [42, '0.5'], [10, '10.0'], [20, '0.0'], [10, '10.0'], [20, '10.0'],
    );
    const out = transformEntityPairs(poly, SCALE2);
    // (10+2*0,20+2*0)=(10,20), (10+2*10,20+2*0)=(30,20), (10+2*10,20+2*10)=(30,40)
    expect(out.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['10.0', '30.0', '30.0']);
    expect(out.filter((p) => p.code === 20).map((p) => p.value)).toEqual(['20.0', '20.0', '40.0']);
    expect(valueAt(out, 42)).toBe('0.5'); // bulge는 형상 비율이라 배율과 무관하다
    expect(valueAt(out, 43)).toBe('5.0'); // 2.5 * 2
  });

  it('MTEXT는 삽입점(10/20)을 변환하고 방향 벡터(11/21)는 회전만 하며 40/41에 배율을 곱한다', () => {
    const mtext = pairsOf(
      [0, 'MTEXT'], [5, 'F2'], [330, '30'], [10, '50.0'], [20, '60.0'], [40, '10.0'], [41, '5.0'],
      [11, '1.0'], [21, '0.0'], [1, '가나'],
    );
    const rotated: Transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: Math.PI / 2 };
    const out = transformEntityPairs(mtext, rotated);
    // 삽입점: sx = 50*2 = 100, sy = 60*2 = 120. cos90≈0, sin90=1.
    // x = 0 + 100*cos90 - 120*sin90 = -120, y = 0 + 100*sin90 + 120*cos90 = 100.
    expect(Number(valueAt(out, 10))).toBeCloseTo(-120, 6);
    expect(Number(valueAt(out, 20))).toBeCloseTo(100, 6);
    // 방향 벡터(1,0)는 배율 없이 회전만 한다: x' = 1*cos90 - 0*sin90 = 0, y' = 1*sin90 + 0*cos90 = 1.
    // 원래 크기(1)가 그대로 유지된 채 방향만 90도 돈 것 — 배율이 곱해졌다면 크기가 2가 됐을 것이다.
    expect(Number(valueAt(out, 11))).toBeCloseTo(0, 6);
    expect(Number(valueAt(out, 21))).toBeCloseTo(1, 6);
    expect(valueAt(out, 40)).toBe('20.0'); // 10 * 2
    expect(valueAt(out, 41)).toBe('10.0'); // 5 * 2
  });

  it('SOLID은 네 꼭짓점을 모두 변환한다', () => {
    // (0,0)→(10+2*0,20+2*0)=(10,20), (10,0)→(10+20,20+0)=(30,20),
    // (10,10)→(10+20,20+20)=(30,40), (0,10)→(10+0,20+20)=(10,40)
    const out = transformEntityPairs(SOLID, SCALE2);
    expect(valueAt(out, 10)).toBe('10.0');
    expect(valueAt(out, 20)).toBe('20.0');
    expect(valueAt(out, 11)).toBe('30.0');
    expect(valueAt(out, 21)).toBe('20.0');
    expect(valueAt(out, 12)).toBe('30.0');
    expect(valueAt(out, 22)).toBe('40.0');
    expect(valueAt(out, 13)).toBe('10.0');
    expect(valueAt(out, 23)).toBe('40.0');
  });

  it('HATCH는 43/44(점)·45/46(회전+배율이 걸리는 상대 벡터)·49(대시 길이)·41(패턴 축척)·52/53(각도)를 모두 규칙대로 변환한다', () => {
    // fix round 1 — controller ruling 1. scale=2, rotation=90도, 삽입점 이동 없음(x=y=0)으로
    // 회전·배율만 따로 볼 수 있게 한다. cos90 = Math.cos(Math.PI/2) ≈ 6.12e-17(0에 아주 가깝지만
    // 정확히 0은 아니다) — 그래서 회전이 걸리는 값은 toBeCloseTo로 비교한다.
    const hatch = pairsOf(
      [0, 'HATCH'], [5, 'F4'], [330, '30'],
      [10, '0.0'], [20, '0.0'], // 고도 기준점 — 변환에서도 완전히 제외된다
      [10, '5.0'], [20, '0.0'], // 경계점 하나(이 모듈은 경계 점 개수를 검사하지 않는다)
      [43, '1.0'], [44, '0.0'], // 패턴 기준점(절대 점)
      [45, '2.0'], [46, '0.0'], // 패턴 오프셋(상대 거리 벡터) — 길이 2, x축 방향
      [49, '3.0'], // 대시 길이
      [41, '1.5'], // 패턴 축척
      [52, '10.0'], [53, '20.0'], // 해치각 · 패턴각
    );
    const t: Transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: Math.PI / 2 };
    const out = transformEntityPairs(hatch, t);

    // 고도 기준점은 손대지 않는다(첫 10/20이라 계산에서 아예 빠진다).
    expect(valueAt(out, 10, 0)).toBe('0.0');
    expect(valueAt(out, 20, 0)).toBe('0.0');

    // 경계점(절대 점): sx = 5*2 = 10, sy = 0*2 = 0.
    // x = 0 + 10*cos90 - 0*sin90 ≈ 0, y = 0 + 10*sin90 + 0*cos90 = 10.
    expect(Number(valueAt(out, 10, 1))).toBeCloseTo(0, 6);
    expect(Number(valueAt(out, 20, 1))).toBeCloseTo(10, 6);

    // 43/44(절대 점): sx = 1*2 = 2, sy = 0*2 = 0. x ≈ 0, y = 2.
    expect(Number(valueAt(out, 43))).toBeCloseTo(0, 6);
    expect(Number(valueAt(out, 44))).toBeCloseTo(2, 6);

    // 45/46(상대 거리 벡터): 먼저 배율을 곱한다 — sx = 2*2 = 4, sy = 0*2 = 0.
    // 그다음 회전한다 — x' = 4*cos90 - 0*sin90 ≈ 0, y' = 4*sin90 + 0*cos90 = 4.
    // 원래 길이 2가 배율 2배로 4가 된 뒤 방향만 90도 돈 것 — vector(회전만)였다면 길이가 2로
    // 남았을 것이다.
    expect(Number(valueAt(out, 45))).toBeCloseTo(0, 6);
    expect(Number(valueAt(out, 46))).toBeCloseTo(4, 6);

    // 49(대시 길이)·41(패턴 축척): 길이라 배율만 곱한다. 3*2=6, 1.5*2=3.
    expect(valueAt(out, 49)).toBe('6.0');
    expect(valueAt(out, 41)).toBe('3.0');

    // 52/53(각도): 90도(회전각)를 더한다. 10+90=100, 20+90=110.
    expect(valueAt(out, 52)).toBe('100.0');
    expect(valueAt(out, 53)).toBe('110.0');
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

// fix round 2, review Important #1 — 92(경로 종류)에 폴리라인 비트가 없는 경계도 모서리 종류
// (72)가 선(1)·원호(2)면 이동·변환이 정확하다. 실제 템플릿에서 이 모양(92=[1], 72 전부 1)의
// 단색 화살촉 HATCH 2개가 isCopyable=false로 매 복사본마다 빠졌었다(final-review.md I1).
describe('HATCH 비폴리라인 경계(72 모서리 종류) — fix round 2', () => {
  // 연관 해치(71=1), 선 모서리 3개로 된 삼각형 경계 — (0,0)-(10,0)-(10,10)-(0,0).
  const HATCH_LINE_EDGES = pairsOf(
    [0, 'HATCH'], [5, 'E1'], [330, '1F'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbHatch'],
    [10, '0.0'], [20, '0.0'], [30, '0.0'],
    [2, 'ANSI31'], [70, '     0'], [71, '     1'],
    [91, '        1'], [92, '        1'], [93, '        3'],
    [72, '     1'], [10, '0.0'], [20, '0.0'], [11, '10.0'], [21, '0.0'],
    [72, '     1'], [10, '10.0'], [20, '0.0'], [11, '10.0'], [21, '10.0'],
    [72, '     1'], [10, '10.0'], [20, '10.0'], [11, '0.0'], [21, '0.0'],
    [97, '        1'], [330, '39AA'],
    [75, '     0'], [76, '     1'], [52, '45.0'], [41, '1.0'], [77, '     0'], [78, '     1'],
    [53, '45.0'], [43, '5.0'], [44, '6.0'], [45, '0.0'], [46, '3.0'], [79, '     0'],
    [47, '0.115'], [98, '        1'], [10, '5.0'], [20, '5.0'],
  );

  // 비연관(71=0), 원호 모서리 하나 — 중심 (20,30), 반지름 5, 0~180도.
  const HATCH_ARC_EDGE = pairsOf(
    [0, 'HATCH'], [5, 'E2'], [330, '1F'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbHatch'],
    [10, '0.0'], [20, '0.0'], [30, '0.0'],
    [2, 'ANSI31'], [70, '     0'], [71, '     0'],
    [91, '        1'], [92, '        1'], [93, '        1'],
    [72, '     2'], [10, '20.0'], [20, '30.0'], [40, '5.0'], [50, '0.0'], [51, '180.0'], [73, '     1'],
    [75, '     0'], [76, '     1'], [52, '0.0'], [41, '1.0'], [77, '     0'], [78, '     0'],
    [79, '        0'], [47, '0.115'], [98, '        1'], [10, '20.0'], [20, '30.0'],
  );

  // 타원호 모서리(72=3) — 11/21이 중심 기준 상대 장축 벡터라 여전히 복사하지 않는다.
  const HATCH_ELLIPTIC_EDGE = pairsOf(
    [0, 'HATCH'], [5, 'E3'], [330, '1F'], [100, 'AcDbEntity'], [8, '0'], [100, 'AcDbHatch'],
    [10, '0.0'], [20, '0.0'], [30, '0.0'],
    [2, 'ANSI31'], [70, '     0'], [71, '     0'],
    [91, '        1'], [92, '        1'], [93, '        1'],
    [72, '     3'], [10, '20.0'], [20, '30.0'], [11, '10.0'], [21, '0.0'], [40, '0.5'], [50, '0.0'], [51, '180.0'], [73, '     1'],
    [79, '        0'], [47, '0.115'], [98, '        1'], [10, '20.0'], [20, '30.0'],
  );

  // 같은 비폴리라인 경로 안에 선 모서리와 타원호 모서리가 섞이면 — 하나라도 안전하지 않으면
  // 전체를 거부해야 한다(루프가 첫 안전한 모서리에서 멈추지 않는지 확인).
  const HATCH_MIXED_EDGES = pairsOf(
    [0, 'HATCH'], [5, 'E4'], [330, '1F'],
    [91, '        1'], [92, '        1'], [93, '        2'],
    [72, '     1'], [10, '0.0'], [20, '0.0'], [11, '10.0'], [21, '0.0'],
    [72, '     3'], [10, '10.0'], [20, '0.0'], [11, '5.0'], [21, '5.0'], [40, '0.5'], [50, '0.0'], [51, '90.0'],
  );

  it('isCopyable: 선 모서리·원호 모서리 경계는 복사할 수 있고, 타원호·혼합 경계는 여전히 못 한다', () => {
    expect(isCopyable(HATCH_LINE_EDGES)).toBe(true);
    expect(isCopyable(HATCH_ARC_EDGE)).toBe(true);
    expect(isCopyable(HATCH_ELLIPTIC_EDGE)).toBe(false);
    expect(isCopyable(HATCH_MIXED_EDGES)).toBe(false);
  });

  it('bounds: 선 모서리 경계의 경계상자는 세 모서리 점 + 패턴 기준점 + 씨앗점을 모두 감싼다', () => {
    // x: 0,10,10,10,10,0,5(패턴),5(씨앗) → 0..10 / y: 0,0,0,10,10,0,6,5 → 0..10
    expect(entityBoundsOf(HATCH_LINE_EDGES)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('translate: 선 모서리 경계는 고도 기준점을 빼고 세 모서리·패턴 기준점·씨앗점만 옮긴다', () => {
    const moved = translateEntityPairs(HATCH_LINE_EDGES, 1000, 0);
    // 10 등장 순서: [0]고도(그대로) [1]모서리1 시작 [2]모서리2 시작 [3]모서리3 시작 [4]씨앗점
    expect(moved.filter((p) => p.code === 10).map((p) => p.value)).toEqual([
      '0.0', '1000.0', '1010.0', '1010.0', '1005.0',
    ]);
    // 11 등장 순서: 모서리1·2·3의 끝점
    expect(moved.filter((p) => p.code === 11).map((p) => p.value)).toEqual(['1010.0', '1010.0', '1000.0']);
    expect(valueAt(moved, 43)).toBe('1005.0'); // 패턴 기준점(절대 점) 5 + 1000
    expect(valueAt(moved, 44)).toBe('6.0');
    expect(valueAt(moved, 45)).toBe('0.0'); // 패턴 오프셋(상대 벡터)은 이동에서 그대로
    expect(valueAt(moved, 46)).toBe('3.0');
  });

  it('translate: 원호 모서리 경계는 중심점만 옮기고 반지름·각도는 그대로다', () => {
    const moved = translateEntityPairs(HATCH_ARC_EDGE, 1000, 0);
    expect(moved.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['0.0', '1020.0', '1020.0']);
    expect(valueAt(moved, 40)).toBe('5.0'); // 반지름은 길이라 이동에서 그대로
    expect(valueAt(moved, 50)).toBe('0.0');
    expect(valueAt(moved, 51)).toBe('180.0');
  });

  it('transform: 선 모서리 경계는 배율 2·회전 90도에서 점은 변환되고 패턴 오프셋은 배율+회전이 걸린다', () => {
    const t: Transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: Math.PI / 2 };
    const out = transformEntityPairs(HATCH_LINE_EDGES, t);
    // 고도 기준점은 손대지 않는다.
    expect(valueAt(out, 10, 0)).toBe('0.0');
    expect(valueAt(out, 20, 0)).toBe('0.0');
    // 모서리2 끝점(10,10): sx=20,sy=20 → x=20cos90-20sin90≈-20, y=20sin90+20cos90≈20.
    expect(Number(valueAt(out, 11, 1))).toBeCloseTo(-20, 6);
    expect(Number(valueAt(out, 21, 1))).toBeCloseTo(20, 6);
    // 패턴 기준점(43,44)=(5,6, 절대 점): sx=10,sy=12 → x=10cos90-12sin90≈-12, y=10sin90+12cos90≈10.
    expect(Number(valueAt(out, 43))).toBeCloseTo(-12, 6);
    expect(Number(valueAt(out, 44))).toBeCloseTo(10, 6);
    // 패턴 오프셋(45,46)=(0,3, 상대 거리 벡터): 먼저 배율 → sx=0,sy=6 → x'≈-6, y'≈0.
    expect(Number(valueAt(out, 45))).toBeCloseTo(-6, 6);
    expect(Number(valueAt(out, 46))).toBeCloseTo(0, 6);
  });

  it('transform: 원호 모서리 경계는 중심이 변환되고 반지름에 배율이, 각도에 회전이 걸린다', () => {
    const t: Transform = { x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: Math.PI / 2 };
    const out = transformEntityPairs(HATCH_ARC_EDGE, t);
    // 중심(20,30): sx=40,sy=60 → x=40cos90-60sin90≈-60, y=40sin90+60cos90≈40.
    expect(Number(valueAt(out, 10, 1))).toBeCloseTo(-60, 6);
    expect(Number(valueAt(out, 20, 1))).toBeCloseTo(40, 6);
    expect(valueAt(out, 40)).toBe('10.0'); // 반지름 5 × 배율 2
    expect(valueAt(out, 50)).toBe('90.0'); // 시작각 0 + 회전 90
    expect(valueAt(out, 51)).toBe('270.0'); // 끝각 180 + 회전 90
  });

  it('copy: 선 모서리 경계의 연관 해치도 비연관으로 바뀌고 경계 원본 참조가 지워진다', () => {
    const copy = copyEntityPairs(HATCH_LINE_EDGES, new HandleAllocator(0x300), '1F');
    expect(valueAt(copy, 5)).toBe('300');
    expect(valueAt(copy, 71)).toBe('     0');
    expect(valueAt(copy, 97)).toBe('        0');
    expect(copy.filter((p) => p.code === 330).map((p) => p.value)).toEqual(['1F']); // 39AA가 사라졌다
    // 좌표는 손대지 않는다(옮기는 것은 호출부 몫)
    expect(copy.filter((p) => p.code === 10).map((p) => p.value)).toEqual(['0.0', '0.0', '10.0', '10.0', '5.0']);
  });

  it('copy: 원호 모서리 경계는 비연관이라 71·경계가 그대로고 핸들·소유자만 바뀐다', () => {
    const copy = copyEntityPairs(HATCH_ARC_EDGE, new HandleAllocator(0x300), '1F');
    expect(valueAt(copy, 5)).toBe('300');
    expect(valueAt(copy, 330)).toBe('1F');
    expect(valueAt(copy, 71)).toBe('     0'); // 원래부터 비연관 — 안 바뀐다
    expect(valueAt(copy, 10, 1)).toBe('20.0'); // 중심점은 그대로
    expect(valueAt(copy, 40)).toBe('5.0');
  });
});
