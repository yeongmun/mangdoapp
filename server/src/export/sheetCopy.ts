// 한 망도틀을 통째로 오른쪽에 복사하기 위한 도구들.
// 어떤 최상위 엔티티가 어느 틀 영역인지 가르고, 틀 블록을 펼쳐 모델 공간 엔티티로 만들고,
// 장 수와 틀 간격을 센다. 손상은 모른다 — 손상을 붙이는 일은 exportDrawing.ts가 한다.
// 근거: docs/superpowers/specs/2026-09-16-sheet-overflow-design.md 3~6장

import { type DxfDocument, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { textEntity, type EntityBase, type Point } from './dxfEntities.js';
import {
  copyEntityPairs,
  entityBoundsOf,
  isCopyable,
  transformEntityPairs,
  translateEntityPairs,
  type EntityBounds,
} from './entityTransform.js';
import { boundsPointsOf, type Frame } from './frames.js';
import {
  applyTransform,
  blockEntityRanges,
  cellCenter,
  composeTransform,
  hasUniformScale,
  indexOfBand,
  insertTransform,
  modelSpaceRanges,
  modelTextHeight,
  numberAt,
  rawEntityAt,
  readModelSpace,
  textAt,
  walkInserts,
  type EntityRange,
  type ModelSpace,
  type RawEntity,
  type TableGrid,
  type Transform,
} from './tableGrid.js';

/** 틀이 하나뿐일 때 쓰는 간격 = 틀 너비의 배수(설계 4장) */
const LONE_FRAME_PITCH_FACTOR = 1.1;
/** 색이 적혀 있지 않은 엔티티의 기본 색(ByLayer) */
const BY_LAYER = 256;

/** 번호가 몇 번째 장에 들어가는가. 0장이 원본 틀이다. */
export function pageOf(damageNumber: number, dataRows: number): number {
  if (dataRows <= 0) return 0;
  return Math.max(0, Math.floor((damageNumber - 1) / dataRows));
}

/** 최대 번호가 maxNumber일 때 필요한 장 수. 손상이 없어도 원본 한 장은 있다. */
export function pagesOf(maxNumber: number, dataRows: number): number {
  if (dataRows <= 0 || maxNumber <= 0) return 1;
  return Math.max(1, Math.ceil(maxNumber / dataRows));
}

/**
 * 틀 k의 간격. 다음 틀이 있으면 그 틀과의 minX 차이, 마지막 틀이면 바로 앞 쌍의 간격,
 * 틀이 하나뿐이면 틀 너비 × 1.1이다(설계 4장). 실제 도면의 간격은 균일하지 않으므로
 * 상수 하나로 두지 않는다(조사 1장: 74,943~76,617).
 */
export function pitchOf(frames: Frame[], index: number): number {
  const here = frames[index];
  if (!here) return 0;
  const next = frames[index + 1];
  if (next) return next.bounds.minX - here.bounds.minX;
  const previous = frames[index - 1];
  if (previous) return here.bounds.minX - previous.bounds.minX;
  return (here.bounds.maxX - here.bounds.minX) * LONE_FRAME_PITCH_FACTOR;
}

/**
 * 이 틀 블록을 펼칠 수 있는가. 배율이 가로·세로 같고 양수이며 회전이 0이어야 한다
 * (설계 5.2). 실제 사내 템플릿은 배율 1.2685 균일·회전 0이다.
 */
export function isFlattenable(t: Transform): boolean {
  return hasUniformScale(t) && t.scaleX > 0 && t.rotationRad === 0;
}

/** 표 격자를 x로 dx만큼 옮긴 사본. 이동량이 0이면 원래 격자를 그대로 돌려준다. */
export function shiftGrid(grid: TableGrid, dx: number): TableGrid {
  if (dx === 0) return grid;
  return { ...grid, transform: { ...grid.transform, x: grid.transform.x + dx } };
}

/** 한 번 읽어 두고 여러 장에서 다시 쓰는 문서 색인 */
export interface SheetContext {
  doc: DxfDocument;
  model: ModelSpace;
  /** 모델 공간 최상위 엔티티의 쌍 범위. model.entities와 순서가 같다 */
  ranges: EntityRange[];
  /** 블록 이름 → 그 안 엔티티의 쌍 범위 */
  blocks: Map<string, EntityRange[]>;
  alloc: HandleAllocator;
  /** 새 엔티티의 소유자 = 모델 공간 블록 레코드 핸들 */
  owner: string;
}

export function readSheetContext(doc: DxfDocument, alloc: HandleAllocator, owner: string): SheetContext | null {
  const model = readModelSpace(doc);
  if (!model) return null;
  return { doc, model, ranges: modelSpaceRanges(doc), blocks: blockEntityRanges(doc), alloc, owner };
}

export interface RegionIndex {
  /** 틀 인덱스별, 그 틀 영역에 속하는 최상위 엔티티(틀 INSERT는 뺀다) */
  inFrame: EntityRange[][];
  /** 틀 인덱스별 틀 INSERT 자신 */
  frameInsert: Array<EntityRange | null>;
  /** 어느 틀에도 속하지 않는 최상위 엔티티와 그 경계상자 중심 x */
  loose: Array<{ range: EntityRange; centerX: number }>;
}

function inside(bounds: { minX: number; minY: number; maxX: number; maxY: number }, x: number, y: number): boolean {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

/**
 * 최상위 엔티티의 경계상자. INSERT는 삽입점이 '블록 좌표에 더하는 벡터'라 그대로 쓰면 안 된다
 * (조사 2장 주의) — 블록 안 도형을 삽입 변환으로 옮겨 감싼다. findFrames와 같은 방식이다.
 */
function resolvedBounds(model: ModelSpace, entity: RawEntity, pairs: DxfPair[]): EntityBounds | null {
  if (entity.type !== 'INSERT') return entityBoundsOf(pairs);
  const name = textAt(entity, 2);
  const contents = name ? model.blocks.get(name) : undefined;
  if (!name || !contents) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walkInserts(model, contents, insertTransform(entity), 1, new Set([name]), (child, transform) => {
    for (const point of boundsPointsOf(child)) {
      const [x, y] = applyTransform(transform, point);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * 최상위 엔티티를 한 번만 훑어 틀별로 가른다. 소속 판정은 손상 배정과 같은 규칙이다 —
 * 경계상자 **중심**이 틀 영역 안(경계 포함)이면 그 틀, 여러 틀에 들면 인덱스가 작은 틀(설계 5.1).
 */
export function indexRegions(ctx: SheetContext, frames: Frame[]): RegionIndex {
  const inFrame: EntityRange[][] = frames.map(() => []);
  const frameInsert: Array<EntityRange | null> = frames.map(() => null);
  const loose: Array<{ range: EntityRange; centerX: number }> = [];
  const frameAtEntity = new Map<number, number>();
  for (const frame of frames) frameAtEntity.set(frame.entityIndex, frame.index);

  for (let i = 0; i < ctx.ranges.length; i++) {
    const range = ctx.ranges[i];
    const asFrame = frameAtEntity.get(i);
    if (asFrame !== undefined) {
      frameInsert[asFrame] = range;
      continue;
    }
    const entity = ctx.model.entities[i] ?? rawEntityAt(ctx.doc.pairs, range);
    const bounds = resolvedBounds(ctx.model, entity, ctx.doc.pairs.slice(range.start, range.end));
    if (!bounds) continue; // 점이 없는 엔티티는 옮길 것도 복사할 것도 없다
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const frame = frames.find((f) => inside(f.bounds, centerX, centerY));
    if (frame) inFrame[frame.index].push(range);
    else loose.push({ range, centerX });
  }
  return { inFrame, frameInsert, loose };
}

export interface CopyResult {
  pairs: DxfPair[];
  /** 복사하지 못하고 뺀 엔티티 수(치수·지시선 등) */
  skipped: number;
}

// 인자 전개(push(...source))는 배열이 아주 클 때 호출 스택을 넘긴다(exportDrawing.ts의 주석 참고).
function appendAll(target: DxfPair[], source: DxfPair[]): void {
  for (const p of source) target.push(p);
}

/** 최상위 엔티티 여러 개를 새 핸들로 베껴 x로 dx만큼 옮긴다(설계 5.1). */
export function copyRegion(ctx: SheetContext, ranges: EntityRange[], dx: number): CopyResult {
  const pairs: DxfPair[] = [];
  let skipped = 0;
  for (const range of ranges) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    appendAll(pairs, translateEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), dx, 0));
  }
  return { pairs, skipped };
}

function baseFor(ctx: SheetContext, layer: string, colorIndex: number): EntityBase {
  return { handle: ctx.alloc.next(), owner: ctx.owner, layer, colorIndex };
}

// 이 글자가 번호 열의 **데이터 행** 칸에 있는가(= 미리 인쇄된 번호인가).
function isPrintedNumber(grid: TableGrid, entity: RawEntity): boolean {
  const local: Point = [numberAt(entity, 10, 0), numberAt(entity, 20, 0)];
  if (indexOfBand(grid.colBoundaries, local[0]) !== grid.numberColumn) return false;
  const row = indexOfBand(grid.rowBoundaries, local[1]);
  return row >= grid.firstDataRow;
}

/**
 * 표가 가리키는 `*T` 블록을 펼쳐 넣는다. `ACAD_TABLE` 엔티티 자체는 넣지 않는다 —
 * 한 번 더 INSERT하면 번호 열에 1~N이 그대로 인쇄되기 때문이다(설계 5.2).
 * 이 틀의 표(`grid`)일 때만 번호 열 데이터 행 글자를 빼고 `page·N+1 … page·N+N`을 새로 쓴다.
 */
function flattenTable(
  ctx: SheetContext,
  tablePairs: DxfPair[],
  frameTransform: Transform,
  grid: TableGrid,
  page: number,
  dx: number,
): CopyResult {
  const table = rawEntityAt(tablePairs, { type: 'ACAD_TABLE', start: 0, end: tablePairs.length });
  const blockName = textAt(table, 2);
  const position: Point = [numberAt(table, 10, 0), numberAt(table, 20, 0)];
  const pairs: DxfPair[] = [];
  let skipped = 0;
  if (!blockName) return { pairs, skipped };

  // 표 블록 좌표 → 모델 좌표 = 틀 삽입 변환 ∘ 표 삽입점(배율 1, 회전 0)
  const tableTransform = composeTransform(frameTransform, {
    x: position[0],
    y: position[1],
    scaleX: 1,
    scaleY: 1,
    rotationRad: 0,
  });
  const isFrameTable =
    blockName === grid.blockName && position[0] === grid.position[0] && position[1] === grid.position[1];

  let numberLayer: string | null = null;
  let numberColor = BY_LAYER;
  for (const range of ctx.blocks.get(blockName) ?? []) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (isFrameTable && (range.type === 'TEXT' || range.type === 'MTEXT')) {
      const entity = rawEntityAt(ctx.doc.pairs, range);
      if (isPrintedNumber(grid, entity)) {
        // 새 번호가 원본 번호와 같은 레이어·색으로 나가게 첫 번째 것에서 읽어 둔다.
        if (numberLayer === null) {
          numberLayer = textAt(entity, 8) ?? '0';
          numberColor = numberAt(entity, 62, BY_LAYER);
        }
        continue;
      }
    }
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    appendAll(pairs, transformEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), tableTransform));
  }

  if (isFrameTable) {
    const shifted = shiftGrid(grid, dx);
    const height = modelTextHeight(grid);
    const layer = numberLayer ?? '0';
    // 빈 행이라도 번호는 쓴다 — 원본이 1~N을 미리 인쇄한 것과 같다(설계 5.2).
    for (let row = 1; row <= grid.dataRowCount; row++) {
      const value = String(page * grid.dataRowCount + row);
      const center = cellCenter(shifted, row, grid.numberColumn);
      appendAll(pairs, textEntity(baseFor(ctx, layer, numberColor), center, height, value, 'center'));
    }
  }
  return { pairs, skipped };
}

/**
 * 틀 블록을 펼쳐 모델 공간 엔티티로 만든다. 블록을 한 번 더 INSERT하지 않는 이유는
 * 표의 번호 열을 바꿔야 하기 때문이다(설계 5.2).
 *
 * @param page 0이 원본 장, 1부터가 복사본
 * @param dx   이 장이 원본 틀에서 x로 얼마나 떨어져 있는가
 */
export function flattenFrameBlock(
  ctx: SheetContext,
  frame: Frame,
  grid: TableGrid,
  page: number,
  dx: number,
): CopyResult {
  const frameTransform: Transform = { ...frame.transform, x: frame.transform.x + dx };
  const pairs: DxfPair[] = [];
  let skipped = 0;

  for (const range of ctx.blocks.get(frame.blockName) ?? []) {
    const source = ctx.doc.pairs.slice(range.start, range.end);
    if (range.type === 'ACAD_TABLE') {
      const table = flattenTable(ctx, source, frameTransform, grid, page, dx);
      appendAll(pairs, table.pairs);
      skipped += table.skipped;
      continue;
    }
    if (!isCopyable(source)) {
      skipped += 1;
      continue;
    }
    // 중첩 INSERT도 여기로 온다 — transformEntityPairs가 삽입점을 옮기고 배율을 곱하고
    // 회전을 더하므로 블록 정의는 그대로 공유된다(설계 5.2).
    appendAll(pairs, transformEntityPairs(copyEntityPairs(source, ctx.alloc, ctx.owner), frameTransform));
  }
  return { pairs, skipped };
}

/** 원본 엔티티를 제자리에서 옮긴다(복사가 아니다 — 핸들·참조는 그대로다, 설계 6장). */
export function shiftRangesInPlace(doc: DxfDocument, ranges: EntityRange[], dx: number): void {
  if (dx === 0) return;
  for (const range of ranges) {
    const source = doc.pairs.slice(range.start, range.end);
    const moved = translateEntityPairs(source, dx, 0);
    if (moved === source) continue;
    for (let i = 0; i < moved.length; i++) doc.pairs[range.start + i] = moved[i];
  }
}
