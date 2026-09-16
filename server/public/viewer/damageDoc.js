// 손상 문서(JSON 원본) 생성·검증·편집. 브라우저와 서버가 함께 쓴다. 모든 함수는 입력을 변경하지 않는다.

import { getDamageType } from './damageTypes.js';
import { polygonArea, polylineLength } from './geometry.js';

export const SCHEMA_VERSION = 5;
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

// 도형의 점 개수 규칙: 사각형은 딱 4점, 선은 2점 이상(null = 개수 제한 없음, isPointList 규약).
function pointCountFor(kind) {
  return kind === 'rect' ? 4 : null;
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
  const pointCount = pointCountFor(expectedKind);
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

// 복제본(copies)은 배열이고, 각 항목의 world는 geometry.kind의 점 개수 규칙을 따르며 dwg는
// null이거나 world와 점 개수가 같다 — geometry와 똑같은 규칙이다(설계 2장). kind는 따로 두지
// 않는다: 복제본은 언제나 첫 도형과 같은 모양이다.
function validateCopies(damage, type, path, errors) {
  const copies = damage.copies;
  if (!Array.isArray(copies)) {
    errors.push(`${path}.copies는 배열이어야 합니다.`);
    return;
  }
  const pointCount = pointCountFor(type.kind === 'line' ? 'polyline' : 'rect');
  copies.forEach((copy, i) => {
    const where = `${path}.copies[${i}]`;
    if (typeof copy !== 'object' || copy === null) {
      errors.push(`${where}가 객체가 아닙니다.`);
      return;
    }
    if (!isPointList(copy.world, pointCount)) {
      errors.push(
        pointCount === 4
          ? `${where}.world는 유효한 점 4개여야 합니다.`
          : `${where}.world는 유효한 점 2개 이상이어야 합니다.`,
      );
      return;
    }
    if (copy.dwg === null) return;
    if (!isPointList(copy.dwg, copy.world.length)) {
      errors.push(`${where}.dwg는 world와 점 개수가 같아야 합니다.`);
    }
  });
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

// photoNumbers는 문자열 배열이며, 각 항목은 앞뒤 공백이 없는 빈 문자열 아닌 값이고 중복이 없어야
// 한다(설계 9.4). parsePhotoNumbers(quantities.js)가 이미 이 모양으로 만들어 주므로, 손으로 고친
// 파일이나 예전 형식이 섞여 들어오는 경우만 이 검증에서 걸러진다.
function isValidPhotoNumbers(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() !== item || item === '' || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

// R13: 손상현황·비고·사진번호에 줄바꿈이 섞여 있으면 DXF 산출의 TEXT 엔티티(코드 1은 한
// 줄이어야 한다)가 깨진다. 값이 서버까지 오기 전에 여기서 막는다.
function hasLineBreak(value) {
  return typeof value === 'string' && /[\r\n]/.test(value);
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
  if (hasLineBreak(attrs.note) || hasLineBreak(attrs.statusText)) {
    errors.push(`${path}.attrs.note와 statusText에는 줄바꿈을 쓸 수 없습니다.`);
  }
  // 손상현황은 기타에서만 사용자가 적는다. 다른 유형은 유형 이름·균열 폭 구간으로 계산되므로
  // 값이 들어 있으면 화면에 보이지 않는 값이 조용히 남아 물량표와 어긋난다.
  if (type !== null && type.id !== 'etc' && attrs.statusText !== '') {
    errors.push(`${path}.attrs.statusText는 기타 유형에서만 쓸 수 있습니다.`);
  }
  if (!isValidPhotoNumbers(attrs.photoNumbers)) {
    errors.push(`${path}.attrs.photoNumbers는 문자열 배열이며 앞뒤 공백 없는 빈 문자열 아닌 값, 중복 없이 있어야 합니다.`);
  } else if (attrs.photoNumbers.some(hasLineBreak)) {
    errors.push(`${path}.attrs.photoNumbers 항목에는 줄바꿈을 쓸 수 없습니다.`);
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
  validateCopies(damage, type, path, errors);
  validateMeasured(damage, path, errors);
  validateComputed(damage, hasDwg, path, errors);
  validateAttrs(damage, type, path, errors);
}

export function validateDamageDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['문서가 객체가 아닙니다.'];
  const errors = [];
  if (doc.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion은 ${SCHEMA_VERSION}이어야 합니다.`);
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
  // note는 화면에서 한 줄짜리 입력(viewer.html의 noteInput, type="text")이라 줄바꿈을 쓸 수
  // 없다(R13). 옮겨 적을 값이 여럿이면 줄바꿈 대신 ' / '로 이어 한 줄로 남긴다.
  return lines.join(' / ');
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

// v3의 각 손상에 attrs.photoNumbers = []를 채워 v4로 올린다(설계 9.3). 다른 값은 그대로 두고,
// 입력 doc과 손상 객체는 바꾸지 않는다.
function migrateV3ToV4(doc) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    ...doc,
    schemaVersion: 4,
    damages: damages.map((damage) => ({
      ...damage,
      attrs: { ...damage.attrs, photoNumbers: [] },
    })),
  };
}

// v4의 각 손상에 copies = []를 채워 v5로 올린다(설계 2장). 복제본이 없는 손상은 이 값만 더해질
// 뿐 지금까지와 완전히 같이 동작한다. 입력 doc과 손상 객체는 바꾸지 않는다.
function migrateV4ToV5(doc) {
  const damages = Array.isArray(doc.damages) ? doc.damages : [];
  return {
    ...doc,
    schemaVersion: 5,
    damages: damages.map((damage) => ({ ...damage, copies: [] })),
  };
}

// 예전 문서를 읽을 때 한 단계씩 이어 붙여 v5로 올린다. 저장은 항상 v5로 한다.
// 단계를 나눠 두면 새 버전이 생겨도 각 단계를 따로 검증할 수 있다.
export function migrateDoc(doc, drawingId) {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  if (doc.schemaVersion === SCHEMA_VERSION) return doc;
  const v2 = doc.schemaVersion === 1 ? migrateV1ToV2(doc, drawingId) : doc;
  const v3 = v2.schemaVersion === 2 ? migrateV2ToV3(v2) : v2;
  const v4 = v3.schemaVersion === 3 ? migrateV3ToV4(v3) : v3;
  return v4.schemaVersion === 4 ? migrateV4ToV5(v4) : v4;
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

function copiesOf(damage) {
  return Array.isArray(damage?.copies) ? damage.copies : [];
}

/**
 * 손상의 도형 목록. 0번이 geometry(첫 도형), 1번부터 copies다(설계 2장). 복제본의 kind는 따로
 * 두지 않는다 — 언제나 geometry.kind와 같다.
 * @type {(damage: any) => Array<{ world: number[][], dwg: number[][] | null }>}
 */
export function shapesOf(damage) {
  const first = {
    world: Array.isArray(damage?.geometry?.world) ? damage.geometry.world : [],
    dwg: Array.isArray(damage?.geometry?.dwg) ? damage.geometry.dwg : null,
  };
  return [
    first,
    ...copiesOf(damage).map((copy) => ({
      world: Array.isArray(copy?.world) ? copy.world : [],
      dwg: Array.isArray(copy?.dwg) ? copy.dwg : null,
    })),
  ];
}

/** @type {(damage: any) => number} */
export function shapeCountOf(damage) {
  return 1 + copiesOf(damage).length;
}

// 첫 도형이 바뀌면 computed도 같이 바꾼다. dwg가 없으면 둘 다 null이어야 한다 — validateComputed의
// 규칙이라, 승격된 복제본에 dwg가 없는데 옛 값을 남겨 두면 저장이 통째로 막힌다.
function computedFor(kind, dwg) {
  if (!Array.isArray(dwg)) return { lengthDwg: null, areaDwg: null };
  return kind === 'rect'
    ? { lengthDwg: null, areaDwg: polygonArea(dwg) }
    : { lengthDwg: polylineLength(dwg), areaDwg: null };
}

/**
 * 복제본을 하나 더한다. 도형(world·dwg)은 부르는 쪽이 만들어 넘긴다 — 오른쪽으로 옮긴 자리의 dwg는
 * 뷰어의 좌표 변환기(mapper)가 있어야 구할 수 있고, 이 파일은 서버도 쓰므로 mapper를 모른다.
 * 개소는 그 시점의 도형 수로 맞춘다(설계 2장 "항상").
 * @type {(editor: Editor, damageId: string, shape: { world: number[][], dwg: number[][] | null }, now: string) => Editor}
 */
export function duplicateShape(editor, damageId, shape, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  const copies = [...copiesOf(current), { world: shape.world, dwg: shape.dwg ?? null }];
  const updated = { ...current, copies, measured: { ...current.measured, count: copies.length + 1 } };
  return commit(editor, editor.doc.damages.map((damage, i) => (i === index ? updated : damage)), now);
}

/**
 * 도형 하나만 지운다(설계 3.3). 첫 도형(0번)을 지우면 copies[0]이 새 geometry가 되고 — 번호 라벨이
 * 그 도형으로 옮겨간다 — 마지막 남은 도형을 지우면 손상 자체가 사라진다. 지운 뒤 개소를 도형 수로 맞춘다.
 * @type {(editor: Editor, damageId: string, shapeIndex: number, now: string) => Editor}
 */
export function removeShape(editor, damageId, shapeIndex, now) {
  const index = editor.doc.damages.findIndex((damage) => damage.id === damageId);
  if (index === -1) return editor;
  const current = editor.doc.damages[index];
  if (!Number.isInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= shapeCountOf(current)) return editor;
  if (shapeCountOf(current) === 1) return removeDamage(editor, damageId, now);

  const copies = copiesOf(current);
  let updated;
  if (shapeIndex === 0) {
    const [promoted, ...rest] = copies;
    updated = {
      ...current,
      geometry: { ...current.geometry, world: promoted.world, dwg: promoted.dwg ?? null },
      copies: rest,
      computed: computedFor(current.geometry.kind, promoted.dwg ?? null),
    };
  } else {
    updated = { ...current, copies: copies.filter((_, i) => i !== shapeIndex - 1) };
  }
  updated = { ...updated, measured: { ...current.measured, count: shapeCountOf(updated) } };
  return commit(editor, editor.doc.damages.map((damage, i) => (i === index ? updated : damage)), now);
}

/**
 * 도형 하나(첫 도형이든 복제본이든)의 좌표만 바꾼다. computed는 첫 도형을 바꿨을 때만 다시 센다
 * (설계 3.3). 개소는 건드리지 않는다 — 도형 수가 변하지 않기 때문이다.
 * @type {(editor: Editor, damageId: string, shapeIndex: number, shape: { world: number[][], dwg: number[][] | null }, now: string) => Editor}
 */
export function updateShape(editor, damageId, shapeIndex, shape, now) {
  const current = editor.doc.damages.find((damage) => damage.id === damageId);
  if (!current) return editor;
  if (!Number.isInteger(shapeIndex) || shapeIndex < 0 || shapeIndex >= shapeCountOf(current)) return editor;
  const dwg = shape.dwg ?? null;
  if (shapeIndex === 0) {
    const changes = { geometry: { world: shape.world, dwg }, computed: computedFor(current.geometry.kind, dwg) };
    return updateDamage(editor, damageId, changes, now);
  }
  const copies = copiesOf(current).map((copy, i) => (i === shapeIndex - 1 ? { world: shape.world, dwg } : copy));
  return updateDamage(editor, damageId, { copies }, now);
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
