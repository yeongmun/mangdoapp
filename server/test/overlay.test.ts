import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import { labelBlock } from '../public/viewer/labelLayout.js';
import { computeNumbers, dimensionTextOf, drawingNameOf, photoTextOf } from '../public/viewer/quantities.js';
import { damageLabels } from '../src/export/labelPlacement.js';
import {
  computeLabelPlacements,
  computeRenderSizes,
  computeScale,
  CRACK_COLOR,
  CRACK_WIDTH_PX,
  describeDamageRender,
  estimateTextWidthPx,
  HANDLE_SIZE_PX,
  hatchPatternId,
  HATCH_PATTERNS,
  labelAnchor,
  labelLayout,
  LABEL_OFFSET_PX,
  MIN_LINE_WIDTH_PX,
  patternSpacingPx,
  PATTERN_SIZE_PX,
  PHOTO_COLOR,
  rectHandlePositions,
  resolveFillPattern,
  ROTATE_HANDLE_OFFSET_PX,
  SELECTED_COLOR,
  SELECTED_WIDTH_PX,
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
} from '../public/viewer/overlay.js';

type Pt = [number, number];

describe('HATCH_PATTERNS', () => {
  it('유형 정의가 쓰는 모든 해치 패턴의 그림 정의가 있다', () => {
    const used = DAMAGE_TYPES.filter(
      (t: any): t is { fill: { pattern: string } & any } => t.fill && t.fill.pattern,
    ).map((t: any) => t.fill.pattern);
    expect(used.length).toBeGreaterThan(0);
    for (const pattern of used) {
      expect(Object.keys(HATCH_PATTERNS)).toContain(pattern);
      expect(typeof (HATCH_PATTERNS as any)[pattern]).toBe('function');
    }
  });

});

describe('rectHandlePositions', () => {
  const rect: Pt[] = [[0, 0], [40, 0], [40, 20], [0, 20]];

  it('모서리 핸들은 네 꼭짓점 위치에 있다', () => {
    expect(rectHandlePositions(rect).corners).toEqual(rect);
  });

  it('회전 핸들은 첫 변의 바깥쪽에 일정 거리만큼 떨어져 있다', () => {
    const { rotate } = rectHandlePositions(rect);
    // 첫 변(0→1)의 중점은 (20, 0)이고 사각형 중심은 (20, 10)이므로 바깥은 y가 작아지는 쪽이다.
    expect(rotate[0]).toBeCloseTo(20, 6);
    expect(rotate[1]).toBeCloseTo(-ROTATE_HANDLE_OFFSET_PX, 6);
  });

  it('회전된 사각형에서도 첫 변 바깥쪽을 향한다', () => {
    const rotated: Pt[] = [[0, 0], [0, 40], [-20, 40], [-20, 0]];
    const { rotate } = rectHandlePositions(rotated);
    expect(rotate[0]).toBeCloseTo(ROTATE_HANDLE_OFFSET_PX, 6);
    expect(rotate[1]).toBeCloseTo(20, 6);
  });

  it('핸들 크기 상수는 손가락으로 누를 수 있는 크기이며 화면 고정이다', () => {
    expect(HANDLE_SIZE_PX).toBeGreaterThanOrEqual(10);
  });
});

describe('describeDamageRender', () => {
  it('유형 목록에 없는 면형 손상은 테두리만(채우기 없이) 그리고 원본 type을 이름으로 보여준다', () => {
    const unknown = { id: 'x', type: 'no_such_type', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(unknown, null, 2);
    expect(plan.known).toBe(false);
    expect(plan.shape).toBe('polygon');
    expect(plan.fillPattern).toBeNull();
    expect(plan.name).toBe('no_such_type');
    expect(plan.number).toBe(2);
    expect(plan.color).toBe(CRACK_COLOR);
  });

  it('유형 목록에 없어도 선택하면 강조색과 핸들을 보여준다 — 선택·삭제가 가능해야 한다', () => {
    const unknown = { id: 'x', type: 'no_such_type', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(unknown, 'x');
    expect(plan.color).toBe(SELECTED_COLOR);
    expect(plan.showHandles).toBe(true);
    expect(plan.selected).toBe(true);
  });

  it('유형 목록에 없는 선형 손상은 핸들 없이 이름만 그린다', () => {
    const unknown = { id: 'y', type: 'nope', geometry: { kind: 'polyline', world: [] } };
    const plan = describeDamageRender(unknown, 'y', 1);
    expect(plan.shape).toBe('polyline');
    expect(plan.name).toBe('nope');
    expect(plan.showHandles).toBe(false);
  });

  it('이름은 drawingNameOf(폭 구간 없이), 치수는 dimensionTextOf를 그대로 쓴다', () => {
    const crackEfflorescence = {
      id: 'a',
      type: 'crack_efflorescence',
      geometry: { kind: 'polyline', world: [] },
      measured: { width: 0.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '' },
    };
    const plan = describeDamageRender(crackEfflorescence, null, 17);
    expect(plan.name).toBe('균열/백태');
    expect(plan.dimension).toBe('0.2/1.5');
    expect(plan.number).toBe(17);
  });

  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2 예외.
  it('균열(crack)은 이름이 빈 문자열이다 — 라벨은 번호 원만 그린다', () => {
    const crack = {
      id: 'a',
      type: 'crack',
      geometry: { kind: 'polyline', world: [] },
      measured: { width: 0.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '' },
    };
    const plan = describeDamageRender(crack, null, 17);
    expect(plan.name).toBe('');
    expect(plan.dimension).toBe('0.2/1.5');
  });

  it('채우기가 있는 면형은 fillPattern과 fillSpacingMm을 함께 준다', () => {
    const filled = { id: 'a', type: 'delamination', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(filled, null, 3);
    expect(plan.name).toBe('박리');
    expect(plan.fillPattern).toBe('ANSI31');
    expect(plan.fillSpacingMm).toBeCloseTo(158.75, 5);
    const breakage = { id: 'b', type: 'breakage', geometry: { kind: 'rect', world: [] } };
    const breakagePlan = describeDamageRender(breakage, null, 4);
    expect(breakagePlan.fillPattern).toBe('ANSI33');
    expect(breakagePlan.fillSpacingMm).toBeCloseTo(317.5, 5);
  });

  it('번호가 없으면 number가 null이다', () => {
    const filled = { id: 'a', type: 'spalling', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(filled, null).number).toBeNull();
  });

  it('photo는 photoTextOf를 그대로 쓴다', () => {
    const withPhotos = {
      id: 'a',
      type: 'crack',
      geometry: { kind: 'polyline', world: [] },
      measured: { width: 0.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: ['12', '13'] },
    };
    expect(describeDamageRender(withPhotos, null).photo).toBe('#12, #13');

    const noPhotos = {
      id: 'b',
      type: 'crack',
      geometry: { kind: 'polyline', world: [] },
      measured: { width: 0.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    };
    expect(describeDamageRender(noPhotos, null).photo).toBe('');
  });
});

describe('computeScale', () => {
  function fakeMapper({ pxPerUnit = 1, mmPerUnit = 1, dwgAvailable = true } = {}) {
    return {
      worldToClient([x, y]: Pt): Pt {
        return [x * pxPerUnit, y * pxPerUnit];
      },
      worldToDwg([x, y]: Pt): Pt | null {
        if (!dwgAvailable) return null;
        return [x * mmPerUnit, y * mmPerUnit];
      },
    };
  }

  it('화면 배율과 도면 배율, 그 비율(px/mm)을 구한다', () => {
    const mapper = fakeMapper({ pxPerUnit: 4, mmPerUnit: 2 });
    const scale = computeScale(mapper);
    expect(scale.pxPerWorld).toBeCloseTo(4, 6);
    expect(scale.mmPerWorld).toBeCloseTo(2, 6);
    expect(scale.pxPerMm).toBeCloseTo(2, 6);
  });

  it('worldToDwg가 null이면 mmPerWorld와 pxPerMm 모두 null이다', () => {
    const mapper = fakeMapper({ dwgAvailable: false });
    const scale = computeScale(mapper);
    expect(scale.mmPerWorld).toBeNull();
    expect(scale.pxPerMm).toBeNull();
    expect(scale.pxPerWorld).toBeCloseTo(1, 6);
  });

  it('mmPerWorld가 0이면 나눌 수 없으므로 pxPerMm은 null이다', () => {
    const mapper = fakeMapper({ mmPerUnit: 0 });
    const scale = computeScale(mapper);
    expect(scale.mmPerWorld).toBeCloseTo(0, 9);
    expect(scale.pxPerMm).toBeNull();
  });

  it('mmPerWorld가 특이에 가깝게 작아 나눗셈이 Infinity로 넘치면 pxPerMm은 null이다', () => {
    // pxPerWorld / mmPerWorld = 1e10 / 1e-300 = 1e310 → Number.MAX_VALUE(~1.8e308)를 넘어 Infinity.
    // 이걸 그대로 흘리면 computeRenderSizes의 모든 값이 Infinity가 되고, labelLayout의
    // "Infinity - Infinity" 계산이 NaN을 만들어 <circle cx="NaN">이 SVG에 그대로 들어간다.
    const mapper = fakeMapper({ pxPerUnit: 1e10, mmPerUnit: 1e-300 });
    const scale = computeScale(mapper);
    expect(Number.isFinite(scale.pxPerWorld)).toBe(true);
    expect(Number.isFinite(scale.mmPerWorld as number)).toBe(true);
    expect(scale.pxPerMm).toBeNull();
  });
});

describe('computeRenderSizes', () => {
  it('pxPerMm이 null이면 기존 화면 고정값을 쓴다', () => {
    const sizes = computeRenderSizes(null);
    expect(sizes.lineWidthPx).toBe(CRACK_WIDTH_PX);
    expect(sizes.selectedLineWidthPx).toBe(SELECTED_WIDTH_PX);
    expect(sizes.fontPx).toBe(11);
    expect(sizes.labelGapPx).toBe(LABEL_OFFSET_PX);
  });

  it('pxPerMm이 있으면 도면 실치수(mm) × pxPerMm으로 계산한다', () => {
    const sizes = computeRenderSizes(2);
    expect(sizes.lineWidthPx).toBeCloseTo(60, 6); // 30mm * 2
    expect(sizes.selectedLineWidthPx).toBeCloseTo(120, 6); // 2배
    expect(sizes.fontPx).toBeCloseTo(600, 6); // 300mm * 2
    expect(sizes.circleRPx).toBeCloseTo(600 * 0.85, 6);
    expect(sizes.labelGapPx).toBeCloseTo(200, 6); // 100mm * 2
  });

  it('선 굵기는 최소 0.5px보다 얇아지지 않는다 (많이 축소된 경우)', () => {
    const sizes = computeRenderSizes(0.001); // 30mm * 0.001 = 0.03px
    expect(sizes.lineWidthPx).toBe(MIN_LINE_WIDTH_PX);
  });

  it('글자·번호 원에는 최소값을 두지 않는다 — 축소하면 계속 작아진다', () => {
    const sizes = computeRenderSizes(0.001);
    expect(sizes.fontPx).toBeCloseTo(300 * 0.001, 9);
    expect(sizes.circleRPx).toBeCloseTo(300 * 0.001 * 0.85, 9);
  });

  it('pxPerMm이 Infinity면(특이에 가까운 변환) null과 똑같이 화면 고정값으로 떨어진다', () => {
    const sizes = computeRenderSizes(Infinity);
    expect(sizes.pxPerMm).toBeNull();
    expect(sizes.lineWidthPx).toBe(CRACK_WIDTH_PX);
    expect(sizes.fontPx).toBe(11);
    expect(Number.isFinite(sizes.circleRPx)).toBe(true);
    expect(Number.isFinite(sizes.labelGapPx)).toBe(true);
  });
});

describe('patternSpacingPx', () => {
  it('pxPerMm이 있으면 spacingMm × pxPerMm', () => {
    expect(patternSpacingPx(158.75, 2)).toBeCloseTo(317.5, 6);
  });

  it('pxPerMm이 null이면 기존 화면 고정값(PATTERN_SIZE_PX)을 쓴다', () => {
    expect(patternSpacingPx(158.75, null)).toBe(PATTERN_SIZE_PX);
  });
});

describe('hatchPatternId', () => {
  it('패턴 이름과 반올림한 px 크기를 붙여 서로 다른 배율의 같은 패턴을 구분한다', () => {
    expect(hatchPatternId('ANSI31', 42.4)).toBe('mangdo-hatch-ANSI31-42');
    expect(hatchPatternId('ANSI31', 42.6)).toBe('mangdo-hatch-ANSI31-43');
  });
});

describe('resolveFillPattern', () => {
  // spacingMm * pxPerMm(=1)으로 spacingPx를 그대로 조절해 MIN_PATTERN_SPACING_PX(1px) 경계를 겨냥한다.
  // 이 판정은 화면이 거의 단색으로 칠해지고 브라우저가 느려지는 것을 막는 유일한 장치이므로
  // 경계 양쪽(0.99px 건너뜀 / 1.0px·1.5px 그림)을 직접 확인한다.
  it('간격이 1px보다 작으면(0.99px) null을 돌려줘 무늬를 건너뛴다', () => {
    expect(resolveFillPattern('ANSI31', 0.99, 1)).toBeNull();
  });

  it('간격이 정확히 1px이면 그린다(경계 포함)', () => {
    const resolved = resolveFillPattern('ANSI31', 1, 1);
    expect(resolved).not.toBeNull();
    expect(resolved!.sizePx).toBe(1);
    expect(resolved!.id).toBe('mangdo-hatch-ANSI31-1');
  });

  it('간격이 1px보다 크면(1.5px) 그린다', () => {
    const resolved = resolveFillPattern('ANSI31', 1.5, 1);
    expect(resolved).not.toBeNull();
    expect(resolved!.sizePx).toBe(2); // Math.round(1.5)
  });

  it('선 굵기는 같은 pxPerMm으로 computeRenderSizes가 계산한 값과 같다', () => {
    const resolved = resolveFillPattern('ANSI31', 158.75, 2);
    expect(resolved!.lineWidthPx).toBeCloseTo(computeRenderSizes(2).lineWidthPx, 6);
  });

  it('pxPerMm이 null이면(좌표 변환 불가) 화면 고정 간격(PATTERN_SIZE_PX=10)을 쓰고, 이는 1px보다 크므로 그린다', () => {
    const resolved = resolveFillPattern('ANSI31', 158.75, null);
    expect(resolved).not.toBeNull();
    expect(resolved!.sizePx).toBe(PATTERN_SIZE_PX);
    expect(resolved!.lineWidthPx).toBe(CRACK_WIDTH_PX);
  });

  it('pxPerMm이 Infinity면(특이에 가까운 변환) 간격 판정이 깨지지 않고 화면 고정 경로로 떨어진다', () => {
    const resolved = resolveFillPattern('ANSI31', 158.75, Infinity);
    expect(resolved).not.toBeNull();
    expect(resolved!.sizePx).toBe(PATTERN_SIZE_PX);
    expect(Number.isFinite(resolved!.lineWidthPx)).toBe(true);
  });
});

describe('estimateTextWidthPx', () => {
  it('아스키 글자는 글자 높이의 0.55배', () => {
    expect(estimateTextWidthPx('ab', 100)).toBeCloseTo(110, 6);
  });

  it('한글 등 그 밖의 글자는 글자 높이의 1.0배', () => {
    expect(estimateTextWidthPx('균열', 100)).toBeCloseTo(200, 6);
  });

  it('섞인 문자열도 글자마다 계산해 더한다', () => {
    expect(estimateTextWidthPx('a균', 100)).toBeCloseTo(55 + 100, 6);
  });

  it('빈 문자열은 0', () => {
    expect(estimateTextWidthPx('', 100)).toBe(0);
  });
});

describe('labelAnchor', () => {
  it('도형 위쪽 가운데에서 gapPx만큼 위에 놓는다 (화면 좌표는 아래로 갈수록 y가 크다)', () => {
    const rect: Pt[] = [[10, 40], [50, 40], [50, 80], [10, 80]];
    expect(labelAnchor(rect, 6)).toEqual([30, 40 - 6]);
  });

  it('선도 경계상자 기준으로 놓는다', () => {
    const line: Pt[] = [[0, 100], [60, 20]];
    expect(labelAnchor(line, 6)).toEqual([30, 20 - 6]);
  });

  it('점이 없으면 원점', () => {
    expect(labelAnchor([], 6)).toEqual([0, 0]);
  });

  it('gapPx는 호출마다 다르게 줄 수 있다 (실치수 배율에 따라 달라지므로)', () => {
    const rect: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(labelAnchor(rect, 200)).toEqual([5, -200]);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
// (이 규칙이 2026-09-13 설계 §5.2·§9.5의 라벨 배치를 대체한다)
describe('labelLayout (화면 어댑터)', () => {
  const anchor: Pt = [100, 50];
  const fontPx = 20;
  const circleRPx = 17;
  const lineGap = fontPx * 1.3; // 26
  const circleWidth = circleRPx * 2 + circleRPx * 0.5; // 42.5

  it('화면은 y가 아래로 증가한다 — 윗줄일수록 y가 작다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '1.2x1.2', photo: '#5', number: 17, fontPx, circleRPx });
    const name = layout.lines.find((l) => l.key === 'name')!;
    const dimension = layout.lines.find((l) => l.key === 'dimension')!;
    const photo = layout.lines.find((l) => l.key === 'photo')!;
    expect(photo.y).toBe(anchor[1]);
    expect(dimension.y).toBeCloseTo(anchor[1] - lineGap, 6);
    expect(name.y).toBeCloseTo(anchor[1] - lineGap * 2, 6);
    expect(layout.circle!.cy).toBeCloseTo(name.y - fontPx * 0.35, 6);
  });

  it('번호가 없으면 원 없이 이름부터 시작하고 블록이 기준점에 가운데 맞춰진다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    // '균열/백태' = 한글 4 + 아스키 1 = 4*20 + 11 = 91
    expect(layout.lines).toEqual([{ x: 100 - 91 / 2, y: 50, text: '균열/백태', anchor: 'start', key: 'name' }]);
  });

  it('균열(이름 없음)은 치수가 원 옆 첫 줄로 올라오고 사진이 그 아래 들여쓰기된다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '0.2/0.3', photo: '#12', number: 17, fontPx, circleRPx });
    expect(layout.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['dimension', '0.2/0.3'],
      ['photo', '#12'],
    ]);
    const dimension = layout.lines.find((l) => l.key === 'dimension')!;
    const photo = layout.lines.find((l) => l.key === 'photo')!;
    // 둘째 줄부터 A의 왼쪽 x에 맞춘다
    expect(photo.x).toBe(dimension.x);
    expect(photo.y).toBe(anchor[1]);
    expect(dimension.y).toBeCloseTo(anchor[1] - lineGap, 6);
  });

  it('첫 줄의 원은 A 왼쪽에 놓이고 번호 글자만 가운데 정렬이다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: 17, fontPx, circleRPx });
    const number = layout.lines.find((l) => l.key === 'number')!;
    const name = layout.lines.find((l) => l.key === 'name')!;
    expect(number.anchor).toBe('middle');
    expect(number.x).toBeCloseTo(layout.circle!.cx, 6);
    expect(name.anchor).toBe('start');
    expect(name.x).toBeCloseTo(layout.circle!.cx + circleRPx + circleRPx * 0.5, 6);
  });

  it('블록 전체(원 + 가장 긴 줄)를 기준점 x에 가운데 맞춘다', () => {
    const layout = labelLayout({ anchor, name: '균열', dimension: '', number: 5, fontPx, circleRPx });
    const name = layout.lines.find((l) => l.key === 'name')!;
    const left = layout.circle!.cx - circleRPx;
    const right = name.x + estimateTextWidthPx('균열', fontPx);
    expect((left + right) / 2).toBeCloseTo(anchor[0], 6);
    expect(layout.box.x).toBeCloseTo(left, 6);
    expect(layout.box.width).toBeCloseTo(circleWidth + estimateTextWidthPx('균열', fontPx), 6);
  });

  it('번호가 있고 이름·치수가 없으면 원만 그린다 (원 중심 = 기준점 x)', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: 1, fontPx, circleRPx });
    expect(layout.circle!.cx).toBeCloseTo(anchor[0], 6);
    expect(layout.lines).toEqual([{ x: layout.circle!.cx, y: anchor[1], text: '1', anchor: 'middle', key: 'number' }]);
  });

  it('이름·번호가 둘 다 없으면 아무것도 그리지 않는다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    expect(layout.lines).toEqual([]);
  });

  it('없는 줄은 건너뛰어 빈 줄을 남기지 않는다 (치수 없이 사진만)', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '', photo: '#5', number: 3, fontPx, circleRPx });
    expect(layout.lines.map((l) => l.text)).toEqual(['3', '망상균열', '#5']);
    expect(layout.lines.find((l) => l.key === 'photo')!.y).toBe(anchor[1]);
  });

  it('화면 상자의 (x, y)는 위 변이다 (y가 아래로 증가하므로)', () => {
    const layout = labelLayout({ anchor, name: '박락', dimension: '1.2x1.2', number: 7, fontPx, circleRPx });
    expect(layout.box.y).toBeLessThan(anchor[1]);
    expect(layout.box.y + layout.box.height).toBeGreaterThanOrEqual(anchor[1]);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.5
describe('computeLabelPlacements', () => {
  type Pt2 = [number, number];

  // world와 dwg가 같은(항등 변환) 기본 픽스처. dwgToWorld = 항등 함수로 부른다.
  function rectDamage(id: string, x: number, dwg?: Pt2[]): unknown {
    const world: Pt2[] = [[x, 0], [x + 1000, 0], [x + 1000, 400], [x, 400]];
    return {
      id,
      type: 'spalling',
      geometry: { kind: 'rect', world, dwg: dwg ?? world },
      measured: { width: 1.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    };
  }

  const damages = [rectDamage('a', 0), rectDamage('b', 1050)];
  const numbers = computeNumbers(damages);
  // computeLabelPlacements의 dwgToWorld 매개변수 타입은 number[]를 받는다(고정 길이 튜플이 아니다) —
  // 아래 변환 함수들도 그 타입 그대로 선언해야 그 자리에 바로 넘길 수 있다.
  const identity = ([x, y]: number[]): Pt2 => [x, y];

  // 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 5장
  // 틀 밖 손상은 numbers에 없다. 라벨은 그대로 그리고 번호 원만 빠진다.
  it('번호가 없는 손상도 라벨 자리를 받고 블록이 원 너비만큼 좁아진다', () => {
    const damage = rectDamage('a', 0);
    const withNumber = computeLabelPlacements([damage], new Map([['a', 1]]), identity)!.get('a')!;
    const without = computeLabelPlacements([damage], new Map(), identity)!.get('a')!;

    expect(without).toBeDefined();
    // 원 너비 = 반지름 255 × 2 + 원-글자 간격(반지름의 0.5배) 127.5 = 637.5 (도면 mm)
    expect(withNumber.box.width - without.box.width).toBeCloseTo(637.5, 6);
  });

  // dwg에 transform을 적용한 픽스처를 만들고, screen(computeLabelPlacements)과 DXF(damageLabels)가
  // 같은 자리를 고르는지 맞대본다 — DXF는 이미 검증된 대조군이라 손으로 좌표를 계산할 필요가 없다.
  // gap·font가 (world 기준이 아니라) 고정된 실제 mm값이라 축척이 있으면 손으로 미리 답을 구하기
  // 어렵다 — 특히 어느 라벨이 밀려나는지(displaced)는 축척에 따라 달라질 수 있어 DXF를 대조군으로
  // 쓰는 쪽이 더 믿을 만하다.
  function transformedDamages(transform: (p: Pt2) => Pt2) {
    return [rectDamage('a', 0), rectDamage('b', 1050)].map((damage: any) => ({
      ...damage,
      geometry: { ...damage.geometry, dwg: (damage.geometry.world as Pt2[]).map(transform) },
    }));
  }

  function crossCheckAgainstDxf(transform: (p: Pt2) => Pt2, inverse: (p: number[]) => Pt2) {
    const dwgDamages = transformedDamages(transform);
    const numbers2 = computeNumbers(dwgDamages);
    const screen = computeLabelPlacements(dwgDamages, numbers2, inverse)!;

    const items = dwgDamages.map((damage: any) => ({ id: damage.id, number: numbers2.get(damage.id) ?? null, damage }));
    const dxf = damageLabels(items);

    expect(screen.size).toBe(dwgDamages.length);
    for (const damage of dwgDamages as any[]) {
      const screenPlacement = screen.get(damage.id)!;
      const dxfLabel = dxf.get(damage.id)!;
      expect(screenPlacement).toBeDefined();
      expect(dxfLabel).toBeDefined();
      // 기준점 자체를 맞대본다 — 화살표가 없는 경우(기본 자리, 또는 화살대가 짧아 생략)에도 같은 후보를
      // 골랐는지 잡아낸다. labelPlacement.ts는 기준점을 노출하지 않으므로 원 중심에서 블록의 원 오프셋을
      // 빼서 dwg 기준점을 되찾고 inverse로 world로 옮긴다.
      const block = labelBlock({
        name: drawingNameOf(damage),
        dimension: dimensionTextOf(damage),
        photo: photoTextOf(damage),
        number: numbers2.get(damage.id) ?? null,
        font: FONT_HEIGHT_MM,
        circleR: FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR,
      });
      const dwgAnchor: Pt2 = [dxfLabel.circle!.center[0] - block.circle!.dx, dxfLabel.circle!.center[1] - block.circle!.dy];
      const expectedAnchor = inverse(dwgAnchor);
      expect(screenPlacement.anchor[0]).toBeCloseTo(expectedAnchor[0], 6);
      expect(screenPlacement.anchor[1]).toBeCloseTo(expectedAnchor[1], 6);
      // 화살표 유무(밀려났고 화살대가 화살촉보다 긴 경우)도 같아야 한다.
      expect(screenPlacement.leader === null).toBe(dxfLabel.leader === null);
      if (screenPlacement.leader) expect(screenPlacement.displaced).toBe(true);
      if (dxfLabel.leader) {
        const from = inverse(dxfLabel.leader.from as Pt2);
        const to = inverse(dxfLabel.leader.to as Pt2);
        const head0 = inverse(dxfLabel.leader.head[0] as Pt2);
        const head1 = inverse(dxfLabel.leader.head[1] as Pt2);
        expect(screenPlacement.leader!.from[0]).toBeCloseTo(from[0], 6);
        expect(screenPlacement.leader!.from[1]).toBeCloseTo(from[1], 6);
        expect(screenPlacement.leader!.to[0]).toBeCloseTo(to[0], 6);
        expect(screenPlacement.leader!.to[1]).toBeCloseTo(to[1], 6);
        expect(screenPlacement.leader!.head[0][0]).toBeCloseTo(head0[0], 6);
        expect(screenPlacement.leader!.head[0][1]).toBeCloseTo(head0[1], 6);
        expect(screenPlacement.leader!.head[1][0]).toBeCloseTo(head1[0], 6);
        expect(screenPlacement.leader!.head[1][1]).toBeCloseTo(head1[1], 6);
      }
    }
  }

  it('dwgToWorld가 함수가 아니면 null — 겹침 방지를 하지 않는다', () => {
    expect(computeLabelPlacements(damages, numbers, null)).toBeNull();
    expect(computeLabelPlacements(damages, numbers, undefined)).toBeNull();
    expect(computeLabelPlacements(damages, numbers, 1 as any)).toBeNull();
  });

  it('나란히 붙은 손상 둘이면 2번 라벨이 위로 블록 높이만큼 올라가고 화살표가 붙는다 (항등 변환)', () => {
    // 블록 높이 750(labelLayout.test.ts 실측).
    const placements = computeLabelPlacements(damages, numbers, identity)!;
    expect(placements.get('a')!.anchor).toEqual([500, 500]);
    expect(placements.get('a')!.displaced).toBe(false);
    expect(placements.get('a')!.leader).toBeNull();
    expect(placements.get('b')!.anchor).toEqual([1550, 1250]);
    expect(placements.get('b')!.displaced).toBe(true);
    expect(placements.get('b')!.leader!.to[1]).toBe(400); // 손상 윗변을 가리킨다
  });

  it('dwg가 world의 2배 축척이면(dwgToWorld=절반) DXF와 같은 자리를 고른다', () => {
    // gap(100mm)·font(300mm)는 축척과 무관한 고정 실치수라, world가 절반 크기(=dwg가 2배)로
    // 잡힌 도면에서는 world 기준 결과가 항등 변환 때와 단순 비례하지 않는다(예: 어느 라벨이
    // 밀려나는지부터 달라질 수 있다) — 그래서 DXF(damageLabels)를 대조군으로 맞대본다.
    crossCheckAgainstDxf(
      ([x, y]) => [x * 2, y * 2],
      ([x, y]) => [x / 2, y / 2],
    );
  });

  it('dwg 좌표가 없는 손상은 건너뛴다', () => {
    const broken = { id: 'x', type: 'spalling', geometry: { kind: 'rect', world: [], dwg: [] }, attrs: {} };
    const placements = computeLabelPlacements([...damages, broken], computeNumbers([...damages, broken]), identity)!;
    expect(placements.has('x')).toBe(false);
  });

  it('dwgToWorld가 어떤 손상에서 null을 주면 그 손상만 결과에서 빠진다', () => {
    const flaky = (point: Pt2): Pt2 | null => (point[0] > 1000 ? null : point);
    const placements = computeLabelPlacements(damages, numbers, flaky as any)!;
    expect(placements.has('a')).toBe(true);
    expect(placements.has('b')).toBe(false);
  });

  it('사진 줄 색은 선택과 상관없이 노란색이다', () => {
    expect(PHOTO_COLOR).toBe('#f5c400');
  });

  describe('회전·반전 교차검증 — 화면(computeLabelPlacements)과 DXF(damageLabels)는 같은 dwg 입력에서 같은 자리를 고른다', () => {
    // 최종 리뷰 I-1: 축 정렬 경계상자는 회전에서 보존되지 않는다 — geometry.world를 그대로 쓰던
    // 예전 화면 코드는 회전·반전이 있는 도면에서 DXF와 다른 후보를 골랐다(고친 대상 그 자체).
    it('90도 회전에서도 화면과 DXF가 같은 자리를 고른다', () => {
      crossCheckAgainstDxf(
        ([x, y]) => [-y, x],
        ([x, y]) => [y, -x],
      );
    });

    it('y축 반전에서도 화면과 DXF가 같은 자리를 고른다', () => {
      const yFlip = ([x, y]: number[]): Pt2 => [x, -y]; // 자기 자신이 역함수다
      crossCheckAgainstDxf(yFlip, yFlip);
    });
  });
});

describe('ANCHORLK 화면 근사 무늬', () => {
  it('HATCH_PATTERNS에 ANCHORLK가 있다', () => {
    expect(typeof HATCH_PATTERNS.ANCHORLK).toBe('function');
  });

  it('베이스라인-중심 비율을 내보낸다', () => {
    expect(BASELINE_CENTER_FACTOR).toBe(0.35);
  });
});
