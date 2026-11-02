import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expandRequired,
  FacilityInfoError,
  parseFacilityTemplate,
  parseInfoField,
  parseTemplateItem,
  pickInfo,
  positionsOf,
  templateNeedsInfo,
  validateFacilityInfo,
  type InfoField,
  type RequiredTemplateItem,
} from '../src/requiredShots.js';
import { loadRequiredTemplate } from '../src/shotsStore.js';

const T: RequiredTemplateItem[] = [
  { member: '전경', label: '측면 전경' },
  { member: '바닥판', label: '하면', repeat: 'perSpan', when: { deck: 'concrete' } },
  { member: '거더', label: 'PSC 정착부', repeat: 'perSpan', when: { girder: 'PSC' } },
  { member: '가로보', label: '가로보', repeat: 'perSpan', levels: ['정기안전점검', '정밀안전진단'], levelWhen: { 정기안전점검: { facilityClass: '3' } } },
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
    expect(out[1]).toEqual({ member: '바닥판(S1)', label: '하면' });
  });

  it('점검 종류로 거른다: 정밀점검은 가로보 없음, 정기는 3종만 가로보·장비 없음. 옛 숫자 종별(3)도 맞는다', () => {
    const info = { spans: 1, abutments: 2, piers: 0, girder: 'PSC', facilityClass: '2' };
    expect(names(expandRequired(T, { inspectionType: '정밀안전점검', info }))).not.toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info }))).not.toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info: { ...info, facilityClass: '3' } }))).toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info: { ...info, facilityClass: 3 } }))).toContain('가로보(S1)');
    expect(names(expandRequired(T, { inspectionType: '정기안전점검', info }))).not.toContain('장비');
    expect(names(expandRequired(T, { inspectionType: '정밀안전점검', info }))).toContain('거더(S1)');
  });

  it('배열 조건(multi)은 포함 여부, 조건 값이 배열이면 그중 하나', () => {
    expect(names(expandRequired(T, { info: { publicUse: ['추락방지시설'] } }))).toContain('추락방지시설');
    expect(names(expandRequired(T, { info: { publicUse: [] } }))).not.toContain('추락방지시설');
    const any: RequiredTemplateItem[] = [{ member: '라이닝', label: '줄눈', when: { lining: ['masonry', 'tbm'] } }];
    expect(expandRequired(any, { info: { lining: ['tbm'] } })).toHaveLength(1);
    expect(expandRequired(any, { info: { lining: ['natmRC'] } })).toHaveLength(0);
  });

  it('일반 반복 {count, prefix}: 수를 모르면 1장, 0이면 없음', () => {
    const t: RequiredTemplateItem[] = [{ member: '지', label: '내부', repeat: { count: 'basins', prefix: '' } }, { member: '라이닝', label: '천장부', repeat: { count: 'zones', prefix: '구간' } }];
    expect(names(expandRequired(t, { info: { basins: 2, zones: 3 } }))).toEqual(['지(1)', '지(2)', '라이닝(구간1)', '라이닝(구간2)', '라이닝(구간3)']);
    expect(names(expandRequired(t, { info: { basins: 0 } }))).toEqual(['라이닝']);
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

const FIELDS: InfoField[] = [
  { key: 'spans', label: '경간 수', type: 'count', required: true, max: 300 },
  { key: 'length', label: '연장(m)', type: 'meter', max: 20000 },
  { key: 'girder', label: '거더', type: 'choice', options: [['RC', 'RC'], ['PSC', 'PSC']] },
  { key: 'facilityClass', label: '종별', type: 'choice', options: [['1', '1종'], ['2', '2종'], ['3', '3종']] },
  { key: 'river', label: '하천', type: 'bool' },
  { key: 'publicUse', label: '공중이용', type: 'multi', options: [['도로포장', '도로포장'], ['추락방지시설', '추락방지시설']] },
];

describe('validateFacilityInfo (시설물별 항목)', () => {
  it('맞는 값은 그대로, null은 버린다, multi 중복 제거, 옛 숫자 종별은 글자로', () => {
    expect(validateFacilityInfo({ spans: 5, length: 150.5, girder: 'PSC', facilityClass: 2, river: true, publicUse: ['도로포장', '도로포장'], cable: undefined }, FIELDS)).toEqual({
      spans: 5, length: 150.5, girder: 'PSC', facilityClass: '2', river: true, publicUse: ['도로포장'],
    });
  });

  it.each([
    [{ spans: -1 }],
    [{ spans: 1.5 }],
    [{ spans: 301 }],
    [{ spans: 1, girder: '목재' }],
    [{ spans: 1, river: 'yes' }],
    [{ spans: 1, publicUse: ['엘리베이터'] }],
    [{ spans: 1, length: -2 }],
    [{ spans: 1, spanz: 3 }],
    [{ length: 10 }], // 필수(경간 수) 빠짐
    [[1, 2]],
    ['교량'],
  ])('틀린 값은 거부 %j', (value) => {
    expect(() => validateFacilityInfo(value, FIELDS)).toThrow(FacilityInfoError);
  });

  it('pickInfo: 이 시설물 항목에 없는 옛 키는 뺀다', () => {
    expect(pickInfo({ spans: 3, lining: ['tbm'] }, FIELDS)).toEqual({ spans: 3 });
    expect(pickInfo(undefined, FIELDS)).toBeUndefined();
  });
});

describe('설정 읽기', () => {
  it('항목: 옛 형식도 읽고, 모르는 repeat은 버린다, 근거 같은 기록용 키는 무시', () => {
    expect(parseTemplateItem({ member: '전경', label: '상류측' })).toEqual({ member: '전경', label: '상류측' });
    expect(parseTemplateItem({ member: '교각', label: '두부', repeat: 'perFloor', 근거: 'x' })).toEqual({ member: '교각', label: '두부' });
    expect(parseTemplateItem({ member: '지', label: 'a', repeat: { count: 'basins' } })).toEqual({ member: '지', label: 'a', repeat: { count: 'basins', prefix: '' } });
    expect(parseTemplateItem({ label: 'x' })).toBeNull();
  });

  it('입력 항목: 틀린 정의는 버린다', () => {
    expect(parseInfoField({ key: 'piers', label: '교각 수', type: 'count', default: null })).toEqual({ key: 'piers', label: '교각 수', type: 'count' });
    expect(parseInfoField({ key: 'x', label: 'x', type: 'choice' })).toBeNull(); // options 없음
    expect(parseInfoField({ key: '교각', label: 'x', type: 'count' })).toBeNull(); // key는 영문
    expect(parseInfoField({ key: 'x', label: 'x', type: 'date' })).toBeNull();
  });

  it('시설물: 옛 형식(배열)은 info 없이', () => {
    expect(parseFacilityTemplate([{ member: '전경', label: 'a' }])).toEqual({ info: [], shots: [{ member: '전경', label: 'a' }] });
  });

  it('구조물 정보가 필요한지', () => {
    const info: InfoField[] = [{ key: 'piers', label: '교각 수', type: 'count' }];
    expect(templateNeedsInfo({ info, shots: [{ member: '전경', label: 'a' }, { member: '난간', label: 'b', repeat: 'perSide' }] })).toBe(false);
    expect(templateNeedsInfo({ info, shots: [{ member: '교각', label: 'b', repeat: 'perPier' }] })).toBe(true);
    expect(templateNeedsInfo({ info: [], shots: [{ member: '교각', label: 'b', repeat: 'perPier' }] })).toBe(false);
  });
});

describe('config/requiredShots.json (세부지침 2026.2 — 교량·터널·옹벽·상수도·하수처리장)', () => {
  const configPath = join(fileURLToPath(new URL('..', import.meta.url)), 'config', 'requiredShots.json');

  it('다섯 시설물이 버려지는 항목 없이 읽히고, 조건·반복이 쓰는 키가 모두 입력 항목에 있다', async () => {
    const tpl = await loadRequiredTemplate(configPath);
    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, { info: unknown[]; shots: unknown[] }>;
    expect(tpl['_설명']).toBeUndefined();
    for (const type of ['교량', '터널', '옹벽', '상수도', '하수처리장']) {
      const t = tpl[type];
      expect(t.shots.length, type).toBe(raw[type].shots.length);
      expect(t.info.length, type).toBe(raw[type].info.length);
      const fields = new Map(t.info.map((f) => [f.key, f]));
      for (const s of t.shots) {
        expect(s.member.length, `${type} ${s.member}`).toBeLessThanOrEqual(30);
        for (const cond of [s.when ?? {}, ...Object.values(s.levelWhen ?? {})]) {
          for (const [key, want] of Object.entries(cond)) {
            const f = fields.get(key);
            expect(f, `${type} ${s.member} when.${key}`).toBeDefined();
            if (f?.type === 'choice' || f?.type === 'multi') {
              for (const w of Array.isArray(want) ? want : [want]) expect(f.options?.map(([v]) => v), `${type} ${s.member} ${key}=${String(w)}`).toContain(String(w));
            }
          }
        }
        if (typeof s.repeat === 'object') expect(fields.get(s.repeat.count)?.type, `${type} ${s.member} repeat`).toBe('count');
      }
      // 기본값으로 만든 정보는 서버 검사를 통과한다(필수 count는 1로)
      const sample = Object.fromEntries(t.info.map((f) => [f.key, f.default ?? (f.type === 'count' ? 1 : f.type === 'meter' ? 100 : f.type === 'bool' ? false : f.type === 'multi' ? [f.options![0][0]] : f.options![0][0])]));
      expect(() => validateFacilityInfo(sample, t.info), type).not.toThrow();
    }
  });

  it('교량 RC 정밀진단 예시가 기대한 칸으로 펴진다', async () => {
    const bridge = (await loadRequiredTemplate(configPath))['교량'];
    const info = { spans: 3, abutments: 2, piers: 2, joints: 2, deck: 'concrete', girder: 'RC', river: false, facilityClass: '2', publicUse: [] };
    const jindan = expandRequired(bridge.shots, { inspectionType: '정밀안전진단', info });
    const jeonggi = expandRequired(bridge.shots, { inspectionType: '정기안전점검', info });
    expect(names(jindan)).toContain('교각(P2)');
    expect(names(jindan)).toContain('가로보(S3)');
    expect(names(jeonggi)).not.toContain('가로보(S1)'); // 2종 → 정기에는 2차부재 없음
    expect(names(jeonggi)).not.toContain('장비');
    expect(names(jindan).some((m) => m.startsWith('케이블'))).toBe(false);
  });
});
