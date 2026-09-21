// 목록 화면의 마지막 위치(last-project.json, 앱 문서 폴더)를 읽고 쓴다. 읽기·쓰기는 모두 실패를
// 삼킨다 — 사진 대기열(photoUpload.ts readQueue)과 같은 태도다. 이 자리는 "편의"일 뿐이라
// 저장에 실패해도 앱은 그냥 맨 위에서 시작한다. 근거:
// docs/superpowers/specs/2026-09-21-projects-design.md 6장
import { File, Paths } from 'expo-file-system';
import type { ListLocation } from './projectList';

const FILE_NAME = 'last-project.json';

function file(): File {
  return new File(Paths.document, FILE_NAME);
}

function isValidLocation(value: unknown): value is ListLocation {
  return value === null || typeof value === 'string';
}

export function readLastLocation(): ListLocation {
  try {
    const f = file();
    if (!f.exists) return null;
    const parsed = JSON.parse(f.textSync()) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const location = (parsed as Record<string, unknown>).location;
    return isValidLocation(location) ? location : null;
  } catch {
    return null;
  }
}

export function writeLastLocation(location: ListLocation): void {
  try {
    file().write(JSON.stringify({ location }));
  } catch {
    // 다음에 맨 위에서 시작할 뿐이다 — 사진 몇 장보다 중요하지 않다.
  }
}
