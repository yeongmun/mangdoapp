import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  boxOfBounds,
  candidatePlacements,
  leaderFor,
  MAX_STEPS,
  nearestPointOnBox,
  placeLabels,
} from '../public/viewer/labelCollision.js';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// 글자 내용과 상관없이 폭 w · 높이 h인 블록. 배치 계산만 따로 본다.
// (진짜 블록은 labelLayout.labelBlock이 만들고 labelLayout.test.ts가 검사한다.)
function block(width: number, height: number) {
  return { circle: null, lines: [], box: { dx: -width / 2, dy: 0, width, height }, height };
}

function bounds(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return { minX, minY, maxX, maxY };
}

const GAP = 100;
const FONT = 300;

describe('boxesOverlap', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };

  it('겹치면 true', () => {
    expect(boxesOverlap(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(boxesOverlap(a, { x: 10, y: 10, width: 10, height: 10 })).toBe(true); // 안에 든 상자
  });

  it('닿기만 하면 false — 간격 100이 딱 맞는 자리를 막지 않아야 한다', () => {
    expect(boxesOverlap(a, { x: 100, y: 0, width: 100, height: 100 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: 100, width: 100, height: 100 })).toBe(false);
  });

  it('떨어져 있으면 false', () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 100, height: 100 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: -300, width: 100, height: 100 })).toBe(false);
  });
});

describe('boxOfBounds', () => {
  it('경계상자를 상자로 바꾼다', () => {
    expect(boxOfBounds(bounds(0, 0, 1000, 400))).toEqual({ x: 0, y: 0, width: 1000, height: 400 });
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.3
describe('candidatePlacements', () => {
  const b = bounds(0, 0, 200, 200);
  const blk = block(100, 100);
  const list = candidatePlacements(b, blk, GAP);

  it('기본 자리가 맨 앞이고 손상 바로 위 가운데다', () => {
    expect(list[0].place).toBe('base');
    expect(list[0].anchor).toEqual([100, 300]);
    expect(list[0].box).toEqual({ x: 50, y: 300, width: 100, height: 100 });
  });

  it('k마다 위·오른쪽·왼쪽·아래 차례로 본다', () => {
    expect(list.slice(1, 5).map((c) => c.place)).toEqual(['up', 'right', 'left', 'down']);
    expect(list.slice(5, 9).map((c) => c.place)).toEqual(['up', 'right', 'left', 'down']);
    expect(list).toHaveLength(1 + MAX_STEPS * 4);
  });

  it('위 k는 기본 자리에서 위로 k·h다', () => {
    expect(list[1].anchor).toEqual([100, 400]); // k = 1
    expect(list[5].anchor).toEqual([100, 500]); // k = 2
    expect(list[list.length - 4].anchor).toEqual([100, 300 + 8 * 100]); // k = 8
  });

  it('오른쪽 k는 경계상자 오른쪽에 간격 100, 세로는 경계상자 중앙이다', () => {
    expect(list[2].box).toEqual({ x: 300, y: 50, width: 100, height: 100 });
    expect(list[6].box).toEqual({ x: 400, y: 50, width: 100, height: 100 }); // h 더
  });

  it('왼쪽 k는 왼쪽에 같은 방식이다', () => {
    expect(list[3].box).toEqual({ x: -200, y: 50, width: 100, height: 100 });
    expect(list[7].box).toEqual({ x: -300, y: 50, width: 100, height: 100 });
  });

  it('아래 k는 경계상자 아래 간격 100이다', () => {
    expect(list[4].box).toEqual({ x: 50, y: -200, width: 100, height: 100 });
    expect(list[8].box).toEqual({ x: 50, y: -300, width: 100, height: 100 });
  });
});

describe('placeLabels', () => {
  it('막는 것이 없으면 기본 자리를 쓰고 화살표가 없다', () => {
    const result = placeLabels([{ id: 'a', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) }], { gap: GAP, font: FONT });
    const placed = result.get('a')!;
    expect(placed.anchor).toEqual([100, 300]);
    expect(placed.displaced).toBe(false);
    expect(placed.leader).toBeNull();
  });

  // 붙어 있는 손상 둘: 라벨 상자가 가로로 겹쳐 2번이 위로 h 올라간다.
  it('나란히 붙은 손상 둘이면 2번 라벨이 위로 h 올라간다', () => {
    const items = [
      { id: 'a', number: 1, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) },
      { id: 'b', number: 2, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) },
    ];
    const result = placeLabels(items, { gap: GAP, font: FONT });
    expect(result.get('a')!.anchor).toEqual([500, 500]);
    expect(result.get('a')!.displaced).toBe(false);
    expect(result.get('b')!.anchor).toEqual([1550, 500 + 750]);
    expect(result.get('b')!.displaced).toBe(true);
    expect(result.get('b')!.leader).not.toBeNull();
  });

  it('넣은 순서를 섞어도 같은 결과다 — 번호 순서대로 자리를 잡는다', () => {
    const a = { id: 'a', number: 1, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) };
    const b = { id: 'b', number: 2, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) };
    const forward = placeLabels([a, b], { gap: GAP, font: FONT });
    const backward = placeLabels([b, a], { gap: GAP, font: FONT });
    expect(backward.get('a')!.anchor).toEqual(forward.get('a')!.anchor);
    expect(backward.get('b')!.anchor).toEqual(forward.get('b')!.anchor);
  });

  // 위쪽이 통째로 막힌 손상: 세로로 긴 손상(벽)이 위 k = 1..8을 모두 가린다.
  it('위가 막히면 오른쪽으로 간다', () => {
    const items = [
      { id: 'wall', number: 1, bounds: bounds(40, 250, 160, 2000), block: block(100, 100) },
      { id: 'b', number: 2, bounds: bounds(0, 0, 200, 200), block: block(100, 100) },
    ];
    const placed = placeLabels(items, { gap: GAP, font: FONT }).get('b')!;
    // 오른쪽 k = 1: 상자 왼쪽 300, 세로 중앙 100 → 기준점 [350, 50]
    expect(placed.anchor).toEqual([350, 50]);
    expect(placed.displaced).toBe(true);
  });

  it('8단계가 다 막히면 위로 8h 자리를 그냥 쓴다 (겹치더라도 라벨은 반드시 그린다)', () => {
    const items = [
      { id: 'b', number: 1, bounds: bounds(0, 0, 200, 200), block: block(100, 100) },
      { id: 'huge', number: 2, bounds: bounds(-5000, -5000, 5000, 5000), block: block(100, 100) },
    ];
    const placed = placeLabels(items, { gap: GAP, font: FONT }).get('b')!;
    expect(placed.anchor).toEqual([100, 200 + GAP + MAX_STEPS * 100]);
    expect(placed.displaced).toBe(true);
    expect(placed.leader).not.toBeNull(); // 밀려났으니 화살표도 있다
  });

  it('자기 손상의 경계상자는 장애물로 보지 않는다', () => {
    // 블록이 손상보다 크고 원이 베이스라인 아래로 내려가도 기본 자리를 쓴다
    const items = [{ id: 'a', number: 1, bounds: bounds(0, 0, 100, 100), block: { circle: null, lines: [], box: { dx: -500, dy: -300, width: 1000, height: 900 }, height: 900 } }];
    expect(placeLabels(items, { gap: GAP, font: FONT }).get('a')!.displaced).toBe(false);
  });

  it('번호가 없는 손상은 뒤로 미룬다 (같으면 id 순서)', () => {
    const items = [
      { id: 'z', number: null, bounds: bounds(0, 0, 1000, 400), block: block(1800, 750) },
      { id: 'a', number: 1, bounds: bounds(1050, 0, 2050, 400), block: block(1800, 750) },
    ];
    const result = placeLabels(items, { gap: GAP, font: FONT });
    expect(result.get('a')!.displaced).toBe(false);
    expect(result.get('z')!.displaced).toBe(true);
  });

  it('경계상자나 블록이 없는 항목은 건너뛴다', () => {
    const result = placeLabels(
      [{ id: 'a', number: 1, bounds: null, block: block(100, 100) } as never, { id: 'b', number: 2, bounds: bounds(0, 0, 10, 10), block: block(100, 100) }],
      { gap: GAP, font: FONT },
    );
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(true);
  });

  // 프리필터가 결과를 바꾸지 않는다는 확인을 겸한 성능 확인. 100×30 격자로 3,000개를 촘촘히
  // 깔아(간격 없이 붙임) 대부분 자리를 밀어내게 만든다 — 프리필터 없이 손상마다 3,000개를 다
  // 훑으면 느려진다. 결과도 확인해 "빠르지만 틀림"을 막는다.
  it('손상 3,000개도 1초 안에 자리를 잡는다 (프리필터 성능 확인)', () => {
    const items = [];
    const cols = 100;
    for (let i = 0; i < 3000; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * 200;
      const y = row * 200;
      items.push({ id: `d${i}`, number: i + 1, bounds: bounds(x, y, x + 200, y + 200), block: block(150, 150) });
    }
    const start = performance.now();
    const result = placeLabels(items, { gap: GAP, font: FONT });
    const elapsed = performance.now() - start;
    expect(result.size).toBe(3000);
    expect(elapsed).toBeLessThan(1000);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.4
describe('nearestPointOnBox', () => {
  const box = { x: 0, y: 0, width: 200, height: 200 };

  it('상자 밖의 점은 가장 가까운 테두리 점으로 눌린다', () => {
    expect(nearestPointOnBox([300, 100], box)).toEqual([200, 100]);
    expect(nearestPointOnBox([-50, 300], box)).toEqual([0, 200]);
  });

  it('상자 안의 점은 가장 가까운 변으로 밀려난다', () => {
    expect(nearestPointOnBox([10, 100], box)).toEqual([0, 100]);
    expect(nearestPointOnBox([100, 190], box)).toEqual([100, 200]);
  });
});

describe('leaderFor', () => {
  // 라벨 상자 x 400..500 · y 50..150, 손상 경계상자 0..200 × 0..200 (화살대 200 ≥ 화살촉 150)
  const labelBox = { x: 400, y: 50, width: 100, height: 100 };
  const target = bounds(0, 0, 200, 200);
  const leader = leaderFor(labelBox, target, FONT)!;

  it('시작은 손상에 가장 가까운 변의 중점이다', () => {
    expect(leader.from).toEqual([400, 100]);
  });

  it('화살대가 화살촉(150)보다 짧으면 화살표를 그리지 않는다', () => {
    // 손상 바로 오른쪽, 간격 100 → 화살대 100 < 150
    expect(leaderFor({ x: 300, y: 50, width: 100, height: 100 }, target, FONT)).toBeNull();
    // 맞닿아 있으면(화살대 0) 당연히 없다
    expect(leaderFor({ x: 200, y: 50, width: 100, height: 100 }, target, FONT)).toBeNull();
    // 정확히 150이면 그린다
    expect(leaderFor({ x: 350, y: 50, width: 100, height: 100 }, target, FONT)).not.toBeNull();
  });

  it('끝은 손상 경계상자 위에서 시작점에 가장 가까운 점이다', () => {
    expect(leader.to).toEqual([200, 100]);
  });

  it('화살촉은 끝점에서 길이 150(글자 높이의 절반), 화살대에서 30°씩 벌어진 점 둘이다', () => {
    // 화살대 방향은 -x. 150 × cos30° = 129.9038, 150 × sin30° = 75
    expect(leader.head).toHaveLength(2);
    expect(leader.head[0][0]).toBeCloseTo(329.9038, 3);
    expect(leader.head[0][1]).toBeCloseTo(175, 6);
    expect(leader.head[1][0]).toBeCloseTo(329.9038, 3);
    expect(leader.head[1][1]).toBeCloseTo(25, 6);
  });

  it('위로 올라간 라벨은 아래 변 중점에서 손상 윗변으로 내려온다', () => {
    const above = leaderFor({ x: 50, y: 500, width: 100, height: 100 }, bounds(0, 0, 200, 200), FONT)!;
    expect(above.from).toEqual([100, 500]);
    expect(above.to).toEqual([100, 200]);
    expect(above.head[0][1]).toBeCloseTo(200 + 150 * Math.cos(Math.PI / 6), 3);
  });
});
