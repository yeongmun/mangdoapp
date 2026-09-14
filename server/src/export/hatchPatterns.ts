// 해치 패턴 선 정의. DXF의 HATCH는 무늬 이름만으로는 부족하고 이 정의를 엔티티 안에 담아야
// 받는 쪽에 .pat 파일이 없어도 같은 무늬로 그려진다.
//
// 값의 출처: 사내 망도 docs/exam.dxf 범례의 해치 엔티티(코드 53/43/44/45/46/79/49)를 그대로
// 읽은 것이며, 유형별 축척이 이미 반영돼 있다. 기준점(43/44)만 원본이 아주 큰 절대값이라
// 첫 줄의 기준점을 0으로 옮겨 선 사이 상대 간격만 남겼다 — 무늬는 무한히 반복되므로
// 기준점의 절대 위치는 화면에 보이지 않는다. ANCHORLK는 원본 값이 이미 작아 그대로 둔다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5장,
//       docs/superpowers/specs/2026-09-12-damage-types-design.md 2장·부록 A

export interface HatchPatternLine {
  /** 코드 53. 도 단위 */
  angle: number;
  /** 코드 43 */
  baseX: number;
  /** 코드 44 */
  baseY: number;
  /** 코드 45 */
  offsetX: number;
  /** 코드 46 */
  offsetY: number;
  /** 코드 49. 비어 있으면 실선(코드 79 = 0) */
  dashes: number[];
}

export interface HatchPattern {
  name: string;
  /** 코드 41. 아래 선 정의가 이미 이 축척으로 계산돼 있다 */
  scale: number;
  /** 코드 52 */
  angle: number;
  lines: HatchPatternLine[];
}

export const HATCH_PATTERNS: Readonly<Record<string, HatchPattern>> = {
  ANSI31: {
    name: 'ANSI31',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -112.2532015133644, offsetY: 112.2532015133644, dashes: [] },
    ],
  },
  ANSI33: {
    name: 'ANSI33',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -224.5064030267288, offsetY: 224.5064030267288, dashes: [] },
      { angle: 45, baseX: 224.5065, baseY: 0, offsetX: -224.5064030267288, offsetY: 224.5064030267288, dashes: [158.75, -79.375] },
    ],
  },
  ANSI37: {
    name: 'ANSI37',
    scale: 60,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -134.7038418160373, offsetY: 134.7038418160373, dashes: [] },
      { angle: 135, baseX: 0, baseY: 0, offsetX: -134.7038418160373, offsetY: -134.7038418160373, dashes: [] },
    ],
  },
  CORK: {
    name: 'CORK',
    scale: 35,
    angle: 0,
    lines: [
      { angle: 0, baseX: 0, baseY: 0, offsetX: 0, offsetY: 111.125, dashes: [] },
      { angle: 135, baseX: 55.5625, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
      { angle: 135, baseX: 83.34375, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
      { angle: 135, baseX: 111.125, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
    ],
  },
  TRIANG: {
    name: 'TRIANG',
    scale: 25,
    angle: 0,
    lines: [
      { angle: 60, baseX: 0, baseY: 0, offsetX: -119.0624573255854, offsetY: 206.2222746380848, dashes: [119.0625, -119.0625] },
      { angle: 120, baseX: 0, baseY: 0, offsetX: -238.1249573255855, offsetY: 0.0000246380847909, dashes: [119.0625, -119.0625] },
      { angle: 0, baseX: -59.53125, baseY: 103.11125, offsetX: 119.0625, offsetY: 206.22225, dashes: [119.0625, -119.0625] },
    ],
  },
  ANCHORLK: {
    name: 'ANCHORLK',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 18.435, baseX: -59.2926885, baseY: -19.7642885, offsetX: 395.2845309850569, offsetY: 197.6427068321105, dashes: [125, -500] },
      { angle: 333.435, baseX: -138.3494895, baseY: -177.878241, offsetX: 197.6423532051874, offsetY: 0.0001772066524852, dashes: [88.3883475, -353.5533905] },
      { angle: 63.435, baseX: -19.7644645, baseY: 256.9350425, offsetX: -0.0001763122260967, offsetY: 197.6423538760085, dashes: [88.3883475, -353.5533905] },
      { angle: 108.435, baseX: 19.7639355, baseY: 138.3496655, offsetX: -0.0001765358328187, offsetY: 197.6423537604449, dashes: [125, -500] },
    ],
  },
};

// 정의된 축척과 다른 축척을 쓰려면 기준점·간격·점선 길이에 비율을 곱한다(부록 A).
// 각도는 축척과 무관하다.
export function hatchPatternFor(name: string, scale: number): HatchPattern | null {
  const base = HATCH_PATTERNS[name];
  if (!base) return null;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (scale === base.scale) return base;
  const k = scale / base.scale;
  return {
    name: base.name,
    scale,
    angle: base.angle,
    lines: base.lines.map((line) => ({
      angle: line.angle,
      baseX: line.baseX * k,
      baseY: line.baseY * k,
      offsetX: line.offsetX * k,
      offsetY: line.offsetY * k,
      dashes: line.dashes.map((d) => d * k),
    })),
  };
}
