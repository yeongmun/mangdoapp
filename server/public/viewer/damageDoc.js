// 손상 문서(JSON 원본) 생성·검증·편집. 브라우저와 서버가 함께 쓴다. 모든 함수는 입력을 변경하지 않는다.

/**
 * @typedef {Object} Damage
 * @property {string} id
 * @property {'crack'} type
 * @property {string} createdAt
 * @property {{kind: 'polyline', world: number[][], dwg: number[][] | null}} geometry
 * @property {number | null} lengthDwg
 */

/**
 * @typedef {Object} DamageDoc
 * @property {number} schemaVersion
 * @property {string} drawingId
 * @property {string} updatedAt
 * @property {Damage[]} damages
 */

/**
 * @typedef {Object} Editor
 * @property {DamageDoc} doc
 * @property {DamageDoc[]} history
 */

export const SCHEMA_VERSION = 1;
export const MAX_HISTORY = 50;

/**
 * @param {string} drawingId
 * @param {string} updatedAt
 * @returns {DamageDoc}
 */
export function createEmptyDoc(drawingId, updatedAt) {
  return { schemaVersion: SCHEMA_VERSION, drawingId, updatedAt, damages: [] };
}

function isDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPointList(value, minLength) {
  return (
    Array.isArray(value) &&
    value.length >= minLength &&
    value.every(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
  );
}

/**
 * @param {any} damage
 * @param {string} path
 * @param {string[]} errors
 */
function validateDamage(damage, path, errors) {
  if (typeof damage !== 'object' || damage === null) {
    errors.push(`${path}가 객체가 아닙니다.`);
    return;
  }
  if (typeof damage.id !== 'string' || damage.id === '') errors.push(`${path}.id가 비어 있습니다.`);
  if (damage.type !== 'crack') errors.push(`${path}.type은 crack이어야 합니다.`);
  if (!isDateString(damage.createdAt)) errors.push(`${path}.createdAt이 올바른 날짜가 아닙니다.`);

  const geometry = damage.geometry;
  if (typeof geometry !== 'object' || geometry === null) {
    errors.push(`${path}.geometry가 객체가 아닙니다.`);
    return;
  }
  if (geometry.kind !== 'polyline') errors.push(`${path}.geometry.kind는 polyline이어야 합니다.`);
  const worldOk = isPointList(geometry.world, 2);
  if (!worldOk) errors.push(`${path}.geometry.world는 유효한 점 2개 이상이어야 합니다.`);

  if (geometry.dwg === null) {
    if (damage.lengthDwg !== null) errors.push(`${path}.lengthDwg는 dwg가 없으면 null이어야 합니다.`);
    return;
  }
  const dwgLengthMatches =
    Array.isArray(geometry.world) && Array.isArray(geometry.dwg) && geometry.dwg.length === geometry.world.length;
  if (!isPointList(geometry.dwg, 0) || !dwgLengthMatches) {
    errors.push(`${path}.geometry.dwg는 world와 점 개수가 같아야 합니다.`);
  }
  if (!Number.isFinite(damage.lengthDwg) || damage.lengthDwg < 0) {
    errors.push(`${path}.lengthDwg는 0 이상의 숫자여야 합니다.`);
  }
}

/**
 * @param {unknown} doc
 * @param {string} drawingId
 * @returns {string[]}
 */
export function validateDamageDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['문서가 객체가 아닙니다.'];
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion은 1이어야 합니다.');
  if (doc.drawingId !== drawingId) errors.push('drawingId가 주소와 다릅니다.');
  if (!isDateString(doc.updatedAt)) errors.push('updatedAt이 올바른 날짜가 아닙니다.');
  if (!Array.isArray(doc.damages)) {
    errors.push('damages는 배열이어야 합니다.');
    return errors;
  }
  const seen = new Set();
  doc.damages.forEach((damage, i) => {
    const path = `damages[${i}]`;
    validateDamage(damage, path, errors);
    if (damage && typeof damage.id === 'string' && damage.id !== '') {
      if (seen.has(damage.id)) errors.push(`${path}.id가 중복됩니다: ${damage.id}`);
      seen.add(damage.id);
    }
  });
  return errors;
}

/**
 * @param {DamageDoc} doc
 * @returns {Editor}
 */
export function createEditor(doc) {
  return { doc, history: [] };
}

/**
 * @param {Editor} editor
 * @param {Damage[]} damages
 * @param {string} now
 * @returns {Editor}
 */
function commit(editor, damages, now) {
  const history = [...editor.history, editor.doc].slice(-MAX_HISTORY);
  return { doc: { ...editor.doc, damages, updatedAt: now }, history };
}

/**
 * @param {Editor} editor
 * @param {Damage} damage
 * @param {string} now
 * @returns {Editor}
 */
export function addDamage(editor, damage, now) {
  return commit(editor, [...editor.doc.damages, damage], now);
}

/**
 * @param {Editor} editor
 * @param {string} damageId
 * @param {string} now
 * @returns {Editor}
 */
export function removeDamage(editor, damageId, now) {
  if (!editor.doc.damages.some((d) => d.id === damageId)) return editor;
  return commit(editor, editor.doc.damages.filter((d) => d.id !== damageId), now);
}

/**
 * @param {Editor} editor
 * @param {string} now
 * @returns {Editor}
 */
export function undo(editor, now) {
  if (editor.history.length === 0) return editor;
  const previous = editor.history[editor.history.length - 1];
  // updatedAt을 현재 시각으로 올려야 로컬 백업이 서버 문서보다 최신으로 판단된다.
  return { doc: { ...previous, updatedAt: now }, history: editor.history.slice(0, -1) };
}

/**
 * @param {Editor} editor
 * @returns {boolean}
 */
export function canUndo(editor) {
  return editor.history.length > 0;
}
