import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expandRequired,
  FacilityInfoError,
  parseTemplateItem,
  positionsOf,
  templateNeedsInfo,
  validateFacilityInfo,
  type RequiredTemplateItem,
} from '../src/requiredShots.js';
import { loadRequiredTemplate } from '../src/shotsStore.js';

const T: RequiredTemplateItem[] = [
  { member: '전경', label: '측면 전경' },
  { member: '바닥판', label: '하면', repeat: 'perSpan', when: { deck: 'concrete' }, hint: '균열·백태' },
  { member: '거더', label: 'PSC 정착부', repeat: 'perSpan', when: { girder: 'PSC' } },
  { member: '가로보', label: '가로보', repeat: 'perSpan', levels: ['정기안전점검', '정밀안전진단'], levelWhen: { 정기안전점검: { facilityClass: 3 } } },
  { member: '교량받침', label: '받침', repeat: 'perSupport' },
  { member: '난간', label: '난간', repeat: 'perSide' },
  { member: '추락방지시설', label: '보도 난간', when: { publicUse: '추락방지시설' } },
  { member: '장비', label: '사용장비', levels: ['정밀안전점검', '정밀안전진단'] },
];

const names = (items: { member: string; label: string }[]) => items.map((i) => i.member);

describe('expandRequired', () => {
  it('구조물 정보가 없으면 조건 항목은 빼고 반복 항목은 1장(좌·우는 2장)', () => {
    expect(names(expandRequired(T, {}))).toEqual(['전경', '가로보', '교량받침', '난간(좌측)', '난간(우측)', '장비']);
  });

  it('경간·교대·교각 수에 맞춰 위치를 붙여 편다. 받침은 A1 → P… → A2 순', () => {
    const out = expandRequired(T, { inspectionType: '정밀안전진단', info: { spans: 3, abutments: 2, piers: 2, deck: 'concrete', girder: 'RC' } });
    expect(names(out)).toEqual([
      '전경',
      '바닥판(S1)', '바닥판(S2)', '바닥판(S3)',
      '가로보(S1)', '가로보(S2)', '가로보(S3)',
      '교량받침(A1)', '교량받침(P1)', '교량받침(P2)', '교량받침(A2)',
      '난간(좌측)', '난간(우측)',
      '장비',
    ]);
    expect(out[1]).toEqual({ member: '바닥판(S1)', label: '하면', hint: '균열·백태' });
  });

  it('점검 종류로 거른다: 정밀점검은 가로보 없음, 정기는 3종만 가로보·장비 없음', () => {
    const info = { spans: 1, abutments: 2, piers: 0, girder: 'PSC' as const, facilityClass: 2 as const };
    expect(names(expandRequired(T, { inspectionType: '정밀안전점검', info }))).not.toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info }))).not.toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info: { ...info, facilityClass: 3 } }))).toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info }))).not.toContain('장비');
    expect(names(expandRequired(T, { inspectionType: '정밀안전점검', info }))).toContain('거더(S1)');
  });

  it('배열 조건(publicUse)은 포함 여부로 본다', () => {
    expect(names(expandRequired(T, { info: { publicUse: ['추락방지시설'] } }))).toContain('추락방지시설');
    expect(names(expandRequired(T, { info: { publicUse: [] } }))).not.toContain('추락방지시설');
  });

  it('수가 0이면 그 칸은 없다, 같은 칸이 두 번 나오면 하나만', () => {
    expect(names(expandRequired([{ member: '교각', label: '두부', repeat: 'perPier' }], { info: { piers: 0 } }))).toEqual([]);
    expect(expandRequired([{ member: '전경', label: 'a' }, { member: '전경', label: 'a' }], {})).toHaveLength(1);
  });
});

describe('positionsOf', () => {
  it('교대 1개(한쪽만)·교대 없음(교각만)', () => {
    expect(positionsOf('perSupport', { abutments: 1, piers: 1 })).toEqual(['A1', 'P1']);
    expect(positionsOf('perSupport', { abutments: 0, piers: 2 })).toEqual(['P1', 'P2']);
    expect(positionsOf('perJoint', { joints: 2 })).toEqual(['J1', 'J2']);
    expect(positionsOf('perPier', {})).toBeNull();
  });
});

describe('validateFacilityInfo', () => {
  it('맞는 값은 그대로, null은 버린다, publicUse 중복 제거', () => {
    expect(
      validateFacilityInfo({ spans: 5, abutments: 2, piers: 4, joints: 2, deck: 'concrete', girder: 'PSC', box: false, river: true, facilityClass: 2, publicUse: ['도로포장', '도로포장'], length: 150.5, maxSpan: 30, cable: null }),
    ).toEqual({ spans: 5, abutments: 2, piers: 4, joints: 2, deck: 'concrete', girder: 'PSC', box: false, river: true, facilityClass: 2, publicUse: ['도로포장'], length: 150.5, maxSpan: 30 });
  });

  it.each([
    [{ spans: -1 }],
    [{ spans: 1.5 }],
    [{ piers: 301 }],
    [{ deck: '목재' }],
    [{ girder: 'rc' }],
    [{ box: 'yes' }],
    [{ facilityClass: 4 }],
    [{ publicUse: ['엘리베이터'] }],
    [{ length: 0 }],
    [{ spanz: 3 }],
    [[1, 2]],
    ['교량'],
  ])('틀린 값은 거부 %j', (value) => {
    expect(() => validateFacilityInfo(value)).toThrow(FacilityInfoError);
  });
});

describe('parseTemplateItem · templateNeedsInfo', () => {
  it('옛 형식(member·label만)도 읽고, 모르는 repeat은 버린다, 근거 같은 기록용 키는 무시', () => {
    expect(parseTemplateItem({ member: '전경', label: '상류측' })).toEqual({ member: '전경', label: '상류측' });
    expect(parseTemplateItem({ member: '교각', label: '두부', repeat: 'perFloor', 근거: 'x' })).toEqual({ member: '교각', label: '두부' });
    expect(parseTemplateItem({ label: 'x' })).toBeNull();
  });

  it('조건·위치 반복이 있으면 구조물 정보가 필요하다', () => {
    expect(templateNeedsInfo([{ member: '전경', label: 'a' }, { member: '난간', label: 'b', repeat: 'perSide' }])).toBe(false);
    expect(templateNeedsInfo([{ member: '교각', label: 'b', repeat: 'perPier' }])).toBe(true);
    expect(templateNeedsInfo([{ member: '기초', label: 'b', when: { river: true } }])).toBe(true);
  });
});

describe('config/requiredShots.json (교량 — 세부지침)', () => {
  const configPath = join(fileURLToPath(new URL('..', import.meta.url)), 'config', 'requiredShots.json');

  it('읽히고, 일반 RC 교량 정밀진단 예시가 기대한 칸 수로 펴진다', async () => {
    const tpl = await loadRequiredTemplate(configPath);
    expect(tpl['_설명']).toBeUndefined();
    const bridge = tpl['교량'];
    expect(bridge.length).toBeGreaterThan(30);
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown[]>;
    expect(bridge).toHaveLength(raw['교량'].length); // 버려진 항목 없음
    const info = { spans: 3, abutments: 2, piers: 2, joints: 2, deck: 'concrete' as const, girder: 'RC' as const, river: false, facilityClass: 2 as const, publicUse: [] };
    const jindan = expandRequired(bridge, { inspectionType: '정밀안전진단', info });
    const jeonggi = expandRequired(bridge, { inspectionType: '정기안전점검', info });
    expect(names(jindan)).toContain('교각(P2)');
    expect(names(jindan)).toContain('가로보(S3)');
    expect(names(jeonggi)).not.toContain('가로보(S1)'); // 2종 → 정기에는 2차부재 없음
    expect(names(jeonggi)).not.toContain('장비');
    expect(names(jindan).some((m) => m.startsWith('케이블'))).toBe(false);
    // 칸 이름이 서버 규칙(부재 40자) 안에 들어간다
    for (const s of jindan) expect(s.member.length).toBeLessThanOrEqual(40);
  });
});
