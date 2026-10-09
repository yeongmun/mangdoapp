import { describe, expect, it } from 'vitest';
import { rasterPlan, rasterizeStrokes, strokesBounds } from '../public/viewer/ink.js';

describe('ink — 손글씨 획을 인식용 그림으로', () => {
  it('둘레 상자', () => {
    expect(strokesBounds([[[10, 20], [30, 5]], [[0, 50]]])).toEqual({ minX: 0, minY: 5, maxX: 30, maxY: 50 });
    expect(strokesBounds([])).toBeNull();
  });
  it('작은 글씨는 최소 높이 160px까지 키우고 여백 24px을 둔다', () => {
    const plan = rasterPlan({ minX: 100, minY: 100, maxX: 180, maxY: 120 });
    expect(plan.scale).toBe(8);
    expect(plan.width).toBe((80 + 48) * 8);
    expect(plan.height).toBe((20 + 48) * 8);
    expect(plan.offsetX).toBe(76);
  });
  it('너무 넓으면 너비 1200px에 맞춘다', () => {
    const plan = rasterPlan({ minX: 0, minY: 0, maxX: 2000, maxY: 10 });
    expect(plan.width).toBeLessThanOrEqual(1200);
    expect(plan.scale).toBeLessThan(1);
  });
  it('가짜 canvas에 흰 바탕·검은 선으로 그린다', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, name) => (..._args: unknown[]) => { calls.push(String(name)); } }) as unknown as CanvasRenderingContext2D;
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const out = rasterizeStrokes([[[0, 0], [10, 10]], [[5, 5]]], canvas);
    expect(out).toBe(canvas);
    expect(canvas.width).toBeGreaterThan(0);
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2);
    expect(calls[0]).toBe('fillRect');
    expect(rasterizeStrokes([], canvas)).toBeNull();
  });
});
