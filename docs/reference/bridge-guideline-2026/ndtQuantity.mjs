// 교량 재료시험(비파괴) 기본과업 최소수량 계산 — 세부지침 해설서(교량편) 2026.2, 1.3절
// 순수 함수. 입력 필드는 bridge-ndt-rules.json의 inputs 참고.

const ADJ_POINTS = [[300, 1.0], [400, 0.9], [500, 0.8], [750, 0.7], [1000, 0.6], [1500, 0.5], [2000, 0.4], [3000, 0.35], [4000, 0.3]];

/** 연장별 조정비 (300m 미만 1.0, 4000m 이상은 0.3 — 30~20%는 책임기술자 판단) */
export function lengthRatio(L) {
  if (L < 300) return 1;
  if (L >= 4000) return 0.3;
  for (let i = 0; i < ADJ_POINTS.length - 1; i++) {
    const [x0, y0] = ADJ_POINTS[i], [x1, y1] = ADJ_POINTS[i + 1];
    if (L >= x0 && L <= x1) return y0 + ((L - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

const up = (x) => Math.ceil(x - 1e-9);

/**
 * @param {'정기안전점검'|'정밀안전점검'|'정밀안전진단'} level
 * @param {{length:number, spans:number, maxSpan?:number, abutments?:number, piers?:number,
 *   superType?:'RC'|'composite', steelGirder?:'none'|'plate'|'box', girdersPerSpan?:number,
 *   rahmen?:boolean, adjust?:boolean}} b
 * @returns {Array<{test:string, super?:number, sub?:number, total:number|[number,number], minSuper?:number, raw?:number, ratio?:number, note?:string}>}
 */
export function basicQuantities(level, b) {
  const L = b.length;
  const adjust = b.adjust !== false;
  const ratio = adjust ? lengthRatio(L) : 1;
  const le5 = b.spans <= 5;
  const out = [];

  if (level === '정밀안전점검') {
    const sup = L / 50, sub = L / 50;
    out.push({ test: '반발경도', ...split(sup, sub, ratio) });
    out.push({ test: '탄산화 깊이', total: le5 ? [2, 3] : [3, 6], minSuper: le5 ? 1 : 2 });
    return out;
  }

  if (level === '정밀안전진단') {
    const sup = (L / 50) * (b.superType === 'composite' ? 1 : 2);
    let sub;
    if (b.rahmen) sub = b.spans;                                   // 1.3.3 나.
    else if ((b.maxSpan ?? 0) >= 50) sub = (b.abutments ?? 2) + (b.piers ?? 0);
    else sub = L / 50;
    const s = split(sup, sub, ratio);
    for (const t of ['반발경도', '초음파전달속도', '철근탐사']) out.push({ test: t, ...s });
    out.push({ test: '탄산화 깊이', total: le5 ? [4, 6] : [6, 9], minSuper: le5 ? 2 : 3 });
    out.push({ test: '염화물함유량', total: 3, minSuper: 1, note: '해상·합류부 교량은 하부 수중부 1곳 이상 포함' });
    out.push({ test: '균열깊이', total: 0, note: '균열폭 0.3mm 이상 균열 대상, 책임기술자 판단' });
    if (b.steelGirder && b.steelGirder !== 'none') {
      const per = b.steelGirder === 'box' ? 2 : 1;
      const raw = b.spans * (b.girdersPerSpan ?? 1) * per;
      out.push({ test: '강재용접부 초음파탐상', raw, ratio, total: up(raw * ratio), note: '맞대기 용접부' });
    }
    return out;
  }
  return out; // 정기안전점검: 재료시험 없음
}

// 상·하부 원수량 합계에 조정비를 곱해 올림. 상·하부 배분은 참고값(책임기술자가 재분배)
function split(sup, sub, ratio) {
  const raw = up(sup + sub);
  const total = up(raw * ratio);
  const s = up((sup / (sup + sub)) * total);
  return { super: s, sub: total - s, raw, ratio, total };
}
