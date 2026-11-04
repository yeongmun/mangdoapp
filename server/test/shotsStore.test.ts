// 촬영 항목(shot) 저장소. 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 3·서버(앱)
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { loadRequiredTemplate, mergeRequired, photosOf, shotFileName, ShotsStore, type Shot } from '../src/shotsStore.js';

const T = '2026-10-24T00:00:00.000Z';
const base: Shot = { id: 's0', kind: 'required', member: '전경', label: '상류측', number: '001' };

describe('shotFileName', () => {
  it('구조물_부재_번호.jpg, 위험 글자는 _', () => {
    expect(shotFileName('A교', { ...base, member: '교대/A1', number: '003' })).toBe('A교_교대_A1_003.jpg');
    expect(shotFileName(' 오봉대교 ', base)).toBe('오봉대교_전경_001.jpg');
  });
});

describe('mergeRequired', () => {
  it('안 찍은 항목은 새 목록으로, 찍은 항목은 남고 번호가 이어진다', () => {
    const taken: Shot = { ...base, id: 's1', photo: { file: '001.jpg', savedAt: T } };
    const untaken: Shot = { id: 's2', kind: 'required', member: '교대', label: 'A1', number: '002' };
    const out = mergeRequired(
      [taken, untaken],
      [
        { member: '전경', label: '상류측' },
        { member: '교각', label: 'P1' },
      ],
    );
    expect(out.map((s) => [s.member, s.number])).toEqual([
      ['전경', '001'],
      ['교각', '002'],
    ]);
    expect(out[0].id).toBe('s1');
    expect(out[1].id).not.toBe('s2');
  });

  it('같은 부재·설명이 이미 있으면 id·번호를 유지한다', () => {
    const out = mergeRequired([{ ...base, id: 'keep', number: '007' }], [{ member: '전경', label: '상류측' }]);
    expect(out).toEqual([{ ...base, id: 'keep', number: '007' }]);
  });

  it('찍은 항목이 있으면 새 번호는 그 다음부터', () => {
    const taken: Shot = { ...base, id: 's1', number: '004', photo: { file: '004.jpg', savedAt: T } };
    const out = mergeRequired([taken], [{ member: '교각', label: 'P1' }]);
    expect(out.map((s) => s.number)).toEqual(['004', '005']);
  });

  it('재사용되는 안 찍은 항목의 번호를 새 항목이 가로채지 않는다 (리뷰 2)', () => {
    const a: Shot = { ...base, id: 'a', number: '001', photo: { file: '001.jpg', savedAt: T } };
    const b: Shot = { id: 'b', kind: 'required', member: '교대', label: 'A1', number: '002' };
    const out = mergeRequired([a, b], [{ member: '전경', label: '상류측' }, { member: '교각', label: 'X' }, { member: '교대', label: 'A1' }]);
    expect(out.map((s) => [s.member, s.number])).toEqual([['전경', '001'], ['교각', '003'], ['교대', '002']]);
    expect(new Set(out.map((s) => s.number)).size).toBe(3);
  });

  it('설명을 바꾸면(aliases) 찍은 칸·안 찍은 칸 모두 새 설명으로 옮겨지고 칸이 둘이 되지 않는다 (11-03)', () => {
    const existing: Shot[] = [
      { id: 's_a', kind: 'required', member: '도로포장', label: '도로포장(포트홀·배수불량)', number: '001', photo: { file: '001.jpg', savedAt: 't' } },
      { id: 's_b', kind: 'required', member: '배수', label: '배수구·집수정(퇴적·막힘)', number: '002' },
    ];
    const merged = mergeRequired(existing, [
      { member: '도로포장', label: '도로포장', aliases: ['도로포장(포트홀·배수불량)'] },
      { member: '배수', label: '배수구·집수정', aliases: ['배수구·집수정(퇴적·막힘)'] },
    ]);
    expect(merged.map((x) => [x.id, x.label, x.number])).toEqual([
      ['s_a', '도로포장', '001'],
      ['s_b', '배수구·집수정', '002'],
    ]);
  });

  it('previous 항목은 건드리지 않는다', () => {
    const prev: Shot = { id: 'p1', kind: 'previous', member: '교각', label: '사진 3', number: '001' };
    const out = mergeRequired([prev], [{ member: '전경', label: '상류측' }]);
    expect(out.map((s) => [s.kind, s.number])).toEqual([
      ['previous', '001'],
      ['required', '002'],
    ]);
  });
});

describe('ShotsStore', () => {
  let dir: string;
  let store: ShotsStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mangdo-shots-'));
    store = new ShotsStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('없는 프로젝트는 빈 목록', async () => {
    expect(await store.list('p_x')).toEqual([]);
  });

  it('replace 후 list로 돌아온다', async () => {
    await store.replace('p_1', [base]);
    expect(await store.list('p_1')).toEqual([base]);
  });

  it('savePhoto: photoId 없이(옛 앱)는 대표를 덮어쓴다', async () => {
    await store.replace('p_1', [base]);
    const first = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('one'), T);
    expect(first?.shot.photo).toEqual({ file: '001.jpg', savedAt: T });
    const second = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('two'), '2026-10-24T01:00:00.000Z');
    expect(second?.shot.photo?.file).toBe('001.jpg');
    expect(second?.shot.photos).toHaveLength(1);
    expect(await readFile(store.pathOf('p_1', second!.shot), 'utf8')).toBe('two');
    expect((await store.list('p_1'))[0].photo?.savedAt).toBe('2026-10-24T01:00:00.000Z');
  });

  it('한 칸 여러 장(11-05): 새 photoId는 덧붙이고(-2, -3), 같은 photoId는 덮어쓰며, 지우기·대표 바꾸기', async () => {
    await store.replace('p_1', [base]);
    await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('a'), T, 'ph_a');
    await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('b'), T, 'ph_b');
    const again = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('b2'), T, 'ph_b'); // 재전송 → 덮어쓰기
    await store.savePhoto('p_1', 's0', '.png', Buffer.from('c'), T, 'ph_c');
    let shot = (await store.list('p_1'))[0];
    expect(photosOf(shot).map((p) => [p.id, p.file])).toEqual([
      ['ph_a', '001.jpg'],
      ['ph_b', '001-2.jpg'],
      ['ph_c', '001-3.png'],
    ]);
    expect(await readFile(store.photoPathOf('p_1', again!.photo), 'utf8')).toBe('b2');
    expect(shot.photo?.file).toBe('001.jpg');
    expect(shotFileName('A교', shot, 1)).toBe('A교_전경_001-2.jpg');
    expect(shotFileName('A교', shot, 0)).toBe('A교_전경_001.jpg');
    shot = (await store.setPrimaryPhoto('p_1', 's0', 'ph_c'))!;
    expect(shot.photo?.file).toBe('001-3.png'); // 대표가 바뀌면 zip에선 이 사진이 _001.jpg(순서 기준)
    shot = (await store.deletePhoto('p_1', 's0', 'ph_c'))!;
    expect(photosOf(shot).map((p) => p.id)).toEqual(['ph_a', 'ph_b']);
    expect(shot.photo?.file).toBe('001.jpg');
    // 지운 뒤 새로 찍어도 남은 파일과 이름이 안 겹친다
    const d = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('d'), T, 'ph_d');
    expect(d?.photo.file).toBe('001-3.jpg');
    await store.deletePhoto('p_1', 's0', 'ph_a');
    await store.deletePhoto('p_1', 's0', 'ph_b');
    shot = (await store.deletePhoto('p_1', 's0', 'ph_d'))!;
    expect(shot.photo).toBeUndefined();
    expect(shot.photos).toBeUndefined();
    expect(await store.deletePhoto('p_1', 's0', 'nope')).toBeNull();
  });

  it('옛 기록(photo만)은 p0 한 장으로 읽고, 새 사진을 덧붙일 수 있다', async () => {
    await store.replace('p_1', [{ ...base, photo: { file: '001.jpg', savedAt: T } }]);
    const r = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('x'), T, 'ph_new');
    expect(photosOf(r!.shot).map((p) => [p.id, p.file])).toEqual([
      ['p0', '001.jpg'],
      ['ph_new', '001-2.jpg'],
    ]);
  });

  it('없는 shot이면 null', async () => {
    expect(await store.savePhoto('p_1', 'nope', '.jpg', Buffer.from('x'), T)).toBeNull();
  });
});

describe('loadRequiredTemplate', () => {
  it('JSON이 깨졌거나 없으면 빈 목록으로 기동한다 (리뷰 3)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mangdo-tpl-'));
    try {
      expect(await loadRequiredTemplate(join(dir, 'none.json'))).toEqual({});
      await writeFile(join(dir, 'bad.json'), '{ "교량": [ { member: 전경 } ]');
      expect(await loadRequiredTemplate(join(dir, 'bad.json'))).toEqual({});
      await writeFile(join(dir, 'ok.json'), JSON.stringify({ _설명: 'x', 교량: [{ member: '전경', label: '상류측' }, { bad: 1 }] }));
      expect(await loadRequiredTemplate(join(dir, 'ok.json'))).toEqual({ 교량: { info: [], shots: [{ member: '전경', label: '상류측' }] } }); // _로 시작하는 키는 시설물 종류가 아니다, 옛 형식(배열)은 info 없이
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ShotsStore.ensureRequired', () => {
  it('동시에 두 번 불러도 같은 id를 만든다 (리뷰 4)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mangdo-shots-'));
    try {
      const store = new ShotsStore(dir);
      const tpl = [{ member: '전경', label: '상류측' }];
      const [a, b] = await Promise.all([store.ensureRequired('p_1', tpl), store.ensureRequired('p_1', tpl)]);
      expect(a).toHaveLength(1);
      expect(b[0].id).toBe(a[0].id);
      expect((await store.list('p_1'))[0].id).toBe(a[0].id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// 전차보고서 사진(previous) — 3단계. 설계 결정 2·3
describe('ShotsStore.importPrevious / setGroupTrashed', () => {
  let dir: string;
  let store: ShotsStore;
  const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
  const blocks = [
    { page: 'pg_001', texts: ['사진 1. 교각 P1 균열', '사진 2. 전경'], images: [
      { ref: 'image1', ext: '.png' as const, data: PNG, caption: '사진 1. 교각 P1 균열' },
      { ref: 'image2', ext: '.png' as const, data: PNG, caption: null },
    ] },
    { page: 'pg_002', texts: [], images: [{ ref: 'image3', ext: '.jpg' as const, data: Buffer.from('jpg'), caption: '교대 A1 백태' }] },
  ];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mangdo-prev-'));
    store = new ShotsStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('블록을 previous shot으로 넣고 참조 이미지를 저장한다', async () => {
    const { shots, added } = await store.importPrevious('p_1', blocks, T);
    expect(added).toBe(3);
    expect(shots.map((s) => [s.kind, s.group, s.member, s.label, s.number])).toEqual([
      ['previous', 'r1_pg_001', '교각', '사진 1. 교각 P1 균열', '001'],
      ['previous', 'r1_pg_001', '전차', '사진 2', '002'],
      ['previous', 'r1_pg_002', '교대', '교대 A1 백태', '003'],
    ]);
    expect(shots[0].caption).toBe('사진 1. 교각 P1 균열');
    expect(shots[0].ref?.file).toBe(`${shots[0].id}.png`);
    expect((await readFile(store.refPathOf('p_1', shots[0]))).equals(PNG)).toBe(true);
  });

  it('다시 올리면 안 찍은 previous는 휴지통으로, 찍은 것과 required는 남고 번호·페이지가 안 겹친다 (리뷰 2·3)', async () => {
    await store.replace('p_1', [{ id: 'r1', kind: 'required', member: '전경', label: '상류측', number: '001' }]);
    const first = await store.importPrevious('p_1', blocks, T);
    const taken = first.shots.find((s) => s.kind === 'previous')!;
    await store.savePhoto('p_1', taken.id, '.jpg', Buffer.from('shot'), T);
    const second = await store.importPrevious('p_1', [blocks[1]], T);
    const rows = second.shots.map((s) => [s.kind, s.id === taken.id ? 'kept' : s.id === 'r1' ? 'required' : s.trashed ? 'old-trashed' : 'new', s.number, s.group ?? '']);
    expect(rows).toEqual([
      ['required', 'required', '001', ''],
      ['previous', 'kept', '002', 'r1_pg_001'],
      ['previous', 'old-trashed', '003', 'r1_pg_001'],
      ['previous', 'old-trashed', '004', 'r1_pg_002'],
      ['previous', 'new', '005', 'r2_pg_002'],
    ]);
    expect(new Set(second.shots.map((s) => s.number)).size).toBe(5);
    // 휴지통에 간 옛 항목에도 나중에 사진을 올릴 수 있다(대기열에 있던 사진)
    const old = second.shots[2];
    expect((await store.savePhoto('p_1', old.id, '.jpg', Buffer.from('late'), T))?.photo?.file).toBe('003.jpg');
  });

  it('페이지 휴지통: trashed만 바뀌고 찍은 사진·파일은 그대로, 복구하면 사라진다', async () => {
    const { shots } = await store.importPrevious('p_1', blocks, T);
    await store.savePhoto('p_1', shots[0].id, '.jpg', Buffer.from('shot'), T);
    expect(await store.setGroupTrashed('p_1', 'r1_pg_001', true)).toBe(2);
    const trashed = await store.list('p_1');
    expect(trashed.map((s) => s.trashed ?? false)).toEqual([true, true, false]);
    expect(trashed[0].photo?.file).toBe('001.jpg');
    expect(await readFile(store.pathOf('p_1', trashed[0]), 'utf8')).toBe('shot');
    expect(await store.setGroupTrashed('p_1', 'r1_pg_001', false)).toBe(2);
    expect((await store.list('p_1')).every((s) => s.trashed === undefined)).toBe(true);
    expect(await store.setGroupTrashed('p_1', 'nope', true)).toBe(0);
  });
});

// 4단계: 부재명·설명 수정
describe('ShotsStore.update', () => {
  let dir: string;
  let store: ShotsStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mangdo-upd-'));
    store = new ShotsStore(dir);
    await store.replace('p_1', [base]);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('member·label을 바꾸고 앞뒤 공백을 뗀다. 위험 글자도 저장된다(파일명에서만 _)', async () => {
    const updated = await store.update('p_1', 's0', { member: ' 교각/P1 ', label: '균열' });
    expect(updated).toMatchObject({ member: '교각/P1', label: '균열', number: '001' });
    expect(shotFileName('A교', updated!)).toBe('A교_교각_P1_001.jpg');
    expect((await store.list('p_1'))[0].member).toBe('교각/P1');
  });

  it('빈 값·너무 긴 값은 거부(ShotRuleError), 없는 id는 null, 안 준 키는 그대로', async () => {
    await expect(store.update('p_1', 's0', { member: '  ' })).rejects.toMatchObject({ name: 'ShotRuleError' });
    await expect(store.update('p_1', 's0', { label: 'x'.repeat(121) })).rejects.toMatchObject({ name: 'ShotRuleError' });
    expect(await store.update('p_1', 'nope', { member: '교각' })).toBeNull();
    expect((await store.update('p_1', 's0', { label: '새 설명' }))?.member).toBe('전경');
  });
});
