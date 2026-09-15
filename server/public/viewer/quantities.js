// 손상에서 자동으로 정해지는 값(번호·손상현황·물량·단위). 저장하지 않고 필요할 때마다 계산한다.
// 저장하면 손상을 하나 지울 때마다 뒷번호를 전부 다시 써야 하고, 값과 위치가 어긋날 수 있다.
//
// 2단계 DWG 물량표도 같은 함수를 쓴다. 표 한 행의 칸은 다음과 같이 대응한다.
//   번호 computeNumbers / 손상현황 statusTextOf
//   / 가로·폭 measured.width — 표 칸에는 단위를 붙이지 않는다. 컨트롤러 판정 R2(2026-09-15,
//     사용자 확인): 표는 8번째 칸에 이미 "단위" 열이 따로 있고, 사내 표기 관행이 그 칸에는
//     숫자만 적는다(설계 §7.2). 그래서 표 생성기(server/src/export/tableFill.ts의 rowValuesOf)는
//     formatQuantity(measured.width) 숫자만 그대로 쓰고 widthUnitOf는 쓰지 않는다.
//     widthUnitOf(type)('mm'|'m')는 화면의 라벨·속성 패널에서만 쓴다 — 균열류(quantityUnit이
//     'm'인 유형)의 0.3과 박락 같은 면형 유형의 1.2가 화면에서 단위 없이 같은 칸처럼 보이면
//     헷갈리기 때문이다. 표에는 이 구분이 필요 없다.
//   / 세로·길이 measured.length / 개소 measured.count / 물량 quantityOf / 단위 unitOf / 비고 attrs.note
//
// computeNumbers는 geometry.world 좌표로 번호를 매긴다(3.1). geometry.dwg로 다시 매기면 안 된다 —
// 페이지→모델 변환(coords.js)이 회전·반전을 포함할 수 있어 world 기준 순서와 dwg 기준 순서가 달라질
// 수 있다. 2단계 생성기가 DWG 모델 공간에서 동작하더라도, 번호는 world 좌표로 계산한 결과(id→번호)를
// 그대로 가져다 써야 한다.
//
// 값의 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md 3장

import { getDamageType } from './damageTypes.js';
import { boundsOf } from './geometry.js';

// 균열 폭(mm) 구간 경계. 이 두 값이 균열류의 손상현황 이름을 가른다.
export const CRACK_WIDTH_BREAKS = [0.3, 0.5];

const UNIT_LABELS = { m: 'm', m2: '㎡' };

function isAmount(value) {
  return Number.isFinite(value) && value >= 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function compareId(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// 번호 규칙은 경계상자의 중심만 본다. 좌표계는 geometry.world 하나로 통일한다
// (모든 손상이 항상 갖고 있고, 도면을 확대·회전해도 값이 변하지 않는다).
function centerOf(damage) {
  const world = Array.isArray(damage?.geometry?.world) ? damage.geometry.world : [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of world) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  // 좌표가 없거나 숫자가 아니면 원점으로 본다. 번호를 못 받는 손상이 생기면
  // 화면에 라벨이 비고 물량표에서도 빠지므로, 값을 정해서라도 번호는 매긴다.
  if (minX === Infinity) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} FrameBounds
 * 망도틀 영역(mm, 도면 좌표). 서버의 server/src/export/frames.ts가 만드는 것과 같은 모양이고,
 * 도면 레코드(DrawingRecord.frames)에 실려 화면까지 온다.
 */

// 손상이 어느 망도틀에 들어가는지. geometry.dwg 경계상자의 중심이 틀 안(경계 포함)이면 그 틀이다.
// world가 아니라 dwg를 쓴다 — 페이지→모델 변환(coords.js)에 회전·반전이 있으면 world 경계상자가
// 서버가 보는 도면 좌표와 달라져 화면과 산출의 답이 갈린다(설계 4장).
// 여러 틀에 들어가면(틀이 겹치는 도면) 인덱스가 작은 틀이 이긴다.
/** @type {(damage: any, frames: FrameBounds[]) => number | null} */
export function frameIndexOf(damage, frames) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) return null;
  const bounds = boundsOf(damage?.geometry?.dwg);
  if (!bounds) return null;
  const x = (bounds.minX + bounds.maxX) / 2;
  const y = (bounds.minY + bounds.maxY) / 2;
  for (let index = 0; index < list.length; index++) {
    const frame = list[index];
    if (!frame) continue;
    if (x >= frame.minX && x <= frame.maxX && y >= frame.minY && y <= frame.maxY) return index;
  }
  return null;
}

// 어느 틀에도 들어가지 않는 손상 수. 틀이 없는 도면은 "틀 밖"이라는 개념이 없어 늘 0이다.
// 화면 경고 배지(overlay.js)와 산출 경고(exportDrawing.ts)가 같이 쓴다.
/** @type {(damages: any[], frames: FrameBounds[]) => number} */
export function countOutsideFrames(damages, frames) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) return 0;
  let count = 0;
  for (const damage of Array.isArray(damages) ? damages : []) {
    if (frameIndexOf(damage, list) === null) count += 1;
  }
  return count;
}

// 도면 위 위치로 번호를 정한다(왼쪽 우선, 2026-09-14 변경). 왼쪽(X가 작은 쪽)이 앞번호,
// X가 같으면 위쪽(Y가 큰 쪽)이 앞, 그것도 같으면 id 오름차순. 사내 망도가 교량 입면도처럼
// 가로로 길어 줄을 나누지 않고 왼쪽부터 훑는 편이 실제 보는 순서와 맞는다(설계 3.1).
// 같은 손상 집합이면 넣은 순서와 상관없이 항상 같은 번호가 나온다.
//
// frames를 주면 **틀마다 1번부터** 다시 매긴다(2026-09-16 설계 5장). 사내 표기가 그렇다 —
// 첫 틀이 15번에서 끝나도 다음 틀은 1번이다. 틀 밖 손상은 Map에 넣지 않는다(번호 없음).
// frames가 비어 있으면 예전과 똑같다 — 전체를 한 묶음으로 1부터, dwg가 없는 손상도 번호를 받는다.
/** @type {(damages: any[], frames?: FrameBounds[]) => Map<string, number>} */
export function computeNumbers(damages, frames = []) {
  const list = Array.isArray(damages) ? damages : [];
  const frameList = Array.isArray(frames) ? frames : [];
  const sorted = list
    // 틀이 없는 도면은 모두 같은 묶음(0)에 넣어 예전 동작을 그대로 낸다.
    .map((damage) => ({
      id: String(damage?.id),
      frame: frameList.length === 0 ? 0 : frameIndexOf(damage, frameList),
      ...centerOf(damage),
    }))
    .filter((entry) => entry.frame !== null)
    .sort((a, b) => a.frame - b.frame || a.x - b.x || b.y - a.y || compareId(a.id, b.id));

  const numbers = new Map();
  let group = sorted.length > 0 ? sorted[0].frame : 0;
  let next = 1;
  for (const entry of sorted) {
    if (entry.frame !== group) {
      group = entry.frame;
      next = 1;
    }
    numbers.set(entry.id, next++);
  }
  return numbers;
}

export function statusTextOf(damage) {
  const type = getDamageType(damage?.type);
  // 유형 목록에 없는 손상은 저장된 type을 그대로 보여준다 — 화면에서 사라지면 지울 수도 없다.
  if (!type) return String(damage?.type ?? '');
  if (type.id === 'etc') {
    const written = typeof damage?.attrs?.statusText === 'string' ? damage.attrs.statusText.trim() : '';
    return written === '' ? type.label : written;
  }
  if (type.quantityUnit !== 'm') return type.label;
  const width = damage?.measured?.width;
  // 균열류인데 폭이 비어 있으면 구간을 붙이지 않는다.
  if (!isAmount(width)) return type.label;
  if (width < CRACK_WIDTH_BREAKS[0]) return `${type.label}(${CRACK_WIDTH_BREAKS[0]}mm미만)`;
  if (width < CRACK_WIDTH_BREAKS[1]) return `${type.label}(${CRACK_WIDTH_BREAKS[0]}mm이상)`;
  return `${type.label}(${CRACK_WIDTH_BREAKS[1]}mm이상)`;
}

// 물량. 계산에 필요한 값 중 하나라도 비어 있으면 null이고, 0은 유효한 값이다.
export function quantityOf(damage) {
  const type = getDamageType(damage?.type);
  if (!type) return null;
  const measured = damage?.measured ?? {};
  if (!isAmount(measured.length) || !isCount(measured.count)) return null;
  // 균열류의 가로/폭은 mm이고 손상현황 구간에만 쓴다. 물량에는 넣지 않는다.
  if (type.quantityUnit === 'm') return measured.length * measured.count;
  if (!isAmount(measured.width)) return null;
  return measured.width * measured.length * measured.count;
}

export function unitOf(damage) {
  const type = getDamageType(damage?.type);
  if (!type) return null;
  return UNIT_LABELS[type.quantityUnit] ?? null;
}

// 가로/폭 칸의 단위. 균열류(quantityUnit이 'm'인 선형 유형)만 mm이고 나머지는 m이다 — 균열 폭이
// 0.3mm·0.5mm 경계로 손상현황을 가르는 mm 단위 값이기 때문이다(2장). 유형을 모르면(삭제·이름바뀜)
// mm으로 잘못 보여주지 않도록 보수적으로 m을 돌려준다.
// damage 대신 이미 조회해 둔 type 객체를 받는다 — main.js의 속성 패널이 DEFAULT_DAMAGE_TYPE_ID로
// 대체한 type을 이미 들고 있어 그대로 넘길 수 있고, 2단계 표 생성기도 유형표를 조회한 뒤 쓰게 된다.
export function widthUnitOf(type) {
  return type && type.quantityUnit === 'm' ? 'mm' : 'm';
}

// 물량은 저장하지 않고 보여줄 때만 문자열로 만든다. 소수 넷째 자리에서 반올림하고 뒤의 0은 지운다
// (0.2 × 1.5 × 1이 0.30000000000000004로 보이지 않게). 정수도 최소한 소수 첫째 자리까지 표시한다 (1.0).
export function formatQuantity(value) {
  if (value === null || !Number.isFinite(value)) return '-';
  const rounded = Number(value.toFixed(3));
  const str = String(rounded);
  // 정수면 .0 붙이기
  if (!str.includes('.')) {
    return str + '.0';
  }
  return str;
}

// 도면 라벨의 둘째 줄: 치수 문구. width와 length가 모두 있을 때만 문자열을 만든다.
// 구분자는 물량 단위로 정한다: 'm' → '/', 'm2' → 'x'.
// 개소가 2 이상이면 뒤에 ' ${count}EA'를 붙인다.
export function dimensionTextOf(damage) {
  const measured = damage?.measured ?? {};
  const width = measured.width;
  const length = measured.length;
  const count = measured.count;

  // width나 length 중 하나라도 null이면 빈 문자열
  if (!isAmount(width) || !isAmount(length)) return '';

  const type = getDamageType(damage?.type);
  const separator = type && type.quantityUnit === 'm' ? '/' : 'x';
  const formattedWidth = formatQuantity(width);
  const formattedLength = formatQuantity(length);
  let result = `${formattedWidth}${separator}${formattedLength}`;

  // 개소가 2 이상이면 ' ${count}EA' 붙이기
  if (isCount(count) && count >= 2) {
    result += ` ${count}EA`;
  }

  return result;
}

// 도면 라벨의 첫 줄: 손상 이름. 폭 구간을 붙이지 않는다.
// statusTextOf와 다르다 — 구간이 붙은 이름은 물량표에서 쓴다.
// 예외: 균열(crack)은 이름을 아예 빼고 번호 원만 그린다(사내 망도 `(17) 0.2/1.5` 표기와 같음).
// 균열/백태(crack_efflorescence)는 같은 균열류(quantityUnit 'm')지만 이름을 그대로 둔다 —
// 근거: docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2.
export function drawingNameOf(damage) {
  const type = getDamageType(damage?.type);
  if (!type) return String(damage?.type ?? '');
  if (type.id === 'etc') {
    const written = typeof damage?.attrs?.statusText === 'string' ? damage.attrs.statusText.trim() : '';
    return written === '' ? type.label : written;
  }
  if (type.id === 'crack') return '';
  // 균열류(균열/백태 포함)도 구간 없이 유형 이름만 돌려준다
  return type.label;
}

// 사진번호 입력 문자열을 배열로 나눈다(설계 9.2). 쉼표로 나누고 앞뒤 공백을 지우고 빈 항목은
// 버린다. 같은 번호가 두 번 나오면 처음 나온 것만 남기고 순서는 그대로 둔다. 숫자로 바꾸지
// 않는다 — '012'를 숫자로 바꾸면 '12'가 되어 사진 파일 이름과 짝이 안 맞고, 'P-013' 같은
// 접두어 형식도 그대로 담아야 한다. text가 문자열이 아니면(null·undefined 포함) 빈 배열이다.
export function parsePhotoNumbers(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  const result = [];
  for (const raw of text.split(',')) {
    const trimmed = raw.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

// 도면 라벨의 사진 줄 문구(2026-09-16 설계 3장). 번호마다 '#'를 붙이고 ', '로 잇는다:
// ['12','13'] → '#12, #13'. 없거나 비어 있으면 빈 문자열. attrs가 없는 손상도 던지지 않는다.
// '사진 ' 접두어는 2026-09-16에 없앴다 — 사내 망도 표기가 '#001' 형식이다.
// 번호를 숫자로 바꾸지 않는다('012'·'P-013'을 그대로 둔다, 9.2).
export function photoTextOf(damage) {
  const photoNumbers = damage?.attrs?.photoNumbers;
  if (!Array.isArray(photoNumbers) || photoNumbers.length === 0) return '';
  return photoNumbers.map((value) => `#${value}`).join(', ');
}
