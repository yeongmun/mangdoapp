import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import {
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
  rectHandlePositions,
  resolveFillPattern,
  ROTATE_HANDLE_OFFSET_PX,
  SELECTED_COLOR,
  SELECTED_WIDTH_PX,
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
    const unfilled = { id: 'b', type: 'breakage', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(unfilled, null, 4).fillPattern).toBeNull();
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
    expect(describeDamageRender(withPhotos, null).photo).toBe('사진 12, 13');

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

describe('labelLayout', () => {
  const anchor: Pt = [100, 50];
  const fontPx = 20;
  const circleRPx = 17;

  it('번호가 null이면 원을 그리지 않고 이름만 가운데 정렬로 그린다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    expect(layout.lines).toEqual([{ x: 100, y: 50, text: '균열/백태', anchor: 'middle' }]);
  });

  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2 예외(균열 라벨).
  // 이름이 없어도 번호가 있으면 번호 원은 그린다 — 이름·번호가 둘 다 없을 때만 첫 줄을 건너뛴다.
  it('이름이 없어도 번호가 있으면 번호 원만 가운데에 그린다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '0.2/0.8', number: 17, fontPx, circleRPx });
    expect(layout.circle).not.toBeNull();
    expect(layout.circle!.r).toBe(circleRPx);
    // 이름이 없으므로 원의 폭만으로 가운데 정렬 — 원 중심이 anchor.x와 같다.
    expect(layout.circle!.cx).toBeCloseTo(anchor[0], 6);
    expect(layout.lines.map((l) => l.text)).toEqual(['17', '0.2/0.8']);
    const numberLine = layout.lines.find((l) => l.text === '17')!;
    expect(numberLine.anchor).toBe('middle');
    expect(numberLine.x).toBeCloseTo(anchor[0], 6);
  });

  it('둘째 줄(치수)이 빈 문자열이면 그리지 않는다', () => {
    const layout = labelLayout({ anchor, name: '박락', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0].text).toBe('박락');
  });

  it('번호가 있으면 원을 그리고 이름을 원 오른쪽에 붙인다', () => {
    const layout = labelLayout({ anchor, name: '균열/백태', dimension: '', number: 17, fontPx, circleRPx });
    expect(layout.circle).not.toBeNull();
    expect(layout.circle!.r).toBe(circleRPx);
    // 번호 텍스트는 원 중심에, 이름 텍스트는 원 오른쪽에서 시작(anchor: 'start')한다.
    const numberLine = layout.lines.find((l) => l.text === '17')!;
    const nameLine = layout.lines.find((l) => l.text === '균열/백태')!;
    expect(numberLine.anchor).toBe('middle');
    expect(numberLine.x).toBeCloseTo(layout.circle!.cx, 6);
    expect(nameLine.anchor).toBe('start');
    expect(nameLine.x).toBeGreaterThan(layout.circle!.cx + circleRPx);
  });

  it('두 줄 모두 있으면 이름이 위(작은 y), 치수가 아래(anchor.y)다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '1.2x1.2', number: 17, fontPx, circleRPx });
    const dimensionLine = layout.lines.find((l) => l.text === '1.2x1.2')!;
    const nameLine = layout.lines.find((l) => l.text === '망상균열')!;
    expect(dimensionLine.y).toBe(anchor[1]);
    expect(nameLine.y).toBeLessThan(dimensionLine.y);
  });

  it('첫 줄(원+이름) 묶음은 anchor.x를 가운데로 정렬한다', () => {
    const layout = labelLayout({ anchor, name: '균열', dimension: '', number: 5, fontPx, circleRPx });
    const numberLine = layout.lines.find((l) => l.text === '5')!;
    const nameLine = layout.lines.find((l) => l.text === '균열')!;
    const nameWidth = estimateTextWidthPx('균열', fontPx);
    const left = layout.circle!.cx - circleRPx;
    const right = nameLine.x + nameWidth;
    expect((left + right) / 2).toBeCloseTo(anchor[0], 1);
  });

  it('원의 세로 중심은 이름줄 베이스라인에서 글자 높이의 0.35배 위에 있다 (근사 상수를 테스트로 묶어둔다)', () => {
    // 이름 줄만 있을 때(치수 없음) 이름줄 베이스라인은 anchor.y 그대로다.
    const layout = labelLayout({ anchor, name: '균열', dimension: '', number: 5, fontPx, circleRPx });
    expect(layout.circle!.cy).toBeCloseTo(anchor[1] - fontPx * 0.35, 6);
  });

  it('두 줄일 때는 이름줄(anchor.y보다 위)을 기준으로 원 중심을 잡는다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '1.2x1.2', number: 17, fontPx, circleRPx });
    const nameLine = layout.lines.find((l) => l.text === '망상균열')!;
    expect(layout.circle!.cy).toBeCloseTo(nameLine.y - fontPx * 0.35, 6);
  });

  it('이름·치수가 없어도 번호가 있으면 번호 원만 그린다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: 1, fontPx, circleRPx });
    expect(layout.circle).not.toBeNull();
    expect(layout.lines).toEqual([{ x: layout.circle!.cx, y: anchor[1], text: '1', anchor: 'middle' }]);
  });

  it('이름·번호가 둘 다 없으면 아무것도 그리지 않는다', () => {
    const layout = labelLayout({ anchor, name: '', dimension: '', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    expect(layout.lines).toEqual([]);
  });

  // 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 9.5
  // 줄 순서는 이름/치수/사진이고, 라벨은 도형 위쪽 바깥에 놓인다 — 줄이 늘면 위로(작은 y) 쌓이고
  // 맨 아래 줄(가장 큰 y, anchor.y)이 도형에 가장 가깝다.
  it('세 줄 모두 있으면 이름(맨 위)·치수(가운데)·사진(맨 아래, anchor.y)순으로 쌓인다', () => {
    const layout = labelLayout({
      anchor,
      name: '균열/백태',
      dimension: '0.2/0.8',
      photo: '사진 12, 13',
      number: 17,
      fontPx,
      circleRPx,
    });
    const nameLine = layout.lines.find((l) => l.text === '균열/백태')!;
    const dimensionLine = layout.lines.find((l) => l.text === '0.2/0.8')!;
    const photoLine = layout.lines.find((l) => l.text === '사진 12, 13')!;
    expect(photoLine.y).toBe(anchor[1]);
    expect(dimensionLine.y).toBeCloseTo(anchor[1] - fontPx * 1.3, 6);
    expect(nameLine.y).toBeCloseTo(anchor[1] - fontPx * 1.3 * 2, 6);
    expect(dimensionLine.y).toBeLessThan(photoLine.y);
    expect(nameLine.y).toBeLessThan(dimensionLine.y);
    expect(photoLine.anchor).toBe('middle');
    expect(photoLine.x).toBe(anchor[0]);
  });

  it('치수가 없고 사진만 있으면 사진이 둘째 줄(치수 자리, anchor.y)로 올라가 빈 줄을 남기지 않는다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '', photo: '사진 5', number: 3, fontPx, circleRPx });
    expect(layout.lines).toHaveLength(3); // 번호줄의 원 텍스트 + 이름 + 사진(치수 줄 없음)
    const photoLine = layout.lines.find((l) => l.text === '사진 5')!;
    const nameLine = layout.lines.find((l) => l.text === '망상균열')!;
    expect(photoLine.y).toBe(anchor[1]);
    expect(nameLine.y).toBeCloseTo(anchor[1] - fontPx * 1.3, 6);
  });

  it('사진이 없으면 지금과 같이 두 줄(이름·치수)만 그린다', () => {
    const layout = labelLayout({ anchor, name: '망상균열', dimension: '1.2x1.2', photo: '', number: 17, fontPx, circleRPx });
    expect(layout.lines.map((l) => l.text)).toEqual(['17', '망상균열', '1.2x1.2']);
    const dimensionLine = layout.lines.find((l) => l.text === '1.2x1.2')!;
    expect(dimensionLine.y).toBe(anchor[1]);
  });

  it('번호가 없어도 세 줄이 같은 순서로 쌓이고 원은 그리지 않는다', () => {
    const layout = labelLayout({ anchor, name: '박락', dimension: '1.2x1.2', photo: '사진 1', number: null, fontPx, circleRPx });
    expect(layout.circle).toBeNull();
    expect(layout.lines.map((l) => l.text)).toEqual(['박락', '1.2x1.2', '사진 1']);
    expect(layout.lines[0].anchor).toBe('middle');
    expect(layout.lines[2].y).toBe(anchor[1]);
  });
});
