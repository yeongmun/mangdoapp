// 구조물 정보 — 「구조물 정보」 시트의 입력값 ↔ 서버 facilityInfo(2026-11-03). 순수 모듈(vitest: server/test/facilityInfo.test.ts).
// 입력 항목은 시설물 종류마다 서버 config/requiredShots.json의 info에서 온다(GET /api/facility-info-fields, 촬영 목록 응답의 infoFields).
// 서버는 이 값으로 필수 사진을 경간·교각·지(池)마다 펴고, 형식·유무로 칸을 거른다. 값 검사도 서버가 같은 항목으로 한 번 더 한다.

export type InfoType = 'count' | 'meter' | 'bool' | 'choice' | 'multi';

export interface InfoField {
  key: string;
  label: string;
  type: InfoType;
  options?: [string, string][];
  default?: unknown;
  required?: boolean;
  max?: number;
  summary?: boolean;
  /** 이 조건이 맞을 때만 보이는 칸(예: 직립부 형식은 직립제·혼성제일 때만). 안 보이면 고를 수 없고 보내지도 않는다 */
  showWhen?: Record<string, unknown>;
}

export type FacilityInfo = Record<string, number | boolean | string | string[]>;

/** 시트 입력 상태 — 숫자 칸은 글자 그대로(지우는 중인 빈칸을 0으로 바꾸지 않게), choice는 값, bool·multi는 그대로 */
export type InfoForm = Record<string, string | boolean | string[]>;

/** 저장된 값으로(없으면 항목 기본값으로) 시트를 연다 */
export function formFromInfo(fields: InfoField[], info: FacilityInfo | null | undefined): InfoForm {
  const form: InfoForm = {};
  for (const f of fields) {
    const saved = info?.[f.key];
    const value = info ? saved : (saved ?? f.default);
    switch (f.type) {
      case 'count':
      case 'meter':
        form[f.key] = typeof value === 'number' ? String(value) : '';
        break;
      case 'bool':
        form[f.key] = value === true;
        break;
      case 'choice': {
        const v = value === undefined || value === null ? '' : String(value);
        form[f.key] = f.options?.some(([o]) => o === v) ? v : '';
        break;
      }
      case 'multi':
        form[f.key] = Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
        break;
    }
  }
  return form;
}

/** 지금 입력 상태에서 이 칸이 보이는지 — showWhen 조건을 시트 값으로 본다(multi는 포함, 배열 조건은 그중 하나). 서버 conditionsMet과 같은 규칙 */
export function fieldShown(field: InfoField, form: InfoForm): boolean {
  if (!field.showWhen) return true;
  return Object.entries(field.showWhen).every(([key, want]) => {
    const have = form[key];
    const wants = Array.isArray(want) ? want.map(String) : [String(want)];
    if (Array.isArray(have)) return wants.some((w) => have.includes(w));
    if (typeof want === 'boolean') return have === want;
    return have !== undefined && have !== '' && wants.includes(String(have));
  });
}

/** 시트 입력 → 서버로 보낼 facilityInfo. 틀리거나 빠진 칸이 있으면 { error } */
export function infoFromForm(fields: InfoField[], form: InfoForm): { info: FacilityInfo } | { error: string } {
  const info: FacilityInfo = {};
  for (const f of fields) {
    // 안 보이는 칸은 해당 없음 — 보내지 않는다(서버도 해당 없음으로 펼친다)
    if (!fieldShown(f, form)) continue;
    const raw = form[f.key];
    if (f.type === 'count' || f.type === 'meter') {
      const t = typeof raw === 'string' ? raw.trim().replace(',', '.') : '';
      if (t === '') {
        if (f.required) return { error: `${f.label}을(를) 적어 주세요.` };
        continue;
      }
      const n = Number(t);
      const max = f.max ?? (f.type === 'count' ? 1000 : 100000);
      if (f.type === 'count' && !/^\d+$/.test(t)) return { error: `${f.label}은(는) 0 이상 정수로 적어 주세요.` };
      if (!Number.isFinite(n) || n < 0) return { error: `${f.label}은(는) 0 이상 숫자로 적어 주세요.` };
      if (n > max) return { error: `${f.label}은(는) ${max} 이하로 적어 주세요.` };
      info[f.key] = n;
    } else if (f.type === 'bool') {
      info[f.key] = raw === true;
    } else if (f.type === 'choice') {
      if (typeof raw === 'string' && raw !== '') info[f.key] = raw;
      else if (f.required) return { error: `${f.label}을(를) 골라 주세요.` };
    } else {
      const list = Array.isArray(raw) ? raw : [];
      if (f.required && list.length === 0) return { error: `${f.label}을(를) 하나 이상 골라 주세요.` };
      info[f.key] = [...list];
    }
  }
  return { info };
}

/** 「경간 수」→「경간」, 「연장(m)」→「연장」 */
function shortLabel(label: string): string {
  return label.replace(/\(.*?\)/g, '').replace(/\s*수$/, '').trim();
}

/** 구조물 화면 알약에 보이는 짧은 요약. 없으면 null. summary 항목이 있으면 그것만, 없으면 값 있는 앞 항목 3개 */
export function infoSummary(fields: InfoField[], info: FacilityInfo | null | undefined): string | null {
  if (!info || Object.keys(info).length === 0) return null;
  const chosen = fields.some((f) => f.summary) ? fields.filter((f) => f.summary) : fields;
  const parts: string[] = [];
  for (const f of chosen) {
    const v = info[f.key];
    if (v === undefined) continue;
    if (f.type === 'count' && typeof v === 'number') parts.push(f.key === 'spans' ? `${v}경간` : `${shortLabel(f.label)} ${v}`);
    else if (f.type === 'meter' && typeof v === 'number' && v > 0) parts.push(`${v}m`);
    else if (f.type === 'choice') {
      const label = f.options?.find(([o]) => o === String(v))?.[1];
      if (label && String(v) !== 'none') parts.push(label);
    } else if (f.type === 'multi' && Array.isArray(v) && v.length > 0) {
      const first = f.options?.find(([o]) => o === v[0])?.[1];
      if (first) parts.push(v.length > 1 ? `${shortLabel(first)} 외 ${v.length - 1}` : shortLabel(first));
    }
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(' · ') : '입력됨';
}
