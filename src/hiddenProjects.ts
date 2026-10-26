// 이 기기에서 숨긴 과업(최상위 프로젝트) id 목록 — hidden-projects.json(앱 문서 폴더). 2026-10-26 사용자 결정:
// 과업은 앱에서 지우지 않고 숨기기만 한다(원본은 웹). 앱을 껐다 켜도 유지되고, 다른 기기·서버에는 영향이 없다.
// 읽기·쓰기 실패는 삼킨다(lastProject.ts와 같은 태도) — 실패하면 다 보일 뿐이다.
import { File, Paths } from 'expo-file-system';

const FILE_NAME = 'hidden-projects.json';

function file(): File {
  return new File(Paths.document, FILE_NAME);
}

export function readHiddenProjects(): string[] {
  try {
    const f = file();
    if (!f.exists) return [];
    const parsed = JSON.parse(f.textSync()) as unknown;
    const ids = (parsed as { ids?: unknown } | null)?.ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeHiddenProjects(ids: string[]): void {
  try {
    file().write(JSON.stringify({ ids }));
  } catch {
    // 다음 실행에 다시 보일 뿐이다
  }
}
