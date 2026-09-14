// 손상 유형 정의. 뷰어와 서버가 함께 읽는다. 유형·해치·색을 바꾸려면 이 파일만 고치면 된다.
// 값의 근거: docs/superpowers/specs/2026-09-12-damage-types-design.md

const LAYER = '신규손상';
const COLOR_INDEX = 1; // 캐드 색 번호 1 = 빨강

// 표준 패턴의 기준 간격(mm). 캐드 표준 패턴 정의값이다.
const PATTERN_BASE_SPACING = {
  ANSI31: 3.175,
  ANSI33: 6.35,
  ANSI37: 3.175,
  CORK: 3.175,
  TRIANG: 9.525,
  NET: 3.175,
};

function hatch(pattern, scale) {
  const baseSpacing = PATTERN_BASE_SPACING[pattern] ?? 3.175;
  return { kind: 'hatch', pattern, scale, angle: 0, spacingMm: baseSpacing * scale };
}

// 모양(선·원)이 아직 정해지지 않은 유형. 숫자는 도면 좌표 기준 mm로 나중에 채운다.
function circles() {
  return { kind: 'circles', diameterMm: null, spacingMm: null };
}

export const DAMAGE_TYPES = [
  { id: 'crack', label: '균열', kind: 'line', fill: null, decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm' },
  { id: 'map_crack', label: '망상균열', kind: 'area', fill: hatch('NET', 50), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'breakage', label: '파손', kind: 'area', fill: null, decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'segregation', label: '재료분리', kind: 'area', fill: hatch('CORK', 35), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'delamination', label: '박리', kind: 'area', fill: hatch('ANSI31', 50), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'spalling', label: '박락', kind: 'area', fill: hatch('ANSI37', 60), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'efflorescence', label: '백태·열화', kind: 'area', fill: hatch('TRIANG', 25), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'etc', label: '기타', kind: 'area', fill: hatch('ANSI33', 50), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  // 모양을 받기 전까지: 사각형 테두리만 그린다
  { id: 'rebar_exposure', label: '철근노출', kind: 'area', fill: null, decoration: circles(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  // 모양을 받기 전까지: 선만 긋는다
  { id: 'crack_efflorescence', label: '균열/백태', kind: 'line', fill: null, decoration: circles(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm' },
];

export const DEFAULT_DAMAGE_TYPE_ID = 'crack';

export function getDamageType(id) {
  return DAMAGE_TYPES.find((type) => type.id === id) ?? null;
}

export function isDamageTypeId(value) {
  return typeof value === 'string' && DAMAGE_TYPES.some((type) => type.id === value);
}
