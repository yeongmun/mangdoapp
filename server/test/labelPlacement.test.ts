import { describe, expect, it } from 'vitest';
import {
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
  LABEL_GAP_MM,
} from '../public/viewer/overlay.js';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import { damageLabel, damageLabels, labelEntities } from '../src/export/labelPlacement.js';

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
  function layerOf(pairs: DxfPair[], text: string): { layer: string; color: string } {
    const start = pairs.findIndex((p) => p.code === 1 && p.value === text);
    // 코드 8(레이어)·62(색)는 같은 엔티티의 코드 1보다 앞에 있다.
    let layer = '';
    let color = '';
    for (let i = start; i >= 0; i--) {
      if (pairs[i].code === 62 && color === '') color = pairs[i].value.trim();
      if (pairs[i].code === 8 && layer === '') layer = pairs[i].value;
      if (pairs[i].code === 0) break;
    }
    return { layer, color };
  }

  it('원 하나와 글자들을 만들고 핸들을 하나씩 받는다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const alloc = new HandleAllocator(0x300);
    const pairs = labelEntities(label, alloc, '1F');

    expect(entityTypes(pairs)).toEqual(['CIRCLE', 'TEXT', 'TEXT', 'TEXT']);
    expect(pairs.filter((p) => p.code === 5).map((p) => p.value)).toEqual(['300', '301', '302', '303']);
    expect(alloc.seed).toBe('304');
    expect(pairs.filter((p) => p.code === 40).some((p) => p.value === '300.0')).toBe(true);
  });

  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
  it('사진 줄만 레이어 사진번호·색 2로 나가고 나머지는 신규손상·색 1이다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const pairs = labelEntities(label, new HandleAllocator(0x300), '1F');
    expect(layerOf(pairs, '#12, #13')).toEqual({ layer: '사진번호', color: '2' });
    expect(layerOf(pairs, '박락')).toEqual({ layer: '신규손상', color: '1' });
    expect(layerOf(pairs, '7')).toEqual({ layer: '신규손상', color: '1' });
  });

  // 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.4
  it('화살표가 있으면 LINE 3개를 신규손상 레이어에 더한다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const head: [Pt, Pt] = [[50, 50], [50, -50]];
    const withLeader = { ...label, leader: { from: [0, 0] as Pt, to: [100, 0] as Pt, head } };
    const pairs = labelEntities(withLeader, new HandleAllocator(0x300), '1F');
    expect(entityTypes(pairs).filter((t) => t === 'LINE')).toHaveLength(3);
    expect(layerOf(pairs, '박락').layer).toBe('신규손상');
  });

  it('기본 자리에 놓인 라벨에는 화살표가 없다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    expect(label.leader).toBeNull();
    expect(entityTypes(labelEntities(label, new HandleAllocator(0x300), '1F'))).not.toContain('LINE');
  });

  it('그릴 것이 없으면 빈 배열', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(labelEntities(label, new HandleAllocator(0x300), '1F')).toEqual([]);
  });
});

// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 4.2~4.3
describe('damageLabels', () => {
  function sideBySide(id: string, x: number) {
    const points: Pt[] = [[x, 0], [x + 1000, 0], [x + 1000, 400], [x, 400]];
    return {
      id,
      type: 'spalling',
      geometry: { kind: 'rect', world: points, dwg: points },
      measured: { width: 1.2, length: 1.5, count: 1 },
      attrs: { note: '', statusText: '', photoNumbers: [] },
    };
  }

  it('붙어 있는 손상 둘이면 2번 라벨이 위로 블록 높이(750)만큼 올라가고 화살표가 붙는다', () => {
    const a = sideBySide('a', 0);
    const b = sideBySide('b', 1050);
    const labels = damageLabels([
      { id: 'a', number: 1, damage: a },
      { id: 'b', number: 2, damage: b },
    ]);
    const first = labels.get('a')!.lines.find((l) => l.text === '1.2x1.5')!;
    const second = labels.get('b')!.lines.find((l) => l.text === '1.2x1.5')!;
    expect(second.position[1] - first.position[1]).toBeCloseTo(750, 6);
    expect(labels.get('a')!.leader).toBeNull();
    expect(labels.get('b')!.leader).not.toBeNull();
    expect(labels.get('b')!.leader!.to[1]).toBeCloseTo(400, 6); // 손상 윗변을 가리킨다
  });

  it('dwg가 없는 손상은 Map에 들어가지 않는다', () => {
    const labels = damageLabels([
      { id: 'a', number: 1, damage: { id: 'a', type: 'crack', geometry: { kind: 'polyline', world: RECT, dwg: null } } },
    ]);
    expect(labels.size).toBe(0);
  });

  // 근거: 2026-09-16-duplicate-damage-design.md 3.4/4장 — 복제본의 dwg 경계상자도 겹침 장애물이다.
  it('복제본 경계상자를 장애물로 넣어 라벨이 복제본 위로 가지 않는다', () => {
    const copyPoints: Pt[] = [[-5000, 450], [5000, 450], [5000, 6000], [-5000, 6000]];
    const measured = { width: 1.2, length: 1.5, count: 2 };
    const plain = damageLabels([{ id: 'r1', number: 1, damage: rect('spalling', measured) }]).get('r1')!;
    const blocked = damageLabels([
      { id: 'r1', number: 1, damage: { ...rect('spalling', measured), copies: [{ world: copyPoints, dwg: copyPoints }] } },
    ]).get('r1')!;

    // 막는 것이 없으면 도형 바로 위(y ≥ 500)다
    for (const line of plain.lines) expect(line.position[1]).toBeGreaterThan(400);
    // 복제본에 막히면 그 상자(y ≥ 450) 아래로 비켜난다
    for (const line of blocked.lines) expect(line.position[1]).toBeLessThan(450);
    expect(blocked.circle!.center[1]).toBeLessThan(450);
  });
});
