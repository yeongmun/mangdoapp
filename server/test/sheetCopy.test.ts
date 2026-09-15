import { describe, expect, it } from 'vitest';
import { createHandleAllocator, parseDxf, recordHandle } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
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
} from '../src/export/sheetCopy.js';
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

describe('copyRegion · flattenFrameBlock', () => {
  async function setup(text: string) {
    const doc = parseDxf(text);
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const owner = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!;
    const ctx = readSheetContext(doc, alloc, owner)!;
    const grid = buildGrid(doc, frames[0].table)!;
    return { doc, frames, ctx, grid, owner };
  }

  // 펼친 쌍 배열에서 (0, 타입) 단위로 갈라 값·좌표를 꺼내 준다.
  function entitiesOf(pairs: ReturnType<typeof flattenFrameBlock>['pairs']) {
    const out: Array<{ type: string; text: string; x: number; y: number; handle: string; owner: string }> = [];
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].code !== 0) continue;
      const entry = { type: pairs[i].value, text: '', x: NaN, y: NaN, handle: '', owner: '' };
      let j = i + 1;
      for (; j < pairs.length && pairs[j].code !== 0; j++) {
        const p = pairs[j];
        if (p.code === 5 && entry.handle === '') entry.handle = p.value;
        else if (p.code === 330 && entry.owner === '') entry.owner = p.value;
        else if (p.code === 1) entry.text = p.value;
        else if (p.code === 10 && Number.isNaN(entry.x)) entry.x = Number(p.value);
        else if (p.code === 20 && Number.isNaN(entry.y)) entry.y = Number(p.value);
      }
      out.push(entry);
      i = j - 1;
    }
    return out;
  }

  it('영역 엔티티를 새 핸들·같은 소유자로 베껴 x만큼 옮긴다', async () => {
    // 틀 영역 안에 최상위 LINE (2100,3200)-(2300,3300)을 하나 넣는다.
    const extra = [
      '  0', 'LINE', '  5', '90', '330', '1F', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
      ' 10', '2100.0', ' 20', '3200.0', ' 30', '0.0', ' 11', '2300.0', ' 21', '3300.0', ' 31', '0.0', '',
    ].join('\n');
    const text = (await templateText()).replace('  0\nENDSEC\n  0\nEOF\n', `${extra}  0\nENDSEC\n  0\nEOF\n`);
    const { ctx, frames, owner } = await setup(text);
    const regions = indexRegions(ctx, frames);
    const result = copyRegion(ctx, regions.inFrame[0], 49000);
    expect(result.skipped).toBe(0);
    const [line] = entitiesOf(result.pairs);
    expect(line.type).toBe('LINE');
    expect(line.x).toBeCloseTo(51100, 6); // 2100 + 49000
    expect(line.handle).not.toBe('90');
    expect(line.owner).toBe(owner);
  });

  it('틀 블록을 펼치면 표 블록의 글자·선이 모델 좌표로 들어온다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    const result = flattenFrameBlock(ctx, frames[0], grid, 1, 49000);
    const entities = entitiesOf(result.pairs);
    // 표 블록 → 모델 변환: 틀 변환(x 1000 + 49000 = 50000, 배율 2) ∘ 표 삽입점 (500, 700)
    //   → x = 50000 + 2*500 = 51000, y = 2000 + 2*700 = 3400
    // '손상물량표' MTEXT는 블록 좌표 (570, -20) → (51000 + 2*570, 3400 + 2*(-20)) = (52140, 3360)
    const title = entities.find((e) => e.text.includes('손상물량'))!;
    expect(title.x).toBeCloseTo(52140, 6);
    expect(title.y).toBeCloseTo(3360, 6);
    // ACAD_TABLE 엔티티 자체는 넣지 않는다
    expect(entities.some((e) => e.type === 'ACAD_TABLE')).toBe(false);
  });

  it('번호 열 데이터 행 글자는 빼고 그 장의 번호를 새로 쓴다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    // 데이터 행 3개짜리 픽스처에서 1장(page = 1)이면 번호는 1*3+1 … 1*3+3 = 4, 5, 6이다.
    const result = flattenFrameBlock(ctx, frames[0], grid, 1, 49000);
    const numbers = entitiesOf(result.pairs).filter((e) => /^[0-9]+$/.test(e.text));
    expect(numbers.map((e) => e.text)).toEqual(['4', '5', '6']);
    // 인쇄돼 있던 1·2·3은 사라졌다
    expect(numbers.some((e) => ['1', '2', '3'].includes(e.text))).toBe(false);
    // 번호 칸 중앙 x = 1000 + 2*(500+50) = 2100 → +49000 = 51100
    // 데이터 1·2·3행 중앙 y = 2000 + 2*(700−70) = 3260, 3220, 3180
    expect(numbers.map((e) => e.x)).toEqual([51100, 51100, 51100]);
    expect(numbers.map((e) => e.y)).toEqual([3260, 3220, 3180]);
  });

  it('머리글 글자(번호·손상위치…)는 그대로 남는다', async () => {
    const { ctx, frames, grid } = await setup(await templateText());
    const entities = entitiesOf(flattenFrameBlock(ctx, frames[0], grid, 1, 49000).pairs);
    // '번호' 머리글은 블록 좌표 (50, −50) → x = 51000 + 2*50 = 51100, y = 3400 + 2*(−50) = 3300
    const header = entities.find((e) => e.text.includes('번'))!;
    expect(header.x).toBeCloseTo(51100, 6);
    expect(header.y).toBeCloseTo(3300, 6);
  });
});

describe('shiftRangesInPlace', () => {
  it('원본 쌍을 제자리에서 고치고 핸들은 그대로 둔다', async () => {
    const doc = parseDxf(await templateText());
    const frames = findFrames(doc);
    const alloc = createHandleAllocator(doc);
    const ctx = readSheetContext(doc, alloc, recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')!)!;
    const insert = indexRegions(ctx, frames).frameInsert[0]!;

    shiftRangesInPlace(doc, [insert], 49000);
    const moved = findFrames(doc);
    // 삽입점 1000 + 49000 = 50000 → 영역 x 50000 + 2*500 = 51000 ~ 50000 + 2*1640 = 53280
    expect(moved[0].bounds.minX).toBeCloseTo(51000, 6);
    expect(moved[0].bounds.maxX).toBeCloseTo(53280, 6);
    // 핸들은 그대로다
    expect(doc.pairs[insert.start + 1].value).toBe('80');
    // y는 값이 그대로라 쌍 객체도 원본이다(바이트 보존)
    expect(doc.pairs.filter((p) => p.code === 20)[0].rawCode).toBe(' 20');
  });
});
