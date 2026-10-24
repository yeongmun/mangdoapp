// zip 읽기(2026-10-24). hwpx가 zip이라 필요하다. 중앙 디렉터리(PK\x01\x02)를 거꾸로 찾아 항목을 모은다 —
// 로컬 헤더의 크기 필드는 데이터 디스크립터를 쓰면 0일 수 있어 중앙 디렉터리가 정확하다.
// store(0)·deflate(8)만 지원. 암호·zip64는 없다(한컴이 만드는 hwpx는 둘 다 안 쓴다).
import { inflateRawSync } from 'node:zlib';

const CD_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_SIG = 0x04034b50;

export function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // EOCD는 끝에서 22바이트 + 주석(최대 65535) 안에 있다
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('zip 형식이 아닙니다(중앙 디렉터리 없음).');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_SIG) throw new Error('zip 중앙 디렉터리가 손상됐습니다.');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error(`zip 항목이 손상됐습니다: ${name}`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    else throw new Error(`지원하지 않는 압축 방식(${method}): ${name}`);
  }
  return out;
}
