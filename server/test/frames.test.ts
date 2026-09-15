import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/export/dxfDocument.js';
import { findFrames } from '../src/export/frames.js';
import {
  flatTable,
  rotatedFrame,
  templateText,
  withFrameLine,
  withNestedInsert,
  withoutTable,
  withSecondFrame,
} from './fixtureDocs.js';

// 픽스처 실측값:
//   망도틀 블록 안에는 ACAD_TABLE 하나뿐. 삽입점(블록 좌표) (500, 700),
//   열 너비 합 100+150+300+120+120+100+140+110 = 1140, 행 높이 합 40+20+20+20+20 = 120
//   → 블록 좌표 네 모서리: (500,580) (1640,580) (1640,700) (500,700)
//   망도틀 INSERT: 삽입점 (1000, 2000), 배율 2, 회전 0
//   → 모델 좌표: x 1000+2*500=2000 ~ 1000+2*1640=4280, y 2000+2*580=3160 ~ 2000+2*700=3400
const FRAME_0 = { minX: 2000, minY: 3160, maxX: 4280, maxY: 3400 };

async function framesOf(text: string) {
  return findFrames(parseDxf(text));
}

describe('findFrames', () => {
  it('표가 든 최상위 INSERT를 틀로 보고 영역과 표를 함께 돌려준다', async () => {
    const frames = await framesOf(await templateText());
    expect(frames).toHaveLength(1);
    expect(frames[0].index).toBe(0);
    expect(frames[0].bounds).toEqual(FRAME_0);
    expect(frames[0].table.blockName).toBe('*TX');
    expect(frames[0].table.position).toEqual([500, 700]);
    expect(frames[0].table.transform).toMatchObject({ x: 1000, y: 2000, scaleX: 2, scaleY: 2 });
  });

  it('틀이 여러 개면 왼쪽(minX가 작은) 틀이 0번이다 — 도면에 적힌 순서가 아니다', async () => {
    // 두 번째 망도틀을 원본보다 왼쪽(x = -9000)에 삽입한다.
    // → 영역 x -9000+1000 = -8000 ~ -9000+3280 = -5720, y는 원본과 같다.
    const frames = await framesOf(withSecondFrame(await templateText(), -9000));
    expect(frames.map((frame) => frame.index)).toEqual([0, 1]);
    expect(frames[0].bounds).toEqual({ minX: -8000, minY: 3160, maxX: -5720, maxY: 3400 });
    expect(frames[1].bounds).toEqual(FRAME_0);
    // 틀마다 자기 표를 들고 있다(표의 절대 변환이 서로 다르다).
    expect(frames[0].table.transform.x).toBe(-9000);
    expect(frames[1].table.transform.x).toBe(1000);
  });

  it('표가 없는 블록은 틀이 아니다', async () => {
    expect(await framesOf(withoutTable(await templateText()))).toEqual([]);
  });

  it('표가 최상위에 그냥 놓인 도면은 틀이 0개다', async () => {
    expect(await framesOf(flatTable(await templateText()))).toEqual([]);
  });

  it('블록 안의 다른 도형까지 감싼다 — 표보다 넓은 틀', async () => {
    // 블록 좌표 (0,0)-(2000,2000) LINE을 더하면 블록 좌표 AABB가 x 0~2000, y 0~2000이 된다.
    // → 모델 좌표 x 1000+0=1000 ~ 1000+4000=5000, y 2000+0=2000 ~ 2000+4000=6000
    const frames = await framesOf(withFrameLine(await templateText()));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds).toEqual({ minX: 1000, minY: 2000, maxX: 5000, maxY: 6000 });
  });

  it('중첩 INSERT 안의 도형도 변환을 겹쳐 감싼다', async () => {
    // *TX 블록의 도형은 블록 좌표 x 0~1140, y -120~0이다(격자 LINE 6개의 범위).
    // 이를 (0, 5000)에 배율 1로 삽입 → 망도틀 좌표 x 0~1140, y 4880~5000.
    // 표(500~1640, 580~700)와 합치면 x 0~1640, y 580~5000
    // → 모델 좌표 x 1000~4280, y 3160~12000
    const frames = await framesOf(withNestedInsert(await templateText()));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds).toEqual({ minX: 1000, minY: 3160, maxX: 4280, maxY: 12000 });
  });

  it('회전한 삽입은 회전한 네 모서리를 감싼 축 정렬 상자다', async () => {
    // 90도 회전, 배율 2, 삽입점 (1000, 2000). 각 모서리 (x,y) → (1000 - 2y, 2000 + 2x)
    //   (500,700)  → (1000-1400, 2000+1000) = (-400, 3000)
    //   (1640,700) → (1000-1400, 2000+3280) = (-400, 5280)
    //   (1640,580) → (1000-1160, 2000+3280) = (-160, 5280)
    //   (500,580)  → (1000-1160, 2000+1000) = (-160, 3000)
    // → AABB x -400 ~ -160, y 3000 ~ 5280. 대각 두 점만 봤다면 이 답이 나오지 않는다.
    const frames = await framesOf(rotatedFrame(await templateText(), 90));
    expect(frames).toHaveLength(1);
    expect(frames[0].bounds.minX).toBeCloseTo(-400, 6);
    expect(frames[0].bounds.maxX).toBeCloseTo(-160, 6);
    expect(frames[0].bounds.minY).toBeCloseTo(3000, 6);
    expect(frames[0].bounds.maxY).toBeCloseTo(5280, 6);
  });

  it('ENTITIES 구역이 없으면 빈 배열', () => {
    expect(findFrames(parseDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n'))).toEqual([]);
  });
});
