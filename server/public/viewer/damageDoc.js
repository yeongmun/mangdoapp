// 손상 문서(JSON 원본) 생성·검증·편집. 브라우저와 서버가 함께 쓴다. 모든 함수는 입력을 변경하지 않는다.

import { getDamageType } from './damageTypes.js';

export const SCHEMA_VERSION = 2;
export const MAX_HISTORY = 50;

export function createEmptyDoc(drawingId, updatedAt) {
  return { schemaVersion: SCHEMA_VERSION, drawingId, updatedAt, damages: [] };
}

function isDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPointList(value, exactLength) {
  if (!Array.isArray(value)) return false;
  if (exactLength === null ? value.length < 2 : value.length !== exactLength) return false;
  return value.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

// null이거나 0 이상의 유한한 숫자
function isNullableAmount(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function validateGeometry(damage, type, path, errors) {
  const geometry = damage.geometry;
  if (typeof geometry !== 'object' || geometry === null) {
    errors.push(`${path}.geometry가 객체가 아닙니다.`);
    return false;
  }
  const expectedKind = type.kind === 'line' ? 'polyline' : 'rect';
  if (geometry.kind !== expectedKind) {
    const which = type.kind === 'line' ? '선형 손상이면 polyline' : '면형 손상이면 rect';
    errors.push(`${path}.geometry.kind는 ${which}이어야 합니다.`);
    return false;
  }
  const pointCount = expectedKind === 'rect' ? 4 : null;
  if (!isPointList(geometry.world, pointCount)) {
    errors.push(
      pointCount === 4
        ? `${path}.geometry.world는 유효한 점 4개여야 합니다.`
        : `${path}.geometry.world는 유효한 점 2개 이상이어야 합니다.`,
    );
    return false;
  }
  if (geometry.dwg === null) return false;
  if (!isPointList(geometry.dwg, geometry.world.length)) {
    errors.push(`${path}.geometry.dwg는 world와 점 개수가 같아야 합니다.`);
    return false;
  }
  return true;
}

function validateMeasured(damage, type, path, errors) {
  const measured = damage.measured;
  if (typeof measured !== 'object' || measured === null) {
    errors.push(`${path}.measured가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(measured.lengthM)) {
    errors.push(`${path}.measured.lengthM은 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableAmount(measured.areaM2)) {
    errors.push(`${path}.measured.areaM2는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (type.quantityUnit === 'm' && measured.areaM2 !== null) {
    errors.push(`${path}.measured.areaM2는 선형 손상에서 null이어야 합니다.`);
  }
  if (type.quantityUnit === 'm2' && measured.lengthM !== null) {
    errors.push(`${path}.measured.lengthM은 면형 손상에서 null이어야 합니다.`);
  }
}

function validateComputed(damage, hasDwg, path, errors) {
  const computed = damage.computed;
  if (typeof computed !== 'object' || computed === null) {
    errors.push(`${path}.computed가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(computed.lengthDwg) || !isNullableAmount(computed.areaDwg)) {
    errors.push(`${path}.computed 값은 0 이상의 숫자이거나 null이어야 합니다.`);
    return;
  }
  if (!hasDwg && (computed.lengthDwg !== null || computed.areaDwg !== null)) {
    errors.push(`${path}.computed는 dwg가 없으면 모두 null이어야 합니다.`);
  }
}

function validateAttrs(damage, path, errors) {
  const attrs = damage.attrs;
  if (typeof attrs !== 'object' || attrs === null) {
    errors.push(`${path}.attrs가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(attrs.widthMm)) {
    errors.push(`${path}.attrs.widthMm는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (typeof attrs.member !== 'string' || typeof attrs.note !== 'string') {
    errors.push(`${path}.attrs.member와 note는 문자열이어야 합니다.`);
  }
}

function validateDamage(damage, path, errors) {
  if (typeof damage !== 'object' || damage === null) {
    errors.push(`${path}가 객체가 아닙니다.`);
    return;
  }
  if (typeof damage.id !== 'string' || damage.id === '') errors.push(`${path}.id가 비어 있습니다.`);
  const type = typeof damage.type === 'string' ? getDamageType(damage.type) : null;
  if (!type) {
    errors.push(`${path}.type이 손상 유형 목록에 없습니다.`);
    return;
  }
  if (!isDateString(damage.createdAt)) errors.push(`${path}.createdAt이 올바른 날짜가 아닙니다.`);

  const hasDwg = validateGeometry(damage, type, path, errors);
  validateMeasured(damage, type, path, errors);
  validateComputed(damage, hasDwg, path, errors);
  validateAttrs(damage, path, errors);
}

export function validateDamageDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['문서가 객체가 아닙니다.'];
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion은 2이어야 합니다.');
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

// v1 문서(균열만, lengthDwg 한 개)를 v2 형태로 바꿔 읽는다. 저장은 항상 v2로 한다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  if (doc.schemaVersion !== 1) return doc;
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    drawingId: doc.drawingId ?? drawingId,
    updatedAt: doc.updatedAt,
    damages: damages.map((damage) => ({
      id: damage.id,
      type: damage.type === 'crack' ? 'crack' : damage.type,
      createdAt: damage.createdAt,
      geometry: damage.geometry,
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: damage.lengthDwg ?? null, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    })),
  };
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
