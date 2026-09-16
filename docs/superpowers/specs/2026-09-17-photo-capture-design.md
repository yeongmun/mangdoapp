# 카메라 버튼 — 찍은 사진의 번호를 사진번호 칸에 자동으로 넣는다

- 날짜: 2026-09-17
- 앞선 설계: `2026-09-13-damage-attributes-design.md` 9장(사진번호), `2026-09-16-label-layout-design.md` 3장(`#12, #13` 표기)
- 상태: 설계 승인됨(사용자 확인 2026-09-17: "위 규칙으로 만들어줘"). 사진 파일을 서버에 보관하는 것은 **이번 범위 밖**(기능명세서 4단계 사진 첨부에서 다룬다).

## 1. 목표

속성창의 사진번호 칸 옆에 **📷 버튼**. 누르면 태블릿 카메라가 열리고, 찍은 사진은 기기 앨범에 저장되며, 그 사진의 **번호**가 사진번호 칸에 자동으로 붙는다(쉼표로 이어짐). 사용자가 나중에 앨범에서 그 번호로 사진을 찾는다.

사용자 규칙(2026-09-17):
- 아이폰: 앨범 파일명 `IMG_1234` → 사진번호 `1234`
- 안드로이드: 앨범 파일명 `20260917_101530` → 사진번호 `101530`

## 2. 조사 결과가 정한 방식 (`.superpowers/sdd/2026-09-17-photo-capture/research.md`)

- 앱 안에서 카메라를 열면(`expo-image-picker` `launchCameraAsync`) 파일명은 앱이 정한다. 갤럭시 카메라 앱의 `날짜_시각` 이름이 저절로 붙지 않으므로 **앱이 같은 규칙으로 이름을 짓는다**: 찍은 시각으로 `YYYYMMDD_HHMMSS.jpg`.
- 앨범에 저장(`expo-media-library` `createAssetAsync`)하면 **안드로이드는 그 이름이 유지**되고(경험칙 — 실기기 확인 항목), **iOS는 사진 앱이 `IMG_0021.JPG`처럼 새 이름을 붙인다**. 저장 결과의 `asset.filename`이 그 이름이다. 두 경우 모두 사용자 규칙과 맞아떨어진다 — 안드로이드는 `_` 뒤 6자리, iOS는 `IMG_` 뒤 숫자.
- Expo Go에서도 카메라·앨범 저장이 된다. `app.json`의 권한 문구 플러그인은 나중에 별도 빌드를 만들 때를 위해 지금 넣어 둔다(Expo Go에서는 효과 없음).

## 3. 번호 규칙 (순수 함수, 화면·테스트 공용)

`server/public/viewer/quantities.js`:

```js
photoNumberFromFilename(filename) → string
```

1. `IMG_(\d+)` (대소문자 무관, 확장자 무시) → 그 숫자 (`IMG_0021.JPG` → `0021`, 앞 0 유지 — 앨범에 보이는 그대로)
2. `\d{8}_(\d{6})` → 뒤 6자리 (`20260917_101530.jpg` → `101530`)
3. 그 밖: 확장자를 뗀 파일명 그대로 (`DSC_0001` → `DSC_0001`)
4. 빈 값·문자열 아님 → `''`

```js
appendPhotoNumber(currentText, number) → string
```
현재 칸 문자열을 `parsePhotoNumbers`로 나눠 번호를 뒤에 붙이고(이미 있으면 그대로) `', '`로 잇는다. `number`가 `''`이면 바꾸지 않는다.

## 4. 앱 ↔ 뷰어 메시지

뷰어(WebView 페이지) → 앱: 이미 있는 `postMessage(JSON)`(`{ type: 'ready' }`·`flushResult`와 같은 통로).

- `{ type: 'takePhoto', requestId }` — 📷를 눌렀을 때. `requestId`는 뷰어가 만든 문자열(늦게 온 답을 버리기 위해).

앱 → 뷰어: `webViewRef.injectJavaScript('window.mangdoPhotoResult(' + JSON + '); true;')` (기존 `mangdoFlush`와 같은 방식).

- `{ requestId, ok: true, filename }` — `filename`은 앨범에 저장된 결과의 `asset.filename`(없으면 앱이 지은 이름).
- `{ requestId, ok: false, reason }` — `reason`: `'취소'`(사용자가 카메라를 닫음), `'카메라 권한이 없습니다'`, `'앨범 저장 권한이 없습니다'`, `'사진을 저장하지 못했습니다: …'`, `'이 환경에서는 카메라를 쓸 수 없습니다'`(웹 브라우저 등 `ReactNativeWebView`가 없을 때 — 뷰어가 앱에 보내지 않고 바로 표시).

## 5. 앱 쪽 (`src/screens/ViewerScreen.tsx`, 새 `src/photo.ts`)

`takePhotoAndSave(): Promise<{ ok: true, filename } | { ok: false, reason }>` (`src/photo.ts`, 순수하지 않지만 RN 의존을 한 파일에 모은다):

1. `ImagePicker.requestCameraPermissionsAsync()` → 거부면 `카메라 권한이 없습니다`.
2. `ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })` → `canceled`면 `취소`.
3. 파일명 `YYYYMMDD_HHMMSS.jpg`(기기 로컬 시각)로 캐시 폴더에 복사(`expo-file-system` `File`/`Paths.cache`; 같은 이름이 있으면 덮어쓰기 시도, 실패하면 원본 uri 그대로 진행).
4. `MediaLibrary.requestPermissionsAsync(true)`(쓰기 전용) → 거부면 `앨범 저장 권한이 없습니다`.
5. `MediaLibrary.createAssetAsync(uri)` → `asset.filename ?? 지은 이름`을 돌려준다. 앨범 이름을 따로 만들지 않는다(기본 카메라 앨범/DCIM — 사용자가 늘 보던 곳).
6. 예외는 `사진을 저장하지 못했습니다: <message>`.

`ViewerScreen.handleMessage`에 `takePhoto` 분기: `takePhotoAndSave()` 결과에 `requestId`를 붙여 `injectJavaScript`. 한 번에 한 요청만 처리한다(진행 중이면 새 요청은 `취소`로 답하지 않고 무시 — 버튼이 뷰어에서 비활성이라 실제로는 오지 않는다).

`app.json` plugins에 `["expo-image-picker", { "cameraPermission": "손상 사진을 찍기 위해 카메라를 씁니다." }]`, `["expo-media-library", { "savePhotosPermission": "찍은 사진을 앨범에 저장합니다.", "isAccessMediaLocationEnabled": false }]`.

## 6. 뷰어 쪽 (`server/public/viewer.html`, `main.js`)

- 사진번호 입력 옆 `<button id="photoCamera" type="button" title="사진 찍기">📷</button>`.
- 누르면: `ReactNativeWebView`가 없으면 `#propsError`에 `이 환경에서는 카메라를 쓸 수 없습니다`(PC 브라우저). 있으면 버튼을 비활성(`⏳`)으로 바꾸고 `takePhoto` 메시지를 보낸다. 15초 안에 답이 없으면 버튼을 되살리고 `카메라 응답이 없습니다`.
- `window.mangdoPhotoResult(result)`: `requestId`가 다르면 무시. `ok`면 `appendPhotoNumber`로 칸을 채우고 `updateSummary()`; 아니면 `#propsError`에 `reason`. 버튼을 되살린다.
- 속성창이 그새 닫혔으면(다른 손상 선택 등) 결과를 버린다 — 잘못된 손상에 번호가 붙지 않게.
- 찍는 동안 속성창은 열린 채다(카메라가 앱 위에 뜨는 것이라 WebView 상태가 유지된다 — 조사 4번).

## 7. 검증

- 단위(`server/test/quantities.test.ts`): `photoNumberFromFilename` 4가지 규칙, `appendPhotoNumber`(빈 칸·이미 있는 번호·빈 번호·공백 정리).
- 앱: `npx tsc --noEmit`(루트) 통과. `src/photo.ts`는 RN 모듈이라 단위 테스트 없음 — 읽기로 확인.
- 뷰어: `node --check main.js`, 읽기.
- 실기기(사용자): 갤럭시 — 📷 → 찍기 → 칸에 `HHMMSS` 6자리가 붙고 앨범에 `20260917_HHMMSS.jpg`가 있는지; 아이패드 — `IMG_` 뒤 숫자가 붙고 사진 앱의 정보에서 같은 번호가 보이는지; 취소·권한 거부 시 메시지; PC 브라우저에서 📷 누르면 안내만 뜨는지. **앱 재시작 필요**(새 네이티브 모듈 — Expo Go는 재시작으로 충분).

## 8. 미해결

- 안드로이드에서 `createAssetAsync`가 파일명을 유지하는 것은 문서화된 보장이 아니다. 실기기에서 다르면 `asset.filename`을 그대로 규칙 3에 태워 어떤 이름이든 번호는 남는다.
- 같은 초에 두 장을 찍으면 안드로이드 번호가 겹친다 — 현장에서 드물다.
- 사진 파일을 서버에 보관해 손상에 붙이는 것은 4단계에서 같은 메시지 통로를 써서 한다.
