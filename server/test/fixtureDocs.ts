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
