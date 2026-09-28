import { describe, expect, it } from 'vitest';
import { clampPage, frameWorldBox, pageCount, pageLabel } from '../public/viewer/pageView.js';

const frames = [
  { minX: 0, minY: 0, maxX: 100, maxY: 50 },
  { minX: 200, minY: 0, maxX: 300, maxY: 50 },
  { minX: 400, minY: 0, maxX: 500, maxY: 50 },
];

const identity = (p: [number, number]): [number, number] => [p[0], p[1]];

describe('pageCount', () => {
  it('틀 배열의 길이가 페이지 수다', () => {
    expect(pageCount(frames)).toBe(3);
  });

  it('빈 배열·배열 아님은 0페이지', () => {
    expect(pageCount([])).toBe(0);
    expect(pageCount(undefined)).toBe(0);
    expect(pageCount(null)).toBe(0);
    expect(pageCount({ length: 3 })).toBe(0);
  });
});

describe('clampPage', () => {
  it('범위 안의 번호는 그대로', () => {
    expect(clampPage(0, frames)).toBe(0);
    expect(clampPage(2, frames)).toBe(2);
  });

  it('범위를 벗어나면 첫/끝 페이지로 맞춘다', () => {
    expect(clampPage(-1, frames)).toBe(0);
    expect(clampPage(7, frames)).toBe(2);
  });

  it('소수는 버림, NaN·숫자 아님은 0', () => {
    expect(clampPage(1.7, frames)).toBe(1);
    expect(clampPage(Number.NaN, frames)).toBe(0);
    expect(clampPage('2', frames)).toBe(0);
    expect(clampPage(undefined, frames)).toBe(0);
  });

  it('틀이 없으면 언제나 0', () => {
    expect(clampPage(3, [])).toBe(0);
  });
});

describe('frameWorldBox', () => {
  it('변환이 그대로면 틀 경계에 폭·높이의 3%를 사방에 더한다', () => {
    const box = frameWorldBox(frames[0], identity);
    expect(box).not.toBeNull();
    expect(box!.minX).toBeCloseTo(-3);
    expect(box!.maxX).toBeCloseTo(103);
    expect(box!.minY).toBeCloseTo(-1.5);
    expect(box!.maxY).toBeCloseTo(51.5);
  });

  it('비례 변환(뷰어 좌표가 1/10)이면 변환된 경계 기준으로 여백을 잡는다', () => {
    const scale = (p: [number, number]): [number, number] => [p[0] / 10 + 5, p[1] / 10 - 2];
    const box = frameWorldBox(frames[1], scale);
    // 변환된 경계: x 25~35, y -2~3 → 여백 x 0.3, y 0.15
    expect(box!.minX).toBeCloseTo(24.7);
    expect(box!.maxX).toBeCloseTo(35.3);
    expect(box!.minY).toBeCloseTo(-2.15);
    expect(box!.maxY).toBeCloseTo(3.15);
  });

  it('여백 비율을 바꿀 수 있다', () => {
    const box = frameWorldBox(frames[0], identity, 0);
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
  });

  it('모서리 하나라도 변환 불가면 null', () => {
    const partial = (p: [number, number]): [number, number] | null => (p[0] === 100 && p[1] === 50 ? null : p);
    expect(frameWorldBox(frames[0], partial)).toBeNull();
    expect(frameWorldBox(frames[0], () => null)).toBeNull();
  });

  it('폭이나 높이가 0인 틀·잘못된 틀은 null', () => {
    expect(frameWorldBox({ minX: 0, minY: 0, maxX: 0, maxY: 50 }, identity)).toBeNull();
    expect(frameWorldBox({ minX: 0, minY: 10, maxX: 100, maxY: 10 }, identity)).toBeNull();
    expect(frameWorldBox(null, identity)).toBeNull();
    expect(frameWorldBox({ minX: 0, minY: 0, maxX: Number.NaN, maxY: 50 }, identity)).toBeNull();
  });
});

describe('pageLabel', () => {
  it('0부터 센 번호를 1부터 세어 "3 / 7"로 보인다', () => {
    expect(pageLabel(2, 7)).toBe('3 / 7');
    expect(pageLabel(0, 1)).toBe('1 / 1');
  });
});
