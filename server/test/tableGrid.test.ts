import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/export/dxfDocument.js';
import {
  applyTransform,
  buildGrid,
  cellCenter,
  composeTransform,
  findTableCandidates,
  hasUniformScale,
  IDENTITY,
  modelTextHeight,
  mtextPlainText,
  nearestTable,
  tableCenter,
  type Transform,
} from '../src/export/tableGrid.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function templateDoc() {
  return parseDxf(await readFile(fixturePath, 'utf8'));
}

describe('mtextPlainText', () => {
  it('글꼴 지정과 중괄호를 걷어낸다', () => {
    expect(mtextPlainText('{\\f굴림|b0|i0|c129|p2;번}호')).toBe('번호');
    expect(mtextPlainText('{\\f굴림|b0|i0|c129|p2;손상현}황')).toBe('손상현황');
  });

  it('꾸밈이 없는 글자는 그대로 둔다', () => {
    expect(mtextPlainText('가로/폭')).toBe('가로/폭');
    expect(mtextPlainText('1')).toBe('1');
  });

  it('줄바꿈·이스케이프를 푼다', () => {
    expect(mtextPlainText('가\\P나')).toBe('가\n나');
    expect(mtextPlainText('가\\~나')).toBe('가 나');
    expect(mtextPlainText('\\\\')).toBe('\\');
    expect(mtextPlainText('\\{가\\}')).toBe('{가}');
  });

  it('높이·색 지정도 걷어낸다', () => {
    expect(mtextPlainText('\\H1.5x;\\C1;빨강')).toBe('빨강');
  });
});

describe('applyTransform / composeTransform', () => {
  it('항등 변환은 좌표를 그대로 둔다', () => {
    expect(applyTransform(IDENTITY, [10, 20])).toEqual([10, 20]);
  });

  it('배율과 삽입점을 적용한다', () => {
    const t: Transform = { x: 1000, y: 2000, scaleX: 2, scaleY: 2, rotationRad: 0 };
    expect(applyTransform(t, [50, -70])).toEqual([1100, 1860]);
  });

  it('회전을 적용한다 (90도)', () => {
    const t: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: Math.PI / 2 };
    const [x, y] = applyTransform(t, [10, 0]);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(10, 9);
  });

  it('겹친 변환은 안쪽 삽입점을 바깥 변환으로 옮기고 배율·회전을 곱해 더한다', () => {
    const outer: Transform = { x: 100, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 };
    const inner: Transform = { x: 10, y: 5, scaleX: 3, scaleY: 3, rotationRad: 0 };
    const composed = composeTransform(outer, inner);
    expect(composed).toMatchObject({ x: 120, y: 10, scaleX: 6, scaleY: 6, rotationRad: 0 });
    expect(applyTransform(composed, [1, 0])).toEqual([126, 10]);
  });
});

describe('hasUniformScale', () => {
  it('가로·세로 배율이 같으면 참', () => {
    expect(hasUniformScale({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 })).toBe(true);
    expect(hasUniformScale({ x: 0, y: 0, scaleX: 2, scaleY: 3, rotationRad: 0 })).toBe(false);
  });
});

describe('findTableCandidates', () => {
  it('망도틀 안의 표를 INSERT를 따라 절대 좌표로 찾는다', async () => {
    const candidates = findTableCandidates(await templateDoc());
    expect(candidates).toHaveLength(1);
    const [table] = candidates;
    expect(table.blockName).toBe('*TX');
    expect(table.position).toEqual([500, 700]);
    expect(table.colWidths).toEqual([100, 150, 300, 120, 120, 100, 140, 110]);
    expect(table.rowHeights).toEqual([40, 20, 20, 20, 20]);
    expect(table.transform).toMatchObject({ x: 1000, y: 2000, scaleX: 2, scaleY: 2, rotationRad: 0 });
  });

  it('어느 블록에도 삽입되지 않은 블록 안의 표는 후보가 아니다', async () => {
    const text = await readFile(fixturePath, 'utf8');
    // 망도틀 INSERT의 블록 이름을 없는 블록으로 바꾼다 → 망도틀은 어디에도 삽입되지 않는다
    const doc = parseDxf(text.replace('AcDbBlockReference\n  2\n망도틀\n 10\n1000.0', 'AcDbBlockReference\n  2\n없는블록\n 10\n1000.0'));
    expect(findTableCandidates(doc)).toEqual([]);
  });

  it('INSERT가 여러 개면 표도 그만큼 나온다', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const insertBlock = text.slice(text.indexOf('  0\nINSERT\n'), text.indexOf('  0\nLINE\n  5\n81\n'));
    const doc = parseDxf(text.replace(insertBlock, insertBlock + insertBlock.replace('\n1000.0\n', '\n50000.0\n')));
    const candidates = findTableCandidates(doc);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.transform.x)).toEqual([1000, 50000]);
  });
});

describe('tableCenter / nearestTable', () => {
  it('표의 가운데를 모델 좌표로 준다', async () => {
    const [table] = findTableCandidates(await templateDoc());
    // 로컬 가운데 (570, -60) → 블록 (1070, 640) → 모델 (1000 + 2140, 2000 + 1280)
    expect(tableCenter(table)).toEqual([3140, 3280]);
  });

  it('손상 중심에서 가까운 표를 고른다', async () => {
    const [table] = findTableCandidates(await templateDoc());
    const far = { ...table, transform: { ...table.transform, x: 999_000 } };
    expect(nearestTable([far, table], [3000, 3000])).toBe(table);
    expect(nearestTable([], [0, 0])).toBeNull();
  });
});

describe('buildGrid', () => {
  it('열·행 경계와 데이터 1행, 글자 높이를 읽는다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;

    expect(grid.colBoundaries).toEqual([0, 100, 250, 550, 670, 790, 890, 1030, 1140]);
    expect(grid.rowBoundaries).toEqual([0, -40, -60, -80, -100, -120]);
    expect(grid.firstDataRow).toBe(2);
    expect(grid.dataRowCount).toBe(3);
    expect(grid.textHeight).toBe(10);
    expect(grid.numberColumn).toBe(0);
    expect(modelTextHeight(grid)).toBe(20);
  });

  it('머리글 영역의 선과 글자만 모은다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;

    // y = -120 짜리 가로선은 데이터 영역 아래라 빠지고, 세로선 둘은 -60까지 잘린다
    expect(grid.headerLines).toEqual([
      { from: [0, 0], to: [1140, 0] },
      { from: [0, -40], to: [1140, -40] },
      { from: [0, -60], to: [1140, -60] },
      { from: [0, 0], to: [0, -60] },
      { from: [1140, 0], to: [1140, -60] },
    ]);
    expect(grid.headerTexts.map((t) => t.text)).toEqual([
      '손상물량표',
      '번호',
      '손상위치',
      '손상현황',
      '가로/폭',
      '세로/길이',
      '개소',
      '면적/연장',
      '단위',
    ]);
    expect(grid.headerTexts[1]).toEqual({ text: '번호', position: [50, -50], height: 10 });
  });

  it('인쇄된 번호 1을 못 찾으면 null', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const doc = parseDxf(text.replace('AcDbMText\n 10\n50.0\n 20\n-70.0\n 30\n0.0\n 40\n10.0\n 71\n     5\n  1\n1\n', 'AcDbMText\n 10\n50.0\n 20\n-70.0\n 30\n0.0\n 40\n10.0\n 71\n     5\n  1\n\n'));
    expect(buildGrid(doc, findTableCandidates(doc)[0])).toBeNull();
  });

  it('열이 8개 미만이면 null', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const doc = parseDxf(text.replace(' 92\n        8\n', ' 92\n        7\n').replace('142\n110.0\n', ''));
    expect(buildGrid(doc, findTableCandidates(doc)[0])).toBeNull();
  });
});

describe('cellCenter', () => {
  it('데이터 1행 0열의 모델 좌표를 준다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;
    expect(cellCenter(grid, 1, 0)).toEqual([2100, 3260]);
  });

  it('열과 행이 달라지면 그만큼 옮겨 간다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;
    // 2열 중앙 400, 데이터 1행 중앙 -70 → 블록 (900, 630) → 모델 (2800, 3260)
    expect(cellCenter(grid, 1, 2)).toEqual([2800, 3260]);
    // 7열 중앙 1085, 데이터 3행 중앙 -110 → 블록 (1585, 590) → 모델 (4170, 3180)
    expect(cellCenter(grid, 3, 7)).toEqual([4170, 3180]);
  });
});
