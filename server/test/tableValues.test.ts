import { describe, expect, it } from 'vitest';
import { computeNumbers } from '../public/viewer/quantities.js';
import { frameIndexOf } from '../public/viewer/quantities.js';
import { formatTableAmount, tableCellTexts, tableValuesOf } from '../public/viewer/tableValues.js';

function damage(id: string, type: string, dwg: [number, number][], measured: Record<string, number | null>) {
  return {
    id, type, createdAt: '2026-10-09T00:00:00.000Z',
    geometry: { kind: type === 'crack' ? 'polyline' : 'rect', world: dwg, dwg }, copies: [],
    measured: { width: null, length: null, count: null, ...measured }, computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}
const LEFT: [number, number][] = [[100, 100], [200, 100], [200, 200], [100, 200]];

describe('tableValuesOf — 산출 표 셀과 같은 글자', () => {
  it('소수 둘째 자리·정수 개소·물량·단위', () => {
    expect(tableValuesOf(damage('a', 'spalling', LEFT, { width: 1.5, length: 2, count: 3 }))).toEqual({
      status: '박락', width: '1.50', length: '2.00', count: '3', quantity: '9.00', unit: '㎡',
    });
    expect(formatTableAmount(0.245)).toBe('0.25');
  });
  it('빈 값은 빈 글자', () => {
    expect(tableValuesOf(damage('a', 'crack', [[0, 0], [10, 0]], {}))).toMatchObject({ width: '', length: '', count: '', quantity: '', unit: 'm' });
  });
});

describe('tableCellTexts — 뷰어가 표 칸에 그릴 글자', () => {
  const table = {
    rowCount: 2,
    textHeight: 2.5,
    columns: { status: { x: 500, width: 100 }, width: { x: 600, width: 40 }, quantity: { x: 700, width: 40 } },
    rowY: [900, 880],
  };
  const frames = [{ minX: 0, minY: 0, maxX: 1000, maxY: 1000, startNumber: 1, table }];
  const frameOf = (d: unknown) => frameIndexOf(d, frames);

  it('번호 행(기존 행 다음부터)에 값 열마다 글자를 놓는다. 없는 열·빈 값은 건너뛴다', () => {
    const damages = [damage('a', 'spalling', LEFT, { width: 1, length: 2, count: 1 })];
    const cells = tableCellTexts(damages, computeNumbers(damages, frames), frames, frameOf);
    // startNumber 1 → 이 손상은 2번 → rowY[1]
    expect(cells.map((c) => [c.field, c.text, c.dwg])).toEqual([
      ['status', '박락', [500, 880]],
      ['width', '1.00', [600, 880]],
      ['quantity', '2.00', [700, 880]],
    ]);
    expect(cells[0]).toMatchObject({ id: 'a', cellWidth: 100, textHeight: 2.5 });
  });
  it('표 용량을 넘는 번호·틀 밖·표 없는 틀은 그리지 않는다', () => {
    const many = [1, 2, 3].map((i) => damage(`d${i}`, 'spalling', LEFT.map(([x, y]) => [x + i * 10, y]) as [number, number][], { width: 1, length: 1, count: 1 }));
    const cells = tableCellTexts(many, computeNumbers(many, frames), frames, frameOf);
    // 번호 2만 용량(2) 안 — 3·4는 뺀다
    expect(cells.map((c) => c.id)).toEqual(['d1', 'd1', 'd1']);
    const outside = [damage('o', 'spalling', [[1500, 100], [1600, 100], [1600, 200], [1500, 200]], { width: 1, length: 1, count: 1 })];
    expect(tableCellTexts(outside, computeNumbers(outside, frames), frames, frameOf)).toEqual([]);
    const noTable = [{ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }];
    const d = [damage('a', 'spalling', LEFT, { width: 1, length: 1, count: 1 })];
    expect(tableCellTexts(d, computeNumbers(d, noTable), noTable, (x) => frameIndexOf(x, noTable))).toEqual([]);
  });
});
