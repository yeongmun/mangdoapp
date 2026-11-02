import { describe, expect, it } from 'vitest';
import { formFromInfo, infoFromForm, infoSummary } from '../../src/facilityInfo.js';
import { validateFacilityInfo } from '../src/requiredShots.js';

describe('앱 구조물 정보 시트 (src/facilityInfo.ts)', () => {
  it('처음 열면 흔한 기본값, 저장값이 있으면 그 값', () => {
    expect(formFromInfo(null)).toMatchObject({ spans: '', abutments: '2', joints: '2', deck: 'concrete', girder: 'PSC', facilityClass: '2', publicUse: [] });
    expect(formFromInfo({ spans: 3, piers: 2, girder: 'RC', river: true })).toMatchObject({ spans: '3', abutments: '', piers: '2', girder: 'RC', river: true });
  });

  it('입력 → 서버 값. 서버 검사를 그대로 통과한다', () => {
    const form = { ...formFromInfo(null), spans: '5', piers: '4', length: '152,5', publicUse: ['도로포장' as const] };
    const r = infoFromForm(form);
    if (!('info' in r)) throw new Error(r.error);
    expect(r.info).toEqual({
      spans: 5, abutments: 2, piers: 4, joints: 2, length: 152.5,
      deck: 'concrete', girder: 'PSC', facilityClass: 2, box: false, trussOrArch: false, cable: false, river: false, publicUse: ['도로포장'],
    });
    expect(validateFacilityInfo(r.info)).toEqual(r.info);
  });

  it('틀린 칸은 문구로 알려 준다', () => {
    expect(infoFromForm({ ...formFromInfo(null), spans: '' })).toHaveProperty('error');
    expect(infoFromForm({ ...formFromInfo(null), spans: '3', piers: '2.5' })).toEqual({ error: '교각 수는 0 이상 정수로 적어 주세요.' });
    expect(infoFromForm({ ...formFromInfo(null), spans: '3', length: '-1' })).toHaveProperty('error');
  });

  it('요약', () => {
    expect(infoSummary(null)).toBeNull();
    expect(infoSummary({ spans: 3, piers: 2, girder: 'PSC', river: true })).toBe('3경간 · 교각 2 · PSC · 하천');
    expect(infoSummary({})).toBe('입력됨');
  });
});
