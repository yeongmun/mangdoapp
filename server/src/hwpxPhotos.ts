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
  // 태그(<hp:lineBreak/>, <hp:tab/> …)는 공백으로 — 글자가 붙지 않게
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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

type Token =
  | { kind: 'tblOpen' | 'tblClose' | 'tcOpen' | 'tcClose' | 'pOpen' | 'pClose' }
  | { kind: 'cellAddr'; row: number; col: number }
  | { kind: 'img'; ref: string }
  | { kind: 'text'; text: string };

/** 섹션 XML을 토큰으로. 글(hp:t)은 문단(hp:p)이 닫힐 때 하나로 합쳐 낸다 — run이 나뉘어도 캡션은 하나 */
function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  const re = /<(\/?)(hp:tbl|hp:tc|hp:cellAddr|hp:p|hc:img|hp:t)\b([^>]*?)(\/?)>/g;
  // 문단은 겹칠 수 있다(그림의 hp:caption 안 문단). 글은 가장 바깥 문단에 쌓는다 — 캡션이 그림 문단의 글이 된다
  const paraTexts: string[][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    const attrs = m[3];
    const selfClosing = m[4] === '/';
    switch (tag) {
      case 'hp:tbl':
        tokens.push({ kind: closing ? 'tblClose' : 'tblOpen' });
        break;
      case 'hp:tc':
        if (!selfClosing) tokens.push({ kind: closing ? 'tcClose' : 'tcOpen' });
        break;
      case 'hp:cellAddr': {
        const col = Number(/\bcolAddr="(\d+)"/.exec(attrs)?.[1] ?? NaN);
        const row = Number(/\browAddr="(\d+)"/.exec(attrs)?.[1] ?? NaN);
        if (Number.isFinite(row) && Number.isFinite(col)) tokens.push({ kind: 'cellAddr', row, col });
        break;
      }
      case 'hp:p':
        if (closing) {
          const texts = paraTexts.pop();
          if (paraTexts.length === 0) {
            const text = (texts ?? []).join(' ').replace(/\s+/g, ' ').trim();
            if (text !== '') tokens.push({ kind: 'text', text });
            tokens.push({ kind: 'pClose' });
          } else if (texts && texts.length > 0) {
            // 안쪽 문단(캡션 등)의 글은 바깥 문단으로 올린다
            paraTexts[paraTexts.length - 1].push(...texts);
          }
        } else if (!selfClosing) {
          if (paraTexts.length === 0) tokens.push({ kind: 'pOpen' });
          paraTexts.push([]);
        }
        break;
      case 'hc:img':
        if (!closing) {
          const ref = /\bbinaryItemIDRef="([^"]*)"/.exec(attrs)?.[1];
          if (ref) tokens.push({ kind: 'img', ref });
        }
        break;
      case 'hp:t':
        if (!closing && !selfClosing) {
          const end = xml.indexOf('</hp:t>', re.lastIndex);
          if (end === -1) break;
          const text = cleanText(xml.slice(re.lastIndex, end));
          if (text !== '') {
            if (paraTexts.length > 0) paraTexts[paraTexts.length - 1].push(text);
            else tokens.push({ kind: 'text', text });
          }
          re.lastIndex = end;
        }
        break;
    }
  }
  return tokens;
}

type Item = { kind: 'img'; ref: string } | { kind: 'text'; text: string };
interface Cell {
  row: number;
  col: number;
  items: Item[];
}
interface RawBlock {
  cells: Cell[];
}

/** 토큰을 페이지 후보로 묶는다: 깊이 0의 표 하나(칸 좌표 포함) / 표 밖 그림이 든 문단 하나(칸 하나로 취급) */
function groupBlocks(tokens: Token[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let depth = 0;
  let table: RawBlock | null = null;
  let cell: Cell | null = null;
  let cellSeq = 0;
  let para: Cell | null = null;
  for (const token of tokens) {
    if (token.kind === 'tblOpen') {
      if (depth === 0) {
        table = { cells: [] };
        cellSeq = 0;
      }
      depth += 1;
      continue;
    }
    if (token.kind === 'tblClose') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && table) {
        if (cell) table.cells.push(cell);
        cell = null;
        blocks.push(table);
        table = null;
      }
      continue;
    }
    if (depth > 0 && table) {
      // 깊이 1의 칸만 좌표를 가진다. 안쪽 표의 내용은 바깥 칸에 그대로 쌓인다(그림은 한 번만 센다)
      if (token.kind === 'tcOpen' && depth === 1) {
        if (cell) table.cells.push(cell);
        cellSeq += 1;
        cell = { row: cellSeq, col: 0, items: [] };
      } else if (token.kind === 'tcClose' && depth === 1) {
        if (cell) table.cells.push(cell);
        cell = null;
      } else if (token.kind === 'cellAddr' && depth === 1 && cell) {
        cell.row = token.row;
        cell.col = token.col;
      } else if (token.kind === 'img' || token.kind === 'text') {
        if (!cell) cell = { row: cellSeq, col: 0, items: [] };
        cell.items.push(token.kind === 'img' ? { kind: 'img', ref: token.ref } : { kind: 'text', text: token.text });
      }
      continue;
    }
    // 표 밖
    if (token.kind === 'pOpen') {
      para = { row: 0, col: 0, items: [] };
      continue;
    }
    if (token.kind === 'pClose') {
      if (para && para.items.some((i) => i.kind === 'img')) blocks.push({ cells: [para] });
      para = null;
      continue;
    }
    if (para && (token.kind === 'img' || token.kind === 'text')) {
      para.items.push(token.kind === 'img' ? { kind: 'img', ref: token.ref } : { kind: 'text', text: token.text });
    }
  }
  if (table) {
    if (cell) table.cells.push(cell);
    blocks.push(table);
  }
  return blocks;
}

function firstText(items: Item[]): string | null {
  const hit = items.find((i): i is { kind: 'text'; text: string } => i.kind === 'text');
  return hit ? hit.text : null;
}

/**
 * 그림마다 캡션. 같은 칸에서 그림 뒤 글 → 바로 아래 칸(행+1, 같은 열) 글 → 같은 칸 앞 글 → 바로 위 칸 글 → null.
 * 사진대지의 흔한 배치 [그림|그림]/[캡션|캡션]를 맞추기 위해 칸 좌표로 짝짓는다.
 */
function captionsOf(cells: Cell[]): { ref: string; caption: string | null }[] {
  const out: { ref: string; caption: string | null }[] = [];
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col);
  const textOnly = (c: Cell | undefined) => (c && !c.items.some((it) => it.kind === 'img') ? firstText(c.items) : null);
  for (const [seq, cell] of cells.entries()) {
    const imgIdx = cell.items.map((it, i) => (it.kind === 'img' ? i : -1)).filter((i) => i !== -1);
    imgIdx.forEach((i, k) => {
      const ref = (cell.items[i] as { kind: 'img'; ref: string }).ref;
      const nextImg = imgIdx[k + 1] ?? cell.items.length;
      const prevImg = imgIdx[k - 1] ?? -1;
      const after = firstText(cell.items.slice(i + 1, nextImg));
      const below = textOnly(at(cell.row + 1, cell.col));
      // 옆으로 [그림|캡션] 배치: 문서 순서상 다음 칸(그림 없는)
      const nextCell = k === imgIdx.length - 1 ? textOnly(cells[seq + 1]) : null;
      const before = firstText(cell.items.slice(prevImg + 1, i).reverse());
      const above = textOnly(at(cell.row - 1, cell.col));
      const prevCell = k === 0 ? textOnly(cells[seq - 1]) : null;
      out.push({ ref, caption: after ?? below ?? nextCell ?? before ?? above ?? prevCell ?? null });
    });
  }
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
      for (const { ref, caption } of captionsOf(raw.cells)) {
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
      const texts = raw.cells.flatMap((c) => c.items.filter((i): i is { kind: 'text'; text: string } => i.kind === 'text').map((i) => i.text));
      blocks.push({ page: `pg_${String(pageNo).padStart(3, '0')}`, texts, images });
    }
  }
  return { blocks, skipped };
}
