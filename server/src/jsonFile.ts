import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface RenameRetryOptions {
  attempts?: number;
  rename?: (from: string, to: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}

// Windows에서는 백신·색인 프로그램이 대상 파일을 잠깐 열고 있으면 rename이 EPERM/EACCES/EBUSY로 실패한다.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export async function renameWithRetry(from: string, to: string, options: RenameRetryOptions = {}): Promise<void> {
  const attempts = options.attempts ?? 5;
  const renameFile = options.rename ?? rename;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      await renameFile(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= attempts) throw err;
      await wait(50 * attempt);
    }
  }
}

// 임시 파일에 쓴 뒤 rename한다. 쓰는 도중 서버가 꺼져도 원래 파일은 깨지지 않는다.
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    await renameWithRetry(tempPath, filePath);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}
