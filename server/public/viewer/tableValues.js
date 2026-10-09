// 손상물량표 칸에 들어갈 글자(2026-10-09). 뷰어(overlay.js — 표 칸 위에 바로 보여 준다)와
// 산출(server/src/export/tableFill.ts — DXF 표 셀에 쓴다)이 **같은 글자**를 내야 하므로 여기 한 곳에 둔다.
// 순수 함수라 vitest가 검사한다.

import { quantityOf, statusTextOf, unitOf } from './quantities.js';

/** 표 칸의 치수·물량은 소수점 둘째 자리까지 고정(1.5 → 1.50, 2 → 2.00). 개소는 정수 그대로. 사용자 요청 2026-10-02 */
export const TABLE_AMOUNT_DECIMALS = 2;

/** @type {(value: number) => string} */
export function formatTableAmount(value) {
  // 0.245처럼 이진수로 딱 떨어지지 않는 값은 toFixed가 0.24로 내려 버린다 — 유효숫자 12자리로
  // 한 번 다듬은 뒤 반올림해 사람이 기대하는 0.25가 나오게 한다.
  const scale = 10 ** TABLE_AMOUNT_DECIMALS;
  const rounded = Math.round(Number((value * scale).toPrecision(12))) / scale;
  return rounded.toFixed(TABLE_AMOUNT_DECIMALS);
}

function amountText(value) {
  return Number.isFinite(value) && value >= 0 ? formatTableAmount(value) : '';
}

function countText(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : '';
}

export const TABLE_VALUE_FIELDS = ['status', 'width', 'length', 'count', 'quantity', 'unit'];

/**
 * 손상 하나의 값 칸 글자. 번호·손상위치는 없다(번호는 표에 인쇄돼 있고 손상위치는 캐드에서 적는다).
 * @type {(damage: any) => { status: string, width: string, length: string, count: string, quantity: string, unit: string }}
 */
export function tableValuesOf(damage) {
  const measured = damage?.measured ?? {};
  const quantity = quantityOf(damage);
  return {
    status: statusTextOf(damage),
    width: amountText(measured.width),
    length: amountText(measured.length),
    count: countText(measured.count),
    quantity: quantity === null ? '' : formatTableAmount(quantity),
    unit: unitOf(damage) ?? '',
  };
}

/**
 * 뷰어가 표 칸 위에 그릴 글자 목록. 틀(frames[i].table)이 있는 도면에서 번호를 받은 신규 손상마다
 * 그 번호의 데이터 행(기존 행 다음부터 이어진 번호 그대로)에 값 칸 글자를 놓는다.
 * 표 용량(rowCount)을 넘는 번호는 뺀다 — 산출은 넘침 표를 따로 만들지만 화면에는 그 표가 없다.
 * @param {any[]} damages
 * @param {Map<string, number>} numbers  computeNumbers 결과
 * @param {any[]} frames
 * @param {(damage: any) => number | null} frameOf  손상이 속한 틀 순번
 * @returns {{ id: string, dwg: [number, number], text: string, field: string, cellWidth: number, textHeight: number }[]}
 */
export function tableCellTexts(damages, numbers, frames, frameOf) {
  const out = [];
  for (const damage of Array.isArray(damages) ? damages : []) {
    const number = numbers.get(String(damage?.id));
    if (!Number.isInteger(number)) continue;
    const frameIndex = frames.length === 0 ? null : frameOf(damage);
    if (frameIndex === null) continue;
    const table = frames[frameIndex]?.table;
    if (!table || number < 1 || number > table.rowCount) continue;
    const y = table.rowY[number - 1];
    if (!Number.isFinite(y)) continue;
    const values = tableValuesOf(damage);
    for (const field of TABLE_VALUE_FIELDS) {
      const column = table.columns[field];
      const text = values[field];
      if (!column || text === '') continue;
      out.push({ id: String(damage.id), dwg: [column.x, y], text, field, cellWidth: column.width, textHeight: table.textHeight });
    }
  }
  return out;
}
