// 망도틀(= 안에 손상물량표가 든 삽입 블록)을 찾아 영역과 그 안의 표를 돌려준다.
// 블록 이름으로 찾지 않는다 — 다른 현장 도면에서도 동작해야 한다(설계 1장 사용자 결정).
// 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 2장

import type { DxfDocument } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import {
  applyTransform,
  insertTransform,
  numberAt,
  numbersAt,
  readModelSpace,
  tableCandidateOf,
  textAt,
  walkInserts,
  type RawEntity,
  type TableCandidate,
} from './tableGrid.js';

/** 틀의 영역(mm, 모델 좌표). 앱까지 이 모양 그대로 간다(DrawingRecord.frames) */
export interface FrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Frame {
  /** 왼쪽부터 0. 화면·산출이 손상을 배정할 때 쓰는 번호다 */
  index: number;
  bounds: FrameBounds;
  /** 이 틀 안에서 처음 만난 표 */
  table: TableCandidate;
}

// 축 정렬 상자의 네 모서리. 회전한 삽입에서는 대각 두 점만으로 영역이 좁아진다.
function corners(minX: number, minY: number, maxX: number, maxY: number): Point[] {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

// 경계상자를 만들 때 쓰는 점(블록 좌표). HATCH는 뺀다 — 경계가 복잡하고 늘 다른 도형과
// 겹치므로 영역을 넓히는 데 보탬이 되지 않는다(설계 2장). INSERT는 walkInserts가 안으로
// 내려가 주므로 여기서는 점을 내지 않는다.
function entityPoints(entity: RawEntity): Point[] {
  switch (entity.type) {
    case 'LINE':
      return [
        [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        [numberAt(entity, 11, 0), numberAt(entity, 21, 0)],
      ];
    case 'LWPOLYLINE': {
      const xs = numbersAt(entity, 10);
      const ys = numbersAt(entity, 20);
      const points: Point[] = [];
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) points.push([xs[i], ys[i]]);
      return points;
    }
    case 'CIRCLE':
    case 'ARC': {
      // 호도 원 전체로 넉넉히 잡는다 — 영역이 조금 넓은 것은 괜찮지만 좁으면 손상을 놓친다.
      const x = numberAt(entity, 10, 0);
      const y = numberAt(entity, 20, 0);
      const r = Math.abs(numberAt(entity, 40, 0));
      return corners(x - r, y - r, x + r, y + r);
    }
    case 'TEXT':
    case 'MTEXT':
      return [[numberAt(entity, 10, 0), numberAt(entity, 20, 0)]];
    case 'ACAD_TABLE': {
      // 표는 삽입점에서 오른쪽·아래로 자란다(열 너비 합 × 행 높이 합).
      const x = numberAt(entity, 10, 0);
      const y = numberAt(entity, 20, 0);
      const width = numbersAt(entity, 142).reduce((sum, w) => sum + w, 0);
      const height = numbersAt(entity, 141).reduce((sum, h) => sum + h, 0);
      return corners(x, y - height, x + width, y);
    }
    default:
      return [];
  }
}

export function findFrames(doc: DxfDocument): Frame[] {
  const model = readModelSpace(doc);
  if (!model) return [];

  const found: Array<{ bounds: FrameBounds; table: TableCandidate }> = [];
  for (const entity of model.entities) {
    if (entity.type !== 'INSERT') continue;
    const name = textAt(entity, 2);
    if (!name) continue;
    const contents = model.blocks.get(name);
    if (!contents) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    // 표는 배열에 담는다 — let 변수에 콜백 안에서 대입하면 TypeScript의 흐름 분석이 그 대입을
    // 보지 못해 호출 뒤에도 타입이 null로 남는다.
    const tables: TableCandidate[] = [];

    // 최상위 INSERT는 이미 한 단계 내려온 것이므로 depth 1, seen에 자기 블록 이름을 넣고 시작한다.
    walkInserts(model, contents, insertTransform(entity), 1, new Set([name]), (child, transform) => {
      if (child.type === 'ACAD_TABLE' && tables.length === 0) {
        const candidate = tableCandidateOf(child, transform);
        if (candidate) tables.push(candidate);
      }
      for (const point of entityPoints(child)) {
        const [x, y] = applyTransform(transform, point);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    });

    if (tables.length === 0) continue;
    found.push({ bounds: { minX, minY, maxX, maxY }, table: tables[0] });
  }

  // 왼쪽 → 오른쪽, 같으면 위 → 아래. 이 순서가 인덱스다(설계 2장).
  found.sort((a, b) => a.bounds.minX - b.bounds.minX || b.bounds.maxY - a.bounds.maxY);
  return found.map((frame, index) => ({ index, bounds: frame.bounds, table: frame.table }));
}
