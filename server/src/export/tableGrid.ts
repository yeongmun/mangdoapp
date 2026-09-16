// 손상물량표를 찾아 칸의 자리를 계산한다. 표 객체를 고치지 않고 그 위에 글자를 얹기 위한
// 좌표만 구한다.
//
// 격자는 ACAD_TABLE 엔티티가 직접 들고 있다 — 행 높이(141), 열 너비(142), 삽입점(10/20),
// 표 모양이 담긴 익명 블록 이름(2). 글자 높이와 데이터 1행은 스펙 7.3대로 그 블록의
// MTEXT(`번호`와 인쇄된 `1`)에서 읽는다. 어떤 숫자도 코드에 박아 두지 않는다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4.1·4.3·7장

import { findSection, type DxfDocument, type DxfPair } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';

/** 스펙 7.2의 열 매핑이 전제하는 최소 열 수 */
const MIN_COLUMNS = 8;
/** 블록 안의 블록을 따라가는 최대 깊이. 사내 템플릿은 1단계면 충분하다 */
const MAX_INSERT_DEPTH = 4;

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationRad: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: 0 };

// 절대 = 삽입점 + 회전(배율 × 블록좌표)
export function applyTransform(t: Transform, point: Point): Point {
  const sx = point[0] * t.scaleX;
  const sy = point[1] * t.scaleY;
  if (t.rotationRad === 0) return [t.x + sx, t.y + sy];
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return [t.x + sx * cos - sy * sin, t.y + sx * sin + sy * cos];
}

// 안쪽 블록의 삽입점을 바깥 변환으로 옮기고 배율은 곱하고 회전은 더한다.
// 배율이 가로·세로 같을 때 정확하다 — 표를 고를 때 hasUniformScale로 거른다.
export function composeTransform(outer: Transform, inner: Transform): Transform {
  const [x, y] = applyTransform(outer, [inner.x, inner.y]);
  return {
    x,
    y,
    scaleX: outer.scaleX * inner.scaleX,
    scaleY: outer.scaleY * inner.scaleY,
    rotationRad: outer.rotationRad + inner.rotationRad,
  };
}

export function hasUniformScale(t: Transform): boolean {
  return Math.abs(t.scaleX - t.scaleY) < 1e-9;
}

export interface BlockLine {
  from: Point;
  to: Point;
}

export interface BlockText {
  text: string;
  position: Point;
  height: number;
}

export interface TableCandidate {
  /** 표 모양이 담긴 익명 블록 이름 (예: *T8) */
  blockName: string;
  /** 표의 삽입점(표를 담고 있는 블록의 좌표계) */
  position: Point;
  rowHeights: number[];
  colWidths: number[];
  /** 표를 담고 있는 블록 좌표 → 모델 좌표 */
  transform: Transform;
}

export interface TableGrid {
  blockName: string;
  position: Point;
  transform: Transform;
  /** 표 로컬 좌표. 길이 = 열 수 + 1 */
  colBoundaries: number[];
  /** 표 로컬 좌표(0, 음수로 내려간다). 길이 = 행 수 + 1 */
  rowBoundaries: number[];
  /** 데이터 1행의 행 인덱스 */
  firstDataRow: number;
  dataRowCount: number;
  /** 표 로컬 글자 높이 */
  textHeight: number;
  numberColumn: number;
  /** 데이터 영역 위쪽(머리글 영역)의 선. 데이터 시작선까지 잘라 둔다 */
  headerLines: BlockLine[];
  /** 머리글 영역의 글자 */
  headerTexts: BlockText[];
  /**
   * 열마다 데이터 행 위쪽(머리글 행 전부)의 글자를 문서 순서대로 공백으로 이어 붙인 것.
   * 길이 = 열 수. 그 열에 글자가 없으면 ''. tableFill.ts가 이 글자로 열을 찾는다(설계 7.2 개정).
   */
  headers: string[];
}

// MTEXT의 꾸밈 코드를 걷어내고 실제 글자만 남긴다.
export function mtextPlainText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) break;
      if (next === '\\' || next === '{' || next === '}') {
        out += next;
        i += 1;
        continue;
      }
      if (next === 'P' || next === 'X') {
        out += '\n';
        i += 1;
        continue;
      }
      if (next === '~') {
        out += ' ';
        i += 1;
        continue;
      }
      if ('fFHCcTQWApS'.includes(next)) {
        // 세미콜론까지가 한 지정이다. \S는 분수라 본문을 살린다.
        const end = raw.indexOf(';', i + 2);
        const stop = end === -1 ? raw.length : end;
        if (next === 'S') out += raw.slice(i + 2, stop).replace(/[\^#/]/g, ' ').trim();
        i = stop;
        continue;
      }
      out += next;
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}') continue;
    out += ch;
  }
  return out;
}

export interface RawEntity {
  type: string;
  values: Map<number, string[]>;
}

export function numberAt(entity: RawEntity, code: number, fallback: number): number {
  const raw = entity.values.get(code)?.[0];
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : fallback;
}

export function textAt(entity: RawEntity, code: number): string | null {
  return entity.values.get(code)?.[0] ?? null;
}

export function numbersAt(entity: RawEntity, code: number): number[] {
  return (entity.values.get(code) ?? []).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
}

/** doc.pairs 안에서 엔티티 하나가 차지하는 구간. start는 (0, 타입) 쌍, end는 그 다음 엔티티의 시작이다. */
export interface EntityRange {
  type: string;
  start: number;
  end: number;
}

// (0, 타입)부터 다음 (0, …) 직전까지를 한 엔티티로 본다. 첫 (0, …) 앞의 쌍은 버린다.
export function entityRanges(pairs: DxfPair[], from: number, to: number): EntityRange[] {
  const ranges: EntityRange[] = [];
  for (let i = from; i < to; i++) {
    if (pairs[i].code !== 0) continue;
    if (ranges.length > 0) ranges[ranges.length - 1].end = i;
    ranges.push({ type: pairs[i].value, start: i, end: to });
  }
  return ranges;
}

export function rawEntityAt(pairs: DxfPair[], range: EntityRange): RawEntity {
  const entity: RawEntity = { type: range.type, values: new Map() };
  for (let i = range.start + 1; i < range.end; i++) {
    const p = pairs[i];
    const list = entity.values.get(p.code);
    if (list) list.push(p.value);
    else entity.values.set(p.code, [p.value]);
  }
  return entity;
}

function readEntities(pairs: DxfPair[], from: number, to: number): RawEntity[] {
  return entityRanges(pairs, from, to).map((range) => rawEntityAt(pairs, range));
}

interface BlockContents {
  name: string;
  entities: RawEntity[];
}

function readBlocks(doc: DxfDocument): BlockContents[] {
  const section = findSection(doc, 'BLOCKS');
  if (!section) return [];
  const blocks: BlockContents[] = [];
  let start = -1;
  for (let i = section.start; i < section.end; i++) {
    const p = doc.pairs[i];
    if (p.code !== 0) continue;
    if (p.value === 'BLOCK') start = i;
    else if (p.value === 'ENDBLK' && start >= 0) {
      const entities = readEntities(doc.pairs, start, i);
      const name = textAt(entities[0], 2) ?? '';
      blocks.push({ name, entities: entities.slice(1) });
      start = -1;
    }
  }
  return blocks;
}

/** 블록 이름 → 그 블록 안 엔티티들의 쌍 범위(BLOCK 머리말은 뺀다). */
export function blockEntityRanges(doc: DxfDocument): Map<string, EntityRange[]> {
  const section = findSection(doc, 'BLOCKS');
  const blocks = new Map<string, EntityRange[]>();
  if (!section) return blocks;
  let start = -1;
  for (let i = section.start; i < section.end; i++) {
    const p = doc.pairs[i];
    if (p.code !== 0) continue;
    if (p.value === 'BLOCK') start = i;
    else if (p.value === 'ENDBLK' && start >= 0) {
      const ranges = entityRanges(doc.pairs, start, i);
      const name = textAt(rawEntityAt(doc.pairs, ranges[0]), 2) ?? '';
      blocks.set(name, ranges.slice(1));
      start = -1;
    }
  }
  return blocks;
}

/** 모델 공간(ENTITIES) 최상위 엔티티들의 쌍 범위. readModelSpace().entities와 순서가 같다. */
export function modelSpaceRanges(doc: DxfDocument): EntityRange[] {
  const section = findSection(doc, 'ENTITIES');
  if (!section) return [];
  return entityRanges(doc.pairs, section.start + 1, section.end);
}

export function insertTransform(entity: RawEntity): Transform {
  return {
    x: numberAt(entity, 10, 0),
    y: numberAt(entity, 20, 0),
    scaleX: numberAt(entity, 41, 1),
    scaleY: numberAt(entity, 42, 1),
    rotationRad: (numberAt(entity, 50, 0) * Math.PI) / 180,
  };
}

export function tableCandidateOf(entity: RawEntity, transform: Transform): TableCandidate | null {
  const blockName = textAt(entity, 2);
  if (!blockName) return null;
  const rowHeights = numbersAt(entity, 141);
  const colWidths = numbersAt(entity, 142);
  if (rowHeights.length === 0 || colWidths.length === 0) return null;
  return {
    blockName,
    position: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
    rowHeights,
    colWidths,
    transform,
  };
}

/** 모델 공간 최상위 엔티티와 블록 목차. 한 번 읽어 두고 여러 번 훑는다. */
export interface ModelSpace {
  entities: RawEntity[];
  blocks: Map<string, RawEntity[]>;
}

export function readModelSpace(doc: DxfDocument): ModelSpace | null {
  const section = findSection(doc, 'ENTITIES');
  if (!section) return null;
  return {
    // start는 (0, SECTION) 쌍 자신을 가리킨다 — +1부터 읽어야 그 마커가 가짜 엔티티로
    // 섞이지 않는다(구 findTableCandidates는 이 마커를 포함해도 타입을 걸러 냈으므로
    // 동작이 갈리지 않았을 뿐이다).
    entities: readEntities(doc.pairs, section.start + 1, section.end),
    blocks: new Map(readBlocks(doc).map((b) => [b.name, b.entities])),
  };
}

/**
 * entities를 훑으며 엔티티마다 절대 변환과 함께 visit을 부른다. INSERT를 만나면 그 블록 안으로
 * 내려간다 — visit은 INSERT 자체도 본다(내려가는 일은 이 함수가 맡는다).
 *
 * depth는 이미 내려온 INSERT 수(최상위에서 시작하면 0), seen은 지나온 블록 이름이다(자기 자신을
 * 삽입한 블록에서 무한히 도는 것을 막는다). 어느 곳에도 삽입되지 않은 블록은 훑지 않는다 —
 * 도면에 보이지 않기 때문이다.
 */
export function walkInserts(
  model: ModelSpace,
  entities: RawEntity[],
  transform: Transform,
  depth: number,
  seen: ReadonlySet<string>,
  visit: (entity: RawEntity, transform: Transform) => void,
): void {
  for (const entity of entities) {
    visit(entity, transform);
    if (entity.type !== 'INSERT' || depth >= MAX_INSERT_DEPTH) continue;
    const name = textAt(entity, 2);
    if (!name || seen.has(name)) continue;
    const contents = model.blocks.get(name);
    if (!contents) continue;
    walkInserts(
      model,
      contents,
      composeTransform(transform, insertTransform(entity)),
      depth + 1,
      new Set([...seen, name]),
      visit,
    );
  }
}

// 모델 공간의 INSERT를 따라 내려가며 블록 안의 ACAD_TABLE을 절대 좌표로 옮긴다.
// 어느 곳에도 삽입되지 않은 블록 안의 표는 도면에 보이지 않으므로 후보가 아니다.
export function findTableCandidates(doc: DxfDocument): TableCandidate[] {
  const model = readModelSpace(doc);
  if (!model) return [];
  const candidates: TableCandidate[] = [];
  walkInserts(model, model.entities, IDENTITY, 0, new Set(), (entity, transform) => {
    if (entity.type !== 'ACAD_TABLE') return;
    const table = tableCandidateOf(entity, transform);
    if (table) candidates.push(table);
  });
  return candidates;
}

function boundariesOf(sizes: number[], sign: 1 | -1): number[] {
  const boundaries = [0];
  let total = 0;
  for (const size of sizes) {
    total += size * sign;
    boundaries.push(total);
  }
  return boundaries;
}

export function tableCenter(candidate: TableCandidate): Point {
  const width = candidate.colWidths.reduce((sum, w) => sum + w, 0);
  const height = candidate.rowHeights.reduce((sum, h) => sum + h, 0);
  return applyTransform(candidate.transform, [
    candidate.position[0] + width / 2,
    candidate.position[1] - height / 2,
  ]);
}

export function nearestTable(candidates: TableCandidate[], center: Point): TableCandidate | null {
  let best: TableCandidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const [x, y] = tableCenter(candidate);
    const distance = Math.hypot(x - center[0], y - center[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

export function indexOfBand(boundaries: number[], value: number): number {
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const lo = Math.min(boundaries[i], boundaries[i + 1]);
    const hi = Math.max(boundaries[i], boundaries[i + 1]);
    if (value >= lo && value <= hi) return i;
  }
  return -1;
}

export function buildGrid(doc: DxfDocument, candidate: TableCandidate): TableGrid | null {
  if (candidate.colWidths.length < MIN_COLUMNS) return null;
  const colBoundaries = boundariesOf(candidate.colWidths, 1);
  const rowBoundaries = boundariesOf(candidate.rowHeights, -1);

  const block = readBlocks(doc).find((b) => b.name === candidate.blockName);
  if (!block) return null;

  const texts: BlockText[] = [];
  const lines: BlockLine[] = [];
  for (const entity of block.entities) {
    if (entity.type === 'MTEXT' || entity.type === 'TEXT') {
      // MTEXT의 긴 글은 코드 3이 여러 번 나온 뒤 코드 1로 끝난다.
      const raw = [...(entity.values.get(3) ?? []), ...(entity.values.get(1) ?? [])].join('');
      texts.push({
        text: mtextPlainText(raw),
        position: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        height: numberAt(entity, 40, 0),
      });
    } else if (entity.type === 'LINE') {
      lines.push({
        from: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        to: [numberAt(entity, 11, 0), numberAt(entity, 21, 0)],
      });
    }
  }

  // 번호 열: `번호`라고 적힌 칸의 열. 없으면 첫 열로 본다.
  const numberHeader = texts.find((t) => t.text.replace(/\s/g, '') === '번호');
  const numberColumn = numberHeader ? Math.max(0, indexOfBand(colBoundaries, numberHeader.position[0])) : 0;

  // 데이터 1행: 번호 열에 `1`이 인쇄된 칸의 행 대역(스펙 7.3).
  const headerRow = numberHeader ? indexOfBand(rowBoundaries, numberHeader.position[1]) : -1;
  let firstDataRow = -1;
  let textHeight = 0;
  for (const text of texts) {
    if (text.text.trim() !== '1') continue;
    if (indexOfBand(colBoundaries, text.position[0]) !== numberColumn) continue;
    const row = indexOfBand(rowBoundaries, text.position[1]);
    if (row < 0 || row <= headerRow) continue;
    if (firstDataRow === -1 || row < firstDataRow) {
      firstDataRow = row;
      textHeight = text.height;
    }
  }
  if (firstDataRow < 0 || !(textHeight > 0)) return null;

  const dataTop = rowBoundaries[firstDataRow];
  const clampedLines: BlockLine[] = [];
  for (const line of lines) {
    // 데이터 영역에만 있는 선은 버린다(넘침 표는 데이터 격자를 새로 그린다).
    if (line.from[1] < dataTop && line.to[1] < dataTop) continue;
    // 머리글 영역만 남기고, 아래로 뻗은 선은 데이터 시작선에서 자른다.
    const from: Point = [line.from[0], Math.max(line.from[1], dataTop)];
    const to: Point = [line.to[0], Math.max(line.to[1], dataTop)];
    if (from[0] === to[0] && from[1] === to[1]) continue;
    clampedLines.push({ from, to });
  }

  // 열마다 데이터 행 위쪽(머리글 행 전부)의 글자를 문서 순서대로 모은다 — 열 매핑을 머리글
  // 키워드로 찾기 위해서다(설계 7.2 개정, tableFill.ts columnMapOf). 여러 글자가 한 열에 걸치면
  // (예: 표 제목이 특정 열 위에 겹쳐 있는 경우) 공백으로 이어 붙인다.
  const headers = new Array<string>(colBoundaries.length - 1).fill('');
  for (const text of texts) {
    if (text.text === '') continue;
    const row = indexOfBand(rowBoundaries, text.position[1]);
    if (row < 0 || row >= firstDataRow) continue; // 데이터 행 이상은 머리글이 아니다
    const column = indexOfBand(colBoundaries, text.position[0]);
    if (column < 0) continue;
    headers[column] = headers[column] ? `${headers[column]} ${text.text}` : text.text;
  }

  return {
    blockName: candidate.blockName,
    position: candidate.position,
    transform: candidate.transform,
    colBoundaries,
    rowBoundaries,
    firstDataRow,
    dataRowCount: rowBoundaries.length - 1 - firstDataRow,
    textHeight,
    numberColumn,
    headerLines: clampedLines,
    headerTexts: texts.filter((t) => t.position[1] > dataTop && t.text !== ''),
    headers,
  };
}

/** dataRow는 1부터. 표 로컬 좌표를 모델 좌표로 옮겨 준다. */
export function cellCenter(grid: TableGrid, dataRow: number, column: number): Point {
  const rowIndex = grid.firstDataRow + dataRow - 1;
  const top = grid.rowBoundaries[rowIndex];
  const bottom = grid.rowBoundaries[rowIndex + 1];
  const left = grid.colBoundaries[column];
  const right = grid.colBoundaries[column + 1];
  return applyTransform(grid.transform, [
    grid.position[0] + (left + right) / 2,
    grid.position[1] + (top + bottom) / 2,
  ]);
}

export function modelTextHeight(grid: TableGrid): number {
  return grid.textHeight * Math.abs(grid.transform.scaleX);
}
