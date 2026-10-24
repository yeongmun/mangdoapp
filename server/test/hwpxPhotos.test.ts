// hwpx(zip) 안 사진·캡션 추출. 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 2
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractPhotoBlocks, memberOfCaption } from '../src/hwpxPhotos.js';
import { readZipEntries } from '../src/zipRead.js';

// 최소 zip 조립(로컬 헤더 + 중앙 디렉터리 + EOCD). CRC는 서버가 검사하지 않으므로 0.
export function makeZip(entries: Record<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(entries)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    const deflated = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // utf8 이름
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localAll = Buffer.concat([local, nameBuf, deflated]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    locals.push(localAll);
    offset += localAll.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function hpf(items: Record<string, string>): string {
  const lines = Object.entries(items).map(
    ([id, href]) => `<opf:item id="${id}" href="${href}" media-type="${href.endsWith('.png') ? 'image/png' : href.endsWith('.emf') ? 'image/x-emf' : 'image/jpeg'}"/>`,
  );
  return `<?xml version="1.0"?><opf:package xmlns:opf="x"><opf:manifest>${lines.join('')}</opf:manifest></opf:package>`;
}
const img = (id: string) => `<hp:pic id="1"><hc:img binaryItemIDRef="${id}" bright="0"/></hp:pic>`;
const t = (s: string) => `<hp:p id="2" paraPrIDRef="0"><hp:run><hp:t>${s}</hp:t></hp:run></hp:p>`;
const tc = (inner: string) => `<hp:tc name="" header="0"><hp:subList>${inner}</hp:subList></hp:tc>`;
const tbl = (inner: string) => `<hp:tbl id="9" pageBreak="CELL"><hp:tr>${inner}</hp:tr></hp:tbl>`;
const section = (body: string) => `<?xml version="1.0"?><hs:sec xmlns:hs="x" xmlns:hp="y" xmlns:hc="z">${body}</hs:sec>`;

function hwpx(sectionBody: string, bin: Record<string, Buffer> = { image1: PNG, image2: PNG }, ext = '.png'): Buffer {
  const items: Record<string, string> = {};
  const files: Record<string, Buffer | string> = {};
  for (const [id, data] of Object.entries(bin)) {
    items[id] = `BinData/${id}${ext}`;
    files[`BinData/${id}${ext}`] = data;
  }
  files['Contents/content.hpf'] = hpf(items);
  files['Contents/section0.xml'] = section(sectionBody);
  return makeZip(files);
}

describe('readZipEntries', () => {
  it('deflate 항목을 이름으로 돌려준다', () => {
    const zip = makeZip({ 'a.txt': 'hello', 'b/c.bin': Buffer.from([1, 2, 3]) });
    const entries = readZipEntries(zip);
    expect(entries.get('a.txt')?.toString()).toBe('hello');
    expect([...entries.get('b/c.bin')!]).toEqual([1, 2, 3]);
  });
});

describe('extractPhotoBlocks', () => {
  it('표 안 그림 2장과 뒤따르는 캡션을 페이지 하나로', () => {
    const doc = hwpx(tbl(tc(t('') + img('image1')) + tc(t('사진 1. 교각 P1 균열')) + tc(img('image2')) + tc(t('사진 2. 교대 A1 백태'))));
    const { blocks, skipped } = extractPhotoBlocks(doc);
    expect(skipped).toBe(0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].page).toBe('pg_001');
    expect(blocks[0].images.map((i) => [i.ref, i.ext, i.caption])).toEqual([
      ['image1', '.png', '사진 1. 교각 P1 균열'],
      ['image2', '.png', '사진 2. 교대 A1 백태'],
    ]);
    expect(blocks[0].images[0].data.equals(PNG)).toBe(true);
  });

  it('중첩 표의 그림은 한 번만, 표 두 개면 페이지 두 개', () => {
    const inner = tbl(tc(img('image1')) + tc(t('안쪽')));
    const doc = hwpx(tbl(tc(inner)) + tbl(tc(img('image2')) + tc(t('둘째'))));
    const { blocks } = extractPhotoBlocks(doc);
    expect(blocks.map((b) => [b.page, b.images.length])).toEqual([
      ['pg_001', 1],
      ['pg_002', 1],
    ]);
    expect(blocks[0].images[0].caption).toBe('안쪽');
  });

  it('캡션 없는 그림은 null, 줄바꿈·탭·엔티티는 정리', () => {
    const doc = hwpx(tbl(tc(img('image1'))) + tbl(tc(img('image2')) + tc(t('사진 2.\n\t교대 &lt;A1&gt;'))));
    const { blocks } = extractPhotoBlocks(doc);
    expect(blocks[0].images[0].caption).toBeNull();
    expect(blocks[1].images[0].caption).toBe('사진 2. 교대 <A1>');
  });

  it('그림 뒤에 글이 없으면 앞 글을 캡션으로', () => {
    const doc = hwpx(tbl(tc(t('전경 사진')) + tc(img('image1'))), { image1: PNG });
    expect(extractPhotoBlocks(doc).blocks[0].images[0].caption).toBe('전경 사진');
  });

  it('표 밖 그림은 같은 문단의 글이 캡션이고 그림마다 페이지', () => {
    const doc = hwpx(`<hp:p><hp:run>${img('image1')}</hp:run><hp:run><hp:t>본문 그림</hp:t></hp:run></hp:p>` + t('다음 문단') + `<hp:p><hp:run>${img('image2')}</hp:run></hp:p>`);
    const { blocks } = extractPhotoBlocks(doc);
    expect(blocks.map((b) => [b.page, b.images[0].caption])).toEqual([
      ['pg_001', '본문 그림'],
      ['pg_002', null],
    ]);
  });

  it('그림이 없는 표는 페이지가 아니다', () => {
    const doc = hwpx(tbl(tc(t('글만')) + tc(t('있음'))) + tbl(tc(img('image1'))), { image1: PNG });
    expect(extractPhotoBlocks(doc).blocks.map((b) => b.page)).toEqual(['pg_001']);
  });

  it('emf는 건너뛰고 skipped에 센다', () => {
    const doc = hwpx(tbl(tc(img('image1')) + tc(img('image2'))), { image1: PNG, image2: Buffer.from('emf') }, '.emf');
    const { blocks, skipped } = extractPhotoBlocks(doc);
    expect(skipped).toBe(2);
    expect(blocks).toHaveLength(0);
  });

  it('섹션이 여러 개면 이름순으로 이어 붙인다', () => {
    const files = {
      'Contents/content.hpf': hpf({ image1: 'BinData/image1.png', image2: 'BinData/image2.png' }),
      'Contents/section1.xml': section(tbl(tc(img('image2')))),
      'Contents/section0.xml': section(tbl(tc(img('image1')))),
      'BinData/image1.png': PNG,
      'BinData/image2.png': PNG,
    };
    expect(extractPhotoBlocks(makeZip(files)).blocks.map((b) => b.images[0].ref)).toEqual(['image1', 'image2']);
  });
});

describe('memberOfCaption', () => {
  it('첫 어절이 부재 단어면 그것, 아니면 전차', () => {
    expect(memberOfCaption('교각 P1 균열')).toBe('교각');
    expect(memberOfCaption('사진 3. 교대 A1')).toBe('교대');
    expect(memberOfCaption('사진 3')).toBe('전차');
    expect(memberOfCaption(null)).toBe('전차');
    expect(memberOfCaption('난간·방호벽 파손')).toBe('난간·방호벽');
  });
});
