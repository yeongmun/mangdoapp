// 여러 구역(TABLES·BLOCKS·ENTITIES)에 흩어진 삽입·교체를 모아 두었다가 한 번에 적용한다.
// 인덱스는 전부 적용 전 원본 doc.pairs 기준이다 — 앞 구역에 끼워 넣어도 뒤 구역의 범위
// (EntityRange)가 밀리지 않도록, 적용은 한 번만 하고 호출부는 그 뒤로 범위를 쓰지 않는다.
// 근거: docs/superpowers/specs/2026-10-02-table-cells-design.md 6장 4단계

import type { DxfDocument, DxfPair } from './dxfDocument.js';

interface Edit {
  start: number;
  end: number;
  pairs: DxfPair[];
  /** 추가한 순서. 같은 자리의 삽입이 추가한 순서대로 놓이게 한다 */
  seq: number;
}

export class DocumentEdits {
  private readonly edits: Edit[] = [];

  insert(at: number, pairs: DxfPair[]): void {
    this.replace(at, at, pairs);
  }

  replace(start: number, end: number, pairs: DxfPair[]): void {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`잘못된 편집 구간입니다: [${start}, ${end})`);
    }
    this.edits.push({ start, end, pairs, seq: this.edits.length });
  }

  get size(): number {
    return this.edits.length;
  }

  // 앞에서 뒤로 한 번 훑으며 원본 조각과 새 조각을 번갈아 이어 붙인다. 인자 전개 없음 —
  // 손상 수천 개 분량의 쌍을 다룰 수 있어야 한다(exportDrawing.ts의 appendAll 주석 참고).
  apply(doc: DxfDocument): void {
    if (this.edits.length === 0) return;
    const sorted = [...this.edits].sort((a, b) => a.start - b.start || a.seq - b.seq);
    const source = doc.pairs;
    const out: DxfPair[] = [];
    let cursor = 0;
    for (const edit of sorted) {
      if (edit.start < cursor) throw new Error(`편집 구간이 겹칩니다: [${edit.start}, ${edit.end})`);
      if (edit.end > source.length) throw new Error(`편집 구간이 문서를 벗어납니다: [${edit.start}, ${edit.end})`);
      for (let i = cursor; i < edit.start; i++) out.push(source[i]);
      for (const p of edit.pairs) out.push(p);
      cursor = edit.end;
    }
    for (let i = cursor; i < source.length; i++) out.push(source[i]);
    doc.pairs = out;
  }
}
