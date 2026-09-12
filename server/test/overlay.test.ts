import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import {
  CRACK_COLOR,
  describeDamageRender,
  HANDLE_SIZE_PX,
  HATCH_PATTERNS,
  rectHandlePositions,
  ROTATE_HANDLE_OFFSET_PX,
  SELECTED_COLOR,
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

  it('핸들 크기 상수는 손가락으로 누를 수 있는 크기다', () => {
    expect(HANDLE_SIZE_PX).toBeGreaterThanOrEqual(10);
  });
});

describe('describeDamageRender', () => {
  it('유형 목록에 없는 면형 손상은 테두리만(채우기 없이) 그리고 원본 type을 라벨로 보여준다', () => {
    const unknown = { id: 'x', type: 'no_such_type', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(unknown, null);
    expect(plan.known).toBe(false);
    expect(plan.shape).toBe('polygon');
    expect(plan.fillPattern).toBeNull();
    expect(plan.label).toBe('no_such_type');
    expect(plan.color).toBe(CRACK_COLOR);
  });

  it('유형 목록에 없어도 선택하면 강조색과 핸들을 보여준다 — 선택·삭제가 가능해야 한다', () => {
    const unknown = { id: 'x', type: 'no_such_type', geometry: { kind: 'rect', world: [] } };
    const plan = describeDamageRender(unknown, 'x');
    expect(plan.color).toBe(SELECTED_COLOR);
    expect(plan.showHandles).toBe(true);
  });

  it('유형 목록에 없는 선형 손상은 핸들 없이 라벨만 그린다', () => {
    const unknown = { id: 'y', type: 'nope', geometry: { kind: 'polyline', world: [] } };
    const plan = describeDamageRender(unknown, 'y');
    expect(plan.shape).toBe('polyline');
    expect(plan.label).toBe('nope');
    expect(plan.showHandles).toBe(false);
  });

  it('알려진 유형은 그대로 채우기 여부에 따라 라벨을 정한다', () => {
    const filled = { id: 'a', type: 'spalling', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(filled, null).label).toBeNull();
    const unfilled = { id: 'b', type: 'breakage', geometry: { kind: 'rect', world: [] } };
    expect(describeDamageRender(unfilled, null).label).toBe('파손');
  });
});
