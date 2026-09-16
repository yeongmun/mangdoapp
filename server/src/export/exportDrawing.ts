// 원본 DXF 글자 + 손상 문서 → 산출 DXF 글자. HTTP는 모른다.
// 번호는 computeNumbers가 geometry.world로 계산한 결과를 그대로 쓴다 — geometry.dwg로 다시
// 매기면 페이지→모델 변환의 회전·반전 때문에 앱 화면의 번호와 어긋날 수 있다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4~8·10장

import { computeNumbers, countOutsideFrames, frameIndexOf } from '../../public/viewer/quantities.js';
import { damageEntities, dwgPointsOf, type DamageEntitiesWarnings } from './damageEntities.js';
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
  PHOTO_COLOR,
  PHOTO_LAYER,
  recordHandle,
  serializeDxf,
  setHeaderValue,
  TABLE_COLOR,
  TABLE_LAYER,
  type DxfDocument,
  type DxfPair,
  type HandleAllocator,
} from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { translatePairs } from './entityTransform.js';
import { findFrames, type Frame } from './frames.js';
import { damageLabels, labelEntities } from './labelPlacement.js';
import {
  copyRegion,
  flattenFrameBlock,
  indexRegions,
  isFlattenable,
  pageOf,
  pagesOf,
  pitchOf,
  readSheetContext,
  shiftGrid,
  shiftRangesInPlace,
  type RegionIndex,
  type SheetContext,
} from './sheetCopy.js';
import { COLUMN_COUNT, fillTable, rowValuesOf, type TableRow } from './tableFill.js';
import {
  buildGrid,
  findTableCandidates,
  hasUniformScale,
  nearestTable,
  type TableCandidate,
  type TableGrid,
} from './tableGrid.js';

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
  circlesTruncated: '균열/백태 원이 1000개에서 잘렸습니다',
  // 개수가 들어가는 유일한 경고라 함수다. 결과는 여전히 문자열이고, 라우트(app.ts)는 그대로
  // warnings.join('; ')으로 X-Mangdo-Warning 헤더에 싣는다.
  outsideFrames: (count: number) =>
    `망도틀 밖 손상 ${count}개는 번호 없이 그려지고 물량표에서 빠집니다`,
  // 넘침 장(설계 7장). 셋 다 정보성이지만 사용자가 알아야 캐드에서 무엇을 볼지 안다.
  sheetCopied: (index: number, pages: number) =>
    `망도틀 ${index + 1}을(를) ${pages}장으로 나눴습니다 (복사본 ${pages - 1}장, 뒤 틀 이동)`,
  sheetCopySkipped: (count: number) =>
    `복사할 수 없는 엔티티 ${count}개(치수·지시선 등)는 복사본에서 빠졌습니다`,
  sheetCopyUnsupported: (index: number) =>
    `망도틀 ${index + 1}은(는) 회전·비균일 배율이라 복사하지 못해 표를 아래에 그렸습니다`,
} as const;

export interface ExportResult {
  dxfText: string;
  /** geometry.dwg가 없어 도면에 놓지 못한 손상 수 */
  skipped: number;
  warnings: string[];
}

// mm(4), 없음(0), 인치(1)만 허용한다. 인치는 캐드 기본값이 남은 것이라 실제로는 mm다(스펙 10장).
const ALLOWED_INSUNITS = new Set([0, 1, 4]);

// R14와 같은 종류의 문제: push(...source)도 splice(...)와 마찬가지로 source를 인자로 펼친다.
// fillTable은 손상 수천 개 분량의 넘침 표를 한 배열로 돌려줄 수 있어(2,000개 손상 스트레스
// 테스트에서 실측) 그대로 pairs.push(...fillTable(...))를 쓰면 여기서도 "Maximum call stack
// size exceeded"가 난다. 인자 전개 없이 하나씩 옮겨 붙인다.
function appendAll(target: DxfPair[], source: DxfPair[]): void {
  for (const p of source) target.push(p);
}

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
  // 손상이 하나도 없거나(이 시점에선 도달하지 않는다) 전부 dwg가 없어 건너뛰면 점이 하나도
  // 없다. 원점 (0,0)을 기준으로 보면 원점에 가장 가까운 표가 골라질 뿐, 그 표에는 아무 값도
  // 쓰이지 않는다(rows가 비어 있으므로) — 엉뚱한 표를 "고른" 것처럼 보이지만 결과에는 영향이
  // 없다.
  if (minX === Infinity) return [0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// 새 엔티티의 소유자(코드 330)는 모델 공간 블록 레코드의 핸들이다.
function recordHandleOrThrow(doc: DxfDocument): string {
  const handle = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space');
  if (!handle) throw new ExportError('DXF 파일에서 모델 공간 블록 레코드를 찾을 수 없습니다');
  return handle;
}

/** 도면에 놓을 수 있는(도면 좌표가 있는) 손상 하나 */
interface Included {
  id: string;
  damage: unknown;
  /** 틀 안이면 그 틀에서의 번호(1부터), 틀 밖이면 0 */
  number: number;
  points: Point[];
  /** 틀이 없는 도면에서는 모두 null이다 */
  frameIndex: number | null;
}

// 1부터 maxNumber까지 빠짐없는 행 목록. fillTable의 호출 규칙(tableFill.ts의 JSDoc)이다 —
// 번호가 빠지면 그 번호가 속한 넘침 표의 틀이 그려지지 않는다. 틀이 있는 도면에서는 번호를
// 받은 손상이 모두 표에 들어가므로 빈 행이 생기지 않고, 틀이 없는 도면에서만 dwg가 없어
// 건너뛴 손상의 자리가 빈 행으로 남는다.
function rowsFor(entries: Included[], maxNumber: number): TableRow[] {
  const byNumber = new Map(entries.map((entry) => [entry.number, entry.damage] as const));
  const rows: TableRow[] = [];
  for (let number = 1; number <= maxNumber; number++) {
    const damage = byNumber.get(number);
    rows.push(damage !== undefined ? rowValuesOf(damage, number) : { number, cells: new Array(COLUMN_COUNT).fill('') });
  }
  return rows;
}

// 표 격자를 만든다. 배율이 어긋나면 던지고(설계 6장), 격자를 읽지 못하면 경고만 붙인다.
function gridFor(doc: DxfDocument, candidate: TableCandidate, warnings: string[]): TableGrid | null {
  if (!hasUniformScale(candidate.transform)) {
    throw new ExportError('표의 배율이 가로·세로가 달라 채울 수 없습니다');
  }
  const grid = buildGrid(doc, candidate);
  if (!grid) {
    // 틀이 여럿이면 같은 경고가 여러 번 나올 수 있다. 한 번만 알린다.
    if (!warnings.includes(EXPORT_WARNINGS.unknownTable)) warnings.push(EXPORT_WARNINGS.unknownTable);
    return null;
  }
  return grid;
}

// 틀이 없는 도면 전용 — 표 하나를 골라 채운다.
function fillCandidate(
  doc: DxfDocument,
  candidate: TableCandidate,
  rows: TableRow[],
  alloc: HandleAllocator,
  owner: string,
  warnings: string[],
): DxfPair[] {
  const grid = gridFor(doc, candidate, warnings);
  return grid ? fillTable(grid, rows, alloc, owner) : [];
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

  // 틀은 레코드가 아니라 원본에서 다시 구한다 — 원본이 곧 진실이다(설계 6장).
  const frames = findFrames(doc);
  const frameBounds = frames.map((frame) => frame.bounds);

  // 번호는 dwg가 없는 손상까지 포함한 전체 목록에서 world 좌표로 매긴다. 틀이 있으면 틀마다
  // 1번부터이고 틀 밖 손상은 Map에 없다(설계 5장). 틀이 없으면 예전과 똑같다.
  const numbers = computeNumbers(list, frameBounds);
  let maxNumber = 0;
  for (const value of numbers.values()) if (value > maxNumber) maxNumber = value;

  const included: Included[] = [];
  let skipped = 0;
  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id);
    const number = numbers.get(id) ?? 0;
    const points = dwgPointsOf(damage);
    if (!points) {
      skipped += 1;
      continue;
    }
    included.push({ id, damage, number, points, frameIndex: frameIndexOf(damage, frameBounds) });
  }
  included.sort((a, b) => a.number - b.number);

  const alloc = createHandleAllocator(doc);
  ensureLayer(doc, alloc, DAMAGE_LAYER, DAMAGE_COLOR);
  // 사진 줄이 있든 없든 만들어 둔다 — 있는지 미리 훑어 조건을 나누면 같은 도면을 두 번 산출했을
  // 때 레이어 목록이 달라진다.
  ensureLayer(doc, alloc, PHOTO_LAYER, PHOTO_COLOR);
  // 표에 채울 값이 있든 없든 만들어 둔다 — 사진번호 레이어와 같은 이유(레이어 목록을 늘 같게).
  ensureLayer(doc, alloc, TABLE_LAYER, TABLE_COLOR);
  const owner = recordHandleOrThrow(doc);

  /** 틀 하나가 몇 장이 되고 얼마나 오른쪽으로 가는가(설계 7장 2단계) */
  interface FramePlan {
    frame: Frame;
    entries: Included[];
    grid: TableGrid | null;
    /** 표 데이터 행 수 N */
    dataRows: number;
    /** 이 틀에서 가장 큰 손상 번호 */
    maxNumber: number;
    pages: number;
    pitch: number;
    /** 이 틀 자신이 오른쪽으로 가는 거리 = 왼쪽 틀들이 늘어난 만큼의 합 */
    offset: number;
  }

  const plans: FramePlan[] = [];
  let running = 0;
  for (const frame of frames) {
    const entries = included.filter((entry) => entry.frameIndex === frame.index);
    let frameMax = 0;
    for (const entry of entries) if (entry.number > frameMax) frameMax = entry.number;
    // 손상이 없는 틀의 표는 건드리지 않는다 — 격자도 만들지 않는다(기존 동작 그대로).
    const grid = entries.length > 0 ? gridFor(doc, frame.table, warnings) : null;
    const dataRows = grid?.dataRowCount ?? 0;
    let pages = 1;
    if (grid && dataRows > 0 && frameMax > dataRows) {
      if (isFlattenable(frame.transform)) pages = pagesOf(frameMax, dataRows);
      // 회전·비균일 배율인 틀은 펼치지 못한다 — 옛 넘침(표를 아래에)으로 간다(설계 5.2).
      else warnings.push(EXPORT_WARNINGS.sheetCopyUnsupported(frame.index));
    }
    const pitch = pitchOf(frames, frame.index);
    plans.push({ frame, entries, grid, dataRows, maxNumber: frameMax, pages, pitch, offset: running });
    running += (pages - 1) * pitch;
  }

  const planByFrame = new Map(plans.map((plan) => [plan.frame.index, plan] as const));
  // 넘치는 틀이 하나도 없으면 문서를 다시 훑지 않는다 — 4 MB 템플릿에서 헛일이 크다.
  let ctx: SheetContext | null = null;
  let regions: RegionIndex | null = null;
  if (plans.some((plan) => plan.pages > 1)) {
    ctx = readSheetContext(doc, alloc, owner);
    if (ctx) regions = indexRegions(ctx, frames);
    // 문맥을 읽지 못하면(ENTITIES가 없는 파일 — 위에서 이미 막았다) 복사를 포기하고 옛 길로 간다.
    else for (const plan of plans) plan.pages = 1;
  }

  /** 어느 틀에도 속하지 않는 것(틀 밖 손상·잡다한 글자)이 오른쪽으로 가는 거리(설계 6장) */
  function looseShift(centerX: number): number {
    let dx = 0;
    for (const plan of plans) {
      if (plan.pages > 1 && plan.frame.bounds.maxX < centerX) dx += (plan.pages - 1) * plan.pitch;
    }
    return dx;
  }

  /**
   * 이 손상을 어디에 그릴 것인가 — 넘치는 틀은 장마다 그 틀의 손상 전부를 그린다(사용자 결정
   * 2026-09-16, 설계 5.3 갱신). 자기 번호가 속한 장만이 아니라 offset(k) + p × pitch(k)로
   * 장 p = 0…pages-1 전부에 한 번씩 그린다 — 원본 장(p = 0)도 예외가 아니다. 표만 장마다 다르다.
   */
  function damageShiftsOf(entry: Included): number[] {
    if (entry.frameIndex === null) return [looseShift(boundsCenter([entry.points])[0])];
    const plan = planByFrame.get(entry.frameIndex);
    if (!plan) return [0];
    if (plan.pages <= 1 || plan.dataRows <= 0) return [plan.offset];
    const dxs: number[] = [];
    for (let page = 0; page < plan.pages; page++) dxs.push(plan.offset + page * plan.pitch);
    return dxs;
  }

  const pairs: DxfPair[] = [];
  const circleWarnings: DamageEntitiesWarnings = { circlesTruncated: false };
  // 겹침 방지는 다른 손상을 모두 알아야 계산할 수 있으므로, 도형을 만들기 전에 한 번에 구한다
  // (설계 4.2: 번호 순서대로 자리를 잡는다).
  const labels = damageLabels(
    included.map((entry) => ({ id: entry.id, number: entry.number > 0 ? entry.number : null, damage: entry.damage })),
  );
  for (const entry of included) {
    const label = labels.get(entry.id);
    for (const dx of damageShiftsOf(entry)) {
      appendAll(pairs, translatePairs(damageEntities(entry.damage, alloc, owner, circleWarnings), dx, 0));
      if (label) appendAll(pairs, translatePairs(labelEntities(label, alloc, owner), dx, 0));
    }
  }
  if (circleWarnings.circlesTruncated) warnings.push(EXPORT_WARNINGS.circlesTruncated);
  // 도면에는 그렸지만 번호를 받지 못한 손상. dwg가 없어 아예 그리지 못한 손상(skipped)은
  // 응답 헤더 X-Mangdo-Skipped로 따로 알리므로 여기서 두 번 세지 않는다.
  const outside = countOutsideFrames(included.map((entry) => entry.damage), frameBounds);
  if (outside > 0) warnings.push(EXPORT_WARNINGS.outsideFrames(outside));

  if (frames.length === 0) {
    // 틀이 없는 도면은 예전 규칙 그대로 — 전체 한 묶음 번호, 손상 중심에서 가장 가까운 표 하나.
    const candidates = findTableCandidates(doc);
    if (candidates.length === 0) {
      warnings.push(EXPORT_WARNINGS.noTable);
    } else {
      const candidate = nearestTable(candidates, boundsCenter(included.map((entry) => entry.points)))!;
      appendAll(pairs, fillCandidate(doc, candidate, rowsFor(included, maxNumber), alloc, owner, warnings));
    }
  } else {
    // 넘치는 틀은 장마다 복사본을 만든다(설계 7장 4단계).
    let copySkipped = 0;
    for (const plan of plans) {
      if (plan.pages <= 1 || !plan.grid || !ctx || !regions) continue;
      warnings.push(EXPORT_WARNINGS.sheetCopied(plan.frame.index, plan.pages));
      for (let page = 1; page < plan.pages; page++) {
        const dx = plan.offset + page * plan.pitch;
        const region = copyRegion(ctx, regions.inFrame[plan.frame.index], dx);
        appendAll(pairs, region.pairs);
        const block = flattenFrameBlock(ctx, plan.frame, plan.grid, page, dx);
        appendAll(pairs, block.pairs);
        copySkipped += region.skipped + block.skipped;
      }
    }
    if (copySkipped > 0) warnings.push(EXPORT_WARNINGS.sheetCopySkipped(copySkipped));

    // 틀마다 자기 표에 그 틀 손상만 1번부터 채운다. 손상이 없는 틀의 표는 건드리지 않는다.
    for (const plan of plans) {
      if (plan.entries.length === 0 || !plan.grid) continue;
      if (plan.pages <= 1) {
        // 넘치지 않는 틀(과 미지원 틀)은 지금까지와 같다 — 넘치면 fillTable이 표를 아래에 쌓는다.
        appendAll(pairs, fillTable(shiftGrid(plan.grid, plan.offset), rowsFor(plan.entries, plan.maxNumber), alloc, owner));
        continue;
      }
      // 장마다 그 장의 표에 1행부터 채운다. 번호 열은 flattenFrameBlock이 이미 썼다(설계 5.4).
      for (let page = 0; page < plan.pages; page++) {
        const dx = plan.offset + page * plan.pitch;
        const pageEntries = plan.entries
          .filter((entry) => pageOf(entry.number, plan.dataRows) === page)
          .map((entry) => ({ ...entry, number: entry.number - page * plan.dataRows }));
        const pageMax = Math.min(plan.dataRows, plan.maxNumber - page * plan.dataRows);
        appendAll(pairs, fillTable(shiftGrid(plan.grid, dx), rowsFor(pageEntries, pageMax), alloc, owner));
      }
    }
  }

  // 오른쪽 틀과 그 영역의 원본 엔티티를 제자리에서 옮긴다(설계 6장).
  // insertEntities보다 **먼저** 해야 한다 — 범위(EntityRange)는 ENTITIES 구역 안의 인덱스이고,
  // insertEntities는 그 구역 끝에 쌍을 이어 붙여 배열을 새로 만든다.
  if (regions && running > 0) {
    for (const plan of plans) {
      if (plan.offset === 0) continue;
      shiftRangesInPlace(doc, regions.inFrame[plan.frame.index], plan.offset);
      const insert = regions.frameInsert[plan.frame.index];
      if (insert) shiftRangesInPlace(doc, [insert], plan.offset);
    }
    // 어느 틀에도 속하지 않는 최상위 엔티티(틀 사이의 글자 등)도 오른쪽에 있으면 같이 민다.
    for (const entry of regions.loose) {
      shiftRangesInPlace(doc, [entry.range], looseShift(entry.centerX));
    }
  }

  insertEntities(doc, pairs);
  setHeaderValue(doc, '$HANDSEED', alloc.seed);
  return { dxfText: serializeDxf(doc), skipped, warnings };
}
