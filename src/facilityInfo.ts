// 구조물 정보(교량) — 「구조물 정보」 시트의 입력값 ↔ 서버 facilityInfo(2026-11-03). 순수 모듈(vitest: server/test/facilityInfo.test.ts).
// 값 목록은 서버 server/src/requiredShots.ts(DECK_TYPES·GIRDER_TYPES·PUBLIC_USE)와 같아야 한다.
// 서버는 이 값으로 필수 사진을 경간·교대·교각·신축이음마다 펴고, 바닥판·거더 형식·하천 여부로 칸을 거른다.

export type DeckType = 'concrete' | 'steel' | 'none';
export type GirderType = 'RC' | 'PSC' | 'steel' | 'none';
export type PublicUse = '추락방지시설' | '도로포장' | '도로부신축이음부' | '환기구덮개';

export interface FacilityInfo {
  spans?: number;
  abutments?: number;
  piers?: number;
  joints?: number;
  deck?: DeckType;
  girder?: GirderType;
  box?: boolean;
  trussOrArch?: boolean;
  cable?: boolean;
  river?: boolean;
  facilityClass?: 1 | 2 | 3;
  publicUse?: PublicUse[];
  length?: number;
  maxSpan?: number;
}

export const DECK_OPTIONS: readonly (readonly [DeckType, string])[] = [
  ['concrete', '콘크리트'],
  ['steel', '강바닥판'],
  ['none', '없음'],
];
export const GIRDER_OPTIONS: readonly (readonly [GirderType, string])[] = [
  ['RC', 'RC'],
  ['PSC', 'PSC'],
  ['steel', '강거더'],
  ['none', '없음(슬래브)'],
];
export const CLASS_OPTIONS: readonly (readonly ['1' | '2' | '3', string])[] = [
  ['1', '1종'],
  ['2', '2종'],
  ['3', '3종'],
];
export const PUBLIC_USE_OPTIONS: readonly (readonly [PublicUse, string])[] = [
  ['추락방지시설', '추락방지시설(보도 난간)'],
  ['도로포장', '도로포장'],
  ['도로부신축이음부', '도로부 신축이음부'],
  ['환기구덮개', '환기구·점검구 덮개'],
];
export const FLAG_OPTIONS: readonly (readonly ['box' | 'trussOrArch' | 'cable' | 'river', string])[] = [
  ['box', '박스거더'],
  ['trussOrArch', '트러스·아치'],
  ['cable', '케이블(현수·사장)'],
  ['river', '하천·해상'],
];

/** 시트의 입력 상태 — 숫자 칸은 글자 그대로 둔다(지우는 중인 빈칸을 0으로 바꾸지 않게) */
export interface InfoForm {
  spans: string;
  abutments: string;
  piers: string;
  joints: string;
  length: string;
  maxSpan: string;
  deck: DeckType;
  girder: GirderType;
  facilityClass: '1' | '2' | '3';
  box: boolean;
  trussOrArch: boolean;
  cable: boolean;
  river: boolean;
  publicUse: PublicUse[];
}

export const COUNT_FIELDS = [
  ['spans', '경간 수'],
  ['abutments', '교대 수'],
  ['piers', '교각 수'],
  ['joints', '신축이음 수'],
] as const;
export const METER_FIELDS = [
  ['length', '연장(m)'],
  ['maxSpan', '최대 경간장(m)'],
] as const;

/** 저장된 값(없으면 흔한 기본값: 교대 2, 신축이음 2, 콘크리트 바닥판·PSC 거더·2종)으로 시트를 연다 */
export function formFromInfo(info: FacilityInfo | null | undefined): InfoForm {
  const i = info ?? {};
  const str = (n: number | undefined) => (n === undefined ? '' : String(n));
  return {
    spans: str(i.spans),
    abutments: info ? str(i.abutments) : '2',
    piers: str(i.piers),
    joints: info ? str(i.joints) : '2',
    length: str(i.length),
    maxSpan: str(i.maxSpan),
    deck: i.deck ?? 'concrete',
    girder: i.girder ?? 'PSC',
    facilityClass: i.facilityClass ? (String(i.facilityClass) as '1' | '2' | '3') : '2',
    box: i.box ?? false,
    trussOrArch: i.trussOrArch ?? false,
    cable: i.cable ?? false,
    river: i.river ?? false,
    publicUse: i.publicUse ?? [],
  };
}

/** 정수 칸: 빈칸은 undefined, 숫자가 아니면 NaN */
function parseCount(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

function parseMeter(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

/** 시트 입력 → 서버로 보낼 facilityInfo. 틀린 칸이 있으면 { error } */
export function infoFromForm(form: InfoForm): { info: FacilityInfo } | { error: string } {
  const info: FacilityInfo = {};
  for (const [key, label] of COUNT_FIELDS) {
    const n = parseCount(form[key]);
    if (Number.isNaN(n)) return { error: `${label}는 0 이상 정수로 적어 주세요.` };
    if (n !== undefined) info[key] = n;
  }
  for (const [key, label] of METER_FIELDS) {
    const n = parseMeter(form[key]);
    if (Number.isNaN(n)) return { error: `${label}은 0보다 큰 숫자로 적어 주세요.` };
    if (n !== undefined) info[key] = n;
  }
  if (info.spans === undefined) return { error: '경간 수를 적어 주세요. 경간마다 사진 칸이 생겨요.' };
  info.deck = form.deck;
  info.girder = form.girder;
  info.facilityClass = Number(form.facilityClass) as 1 | 2 | 3;
  for (const [key] of FLAG_OPTIONS) info[key] = form[key];
  info.publicUse = [...form.publicUse];
  return { info };
}

/** 구조물 화면 알약에 보이는 짧은 요약. 없으면 null */
export function infoSummary(info: FacilityInfo | null | undefined): string | null {
  if (!info) return null;
  const parts: string[] = [];
  if (info.spans !== undefined) parts.push(`${info.spans}경간`);
  if (info.piers !== undefined) parts.push(`교각 ${info.piers}`);
  const girder = GIRDER_OPTIONS.find(([k]) => k === info.girder)?.[1];
  if (girder && info.girder !== 'none') parts.push(girder);
  if (info.river) parts.push('하천');
  return parts.length > 0 ? parts.join(' · ') : '입력됨';
}
