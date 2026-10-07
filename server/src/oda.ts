// ODA File Converter로 DWG ↔ DXF 변환. 앱 서버가 Windows PC에서 돌 때만 쓴다(server/.env의 ODA_PATH).
// ODA는 "입력 폴더 → 출력 폴더" 방식 CLI라 호출마다 임시 폴더를 만들고 지운다.
// 인자: <입력 폴더> <출력 폴더> <버전> <형식> <하위 폴더 재귀 0/1> <감사 0/1> [파일 필터]
// 웹(daenong)이 같은 도구를 ACAD2013/DXF로 쓰고 있다. 여기서는 한글이 UTF-8로 나오도록 2018을 쓴다.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** DXF 글자를 얻고(DWG→DXF) DXF 글자를 DWG로 만드는(DXF→DWG) 변환기. 테스트는 가짜를 넣는다. */
export interface DrawingConverter {
  dwgToDxf(dwg: Buffer): Promise<Buffer>;
  dxfToDwg(dxfText: string): Promise<Buffer>;
}

const VERSION = 'ACAD2018';

export class OdaConverter implements DrawingConverter {
  constructor(
    private readonly odaPath: string,
    private readonly exec: typeof execFileAsync = execFileAsync,
  ) {}

  dwgToDxf(dwg: Buffer): Promise<Buffer> {
    return this.convert(dwg, 'in.dwg', 'DXF', '*.dwg', 'in.dxf');
  }

  dxfToDwg(dxfText: string): Promise<Buffer> {
    return this.convert(Buffer.from(dxfText, 'utf8'), 'in.dxf', 'DWG', '*.dxf', 'in.dwg');
  }

  private async convert(data: Buffer, inName: string, format: 'DXF' | 'DWG', filter: string, outName: string): Promise<Buffer> {
    const root = await mkdtemp(join(tmpdir(), 'mangdo-oda-'));
    const inDir = join(root, 'in');
    const outDir = join(root, 'out');
    try {
      await mkdir(inDir, { recursive: true });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(inDir, inName), data);
      await this.exec(this.odaPath, [inDir, outDir, VERSION, format, '0', '0', filter], { timeout: 120_000, windowsHide: true });
      const files = await readdir(outDir);
      if (!files.includes(outName)) {
        throw new Error(`ODA 변환 결과가 없습니다(${format}). 출력: ${files.join(', ') || '없음'}`);
      }
      return await readFile(join(outDir, outName));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
