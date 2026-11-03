import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { formFromInfo, infoFromForm, infoSummary, type InfoField } from '../../src/facilityInfo.js';
import { parseFacilityTemplate, validateFacilityInfo } from '../src/requiredShots.js';

const configPath = join(fileURLToPath(new URL('..', import.meta.url)), 'config', 'requiredShots.json');
async function fieldsOf(type: string): Promise<InfoField[]> {
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  return parseFacilityTemplate(raw[type]).info as InfoField[];
}

describe('앱 구조물 정보 시트 (src/facilityInfo.ts)', () => {
  it('처음 열면 항목 기본값, 저장값이 있으면 그 값', async () => {
    const f = await fieldsOf('교량');
    expect(formFromInfo(f, null)).toMatchObject({ spans: '', abutments: '2', joints: '2', deck: 'concrete', girder: 'PSC', facilityClass: '2', river: false, publicUse: [] });
    // 어제 저장된 옛 값(종별 숫자)도 시트에 맞게
    expect(formFromInfo(f, { spans: 3, piers: 2, girder: 'RC', river: true, facilityClass: 2 })).toMatchObject({ spans: '3', abutments: '', piers: '2', girder: 'RC', river: true, facilityClass: '2' });
  });

  it.each(['교량', '터널', '옹벽', '상수도', '하수처리장', '항만외곽시설'])('%s: 기본값 + 필수 칸만 채운 입력이 서버 검사를 통과한다', async (type) => {
    const f = await fieldsOf(type);
    const form = formFromInfo(f, null);
    for (const field of f) {
      if (!field.required) continue;
      if (field.type === 'count') form[field.key] = '3';
      if (field.type === 'meter') form[field.key] = '120,5';
      if (field.type === 'multi' && (form[field.key] as string[]).length === 0) form[field.key] = [field.options![0][0]];
      if (field.type === 'choice' && form[field.key] === '') form[field.key] = field.options![0][0];
    }
    const r = infoFromForm(f, form);
    if (!('info' in r)) throw new Error(r.error);
    expect(validateFacilityInfo(r.info, f as never)).toEqual(r.info);
  });

  it('틀리거나 빠진 칸은 문구로 알려 준다', async () => {
    const f = await fieldsOf('교량');
    expect(infoFromForm(f, { ...formFromInfo(f, null), spans: '' })).toEqual({ error: '경간 수을(를) 적어 주세요.' });
    expect(infoFromForm(f, { ...formFromInfo(f, null), spans: '3', piers: '2.5' })).toEqual({ error: '교각 수은(는) 0 이상 정수로 적어 주세요.' });
    expect(infoFromForm(f, { ...formFromInfo(f, null), spans: '3', piers: '999' })).toHaveProperty('error');
  });

  it('요약: summary 항목만, 없으면 앞 항목', async () => {
    const f = await fieldsOf('교량');
    expect(infoSummary(f, null)).toBeNull();
    expect(infoSummary(f, { spans: 5, piers: 4, girder: 'RC' })).toBe('5경간 · 교각 4 · RC');
    const plain: InfoField[] = [{ key: 'length', label: '총연장(m)', type: 'meter' }, { key: 'zones', label: '구간 수', type: 'count' }];
    expect(infoSummary(plain, { length: 1860, zones: 3 })).toBe('1860m · 구간 3');
  });
});
