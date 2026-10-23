import { describe, expect, it } from 'vitest';
import { reconcileLocal } from '../../src/shotsRules.js';

const e = { uri: 'file:///x.jpg', takenAt: 1 };

describe('reconcileLocal', () => {
  it('서버에 올라간 shot의 기기 사본은 지운다', () => {
    expect(reconcileLocal({ a: e }, [{ id: 'a', photo: { file: '001.jpg' } }], new Set(['a']))).toEqual({});
  });
  it('서버에도 없고 대기열에도 없으면(버려짐) 지운다', () => {
    expect(reconcileLocal({ a: e }, [{ id: 'a' }], new Set())).toEqual({});
  });
  it('대기 중이면 유지', () => {
    expect(reconcileLocal({ a: e }, [{ id: 'a' }], new Set(['a']))).toEqual({ a: e });
  });
  it('서버 목록을 못 받았으면 그대로', () => {
    expect(reconcileLocal({ a: e }, null, new Set())).toEqual({ a: e });
  });
});
