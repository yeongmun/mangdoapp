// 손상 옆 라벨을 도면 실치수(mm)로 배치한다.
//
// 배치 규칙을 베껴 쓰지 않는다 — 앱 화면이 쓰는 labelLayout.js를 그대로 부른다. 그 모듈의
// 좌표계가 도면 방향(y가 위로 증가)이라 여기서는 부호를 건드릴 일이 없다. 화면 픽셀로의
// 뒤집기는 overlay.js가 placeBlock(yDir = -1)로 할 뿐이다.
//
// placeBlock이 주는 y는 글자의 베이스라인이다. 산출 TEXT는 수직 중간 정렬(73=2)을 쓰므로
// 정렬점은 베이스라인에서 글자 높이 × BASELINE_CENTER_FACTOR만큼 위다 — 번호 원의 중심을
// 잡는 데 쓰는 바로 그 값이라 원과 글자가 같은 줄에 놓인다.
//
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2~4장

import { boundsOf } from '../../public/viewer/geometry.js';
import { placeLabels } from '../../public/viewer/labelCollision.js';
import {
  BASELINE_CENTER_FACTOR,
  labelBlock,
  placeBlock,
} from '../../public/viewer/labelLayout.js';
import { CIRCLE_RADIUS_FACTOR, copyBoundsOf, FONT_HEIGHT_MM, LABEL_GAP_MM } from '../../public/viewer/overlay.js';
import { dimensionTextOf, drawingNameOf, photoTextOf } from '../../public/viewer/quantities.js';
import { dwgPointsOf } from './damageEntities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, PHOTO_COLOR, PHOTO_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, lineEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';

export interface LabelTextLine {
  position: Point;
  text: string;
  align: 'center' | 'left';
  /** 'number' | 'name' | 'dimension' | 'photo' — 사진 줄만 다른 레이어·색으로 나간다 */
  key: string;
}

const CIRCLE_RADIUS_MM = FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR;
// 베이스라인 → 중간 정렬점까지의 거리(도면 mm)
const BASELINE_TO_MIDDLE_MM = FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR;

export interface LabelLeader {
  from: Point;
  to: Point;
  /** 끝점에서 뻗는 화살촉 점 둘 */
  head: [Point, Point];
}

export interface DamageLabel {
  circle: { center: Point; radius: number } | null;
  lines: LabelTextLine[];
  height: number;
  /** 기본 자리를 벗어난 라벨에만 있다(설계 4.4) */
  leader: LabelLeader | null;
}

export interface LabelItem {
  id: string;
  number: number | null;
  damage: unknown;
}

// 손상 전체를 한 번에 배치한다 — 겹침 방지는 다른 손상을 모두 알아야 계산할 수 있다.
// dwg 좌표가 없는 손상은 도면에 놓지 못하므로 Map에 넣지 않는다.
export function damageLabels(items: LabelItem[]): Map<string, DamageLabel> {
  const entries = [];
  const obstacles = [];
  for (const item of items) {
    const points = dwgPointsOf(item.damage);
    if (!points) continue;
    const bounds = boundsOf(points);
    if (!bounds) continue;
    // 복제본 경계상자는 라벨을 받지 않고 막기만 한다(설계 3.4). 화면의 computeLabelPlacements와
    // 같은 함수(copyBoundsOf)로 같은 순서에 넣어야 두 곳이 같은 답을 낸다.
    obstacles.push(...copyBoundsOf(item.damage));
    entries.push({
      id: item.id,
      number: item.number,
      bounds,
      block: labelBlock({
        name: drawingNameOf(item.damage),
        dimension: dimensionTextOf(item.damage),
        photo: photoTextOf(item.damage),
        number: item.number,
        font: FONT_HEIGHT_MM,
        circleR: CIRCLE_RADIUS_MM,
      }),
    });
  }

  const placements = placeLabels(entries, { gap: LABEL_GAP_MM, font: FONT_HEIGHT_MM, obstacles });
  const labels = new Map<string, DamageLabel>();
  for (const entry of entries) {
    const placement = placements.get(entry.id);
    if (!placement) continue;
    // 도면은 y가 위로 증가하고 배치 모듈도 같은 방향이라 부호를 건드릴 일이 없다.
    // placeLabels의 JSDoc은 anchor를 number[]로만 적어 뒀다(labelCollision.js는 이 Task의 수정
    // 대상이 아니다) — placeBlock은 튜플을 받으므로 여기서만 좁혀 준다.
    const placed = placeBlock(entry.block, placement.anchor as Point);
    labels.set(entry.id, {
      circle: placed.circle ? { center: [placed.circle.cx, placed.circle.cy] as Point, radius: placed.circle.r } : null,
      lines: placed.lines.map((line) => ({
        // TEXT는 수직 중간 정렬(73=2)이라 정렬점은 베이스라인에서 글자 높이 × 0.35 위다.
        position: [line.x, line.y + BASELINE_TO_MIDDLE_MM] as Point,
        text: line.text,
        align: line.anchor === 'middle' ? 'center' : 'left',
        key: line.key,
      })),
      height: FONT_HEIGHT_MM,
      leader: placement.leader as LabelLeader | null,
    });
  }
  return labels;
}

// 손상 하나짜리 겉포장. 막는 것이 없으므로 언제나 기본 자리에 놓인다.
export function damageLabel(damage: unknown, number: number | null): DamageLabel | null {
  const id = String((damage as { id?: unknown } | null)?.id ?? '');
  return damageLabels([{ id, number, damage }]).get(id) ?? null;
}

function baseFor(alloc: HandleAllocator, owner: string, layer: string, colorIndex: number): EntityBase {
  return { handle: alloc.next(), owner, layer, colorIndex };
}

export function labelEntities(label: DamageLabel, alloc: HandleAllocator, owner: string): DxfPair[] {
  const pairs: DxfPair[] = [];
  if (label.circle) {
    pairs.push(...circleEntity(baseFor(alloc, owner, DAMAGE_LAYER, DAMAGE_COLOR), label.circle.center, label.circle.radius));
  }
  for (const line of label.lines) {
    if (line.text === '') continue;
    // 사진 줄만 노란 `사진번호` 레이어로 낸다 — 캐드에서 따로 켜고 끌 수 있어야 한다(설계 3장).
    const isPhoto = line.key === 'photo';
    const base = baseFor(alloc, owner, isPhoto ? PHOTO_LAYER : DAMAGE_LAYER, isPhoto ? PHOTO_COLOR : DAMAGE_COLOR);
    pairs.push(...textEntity(base, line.position, label.height, line.text, line.align));
  }
  // 화살대 1개 + 화살촉 2개 = LINE 3개(설계 4.4).
  if (label.leader) {
    const { from, to, head } = label.leader;
    for (const [a, b] of [[from, to], [head[0], to], [head[1], to]] as Array<[Point, Point]>) {
      pairs.push(...lineEntity(baseFor(alloc, owner, DAMAGE_LAYER, DAMAGE_COLOR), a, b));
    }
  }
  return pairs;
}
