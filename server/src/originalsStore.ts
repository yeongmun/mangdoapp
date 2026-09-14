// 업로드한 원본 파일을 서버에 보관한다. DXF 산출은 이 사본에서 시작한다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 2장

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './jsonFile.js';

// 업로드 라우트가 만드는 이름만 받는다. 경로 조각이 섞여 들어오면 던진다.
const OBJECT_KEY_PATTERN = /^d_[0-9a-f]{32}\.(dwg|dxf)$/;

export class OriginalsStore {
  constructor(private readonly dir: string) {}

  async save(objectKey: string, data: Buffer): Promise<void> {
    await writeFileAtomic(this.pathFor(objectKey), data);
  }

  async read(objectKey: string): Promise<Buffer | null> {
    const path = this.pathFor(objectKey);
    try {
      return await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private pathFor(objectKey: string): string {
    if (!OBJECT_KEY_PATTERN.test(objectKey)) throw new Error(`잘못된 파일 이름: ${objectKey}`);
    return join(this.dir, objectKey);
  }
}
