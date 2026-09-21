import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DamagesStore } from '../src/damagesStore.js';
import { DrawingsStore, type DrawingRecord } from '../src/drawingsStore.js';
import { DrawingTrash } from '../src/drawingTrash.js';
import { OriginalsStore } from '../src/originalsStore.js';
import { PhotosStore } from '../src/photosStore.js';

const ID = 'd_00000000000000000000000000000001';
const OTHER = 'd_00000000000000000000000000000002';
const D1 = '11111111-1111-4111-8111-111111111111';
const DELETED_AT = '2026-09-18T10:00:00.000Z';

let dir: string;
let drawings: DrawingsStore;
let damages: DamagesStore;
let originals: OriginalsStore;
let photos: PhotosStore;
let trash: DrawingTrash;

function record(id: string, name = '교량 A.dxf'): DrawingRecord {
  return {
    id,
    name,
    objectKey: `${id}.dxf`,
    urn: `urn-${id}`,
    status: 'success',
    progress: 'complete',
    error: null,
    uploadedAt: '2026-09-10T00:00:00.000Z',
  };
}

async function seedFull(id: string, name?: string): Promise<void> {
  await drawings.add(record(id, name));
  await originals.save(`${id}.dxf`, Buffer.from('dxf-bytes'));
  await damages.save({ schemaVersion: 5, drawingId: id, updatedAt: '2026-09-11T00:00:00.000Z', damages: [] });
  await photos.save(id, D1, '101530', '.jpg', Buffer.from('photo'));
  await photos.saveThumb(id, D1, '101530', Buffer.from('thumb'));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mangdo-trash-'));
  drawings = new DrawingsStore(join(dir, 'drawings.json'));
  damages = new DamagesStore(join(dir, 'damages'));
  originals = new OriginalsStore(join(dir, 'drawings'));
  photos = new PhotosStore(join(dir, 'photos'));
  trash = new DrawingTrash(
    {
      trashDir: join(dir, 'trash'),
      originalsDir: join(dir, 'drawings'),
      damagesDir: join(dir, 'damages'),
      photosDir: join(dir, 'photos'),
    },
    drawings,
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('DrawingTrash.moveToTrash', () => {
  it('목록에서 빼고 원본·손상·사진을 휴지통 폴더로 옮긴다', async () => {
    await seedFull(ID);
    await seedFull(OTHER, '교량 B.dxf');

    const result = await trash.moveToTrash(ID, DELETED_AT);

    expect(result).toEqual({
      id: ID,
      name: '교량 A.dxf',
      uploadedAt: '2026-09-10T00:00:00.000Z',
      deletedAt: DELETED_AT,
    });
    expect((await drawings.list()).map((r) => r.id)).toEqual([OTHER]);
    expect(await originals.read(`${ID}.dxf`)).toBeNull();
    expect(await photos.listDrawing(ID)).toEqual([]);
    expect((await readdir(join(dir, 'trash', ID))).sort()).toEqual([
      `${ID}.dxf`,
      'damages.json',
      'photos',
      'record.json',
    ]);
    expect((await readdir(join(dir, 'trash', ID, 'photos', D1))).sort()).toEqual(['101530.jpg', '101530.thumb.jpg']);
    // 다른 도면은 건드리지 않는다.
    expect((await originals.read(`${OTHER}.dxf`))!.toString()).toBe('dxf-bytes');
    expect(await photos.listDrawing(OTHER)).toHaveLength(1);
  });

  it('손상·사진이 없는 도면도 옮긴다', async () => {
    await drawings.add(record(ID));
    await originals.save(`${ID}.dxf`, Buffer.from('x'));
    expect(await trash.moveToTrash(ID, DELETED_AT)).not.toBeNull();
    expect((await readdir(join(dir, 'trash', ID))).sort()).toEqual([`${ID}.dxf`, 'record.json']);
  });

  it('없는 도면·잘못된 id는 null이고 아무것도 만들지 않는다', async () => {
    expect(await trash.moveToTrash(ID, DELETED_AT)).toBeNull();
    expect(await trash.moveToTrash('../x', DELETED_AT)).toBeNull();
    expect(await trash.list()).toEqual([]);
  });
});

describe('DrawingTrash.list', () => {
  it('최근에 지운 것이 위에 온다', async () => {
    await seedFull(ID);
    await seedFull(OTHER, '교량 B.dxf');
    await trash.moveToTrash(ID, '2026-09-18T10:00:00.000Z');
    await trash.moveToTrash(OTHER, '2026-09-18T11:00:00.000Z');
    expect((await trash.list()).map((t) => [t.name, t.deletedAt])).toEqual([
      ['교량 B.dxf', '2026-09-18T11:00:00.000Z'],
      ['교량 A.dxf', '2026-09-18T10:00:00.000Z'],
    ]);
  });

  it('record.json이 없거나 깨진 폴더, 도면 id가 아닌 폴더는 뺀다', async () => {
    await mkdir(join(dir, 'trash', ID), { recursive: true });
    await mkdir(join(dir, 'trash', OTHER), { recursive: true });
    await writeFile(join(dir, 'trash', OTHER, 'record.json'), '{not json', 'utf8');
    await mkdir(join(dir, 'trash', 'notes'), { recursive: true });
    expect(await trash.list()).toEqual([]);
  });
});

describe('DrawingTrash.restore', () => {
  it('지운 도면을 그대로 되살린다 (레코드·원본·손상·사진·썸네일)', async () => {
    await seedFull(ID);
    await trash.moveToTrash(ID, DELETED_AT);

    const restored = await trash.restore(ID);

    expect(restored).toEqual(record(ID));
    expect((await drawings.list()).map((r) => r.id)).toEqual([ID]);
    expect((await originals.read(`${ID}.dxf`))!.toString()).toBe('dxf-bytes');
    expect((await damages.get(ID)).updatedAt).toBe('2026-09-11T00:00:00.000Z');
    const entry = (await photos.find(ID, D1, '101530'))!;
    expect((await photos.readData(ID, entry)).toString()).toBe('photo');
    expect((await photos.readThumb(ID, entry))!.toString()).toBe('thumb');
    expect(await trash.list()).toEqual([]);
    expect(await readdir(join(dir, 'trash'))).toEqual([]);
  });

  it('되살린 뒤 다시 지울 수 있다', async () => {
    await seedFull(ID);
    await trash.moveToTrash(ID, DELETED_AT);
    await trash.restore(ID);
    expect(await trash.moveToTrash(ID, '2026-09-19T00:00:00.000Z')).not.toBeNull();
    expect((await trash.list()).map((t) => t.deletedAt)).toEqual(['2026-09-19T00:00:00.000Z']);
  });

  it('휴지통에 없으면 null', async () => {
    expect(await trash.restore(ID)).toBeNull();
    expect(await trash.restore('../x')).toBeNull();
  });

  it('지우다 중간에 죽어 파일이 제자리에 남았어도 되살아난다 (제자리 파일이 이긴다)', async () => {
    await seedFull(ID);
    await trash.moveToTrash(ID, DELETED_AT);
    // 죽은 상황을 흉내: 손상 기록이 제자리에도 있다(더 최신).
    await damages.save({ schemaVersion: 5, drawingId: ID, updatedAt: '2026-09-12T00:00:00.000Z', damages: [] });

    await trash.restore(ID);

    expect((await damages.get(ID)).updatedAt).toBe('2026-09-12T00:00:00.000Z');
    expect((await drawings.list()).map((r) => r.id)).toEqual([ID]);
  });

  it('레코드가 이미 목록에 있으면 두 번 넣지 않는다', async () => {
    await seedFull(ID);
    await trash.moveToTrash(ID, DELETED_AT);
    await drawings.add(record(ID));
    await trash.restore(ID);
    expect(await drawings.list()).toHaveLength(1);
  });

  it('record.json은 목록에서 뺀 레코드를 그대로 담는다', async () => {
    await seedFull(ID);
    await trash.moveToTrash(ID, DELETED_AT);
    const saved = JSON.parse(await readFile(join(dir, 'trash', ID, 'record.json'), 'utf8'));
    expect(saved).toEqual({ record: record(ID), deletedAt: DELETED_AT });
  });

  // 근거: docs/superpowers/specs/2026-09-21-projects-design.md 2.3 — 비어 있음 판단에
  // 휴지통 도면을 넣지 않으므로, 프로젝트가 지워진 뒤 휴지통 도면을 복구하는 경우가 생긴다.
  describe('projectId와 프로젝트 존재 확인(세 번째 생성자 인자)', () => {
    it('projectExists가 true를 주면 projectId를 그대로 둔다', async () => {
      const withProject = new DrawingTrash(
        {
          trashDir: join(dir, 'trash'),
          originalsDir: join(dir, 'drawings'),
          damagesDir: join(dir, 'damages'),
          photosDir: join(dir, 'photos'),
        },
        drawings,
        async (id) => id === 'p_exists',
      );
      await drawings.add({ ...record(ID), projectId: 'p_exists' });
      await withProject.moveToTrash(ID, DELETED_AT);

      const restored = await withProject.restore(ID);

      expect(restored?.projectId).toBe('p_exists');
    });

    it('projectExists가 false를 주면 복구 시 projectId를 null로 바꾼다', async () => {
      const withProject = new DrawingTrash(
        {
          trashDir: join(dir, 'trash'),
          originalsDir: join(dir, 'drawings'),
          damagesDir: join(dir, 'damages'),
          photosDir: join(dir, 'photos'),
        },
        drawings,
        async () => false,
      );
      await drawings.add({ ...record(ID), projectId: 'p_gone' });
      await withProject.moveToTrash(ID, DELETED_AT);

      const restored = await withProject.restore(ID);

      expect(restored?.projectId).toBeNull();
      expect((await drawings.get(ID))?.projectId).toBeNull();
    });

    it('세 번째 인자를 주지 않으면(옛 호출) projectId를 그대로 둔다', async () => {
      // trash(모듈 최상위 인스턴스)는 projectExists 없이 만들어졌다 — 컴파일이 그대로 되는지도 확인한다.
      await drawings.add({ ...record(ID), projectId: 'p_whatever' });
      await trash.moveToTrash(ID, DELETED_AT);

      const restored = await trash.restore(ID);

      expect(restored?.projectId).toBe('p_whatever');
    });

    it('projectId가 없거나 null인 도면은 projectExists를 부르지 않는다', async () => {
      const projectExists = vi.fn(async (_id: string) => false);
      const withProject = new DrawingTrash(
        {
          trashDir: join(dir, 'trash'),
          originalsDir: join(dir, 'drawings'),
          damagesDir: join(dir, 'damages'),
          photosDir: join(dir, 'photos'),
        },
        drawings,
        projectExists,
      );
      await drawings.add(record(ID));
      await withProject.moveToTrash(ID, DELETED_AT);

      const restored = await withProject.restore(ID);

      expect(restored?.projectId).toBeUndefined();
      expect(projectExists).not.toHaveBeenCalled();
    });
  });
});
