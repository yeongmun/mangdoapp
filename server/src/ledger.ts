// 손상 원장(ledger): 도면의 손상을 손상물량표 한 행 모양으로 편 것. 웹(daenong)이 받아
// 집계표·사진첩을 만든다. 번호·손상현황·물량은 화면·산출 DXF·사진 zip과 **같은 함수**로 구한다 —
// 받는 쪽이 다시 계산하면 규칙이 어긋난다. 파일 I/O가 없는 순수 함수라 손으로 검산할 수 있다.
// 손상위치(부재)는 여기 없다 — 캐드에서 적는다(2026-10-07 결정). 웹이 빈 열을 두고 사람이 채운다.
// 근거: 대농 프로젝트 문서 '앱-웹-연동-분석.md' 4장.

import { getDamageType } from '../public/viewer/damageTypes.js';
import {
  computeNumbers,
  frameIndexOf,
  quantityOf,
  statusTextOf,
  unitOf,
  widthUnitOf,
} from '../public/viewer/quantities.js';
import type { FrameBounds } from './export/frames.js';
import type { ExistingTable } from './export/tableRead.js';

export interface LedgerRow {
  /** 'app' = 태블릿에서 그린 신규 손상, 'existing' = 올린 도면의 표에 이미 적혀 있던 기존 손상 */
  source: 'app' | 'existing';
  /** 신규 손상의 id. 기존 손상은 '' */
  damageId: string;
  /** 망도틀 순번(왼쪽부터 0). 틀이 없는 도면은 0, 틀 밖 손상은 null */
  frameIndex: number | null;
  /** 틀마다 1부터. 틀 밖 손상은 null(산출 DXF·사진 zip과 같다). 신규는 기존 행 다음 번호부터 */
  no: number | null;
  /** 손상위치(부재). 기존 손상은 표의 값, 신규는 ''(캐드에서 적는다) */
  location: string;
  /** 손상 유형 id(crack, spalling …). 기존 손상은 '' */
  type: string;
  /** 손상현황. 균열류는 폭 구간이 붙는다 — '균열(0.3mm미만)' */
  statusText: string;
  width: number | null;
  /** width의 단위. 균열류는 'mm', 면형은 'm' */
  widthUnit: 'mm' | 'm';
  length: number | null;
  count: number | null;
  /** 물량. 필요한 값이 비어 있으면 null */
  quantity: number | null;
  /** 물량 단위 'm' | '㎡'. 모르는 유형이면 null */
  unit: string | null;
  photoNumbers: string[];
  note: string;
}

export interface DrawingLedger {
  drawingId: string;
  drawingName: string;
  /** 망도틀 수. 0이면 틀이 없는 도면(전체가 한 묶음) */
  frameCount: number;
  rows: LedgerRow[];
  /** 틀 밖이라 번호를 받지 못한 손상 수 */
  outsideFrames: number;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberOrNullText(value: string): number | null {
  const n = Number(value.replace(/,/g, ''));
  return value.trim() !== '' && Number.isFinite(n) ? n : null;
}

/** 기존 손상의 폭 단위: 균열류(망상균열 제외)는 mm, 나머지는 m — 화면 규칙(widthUnitOf)과 같다 */
function existingWidthUnit(status: string): 'mm' | 'm' {
  return /균열/.test(status) && !/망상균열/.test(status) ? 'mm' : 'm';
}

export function buildDrawingLedger(
  drawing: { id: string; name: string },
  damages: unknown[],
  frames: FrameBounds[],
  /** 틀마다 표에 이미 적힌 기존 손상(findFrames의 existing). 생략하면 frames[i].existing(저장된 틀)을 쓴다 */
  existing: Array<Pick<ExistingTable, 'rows'> | null> = frames.map((f) => (f.existing?.length ? { rows: f.existing } : null)),
): DrawingLedger {
  const list = Array.isArray(damages) ? damages : [];
  const numbers = computeNumbers(list, frames);
  const hasFrames = frames.length > 0;

  const rows: LedgerRow[] = [];
  let outsideFrames = 0;
  existing.forEach((table, frameIndex) => {
    if (!table) return;
    for (const r of table?.rows ?? []) {
      rows.push({
        source: 'existing',
        damageId: '',
        frameIndex,
        no: r.number,
        location: r.location,
        type: '',
        statusText: r.status,
        width: numberOrNullText(r.width),
        widthUnit: existingWidthUnit(r.status),
        length: numberOrNullText(r.length),
        count: numberOrNullText(r.count),
        quantity: numberOrNullText(r.quantity),
        unit: r.unit || null,
        photoNumbers: [],
        note: r.note,
      });
    }
  });
  for (const raw of list) {
    const damage = raw as {
      id?: unknown;
      type?: unknown;
      measured?: { width?: unknown; length?: unknown; count?: unknown };
      attrs?: { note?: unknown; photoNumbers?: unknown };
    };
    const id = String(damage?.id ?? '');
    const frameIndex = hasFrames ? frameIndexOf(damage, frames) : 0;
    if (frameIndex === null) outsideFrames += 1;
    const type = String(damage?.type ?? '');
    rows.push({
      source: 'app',
      damageId: id,
      frameIndex,
      no: numbers.get(id) ?? null,
      location: '',
      type,
      statusText: statusTextOf(damage),
      width: numberOrNull(damage?.measured?.width),
      widthUnit: widthUnitOf(getDamageType(type)),
      length: numberOrNull(damage?.measured?.length),
      count: numberOrNull(damage?.measured?.count),
      quantity: quantityOf(damage),
      unit: unitOf(damage),
      photoNumbers: stringsOf(damage?.attrs?.photoNumbers),
      note: typeof damage?.attrs?.note === 'string' ? damage.attrs.note : '',
    });
  }

  // 틀 순, 번호 순으로 정렬한다 — 표에 그대로 옮겨 적을 수 있게. 틀 밖(null)은 맨 뒤.
  rows.sort((a, b) => {
    const fa = a.frameIndex ?? Number.MAX_SAFE_INTEGER;
    const fb = b.frameIndex ?? Number.MAX_SAFE_INTEGER;
    return fa - fb || (a.no ?? Number.MAX_SAFE_INTEGER) - (b.no ?? Number.MAX_SAFE_INTEGER) || a.damageId.localeCompare(b.damageId);
  });

  return { drawingId: drawing.id, drawingName: drawing.name, frameCount: frames.length, rows, outsideFrames };
}
