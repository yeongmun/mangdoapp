// 과업 목록 카드의 사진 진행·이어서 찍기·최근 찍은 사진(2026-10-25 농농 폰 시안). 기기 저장(shots/<id>.json) 기준.
import { describe, expect, it } from 'vitest';
import { nextStructure, photoProgress, recentPhotos, type ShotCache } from '../../src/homeSummary.js';

const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'required' as const, member: '교대', label: 'A1', number: '001', thumbUrl: null, ...extra });

const cache = (shots: ReturnType<typeof shot>[] | null, local: ShotCache['local'] = {}): ShotCache => ({
  list: shots === null ? null : { shots },
  local,
});

describe('photoProgress', () => {
  it('구조물들의 찍은 수/전체 수. 휴지통 항목은 빼고, 기기 사본만 있어도 찍음', () => {
    const a = cache([shot('1', { photo: { savedAt: 'x' } }), shot('2'), shot('3', { trashed: true, photo: { savedAt: 'x' } })]);
    const b = cache([shot('4')], { '4': { uri: 'file:///4.jpg', takenAt: 5 } });
    expect(photoProgress([a, b])).toEqual({ taken: 2, total: 3 });
  });
  it('전차 사진이 있는 구조물은 전차 사진만 센다(그것만 찍어도 된다)', () => {
    const a = cache([shot('1'), shot('2'), shot('3', { kind: 'previous', photo: { savedAt: 'x' } }), shot('4', { kind: 'previous', trashed: true })]);
    expect(photoProgress([a])).toEqual({ taken: 1, total: 1 });
  });
  it('한 번도 목록을 못 받았으면 null', () => {
    expect(photoProgress([cache(null), cache(null)])).toBeNull();
    expect(photoProgress([])).toBeNull();
  });
});

describe('nextStructure', () => {
  it('남은 사진이 있는 첫 구조물, 다 찍었거나 모르면 첫 구조물', () => {
    const done = cache([shot('1', { photo: { savedAt: 'x' } })]);
    const left = cache([shot('2')]);
    expect(nextStructure([{ id: 'a' }, { id: 'b' }], { a: done, b: left })).toBe('b');
    expect(nextStructure([{ id: 'a' }, { id: 'b' }], { a: done, b: done })).toBe('a');
    expect(nextStructure([{ id: 'a' }], {})).toBe('a');
    // 기기에 목록이 없는(한 번도 안 연) 구조물은 남은 것으로 본다
    expect(nextStructure([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { a: done, c: left })).toBe('b');
    expect(nextStructure([{ id: 'a' }, { id: 'b' }], { a: done, b: cache(null) })).toBe('b');
    // 전차 사진을 다 찍었으면 필수가 남아 있어도 끝난 것
    const prevDone = cache([shot('5'), shot('6', { kind: 'previous', photo: { savedAt: 'x' } })]);
    expect(nextStructure([{ id: 'a' }, { id: 'b' }], { a: prevDone, b: left })).toBe('b');
    expect(nextStructure([], {})).toBeNull();
  });
});

describe('recentPhotos', () => {
  it('기기 사본(takenAt)·서버 사진(savedAt)을 시간 역순으로, limit개', () => {
    const a = cache(
      [shot('1', { photo: { savedAt: '2026-10-25T01:00:00.000Z' } }), shot('2'), shot('3', { trashed: true, photo: { savedAt: '2026-10-25T09:00:00.000Z' } })],
      { '2': { uri: 'file:///2.jpg', takenAt: Date.parse('2026-10-25T02:00:00.000Z') } },
    );
    const b = cache([shot('4', { photo: { savedAt: '2026-10-25T03:00:00.000Z' } })]);
    const out = recentPhotos(
      [
        { projectId: 'pa', projectName: 'A교', cache: a },
        { projectId: 'pb', projectName: 'B교', cache: b },
      ],
      2,
    );
    expect(out.map((r) => [r.projectId, r.shot.id, r.localUri ?? null])).toEqual([
      ['pb', '4', null],
      ['pa', '2', 'file:///2.jpg'],
    ]);
    expect(out[0].projectName).toBe('B교');
  });
});
