import { describe, expect, it } from 'vitest';
import { createHandleAllocator, parseDxf, recordHandle } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import { indexRegions, isFlattenable, pageOf, pagesOf, pitchOf, readSheetContext, shiftGrid } from '../src/export/sheetCopy.js';
import { buildGrid, cellCenter } from '../src/export/tableGrid.js';
import { templateText, withSecondFrame } from './fixtureDocs.js';

// 픽스처 실측값(frames.test.ts와 같은 계산):
//   틀 0 영역 x 2000~4280 (너비 2280), y 3160~3400. 틀 INSERT (1000, 2000) 배율 2.
//   표: *TX, 삽입점(블록 좌표) (500, 700), 열 경계 0/100/250/550/670/790/890/1030/1140,
//       행 경계 0/−40/−60/−80/−100/−120, 데이터 1행 = 행 인덱스 2, 데이터 행 수 3, 글자 높이 10.
// withSecondFrame(t, 50000) → 틀 1 영역 x 51000~53280. 간격(pitch) = 51000 − 2000 = 49000.

async function framesOf(text: string) {
  return findFrames(parseDxf(text));
}

describe('pageOf · pagesOf · pitchOf', () => {
  it('번호를 장에 나눈다 — 장 p는 번호 p·N+1 … (p+1)·N', () => {
    expect(pageOf(1, 35)).toBe(0);
    expect(pageOf(35, 35)).toBe(0);
    expect(pageOf(36, 35)).toBe(1); // 36 → (36−1)/35 = 1
    expect(pageOf(70, 35)).toBe(1);
    expect(pageOf(71, 35)).toBe(2);
  });

  it('최대 번호로 장 수를 센다', () => {
    expect(pagesOf(0, 35)).toBe(1);
    expect(pagesOf(35, 35)).toBe(1);
    expect(pagesOf(36, 35)).toBe(2); // ceil(36/35) = 2
    expect(pagesOf(71, 35)).toBe(3); // ceil(71/35) = 3
  });

  it('간격은 다음 틀 기준, 마지막 틀은 앞 쌍, 틀 하나면 너비 × 1.1', async () => {
    const two = await framesOf(withSecondFrame(await templateText(), 50000));
    expect(pitchOf(two, 0)).toBeCloseTo(49000, 6); // 51000 − 2000
    expect(pitchOf(two, 1)).toBeCloseTo(49000, 6); // 마지막 틀 → 앞 쌍의 간격

    const one = await framesOf(await templateText());
    expect(pitchOf(one, 0)).toBeCloseTo(2508, 6); // 너비 2280 × 1.1
  });

  it('회전·비균일 배율·뒤집힌 배율은 펼치지 않는다', () => {
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 })).toBe(true);
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 3, rotationRad: 0 })).toBe(false);
    expect(isFlattenable({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0.1 })).toBe(false);
    expect(isFlattenable({ x: 0, y: 0, scaleX: -2, scaleY: -2, rotationRad: 0 })).toBe(false);
  });

  it('shiftGrid는 x만 옮기고 이동량이 0이면 같은 격자를 돌려준다', async () => {
    const doc = parseDxf(await templateText());
    const grid = buildGrid(doc, (await framesOf(await templateText()))[0].table)!;
    expect(shiftGrid(grid, 0)).toBe(grid);
    const moved = shiftGrid(grid, 49000);
    // 데이터 1행 번호 칸 중앙: 1000 + 2*(500+50) = 2100 → +49000 = 51100
    expect(cellCenter(moved, 1, 0)[0]).toBeCloseTo(51100, 6);
    expect(cellCenter(moved, 1, 0)[1]).toBeCloseTo(3260, 6); // 2000 + 2*(700−70)
  });
});

describe('indexRegions', () => {
  async function contextOf(text: string) {
    const doc = parseDxf(text);
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const owner = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!;
    const ctx = readSheetContext(doc, alloc, owner)!;
    return { doc, frames, ctx };
  }

  it('틀 INSERT는 영역에서 빼고 따로 들고 있는다', async () => {
    const { frames, ctx } = await contextOf(await templateText());
    const regions = indexRegions(ctx, frames);
    expect(regions.frameInsert[0]).not.toBeNull();
    expect(regions.frameInsert[0]!.type).toBe('INSERT');
    expect(regions.inFrame[0]).toEqual([]);
  });

  it('틀 영역 밖 최상위 엔티티는 loose로, 중심 x와 함께 들어간다', async () => {
    const { frames, ctx } = await contextOf(await templateText());
    const regions = indexRegions(ctx, frames);
    // 픽스처의 최상위 LINE은 (0,0)-(10,10) → 중심 (5, 5), 틀 영역(x 2000~4280) 밖이다.
    expect(regions.loose).toHaveLength(1);
    expect(regions.loose[0].range.type).toBe('LINE');
    expect(regions.loose[0].centerX).toBeCloseTo(5, 6);
  });

  it('경계상자 중심이 틀 안이면 그 틀 영역이다', async () => {
    // 틀 영역(x 2000~4280, y 3160~3400) 안에 최상위 LINE을 하나 더 넣는다.
    // (2100, 3200)-(2300, 3300) → 중심 (2200, 3250)
    const extra = [
      '  0', 'LINE', '  5', '90', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
      ' 10', '2100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '2300.0', ' 21', '3300.0', ' 31', '0.0', '',
    ].join('\n');
    const text = (await templateText()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
    const { frames, ctx } = await contextOf(text);
    const regions = indexRegions(ctx, frames);
    expect(regions.inFrame[0]).toHaveLength(1);
    expect(regions.inFrame[0][0].type).toBe('LINE');
  });
});
