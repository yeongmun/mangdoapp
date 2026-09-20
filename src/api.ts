import { ACCESS_KEY, API_URL } from './config';

export type DrawingStatus = 'pending' | 'inprogress' | 'success' | 'failed';

export interface Drawing {
  id: string;
  name: string;
  status: DrawingStatus;
  progress: string;
  error: string | null;
  uploadedAt: string;
}

export async function fetchDrawings(): Promise<Drawing[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings`, { headers: { 'x-access-key': ACCESS_KEY } });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  if (!res.ok) throw new Error(`도면 목록을 불러오지 못했습니다 (${res.status}).`);
  return (await res.json()) as Drawing[];
}

// 도면 삭제 = 서버 휴지통으로 옮기기(손상 기록·사진도 함께). PC 업로드 페이지의 휴지통에서 복구한다.
export async function deleteDrawing(drawingId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/drawings/${encodeURIComponent(drawingId)}`, {
      method: 'DELETE',
      headers: { 'x-access-key': ACCESS_KEY },
    });
  } catch {
    throw new Error('서버에 연결할 수 없습니다. PC의 서버와 터널이 켜져 있는지 확인하세요.');
  }
  if (res.status === 401) throw new Error('접근키를 확인하세요.');
  // 이미 다른 기기에서 지운 도면이면 목적은 이뤄졌다 — 목록만 새로 고치면 된다.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`도면을 삭제하지 못했습니다 (${res.status}).`);
}

export function viewerUrl(drawingId: string): string {
  return `${API_URL}/viewer.html?id=${encodeURIComponent(drawingId)}#key=${encodeURIComponent(ACCESS_KEY)}`;
}
