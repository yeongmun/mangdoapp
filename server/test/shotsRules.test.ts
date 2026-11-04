import { describe, expect, it } from 'vitest';
import { newPhotoId, normalizeLocal, photoCountOf, reconcileLocal } from '../../src/shotsRules.js';

const old = { uri: 'file:///a.jpg', takenAt: 1 };
const q = (shotIds: string[], photoIds: string[] = []) => ({ shotIds: new Set(shotIds), photoIds: new Set(photoIds) });

describe('reconcileLocal (옛 사본 — photoId 없음)', () => {
  it('서버에 사진이 올라갔으면 사본을 지운다', () => {
    expect(reconcileLocal({ a: [old] }, [{ id: 'a', photo: { file: '001.jpg' } }], q(['a']))).toEqual({});
  });
  it('서버에도 대기열에도 없으면(버려진 전송) 지운다', () => {
    expect(reconcileLocal({ a: [old] }, [{ id: 'a' }], q([]))).toEqual({});
  });
  it('대기 중이면 남긴다', () => {
    expect(reconcileLocal({ a: [old] }, [{ id: 'a' }], q(['a']))).toEqual({ a: [old] });
  });
  it('서버 목록을 아직 못 받았으면 그대로', () => {
    expect(reconcileLocal({ a: [old] }, null, q([]))).toEqual({ a: [old] });
  });
});

describe('reconcileLocal (한 칸 여러 장, 11-05)', () => {
  const p1 = { uri: 'file:///1.jpg', takenAt: 1, photoId: 'ph_1' };
  const p2 = { uri: 'file:///2.jpg', takenAt: 2, photoId: 'ph_2' };
  it('서버에 올라간 사진만 빠지고 나머지 대기 사본은 남는다(이미 대표가 있어도)', () => {
    const server = [{ id: 'a', photo: { file: '001.jpg' }, photos: [{ id: 'ph_1' }] }];
    expect(reconcileLocal({ a: [p1, p2] }, server, q(['a'], ['ph_1', 'ph_2']))).toEqual({ a: [p2] });
  });
  it('대기열에서 사라진 사진(버려짐)은 뺀다', () => {
    expect(reconcileLocal({ a: [p1, p2] }, [{ id: 'a' }], q(['a'], ['ph_2']))).toEqual({ a: [p2] });
  });
});

describe('normalizeLocal · photoCountOf · newPhotoId', () => {
  it('옛 모양(칸마다 하나)은 목록으로, 깨진 값은 버린다', () => {
    expect(normalizeLocal({ a: old, b: [old, { x: 1 }], c: 3 })).toEqual({ a: [old], b: [old] });
    expect(normalizeLocal(null)).toEqual({});
  });
  it('사진 수 = 서버 사진 + 서버에 아직 없는 사본', () => {
    expect(photoCountOf({ photos: [{ id: 'ph_1' }] }, [{ uri: 'x', takenAt: 0, photoId: 'ph_1' }, { uri: 'y', takenAt: 0, photoId: 'ph_2' }])).toBe(2);
    expect(photoCountOf({ photo: {} }, undefined)).toBe(1);
    expect(photoCountOf({}, [old])).toBe(1);
  });
  it('사진 id는 서버 규칙(영문·숫자·_-)에 맞는다', () => {
    expect(newPhotoId(1730000000000, 0.123456)).toMatch(/^[A-Za-z0-9_-]{2,64}$/);
  });
});
