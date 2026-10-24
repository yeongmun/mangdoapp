// 촬영 항목의 기기 저장(2026-10-24). 서버 응답(shots)을 문서 폴더 shots/<projectId>.json에 두어
// 오프라인에서도 목록을 보여 주고, 찍은 직후의 로컬 표시(local: shotId → 사본 uri)를 같은 파일에 적는다.
// 읽기·쓰기 실패는 삼킨다(photoUpload.ts와 같은 이유 — 목록보다 앱이 뜨는 것이 중요).
import { Directory, File, Paths } from 'expo-file-system';
import type { ShotList } from './api';

export interface LocalShotState {
  /** 서버에서 마지막으로 받은 목록. 아직 못 받았으면 null */
  list: ShotList | null;
  fetchedAt: number;
  /** 이 기기에서 찍은 사진(서버에 올라갔든 아니든). 카드 표시에 서버 photo보다 우선 */
  local: Record<string, { uri: string; takenAt: number }>;
  /** 내려받아 둔 전차 참조 이미지(shotId → 기기 uri). 오프라인 표시용 */
  refs: Record<string, string>;
}

const DIR_NAME = 'shots';

function fileOf(projectId: string): File {
  return new File(new Directory(Paths.document, DIR_NAME), `${projectId}.json`);
}

export function readShotsLocal(projectId: string): LocalShotState {
  try {
    const file = fileOf(projectId);
    if (!file.exists) return { list: null, fetchedAt: 0, local: {}, refs: {} };
    const parsed = JSON.parse(file.textSync()) as Partial<LocalShotState>;
    return {
      list: parsed.list ?? null,
      fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
      local: parsed.local && typeof parsed.local === 'object' ? parsed.local : {},
      refs: parsed.refs && typeof parsed.refs === 'object' ? parsed.refs : {},
    };
  } catch {
    return { list: null, fetchedAt: 0, local: {}, refs: {} };
  }
}

export function writeShotsLocal(projectId: string, state: LocalShotState): void {
  try {
    new Directory(Paths.document, DIR_NAME).create({ intermediates: true, idempotent: true });
    fileOf(projectId).write(JSON.stringify(state));
  } catch (err) {
    console.warn('[shots] 기기 저장 실패', err instanceof Error ? err.message : String(err));
  }
}

/** 참조 이미지 기기 파일 자리. shots/ref/<shotId>.jpg */
export function refFileFor(shotId: string): File {
  const dir = new Directory(Paths.document, DIR_NAME, 'ref');
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, `${shotId}.jpg`);
}
