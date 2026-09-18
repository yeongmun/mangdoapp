// 속성창 사진 줄의 순수 규칙. DOM을 건드리지 않으므로 vitest가 그대로 검사한다.
// 근거: docs/superpowers/specs/2026-09-18-photo-upload-design.md 5장

import { comparePhotoNumbers } from './quantities.js';

/**
 * @typedef {{ number: string, url: string, size: number, savedAt: string }} PhotoListItem
 * 서버 목록(GET …/photos)의 한 줄.
 * @typedef {{ kind: 'image', number: string, url: string } | { kind: 'missing', number: string }} PhotoStripItem
 */

/**
 * 사진 줄에 무엇을 그릴지 정한다.
 * - 서버에 파일이 있는 사진은 모두 썸네일(`image`)이다 — 번호 오름차순. 사진번호 칸에서 번호를
 *   지운 사진도 폴더에는 남아 있으므로 함께 보여준다(그렇지 않으면 사용자가 그 사진을 볼 길이 없다).
 * - 사진번호 칸에 있는데 파일이 없는 번호는 회색 칩(`missing`)이다 — 칸에 적힌 순서를 지킨다.
 *   앱이 올리기 전이거나 다른 사람이 손으로 적은 번호다.
 * @param {string[]} photoNumbers
 * @param {PhotoListItem[]} list
 * @returns {PhotoStripItem[]}
 */
export function photoStripItems(photoNumbers, list) {
  const numbers = Array.isArray(photoNumbers) ? photoNumbers : [];
  const photos = Array.isArray(list) ? list : [];
  const items = photos
    .slice()
    .sort((a, b) => comparePhotoNumbers(a.number, b.number))
    .map((photo) => ({ kind: 'image', number: photo.number, url: photo.url }));
  const onServer = new Set(photos.map((photo) => photo.number));
  for (const number of numbers) {
    if (!onServer.has(number)) items.push({ kind: 'missing', number });
  }
  return items;
}

/**
 * 도면 입력(그리기·탭)을 막아야 하는지. 속성창과 같은 가드에 사진 오버레이를 넣는다 —
 * 오버레이가 도면을 덮고 있는 동안 손가락이 새 손상을 만들면 안 된다(설계 5장).
 * @param {boolean} propsOpen
 * @param {boolean} photoViewOpen
 * @returns {boolean}
 */
export function blocksDrawing(propsOpen, photoViewOpen) {
  return propsOpen === true || photoViewOpen === true;
}
