// 서버로 보내기 전에 사진을 얼마나 줄일지 정하는 **순수 규칙**. 실제 축소(expo-image-manipulator)는
// src/photo.ts가 한다. 이 파일은 photoQueue.ts와 같은 이유로 **아무것도 import하지 않는다** —
// vitest(server/test/photoShrink.test.ts)가 상대 경로로 가져가 검사한다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 2장(2026-09-18 추가: 줄여서 올린다)

/** 긴 변의 상한(px). 사용자가 쓰던 PC 축소 설정(긴축 1600)과 같다. */
export const PHOTO_MAX_LONG_SIDE = 1600;
/** 서버로 보내는 JPEG 품질(0~1). 4~5MB 원본이 300~500KB가 된다. */
export const PHOTO_JPEG_QUALITY = 0.75;

export type ShrinkAction = { width: number } | { height: number } | null;

/**
 * 긴 변이 상한을 넘으면 그 변만 상한으로 맞춘다(짧은 변은 비율대로 따라온다 — "긴축 줄이기").
 * 세로 사진도 같은 규칙이다: 긴 변이 세로면 height를 맞춘다. 상한 이하이거나 크기를 모르면
 * 줄이지 않는다(null) — 화질을 다시 깎을 이유가 없다.
 */
export function shrinkAction(width: number, height: number, maxLongSide = PHOTO_MAX_LONG_SIDE): ShrinkAction {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (width < height) {
    return height > maxLongSide ? { height: maxLongSide } : null;
  }
  return width > maxLongSide ? { width: maxLongSide } : null;
}
