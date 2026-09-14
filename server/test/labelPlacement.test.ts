import { describe, expect, it } from 'vitest';
import {
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
  LABEL_GAP_MM,
} from '../public/viewer/overlay.js';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import { damageLabel, labelEntities } from '../src/export/labelPlacement.js';

type Pt = [number, number];

// 가로 0..1000, 세로 0..400 사각형. 위쪽 경계는 y = 400, 가로 가운데는 x = 500.
const RECT: Pt[] = [[0, 0], [1000, 0], [1000, 400], [0, 400]];

function rect(type: string, measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    type,
    geometry: { kind: 'rect', world: RECT, dwg: RECT },
    measured: { width: null, length: null, count: null, ...measured },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}

function entityTypes(pairs: DxfPair[]): string[] {
  return pairs.filter((p) => p.code === 0).map((p) => p.value);
}

describe('damageLabel', () => {
  it('dwg가 없으면 null', () => {
    const damage = { id: 'a', type: 'crack', geometry: { kind: 'polyline', world: RECT, dwg: null } };
    expect(damageLabel(damage, 1)).toBeNull();
  });

  it('맨 아래 줄이 도형 위쪽 경계에서 100만큼 떨어진 자리다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    // 줄이 둘(이름줄, 치수줄)이고 맨 아래가 치수줄이다.
    expect(label.lines).toHaveLength(3); // 번호 + 이름 + 치수
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    // 베이스라인은 400 + 100, 중간 정렬점은 거기서 글자 높이 × 0.35 위
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.position[0]).toBeCloseTo(500, 6);
    expect(dimension.align).toBe('center');
  });

  it('윗줄은 한 줄 간격(글자 높이 × 1.3)만큼 위에 있다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(name.position[1] - dimension.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('번호 원의 반지름은 글자 높이 × 0.85이고 중심은 이름줄과 같은 높이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(label.circle).not.toBeNull();
    expect(label.circle!.radius).toBeCloseTo(FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR, 6);
    expect(label.circle!.center[1]).toBeCloseTo(name.position[1], 6);
    expect(label.circle!.center[0]).toBeLessThan(name.position[0]);
  });

  it('번호 글자는 원 가운데, 이름은 원 오른쪽에서 왼쪽 정렬이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const number = label.lines.find((l) => l.text === '7')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(number.align).toBe('center');
    expect(number.position[0]).toBeCloseTo(label.circle!.center[0], 6);
    expect(name.align).toBe('left');
  });

  it('균열은 이름 없이 번호 원만 그린다', () => {
    const label = damageLabel(rect('crack', { width: 0.2, length: 1.5, count: 1 }), 3)!;
    expect(label.lines.map((l) => l.text)).toEqual(['3', '0.2/1.5']);
    expect(label.circle!.center[0]).toBeCloseTo(500, 6);
  });

  it('사진번호가 있으면 맨 아래 줄이 사진 줄이다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const photo = label.lines.find((l) => l.text === '사진 12, 13')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    expect(dimension.position[1] - photo.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('치수가 없으면 사진 줄이 그 자리로 올라온다 — 빈 줄을 남기지 않는다', () => {
    const label = damageLabel(rect('spalling', {}, { photoNumbers: ['12'] }), 7)!;
    expect(label.lines.map((l) => l.text)).toEqual(['7', '박락', '사진 12']);
    const photo = label.lines.find((l) => l.text === '사진 12')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
  });

  it('번호가 없고 이름도 없으면 그릴 것이 없다', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(label.circle).toBeNull();
    expect(label.lines).toEqual([]);
  });

  it('글자 높이는 300이다', () => {
    expect(damageLabel(rect('spalling', {}), 1)!.height).toBe(300);
  });
});

describe('labelEntities', () => {
  it('원 하나와 글자들을 만들고 핸들을 하나씩 받는다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const alloc = new HandleAllocator(0x300);
    const pairs = labelEntities(label, alloc, '1F');

    expect(entityTypes(pairs)).toEqual(['CIRCLE', 'TEXT', 'TEXT', 'TEXT']);
    expect(pairs.filter((p) => p.code === 5).map((p) => p.value)).toEqual(['300', '301', '302', '303']);
    expect(alloc.seed).toBe('304');
    expect(pairs.filter((p) => p.code === 8).every((p) => p.value === '신규손상')).toBe(true);
    expect(pairs.filter((p) => p.code === 40).some((p) => p.value === '300.0')).toBe(true);
  });

  it('그릴 것이 없으면 빈 배열', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(labelEntities(label, new HandleAllocator(0x300), '1F')).toEqual([]);
  });
});
