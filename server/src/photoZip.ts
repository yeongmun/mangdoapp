// 도면 전체 사진 zip의 항목 이름을 짓는다. 파일 I/O가 없는 순수 함수라 손으로 계산한 값으로
// 검사할 수 있다. 번호와 손상현황은 화면·산출 DXF와 **같은 함수**로 구한다 — 사용자가 zip 이름과
// 산출 도면을 나란히 놓고 보기 때문이다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 3장 + 9장(규칙 보완)

import { frameIndexOf, statusTextOf } from '../public/viewer/quantities.js';
import type { FrameBounds } from './export/frames.js';
import type { PhotoEntry } from './photosStore.js';

export interface ZipEntry {
  /** zip 안에서 보일 이름 */
  name: string;
  /** 그 이름으로 넣을 파일 */
  entry: PhotoEntry;
}

// 파일 이름에 쓸 수 없는 글자. 손상현황에 '/'가 들어가는 유형이 있고('균열/백태'), 기타 유형은
// 사용자가 아무 글자나 적을 수 있다. '/'를 그대로 두면 zip 안에 폴더가 생겨 버린다.
const UNSAFE_NAME = /[\\/:*?"<>|\r\n\t]/g;

export function sanitizeEntryName(text: string): string {
  return String(text).replace(UNSAFE_NAME, '_');
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot <= 0 ? '' : file.slice(dot);
}

function photoNumbersOf(damage: unknown): string[] {
  const value = (damage as { attrs?: { photoNumbers?: unknown } } | null)?.attrs?.photoNumbers;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * zip에 넣을 항목과 그 이름. 규칙(스펙 3장·9장):
 * - `attrs.photoNumbers`에 있는 번호 중 **파일이 있는 것**만 `<망도틀번호>_<손상현황>_<사진번호><확장자>`.
 * - 번호는 `computeNumbers`(틀마다 1번부터). 틀 밖이라 번호가 없으면 `X`.
 * - 같은 손상 폴더에 있지만 칸에 없는 번호는 `미연결_<손상id 앞 8자>_<사진번호><확장자>` —
 *   사진을 버리지 않는다.
 * - 손상 기록에 없는 폴더(지운 손상)는 `삭제된손상_<손상id 앞 8자>_<사진번호><확장자>`.
 * - 틀마다 1번부터라 이름이 겹칠 수 있다. 겹치면 확장자 앞에 ` (2)`, ` (3)`…을 붙인다.
 */
/**
 * 사진 이름 맨 앞의 망도틀 번호(2026-09-30 사용자 요청: `망도틀번호_손상현황_사진번호`). 틀은 서버가 왼쪽→
 * 오른쪽으로 정렬해 두므로(번호 매기기와 같은 순서) 1부터 세 자리(001, 002…)로 쓴다. 틀 밖 손상은 `X`,
 * 틀이 하나도 없는 도면은 `000`이다.
 */
export function frameLabelOf(damage: unknown, frames: FrameBounds[]): string {
  if (frames.length === 0) return '000';
  const index = frameIndexOf(damage, frames);
  return index === null ? 'X' : String(index + 1).padStart(3, '0');
}

export function zipEntryNamesFor(damages: unknown[], frames: FrameBounds[], files: PhotoEntry[]): ZipEntry[] {
  const list = Array.isArray(damages) ? damages : [];
  const frameList = Array.isArray(frames) ? frames : [];

  // 손상 폴더별로 모은다. listDrawing이 손상 id 오름차순·번호 오름차순으로 주므로 순서가
  // 흔들리지 않는다(Map은 넣은 순서를 지킨다).
  const byDamage = new Map<string, PhotoEntry[]>();
  for (const file of Array.isArray(files) ? files : []) {
    const bucket = byDamage.get(file.damageId);
    if (bucket) bucket.push(file);
    else byDamage.set(file.damageId, [file]);
  }

  const result: ZipEntry[] = [];
  const used = new Set<string>();
  const push = (base: string, entry: PhotoEntry): void => {
    const extension = extensionOf(entry.file);
    let name = `${base}${extension}`;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})${extension}`;
    used.add(name);
    result.push({ name, entry });
  };

  for (const damage of list) {
    const id = String((damage as { id?: unknown } | null)?.id ?? '');
    const bucket = byDamage.get(id);
    if (!bucket) continue;
    byDamage.delete(id);
    const prefix = `${frameLabelOf(damage, frameList)}_${sanitizeEntryName(statusTextOf(damage))}`;
    const linked = new Set<string>();
    for (const photoNumber of photoNumbersOf(damage)) {
      const found = bucket.find((item) => item.number === photoNumber);
      if (!found) continue;
      linked.add(found.number);
      push(`${prefix}_${found.number}`, found);
    }
    for (const item of bucket) {
      if (linked.has(item.number)) continue;
      push(`미연결_${id.slice(0, 8)}_${item.number}`, item);
    }
  }

  for (const [id, bucket] of byDamage) {
    for (const item of bucket) push(`삭제된손상_${id.slice(0, 8)}_${item.number}`, item);
  }
  return result;
}
