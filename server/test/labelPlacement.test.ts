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
    expect(label.lines).toHaveLength(3); // 번호 + 이름 + 치수
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    // 베이스라인은 400 + 100, 중간 정렬점은 거기서 글자 높이 × 0.35 위
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.align).toBe('left');
  });

  it('윗줄은 한 줄 간격(글자 높이 × 1.3)만큼 위에 있다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(name.position[1] - dimension.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('번호 원의 반지름은 글자 높이 × 0.85이고 중심은 첫 줄과 같은 높이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(label.circle!.radius).toBeCloseTo(FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR, 6);
    expect(label.circle!.center[1]).toBeCloseTo(name.position[1], 6);
    expect(label.circle!.center[0]).toBeLessThan(name.position[0]);
  });

  it('번호 글자는 원 가운데, 첫 줄 글자는 원 오른쪽에서 왼쪽 정렬이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const number = label.lines.find((l) => l.text === '7')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(number.align).toBe('center');
    expect(number.position[0]).toBeCloseTo(label.circle!.center[0], 6);
    expect(name.align).toBe('left');
  });

  // 근거: 2026-09-16 설계 2장 — 균열은 A = 치수라 원 옆에 치수가 붙는다.
  it('균열은 치수가 원 옆 첫 줄이고 치수 줄을 또 그리지 않는다', () => {
    const label = damageLabel(rect('crack', { width: 0.2, length: 1.5, count: 1 }), 3)!;
    expect(label.lines.map((l) => l.text)).toEqual(['3', '0.2/1.5']);
    const dimension = label.lines.find((l) => l.text === '0.2/1.5')!;
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.key).toBe('dimension');
  });

  it('둘째 줄부터 첫 줄 글자의 x에 맞춰 들여쓴다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const name = label.lines.find((l) => l.text === '박락')!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const photo = label.lines.find((l) => l.text === '#12, #13')!;
    expect(dimension.position[0]).toBeCloseTo(name.position[0], 6);
    expect(photo.position[0]).toBeCloseTo(name.position[0], 6);
  });

  it('사진번호가 있으면 맨 아래 줄이 사진 줄이고 key가 photo다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const photo = label.lines.find((l) => l.text === '#12, #13')!;
    expect(photo.key).toBe('photo');
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    expect(dimension.position[1] - photo.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('치수가 없으면 사진 줄이 그 자리로 올라온다 — 빈 줄을 남기지 않는다', () => {
    const label = damageLabel(rect('spalling', {}, { photoNumbers: ['12'] }), 7)!;
    expect(label.lines.map((l) => l.text)).toEqual(['7', '박락', '#12']);
    const photo = label.lines.find((l) => l.text === '#12')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
  });

  it('번호가 없고 이름도 치수도 없으면 그릴 것이 없다', () => {
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
