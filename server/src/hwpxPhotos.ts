// 한글 hwpx에서 사진과 캡션을 "페이지" 단위로 뽑는다(2026-10-24, 3단계). 순수 함수 — 파일·DB를 모른다.
// 페이지 = 그림이 든 표(hp:tbl) 하나. 표 밖 그림은 그림 하나가 페이지 하나. (사용자: "대부분 표 안에 그림")
// XML 파서를 쓰지 않고 필요한 태그(hp:tbl·hp:p·hc:img·hp:t)만 순서대로 훑는다 — hwpx 섹션은 수 MB이고
// 우리가 쓰는 건 그림 참조와 글뿐이다. 캡션 규칙: 그림 뒤 첫 글(다음 그림 전까지), 없으면 앞 글.
// 설계: docs/design/2026-10-24-field-photo-checklist.md 결정 2
import { readZipEntries } from './zipRead.js';

export interface PhotoImage {
  /** content.hpf의 item id (binaryItemIDRef) */
  ref: string;
  ext: '.png' | '.jpg' | '.gif' | '.bmp';
  data: Buffer;
  caption: string | null;
}

export interface PhotoBlock {
  /** pg_001 부터 */
  page: string;
  /** 이 페이지(표)의 글 전부(순서대로) */
  texts: string[];
  images: PhotoImage[];
}

const IMAGE_EXT: Record<string, PhotoImage['ext']> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};

/** 캡션 첫 어절이 이 중 하나면 부재로 본다(파일명의 가운데 토막). 아니면 '전차' */
export const MEMBER_WORDS = [
  '전경', '교대', '교각', '거더', '바닥판', '슬래브', '신축이음', '교량받침', '받침', '난간·방호벽', '난간', '방호벽', '배수', '포장',
  '옹벽', '터널', '라이닝', '측벽', '천장', '기초', '날개벽', '기타',
];

export function memberOfCaption(caption: string | null): string {
  if (!caption) return '전차';
  // "사진 3." 같은 머리는 떼고 본다
  const stripped = caption.replace(/^(사진|그림)\s*[\d-]+\s*[.:)]?\s*/u, '').trim();
  const first = stripped.split(/[\s,:/]+/u)[0] ?? '';
  const hit = MEMBER_WORDS.find((w) => first === w || first.startsWith(w));
  return hit ?? '전차';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function cleanText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** content.hpf → binaryItemIDRef → { href, mediaType } */
function manifestOf(entries: Map<string, Buffer>): Map<string, { href: string; mediaType: string }> {
  const out = new Map<string, { href: string; mediaType: string }>();
  const hpf = [...entries.entries()].find(([name]) => name.toLowerCase().endsWith('content.hpf'));
  if (!hpf) return out;
  const xml = hpf[1].toString('utf8');
  const itemRe = /<opf:item\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const attrs = m[1];
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1];
    const href = /\bhref="([^"]*)"/.exec(attrs)?.[1];
    const mediaType = /\bmedia-type="([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (id && href) out.set(id, { href, mediaType });
  }
  return out;
}

type Token = { kind: 'tblOpen' | 'tblClose' | 'pOpen' | 'pClose' | 'img' | 'text'; value: string; index: number };

/** 섹션 XML을 토큰(표 열림/닫힘, 문단 열림/닫힘, 그림, 글)으로 */
function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  const re = /<(\/?)(hp:tbl|hp:p|hc:img|hp:t)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    const attrs = m[3];
    const selfClosing = m[4] === '/';
    if (tag === 'hp:tbl') tokens.push({ kind: closing ? 'tblClose' : 'tblOpen', value: '', index: m.index });
    else if (tag === 'hp:p') {
      if (closing) tokens.push({ kind: 'pClose', value: '', index: m.index });
      else if (!selfClosing) tokens.push({ kind: 'pOpen', value: '', index: m.index });
    } else if (tag === 'hc:img' && !closing) {
      const ref = /\bbinaryItemIDRef="([^"]*)"/.exec(attrs)?.[1];
      if (ref) tokens.push({ kind: 'img', value: ref, index: m.index });
    } else if (tag === 'hp:t' && !closing && !selfClosing) {
      const end = xml.indexOf('</hp:t>', re.lastIndex);
      if (end === -1) continue;
      const text = cleanText(xml.slice(re.lastIndex, end));
      if (text !== '') tokens.push({ kind: 'text', value: text, index: m.index });
      re.lastIndex = end;
    }
  }
  return tokens;
}

interface RawBlock {
  items: { kind: 'img' | 'text'; value: string }[];
}

/** 토큰을 페이지 후보(표 하나 / 표 밖 그림이 든 문단 하나)로 묶는다 */
function groupBlocks(tokens: Token[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let depth = 0;
  let current: RawBlock | null = null; // 깊이 0에서 열린 표
  let para: RawBlock | null = null; // 표 밖 문단
  for (const token of tokens) {
    if (token.kind === 'tblOpen') {
      if (depth === 0) current = { items: [] };
      depth += 1;
      continue;
    }
    if (token.kind === 'tblClose') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && current) {
        blocks.push(current);
        current = null;
      }
      continue;
    }
    if (depth > 0 && current) {
      if (token.kind === 'img' || token.kind === 'text') current.items.push({ kind: token.kind, value: token.value });
      continue;
    }
    // 표 밖
    if (token.kind === 'pOpen') {
      para = { items: [] };
      continue;
    }
    if (token.kind === 'pClose') {
      if (para && para.items.some((i) => i.kind === 'img')) blocks.push(para);
      para = null;
      continue;
    }
    if (para && (token.kind === 'img' || token.kind === 'text')) para.items.push({ kind: token.kind, value: token.value });
  }
  if (current) blocks.push(current);
  return blocks;
}

/** 그림 뒤 첫 글(다음 그림 전까지) → 없으면 앞 글(이전 그림 뒤부터) */
function captionsOf(items: RawBlock['items']): { ref: string; caption: string | null }[] {
  const out: { ref: string; caption: string | null }[] = [];
  const imgIdx = items.map((it, i) => (it.kind === 'img' ? i : -1)).filter((i) => i !== -1);
  imgIdx.forEach((at, k) => {
    const nextImg = imgIdx[k + 1] ?? items.length;
    const prevImg = imgIdx[k - 1] ?? -1;
    const after = items.slice(at + 1, nextImg).find((it) => it.kind === 'text');
    const before = items
      .slice(prevImg + 1, at)
      .reverse()
      .find((it) => it.kind === 'text');
    out.push({ ref: items[at].value, caption: after?.value ?? before?.value ?? null });
  });
  return out;
}

export function extractPhotoBlocks(hwpx: Buffer): { blocks: PhotoBlock[]; skipped: number } {
  const entries = readZipEntries(hwpx);
  const manifest = manifestOf(entries);
  const sectionNames = [...entries.keys()].filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const blocks: PhotoBlock[] = [];
  let skipped = 0;
  let pageNo = 0;
  for (const name of sectionNames) {
    const xml = entries.get(name)!.toString('utf8');
    for (const raw of groupBlocks(tokenize(xml))) {
      const images: PhotoImage[] = [];
      for (const { ref, caption } of captionsOf(raw.items)) {
        const item = manifest.get(ref);
        const ext = item ? IMAGE_EXT[item.mediaType.toLowerCase()] : undefined;
        const data = item ? entries.get(item.href) ?? entries.get(item.href.replace(/^\/+/, '')) : undefined;
        if (!item || !ext || !data) {
          skipped += 1;
          continue;
        }
        images.push({ ref, ext, data, caption });
      }
      if (images.length === 0) continue;
      pageNo += 1;
      blocks.push({ page: `pg_${String(pageNo).padStart(3, '0')}`, texts: raw.items.filter((i) => i.kind === 'text').map((i) => i.value), images });
    }
  }
  return { blocks, skipped };
}
