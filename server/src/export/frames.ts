// 망도틀을 찾아 영역과 그 틀의 손상물량표를 돌려준다. 표는 블록 안에 들어 있거나(옛 구조)
// 블록 영역 안의 모델 공간에 놓여 있다(새 구조, 2026-10-02 설계). 새 구조에서 표를 감싸는
// INSERT가 여럿이면(테두리·망도틀) 영역 면적이 가장 작은 INSERT가 표를 받는다(설계 3장).
// 블록 이름으로 찾지 않는다 — 다른 현장 도면에서도 동작해야 한다(설계 1장 사용자 결정).
// 근거: docs/superpowers/specs/2026-09-16-frame-numbering-design.md 2장

import type { DxfDocument } from './dxfDocument.js';
import { arcExtentPoints } from './entityTransform.js';
import type { Point } from './dxfEntities.js';
import {
  applyTransform,
  IDENTITY,
  insertTransform,
  numberAt,
  numbersAt,
  readModelSpace,
  tableCandidateOf,
  tableCenter,
  textAt,
  walkInserts,
  type RawEntity,
  type TableCandidate,
  type Transform,
} from './tableGrid.js';
import { existingTableOf, type ExistingTable } from './tableRead.js';

/** 틀의 영역(mm, 모델 좌표). 앱까지 이 모양 그대로 간다(DrawingRecord.frames) */
export interface FrameBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /**
   * 표에 이미 적힌 기존 손상 행의 마지막 번호. 신규 손상은 이 다음부터 매긴다(computeNumbers).
   * 기존 행이 없으면 넣지 않는다 — 옛 레코드·기기 index와 모양이 같게.
   */
  startNumber?: number;
}

export interface Frame {
  /** 왼쪽부터 0. 화면·산출이 손상을 배정할 때 쓰는 번호다 */
  index: number;
  bounds: FrameBounds;
  /** 이 틀 안에서 처음 만난 표 */
  table: TableCandidate;
  /** 이 틀을 만든 INSERT가 가리키는 블록 이름 (넘침 장에서 이 블록을 펼친다) */
  blockName: string;
  /** 모델 공간 최상위 엔티티 목록에서 이 틀 INSERT의 순번. 핸들이 겹쳐도 틀리지 않는다 */
  entityIndex: number;
  /** 틀 INSERT의 삽입 변환(블록 좌표 → 모델 좌표) */
  transform: Transform;
  /** 표가 블록 안에 있는 옛 구조인지, 블록 밖 모델 공간에 놓인 새 구조인지(2026-10-02 설계 3장) */
  tableKind: 'inBlock' | 'modelSpace';
  /** modelSpace일 때 그 ACAD_TABLE의 모델 공간 최상위 순번. inBlock이면 null */
  tableEntityIndex: number | null;
  /** 표에 이미 적힌 기존 손상(전차 점검). 셀이 없거나 머리글을 못 읽으면 null */
  existing: ExistingTable | null;
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
export function boundsPointsOf(entity: RawEntity): Point[] {
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
    case 'CIRCLE': {
      const x = numberAt(entity, 10, 0);
      const y = numberAt(entity, 20, 0);
      const r = Math.abs(numberAt(entity, 40, 0));
      return corners(x - r, y - r, x + r, y + r);
    }
    case 'ARC':
      // 호는 실제로 지나는 영역만. 원 전체로 잡으면 반지름이 아주 큰 완만한 호(곡선 교량 거더선)의
      // 중심이 도면 밖으로 가 틀 소속 판정이 틀린다(entityTransform.arcExtentPoints 참고).
      return arcExtentPoints(
        numberAt(entity, 10, 0),
        numberAt(entity, 20, 0),
        Math.abs(numberAt(entity, 40, 0)),
        numberAt(entity, 50, 0),
        numberAt(entity, 51, 360),
      );
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

interface LooseTable {
  entityIndex: number;
  candidate: TableCandidate;
  center: Point;
}

interface OpenInsert {
  entityIndex: number;
  bounds: FrameBounds;
  blockName: string;
  transform: Transform;
}

export function findFrames(doc: DxfDocument): Frame[] {
  const model = readModelSpace(doc);
  if (!model) return [];

  // 모델 공간 최상위 표(새 구조). 블록 안에 표가 없는 INSERT가 영역 안의 표를 고를 때 쓴다.
  const looseTables: LooseTable[] = [];
  for (let i = 0; i < model.entities.length; i++) {
    const entity = model.entities[i];
    if (entity.type !== 'ACAD_TABLE') continue;
    const candidate = tableCandidateOf(entity, IDENTITY);
    if (candidate) looseTables.push({ entityIndex: i, candidate, center: tableCenter(candidate) });
  }

  const found: Array<Omit<Frame, 'index'>> = [];
  // 블록 안에 표가 없는 INSERT(새 구조의 틀 후보). 표 배정은 모두 모은 뒤 한꺼번에 한다.
  const openInserts: OpenInsert[] = [];
  for (let entityIndex = 0; entityIndex < model.entities.length; entityIndex++) {
    const entity = model.entities[entityIndex];
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
    const tableEntities: RawEntity[] = [];
    const transform = insertTransform(entity);

    // 최상위 INSERT는 이미 한 단계 내려온 것이므로 depth 1, seen에 자기 블록 이름을 넣고 시작한다.
    walkInserts(model, contents, transform, 1, new Set([name]), (child, childTransform) => {
      if (child.type === 'ACAD_TABLE' && tables.length === 0) {
        const candidate = tableCandidateOf(child, childTransform);
        if (candidate) {
          tables.push(candidate);
          tableEntities.push(child);
        }
      }
      for (const point of boundsPointsOf(child)) {
        const [x, y] = applyTransform(childTransform, point);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    });

    // 블록 안에 표가 있으면(옛 구조) 그 표가 이 INSERT의 표다 — 영역 안 모델 공간 표보다 앞선다.
    if (tables.length > 0) {
      found.push({
        bounds: { minX, minY, maxX, maxY },
        table: tables[0],
        blockName: name,
        entityIndex,
        transform,
        tableKind: 'inBlock',
        tableEntityIndex: null,
        existing: existingTableOf(doc.pairs, tableEntities[0]),
      });
      continue;
    }
    if (minX === Infinity) continue; // 점이 없는 블록은 영역이 없다
    openInserts.push({ entityIndex, bounds: { minX, minY, maxX, maxY }, blockName: name, transform });
  }

  // 표 중심이 영역 안(경계 포함)에 놓인 (표, INSERT) 짝을 모두 만든다. 한 표가 여러 INSERT 영역에
  // 들 수 있다 — 실제 템플릿은 틀마다 테두리 INSERT 둘과 망도틀이 모두 표를 감싼다.
  const pairs: Array<{ table: LooseTable; insert: OpenInsert; area: number }> = [];
  for (const table of looseTables) {
    const [cx, cy] = table.center;
    for (const insert of openInserts) {
      const { minX, minY, maxX, maxY } = insert.bounds;
      if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
      pairs.push({ table, insert, area: (maxX - minX) * (maxY - minY) });
    }
  }
  // 영역 면적이 가장 작은 INSERT가 표를 받는다. 같으면 중심 x가 작은 표, 그다음 INSERT 순번.
  // 한 표는 한 틀에만, 한 INSERT는 표 하나만 받는다(설계 3장).
  pairs.sort(
    (a, b) =>
      a.area - b.area ||
      a.table.center[0] - b.table.center[0] ||
      a.insert.entityIndex - b.insert.entityIndex,
  );
  const claimedTables = new Set<number>();
  const claimedInserts = new Set<number>();
  for (const { table, insert } of pairs) {
    if (claimedTables.has(table.entityIndex) || claimedInserts.has(insert.entityIndex)) continue;
    claimedTables.add(table.entityIndex);
    claimedInserts.add(insert.entityIndex);
    found.push({
      bounds: insert.bounds,
      table: table.candidate,
      blockName: insert.blockName,
      entityIndex: insert.entityIndex,
      transform: insert.transform,
      tableKind: 'modelSpace',
      tableEntityIndex: table.entityIndex,
      existing: existingTableOf(doc.pairs, model.entities[table.entityIndex]),
    });
  }

  // 왼쪽 → 오른쪽, 같으면 위 → 아래. 이 순서가 인덱스다(설계 2장).
  found.sort((a, b) => a.bounds.minX - b.bounds.minX || b.bounds.maxY - a.bounds.maxY);
  return found.map((frame, index) => {
    const startNumber = frame.existing?.startNumber ?? 0;
    // 기존 행이 있을 때만 bounds에 startNumber를 싣는다 — 화면·산출·원장이 같은 값으로 번호를 잇는다.
    const bounds = startNumber > 0 ? { ...frame.bounds, startNumber } : frame.bounds;
    return { ...frame, bounds, index };
  });
}
