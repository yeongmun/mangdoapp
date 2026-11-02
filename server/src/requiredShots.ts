// 필수 사진 목록 펼치기(2026-11-03) — config/requiredShots.json의 항목을 점검 종류와 구조물 정보(경간·교대·교각 수,
// 상부 형식 등)에 맞춰 실제 촬영 칸으로 편다. 순수 함수만. 저장·라우트는 shotsStore.ts·app.ts.
// 근거: 세부지침 해설서(교량편) 2026.2 — [표 1.1] 점검 대상 부재, 1.2.1 부재별 점검부위, 부록 A 보고서 서두·부록.
//
// 항목 필드(모두 선택, 없으면 옛 형식과 같다 — 늘 1장):
//   levels    이 점검 종류에서만 (예: ["정밀안전점검","정밀안전진단"])
//   levelWhen 점검 종류별 추가 조건 (예: 정기안전점검은 제3종만 → { "정기안전점검": { "facilityClass": 3 } })
//   when      구조물 정보 조건 (예: { "girder": "PSC" }, { "river": true }, { "publicUse": "도로포장" })
//   repeat    once | perSpan | perAbutment | perPier | perSupport | perJoint | perSide
//   hint      앱 칸에 보이는 점검 포인트

import type { ShotTemplateItem } from './shotsStore.js';

export const REPEATS = ['once', 'perSpan', 'perAbutment', 'perPier', 'perSupport', 'perJoint', 'perSide'] as const;
export type Repeat = (typeof REPEATS)[number];

export interface RequiredTemplateItem {
  member: string;
  label: string;
  hint?: string;
  levels?: string[];
  levelWhen?: Record<string, Record<string, unknown>>;
  when?: Record<string, unknown>;
  repeat?: Repeat;
}

// ── 구조물 정보(교량) ────────────────────────────────────────────────────────────
// 앱 「구조물 정보」 화면과 같은 값이어야 한다(src/facilityInfo.ts).
export const DECK_TYPES = ['concrete', 'steel', 'none'] as const;
export const GIRDER_TYPES = ['RC', 'PSC', 'steel', 'none'] as const;
export const PUBLIC_USE = ['추락방지시설', '도로포장', '도로부신축이음부', '환기구덮개'] as const;

export interface FacilityInfo {
  spans?: number;
  abutments?: number;
  piers?: number;
  joints?: number;
  deck?: (typeof DECK_TYPES)[number];
  girder?: (typeof GIRDER_TYPES)[number];
  box?: boolean;
  trussOrArch?: boolean;
  cable?: boolean;
  river?: boolean;
  facilityClass?: 1 | 2 | 3;
  publicUse?: (typeof PUBLIC_USE)[number][];
  /** 연장(m) — 사진 펼치기에는 안 쓰고 비파괴 수량 계산용으로 함께 둔다 */
  length?: number;
  /** 최대 경간장(m) — 비파괴 수량 계산용 */
  maxSpan?: number;
}

const COUNT_KEYS = { spans: 300, abutments: 10, piers: 300, joints: 100 } as const;
const METER_KEYS = { length: 20000, maxSpan: 2000 } as const;
const BOOL_KEYS = ['box', 'trussOrArch', 'cable', 'river'] as const;

export class FacilityInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FacilityInfoError';
  }
}

/** 앱이 보낸 구조물 정보를 검사해 깨끗한 값만 돌려준다. 모르는 키는 거부(오타를 조용히 버리지 않게) */
export function validateFacilityInfo(value: unknown): FacilityInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new FacilityInfoError('구조물 정보 값이 올바르지 않습니다.');
  const v = value as Record<string, unknown>;
  const out: FacilityInfo = {};
  for (const [key, raw] of Object.entries(v)) {
    if (raw === null || raw === undefined) continue;
    if (key in COUNT_KEYS) {
      const max = COUNT_KEYS[key as keyof typeof COUNT_KEYS];
      if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > max) throw new FacilityInfoError(`${key}는 0~${max} 사이 정수로 적어 주세요.`);
      out[key as keyof typeof COUNT_KEYS] = raw as number;
    } else if (key in METER_KEYS) {
      const max = METER_KEYS[key as keyof typeof METER_KEYS];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > max) throw new FacilityInfoError(`${key}는 0보다 크고 ${max} 이하인 숫자로 적어 주세요.`);
      out[key as keyof typeof METER_KEYS] = raw;
    } else if ((BOOL_KEYS as readonly string[]).includes(key)) {
      if (typeof raw !== 'boolean') throw new FacilityInfoError(`${key}는 참/거짓이어야 합니다.`);
      out[key as (typeof BOOL_KEYS)[number]] = raw;
    } else if (key === 'deck') {
      if (!(DECK_TYPES as readonly unknown[]).includes(raw)) throw new FacilityInfoError('바닥판 형식 값이 올바르지 않습니다.');
      out.deck = raw as FacilityInfo['deck'];
    } else if (key === 'girder') {
      if (!(GIRDER_TYPES as readonly unknown[]).includes(raw)) throw new FacilityInfoError('거더 형식 값이 올바르지 않습니다.');
      out.girder = raw as FacilityInfo['girder'];
    } else if (key === 'facilityClass') {
      if (raw !== 1 && raw !== 2 && raw !== 3) throw new FacilityInfoError('시설물 종별은 1, 2, 3 중 하나입니다.');
      out.facilityClass = raw;
    } else if (key === 'publicUse') {
      if (!Array.isArray(raw) || raw.some((x) => !(PUBLIC_USE as readonly unknown[]).includes(x))) throw new FacilityInfoError('공중이 이용하는 부위 값이 올바르지 않습니다.');
      out.publicUse = [...new Set(raw)] as FacilityInfo['publicUse'];
    } else {
      throw new FacilityInfoError(`모르는 구조물 정보 항목입니다: ${key}`);
    }
  }
  return out;
}

// ── 템플릿 읽기 ──────────────────────────────────────────────────────────────────
/** 설정 파일 한 항목을 읽는다. member·label이 없으면 버린다(null). 모르는 repeat은 once로 */
export function parseTemplateItem(raw: unknown): RequiredTemplateItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.member !== 'string' || typeof r.label !== 'string') return null;
  const item: RequiredTemplateItem = { member: r.member, label: r.label };
  if (typeof r.hint === 'string' && r.hint.trim() !== '') item.hint = r.hint.trim();
  if (Array.isArray(r.levels)) item.levels = r.levels.filter((x): x is string => typeof x === 'string');
  if (isPlainObject(r.when)) item.when = r.when;
  if (isPlainObject(r.levelWhen)) item.levelWhen = r.levelWhen as RequiredTemplateItem['levelWhen'];
  if ((REPEATS as readonly unknown[]).includes(r.repeat)) item.repeat = r.repeat as Repeat;
  return item;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// ── 펼치기 ───────────────────────────────────────────────────────────────────────
export interface ExpandContext {
  /** 상위(과업)의 점검 종류. 없으면 점검 종류로 거르지 않는다 */
  inspectionType?: string;
  /** 구조물 정보. 없으면 조건(when) 항목은 빼고, 반복 항목은 1장으로 */
  info?: FacilityInfo;
}

/** 조건 하나가 맞는지. info가 없으면 맞지 않는 것으로 본다 */
function conditionsMet(cond: Record<string, unknown>, info: FacilityInfo | undefined): boolean {
  if (!info) return false;
  return Object.entries(cond).every(([key, want]) => {
    const have = (info as Record<string, unknown>)[key];
    if (Array.isArray(have)) return have.includes(want);
    return have === want;
  });
}

/** 반복 단위별 위치 이름. 수를 모르면 null(→ 1장) */
export function positionsOf(repeat: Repeat, info: FacilityInfo | undefined): string[] | null {
  if (repeat === 'once') return [''];
  if (repeat === 'perSide') return ['좌측', '우측'];
  if (!info) return null;
  const seq = (prefix: string, n: number | undefined) => (n === undefined ? null : Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`));
  switch (repeat) {
    case 'perSpan':
      return seq('S', info.spans);
    case 'perAbutment':
      return seq('A', info.abutments);
    case 'perPier':
      return seq('P', info.piers);
    case 'perJoint':
      return seq('J', info.joints);
    case 'perSupport': {
      if (info.abutments === undefined && info.piers === undefined) return null;
      const a = info.abutments ?? 0;
      const piers = seq('P', info.piers ?? 0) ?? [];
      if (a === 0) return piers;
      // 시점 교대 → 교각들 → 종점 교대 (현장에서 걷는 순서)
      const rest = Array.from({ length: a - 1 }, (_, i) => `A${i + 2}`);
      return ['A1', ...piers, ...rest];
    }
  }
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
      if (item.hint) shot.hint = item.hint;
      const key = `${shot.member}\u0000${shot.label}`;
      if (seen.has(key)) continue; // 같은 칸이 둘이면 mergeRequired가 id를 겹쳐 쓴다
      seen.add(key);
      out.push(shot);
    }
  }
  return out;
}

/** 이 템플릿이 구조물 정보를 필요로 하는지(조건·반복 항목이 있는지) — 앱이 「구조물 정보를 넣어 주세요」를 띄울지 */
export function templateNeedsInfo(template: RequiredTemplateItem[]): boolean {
  return template.some((i) => i.when !== undefined || i.levelWhen !== undefined || (i.repeat !== undefined && i.repeat !== 'once' && i.repeat !== 'perSide'));
}
