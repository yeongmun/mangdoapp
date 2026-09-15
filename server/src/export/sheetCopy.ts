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
