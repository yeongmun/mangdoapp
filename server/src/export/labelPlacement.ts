// 손상 옆 라벨을 도면 실치수(mm)로 배치한다.
//
// 배치 규칙을 베껴 쓰지 않는다 — 앱 화면이 쓰는 overlay.js의 labelAnchor·labelLayout을
// 그대로 부른다. 두 함수는 화면 좌표계(y가 아래로 증가)를 전제하므로 도면 좌표의 y 부호를
// 뒤집어 넣고 결과의 y를 다시 뒤집는다. 그러면 "도형 위쪽 바깥에 위로 쌓기"가 도면에서도
// 그대로 성립한다.
//
// labelLayout이 주는 y는 글자의 베이스라인이다. 산출 TEXT는 수직 중간 정렬(73=2)을 쓰므로
// 정렬점은 베이스라인에서 글자 높이 × BASELINE_CENTER_FACTOR만큼 위다 — overlay가 번호 원의
// 중심을 잡는 데 쓰는 바로 그 값이라 원과 글자가 같은 줄에 놓인다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 6장,
//       docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2·§9.5

import {
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
  LABEL_GAP_MM,
  labelAnchor,
  labelLayout,
} from '../../public/viewer/overlay.js';
import { dimensionTextOf, drawingNameOf, photoTextOf } from '../../public/viewer/quantities.js';
import { dwgPointsOf } from './damageEntities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';

export interface LabelTextLine {
  position: Point;
  text: string;
  align: 'center' | 'left';
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

  // 화면 좌표계로 넘기기 위해 y를 뒤집는다.
  const flipped = points.map(([x, y]) => [x, -y] as Point);
  const anchor = labelAnchor(flipped, LABEL_GAP_MM);
  const layout = labelLayout({
    anchor,
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    fontPx: FONT_HEIGHT_MM,
    circleRPx: CIRCLE_RADIUS_MM,
  });

  const circle = layout.circle
    ? { center: [layout.circle.cx, -layout.circle.cy] as Point, radius: layout.circle.r }
    : null;

  const lines: LabelTextLine[] = layout.lines.map((line: { x: number; y: number; text: string; anchor: string }) => ({
    // 뒤집힌 좌표계에서 "위"는 y가 작아지는 쪽이다. 중간 정렬점은 베이스라인보다 위.
    position: [line.x, -(line.y - BASELINE_TO_MIDDLE_MM)] as Point,
    text: line.text,
    align: line.anchor === 'middle' ? 'center' : 'left',
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
