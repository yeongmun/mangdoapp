// 테스트용 픽스처 변형. server/test/fixtures/mangdo-template.dxf 한 장을 글자 치환으로
// 여러 모양(틀 2개, 회전한 틀, 표가 최상위에 있는 도면 …)으로 바꿔 준다.
// 픽스처 파일 자체는 고치지 않는다 — 그 값에 기대는 기존 테스트가 여럿이다.
// 치환 대상이 실제로 있는지 매번 확인한다. 픽스처가 바뀌면 조용히 지나가지 않고 던진다.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

export async function templateText(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`픽스처에서 찾지 못했습니다: ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

// 픽스처의 망도틀 INSERT를 글자 그대로 옮겨 놓은 것. 핸들과 삽입점 x만 바꿔 쓴다.
const FRAME_INSERT = [
  '  0', 'INSERT', '  5', '80', '330', '1F', '100', 'AcDbEntity', '  8', '0',
  '100', 'AcDbBlockReference', '  2', '망도틀', ' 10', '1000.0', ' 20', '2000.0', ' 30', '0.0',
  ' 41', '2.0', ' 42', '2.0', ' 43', '2.0', ' 50', '0.0', '',
].join('\n');

/** 같은 망도틀을 x = insertX에, 주어진 핸들로 한 벌 더 삽입한다. */
export function withFrameAt(text: string, insertX: number, handle: string): string {
  const insert = FRAME_INSERT.replace('\n80\n', `\n${handle}\n`).replace('\n1000.0\n', `\n${insertX.toFixed(1)}\n`);
  // 원본 INSERT 바로 뒤(최상위 LINE 앞)에 넣는다 — 예전 withSecondFrame과 같은 자리다.
  return replaceOnce(text, '  0\nLINE\n  5\n81\n', insert + '  0\nLINE\n  5\n81\n');
}

/** 같은 망도틀을 x = insertX에 한 벌 더 삽입한다(틀 2개짜리 도면). */
export function withSecondFrame(text: string, insertX: number): string {
  return withFrameAt(text, insertX, '8A');
}

/** 망도틀 INSERT를 도(度) 단위로 회전시킨다(코드 50). */
export function rotatedFrame(text: string, degrees: number): string {
  return replaceOnce(text, ' 43\n2.0\n 50\n0.0\n', ` 43\n2.0\n 50\n${degrees.toFixed(1)}\n`);
}

/** 망도틀 안의 ACAD_TABLE을 POINT로 바꿔 "표가 없는 블록"을 만든다. */
export function withoutTable(text: string): string {
  return replaceOnce(text, '  0\nACAD_TABLE\n', '  0\nPOINT\n');
}

// 표 머리글 8칸(번호·손상위치·손상현황·가로/폭·세로/길이·개소·면적/연장·단위)의 MTEXT 값만
// 지운다 — 표 제목('손상물량표')은 그대로 둔다. buildGrid는 데이터 1행 앵커('1' 글자)로
// firstDataRow를 찾으므로(머리글과 무관) 이렇게 지워도 격자는 그대로 읽히고, headers[]만
// 전부 빈 문자열이 된다 — "머리글을 읽지 못한 표"를 만드는 방법이다.
const HEADER_TEXT_VALUES = [
  '{\\f굴림|b0|i0|c129|p2;번}호',
  '{\\f굴림|b0|i0|c129|p2;손상위}치',
  '{\\f굴림|b0|i0|c129|p2;손상현}황',
  '가로/폭',
  '세로/길이',
  '개소',
  '면적/연장',
  '단위',
];

/** 표 머리글 8칸의 글자를 모두 지운다(열 매핑이 머리글을 못 읽는 도면). */
export function withUnreadableHeaders(text: string): string {
  return HEADER_TEXT_VALUES.reduce((acc, value) => replaceOnce(acc, `  1\n${value}\n`, '  1\n\n'), text);
}

/**
 * ACAD_TABLE을 망도틀 블록 밖(ENTITIES 맨 앞)으로 옮긴다 — 틀이 0개이고 표는 하나인 옛 도면.
 * 소유자(330)는 여전히 망도틀 블록 레코드를 가리키지만 읽는 쪽(readEntities)은 보지 않는다.
 */
export function flatTable(text: string): string {
  const start = text.indexOf('  0\nACAD_TABLE\n');
  const end = text.indexOf('  0\nENDBLK\n  5\n52\n');
  if (start < 0 || end < start) throw new Error('픽스처의 ACAD_TABLE을 찾지 못했습니다');
  const table = text.slice(start, end);
  const without = text.slice(0, start) + text.slice(end);
  const marker = '  0\nSECTION\n  2\nENTITIES\n';
  const at = without.indexOf(marker) + marker.length;
  return without.slice(0, at) + table + without.slice(at);
}

// 망도틀 블록 안에 넣을 LINE 하나. 블록 좌표 (0,0)-(2000,2000).
const FRAME_LINE = [
  '  0', 'LINE', '  5', '53', '330', '30', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbLine',
  ' 10', '0.0', ' 20', '0.0', ' 30', '0.0', ' 11', '2000.0', ' 21', '2000.0', ' 31', '0.0', '',
].join('\n');

/** 망도틀 블록 안에 LINE을 하나 넣는다(틀 영역이 표보다 넓어지는 경우). */
export function withFrameLine(text: string): string {
  return replaceOnce(text, '  0\nENDBLK\n  5\n52\n', FRAME_LINE + '  0\nENDBLK\n  5\n52\n');
}

// 망도틀 블록 안에 넣을 중첩 INSERT. 표 모양 블록(*TX)을 블록 좌표 (0, 5000)에 배율 1로.
const NESTED_INSERT = [
  '  0', 'INSERT', '  5', '54', '330', '30', '100', 'AcDbEntity', '  8', '0', '100', 'AcDbBlockReference',
  '  2', '*TX', ' 10', '0.0', ' 20', '5000.0', ' 30', '0.0', ' 41', '1.0', ' 42', '1.0', ' 43', '1.0',
  ' 50', '0.0', '',
].join('\n');

/** 망도틀 블록 안에 블록(*TX)을 한 번 더 삽입한다 — 중첩 INSERT 재귀 확인용. */
export function withNestedInsert(text: string): string {
  return replaceOnce(text, '  0\nENDBLK\n  5\n52\n', NESTED_INSERT + '  0\nENDBLK\n  5\n52\n');
}

// ───────── 모델 공간 표 템플릿(2026-10-02 설계) ─────────
// 새 사내 템플릿은 망도틀 블록 안에 표가 없고 모델 공간에 틀마다 ACAD_TABLE이 놓인다.
// 픽스처 템플릿을 그 모양으로 바꾼다: 블록 안 표를 빼고 LINE 하나로 영역을 만들고, 틀마다
// INSERT + 표(셀 묶음 포함)를 넣는다. 글자 블록은 틀 0이 *TX를 그대로 쓰고 틀 k≥1은 *TXk 사본.

const CELL_ATTRS = ['171', '     1', '172', '     0', '173', '     0', '174', '     0', '175', '     1', '176', '     1', ' 91', '        32', '178', '     0', ' 92', '        0'];

function stringCell(text: string): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        0', ' 90', '        4', '  1', text, ' 94', '        0', '302', text, '304', 'ACVALUE_END'];
}
function intCell(n: number): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        0', ' 90', '        1', ' 91', String(n).padStart(9, ' '), ' 94', '        0', '300', '', '302', String(n), '304', 'ACVALUE_END'];
}
function emptyCell(): string[] {
  return [...CELL_ATTRS, '301', 'CELL_VALUE', ' 93', '        3', ' 90', '        0', ' 91', '        0', ' 94', '        0', '300', '', '302', '', '304', 'ACVALUE_END'];
}

const MODEL_TABLE_HEADERS = ['번호', '손상위치', '손상현황', '가로/폭', '세로/길이', '개소', '면적/연장', '단위'];

// 모델 공간 ACAD_TABLE 한 벌. 5행 × 8열, 행 높이 40·20×4, 열 너비는 템플릿 표와 같다.
function modelTableText(handle: string, x: number, blockName: string, recordHandle: string): string {
  const cells: string[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      if (row === 0) cells.push(...(col === 0 ? stringCell('손상물량표') : emptyCell()));
      else if (row === 1) cells.push(...stringCell(MODEL_TABLE_HEADERS[col]));
      else cells.push(...(col === 0 ? intCell(row - 1) : emptyCell()));
    }
  }
  return [
    '  0', 'ACAD_TABLE', '  5', handle, '102', '{ACAD_XDICTIONARY', '360', 'FF', '102', '}', '330', '1F',
    '100', 'AcDbEntity', '  8', '0', '160', '                 4', '310', '00000000',
    '100', 'AcDbBlockReference', '  2', blockName, ' 10', x.toFixed(1), ' 20', '3400.0', ' 30', '0.0',
    '100', 'AcDbTable', '342', '88', '343', recordHandle, ' 11', '1.0', ' 21', '0.0', ' 31', '0.0',
    ' 90', '       22', ' 91', '        5', ' 92', '        8', ' 93', '       24', ' 94', '        0',
    '141', '40.0', '141', '20.0', '141', '20.0', '141', '20.0', '141', '20.0',
    '142', '100.0', '142', '150.0', '142', '300.0', '142', '120.0', '142', '120.0', '142', '100.0', '142', '140.0', '142', '110.0',
    ...cells, '',
  ].join('\n');
}

// *TX 블록(BLOCK…ENDBLK)을 이름 *TXk·레코드 k31·핸들 k60~k76으로 베낀다.
function tableBlockCopy(text: string, k: number): string {
  const start = text.indexOf('  0\nBLOCK\n  5\n60\n');
  const end = text.indexOf('  0\nENDSEC\n', start);
  if (start < 0 || end < 0) throw new Error('픽스처의 *TX 블록을 찾지 못했습니다');
  return text
    .slice(start, end)
    .replace(/\n  5\n([67][0-9A-F])\n/g, (_m, h: string) => `\n  5\n${k}${h}\n`)
    .replace(/\n330\n31\n/g, `\n330\n${k}31\n`)
    .replace(/\n  2\n\*TX\n/g, `\n  2\n*TX${k}\n`)
    .replace(/\n  3\n\*TX\n/g, `\n  3\n*TX${k}\n`);
}

function blockRecordText(handle: string, name: string): string {
  return ['  0', 'BLOCK_RECORD', '  5', handle, '330', '1', '100', 'AcDbSymbolTableRecord', '100', 'AcDbBlockTableRecord', '  2', name, ' 70', '     1', ''].join('\n');
}

/** 표가 블록 밖(모델 공간)에 있는 새 템플릿 모양. frameCount개의 틀을 x = 1000 + 50000k에 놓는다. */
export async function modelSpaceTemplate(frameCount = 1): Promise<string> {
  let text = await templateText();
  // 블록 안 표를 빼고 LINE으로 영역을 만든다(블록 좌표 (0,0)-(2000,2000) → 모델 (1000,2000)-(5000,6000)).
  const tableStart = text.indexOf('  0\nACAD_TABLE\n');
  const tableEnd = text.indexOf('  0\nENDBLK\n  5\n52\n');
  if (tableStart < 0 || tableEnd < tableStart) throw new Error('픽스처의 ACAD_TABLE을 찾지 못했습니다');
  text = text.slice(0, tableStart) + FRAME_LINE + text.slice(tableEnd);
  // 원본 INSERT(x 1000)를 지우고 틀마다 INSERT + 표를 LINE 81 앞에 넣는다.
  text = replaceOnce(text, FRAME_INSERT, '');
  let entities = '';
  let blocks = '';
  let records = '';
  for (let k = 0; k < frameCount; k++) {
    const x = 1000 + 50000 * k;
    const insertHandle = k === 0 ? '80' : `8${k}0`;
    entities += FRAME_INSERT.replace('\n80\n', `\n${insertHandle}\n`).replace('\n1000.0\n', `\n${x.toFixed(1)}\n`);
    const blockName = k === 0 ? '*TX' : `*TX${k}`;
    const record = k === 0 ? '31' : `${k}31`;
    entities += modelTableText(`A${k}`, 2000 + 50000 * k, blockName, record);
    if (k > 0) {
      blocks += tableBlockCopy(text, k);
      records += blockRecordText(record, blockName);
    }
  }
  text = replaceOnce(text, '  0\nLINE\n  5\n81\n', entities + '  0\nLINE\n  5\n81\n');
  if (blocks) text = replaceOnce(text, '  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n', blocks + '  0\nENDSEC\n  0\nSECTION\n  2\nENTITIES\n');
  if (records) text = replaceOnce(text, '  0\nENDTAB\n  0\nENDSEC\n  0\nSECTION\n  2\nBLOCKS\n', records + '  0\nENDTAB\n  0\nENDSEC\n  0\nSECTION\n  2\nBLOCKS\n');
  return text;
}
