// 손상 원장(ledger)을 손상현황표 엑셀 한 장으로 만든다(2026-10-07, 인프라스마트 태블릿 Pro의
// "손상현황표 엑셀" 역할). 열은 웹(daenong) 손상물량표 머리글과 같게 둔다 — 그 파일을 웹 손상물량표
// 화면에 그대로 올려도 짝지어진다. 값·번호는 원장 그대로 쓰고 다시 계산하지 않는다.
// 손상위치는 기존 손상만 채워진다(신규는 캐드에서 적는다 — 2026-10-07 결정).

import ExcelJS from 'exceljs';
import type { DrawingLedger, LedgerRow } from './ledger.js';

export const LEDGER_XLSX_COLUMNS = ['도면', '틀', '번호', '손상위치', '손상현황', '폭', '길이', '개소', '물량', '단위', '구/신', '사진번호', '비고'] as const;

type LedgerDrawing = DrawingLedger & { subProject?: string | null };

function frameLabel(row: LedgerRow, frameCount: number): string {
  if (row.frameIndex === null) return 'X';
  if (frameCount === 0) return '000';
  return String(row.frameIndex + 1).padStart(3, '0');
}

export function ledgerRowsToSheetRows(drawings: LedgerDrawing[]): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (const d of drawings) {
    const name = d.subProject ? `${d.subProject}/${d.drawingName}` : d.drawingName;
    for (const r of d.rows) {
      out.push([
        name,
        frameLabel(r, d.frameCount),
        r.no,
        r.location,
        r.statusText,
        r.width,
        r.length,
        r.count,
        r.quantity,
        r.unit ?? '',
        r.source === 'existing' ? '구' : '신',
        r.photoNumbers.join(', '),
        r.note,
      ]);
    }
  }
  return out;
}

export async function ledgerToXlsx(title: string, drawings: LedgerDrawing[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('손상현황표');
  sheet.addRow([title]);
  sheet.getRow(1).font = { bold: true, size: 13 };
  const header = sheet.addRow([...LEDGER_XLSX_COLUMNS]);
  header.font = { bold: true };
  header.alignment = { horizontal: 'center' };
  for (const row of ledgerRowsToSheetRows(drawings)) sheet.addRow(row);
  // 폭·길이·물량은 소수 둘째 자리까지(산출 DXF 표와 같은 표기)
  for (const col of [6, 7, 9]) sheet.getColumn(col).numFmt = '0.00';
  const widths = [28, 6, 6, 18, 18, 8, 8, 6, 8, 6, 6, 16, 20];
  widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
