import { describe, expect, it } from 'vitest';
import {
  DAMAGE_TYPES,
  DEFAULT_DAMAGE_TYPE_ID,
  getDamageType,
  isDamageTypeId,
} from '../public/viewer/damageTypes.js';

describe('DAMAGE_TYPES', () => {
  it('스펙의 10종을 순서대로 담는다', () => {
    expect(DAMAGE_TYPES.map((t: { id: string }) => t.id)).toEqual([
      'crack',
      'map_crack',
      'breakage',
      'segregation',
      'delamination',
      'spalling',
      'efflorescence',
      'etc',
      'rebar_exposure',
      'crack_efflorescence',
    ]);
  });

  it('id가 중복되지 않는다', () => {
    const ids = DAMAGE_TYPES.map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 유형이 신규손상 레이어와 빨간색(1)을 쓴다', () => {
    for (const type of DAMAGE_TYPES) {
      expect(type.layer).toBe('신규손상');
      expect(type.colorIndex).toBe(1);
    }
  });

  it('선형은 m, 면형은 ㎡ 단위를 쓴다', () => {
    for (const type of DAMAGE_TYPES) {
      expect(['line', 'area']).toContain(type.kind);
      expect(type.quantityUnit).toBe(type.kind === 'line' ? 'm' : 'm2');
    }
  });

  it('각 유형의 이름과 채우기가 스펙과 같다', () => {
    const summary = DAMAGE_TYPES.map((t: { id: string; label: string; kind: string; fill: { pattern?: string } | null }) => [
      t.id,
      t.label,
      t.kind,
      t.fill ? t.fill.pattern : null,
    ]);
    expect(summary).toEqual([
      ['crack', '균열', 'line', null],
      ['map_crack', '망상균열', 'area', 'ANCHORLK'],
      ['breakage', '파손', 'area', 'ANSI33'],
      ['segregation', '재료분리', 'area', 'CORK'],
      ['delamination', '박리', 'area', 'ANSI31'],
      ['spalling', '박락', 'area', 'ANSI37'],
      ['efflorescence', '백태·열화', 'area', 'TRIANG'],
      ['etc', '기타', 'area', 'ANSI33'],
      ['rebar_exposure', '철근노출', 'area', null],
      ['crack_efflorescence', '균열/백태', 'line', null],
    ]);
  });

  it('해치는 패턴 이름·축척·각도·도면상 무늬 간격을 모두 갖는다', () => {
    for (const type of DAMAGE_TYPES) {
      if (!type.fill) continue;
      expect(type.fill.kind).toBe('hatch');
      expect(type.fill.pattern).toMatch(/^[A-Z0-9_-]+$/);
      expect(typeof type.fill.scale).toBe('number');
      expect(type.fill.scale).toBeGreaterThan(0);
      expect(typeof type.fill.angle).toBe('number');
      expect(typeof type.fill.spacingMm).toBe('number');
      expect(type.fill.spacingMm).toBeGreaterThan(0);
    }
  });

  it('해치 축척과 무늬 간격은 스펙과 같다', () => {
    const hatchSpec = [
      ['map_crack', 'ANCHORLK', 50, 3.952854 * 50],
      ['breakage', 'ANSI33', 50, 6.35 * 50],
      ['segregation', 'CORK', 35, 3.175 * 35],
      ['delamination', 'ANSI31', 50, 3.175 * 50],
      ['spalling', 'ANSI37', 60, 3.175 * 60],
      ['efflorescence', 'TRIANG', 25, 9.525 * 25],
      ['etc', 'ANSI33', 50, 6.35 * 50],
    ] as const;
    for (const [typeId, pattern, scale, spacingMm] of hatchSpec) {
      const type = getDamageType(typeId);
      expect(type?.fill?.pattern).toBe(pattern);
      expect(type?.fill?.scale).toBe(scale);
      expect(type?.fill?.spacingMm).toBeCloseTo(spacingMm, 5);
    }
  });

  it('기호 유형의 decoration은 사내 망도 실측 치수를 담는다', () => {
    const withDecoration = DAMAGE_TYPES.filter((t: { decoration: unknown }) => t.decoration !== null);
    expect(withDecoration.map((t: { id: string }) => t.id)).toEqual(['rebar_exposure', 'crack_efflorescence']);
    expect(getDamageType('rebar_exposure')?.decoration).toEqual({
      kind: 'rebar',
      lineGapMm: 57.4,
      crossSizeMm: 212,
      crossGapMm: 1009,
      boxMarginMm: 60,
    });
    expect(getDamageType('crack_efflorescence')?.decoration).toEqual({
      kind: 'circles',
      diameterMm: 54.4,
      spacingMm: 158,
      offsetMm: 77,
    });
  });
});

describe('getDamageType / isDamageTypeId', () => {
  it('id로 유형을 찾고, 없으면 null', () => {
    expect(getDamageType('spalling')?.label).toBe('박락');
    expect(getDamageType('nope')).toBeNull();
  });

  it('유형 id 여부를 판정한다', () => {
    expect(isDamageTypeId('crack')).toBe(true);
    expect(isDamageTypeId('nope')).toBe(false);
    expect(isDamageTypeId(null)).toBe(false);
  });

  it('기본 유형은 균열', () => {
    expect(DEFAULT_DAMAGE_TYPE_ID).toBe('crack');
    expect(isDamageTypeId(DEFAULT_DAMAGE_TYPE_ID)).toBe(true);
  });
});
