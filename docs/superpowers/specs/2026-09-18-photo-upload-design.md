# 사진 파일 서버 보관 — 찍은 사진을 손상에 붙인다 (앨범 + 서버)

- 날짜: 2026-09-18
- 앞선 설계: `2026-09-17-photo-capture-design.md`(📷 버튼, 앱↔뷰어 메시지, 사진번호 규칙), `2026-09-13-damage-attributes-design.md` 9장(사진번호)
- 기능명세서 4단계 "사진 첨부"의 첫 구현. 상태: 설계 승인됨(사용자 2026-09-18: "둘 다 남겨줘 … 바로 작업해줘").

## 1. 목표

📷로 찍은 사진이 **앨범에도 남고 서버에도 올라가** 그 손상에 붙는다. 사진번호 글자는 지금처럼 저장된다. 그 위에:

- 앱 속성창에서 그 손상의 사진 **썸네일**을 보고, 눌러 크게 본다.
- PC 업로드 페이지에서 도면의 사진을 **zip으로 내려받는다**(`손상번호_유형_사진번호.jpg`).
- 폰을 바꾸거나 앨범을 지워도 사진은 서버에 남는다.

범위 밖: 앨범에서 고르기(기존 사진 올리기), 사진 삭제·교체, 보고서 자동 작성, 산출 DXF에 사진 넣기.

## 2. 저장 — 파일과 연결 방식

- 서버 폴더: `server/data/photos/<drawingId>/<damageId>/<사진번호>.jpg`. 사진번호는 `photoNumberFromFilename`(2026-09-17 설계 3장)으로 서버가 파일명에서 뽑는다 — 뷰어와 같은 함수(`quantities.js`)를 서버도 부른다.
- **손상 기록(schemaVersion 5)은 바꾸지 않는다.** 연결은 폴더 구조가 곧 데이터다: 손상의 `attrs.photoNumbers`에 있는 번호 중 파일이 있는 것이 "붙은 사진"이다. 같은 번호가 다른 손상에 있어도 폴더가 다르니 섞이지 않는다.
- 같은 손상·같은 번호로 다시 올리면 덮어쓴다(같은 초에 두 장 = 같은 번호는 현장에서 드물다 — 2026-09-17 설계 8장).
- 파일 크기 상한 20MB, `image/jpeg`·`image/heic`·`image/png`만. 서버는 본 사진의 내용을 바꾸지 않고 그대로 둔다.
- **줄여서 올린다(2026-09-18 추가, 사용자 요청 "원본 그대로면 용량이 금방 찬다")**: 앱이 찍은 직후 `expo-image-manipulator`로 긴 변 1600px(`src/photoShrink.ts`의 `shrinkAction` — 사용자의 PC 축소 설정 "긴축 줄이기 1600"과 같다), JPEG 75%로 다시 저장한 사본만 보낸다. 앨범에는 원본이 남는다. 줄이기가 실패하면 원본을 보낸다. 부수 효과로 HEIC는 항상 JPEG가 되어 9장의 HEIC 썸네일 문제가 사라진다.
- **썸네일**: 서버가 올릴 때 `sharp`로 320px(긴 변)·JPEG 60% 썸네일을 `<사진번호>.thumb.jpg`로 옆에 둔다(`server/src/photoThumb.ts`). 이름에 `.`이 들어가 목록·zip에는 섞이지 않는다. 못 만들면(사진이 아닌 바이트) 본 사진 저장은 그대로 성공이고 썸네일 주소가 404 — 뷰어는 본 사진으로 대신한다. 같은 번호를 다시 올리면 옛 썸네일을 먼저 지운다.

## 3. API (접근키 필요, 다른 API와 같다)

| 메서드·경로 | 하는 일 |
|---|---|
| `POST /api/drawings/:id/damages/:damageId/photos` (multipart, 필드 `file`) | 저장. 응답 `201 { number, url }`. 도면 없음 404, 파일 없음/형식 밖 400, 번호를 못 뽑음(`''`) 400, 크기 초과 413 |
| `GET /api/drawings/:id/damages/:damageId/photos` | 그 손상의 사진 목록 `[{ number, url, thumbUrl, size, savedAt }]` (번호 오름차순) |
| `GET /api/drawings/:id/damages/:damageId/photos/:number/thumb` | 320px 썸네일(`image/jpeg`). 파일이 없으면 본 사진에서 지금 만들어 저장한 뒤 준다. 못 만들면 404 `썸네일을 만들 수 없습니다.` |
| `GET /api/drawings/:id/damages/:damageId/photos/:number` | 사진 파일 그대로(`Content-Type` 저장 시 값, `Cache-Control: private, max-age=3600`) |
| `GET /api/drawings/:id/photos.zip` | 도면 전체 사진 zip. 항목 이름 `<번호>_<손상현황>_<사진번호>.jpg` — 번호는 `computeNumbers(list, frames)`로 지금 규칙(틀별)대로, 번호 없는 손상은 `X`, 손상현황은 `statusTextOf`. 손상 기록에 없는 손상 폴더(지운 손상)의 사진은 `삭제된손상_<damageId 앞 8자>_<사진번호>.jpg`로 넣는다 — 사진은 버리지 않는다. 사진이 하나도 없으면 400 `저장된 사진이 없습니다` |

- `:damageId`는 UUID 형식만 받는다(경로 조작 방지). `:number`는 영문·숫자·`-`·`_`만.
- zip은 의존성 하나(`archiver`)로 스트리밍한다.
- 업로드는 `multer` 메모리 저장(기존 DXF 업로드와 같은 방식) → `writeFileAtomic`.

## 4. 앱 — 찍은 뒤 올리기와 재시도 (`src/photo.ts`, 새 `src/photoUpload.ts`)

`takePhoto` 메시지에 `drawingId`·`damageId`가 실려 온다(뷰어가 선택된 손상을 안다).

1. 지금처럼 찍고 앨범에 저장한다(2026-09-17 설계 5장). 여기까지 성공하면 뷰어에 먼저 답한다: `{ requestId, ok: true, filename, uploaded: false }` → 뷰어는 번호를 칸에 붙인다(사용자는 기다리지 않는다).
2. 이어서 서버에 올린다(`expo-file-system`의 `File.upload` 네이티브 multipart, `x-access-key`; `filename` 파라미터를 file 파트보다 앞에 보낸다 — Expo SDK 57의 `fetch`는 `{ uri, name, type }` 파일 파트를 거절해 2026-09-18 현장 진단 후 바꿈). 성공하면 `window.mangdoPhotoUploaded({ requestId, damageId, number })`로 알린다 → 뷰어는 썸네일을 새로 읽는다. 실패하면 **대기열**에 넣고 `window.mangdoPhotoUploadFailed({ requestId, damageId, reason })` → 뷰어는 `사진은 앨범에 저장됐고 서버 전송은 다시 시도합니다`를 보여준다.
3. 대기열(`src/photoUpload.ts`): 앱 문서 폴더의 `photo-queue.json`에 `[{ drawingId, damageId, uri(캐시 사본), filename, addedAt, tries }]`. 캐시 사본은 앨범 저장과 별개로 앱이 지운 뒤에도 남도록 `Paths.document` 아래에 복사해 둔다(앨범 파일은 권한 문제로 다시 읽기 어렵다).
4. 재시도 시점: 뷰어 화면이 열릴 때(`ViewerScreen` mount), 새 사진을 올린 직후, 그리고 화면에 있는 동안 60초마다. 성공하면 항목과 캐시 사본을 지운다. 10번 실패한 항목은 그대로 두고 더 시도하지 않는다(목록 화면 상단에 `보내지 못한 사진 N장` 배지 — 누르면 다시 시도).
5. 서버가 400(형식·번호)을 주면 재시도해도 소용없으니 대기열에서 빼고 뷰어에 사유를 보낸다.

## 5. 뷰어 — 썸네일 (`viewer.html`, `main.js`)

- 속성창 사진번호 줄 아래에 `#photoStrip`: 가로로 나열되는 썸네일(높이 56px). `openProps`에서 `GET …/photos`로 목록을 읽어 그린다(번호 순). 줄에는 `thumbUrl`(320px)만 받고(404면 본 사진), 누르면 썸네일을 먼저 크게 띄운 뒤 본 사진(`url`)을 받아 바꿔 끼운다. 사진번호 칸에 있는 번호 중 파일이 없는 것은 회색 글자 칩으로 표시(`101530 (서버에 없음)`).
- 썸네일을 누르면 화면 전체 오버레이(`#photoView`)에 원본을 띄우고, 어디든 누르면 닫는다. 오버레이가 열린 동안 그리기·탭은 막는다(`isPropsOpen`과 같은 가드에 포함).
- `mangdoPhotoUploaded`가 오면 지금 열린 손상이 그 `damageId`일 때만 목록을 다시 읽는다.
- PC 브라우저에서는 📷는 안내만(지금과 같다) 하지만 썸네일 보기는 된다.

## 6. PC 업로드 페이지 (`upload.html`, `upload.js`)

- 도면 줄에 **사진 zip** 버튼(DXF 내려받기 옆). 사진이 없으면 서버 400 메시지를 그대로 보여준다.
- 파일명 `<도면이름>_사진.zip`.

## 7. 바뀌지 않는 것

- 사진번호 글자·라벨·물량표·산출 DXF. 손상 기록 형식(v5). 📷 버튼의 촬영·앨범 저장·번호 규칙.

## 8. 검증

단위(vitest):
- 서버: 업로드(201·저장 경로·덮어쓰기·404·400·413·id 검증), 목록, 파일 응답 헤더, zip 항목 이름(틀별 번호·`X`·삭제된 손상 폴더), `photoNumberFromFilename`을 서버가 같은 결과로 쓰는지.
- 뷰어 순수 부분: 썸네일 목록 → 칩/이미지 구분(`photoStripItems(photoNumbers, list)`), 오버레이 열림 가드.
- 앱: `src/photoUpload.ts`의 대기열 판단은 순수 함수(`nextRetry(queue, now)`, `applyResult(queue, item, outcome)`)로 빼서… 루트에 테스트 러너가 없으므로 이 함수들은 `server/public/viewer/`가 아닌 `src/`에 있어 vitest가 못 본다 → 대기열 규칙 함수는 `src/photoQueue.ts`에 두고 `server/test/photoQueue.test.ts`가 상대 경로로 가져와 검사한다(`server/tsconfig`가 `../src/*.ts`를 포함하도록 — 안 되면 함수를 `server/public/viewer/photoQueue.js`에 두고 앱이 그 파일을 가져온다. 계획에서 확인).

실기기(사용자): 📷 → 번호가 붙고 잠시 뒤 썸네일이 뜨는지; 서버를 끈 채 찍으면 앨범엔 저장되고 안내가 뜨는지, 서버를 켜고 뷰어를 다시 열면 올라가는지; PC에서 사진 zip 이름이 `1_균열(0.3mm미만)_101530.jpg` 형식인지; 아이패드 HEIC가 썸네일로 보이는지(안 보이면 후속).

## 9. 미해결

- ~~HEIC 썸네일이 안드로이드 WebView·PC 브라우저에서 안 보일 수 있다 → 서버 변환(sharp) 후속.~~ 2026-09-18: 앱이 항상 JPEG로 줄여 올리므로 해소. 옛 서버에 남은 HEIC 원본은 sharp가 못 읽어 썸네일 404 → 본 사진으로 대신한다.
- 사진 삭제·교체 UI 없음. 잘못 찍으면 다시 찍어 번호를 늘리고, 칸에서 옛 번호를 지우면 zip에는 폴더 사진이 `삭제된손상…`이 아니라 그 손상 이름으로 남는다 — zip은 `photoNumbers`에 있는 번호만 손상 이름으로 넣고, 없는 파일은 `미연결_…`로 넣는다(3장 규칙에 추가).
- 사진 용량(장당 3~5MB)이 서버 디스크에 쌓인다. 도면 삭제 기능(보류 중)이 생기면 함께 지운다.
