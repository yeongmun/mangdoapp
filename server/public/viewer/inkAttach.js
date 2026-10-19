// 손글씨 관련 순수 규칙(2026-10-17). 글씨는 **선택한 손상**에만 붙으므로(2026-10-19 결정) 거리 계산은 없다.
// DOM이 없어 vitest(server/test/inkAttach.test.ts)가 검사한다.

/** 아직 안 읽은 손글씨(획은 있고 text는 없음)가 붙은 손상 */
export function pendingInkDamages(damages) {
  return (Array.isArray(damages) ? damages : []).filter((d) => {
    const h = d?.attrs?.handwriting;
    return h && Array.isArray(h.strokes) && h.strokes.length > 0 && typeof h.text !== 'string';
  });
}
