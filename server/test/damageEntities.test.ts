import { describe, expect, it, vi } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import {
  damageEntities,
  decorationCircles,
  dwgPointsOf,
  dwgShapesOf,
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

describe('dwgShapesOf', () => {
  const COPY: Pt[] = [[20, 0], [30, 0], [30, 5], [20, 5]];

  it('첫 도형과 복제본을 도형 번호 순서대로 돌려준다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', RECT), copies: [{ world: COPY, dwg: COPY }] })).toEqual([RECT, COPY]);
  });

  it('좌표가 없는 도형은 번호 자리를 지키며 null이다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', null), copies: [{ world: COPY, dwg: COPY }] })).toEqual([null, COPY]);
  });

  it('복제본이 없으면 첫 도형 하나뿐이다', () => {
    expect(dwgShapesOf({ ...damage('spalling', 'rect', RECT), copies: [] })).toEqual([RECT]);
    // copies가 아예 없는 옛 객체도 첫 도형 하나로 본다
    expect(dwgShapesOf(damage('spalling', 'rect', RECT))).toEqual([RECT]);
  });
});

describe('rebarSymbolSegments — 범례 길이 상한(crossGapMm)', () => {
  it('사각형이 커도 선 길이는 ✕ 중심 간격 1009를 넘지 않고 가운데에 놓인다', () => {
    const [first, second, ...crosses] = rebarSymbolSegments(RECT, 57.4, 212, 1009);
    // 선은 ✕ 대각선과 만나는 u = ±(504.5 − 28.7) = ±475.8까지, 중심 x = 1500
    expect(first[0][0]).toBeCloseTo(1500 - 475.8, 6);
    expect(first[1][0]).toBeCloseTo(1500 + 475.8, 6);
    expect(second[0][0]).toBeCloseTo(1500 - 475.8, 6);
    // ✕ 중심은 x = 1500 ± 504.5
    const centers = [0, 2].map((i) => (crosses[i][0][0] + crosses[i][1][0]) / 2);
    expect(centers[0]).toBeCloseTo(995.5, 6);
    expect(centers[1]).toBeCloseTo(2004.5, 6);
  });

  it('사각형이 범례보다 작으면 지금처럼 사각형에 맞춰 줄어든다', () => {
    const small: Pt[] = [[0, 0], [800, 0], [800, 400], [0, 400]];
    const [first] = rebarSymbolSegments(small, 57.4, 212, 1009);
    // 긴 변 800 − 212 = 588 < 1009 → half = 294, 선 끝 = 294 − 28.7 = 265.3
    expect(first[1][0]).toBeCloseTo(400 + 265.3, 6);
  });

  it('crossGapMm을 주지 않으면 예전과 같다', () => {
    const withCap = rebarSymbolSegments(RECT, 57.4, 212);
    expect(withCap[0][1][0]).toBeCloseTo(1500 + 1365.3, 6);
  });
});

describe('rebarSymbolSegments', () => {
  it('나란한 선 2개와 ✕ 4개, 모두 6개를 만든다', () => {
    expect(rebarSymbolSegments(RECT, 57.4, 212)).toHaveLength(6);
  });

  it('선은 긴 변 방향이고 간격 57.4를 두며 ✕의 대각선과 만나는 곳에서 끝난다', () => {
    const [first, second] = rebarSymbolSegments(RECT, 57.4, 212);
    // 사각형 중심 (1500, 500), 긴 변은 x 방향(3000). ✕ 중심은 x = 1500 ± 1394.
    // 선은 v = ±28.7에서 ✕ 대각선(기울기 1)과 만나는 u = ±(1394 − 28.7) = ±1365.3까지.
    expect(first[0][0]).toBeCloseTo(1500 - 1365.3, 6);
    expect(first[1][0]).toBeCloseTo(1500 + 1365.3, 6);
    expect(Math.abs(first[0][1] - second[0][1])).toBeCloseTo(57.4, 6);
    expect((first[0][1] + second[0][1]) / 2).toBeCloseTo(500, 6);
  });

  it('✕는 212×212이고 중심이 사각형 끝에서 106 안쪽에 있어 밖으로 나가지 않는다', () => {
    const crosses = rebarSymbolSegments(RECT, 57.4, 212).slice(2);
    expect(crosses).toHaveLength(4);
    for (const [a, b] of crosses) {
      expect(Math.abs(a[0] - b[0])).toBeCloseTo(212, 6);
      expect(Math.abs(a[1] - b[1])).toBeCloseTo(212, 6);
    }
    // 두 ✕의 중심은 x = 1500 ± 1394 → 바깥 끝은 x = 0, 3000 (사각형 끝과 일치)
    const centers = [0, 2].map((i) => (crosses[i][0][0] + crosses[i][1][0]) / 2);
    expect(centers[0]).toBeCloseTo(106, 6);
    expect(centers[1]).toBeCloseTo(2894, 6);
  });

  it('짧은 변이 212보다 좁으면 ✕를 짧은 변에 맞춰 줄여 사각형 밖으로 나가지 않는다', () => {
    // 짧은 변 150 → ✕ 150×150, y는 425..575 안
    const thin: Pt[] = [[0, 0], [3000, 0], [3000, 150], [0, 150]];
    const segments = rebarSymbolSegments(thin, 57.4, 212);
    for (const [a, b] of segments.slice(2)) {
      expect(Math.abs(a[0] - b[0])).toBeCloseTo(150, 6);
      expect(Math.min(a[1], b[1])).toBeGreaterThanOrEqual(0);
      expect(Math.max(a[1], b[1])).toBeLessThanOrEqual(150);
    }
    // 선은 여전히 대각선과 만나는 곳(half − 28.7)에서 끝난다: half = (3000 − 212) / 2 = 1394
    expect(segments[0][1][0]).toBeCloseTo(1500 + 1394 - 28.7, 6);
  });

  it('세로로 긴 사각형은 세로 방향으로 그린다', () => {
    const tall: Pt[] = [[0, 0], [1000, 0], [1000, 3000], [0, 3000]];
    const [first, second] = rebarSymbolSegments(tall, 57.4, 212);
    expect(first[0][1]).toBeCloseTo(1500 - 1365.3, 6);
    expect(Math.abs(first[0][0] - second[0][0])).toBeCloseTo(57.4, 6);
  });

  it('짧은 변이 선 간격(57.4)보다 좁으면 기호를 그리지 않는다', () => {
    const sliver: Pt[] = [[0, 0], [3000, 0], [3000, 50], [0, 50]];
    expect(rebarSymbolSegments(sliver, 57.4, 212)).toEqual([]);
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

  describe('damageEntities(shapePoints)', () => {
    it('점 목록을 주면 그 자리에 그린다', () => {
      const moved = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner, undefined, [
        [20, 0], [30, 0], [30, 5], [20, 5],
      ]);
      // LWPOLYLINE 첫 꼭짓점(코드 10)이 옮긴 자리다
      expect(moved.find((p) => p.code === 10)!.value).toBe('20.0');
    });

    it('점 목록을 주지 않으면 지금처럼 첫 도형을 쓴다', () => {
      const first = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner);
      expect(first.find((p) => p.code === 10)!.value).toBe(`${RECT[0][0]}.0`);
    });
  });
});
