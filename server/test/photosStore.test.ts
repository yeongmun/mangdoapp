import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDamageId, isPhotoNumber, PhotosStore } from '../src/photosStore.js';

const DRAWING = 'd_00000000000000000000000000000001';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';

let dir: string;
let photos: PhotosStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-photos-'));
  photos = new PhotosStore(join(dir, 'photos'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('id·번호 검증', () => {
  it('UUID만 손상 id다', () => {
    expect(isDamageId(D1)).toBe(true);
    expect(isDamageId('c1')).toBe(false);
    expect(isDamageId('../../etc')).toBe(false);
    expect(isDamageId(`${D1}/x`)).toBe(false);
    expect(isDamageId(null)).toBe(false);
  });

  it('사진번호는 영문·숫자·-·_ 만', () => {
    expect(isPhotoNumber('101530')).toBe(true);
    expect(isPhotoNumber('DSC_0001')).toBe(true);
    expect(isPhotoNumber('P-013')).toBe(true);
    expect(isPhotoNumber('..')).toBe(false);
    expect(isPhotoNumber('a/b')).toBe(false);
    expect(isPhotoNumber('a\\b')).toBe(false);
    expect(isPhotoNumber('')).toBe(false);
    expect(isPhotoNumber('가나다')).toBe(false);
  });
});

describe('PhotosStore', () => {
  it('저장하면 폴더가 생기고 목록에 나온다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    expect(await readdir(join(dir, 'photos', DRAWING, D1))).toEqual(['101530.jpg']);
    const list = await photos.list(DRAWING, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ damageId: D1, number: '101530', file: '101530.jpg', size: 3 });
    expect(Number.isFinite(Date.parse(list[0].savedAt))).toBe(true);
  });

  it('없는 폴더의 목록은 빈 배열이다', async () => {
    expect(await photos.list(DRAWING, D1)).toEqual([]);
    expect(await photos.listDrawing(DRAWING)).toEqual([]);
  });

  it('같은 번호를 다시 올리면 확장자가 달라도 하나만 남는다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    await photos.save(DRAWING, D1, '101530', '.png', Buffer.from('defg'));
    expect(await readdir(join(dir, 'photos', DRAWING, D1))).toEqual(['101530.png']);
    const list = await photos.list(DRAWING, D1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: '101530', file: '101530.png', size: 4 });
  });

  it('목록은 사진번호 오름차순이다 (값 순서)', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '9', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '88', '.jpg', Buffer.from('a'));
    expect((await photos.list(DRAWING, D1)).map((e) => e.number)).toEqual(['9', '88', '101530']);
  });

  it('우리 규칙에 맞지 않는 파일은 목록에서 뺀다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('a'));
    await writeFile(join(dir, 'photos', DRAWING, D1, 'note.txt'), 'x', 'utf8');
    await writeFile(join(dir, 'photos', DRAWING, D1, '가나다.jpg'), 'x', 'utf8');
    expect((await photos.list(DRAWING, D1)).map((e) => e.number)).toEqual(['101530']);
  });

  it('listDrawing은 손상 폴더를 이름순으로 모으고 UUID가 아닌 폴더는 뺀다', async () => {
    await photos.save(DRAWING, D2, '1', '.jpg', Buffer.from('a'));
    await photos.save(DRAWING, D1, '2', '.jpg', Buffer.from('a'));
    await mkdir(join(dir, 'photos', DRAWING, 'tmp'), { recursive: true });
    await writeFile(join(dir, 'photos', DRAWING, 'tmp', '3.jpg'), 'x', 'utf8');
    expect((await photos.listDrawing(DRAWING)).map((e) => [e.damageId, e.number])).toEqual([
      [D1, '2'],
      [D2, '1'],
    ]);
  });

  it('readData는 저장한 내용을 그대로 돌려준다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    const entry = await photos.find(DRAWING, D1, '101530');
    expect(entry).not.toBeNull();
    expect((await photos.readData(DRAWING, entry!)).toString()).toBe('abc');
  });

  it('없는 번호는 null', async () => {
    expect(await photos.find(DRAWING, D1, '999')).toBeNull();
  });

  it('pathOf는 폴더 아래 경로를 만들고, 이름이 이상하면 던진다', async () => {
    await photos.save(DRAWING, D1, '101530', '.jpg', Buffer.from('abc'));
    const entry = (await photos.find(DRAWING, D1, '101530'))!;
    expect(photos.pathOf(DRAWING, entry)).toBe(join(dir, 'photos', DRAWING, D1, '101530.jpg'));
    expect(() => photos.pathOf(DRAWING, { ...entry, file: '../x.jpg' })).toThrow('잘못된 사진 파일 이름');
  });

  it('잘못된 id·번호·확장자는 던진다 (경로 조작 방지)', async () => {
    await expect(photos.save(DRAWING, 'c1', '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 손상 id');
    await expect(photos.save(DRAWING, '..', '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 손상 id');
    await expect(photos.save('nope', D1, '1', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 도면 id');
    await expect(photos.save(DRAWING, D1, '../x', '.jpg', Buffer.from('a'))).rejects.toThrow('잘못된 사진번호');
    await expect(photos.save(DRAWING, D1, '1', '.exe', Buffer.from('a'))).rejects.toThrow('잘못된 확장자');
  });
});
