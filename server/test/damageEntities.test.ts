import { describe, expect, it, vi } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import {
  damageEntities,
  decorationCircles,
  dwgPointsOf,
  rebarSymbolSegments,
} from '../src/export/damageEntities.js';

// damageEntities.ts는 '../../public/viewer/damageTypes.js'(= server/public/viewer/damageTypes.js)를
// 읽는다. 알 수 없는 decoration.kind는 고정 유형 목록으로는 만들 수 없으므로, 이 파일에서만
// getDamageType을 가로채 그런 유형을 하나 흉내 낸다. 다른 id는 실제 구현으로 넘긴다.
vi.mock('../public/viewer/damageTypes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../public/viewer/damageTypes.js')>();
  return {
    ...actual,
    getDamageType: (id: unknown) =>
      id === 'unknown_decoration'
        ? {
            id: 'unknown_decoration',
            label: '테스트',
            kind: 'area',
            fill: null,
            decoration: { kind: 'triangle' },
            layer: '신규손상',
            colorIndex: 1,
            quantityUnit: 'm2',
          }
        : actual.getDamageType(id as string),
  };
});

type Pt = [number, number];

function damage(type: string, kind: 'polyline' | 'rect', dwg: Pt[] | null) {
  return {
    id: `d-${type}`,
    type,
    geometry: { kind, world: [[0, 0], [1, 1]] as Pt[], dwg },
  };
}

// 원점에서 시작하는 가로 3000 × 세로 1000 사각형
const RECT: Pt[] = [[0, 0], [3000, 0], [3000, 1000], [0, 1000]];

function entityTypes(pairs: DxfPair[]): string[] {
  return pairs.filter((p) => p.code === 0).map((p) => p.value);
}

function valuesOf(pairs: DxfPair[], code: number): string[] {
  return pairs.filter((p) => p.code === code).map((p) => p.value);
}

describe('dwgPointsOf', () => {
  it('점 배열을 그대로 준다', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', [[1, 2], [3, 4]]))).toEqual([[1, 2], [3, 4]]);
  });

  it('dwg가 null이면 null', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', null))).toBeNull();
  });

  it('점이 하나뿐이거나 숫자가 아니면 null', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', [[1, 2]]))).toBeNull();
    expect(dwgPointsOf({ geometry: { kind: 'polyline', dwg: [[1, 2], [Number.NaN, 4]] } })).toBeNull();
    expect(dwgPointsOf({ geometry: { kind: 'polyline', dwg: 'nope' } })).toBeNull();
    expect(dwgPointsOf(null)).toBeNull();
  });
});

describe('rebarSymbolSegments', () => {
  it('나란한 선 2개와 ✕ 4개, 모두 6개를 만든다', () => {
    expect(rebarSymbolSegments(RECT, 57.4, 212)).toHaveLength(6);
  });

  it('선은 긴 변 방향이고 간격 57.4를 두며 길이는 긴 변 − 212다', () => {
    const [first, second] = rebarSymbolSegments(RECT, 57.4, 212);
    // 사각형 중심 (1500, 500), 긴 변은 x 방향(3000), 선 길이 3000 - 212 = 2788
    expect(first[0][0]).toBeCloseTo(1500 - 1394, 6);
    expect(first[1][0]).toBeCloseTo(1500 + 1394, 6);
    expect(Math.abs(first[0][1] - second[0][1])).toBeCloseTo(57.4, 6);
    expect((first[0][1] + second[0][1]) / 2).toBeCloseTo(500, 6);
  });

  it('✕는 212×212이고 중심이 선 끝에 있다', () => {
    const crosses = rebarSymbolSegments(RECT, 57.4, 212).slice(2);
    expect(crosses).toHaveLength(4);
    for (const [a, b] of crosses) {
      expect(Math.abs(a[0] - b[0])).toBeCloseTo(212, 6);
      expect(Math.abs(a[1] - b[1])).toBeCloseTo(212, 6);
    }
    // 두 ✕의 중심은 x = 1500 ± 1394
    const centers = [0, 2].map((i) => (crosses[i][0][0] + crosses[i][1][0]) / 2);
    expect(centers[0]).toBeCloseTo(106, 6);
    expect(centers[1]).toBeCloseTo(2894, 6);
  });

  it('세로로 긴 사각형은 세로 방향으로 그린다', () => {
    const tall: Pt[] = [[0, 0], [1000, 0], [1000, 3000], [0, 3000]];
    const [first, second] = rebarSymbolSegments(tall, 57.4, 212);
    expect(first[0][1]).toBeCloseTo(1500 - 1394, 6);
    expect(Math.abs(first[0][0] - second[0][0])).toBeCloseTo(57.4, 6);
  });

  it('긴 변이 ✕ 크기 이하면 기호를 그리지 않는다', () => {
    const tiny: Pt[] = [[0, 0], [200, 0], [200, 100], [0, 100]];
    expect(rebarSymbolSegments(tiny, 57.4, 212)).toEqual([]);
  });
});

describe('decorationCircles', () => {
  it('간격의 절반에서 시작해 간격마다 놓는다', () => {
    const circles = decorationCircles([[0, 0], [500, 0]], 54.4, 158, 77);
    expect(circles.map((c) => c.center[0])).toEqual([79, 237, 395]);
    expect(circles[0].radius).toBeCloseTo(27.2, 6);
  });

  it('위·아래를 번갈아 둔다', () => {
    const circles = decorationCircles([[0, 0], [500, 0]], 54.4, 158, 77);
    expect(circles.map((c) => c.center[1])).toEqual([77, -77, 77]);
  });

  it('선이 간격의 절반보다 짧으면 원이 없다', () => {
    expect(decorationCircles([[0, 0], [50, 0]], 54.4, 158, 77)).toEqual([]);
  });

  it('꺾인 선에서도 그 구간의 법선 방향으로 놓는다', () => {
    // 아래로 내려가는 선: 방향 (0,-1), 법선 (1, 0)
    const circles = decorationCircles([[0, 0], [0, -500]], 54.4, 158, 77);
    expect(circles[0].center[0]).toBeCloseTo(77, 6);
    expect(circles[0].center[1]).toBeCloseTo(-79, 6);
  });

  it('아주 긴 선에서도 1000개를 넘지 않는다', () => {
    expect(decorationCircles([[0, 0], [1_000_000, 0]], 54.4, 158, 77)).toHaveLength(1000);
  });

  // R17(minor): 상한에서 잘리면 info.truncated로 알린다(반환 배열 모양은 그대로).
  it('상한에서 잘리면 info.truncated를 true로 남긴다', () => {
    const info = { truncated: false };
    decorationCircles([[0, 0], [1_000_000, 0]], 54.4, 158, 77, info);
    expect(info.truncated).toBe(true);
  });

  it('안 잘리면 info.truncated는 false로 남는다', () => {
    const info = { truncated: false };
    decorationCircles([[0, 0], [500, 0]], 54.4, 158, 77, info);
    expect(info.truncated).toBe(false);
  });
});

describe('damageEntities', () => {
  const owner = '1F';

  it('균열은 열린 폴리라인 하나다', () => {
    const pairs = damageEntities(damage('crack', 'polyline', [[0, 0], [100, 100]]), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE']);
    expect(valuesOf(pairs, 70)).toEqual(['     0']);
    expect(valuesOf(pairs, 8)).toEqual(['신규손상']);
  });

  it('박락은 닫힌 폴리라인과 ANSI37 해치다', () => {
    const pairs = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'HATCH']);
    expect(valuesOf(pairs, 2)).toEqual(['ANSI37']);
    expect(valuesOf(pairs, 41)).toEqual(['60.0']);
  });

  it('망상균열은 ANCHORLK, 파손은 ANSI33을 쓴다', () => {
    const anchor = damageEntities(damage('map_crack', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(valuesOf(anchor, 2)).toEqual(['ANCHORLK']);
    const breakage = damageEntities(damage('breakage', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(valuesOf(breakage, 2)).toEqual(['ANSI33']);
  });

  it('철근노출은 닫힌 폴리라인과 선 6개다 (해치 없음)', () => {
    const pairs = damageEntities(damage('rebar_exposure', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE']);
  });

  it('균열/백태는 열린 폴리라인과 원들이다', () => {
    const pairs = damageEntities(
      damage('crack_efflorescence', 'polyline', [[0, 0], [500, 0]]),
      new HandleAllocator(0x100),
      owner,
    );
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'CIRCLE', 'CIRCLE', 'CIRCLE']);
  });

  it('핸들을 엔티티마다 하나씩 새로 받는다', () => {
    const alloc = new HandleAllocator(0x100);
    const pairs = damageEntities(damage('spalling', 'rect', RECT), alloc, owner);
    expect(valuesOf(pairs, 5)).toEqual(['100', '101']);
    expect(alloc.seed).toBe('102');
  });

  it('dwg가 없으면 아무것도 만들지 않는다', () => {
    expect(damageEntities(damage('crack', 'polyline', null), new HandleAllocator(0x100), owner)).toEqual([]);
  });

  // R17(minor): 균열/백태 원이 1000개에서 잘리면 warnings.circlesTruncated로 알린다.
  it('원이 1000개에서 잘리면 warnings.circlesTruncated를 true로 남긴다', () => {
    const warnings = { circlesTruncated: false };
    damageEntities(
      damage('crack_efflorescence', 'polyline', [[0, 0], [1_000_000, 0]]),
      new HandleAllocator(0x100),
      owner,
      warnings,
    );
    expect(warnings.circlesTruncated).toBe(true);
  });

  it('짧은 선은 warnings.circlesTruncated를 건드리지 않는다', () => {
    const warnings = { circlesTruncated: false };
    damageEntities(
      damage('crack_efflorescence', 'polyline', [[0, 0], [500, 0]]),
      new HandleAllocator(0x100),
      owner,
      warnings,
    );
    expect(warnings.circlesTruncated).toBe(false);
  });

  it('유형 목록에 없는 type도 테두리는 그린다', () => {
    const pairs = damageEntities(damage('없는유형', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE']);
    expect(valuesOf(pairs, 70)).toEqual(['     1']);
  });

  // R17: rebar·circles가 아닌 decoration.kind가 들어오면(새 유형 추가 등) 캐스팅이 조용히
  // 기호를 빼먹지 않도록 경고를 남긴다.
  it('알 수 없는 decoration.kind는 경고를 남기고 테두리만 그린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pairs = damageEntities(damage('unknown_decoration', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('triangle');
    warn.mockRestore();
  });
});
