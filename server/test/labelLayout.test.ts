import { describe, expect, it } from 'vitest';
import {
  anchorForBox,
  baseAnchor,
  BASELINE_CENTER_FACTOR,
  blockBoxAt,
  estimateTextWidth,
  labelBlock,
  LINE_GAP_FACTOR,
  placeBlock,
} from '../public/viewer/labelLayout.js';

// 도면 실치수와 같은 값으로 검사한다: 글자 높이 300, 원 반지름 255.
const FONT = 300;
const R = 255;
// 어림 폭: 아스키 0.55배(= 165), 한글 등 1.0배(= 300)
const ASCII = FONT * 0.55;
const WIDE = FONT;
const LINE_GAP = FONT * LINE_GAP_FACTOR; // 390
const CIRCLE_GAP = R * 0.5; // 127.5
const CIRCLE_WIDTH = R * 2 + CIRCLE_GAP; // 637.5

describe('estimateTextWidth', () => {
  it('아스키는 글자 높이의 0.55배, 그 밖은 1.0배', () => {
    expect(estimateTextWidth('ab', 100)).toBeCloseTo(110, 6);
    expect(estimateTextWidth('균열', 100)).toBeCloseTo(200, 6);
    expect(estimateTextWidth('a균', 100)).toBeCloseTo(155, 6);
    expect(estimateTextWidth('', 100)).toBe(0);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 2장
describe('labelBlock 줄 구성', () => {
  it('균열(이름 없음)은 첫 줄 글자가 치수이고 치수 줄을 또 그리지 않는다', () => {
    const block = labelBlock({ name: '', dimension: '0.2/0.3', photo: '#12', number: 17, font: FONT, circleR: R });
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['dimension', '0.2/0.3'],
      ['photo', '#12'],
    ]);
  });

  it('다른 유형은 첫 줄이 이름이고 치수·사진이 뒤따른다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['number', '17'],
      ['name', '파손'],
      ['dimension', '0.3x0.3'],
      ['photo', '#12, #13'],
    ]);
  });

  it('없는 줄은 건너뛰어 빈 줄을 남기지 않는다 (치수 없음)', () => {
    const block = labelBlock({ name: '박락', dimension: '', photo: '#12', number: 7, font: FONT, circleR: R });
    expect(block.lines.map((l) => l.text)).toEqual(['7', '박락', '#12']);
    // 사진 줄이 치수 자리(맨 아래, dy = 0)로 올라온다
    expect(block.lines.find((l) => l.key === 'photo')!.dy).toBe(0);
    expect(block.lines.find((l) => l.key === 'name')!.dy).toBeCloseTo(LINE_GAP, 6);
  });

  it('사진이 없으면 두 줄만 그린다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.2', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.lines.map((l) => l.text)).toEqual(['7', '박락', '1.2x1.2']);
  });

  it('번호가 없으면 원 없이 A부터 시작한다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.2', photo: '', number: null, font: FONT, circleR: R });
    expect(block.circle).toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([
      ['name', '박락'],
      ['dimension', '1.2x1.2'],
    ]);
    // 원이 없으므로 글자 줄이 블록 왼쪽 끝에서 시작한다
    expect(block.lines[0].dx).toBeCloseTo(-block.box.width / 2, 6);
  });

  it('A가 없으면(이름·치수 둘 다 없음) 원만 그린다', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '', number: 1, font: FONT, circleR: R });
    expect(block.circle).not.toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([['number', '1']]);
    // 글자가 없으면 원 폭만으로 가운데 맞춘다 — 원 중심이 기준점과 같다
    expect(block.circle!.dx).toBeCloseTo(0, 6);
    expect(block.lines[0].dx).toBeCloseTo(0, 6);
  });

  it('이름·치수·번호가 모두 없고 사진만 있으면 사진이 첫 줄이 된다', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '#12', number: null, font: FONT, circleR: R });
    expect(block.circle).toBeNull();
    expect(block.lines.map((l) => [l.key, l.text])).toEqual([['photo', '#12']]);
  });

  it('그릴 것이 하나도 없으면 빈 블록', () => {
    const block = labelBlock({ name: '', dimension: '', photo: '', number: null, font: FONT, circleR: R });
    expect(block).toEqual({ circle: null, lines: [], box: { dx: 0, dy: 0, width: 0, height: 0 }, height: 0 });
  });
});

describe('labelBlock 들여쓰기와 가운데 맞춤', () => {
  it('둘째 줄부터 x가 A의 왼쪽 x와 같다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    const name = block.lines.find((l) => l.key === 'name')!;
    const dimension = block.lines.find((l) => l.key === 'dimension')!;
    const photo = block.lines.find((l) => l.key === 'photo')!;
    expect(dimension.dx).toBe(name.dx);
    expect(photo.dx).toBe(name.dx);
    expect([name.align, dimension.align, photo.align]).toEqual(['start', 'start', 'start']);
  });

  it('번호 글자만 가운데 정렬이고 원 중심에 놓인다', () => {
    const block = labelBlock({ name: '파손', dimension: '', photo: '', number: 17, font: FONT, circleR: R });
    const number = block.lines.find((l) => l.key === 'number')!;
    expect(number.align).toBe('middle');
    expect(number.dx).toBeCloseTo(block.circle!.dx, 6);
  });

  it('블록 폭은 원 + 가장 긴 줄이고 기준점 x에 가운데 맞춘다', () => {
    // '0.3x0.3'(아스키 7) = 1155, '파손' = 600, '#12, #13'(아스키 8) = 1320 → 가장 긴 줄은 사진 줄
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12, #13', number: 17, font: FONT, circleR: R });
    expect(block.box.width).toBeCloseTo(CIRCLE_WIDTH + 8 * ASCII, 6);
    expect(block.box.dx).toBeCloseTo(-block.box.width / 2, 6);
    // 원 왼쪽 끝이 블록 왼쪽 끝이고, 글자는 그 오른쪽으로 원 폭 + 간격만큼 들어간다
    expect(block.circle!.dx - R).toBeCloseTo(block.box.dx, 6);
    expect(block.lines.find((l) => l.key === 'name')!.dx).toBeCloseTo(block.box.dx + CIRCLE_WIDTH, 6);
  });

  it('한글 이름 한 줄짜리도 같은 규칙이다', () => {
    const block = labelBlock({ name: '표면 오염', dimension: '', photo: '', number: null, font: FONT, circleR: R });
    // '표면 오염' = 한글 4 + 공백(아스키) 1
    expect(block.box.width).toBeCloseTo(4 * WIDE + ASCII, 6);
  });
});

describe('labelBlock 줄 쌓기와 경계상자', () => {
  it('맨 아래 줄이 기준점(dy = 0)이고 위로 한 줄 간격씩 쌓인다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '#12', number: 17, font: FONT, circleR: R });
    expect(block.lines.find((l) => l.key === 'photo')!.dy).toBe(0);
    expect(block.lines.find((l) => l.key === 'dimension')!.dy).toBeCloseTo(LINE_GAP, 6);
    expect(block.lines.find((l) => l.key === 'name')!.dy).toBeCloseTo(LINE_GAP * 2, 6);
  });

  it('원 중심은 첫 줄 베이스라인에서 글자 높이의 0.35배 위다', () => {
    const block = labelBlock({ name: '파손', dimension: '0.3x0.3', photo: '', number: 17, font: FONT, circleR: R });
    const name = block.lines.find((l) => l.key === 'name')!;
    expect(block.circle!.dy).toBeCloseTo(name.dy + FONT * BASELINE_CENTER_FACTOR, 6);
    expect(BASELINE_CENTER_FACTOR).toBe(0.35);
  });

  it('경계상자는 맨 아래 줄 베이스라인부터 글자 윗변까지이고 번호 원을 품는다', () => {
    // 두 줄(이름·치수) + 원: 위 = max(390 + 300, 495 + 255) = 750, 아래 = min(0, 240) = 0
    const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.box.dy).toBe(0);
    expect(block.box.height).toBeCloseTo(750, 6);
    expect(block.height).toBe(block.box.height);
  });

  it('한 줄짜리는 원이 베이스라인 아래로 내려가 상자가 아래로 늘어난다', () => {
    // 원 중심 105, 반지름 255 → 아래 -150, 위 360
    const block = labelBlock({ name: '박락', dimension: '', photo: '', number: 7, font: FONT, circleR: R });
    expect(block.box.dy).toBeCloseTo(-150, 6);
    expect(block.box.height).toBeCloseTo(510, 6);
  });

  it('번호가 없으면 상자가 글자만 감싼다', () => {
    const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: null, font: FONT, circleR: R });
    expect(block.box.dy).toBe(0);
    expect(block.box.height).toBeCloseTo(LINE_GAP + FONT, 6);
  });

  it('단위를 가리지 않는다 — 크기를 반으로 넣으면 결과도 반이다', () => {
    const big = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });
    const small = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT / 2, circleR: R / 2 });
    expect(small.box.width).toBeCloseTo(big.box.width / 2, 6);
    expect(small.box.height).toBeCloseTo(big.box.height / 2, 6);
  });
});

describe('placeBlock', () => {
  const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });

  it('도면 좌표(y가 위로)에서는 윗줄의 y가 더 크다', () => {
    const placed = placeBlock(block, [500, 500]);
    const name = placed.lines.find((l) => l.key === 'name')!;
    const dimension = placed.lines.find((l) => l.key === 'dimension')!;
    expect(dimension.y).toBe(500);
    expect(name.y).toBeCloseTo(500 + LINE_GAP, 6);
    expect(placed.circle!.cy).toBeGreaterThan(name.y);
    // 상자의 (x, y)는 작은 쪽 모서리 = 아래 변
    expect(placed.box).toEqual({ x: 500 + block.box.dx, y: 500, width: block.box.width, height: block.box.height });
  });

  it('yDir = -1이면 화면 픽셀(y가 아래로)로 뒤집는다 — 뒤집기는 여기 한 곳에서만 일어난다', () => {
    const placed = placeBlock(block, [500, 500], -1);
    const name = placed.lines.find((l) => l.key === 'name')!;
    const dimension = placed.lines.find((l) => l.key === 'dimension')!;
    expect(dimension.y).toBe(500);
    expect(name.y).toBeCloseTo(500 - LINE_GAP, 6);
    expect(placed.circle!.cy).toBeLessThan(name.y);
    // 화면에서도 (x, y)는 작은 쪽 모서리 = 위 변
    expect(placed.box.y).toBeCloseTo(500 - (block.box.dy + block.box.height), 6);
    expect(placed.box.height).toBe(block.box.height);
  });

  it('x는 뒤집지 않는다', () => {
    expect(placeBlock(block, [500, 500]).lines[0].x).toBe(placeBlock(block, [500, 500], -1).lines[0].x);
  });
});

describe('blockBoxAt · anchorForBox · baseAnchor', () => {
  const block = labelBlock({ name: '박락', dimension: '1.2x1.5', photo: '', number: 7, font: FONT, circleR: R });

  it('blockBoxAt은 placeBlock의 상자와 같다', () => {
    expect(blockBoxAt(block, [500, 500])).toEqual(placeBlock(block, [500, 500]).box);
  });

  it('anchorForBox는 blockBoxAt의 역이다', () => {
    const box = blockBoxAt(block, [500, 500]);
    expect(anchorForBox(block, box.x, box.y)).toEqual([500, 500]);
  });

  it('baseAnchor는 손상 경계상자 바로 위 가운데다', () => {
    expect(baseAnchor({ minX: 0, minY: 0, maxX: 1000, maxY: 400 }, 100)).toEqual([500, 500]);
  });
});
