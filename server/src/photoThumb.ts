// 사진 줄에 띄울 작은 썸네일을 만든다. 앱은 1600px 본 사진만 올리고(2026-09-18 설계 2장), 서버가
// 올릴 때 한 번 320px JPEG를 옆에 저장해 둔다 — 뷰어가 사진 줄을 열 때 장당 300~500KB 대신
// 15~25KB만 받는다. 앱이 항상 JPEG로 보내므로 sharp의 HEIC 지원은 필요 없다.
import sharp from 'sharp';

/** 썸네일 긴 변 상한(px). 뷰어 사진 줄은 56px 높이라 3배 화면에서도 충분하다. */
export const THUMB_MAX_PX = 320;
/** 썸네일 JPEG 품질. */
export const THUMB_QUALITY = 60;

/**
 * 본 사진 바이트에서 썸네일 JPEG 바이트를 만든다. EXIF 회전을 적용해 세로로 찍은 사진이 눕지
 * 않게 한다. 상한보다 작은 사진은 키우지 않는다. 사진이 아니면(깨진 파일 등) 거부한다 —
 * 호출부는 썸네일 없이도 본 사진 저장을 성공으로 처리해야 한다.
 */
export async function makeThumbnail(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer();
}
