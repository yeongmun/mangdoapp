// 📷 버튼(2026-09-17 카메라 버튼 설계 5장): 카메라로 사진 1장을 찍어 기기 앨범에 저장하고,
// 그 결과(파일명 또는 실패 사유)를 돌려준다. RN 네이티브 의존(ImagePicker·FileSystem·MediaLibrary)을
// 한 파일에 모은다 — 순수하지 않다. src/screens/ViewerScreen.tsx가 이 결과를 뷰어(WebView)에
// injectJavaScript로 회신한다.
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
// createAssetAsync는 최신 index가 아니라 legacy에만 있다(Asset.create()로 대체 예정이지만,
// filename을 바로 돌려주는 건 legacy뿐 — 조사 2장).
import * as MediaLibrary from 'expo-media-library/legacy';

export type PhotoResult = { ok: true; filename: string } | { ok: false; reason: string };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// 캐시에 복사할 때 붙일 파일명. 기기 로컬 시각으로 YYYYMMDD_HHMMSS.jpg를 짓는다 — 갤럭시 카메라
// 앱이 스스로 붙이는 이름 규칙과 맞춰(설계 2장), 안드로이드에서 앨범 파일명이 그대로 유지될 때
// 사용자 규칙(밑줄 뒤 6자리 = 시각)과 들어맞게 한다. 순수 함수라 Date만 주면 읽기로 확인할 수 있다.
export function photoFileName(date: Date): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}${m}${d}_${hh}${mm}${ss}.jpg`;
}

export async function takePhotoAndSave(): Promise<PhotoResult> {
  try {
    // 1. 카메라 권한.
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermission.granted) return { ok: false, reason: '카메라 권한이 없습니다' };

    // 2. 촬영. 크롭 없이 원본 화질 그대로 받는다(조사 1장).
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return { ok: false, reason: '취소' };
    const asset = result.assets[0];
    if (!asset) return { ok: false, reason: '취소' };

    // 3. 우리 규칙의 파일명으로 캐시에 복사한다. 실패하면(이미 있음·쓰기 불가 등) 원본 uri로 진행한다.
    const ourName = photoFileName(new Date());
    let uri = asset.uri;
    try {
      const sourceFile = new File(uri);
      const destFile = new File(Paths.cache, ourName);
      await sourceFile.copy(destFile, { overwrite: true });
      uri = destFile.uri;
    } catch {
      // 원본 uri 그대로 진행 — 아래 앨범 저장은 그래도 될 수 있다.
    }

    // 4. 앨범 저장 권한(쓰기 전용으로 충분하다).
    const mediaPermission = await MediaLibrary.requestPermissionsAsync(true);
    if (!mediaPermission.granted) return { ok: false, reason: '앨범 저장 권한이 없습니다' };

    // 5. 앨범에 저장. asset.filename이 있으면 그것을(iOS는 IMG_로 다시 지어짐 — 조사 2장), 없으면
    // 우리가 지은 이름을 돌려준다. 앨범을 따로 만들지 않는다 — 기본 카메라 앨범/DCIM.
    const savedAsset = await MediaLibrary.createAssetAsync(uri);
    return { ok: true, filename: savedAsset.filename || ourName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `사진을 저장하지 못했습니다: ${message}` };
  }
}
