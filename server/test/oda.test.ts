import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { OdaConverter } from '../src/oda.js';

// ODA 실행 파일 대신 "입력 폴더의 파일을 출력 폴더에 다른 확장자로 베끼는" 가짜 exec.
function fakeExec(behavior: 'ok' | 'nothing' | 'throw') {
  return vi.fn(async (_cmd: string, args: readonly string[]) => {
    const [inDir, outDir, version, format, , , filter] = args;
    expect(version).toBe('ACAD2018');
    if (behavior === 'throw') throw new Error('exec failed');
    if (behavior === 'ok') {
      const inName = filter === '*.dwg' ? 'in.dwg' : 'in.dxf';
      const outName = format === 'DXF' ? 'in.dxf' : 'in.dwg';
      await writeFile(join(outDir, outName), Buffer.concat([Buffer.from(`${format}:`), await readFile(join(inDir, inName))]));
    }
    return { stdout: '', stderr: '' };
  });
}

describe('OdaConverter', () => {
  it('DWG→DXF: 임시 폴더에 넣고 ODA를 부른 뒤 결과를 읽는다', async () => {
    const exec = fakeExec('ok');
    const out = await new OdaConverter('C:\\ODA\\ODAFileConverter.exe', exec as never).dwgToDxf(Buffer.from('DWGDATA'));
    expect(out.toString()).toBe('DXF:DWGDATA');
    expect(exec).toHaveBeenCalledTimes(1);
    const args = exec.mock.calls[0][1];
    expect(args[3]).toBe('DXF');
    expect(args[6]).toBe('*.dwg');
  });

  it('DXF→DWG', async () => {
    const out = await new OdaConverter('oda', fakeExec('ok') as never).dxfToDwg('  0\nEOF\n');
    expect(out.toString()).toBe('DWG:  0\nEOF\n');
  });

  it('결과 파일이 없으면 throw', async () => {
    await expect(new OdaConverter('oda', fakeExec('nothing') as never).dwgToDxf(Buffer.from('x'))).rejects.toThrow('ODA 변환 결과가 없습니다');
  });

  it('exec 실패는 그대로 던진다', async () => {
    await expect(new OdaConverter('oda', fakeExec('throw') as never).dwgToDxf(Buffer.from('x'))).rejects.toThrow('exec failed');
  });
});
