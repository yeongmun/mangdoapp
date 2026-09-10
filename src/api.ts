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

export function viewerUrl(drawingId: string): string {
  return `${API_URL}/viewer.html?id=${encodeURIComponent(drawingId)}#key=${encodeURIComponent(ACCESS_KEY)}`;
}
