import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeThumbnail, THUMB_MAX_PX } from '../src/photoThumb.js';

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .toBuffer();
}

describe('makeThumbnail', () => {
  it('가로 사진은 긴 변(가로)을 320으로 줄이고 JPEG로 낸다', async () => {
    const thumb = await makeThumbnail(await jpeg(1600, 1200));
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(THUMB_MAX_PX);
    expect(meta.height).toBe(240);
  });

  it('세로 사진은 긴 변(세로)을 320으로 줄인다', async () => {
    const meta = await sharp(await makeThumbnail(await jpeg(1200, 1600))).metadata();
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(THUMB_MAX_PX);
  });

  it('320보다 작은 사진은 키우지 않는다', async () => {
    const meta = await sharp(await makeThumbnail(await jpeg(100, 80))).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it('EXIF 회전(6 = 시계방향 90°)을 적용해 세로 사진이 눕지 않는다', async () => {
    const rotated = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#888' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(await makeThumbnail(rotated)).metadata();
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(THUMB_MAX_PX);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('썸네일은 본 사진보다 훨씬 작다', async () => {
    const source = await jpeg(1600, 1200);
    const thumb = await makeThumbnail(source);
    expect(thumb.length).toBeLessThan(source.length);
  });

  it('사진이 아니면 거부한다', async () => {
    await expect(makeThumbnail(Buffer.from('jpeg-bytes'))).rejects.toThrow();
  });
});
