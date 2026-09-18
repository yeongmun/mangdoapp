import { describe, expect, it } from 'vitest';
import { extensionOf, mimeOf, PHOTO_JPEG_QUALITY, PHOTO_MAX_LONG_SIDE, shrinkAction } from '../../src/photoShrink.js';

describe('shrinkAction', () => {
  it('상수는 사용자 설정(긴축 1600)과 품질 0.75다', () => {
    expect(PHOTO_MAX_LONG_SIDE).toBe(1600);
    expect(PHOTO_JPEG_QUALITY).toBe(0.75);
  });

  it('가로 사진은 가로를 1600으로 맞춘다', () => {
    expect(shrinkAction(4032, 3024)).toEqual({ width: 1600 });
  });

  it('세로 사진은 세로를 1600으로 맞춘다', () => {
    expect(shrinkAction(3024, 4032)).toEqual({ height: 1600 });
  });

  it('정사각형은 가로를 맞춘다', () => {
    expect(shrinkAction(3000, 3000)).toEqual({ width: 1600 });
  });

  it('긴 변이 1600 이하이면 줄이지 않는다', () => {
    expect(shrinkAction(1600, 1200)).toBeNull();
    expect(shrinkAction(800, 1000)).toBeNull();
  });

  it('크기를 모르면(0·NaN·undefined) 줄이지 않는다', () => {
    expect(shrinkAction(0, 0)).toBeNull();
    expect(shrinkAction(Number.NaN, 100)).toBeNull();
    expect(shrinkAction(undefined as unknown as number, 100)).toBeNull();
  });

  it('상한을 바꿔 부를 수 있다', () => {
    expect(shrinkAction(1000, 500, 320)).toEqual({ width: 320 });
  });
});

describe('extensionOf / mimeOf (보관 사본 uri 기준)', () => {
  it('확장자는 소문자 점 포함, 없으면 .jpg', () => {
    expect(extensionOf('file:///x/photo-queue/1-ab.jpg')).toBe('.jpg');
    expect(extensionOf('IMG_0021.HEIC')).toBe('.heic');
    expect(extensionOf('file:///x/cache/ABC-123')).toBe('.jpg');
  });

  it('?query·#hash 꼬리는 떼고 본다', () => {
    expect(extensionOf('file:///x/a.png?ts=1')).toBe('.png');
    expect(extensionOf('file:///x/a.heic#frag')).toBe('.heic');
  });

  it('MIME은 확장자로 정하고 모르면 image/jpeg', () => {
    expect(mimeOf('file:///x/1.jpg')).toBe('image/jpeg');
    expect(mimeOf('a.JPEG')).toBe('image/jpeg');
    expect(mimeOf('a.png')).toBe('image/png');
    expect(mimeOf('a.heif')).toBe('image/heic');
    expect(mimeOf('a.webp')).toBe('image/jpeg');
  });
});
