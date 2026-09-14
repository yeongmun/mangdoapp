import { describe, expect, it } from 'vitest';
import type { DxfPair } from '../src/export/dxfDocument.js';
import { DAMAGE_COLOR, DAMAGE_LAYER } from '../src/export/dxfDocument.js';
import {
  circleEntity,
  hatchEntity,
  lineEntity,
  lwPolylineEntity,
  textEntity,
  type EntityBase,
} from '../src/export/dxfEntities.js';
import { HATCH_PATTERNS } from '../src/export/hatchPatterns.js';

const base: EntityBase = { handle: '2A0', owner: '1F', layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };

function codes(pairs: DxfPair[]): number[] {
  return pairs.map((p) => p.code);
}

function valueOf(pairs: DxfPair[], code: number): string | undefined {
  return pairs.find((p) => p.code === code)?.value;
}

function valuesOf(pairs: DxfPair[], code: number): string[] {
  return pairs.filter((p) => p.code === code).map((p) => p.value);
}

describe('공통 머리', () => {
  it('모든 엔티티가 핸들·소유자·레이어·색을 갖는다', () => {
    for (const pairs of [
      lwPolylineEntity(base, [[0, 0], [1, 1]], false),
      circleEntity(base, [0, 0], 1),
      lineEntity(base, [0, 0], [1, 1]),
      textEntity(base, [0, 0], 300, '가', 'center'),
      hatchEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], HATCH_PATTERNS.ANSI31),
    ]) {
      expect(pairs[0]).toMatchObject({ code: 0 });
      expect(valueOf(pairs, 5)).toBe('2A0');
      expect(valueOf(pairs, 330)).toBe('1F');
      expect(valueOf(pairs, 8)).toBe(DAMAGE_LAYER);
      expect(valueOf(pairs, 62)).toBe('     1');
    }
  });
});

describe('lwPolylineEntity', () => {
  it('열린 폴리라인은 70=0이고 꼭짓점 수를 적는다', () => {
    const pairs = lwPolylineEntity(base, [[0, 0], [10, 20], [30, 40]], false);
    expect(pairs[0].value).toBe('LWPOLYLINE');
    expect(valueOf(pairs, 90)).toBe('        3'); // 32비트 코드는 9칸 채움
    expect(valueOf(pairs, 70)).toBe('     0');
    expect(valuesOf(pairs, 10)).toEqual(['0.0', '10.0', '30.0']);
    expect(valuesOf(pairs, 20)).toEqual(['0.0', '20.0', '40.0']);
    expect(codes(pairs).filter((c) => c === 100)).toHaveLength(2);
  });

  it('닫힌 폴리라인은 70=1이고 첫 점을 되풀이하지 않는다', () => {
    const pairs = lwPolylineEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
    expect(valueOf(pairs, 70)).toBe('     1');
    expect(valueOf(pairs, 90)).toBe('        4');
    expect(valuesOf(pairs, 10)).toHaveLength(4);
  });

  it('점이 둘 미만이면 던진다', () => {
    expect(() => lwPolylineEntity(base, [[0, 0]], false)).toThrow(/점이 둘 이상/);
  });
});

describe('circleEntity / lineEntity', () => {
  it('원은 중심과 반지름을 적는다', () => {
    const pairs = circleEntity(base, [100, -200], 27.2);
    expect(pairs[0].value).toBe('CIRCLE');
    expect(valueOf(pairs, 10)).toBe('100.0');
    expect(valueOf(pairs, 20)).toBe('-200.0');
    expect(valueOf(pairs, 40)).toBe('27.2');
  });

  it('선은 두 끝점을 적는다', () => {
    const pairs = lineEntity(base, [0, 0], [212, -212]);
    expect(pairs[0].value).toBe('LINE');
    expect(valueOf(pairs, 10)).toBe('0.0');
    expect(valueOf(pairs, 11)).toBe('212.0');
    expect(valueOf(pairs, 21)).toBe('-212.0');
    expect(valueOf(pairs, 31)).toBe('0.0');
  });
});

describe('textEntity', () => {
  it('가운데 정렬은 72=1, 73=2이고 정렬점에 위치를 넣는다', () => {
    const pairs = textEntity(base, [500, 900], 300, '균열', 'center');
    expect(pairs[0].value).toBe('TEXT');
    expect(valueOf(pairs, 40)).toBe('300.0');
    expect(valueOf(pairs, 1)).toBe('균열');
    expect(valueOf(pairs, 72)).toBe('     1');
    expect(valueOf(pairs, 73)).toBe('     2');
    expect(valueOf(pairs, 11)).toBe('500.0');
    expect(valueOf(pairs, 21)).toBe('900.0');
    // 10/20에도 같은 점을 넣어 둔다 (72·73을 무시하는 오래된 읽기 구현 대비)
    expect(valueOf(pairs, 10)).toBe('500.0');
    expect(valueOf(pairs, 20)).toBe('900.0');
    // 73은 두 번째 AcDbText 다음에 온다
    const marks = pairs.map((p, i) => (p.code === 100 && p.value === 'AcDbText' ? i : -1)).filter((i) => i >= 0);
    expect(marks).toHaveLength(2);
    expect(pairs.findIndex((p) => p.code === 73)).toBeGreaterThan(marks[1]);
  });

  it('왼쪽 정렬은 72=0', () => {
    expect(valueOf(textEntity(base, [0, 0], 300, 'a', 'left'), 72)).toBe('     0');
  });

  it('글꼴 스타일(코드 7)은 쓰지 않는다 — Standard', () => {
    expect(codes(textEntity(base, [0, 0], 300, 'a', 'center'))).not.toContain(7);
  });
});

describe('hatchEntity', () => {
  it('비연관 해치에 패턴 선 정의를 담는다', () => {
    const boundary: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const pairs = hatchEntity(base, boundary, HATCH_PATTERNS.ANSI33);

    expect(pairs[0].value).toBe('HATCH');
    expect(valueOf(pairs, 2)).toBe('ANSI33');
    expect(valueOf(pairs, 70)).toBe('     0'); // 단색 채우기 아님
    expect(valueOf(pairs, 71)).toBe('     0'); // 비연관
    expect(valueOf(pairs, 91)).toBe('        1'); // 경계 1개
    expect(valueOf(pairs, 92)).toBe('        7');
    expect(valueOf(pairs, 73)).toBe('     1'); // 닫힌 경계
    // 경계는 첫 점을 되풀이해 5개로 적는다 (AutoCAD가 내보낸 형식과 같게)
    expect(valueOf(pairs, 93)).toBe('        5');
    // 코드 10은 [높이 기준점, 경계 4점, 되풀이한 첫 점, 시드점] 순서다
    expect(valuesOf(pairs, 10).slice(1, -1)).toEqual(['0.0', '100.0', '100.0', '0.0', '0.0']);
    expect(valueOf(pairs, 97)).toBe('        0'); // 경계 원본 객체 없음
    expect(valueOf(pairs, 41)).toBe('50.0'); // 축척
    expect(valueOf(pairs, 52)).toBe('0.0'); // 각도
    expect(valueOf(pairs, 78)).toBe('     2'); // 패턴 선 2개
    expect(valuesOf(pairs, 53)).toEqual(['45.0', '45.0']);
    expect(valuesOf(pairs, 79)).toEqual(['     0', '     2']);
    expect(valuesOf(pairs, 49)).toEqual(['158.75', '-79.375']);
    // 시드점은 경계의 무게중심
    expect(valuesOf(pairs, 10).at(-1)).toBe('50.0');
    expect(valuesOf(pairs, 20).at(-1)).toBe('25.0');
  });

  it('점선이 없는 패턴은 49를 쓰지 않는다', () => {
    const pairs = hatchEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], HATCH_PATTERNS.ANSI31);
    expect(valuesOf(pairs, 49)).toEqual([]);
    expect(valuesOf(pairs, 79)).toEqual(['     0']);
  });

  it('경계가 셋 미만이면 던진다', () => {
    expect(() => hatchEntity(base, [[0, 0], [1, 1]], HATCH_PATTERNS.ANSI31)).toThrow(/점이 셋 이상/);
  });
});
