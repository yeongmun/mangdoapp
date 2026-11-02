// 전송 상태(photoUpload의 UploadStatus)를 화면에서 쓰는 훅(2026-11-02). 대기열이 바뀌면 다시 그린다.
import { useEffect, useState } from 'react';
import { subscribeUploadStatus, uploadStatus, type UploadStatus } from './photoUpload';

export function useUploadStatus(): UploadStatus {
  const [s, setS] = useState(uploadStatus);
  useEffect(() => subscribeUploadStatus(setS), []);
  return s;
}
