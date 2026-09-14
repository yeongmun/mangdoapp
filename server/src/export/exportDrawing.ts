// 원본 DXF 글자 + 손상 문서 → 산출 DXF 글자. HTTP는 모른다.
// 번호는 computeNumbers가 geometry.world로 계산한 결과를 그대로 쓴다 — geometry.dwg로 다시
// 매기면 페이지→모델 변환의 회전·반전 때문에 앱 화면의 번호와 어긋날 수 있다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4~8·10장

import { computeNumbers } from '../../public/viewer/quantities.js';
import { damageEntities, dwgPointsOf } from './damageEntities.js';
import {
  createHandleAllocator,
  DAMAGE_COLOR,
  DAMAGE_LAYER,
  ensureLayer,
  findSection,
  findTable,
  headerValue,
  insertEntities,
  parseDxf,
  recordHandle,
  serializeDxf,
  setHeaderValue,
  type DxfDocument,
  type DxfPair,
} from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { damageLabel, labelEntities } from './labelPlacement.js';
import { COLUMN_COUNT, fillTable, rowValuesOf, type TableRow } from './tableFill.js';
import { buildGrid, findTableCandidates, hasUniformScale, nearestTable } from './tableGrid.js';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export const EXPORT_WARNINGS = {
  noTable: '표 없음',
  unknownTable: '표 모양을 알 수 없음',
  units: '도면 단위 확인 필요',
} as const;

export interface ExportResult {
  dxfText: string;
  /** geometry.dwg가 없어 도면에 놓지 못한 손상 수 */
  skipped: number;
  warnings: string[];
}

// mm(4), 없음(0), 인치(1)만 허용한다. 인치는 캐드 기본값이 남은 것이라 실제로는 mm다(스펙 10장).
const ALLOWED_INSUNITS = new Set([0, 1, 4]);

function boundsCenter(pointGroups: Point[][]): Point {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of pointGroups) {
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return [0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// 새 엔티티의 소유자(코드 330)는 모델 공간 블록 레코드의 핸들이다.
function recordHandleOrThrow(doc: DxfDocument): string {
  const handle = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space');
  if (!handle) throw new ExportError('DXF 파일에서 모델 공간 블록 레코드를 찾을 수 없습니다');
  return handle;
}

export function exportDamagesToDxf(dxfText: string, damages: unknown[]): ExportResult {
  const list = Array.isArray(damages) ? damages : [];
  if (list.length === 0) throw new ExportError('표기한 손상이 없습니다');

  const doc = parseDxf(dxfText);
  // 고칠 자리가 없는 파일은 여기서 멈춘다 — 반쯤 고친 DXF를 내보내지 않는다.
  // 아래 findSection/findTable 가드는 insertEntities·ensureLayer가 실패 시 던지는 이름 없는
  // Error를 대신한다 — 그 두 함수의 예외는 이 가드들 덕분에 실제로는 일어나지 않는다(도달 불가).
  // ExportError로 미리 막아 두지 않으면 라우트(Task 10)에서 400이 아닌 500으로 보인다.
  if (!findSection(doc, 'ENTITIES')) throw new ExportError('DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다');
  if (!findTable(doc, 'LAYER')) throw new ExportError('DXF 파일에서 LAYER 표를 찾을 수 없습니다');

  const warnings: string[] = [];

  const insUnits = Number(headerValue(doc, '$INSUNITS')?.trim() ?? '');
  if (!Number.isFinite(insUnits) || !ALLOWED_INSUNITS.has(insUnits)) warnings.push(EXPORT_WARNINGS.units);

  // 번호는 dwg가 없는 손상까지 포함한 전체 목록에서 world 좌표로 매긴다.
  const numbers = computeNumbers(list);
  let maxNumber = 0;
  for (const value of numbers.values()) if (value > maxNumber) maxNumber = value;

  const included: Array<{ damage: unknown; number: number; points: Point[] }> = [];
  let skipped = 0;
  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id);
    const number = numbers.get(id) ?? 0;
    const points = dwgPointsOf(damage);
    if (!points) {
      skipped += 1;
      continue;
    }
    included.push({ damage, number, points });
  }
  included.sort((a, b) => a.number - b.number);

  const alloc = createHandleAllocator(doc);
  ensureLayer(doc, alloc, DAMAGE_LAYER, DAMAGE_COLOR);
  const owner = recordHandleOrThrow(doc);

  const pairs: DxfPair[] = [];
  for (const entry of included) {
    pairs.push(...damageEntities(entry.damage, alloc, owner));
    const label = damageLabel(entry.damage, entry.number > 0 ? entry.number : null);
    if (label) pairs.push(...labelEntities(label, alloc, owner));
  }

  const candidates = findTableCandidates(doc);
  if (candidates.length === 0) {
    warnings.push(EXPORT_WARNINGS.noTable);
  } else {
    const center = boundsCenter(included.map((entry) => entry.points));
    const candidate = nearestTable(candidates, center)!;
    if (!hasUniformScale(candidate.transform)) {
      throw new ExportError('표의 배율이 가로·세로가 달라 채울 수 없습니다');
    }
    const grid = buildGrid(doc, candidate);
    if (!grid) {
      warnings.push(EXPORT_WARNINGS.unknownTable);
    } else {
      // fillTable의 호출 규칙(tableFill.ts의 fillTable JSDoc): 1부터 최댓값까지 모든 번호의
      // 행을 넘겨야 한다. geometry.dwg가 없어 건너뛴 손상의 번호도 표에서는 그대로 자리를
      // 차지하고(칸은 전부 빈 문자열), 그래야 그 번호가 속한 넘침 표의 틀이 흔들리지 않고
      // 계속 그려진다.
      const byNumber = new Map(included.map((entry) => [entry.number, entry.damage] as const));
      const rows: TableRow[] = [];
      for (let number = 1; number <= maxNumber; number++) {
        const damage = byNumber.get(number);
        rows.push(damage !== undefined ? rowValuesOf(damage, number) : { number, cells: new Array(COLUMN_COUNT).fill('') });
      }
      pairs.push(...fillTable(grid, rows, alloc, owner));
    }
  }

  insertEntities(doc, pairs);
  setHeaderValue(doc, '$HANDSEED', alloc.seed);
  return { dxfText: serializeDxf(doc), skipped, warnings };
}
