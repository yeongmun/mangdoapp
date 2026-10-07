import { describe, expect, it } from 'vitest';
import { DocumentEdits } from '../src/export/documentEdits.js';
import { pair, type DxfDocument, type DxfPair } from '../src/export/dxfDocument.js';

function docOf(values: string[]): DxfDocument {
  return { pairs: values.map((v) => pair(0, v)), eol: '\n', trailingEol: true };
}
function valuesOf(doc: DxfDocument): string[] {
  return doc.pairs.map((p) => p.value);
}
const P = (v: string): DxfPair => pair(1, v);

describe('DocumentEdits', () => {
  it('삽입·교체를 원본 인덱스 기준으로 한꺼번에 적용한다', () => {
    const doc = docOf(['a', 'b', 'c', 'd', 'e']);
    const edits = new DocumentEdits();
    edits.replace(3, 4, [P('D1'), P('D2')]); // d → D1 D2
    edits.insert(1, [P('x')]);              // a | x | b
    edits.insert(5, [P('end')]);            // 맨 뒤
    edits.replace(0, 1, []);                // a 삭제
    expect(edits.size).toBe(4);
    edits.apply(doc);
    expect(valuesOf(doc)).toEqual(['x', 'b', 'c', 'D1', 'D2', 'e', 'end']);
  });

  it('같은 자리의 삽입은 추가한 순서대로 놓인다', () => {
    const doc = docOf(['a', 'b']);
    const edits = new DocumentEdits();
    edits.insert(1, [P('1')]);
    edits.insert(1, [P('2')]);
    edits.apply(doc);
    expect(valuesOf(doc)).toEqual(['a', '1', '2', 'b']);
  });

  it('교체 구간이 겹치면 apply가 던진다', () => {
    const doc = docOf(['a', 'b', 'c']);
    const edits = new DocumentEdits();
    edits.replace(0, 2, []);
    edits.replace(1, 3, []);
    expect(() => edits.apply(doc)).toThrow(/겹/);
  });

  it('편집이 없으면 배열을 바꾸지 않는다', () => {
    const doc = docOf(['a']);
    const before = doc.pairs;
    new DocumentEdits().apply(doc);
    expect(doc.pairs).toBe(before);
  });
});
