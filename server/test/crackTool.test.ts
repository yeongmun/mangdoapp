import { describe, expect, it } from 'vitest';
import { polylineLength } from '../public/viewer/geometry.js';
import {
  DUPLICATE_OFFSET_FACTOR,
  finalizeRect,
  finalizeStroke,
  hitHandle,
  hitSelectedShape,
  MIN_RECT_PX,
  MIN_STROKE_PX,
  offsetShape,
  pickDamage,
} from '../public/viewer/crackTool.js';
import { validateDamageDoc } from '../public/viewer/damageDoc.js';

type Pt = [number, number];

// 화면 10px = world 1, y축 반전. DWG = world + (1000, 2000)
const mapper = {
  clientToWorld: (x: number, y: number): Pt => [x / 10, -y / 10],
  worldToClient: ([x, y]: Pt): Pt => [x * 10, -y * 10],
  worldToDwg: ([x, y]: Pt): Pt => [x + 1000, y + 2000],
};

const options = { now: '2026-09-12T03:00:00.000Z', newId: () => 'new-id', typeId: 'crack' };
const areaOptions = { ...options, typeId: 'spalling' };

describe('finalizeStroke', () => {
  it('화면 길이가 10px 미만이면 버린다', () => {
    expect(MIN_STROKE_PX).toBe(10);
    expect(finalizeStroke([[0, 50], [9, 50]], mapper, options)).toBeNull();
    expect(finalizeStroke([[0, 50]], mapper, options)).toBeNull();
  });

  it('제자리에서 떨린 획은 단순화 후 길이가 10px 미만이면 버린다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i < 120; i++) stroke.push([100 + (i / 119) * 4, 100 + (i % 2 === 0 ? 0.3 : -0.3)]);
    expect(polylineLength(stroke)).toBeGreaterThan(MIN_STROKE_PX);
    expect(finalizeStroke(stroke, mapper, options)).toBeNull();
  });

  it('선형 손상을 v5 형태로 만든다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    expect(finalizeStroke(stroke, mapper, options)).toEqual({
      id: 'new-id',
      type: 'crack',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: { kind: 'polyline', world: [[0, -5], [10, -5]], dwg: [[1000, 1995], [1010, 1995]] },
      copies: [],
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: 10, areaDwg: null },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    });
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeStroke([[0, 50], [100, 50]], noDwg, options);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });

  it('면형 유형으로는 만들지 않는다', () => {
    expect(finalizeStroke([[0, 50], [100, 50]], mapper, areaOptions)).toBeNull();
  });
});

describe('finalizeRect — 철근노출은 범례 크기로 고정', () => {
  // 시험용 mapper: world 1 = 10px, worldToDwg는 평행이동이라 world 1 = 1mm → 1px = 0.1mm.
  const rebarOptions = { ...options, typeId: 'rebar_exposure' };

  it('가로로 드래그하면 중심을 지키고 가로 1341 × 세로 332(mm)로 맞춘다', () => {
    // 긴 변 = 1009 + 212 + 60×2 = 1341, 짧은 변 = 212 + 60×2 = 332. 드래그 (0,0)-(20,10)의 중심은 (10,5)px
    // = world (1, -0.5). 반폭 670.5, 반높이 166.
    const damage = finalizeRect([0, 0], [20, 10], mapper, rebarOptions)!;
    expect(damage.geometry.world).toEqual([
      [1 - 670.5, -0.5 + 166],
      [1 + 670.5, -0.5 + 166],
      [1 + 670.5, -0.5 - 166],
      [1 - 670.5, -0.5 - 166],
    ]);
    expect(damage.geometry.dwg![0]).toEqual([1000 + 1 - 670.5, 2000 - 0.5 + 166]);
  });

  it('세로로 드래그하면 긴 변이 세로다', () => {
    const damage = finalizeRect([0, 0], [10, 20], mapper, rebarOptions)!;
    const xs = damage.geometry.world.map((p: Pt) => p[0]);
    const ys = damage.geometry.world.map((p: Pt) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(332, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1341, 6);
  });

  it('도면 좌표 변환이 없는 도면은 그린 크기 그대로다', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeRect([0, 0], [20, 10], noDwg, rebarOptions)!;
    expect(damage.geometry.world).toEqual([[0, 0], [2, 0], [2, -1], [0, -1]]);
  });

  it('다른 면형 유형은 그린 크기 그대로다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, areaOptions)!.geometry.world).toEqual([[0, 0], [2, 0], [2, -1], [0, -1]]);
  });
});

describe('finalizeRect', () => {
  it('드래그한 두 점으로 네 꼭짓점 사각형을 만든다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, areaOptions)).toEqual({
      id: 'new-id',
      type: 'spalling',
      createdAt: '2026-09-12T03:00:00.000Z',
      geometry: {
        kind: 'rect',
        world: [[0, 0], [2, 0], [2, -1], [0, -1]],
        dwg: [[1000, 2000], [1002, 2000], [1002, 1999], [1000, 1999]],
      },
      copies: [],
      measured: { width: null, length: null, count: null },
      computed: { lengthDwg: null, areaDwg: 2 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    });
  });

  it('너무 작은 사각형은 버린다', () => {
    expect(MIN_RECT_PX).toBe(10);
    expect(finalizeRect([0, 0], [9, 9], mapper, areaOptions)).toBeNull();
  });

  it('한 축만 최소 크기를 넘는 사각형(선에 가까운 드래그)도 버린다', () => {
    // 가로만 300px, 세로는 1px — 예전에는 둘 다 미달일 때만 버렸으므로 이런 드래그가 통과됐다.
    // 세로 폭이 0에 가까우면 resizeRect의 기저 벡터가 무너져 다시 키울 수도 없는 사각형이 남는다.
    expect(finalizeRect([0, 0], [300, 1], mapper, areaOptions)).toBeNull();
    expect(finalizeRect([0, 0], [1, 300], mapper, areaOptions)).toBeNull();
  });

  it('선형 유형으로는 만들지 않는다', () => {
    expect(finalizeRect([0, 0], [20, 10], mapper, options)).toBeNull();
  });

  it('DWG 변환이 안 되면 dwg와 computed가 null', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    const damage = finalizeRect([0, 0], [20, 10], noDwg, areaOptions);
    expect(damage?.geometry.dwg).toBeNull();
    expect(damage?.computed).toEqual({ lengthDwg: null, areaDwg: null });
  });
});

describe('pickDamage', () => {
  const line = {
    id: 'a',
    type: 'crack',
    geometry: { kind: 'polyline', world: [[0, -5], [10, -5]] as Pt[] },
    copies: [],
  };
  // 복제본은 화면 x 200~300, y 100~200 자리다(world [[20,-10],[30,-10],[30,-20],[20,-20]]).
  const area = {
    id: 'b',
    type: 'spalling',
    geometry: { kind: 'rect', world: [[0, -10], [10, -10], [10, -20], [0, -20]] as Pt[] },
    copies: [{ world: [[20, -10], [30, -10], [30, -20], [20, -20]] as Pt[], dwg: null }],
  };

  it('선형은 선 가까이를 누르면 선택된다', () => {
    expect(pickDamage([line, area], [50, 55], mapper)).toEqual({ id: 'a', shapeIndex: 0 });
    expect(pickDamage([line, area], [50, 20], mapper)).toBeNull();
  });

  it('면형은 안쪽을 눌러도 선택된다', () => {
    expect(pickDamage([line, area], [50, 150], mapper)).toEqual({ id: 'b', shapeIndex: 0 });
  });

  it('면형 테두리 근처도 선택된다', () => {
    expect(pickDamage([line, area], [50, 95], mapper)).toEqual({ id: 'b', shapeIndex: 0 });
  });

  it('복제본을 누르면 그 도형 번호가 나온다', () => {
    expect(pickDamage([line, area], [250, 150], mapper)).toEqual({ id: 'b', shapeIndex: 1 });
    expect(pickDamage([line, area], [295, 105], mapper)).toEqual({ id: 'b', shapeIndex: 1 });
  });

  it('아무것도 없으면 null', () => {
    expect(pickDamage([], [0, 0], mapper)).toBeNull();
  });
});

describe('offsetShape', () => {
  it('경계상자 너비의 1.2배만큼 오른쪽으로 옮기고 dwg를 다시 구한다', () => {
    expect(DUPLICATE_OFFSET_FACTOR).toBe(1.2);
    expect(offsetShape([[0, 0], [2, 0], [2, 1], [0, 1]], mapper)).toEqual({
      world: [[2.4, 0], [4.4, 0], [4.4, 1], [2.4, 1]],
      dwg: [[1002.4, 2000], [1004.4, 2000], [1004.4, 2001], [1002.4, 2001]],
    });
  });

  it('세로로만 그은 선(너비 0)은 높이로 대신 옮긴다 — 그러지 않으면 복제본이 원본에 완전히 겹친다', () => {
    expect(offsetShape([[5, 0], [5, 10]], mapper)).toEqual({
      world: [[17, 0], [17, 10]],
      dwg: [[1017, 2000], [1017, 2010]],
    });
  });

  it('dwg를 못 구하면 world만 있는 복제본이 된다', () => {
    const noDwg = { ...mapper, worldToDwg: () => null };
    expect(offsetShape([[0, 0], [2, 0], [2, 1], [0, 1]], noDwg)).toEqual({
      world: [[2.4, 0], [4.4, 0], [4.4, 1], [2.4, 1]],
      dwg: null,
    });
  });

  it('점이 모자라거나 크기가 0이면 null', () => {
    expect(offsetShape([[1, 1]], mapper)).toBeNull();
    expect(offsetShape([[1, 1], [1, 1]], mapper)).toBeNull();
    expect(offsetShape(null as unknown as Pt[], mapper)).toBeNull();
  });
});

describe('hitHandle', () => {
  const rect: Pt[] = [[0, 0], [40, 0], [40, 20], [0, 20]];

  it('모서리 핸들을 누르면 그 번호를 돌려준다', () => {
    expect(hitHandle([0, 0], rect)).toEqual({ kind: 'corner', index: 0 });
    expect(hitHandle([40, 20], rect)).toEqual({ kind: 'corner', index: 2 });
  });

  it('회전 핸들을 누르면 rotate', () => {
    expect(hitHandle([20, -28], rect)).toEqual({ kind: 'rotate' });
  });

  it('핸들에서 멀면 null', () => {
    expect(hitHandle([20, 10], rect)).toBeNull();
    expect(hitHandle([200, 200], rect)).toBeNull();
  });

  it('사각형이 없으면 null', () => {
    expect(hitHandle([0, 0], null)).toBeNull();
  });
});

// 근거: docs/superpowers/specs/2026-09-12-damage-types-design.md §4 "선택한 손상 이동".
// 선택된 손상의 몸통(사각형은 안쪽, 선은 선 위) 위에서 시작하면 이동 제스처가 된다.
describe('hitSelectedShape', () => {
  const rectShape = { kind: 'rect', points: [[0, 0], [40, 0], [40, 20], [0, 20]] as Pt[] };
  const lineShape = { kind: 'polyline', points: [[0, 0], [40, 0]] as Pt[] };

  it('사각형은 안쪽이면 true', () => {
    expect(hitSelectedShape([20, 10], rectShape)).toBe(true);
  });

  it('사각형은 바깥이면 false', () => {
    expect(hitSelectedShape([200, 200], rectShape)).toBe(false);
  });

  it('선은 근처(PICK_RADIUS_PX 이내)면 true', () => {
    expect(hitSelectedShape([20, 5], lineShape)).toBe(true);
  });

  it('선은 멀면 false', () => {
    expect(hitSelectedShape([20, 100], lineShape)).toBe(false);
  });

  it('shape가 null이면 false', () => {
    expect(hitSelectedShape([0, 0], null)).toBe(false);
  });
});

describe('v5 document validation', () => {
  it('새로 만든 선형 손상이 v5 문서에서 검증을 통과한다', () => {
    const stroke: Pt[] = [];
    for (let i = 0; i <= 100; i++) stroke.push([i, i % 2 === 0 ? 50 : 50.5]);
    const damage = finalizeStroke(stroke, mapper, options);
    expect(damage).not.toBeNull();

    const doc = {
      schemaVersion: 5,
      drawingId: 'test-drawing',
      updatedAt: '2026-09-12T03:00:00.000Z',
      damages: [damage!],
    };
    const errors = validateDamageDoc(doc, 'test-drawing');
    expect(errors).toHaveLength(0);
  });

  it('새로 만든 면형 손상이 v5 문서에서 검증을 통과한다', () => {
    const damage = finalizeRect([0, 0], [20, 10], mapper, areaOptions);
    expect(damage).not.toBeNull();

    const doc = {
      schemaVersion: 5,
      drawingId: 'test-drawing',
      updatedAt: '2026-09-12T03:00:00.000Z',
      damages: [damage!],
    };
    const errors = validateDamageDoc(doc, 'test-drawing');
    expect(errors).toHaveLength(0);
  });
});
