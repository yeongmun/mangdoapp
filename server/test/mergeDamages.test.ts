import { describe, expect, it } from 'vitest';
import { mergeDamageDocs, type MergeableDoc } from '../src/mergeDamages.js';

const T = (s: string) => `2026-10-07T${s}:00.000Z`;
function dmg(id: string, updatedAt: string, note = '') {
  return { id, type: 'crack', createdAt: T('09:00'), updatedAt, attrs: { note } };
}
function doc(damages: unknown[], updatedAt: string, deleted?: MergeableDoc['deleted']): MergeableDoc {
  return { schemaVersion: 5, drawingId: 'd_1', updatedAt, damages, ...(deleted ? { deleted } : {}) };
}

describe('mergeDamageDocs', () => {
  it('서로 다른 손상은 합집합 — 다른 기기가 그린 것이 사라지지 않는다', () => {
    const out = mergeDamageDocs(doc([dmg('a', T('10:00'))], T('10:00')), doc([dmg('b', T('10:05'))], T('10:05')));
    expect(out.damages.map((d) => (d as { id: string }).id)).toEqual(['a', 'b']);
    expect(out.updatedAt).toBe(T('10:05'));
    expect(out.deleted).toBeUndefined();
  });

  it('같은 손상은 수정 시각이 늦은 쪽, 같으면 들어온 쪽', () => {
    const out = mergeDamageDocs(doc([dmg('a', T('10:00'), '서버')], T('10:00')), doc([dmg('a', T('10:05'), '기기')], T('10:05')));
    expect((out.damages[0] as { attrs: { note: string } }).attrs.note).toBe('기기');
    const tie = mergeDamageDocs(doc([dmg('a', T('10:00'), '서버')], T('10:00')), doc([dmg('a', T('10:00'), '기기')], T('10:00')));
    expect((tie.damages[0] as { attrs: { note: string } }).attrs.note).toBe('기기');
    const older = mergeDamageDocs(doc([dmg('a', T('10:09'), '서버')], T('10:09')), doc([dmg('a', T('10:05'), '기기')], T('10:05')));
    expect((older.damages[0] as { attrs: { note: string } }).attrs.note).toBe('서버');
  });

  it('updatedAt이 없는 옛 기기 손상은 createdAt으로 비교한다', () => {
    const legacy = { id: 'a', createdAt: T('09:00'), attrs: { note: '옛' } };
    const out = mergeDamageDocs(doc([legacy], T('09:00')), doc([dmg('a', T('10:00'), '새')], T('10:00')));
    expect((out.damages[0] as { attrs: { note: string } }).attrs.note).toBe('새');
  });

  it('들어온 쪽이 지운 손상(deleted)은 서버에서도 빠지고 기록은 남는다', () => {
    const out = mergeDamageDocs(doc([dmg('a', T('10:00')), dmg('b', T('10:00'))], T('10:00')), doc([dmg('b', T('10:00'))], T('10:10'), [{ id: 'a', deletedAt: T('10:10') }]));
    expect(out.damages.map((d) => (d as { id: string }).id)).toEqual(['b']);
    expect(out.deleted).toEqual([{ id: 'a', deletedAt: T('10:10') }]);
  });

  it('삭제보다 나중에 고친 손상은 되살아나고 삭제 기록이 빠진다', () => {
    const out = mergeDamageDocs(doc([], T('10:10'), [{ id: 'a', deletedAt: T('10:10') }]), doc([dmg('a', T('10:20'))], T('10:20')));
    expect(out.damages.map((d) => (d as { id: string }).id)).toEqual(['a']);
    expect(out.deleted).toBeUndefined();
  });

  it('삭제 기록보다 오래된 수정은 지운 채로 둔다(옛 기기가 모르고 다시 올려도 되살아나지 않는다)', () => {
    const out = mergeDamageDocs(doc([], T('10:10'), [{ id: 'a', deletedAt: T('10:10') }]), doc([dmg('a', T('10:00'))], T('10:00')));
    expect(out.damages).toEqual([]);
    expect(out.deleted).toEqual([{ id: 'a', deletedAt: T('10:10') }]);
  });

  it('삭제 기록은 양쪽 합집합이고 id마다 늦은 시각', () => {
    const out = mergeDamageDocs(
      doc([], T('10:00'), [{ id: 'x', deletedAt: T('10:00') }]),
      doc([], T('10:05'), [{ id: 'x', deletedAt: T('10:05') }, { id: 'y', deletedAt: T('10:01') }]),
    );
    expect(out.deleted).toEqual([{ id: 'x', deletedAt: T('10:05') }, { id: 'y', deletedAt: T('10:01') }]);
  });

  it('빈 서버 문서에 올리면 들어온 것 그대로', () => {
    const out = mergeDamageDocs(doc([], '1970-01-01T00:00:00.000Z'), doc([dmg('a', T('10:00'))], T('10:00')));
    expect(out).toEqual(doc([dmg('a', T('10:00'))], T('10:00')));
  });
});
