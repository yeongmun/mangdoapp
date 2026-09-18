import { describe, expect, it } from 'vitest';
import { blocksDrawing, photoStripItems } from '../public/viewer/photoStrip.js';

function photo(number: string) {
  return {
    number,
    url: `/api/x/photos/${number}`,
    thumbUrl: `/api/x/photos/${number}/thumb`,
    size: 10,
    savedAt: '2026-09-18T01:00:00.000Z',
  };
}

describe('photoStripItems', () => {
  it('서버에 있는 사진은 번호 순서대로 그림, 칸에만 있는 번호는 칩', () => {
    const items = photoStripItems(['101530', '101600', '999'], [photo('101600'), photo('101530')]);
    expect(items).toEqual([
      { kind: 'image', number: '101530', url: '/api/x/photos/101530', thumbUrl: '/api/x/photos/101530/thumb' },
      { kind: 'image', number: '101600', url: '/api/x/photos/101600', thumbUrl: '/api/x/photos/101600/thumb' },
      { kind: 'missing', number: '999' },
    ]);
  });

  it('번호 순서는 값 기준이다 (9가 101530보다 앞)', () => {
    expect(photoStripItems([], [photo('101530'), photo('9')]).map((item) => item.number)).toEqual(['9', '101530']);
  });

  it('칸에 없는 파일도 보여준다 (칸에서 번호를 지운 사진)', () => {
    expect(photoStripItems([], [photo('777')])).toEqual([
      { kind: 'image', number: '777', url: '/api/x/photos/777', thumbUrl: '/api/x/photos/777/thumb' },
    ]);
  });

  it('thumbUrl이 없는 옛 서버 응답은 본 사진 주소를 썸네일로 쓴다', () => {
    const old = { number: '5', url: '/api/x/photos/5', size: 1, savedAt: '2026-09-18T01:00:00.000Z' };
    expect(photoStripItems([], [old])).toEqual([
      { kind: 'image', number: '5', url: '/api/x/photos/5', thumbUrl: '/api/x/photos/5' },
    ]);
  });

  it('칩 순서는 칸에 적힌 순서를 지킨다', () => {
    expect(photoStripItems(['22', '11'], []).map((item) => item.number)).toEqual(['22', '11']);
  });

  it('둘 다 비면 빈 배열, 입력이 배열이 아니어도 던지지 않는다', () => {
    expect(photoStripItems([], [])).toEqual([]);
    // @ts-expect-error 일부러 잘못된 입력을 넣는다 (목록 요청이 실패했을 때)
    expect(photoStripItems(null, null)).toEqual([]);
  });
});

describe('blocksDrawing', () => {
  it('속성창이나 사진 오버레이가 열려 있으면 도면 입력을 막는다', () => {
    expect(blocksDrawing(false, false)).toBe(false);
    expect(blocksDrawing(true, false)).toBe(true);
    expect(blocksDrawing(false, true)).toBe(true);
    expect(blocksDrawing(true, true)).toBe(true);
  });
});
