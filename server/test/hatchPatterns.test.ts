import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import { HATCH_PATTERNS, hatchPatternFor } from '../src/export/hatchPatterns.js';

describe('HATCH_PATTERNS', () => {
  it('손상 유형이 쓰는 여섯 무늬를 모두 담는다', () => {
    expect(Object.keys(HATCH_PATTERNS).sort()).toEqual(
      ['ANCHORLK', 'ANSI31', 'ANSI33', 'ANSI37', 'CORK', 'TRIANG'].sort(),
    );
  });

  it('유형 정의가 쓰는 무늬와 축척이 모두 정의에 있다', () => {
    for (const type of DAMAGE_TYPES) {
      if (!type.fill) continue;
      const pattern = hatchPatternFor(type.fill.pattern, type.fill.scale);
      expect(pattern, `${type.id}의 ${type.fill.pattern}`).not.toBeNull();
      expect(pattern!.scale).toBe(type.fill.scale);
    }
  });

  it('선 개수와 이름이 exam.dxf 실측과 같다', () => {
    expect(HATCH_PATTERNS.ANSI31.lines).toHaveLength(1);
    expect(HATCH_PATTERNS.ANSI33.lines).toHaveLength(2);
    expect(HATCH_PATTERNS.ANSI37.lines).toHaveLength(2);
    expect(HATCH_PATTERNS.CORK.lines).toHaveLength(4);
    expect(HATCH_PATTERNS.TRIANG.lines).toHaveLength(3);
    expect(HATCH_PATTERNS.ANCHORLK.lines).toHaveLength(4);
    expect(HATCH_PATTERNS.ANSI31.name).toBe('ANSI31');
  });

  it('ANSI31은 45도 한 줄, 간격은 3.175 × 50 = 158.75를 45도로 나눈 성분이다', () => {
    const [line] = HATCH_PATTERNS.ANSI31.lines;
    expect(line.angle).toBe(45);
    expect(line.baseX).toBe(0);
    expect(line.baseY).toBe(0);
    expect(Math.hypot(line.offsetX, line.offsetY)).toBeCloseTo(158.75, 6);
    expect(line.dashes).toEqual([]);
  });

  it('ANCHORLK는 부록 A의 네 줄을 그대로 담는다', () => {
    const angles = HATCH_PATTERNS.ANCHORLK.lines.map((l) => l.angle);
    expect(angles).toEqual([18.435, 333.435, 63.435, 108.435]);
    expect(HATCH_PATTERNS.ANCHORLK.lines[0].dashes).toEqual([125, -500]);
    expect(HATCH_PATTERNS.ANCHORLK.lines[1].dashes).toEqual([88.3883475, -353.5533905]);
  });

  it('첫 줄의 기준점은 항상 원점이거나 부록 A 값이다', () => {
    for (const name of ['ANSI31', 'ANSI33', 'ANSI37', 'CORK', 'TRIANG']) {
      expect(HATCH_PATTERNS[name].lines[0].baseX, name).toBe(0);
      expect(HATCH_PATTERNS[name].lines[0].baseY, name).toBe(0);
    }
  });

  it('ANSI33의 둘째 줄은 첫 줄에서 224.5065 떨어져 있고 점선이다', () => {
    const [, second] = HATCH_PATTERNS.ANSI33.lines;
    expect(second.baseX).toBeCloseTo(224.5065, 6);
    expect(second.baseY).toBe(0);
    expect(second.dashes).toEqual([158.75, -79.375]);
  });
});

describe('hatchPatternFor', () => {
  it('모르는 이름은 null', () => {
    expect(hatchPatternFor('NOPE', 50)).toBeNull();
  });

  it('정의와 같은 축척이면 정의를 그대로 준다', () => {
    expect(hatchPatternFor('ANSI31', 50)).toBe(HATCH_PATTERNS.ANSI31);
  });

  it('축척이 다르면 기준점·간격·점선에 비율을 곱하고 각도는 그대로 둔다', () => {
    const scaled = hatchPatternFor('ANSI33', 100)!;
    expect(scaled.scale).toBe(100);
    expect(scaled.lines[0].angle).toBe(45);
    expect(scaled.lines[1].baseX).toBeCloseTo(449.013, 3);
    expect(scaled.lines[1].dashes).toEqual([317.5, -158.75]);
    // 원본은 그대로다
    expect(HATCH_PATTERNS.ANSI33.lines[1].dashes).toEqual([158.75, -79.375]);
  });
});
