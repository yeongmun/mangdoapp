import { describe, expect, it } from 'vitest';
import type { FrameBounds } from '../src/export/frames.js';
import type { PhotoEntry } from '../src/photosStore.js';
import { frameLabelOf, sanitizeEntryName, zipEntryNamesFor } from '../src/photoZip.js';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';

// 손상 하나. world 중심 x가 번호 순서를 정하고(왼쪽이 앞), dwg 중심이 틀 배정을 정한다.
function damage(id: string, type: string, width: number, x: number, photoNumbers: string[]) {
  return {
    id,
    type,
    createdAt: '2026-09-18T01:00:00.000Z',
    geometry: {
      kind: 'polyline',
      world: [[x, 0], [x + 1, 0]],
      dwg: [[x, 0], [x + 1, 0]],
    },
    copies: [],
    measured: { width, length: 5, count: 1 },
    computed: { lengthDwg: 5, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers },
  };
}

function file(damageId: string, number: string, extension = '.jpg'): PhotoEntry {
  return { damageId, number, file: `${number}${extension}`, size: 10, savedAt: '2026-09-18T01:00:00.000Z' };
}

const NO_FRAMES: FrameBounds[] = [];

describe('sanitizeEntryName', () => {
  it('파일 이름에 쓸 수 없는 글자를 _로 바꾼다', () => {
    expect(sanitizeEntryName('균열/백태(0.5mm이상)')).toBe('균열_백태(0.5mm이상)');
    expect(sanitizeEntryName('a:b*c?d"e<f>g|h')).toBe('a_b_c_d_e_f_g_h');
  });

  it('바꿀 글자가 없으면 그대로 둔다', () => {
    expect(sanitizeEntryName('균열(0.3mm미만)')).toBe('균열(0.3mm미만)');
  });
});

describe('zipEntryNamesFor', () => {
  it('사진번호 칸에 있고 파일도 있는 것만 손상 이름으로 넣는다', () => {
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530', '999'])];
    const names = zipEntryNamesFor(damages, NO_FRAMES, [file(D1, '101530')]).map((e) => e.name);
    // 틀이 없는 도면은 망도틀 번호 자리가 000이다(2026-09-30 이름 규칙).
    expect(names).toEqual(['000_균열(0.3mm미만)_101530.jpg']);
  });

  it('번호·손상현황·확장자를 그대로 쓰고, 칸에 없는 파일은 미연결로 넣는다', () => {
    const damages = [
      damage(D1, 'crack', 0.2, 0, ['101530', '999']),
      damage(D2, 'crack_efflorescence', 0.6, 10, ['101600']),
    ];
    const files = [file(D1, '101530'), file(D1, '777', '.png'), file(D2, '101600'), file(D3, '88')];

    expect(zipEntryNamesFor(damages, NO_FRAMES, files).map((e) => e.name)).toEqual([
      '000_균열(0.3mm미만)_101530.jpg',
      '미연결_11111111_777.png',
      '000_균열_백태(0.5mm이상)_101600.jpg',
      '삭제된손상_33333333_88.jpg',
    ]);
  });

  it('돌려주는 항목은 어느 파일인지도 함께 들고 있다', () => {
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530'])];
    const entry = file(D1, '101530');
    expect(zipEntryNamesFor(damages, NO_FRAMES, [entry])).toEqual([{ name: '000_균열(0.3mm미만)_101530.jpg', entry }]);
  });

  it('틀 밖 손상은 망도틀 번호 자리가 X다', () => {
    const frames: FrameBounds[] = [{ minX: -5, minY: -5, maxX: 5, maxY: 5 }];
    const damages = [
      damage(D1, 'crack', 0.2, 0, ['101530']),
      damage(D2, 'crack_efflorescence', 0.6, 10, ['101600']),
    ];
    expect(zipEntryNamesFor(damages, frames, [file(D1, '101530'), file(D2, '101600')]).map((e) => e.name)).toEqual([
      '001_균열(0.3mm미만)_101530.jpg',
      'X_균열_백태(0.5mm이상)_101600.jpg',
    ]);
  });

  it('망도틀 번호는 틀 순서대로 001, 002 — 다른 틀의 같은 사진번호는 겹치지 않는다', () => {
    const frames: FrameBounds[] = [
      { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      { minX: 9, minY: -5, maxX: 12, maxY: 5 },
    ];
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530']), damage(D2, 'crack', 0.2, 10, ['101530'])];
    expect(zipEntryNamesFor(damages, frames, [file(D1, '101530'), file(D2, '101530')]).map((e) => e.name)).toEqual([
      '001_균열(0.3mm미만)_101530.jpg',
      '002_균열(0.3mm미만)_101530.jpg',
    ]);
  });

  it('손상이 하나도 없으면 전부 삭제된손상이다', () => {
    expect(zipEntryNamesFor([], NO_FRAMES, [file(D1, '101530')]).map((e) => e.name)).toEqual([
      '삭제된손상_11111111_101530.jpg',
    ]);
  });

  it('파일이 없는 손상은 아무 항목도 만들지 않는다', () => {
    expect(zipEntryNamesFor([damage(D1, 'crack', 0.2, 0, ['101530'])], NO_FRAMES, [])).toEqual([]);
  });
});

describe('frameLabelOf', () => {
  it('틀 안이면 세 자리 번호, 틀 밖이면 X, 틀이 없으면 000', () => {
    const frames: FrameBounds[] = [
      { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      { minX: 9, minY: -5, maxX: 12, maxY: 5 },
    ];
    expect(frameLabelOf(damage(D1, 'crack', 0.2, 0, []), frames)).toBe('001');
    expect(frameLabelOf(damage(D2, 'crack', 0.2, 10, []), frames)).toBe('002');
    expect(frameLabelOf(damage(D3, 'crack', 0.2, 100, []), frames)).toBe('X');
    expect(frameLabelOf(damage(D1, 'crack', 0.2, 0, []), [])).toBe('000');
  });

  it('같은 틀·같은 손상현황·같은 사진번호가 겹치면 뒤에 (2)를 붙인다', () => {
    const frames: FrameBounds[] = [{ minX: -5, minY: -5, maxX: 12, maxY: 5 }];
    const damages = [damage(D1, 'crack', 0.2, 0, ['101530']), damage(D2, 'crack', 0.2, 10, ['101530'])];
    expect(zipEntryNamesFor(damages, frames, [file(D1, '101530'), file(D2, '101530')]).map((e) => e.name)).toEqual([
      '001_균열(0.3mm미만)_101530.jpg',
      '001_균열(0.3mm미만)_101530 (2).jpg',
    ]);
  });
});
