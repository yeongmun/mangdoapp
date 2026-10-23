// 촬영 항목(shot) 저장소. 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 3·서버(앱)
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { loadRequiredTemplate, mergeRequired, shotFileName, ShotsStore, type Shot } from '../src/shotsStore.js';

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

  it('savePhoto는 파일을 쓰고 photo를 채우며 두 번째는 덮어쓴다', async () => {
    await store.replace('p_1', [base]);
    const first = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('one'), T);
    expect(first?.photo).toEqual({ file: '001.jpg', savedAt: T });
    const second = await store.savePhoto('p_1', 's0', '.jpg', Buffer.from('two'), '2026-10-24T01:00:00.000Z');
    expect(second?.photo?.file).toBe('001.jpg');
    expect(await readFile(store.pathOf('p_1', second!), 'utf8')).toBe('two');
    expect((await store.list('p_1'))[0].photo?.savedAt).toBe('2026-10-24T01:00:00.000Z');
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
      expect(await loadRequiredTemplate(join(dir, 'ok.json'))).toEqual({ _설명: [], 교량: [{ member: '전경', label: '상류측' }] });
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
