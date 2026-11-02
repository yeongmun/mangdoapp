// 필수 사진 목록 펼치기(2026-11-03) — config/requiredShots.json의 시설물별 템플릿을 점검 종류와 구조물 정보(경간·교각 수,
// 형식 등)에 맞춰 실제 촬영 칸으로 편다. 순수 함수만. 저장·라우트는 shotsStore.ts·app.ts.
// 근거: 세부지침 해설서 2026.2(교량·터널·옹벽·상수도·하수처리장 편) — 대상 부재 표, 부재별 점검부위, 부록 A 보고서 서두·부록.
//
// 시설물 하나 = { "info": [입력 항목…], "shots": [항목…] } (옛 형식 — 항목 배열만 — 도 읽는다: info 없음).
// info 항목: { key, label, type: count|meter|bool|choice|multi, options?: [[값, 표시]], default?, required?, max?, summary? }
//   → 앱 「구조물 정보」 시트가 이 목록대로 입력칸을 그린다(시설물마다 다름). 서버는 이것으로 값을 검사한다.
// shots 항목(선택 필드는 없으면 옛 형식과 같다 — 늘 1장):
//   levels    이 점검 종류에서만 (예: ["정밀안전점검","정밀안전진단"])
//   levelWhen 점검 종류별 추가 조건 (예: 정기안전점검은 제3종만 → { "정기안전점검": { "facilityClass": "3" } })
//   when      구조물 정보 조건 (예: { "girder": "PSC" }, { "river": true }, multi 항목은 포함 여부 { "publicUse": "도로포장" })
//   repeat    once | perSide | { "count": "<count 항목 key>", "prefix": "P" } | 교량용 이름(perSpan·perAbutment·perPier·perSupport·perJoint)

import type { ShotTemplateItem } from './shotsStore.js';

// ── 입력 항목 ────────────────────────────────────────────────────────────────────
export const INFO_TYPES = ['count', 'meter', 'bool', 'choice', 'multi'] as const;
export type InfoType = (typeof INFO_TYPES)[number];

export interface InfoField {
  key: string;
  label: string;
  type: InfoType;
  /** choice·multi만: [값, 표시] */
  options?: [string, string][];
  default?: unknown;
  required?: boolean;
  /** count·meter 최댓값 */
  max?: number;
  /** 구조물 화면 알약 요약에 넣을지 */
  summary?: boolean;
}

export type FacilityInfo = Record<string, number | boolean | string | string[]>;

// ── 템플릿 ──────────────────────────────────────────────────────────────────────
export const NAMED_REPEATS = ['once', 'perSpan', 'perAbutment', 'perPier', 'perSupport', 'perJoint', 'perSide'] as const;
export type NamedRepeat = (typeof NAMED_REPEATS)[number];
export type Repeat = NamedRepeat | { count: string; prefix: string };

export interface RequiredTemplateItem {
  member: string;
  label: string;
  levels?: string[];
  levelWhen?: Record<string, Record<string, unknown>>;
  when?: Record<string, unknown>;
  repeat?: Repeat;
  /** 예전 설명들 — 바꾸기 전에 만든 칸을 이 항목으로 옮긴다 */
  aliases?: string[];
}

export interface FacilityTemplate {
  info: InfoField[];
  shots: RequiredTemplateItem[];
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 설정 파일 한 항목을 읽는다. member·label이 없으면 버린다(null). 모르는 repeat은 once로. 근거 같은 기록용 키는 무시 */
export function parseTemplateItem(raw: unknown): RequiredTemplateItem | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.member !== 'string' || typeof raw.label !== 'string') return null;
  const item: RequiredTemplateItem = { member: raw.member, label: raw.label };
  if (Array.isArray(raw.aliases)) {
    const aliases = raw.aliases.filter((x): x is string => typeof x === 'string' && x !== raw.label);
    if (aliases.length > 0) item.aliases = aliases;
  }
  if (Array.isArray(raw.levels)) item.levels = raw.levels.filter((x): x is string => typeof x === 'string');
  if (isPlainObject(raw.when)) item.when = raw.when;
  if (isPlainObject(raw.levelWhen)) item.levelWhen = raw.levelWhen as RequiredTemplateItem['levelWhen'];
  const rep = raw.repeat;
  if ((NAMED_REPEATS as readonly unknown[]).includes(rep)) item.repeat = rep as NamedRepeat;
  else if (isPlainObject(rep) && typeof rep.count === 'string') item.repeat = { count: rep.count, prefix: typeof rep.prefix === 'string' ? rep.prefix : '' };
  return item;
}

/** 입력 항목 정의 하나. 틀리면 버린다(null) — 설정 오타로 서버가 죽지 않게 */
export function parseInfoField(raw: unknown): InfoField | null {
  if (!isPlainObject(raw)) return null;
  const { key, label, type } = raw;
  if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || typeof label !== 'string') return null;
  if (!(INFO_TYPES as readonly unknown[]).includes(type)) return null;
  const field: InfoField = { key, label, type: type as InfoType };
  if (type === 'choice' || type === 'multi') {
    if (!Array.isArray(raw.options)) return null;
    field.options = raw.options
      .filter((o): o is [unknown, unknown] => Array.isArray(o) && o.length >= 2)
      .map(([v, l]) => [String(v), String(l)] as [string, string]);
    if (field.options.length === 0) return null;
  }
  if (raw.default !== undefined && raw.default !== null) field.default = raw.default;
  if (raw.required === true) field.required = true;
  if (typeof raw.max === 'number' && raw.max > 0) field.max = raw.max;
  if (raw.summary === true) field.summary = true;
  return field;
}

/** 시설물 하나의 설정 — 옛 형식(항목 배열)이면 info 없이 */
export function parseFacilityTemplate(raw: unknown): FacilityTemplate {
  const shotsRaw = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.shots) ? raw.shots : [];
  const infoRaw = isPlainObject(raw) && Array.isArray(raw.info) ? raw.info : [];
  return {
    info: infoRaw.map(parseInfoField).filter((f): f is InfoField => f !== null),
    shots: shotsRaw.map(parseTemplateItem).filter((i): i is RequiredTemplateItem => i !== null),
  };
}

// ── 구조물 정보 검사 ────────────────────────────────────────────────────────────
export class FacilityInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacilityInfoError';
  }
}

/** 앱이 보낸 구조물 정보를 그 시설물의 입력 항목으로 검사해 깨끗한 값만 돌려준다. 모르는 키는 거부, null은 버린다 */
export function validateFacilityInfo(value: unknown, fields: InfoField[]): FacilityInfo {
  if (!isPlainObject(value)) throw new FacilityInfoError('구조물 정보 값이 올바르지 않습니다.');
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: FacilityInfo = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) continue;
    const f = byKey.get(key);
    if (!f) throw new FacilityInfoError(`모르는 구조물 정보 항목입니다: ${key}`);
    switch (f.type) {
      case 'count': {
        const max = f.max ?? 1000;
        if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > max) throw new FacilityInfoError(`${f.label}은(는) 0~${max} 사이 정수로 적어 주세요.`);
        out[key] = raw as number;
        break;
      }
      case 'meter': {
        const max = f.max ?? 100000;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > max) throw new FacilityInfoError(`${f.label}은(는) 0~${max} 사이 숫자로 적어 주세요.`);
        out[key] = raw;
        break;
      }
      case 'bool':
        if (typeof raw !== 'boolean') throw new FacilityInfoError(`${f.label} 값이 올바르지 않습니다.`);
        out[key] = raw;
        break;
      case 'choice': {
        // 옛 값(숫자 2 등)도 같은 글자면 받는다
        const opt = f.options?.find(([v]) => v === String(raw));
        if (!opt || typeof raw === 'object') throw new FacilityInfoError(`${f.label} 값이 올바르지 않습니다.`);
        out[key] = opt[0];
        break;
      }
      case 'multi': {
        const allowed = new Set(f.options?.map(([v]) => v));
        if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !allowed.has(x))) throw new FacilityInfoError(`${f.label} 값이 올바르지 않습니다.`);
        out[key] = [...new Set(raw as string[])];
        break;
      }
    }
  }
  for (const f of fields) {
    if (f.required && out[f.key] === undefined) throw new FacilityInfoError(`${f.label}을(를) 적어 주세요.`);
  }
  return out;
}

/** 저장된 정보 중 이 시설물 항목에 있는 키만 — 시설물 종류를 바꾼 뒤 옛 키가 조건에 끼지 않게 */
export function pickInfo(info: FacilityInfo | undefined, fields: InfoField[]): FacilityInfo | undefined {
  if (!info) return undefined;
  const keys = new Set(fields.map((f) => f.key));
  return Object.fromEntries(Object.entries(info).filter(([k]) => keys.has(k)));
}

// ── 펼치기 ───────────────────────────────────────────────────────────────────────
export interface ExpandContext {
  /** 상위(과업)의 점검 종류. 없으면 점검 종류로 거르지 않는다 */
  inspectionType?: string;
  /** 구조물 정보. 없으면 조건(when) 항목은 빼고, 반복 항목은 1장으로 */
  info?: FacilityInfo;
}

/** 조건이 다 맞는지. info가 없으면 맞지 않는 것으로 본다. 배열 값(multi)은 포함, 그 밖엔 같은 글자 */
function conditionsMet(cond: Record<string, unknown>, info: FacilityInfo | undefined): boolean {
  if (!info) return false;
  return Object.entries(cond).every(([key, want]) => {
    const have = info[key];
    if (Array.isArray(have)) return Array.isArray(want) ? want.some((w) => have.includes(String(w))) : have.includes(String(want));
    if (Array.isArray(want)) return want.some((w) => String(w) === String(have));
    if (typeof want === 'boolean') return have === want;
    return have !== undefined && String(have) === String(want);
  });
}

const NAMED_COUNT: Record<string, [string, string]> = {
  perSpan: ['spans', 'S'],
  perAbutment: ['abutments', 'A'],
  perPier: ['piers', 'P'],
  perJoint: ['joints', 'J'],
};

/** 반복 단위별 위치 이름. 수를 모르면 null(→ 1장), 0이면 빈 배열(→ 칸 없음) */
export function positionsOf(repeat: Repeat, info: FacilityInfo | undefined): string[] | null {
  if (repeat === 'once') return [''];
  if (repeat === 'perSide') return ['좌측', '우측'];
  const num = (key: string) => (typeof info?.[key] === 'number' ? (info[key] as number) : undefined);
  const seq = (prefix: string, n: number | undefined) => (n === undefined ? null : Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`));
  if (typeof repeat === 'object') return seq(repeat.prefix, num(repeat.count));
  if (repeat === 'perSupport') {
    const a = num('abutments'), p = num('piers');
    if (a === undefined && p === undefined) return null;
    const piers = seq('P', p ?? 0) ?? [];
    if (!a) return piers;
    // 시점 교대 → 교각들 → 종점 교대 (현장에서 걷는 순서)
    return ['A1', ...piers, ...Array.from({ length: a - 1 }, (_, i) => `A${i + 2}`)];
  }
  const [key, prefix] = NAMED_COUNT[repeat];
  return seq(prefix, num(key));
}

/**
 * 템플릿을 실제 촬영 칸 목록(ShotTemplateItem)으로 편다. 순서는 템플릿 순서, 반복 항목은 위치 순.
 * 위치가 붙는 칸은 부재명에 위치를 넣는다(예: "교각(P3)") — 사진 파일명 `<구조물>_교각(P3)_012.jpg`.
 */
export function expandRequired(template: RequiredTemplateItem[], ctx: ExpandContext): ShotTemplateItem[] {
  const out: ShotTemplateItem[] = [];
  const seen = new Set<string>();
  for (const item of template) {
    if (ctx.inspectionType && item.levels && !item.levels.includes(ctx.inspectionType)) continue;
    const extra = ctx.inspectionType ? item.levelWhen?.[ctx.inspectionType] : undefined;
    if (extra && !conditionsMet(extra, ctx.info)) continue;
    if (item.when && !conditionsMet(item.when, ctx.info)) continue;
    const positions = positionsOf(item.repeat ?? 'once', ctx.info) ?? [''];
    for (const pos of positions) {
      const shot: ShotTemplateItem = { member: pos ? `${item.member}(${pos})` : item.member, label: item.label };
      if (item.aliases) shot.aliases = item.aliases;
      const key = `${shot.member}\u0000${shot.label}`;
      if (seen.has(key)) continue; // 같은 칸이 둘이면 mergeRequired가 id를 겹쳐 쓴다
      seen.add(key);
      out.push(shot);
    }
  }
  return out;
}

/** 구조물 정보를 넣어야 목록이 다 펴지는지(입력 항목이 있고, 조건·위치 반복 항목이 있는지) */
export function templateNeedsInfo(template: FacilityTemplate): boolean {
  if (template.info.length === 0) return false;
  return template.shots.some((i) => i.when !== undefined || i.levelWhen !== undefined || (i.repeat !== undefined && i.repeat !== 'once' && i.repeat !== 'perSide'));
}
