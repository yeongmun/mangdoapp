// 뷰어 안 손상현황표 패널의 **행 계산**(2026-10-07, 인프라스마트 태블릿 Pro의 "손상현황표"처럼 현장에서
// 바로 확인). DOM을 건드리지 않는 순수 함수라 vitest(server/test/statusTable.test.ts)가 검사한다.
// 번호·손상현황·물량은 화면 라벨·산출 DXF·원장과 **같은 함수**(quantities.js)로 구한다.
// 기존 손상(표에 이미 적힌 행)은 틀(frames[i].existing)에 실려 온 것을 그대로 앞에 둔다.

import { computeNumbers, formatQuantity, frameIndexOf, quantityOf, statusTextOf, unitOf } from './quantities.js';

/**
 * @typedef {{ source: 'existing' | 'app', id: string | null, no: number | null, location: string,
 *   status: string, width: string, length: string, count: string, quantity: string, unit: string,
 *   photos: string, note: string }} StatusRow
 */

function text(value) {
  return typeof value === 'number' && Number.isFinite(value) ? formatQuantity(value) : '';
}

function countText(value) {
  return Number.isInteger(value) ? String(value) : '';
}

/**
 * 틀 하나(pageIndex)의 현황표 행. 틀이 없는 도면(frames 비어 있음)은 pageIndex와 상관없이 전체.
 * 틀 밖 손상은 어느 페이지에도 나오지 않는다(번호가 없다 — 저장 배지 옆 경고가 따로 알린다).
 * @param {any[]} damages
 * @param {any[]} frames
 * @param {number} pageIndex
 * @returns {StatusRow[]}
 */
export function statusTableRows(damages, frames, pageIndex) {
  const list = Array.isArray(damages) ? damages : [];
  const frameList = Array.isArray(frames) ? frames : [];
  const numbers = computeNumbers(list, frameList);
  const frame = frameList[pageIndex];

  /** @type {StatusRow[]} */
  const rows = [];
  for (const r of Array.isArray(frame?.existing) ? frame.existing : []) {
    rows.push({
      source: 'existing',
      id: null,
      no: r.number,
      location: r.location ?? '',
      status: r.status ?? '',
      width: r.width ?? '',
      length: r.length ?? '',
      count: r.count ?? '',
      quantity: r.quantity ?? '',
      unit: r.unit ?? '',
      photos: '',
      note: r.note ?? '',
    });
  }

  const mine = list.filter((d) => (frameList.length === 0 ? true : frameIndexOf(d, frameList) === pageIndex));
  const appRows = mine
    .map((d) => ({
      source: /** @type {'app'} */ ('app'),
      id: String(d?.id ?? ''),
      no: numbers.get(String(d?.id)) ?? null,
      location: '',
      status: statusTextOf(d),
      width: text(d?.measured?.width),
      length: text(d?.measured?.length),
      count: countText(d?.measured?.count),
      quantity: text(quantityOf(d)),
      unit: unitOf(d) ?? '',
      photos: Array.isArray(d?.attrs?.photoNumbers) ? d.attrs.photoNumbers.join(', ') : '',
      note: typeof d?.attrs?.note === 'string' ? d.attrs.note : '',
    }))
    .sort((a, b) => (a.no ?? Infinity) - (b.no ?? Infinity));
  return rows.concat(appRows);
}

/**
 * 틀 하나의 합계: 손상현황별 물량 합(같은 단위끼리). 빈 물량은 빼고, 뺀 수를 missing에 센다.
 * @param {StatusRow[]} rows
 * @returns {{ status: string, unit: string, quantity: string, count: number }[]}
 */
export function statusTableTotals(rows) {
  const map = new Map();
  for (const r of rows) {
    const q = Number(r.quantity);
    if (r.quantity === '' || !Number.isFinite(q)) continue;
    const key = `${r.status}|${r.unit}`;
    const cur = map.get(key) ?? { status: r.status, unit: r.unit, sum: 0, count: 0 };
    cur.sum += q;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].map((t) => ({ status: t.status, unit: t.unit, quantity: formatQuantity(t.sum), count: t.count }));
}
