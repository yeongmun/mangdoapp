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
import {
  baseAnchor,
  BASELINE_CENTER_FACTOR,
  labelBlock,
  placeBlock,
} from '../../public/viewer/labelLayout.js';
import { CIRCLE_RADIUS_FACTOR, FONT_HEIGHT_MM, LABEL_GAP_MM } from '../../public/viewer/overlay.js';
import { dimensionTextOf, drawingNameOf, photoTextOf } from '../../public/viewer/quantities.js';
import { dwgPointsOf } from './damageEntities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';

export interface LabelTextLine {
  position: Point;
  text: string;
  align: 'center' | 'left';
  /** 'number' | 'name' | 'dimension' | 'photo' — 사진 줄만 다른 레이어·색으로 나간다 */
  key: string;
}

export interface DamageLabel {
  circle: { center: Point; radius: number } | null;
  lines: LabelTextLine[];
  height: number;
}

const CIRCLE_RADIUS_MM = FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR;
// 베이스라인 → 중간 정렬점까지의 거리(도면 mm)
const BASELINE_TO_MIDDLE_MM = FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR;

export function damageLabel(damage: unknown, number: number | null): DamageLabel | null {
  const points = dwgPointsOf(damage);
  if (!points) return null;
  const bounds = boundsOf(points);
  if (!bounds) return null;

  const block = labelBlock({
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    font: FONT_HEIGHT_MM,
    circleR: CIRCLE_RADIUS_MM,
  });
  const placed = placeBlock(block, baseAnchor(bounds, LABEL_GAP_MM));

  const circle = placed.circle ? { center: [placed.circle.cx, placed.circle.cy] as Point, radius: placed.circle.r } : null;
  const lines: LabelTextLine[] = placed.lines.map((line) => ({
    position: [line.x, line.y + BASELINE_TO_MIDDLE_MM] as Point,
    text: line.text,
    align: line.anchor === 'middle' ? 'center' : 'left',
    key: line.key,
  }));

  return { circle, lines, height: FONT_HEIGHT_MM };
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

export function labelEntities(label: DamageLabel, alloc: HandleAllocator, owner: string): DxfPair[] {
  const pairs: DxfPair[] = [];
  if (label.circle) {
    pairs.push(...circleEntity(baseFor(alloc, owner), label.circle.center, label.circle.radius));
  }
  for (const line of label.lines) {
    if (line.text === '') continue;
    pairs.push(...textEntity(baseFor(alloc, owner), line.position, label.height, line.text, line.align));
  }
  return pairs;
}
