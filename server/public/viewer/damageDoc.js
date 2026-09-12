// 손상 문서(JSON 원본) 생성·검증·편집. 브라우저와 서버가 함께 쓴다. 모든 함수는 입력을 변경하지 않는다.

import { getDamageType } from './damageTypes.js';

export const SCHEMA_VERSION = 3;
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

// null이거나 0 이상의 정수 (개소)
function isNullableCount(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
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

function validateMeasured(damage, path, errors) {
  const measured = damage.measured;
  if (typeof measured !== 'object' || measured === null) {
    errors.push(`${path}.measured가 객체가 아닙니다.`);
    return;
  }
  if (!isNullableAmount(measured.width)) {
    errors.push(`${path}.measured.width는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableAmount(measured.length)) {
    errors.push(`${path}.measured.length는 0 이상의 숫자이거나 null이어야 합니다.`);
  }
  if (!isNullableCount(measured.count)) {
    errors.push(`${path}.measured.count는 0 이상의 정수이거나 null이어야 합니다.`);
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

function validateAttrs(damage, type, path, errors) {
  const attrs = damage.attrs;
  if (typeof attrs !== 'object' || attrs === null) {
    errors.push(`${path}.attrs가 객체가 아닙니다.`);
    return;
  }
  if (typeof attrs.note !== 'string' || typeof attrs.statusText !== 'string') {
    errors.push(`${path}.attrs.note와 statusText는 문자열이어야 합니다.`);
    return;
  }
  // 손상현황은 기타에서만 사용자가 적는다. 다른 유형은 유형 이름·균열 폭 구간으로 계산되므로
  // 값이 들어 있으면 화면에 보이지 않는 값이 조용히 남아 물량표와 어긋난다.
  if (type !== null && type.id !== 'etc' && attrs.statusText !== '') {
    errors.push(`${path}.attrs.statusText는 기타 유형에서만 쓸 수 있습니다.`);
  }
}

function validateDamage(damage, path, errors) {
  if (typeof damage !== 'object' || damage === null) {
    errors.push(`${path}가 객체가 아닙니다.`);
    return;
  }
  if (typeof damage.id !== 'string' || damage.id === '') errors.push(`${path}.id가 비어 있습니다.`);
  if (!isDateString(damage.createdAt)) errors.push(`${path}.createdAt이 올바른 날짜가 아닙니다.`);
  const type = typeof damage.type === 'string' ? getDamageType(damage.type) : null;
  if (!type) {
    errors.push(`${path}.type이 손상 유형 목록에 없습니다.`);
    validateAttrs(damage, null, path, errors);
    return;
  }

  const hasDwg = validateGeometry(damage, type, path, errors);
  validateMeasured(damage, path, errors);
  validateComputed(damage, hasDwg, path, errors);
  validateAttrs(damage, type, path, errors);
}

export function validateDamageDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['문서가 객체가 아닙니다.'];
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion은 3이어야 합니다.');
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

// v1 문서(균열만, lengthDwg 한 개)를 v2 형태로 바꾼다.
function migrateV1ToV2(doc, drawingId) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    schemaVersion: 2,
    drawingId: doc.drawingId ?? drawingId,
    updatedAt: doc.updatedAt,
    damages: damages.map((damage) => ({
      id: damage.id,
      type: 'crack',
      createdAt: damage.createdAt,
      geometry: damage.geometry,
      measured: { lengthM: null, areaM2: null },
      computed: { lengthDwg: damage.lengthDwg ?? null, areaDwg: null },
      attrs: { widthMm: null, member: '', note: '' },
    })),
  };
}

// v2의 면적·부재명은 v3에 들어갈 칸이 없다. 면적에서 가로·세로를 되돌릴 수 없으므로 지어내지 않고,
// 조용히 버리지도 않는다. 사용자가 보고 다시 입력할 수 있게 비고에 옮겨 적는다.
//
// 길이(lengthM)는 선형 유형(isLineType)이면 measured.length로 제 칸을 찾아가므로 여기서는 다루지
// 않는다. isLineType이 아닌데(면형이거나, 유형이 삭제·이름바뀜으로 알 수 없는데) lengthM 값이
// 남아 있으면 measured.length 자리를 못 찾고 그대로 사라지므로, areaM2와 같은 방식으로 비고에 옮긴다.
function carriedNote(damage, isLineType) {
  const measured = damage.measured ?? {};
  const attrs = damage.attrs ?? {};
  const lines = [];
  if (!isLineType && Number.isFinite(measured.lengthM)) lines.push(`이전 길이 입력값: ${measured.lengthM}m`);
  if (Number.isFinite(measured.areaM2)) lines.push(`이전 면적 입력값: ${measured.areaM2}㎡`);
  if (typeof attrs.member === 'string' && attrs.member !== '') lines.push(`부재명: ${attrs.member}`);
  if (typeof attrs.note === 'string' && attrs.note !== '') lines.push(attrs.note);
  return lines.join('\n');
}

function migrateV2ToV3(doc) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    ...doc,
    schemaVersion: 3,
    damages: damages.map((damage) => {
      const measured = damage.measured ?? {};
      const attrs = damage.attrs ?? {};
      // v2의 widthMm(mm, 균열류의 폭)은 선형 유형에서만 쓰였다. areaM2가 채워졌는지가 아니라
      // 유형표를 직접 조회해 판단한다 — 손으로 고쳐진 v2 파일처럼 면형 유형인데 areaM2는 null이고
      // widthMm만 남아 있는 경우, areaM2 유무로 판단하면 mm 값이 그대로 m 단위 measured.width로
      // 새어 들어간다. 유형을 알 수 없을 때도 같은 이유로 보수적으로 옮기지 않는다.
      const type = typeof damage.type === 'string' ? getDamageType(damage.type) : null;
      const isLineType = type !== null && type.quantityUnit === 'm';
      return {
        id: damage.id,
        type: damage.type,
        createdAt: damage.createdAt,
        geometry: damage.geometry,
        measured: {
          width: isLineType && Number.isFinite(attrs.widthMm) ? attrs.widthMm : null,
          length: isLineType && Number.isFinite(measured.lengthM) ? measured.lengthM : null,
          count: null,
        },
        computed: damage.computed ?? { lengthDwg: null, areaDwg: null },
        attrs: { note: carriedNote(damage, isLineType), statusText: '' },
      };
    }),
  };
}

// 예전 문서를 읽을 때 한 단계씩 이어 붙여 v3로 올린다. 저장은 항상 v3로 한다.
// 단계를 나눠 두면 새 버전이 생겨도 각 단계를 따로 검증할 수 있다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  const v2 = doc.schemaVersion === 1 ? migrateV1ToV2(doc, drawingId) : doc;
  return v2.schemaVersion === 2 ? migrateV2ToV3(v2) : v2;
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

// 손상 한 건의 일부만 바꾼다. geometry·measured·computed·attrs는 각각 얕게 병합한다.
export function updateDamage(editor, damageId, changes, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  const updated = {
    ...current,
    ...changes,
    geometry: { ...current.geometry, ...(changes.geometry ?? {}) },
    measured: { ...current.measured, ...(changes.measured ?? {}) },
    computed: { ...current.computed, ...(changes.computed ?? {}) },
    attrs: { ...current.attrs, ...(changes.attrs ?? {}) },
  };
  const damages = editor.doc.damages.map((damage, i) => (i === index ? updated : damage));
  return commit(editor, damages, now);
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
