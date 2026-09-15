// 라벨이 다른 손상·다른 라벨과 겹치지 않을 자리를 찾는다. 순수 함수이고 단위를 가리지 않는다 —
// 경계상자와 라벨 크기를 같은 단위로 받아 그 단위로 답한다(DXF는 mm, 화면은 world).
// 좌표계는 도면 방향(y가 위로 증가) 하나다.
//
// 라벨 자리는 저장하지 않는다. 손상 목록이 바뀔 때마다 처음부터 다시 돌린다(설계 4.6).
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4장

import { anchorForBox, baseAnchor, blockBoxAt } from './labelLayout.js';

export const MAX_STEPS = 8; // 4.3: k = 1..8까지만 찾는다
export const ARROW_HEAD_FACTOR = 0.5; // 화살촉 길이 = 글자 높이 × 0.5 (= 150)
export const ARROW_HEAD_ANGLE = Math.PI / 6; // 화살대에서 벌어진 각 30°

export function boxOfBounds(bounds) {
  return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

// 닿기만 한 상자는 겹치지 않은 것으로 본다(설계 6장 검증). 간격 100이 딱 맞게 떨어진 자리를
// "막혔다"고 보면 기본 자리가 쓸데없이 밀려난다.
export function boxesOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

function distanceToBox([x, y], box) {
  const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
  const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

// 상자 테두리 위에서 점에 가장 가까운 점. 점이 상자 안이면 가장 가까운 변으로 밀어낸다.
export function nearestPointOnBox([x, y], box) {
  const left = box.x;
  const right = box.x + box.width;
  const bottom = box.y;
  const top = box.y + box.height;
  const cx = clamp(x, left, right);
  const cy = clamp(y, bottom, top);
  if (cx !== x || cy !== y) return [cx, cy];
  const distances = [x - left, right - x, y - bottom, top - y];
  const nearest = Math.min(...distances);
  if (nearest === distances[0]) return [left, y];
  if (nearest === distances[1]) return [right, y];
  if (nearest === distances[2]) return [x, bottom];
  return [x, top];
}

function upAnchor(bounds, block, gap, k) {
  const [x, y] = baseAnchor(bounds, gap);
  return [x, y + k * block.box.height];
}

// 시도 순서(4.3): 기본 자리 → k = 1..8마다 위 → 오른쪽 → 왼쪽 → 아래, 점점 멀리.
export function candidatePlacements(bounds, block, gap) {
  const w = block.box.width;
  const h = block.box.height;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const list = [{ place: 'base', anchor: baseAnchor(bounds, gap) }];
  for (let k = 1; k <= MAX_STEPS; k++) {
    list.push({ place: 'up', anchor: upAnchor(bounds, block, gap, k) });
    // 오른쪽·왼쪽은 세로가 경계상자 중앙이고, 아래는 가로가 경계상자 가운데다.
    list.push({ place: 'right', anchor: anchorForBox(block, bounds.maxX + gap + (k - 1) * h, centerY - h / 2) });
    list.push({ place: 'left', anchor: anchorForBox(block, bounds.minX - gap - (k - 1) * h - w, centerY - h / 2) });
    list.push({ place: 'down', anchor: anchorForBox(block, (bounds.minX + bounds.maxX) / 2 - w / 2, bounds.minY - gap - (k - 1) * h - h) });
  }
  return list.map((candidate) => ({ ...candidate, box: blockBoxAt(block, candidate.anchor) }));
}

// 화살표(4.4). 기본 자리를 벗어난 라벨에만 그린다. 화살대가 화살촉보다 짧으면 null(그리지 않는다).
/** @returns {{ from: number[], to: number[], head: number[][] } | null} */
export function leaderFor(labelBox, bounds, font) {
  const target = boxOfBounds(bounds);
  // 변의 중점: 위 → 오른쪽 → 아래 → 왼쪽. 거리가 같으면 이 순서에서 앞선 것을 쓴다(결정적).
  const mids = [
    [labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height],
    [labelBox.x + labelBox.width, labelBox.y + labelBox.height / 2],
    [labelBox.x + labelBox.width / 2, labelBox.y],
    [labelBox.x, labelBox.y + labelBox.height / 2],
  ];
  let from = mids[0];
  let best = Infinity;
  for (const mid of mids) {
    const distance = distanceToBox(mid, target);
    if (distance < best) {
      best = distance;
      from = mid;
    }
  }
  const to = nearestPointOnBox(from, target);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const headLength = font * ARROW_HEAD_FACTOR;
  // 화살대가 화살촉보다 짧으면 촉만 보여 지저분하다(2026-09-16 캐드 확인 4번). 라벨이 손상 바로
  // 옆(간격 100)으로만 밀린 경우가 여기 걸리고, 위로 밀린 라벨(화살대 ≥ 간격 + 블록 높이)은 그대로다.
  if (Math.hypot(dx, dy) < headLength) return null;
  const angle = Math.atan2(dy, dx);
  const head = [angle + ARROW_HEAD_ANGLE, angle - ARROW_HEAD_ANGLE].map((a) => [
    to[0] - headLength * Math.cos(a),
    to[1] - headLength * Math.sin(a),
  ]);
  return { from, to, head };
}

function orderKey(item) {
  return Number.isFinite(item.number) ? item.number : Number.POSITIVE_INFINITY;
}

function compareId(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// 후보 상자 전체를 감싸는 범위. 이 범위 밖의 장애물은 어떤 후보와도 겹칠 수 없으므로 검사에서 뺀다.
// 손상 수천 개짜리 도면에서 손상마다 전체 목록을 훑지 않게 하는 유일한 장치다.
function windowOf(candidates) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { box } of candidates) {
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.width);
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 손상마다 라벨 자리를 정한다. 번호 순서대로 자리를 잡고(앞번호가 좋은 자리를 먼저 차지한다),
 * 앞서 잡은 라벨 상자는 뒷번호의 장애물이 된다. 같은 손상 집합이면 넣은 순서와 상관없이 항상
 * 같은 결과가 나온다.
 *
 * @param {Array<{ id: string, number: number|null, bounds: object, block: object }>} items
 * @param {{ gap: number, font: number }} sizes - 손상과 라벨 사이 간격, 글자 높이(화살촉 크기)
 * @returns {Map<string, { anchor: number[], box: object, displaced: boolean, leader: object|null }>}
 */
export function placeLabels(items, { gap, font }) {
  const order = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.bounds && item.block)
    .slice()
    .sort((a, b) => orderKey(a) - orderKey(b) || compareId(String(a.id), String(b.id)));

  const obstacles = order.map((item) => ({ id: String(item.id), box: boxOfBounds(item.bounds) }));
  const placedBoxes = [];
  const result = new Map();

  for (const item of order) {
    const id = String(item.id);
    const candidates = candidatePlacements(item.bounds, item.block, gap);
    const window = windowOf(candidates);
    // 자기 손상은 장애물에서 뺀다(4.1).
    const near = obstacles.filter((o) => o.id !== id && boxesOverlap(window, o.box)).map((o) => o.box);
    const nearPlaced = placedBoxes.filter((box) => boxesOverlap(window, box));

    let chosen = null;
    for (const candidate of candidates) {
      let free = true;
      for (const box of near) {
        if (boxesOverlap(candidate.box, box)) {
          free = false;
          break;
        }
      }
      if (free) {
        for (const box of nearPlaced) {
          if (boxesOverlap(candidate.box, box)) {
            free = false;
            break;
          }
        }
      }
      if (free) {
        chosen = candidate;
        break;
      }
    }
    // k = 8까지 다 막혀 있으면 위로 8h 자리를 그냥 쓴다 — 겹치더라도 라벨은 반드시 그린다(4.3).
    if (!chosen) {
      const anchor = upAnchor(item.bounds, item.block, gap, MAX_STEPS);
      chosen = { place: 'up', anchor, box: blockBoxAt(item.block, anchor) };
    }

    const displaced = chosen.place !== 'base';
    placedBoxes.push(chosen.box);
    result.set(id, {
      anchor: chosen.anchor,
      box: chosen.box,
      displaced,
      leader: displaced ? leaderFor(chosen.box, item.bounds, font) : null,
    });
  }

  return result;
}
