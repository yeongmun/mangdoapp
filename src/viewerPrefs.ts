// 뷰어 보기 방식(전체 | 페이지)과 도면별 마지막 페이지(viewer-prefs.json, 앱 문서 폴더)를 읽고 쓴다.
// lastProject.ts와 같은 태도로 읽기·쓰기 실패는 모두 삼킨다 — 편의일 뿐이라 못 읽으면 전체 보기로
// 시작한다. 근거: docs/superpowers/specs/2026-09-28-device-only-and-pages-design.md 2.1
import { File, Paths } from 'expo-file-system';

export type ViewMode = 'all' | 'page';

export interface ViewerPrefs {
  viewMode: ViewMode;
  /** 도면 id → 마지막으로 본 페이지(0부터). */
  pages: Record<string, number>;
}

const FILE_NAME = 'viewer-prefs.json';

function file(): File {
  return new File(Paths.document, FILE_NAME);
}

function defaults(): ViewerPrefs {
  return { viewMode: 'all', pages: {} };
}

export function readViewerPrefs(): ViewerPrefs {
  try {
    const f = file();
    if (!f.exists) return defaults();
    const parsed = JSON.parse(f.textSync()) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return defaults();
    const raw = parsed as Record<string, unknown>;
    const pages: Record<string, number> = {};
    if (typeof raw.pages === 'object' && raw.pages !== null) {
      for (const [id, index] of Object.entries(raw.pages as Record<string, unknown>)) {
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0) pages[id] = index;
      }
    }
    return { viewMode: raw.viewMode === 'page' ? 'page' : 'all', pages };
  } catch {
    return defaults();
  }
}

export function writeViewerPrefs(prefs: ViewerPrefs): void {
  try {
    file().write(JSON.stringify(prefs));
  } catch {
    // 다음에 전체 보기·첫 페이지로 시작할 뿐이다.
  }
}
