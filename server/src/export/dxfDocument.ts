// DXF 파일을 (코드, 값) 쌍의 배열로 읽고, 필요한 곳만 고쳐 다시 쓴다.
// 전체를 객체로 바꿔 재직렬화하지 않는다 — 원본의 다른 부분은 한 바이트도 바뀌면 안 된다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4장

export interface DxfPair {
  code: number;
  value: string;
  // 원본의 코드 줄 그대로(예: '  0', ' 70', '1001'). 있으면 쓸 때 그대로 되돌려
  // 원본 바이트를 보존한다. 새로 만든 쌍에는 없고, 그때는 3칸 오른쪽 정렬로 쓴다.
  rawCode?: string;
}

export interface DxfDocument {
  pairs: DxfPair[];
  eol: string;
  trailingEol: boolean;
}

export interface SectionRange {
  /** (0, SECTION) 또는 (0, TABLE) 쌍의 인덱스 */
  start: number;
  /** 그 구역을 닫는 (0, ENDSEC) 또는 (0, ENDTAB) 쌍의 인덱스 */
  end: number;
}

export const DAMAGE_LAYER = '신규손상';
export const DAMAGE_COLOR = 1;

// 사진번호는 손상과 따로 켜고 끌 수 있게 별도 레이어·색으로 낸다(노랑).
// 근거: docs/superpowers/specs/2026-09-16-label-layout-design.md 3장
export const PHOTO_LAYER = '사진번호';
export const PHOTO_COLOR = 2;

// 물량표 칸에 쓰는 글자(데이터 칸 값·넘침 표의 번호·머리글·옛 넘침 표의 LINE)는 손상 도형과
// 따로 켜고 끌 수 있게 별도 레이어·색(흰/검, 7)으로 낸다. 손상 도형·라벨은 그대로 DAMAGE_LAYER다.
// 근거: 캐드 확인 2차 피드백(2026-09-16)
export const TABLE_LAYER = '손상물량표';
export const TABLE_COLOR = 7;

export function pair(code: number, value: string): DxfPair {
  return { code, value };
}

export function formatReal(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`DXF에 쓸 수 없는 숫자입니다: ${value}`);
  // -0은 0으로 눕힌다(0을 더하면 -0이 0이 된다).
  const text = String(value + 0);
  if (text.includes('.') || text.includes('e') || text.includes('E')) return text;
  return `${text}.0`;
}

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`DXF에 쓸 수 없는 숫자입니다: ${value}`);
  return String(Math.trunc(value) + 0);
}

// R6(미룬 항목): 파일 전체에 줄바꿈 방식 하나만 적용한다고 본다 — \r\n이 한 번이라도 있으면
// 파일 전체를 CRLF로, 없으면 LF로 본다. 실제 사내 파일은 한 방식으로 일관되어 지금은 나타나지
// 않지만, 두 방식이 섞인 파일(예: 대부분 LF에 CRLF 한 줄)을 다시 쓰면 원래 LF였던 줄도 선택된
// 방식(CRLF)으로 바뀐다 — 원본 바이트가 달라지지만 캐드는 그래도 연다. 아래 테스트가 이 동작을
// 고정해 둔다.
export function parseDxf(text: string): DxfDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  const trailingEol = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingEol) lines.pop();
  if (lines.length % 2 !== 0) throw new Error('DXF 줄 수가 홀수입니다 — 코드와 값의 짝이 맞지 않습니다.');

  const pairs: DxfPair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const rawCode = lines[i];
    const code = Number(rawCode.trim());
    if (!Number.isInteger(code)) throw new Error(`DXF ${i + 1}번째 줄의 코드가 숫자가 아닙니다: ${rawCode}`);
    pairs.push({ code, value: lines[i + 1], rawCode });
  }
  return { pairs, eol, trailingEol };
}

export function serializeDxf(doc: DxfDocument): string {
  const out: string[] = [];
  for (const p of doc.pairs) {
    out.push(p.rawCode ?? String(p.code).padStart(3, ' '));
    out.push(p.value);
  }
  return out.join(doc.eol) + (doc.trailingEol ? doc.eol : '');
}

// (0, opener) + (2, name) 으로 시작해 (0, closer) 로 닫히는 구역을 찾는다.
function findNamedRange(doc: DxfDocument, opener: string, closer: string, name: string): SectionRange | null {
  const { pairs } = doc;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== opener) continue;
    const next = pairs[i + 1];
    if (!next || next.code !== 2 || next.value !== name) continue;
    for (let j = i + 2; j < pairs.length; j++) {
      if (pairs[j].code === 0 && pairs[j].value === closer) return { start: i, end: j };
    }
    return null;
  }
  return null;
}

export function findSection(doc: DxfDocument, name: string): SectionRange | null {
  return findNamedRange(doc, 'SECTION', 'ENDSEC', name);
}

export function findTable(doc: DxfDocument, tableName: string): SectionRange | null {
  return findNamedRange(doc, 'TABLE', 'ENDTAB', tableName);
}

// HEADER는 (9, 이름) 다음 쌍이 값이다. 값의 코드는 항목마다 다르다(1, 5, 70, 10…).
function headerIndex(doc: DxfDocument, name: string): number {
  const header = findSection(doc, 'HEADER');
  if (!header) return -1;
  for (let i = header.start; i < header.end; i++) {
    if (doc.pairs[i].code === 9 && doc.pairs[i].value === name) return i + 1;
  }
  return -1;
}

export function headerValue(doc: DxfDocument, name: string): string | null {
  const index = headerIndex(doc, name);
  return index >= 0 && index < doc.pairs.length ? doc.pairs[index].value : null;
}

export function setHeaderValue(doc: DxfDocument, name: string, value: string): boolean {
  const index = headerIndex(doc, name);
  if (index < 0 || index >= doc.pairs.length) return false;
  doc.pairs[index] = { ...doc.pairs[index], value };
  return true;
}

export function recordHandle(doc: DxfDocument, tableName: string, recordName: string): string | null {
  const table = findTable(doc, tableName);
  if (!table) return null;
  // 레코드 이름은 대소문자를 가리지 않는다 — 다른 캐드/버전이 *MODEL_SPACE처럼 쓰기도 한다.
  const target = recordName.toLowerCase();
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== tableName) continue;
    let handle: string | null = null;
    let name: string | null = null;
    for (let j = i + 1; j < table.end && doc.pairs[j].code !== 0; j++) {
      const p = doc.pairs[j];
      if (p.code === 5 && handle === null) handle = p.value.trim();
      else if (p.code === 2 && name === null) name = p.value;
    }
    if (name !== null && name.toLowerCase() === target) return handle;
  }
  return null;
}

export function layerNames(doc: DxfDocument): string[] {
  const table = findTable(doc, 'LAYER');
  if (!table) return [];
  const names: string[] = [];
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'LAYER') continue;
    for (let j = i + 1; j < table.end && doc.pairs[j].code !== 0; j++) {
      if (doc.pairs[j].code === 2) {
        names.push(doc.pairs[j].value);
        break;
      }
    }
  }
  return names;
}

// 핸들은 16진 대문자다. 같은 핸들이 두 번 나오면 캐드가 파일을 열지 못한다.
export class HandleAllocator {
  private value: number;

  constructor(start: number) {
    this.value = Math.max(1, Math.trunc(start));
  }

  next(): string {
    const handle = this.value.toString(16).toUpperCase();
    this.value += 1;
    return handle;
  }

  get seed(): string {
    return this.value.toString(16).toUpperCase();
  }
}

// $HANDSEED가 실제 최대 핸들보다 작게 저장된 파일이 있다. 둘 중 큰 값에서 시작한다.
// HEADER 구역은 스캔에서 뺀다 — $HANDSEED 자신도 그룹 코드 5로 저장되어 있어서,
// 그걸 엔티티 핸들로 잘못 세면 최대값이 부풀어 $HANDSEED보다 하나 큰 값에서
// 시작해 버린다(실제 핸들은 비어 있는 값에서).
// 순수 16진 문자열만 핸들로 본다. parseInt는 '12G4' 같은 값을 앞부분만 읽어 0x12로
// 잘못 파싱한다 — 잘못된 값을 통째로 걸러 최댓값 계산에서 빼는 편이 안전하다.
const HEX_HANDLE = /^[0-9A-Fa-f]+$/;

export function createHandleAllocator(doc: DxfDocument): HandleAllocator {
  const seed = Number.parseInt(headerValue(doc, '$HANDSEED')?.trim() ?? '', 16);
  const header = findSection(doc, 'HEADER');
  let max = 0;
  for (let i = 0; i < doc.pairs.length; i++) {
    if (header && i >= header.start && i <= header.end) continue;
    const p = doc.pairs[i];
    if (p.code !== 5 && p.code !== 105) continue;
    const raw = p.value.trim();
    if (!HEX_HANDLE.test(raw)) continue;
    const value = Number.parseInt(raw, 16);
    if (value > max) max = value;
  }
  return new HandleAllocator(Math.max(Number.isFinite(seed) ? seed : 0, max + 1));
}

export function insertEntities(doc: DxfDocument, pairs: DxfPair[]): void {
  const entities = findSection(doc, 'ENTITIES');
  if (!entities) throw new Error('DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다');
  if (pairs.length === 0) return;
  // splice(i, 0, ...pairs)는 pairs를 인자로 펼친다 — 손상 하나(균열/백태)가 원을 1,000개까지
  // 낼 수 있어 pairs가 수만 개에 이르면 인자 개수 상한에 걸려 "Maximum call stack size
  // exceeded"로 죽는다. 배열을 새로 이어 붙여 넣는다(인자 전개 없음).
  doc.pairs = doc.pairs.slice(0, entities.end).concat(pairs, doc.pairs.slice(entities.end));
}

// LAYER 레코드 하나에서 390(플롯 스타일) 값을 찾는다. 있는 레코드에서 그대로 복사해 쓴다 —
// 값을 지어내지 않는다. 어떤 레코드에도 없으면 null(새 레코드에는 390 자체를 쓰지 않는다).
function existingPlotStyle(doc: DxfDocument, table: SectionRange): string | null {
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'LAYER') continue;
    for (let j = i + 1; j < table.end && doc.pairs[j].code !== 0; j++) {
      if (doc.pairs[j].code === 390) return doc.pairs[j].value;
    }
  }
  return null;
}

// LAYER 표에 레이어를 추가한다. 표의 항목 수(코드 70)는 캐드가 무시하므로 손대지 않는다.
export function ensureLayer(doc: DxfDocument, alloc: HandleAllocator, name: string, colorIndex: number): void {
  if (layerNames(doc).includes(name)) return;
  const table = findTable(doc, 'LAYER');
  if (!table) throw new Error('DXF 파일에서 LAYER 표를 찾을 수 없습니다');

  // LAYER 표 자체의 핸들이 새 레코드의 소유자(330)다.
  let ownerHandle = '2';
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code === 0) break;
    if (doc.pairs[i].code === 5) {
      ownerHandle = doc.pairs[i].value.trim();
      break;
    }
  }

  const plotStyle = existingPlotStyle(doc, table);
  const record: DxfPair[] = [
    pair(0, 'LAYER'),
    pair(5, alloc.next()),
    pair(330, ownerHandle),
    pair(100, 'AcDbSymbolTableRecord'),
    pair(100, 'AcDbLayerTableRecord'),
    pair(2, name),
    pair(70, '     0'),
    pair(62, String(colorIndex).padStart(6, ' ')),
    pair(6, 'Continuous'),
    pair(370, '    -3'),
    ...(plotStyle !== null ? [pair(390, plotStyle)] : []),
  ];
  doc.pairs.splice(table.end, 0, ...record);
}
