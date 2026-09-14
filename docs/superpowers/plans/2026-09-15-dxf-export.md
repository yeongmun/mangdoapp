# 2단계 — DXF 산출과 손상물량표 채우기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱에서 표기한 손상을 원본 DXF에 더해 내려받는다. 도면 위에는 손상 도형·기호·번호·치수가, 오른쪽 끝 손상물량표 칸 자리에는 손상마다 한 줄이 글자로 얹힌다. 원본의 다른 부분은 한 바이트도 바뀌지 않는다.

**Architecture:** 오토캐드를 쓰지 않는다. 서버가 DXF를 `(코드, 값)` 쌍 배열로 읽어, `ENTITIES`의 `ENDSEC` 바로 앞에 새 엔티티 쌍을 **끼워 넣고**, `$HANDSEED`와 `LAYER` 표만 고쳐 다시 쓴다. 전체를 객체로 바꿔 재직렬화하지 않는다. 표는 진짜 표 객체를 고치지 않고, `ACAD_TABLE`이 알려 주는 격자에서 칸 중앙 좌표를 구해 그 위에 `TEXT`를 얹는다. 문구를 만드는 함수(`statusTextOf`·`quantityOf`·`dimensionTextOf`·`photoTextOf`…)와 번호(`computeNumbers`), 라벨 배치(`labelAnchor`·`labelLayout`)는 **앱이 쓰는 `server/public/viewer/*.js`를 서버가 그대로 불러 쓴다** — 화면과 도면이 어긋날 수 없다.

**Tech Stack:** 기존과 동일 — Node.js 24, TypeScript(NodeNext, strict), Express 5, multer, vitest + supertest, 빌드 없는 ES 모듈 브라우저 JS(`server/public/viewer/*.js`, `allowJs: true`), Expo SDK 57 앱(이번 계획에서는 **변경 없음**)

**Spec:** `docs/superpowers/specs/2026-09-15-dxf-export-design.md`
앞선 설계 두 건이 그대로 유효하며 이 계획이 참조한다:
- `docs/superpowers/specs/2026-09-12-damage-types-design.md` — 유형표와 해치 축척(2장), 기호 치수(4.1절), DWG 출력 규칙(8장), `ANCHORLK` 패턴 정의(부록 A)
- `docs/superpowers/specs/2026-09-13-damage-attributes-design.md` — 측정값·파생값(§3), 저장 형식 v4(§4, §9), 라벨 배치(§5.2, §9.5), 번호는 `geometry.world`로 계산(§3.1, §7)

---

## Global Constraints

스펙에서 그대로 옮긴 구속값이다. 구현 중 판단이 갈리면 여기를 기준으로 한다.

### 작업 안전 규칙 (모든 Task에 적용)

- **`git checkout` / `git restore` / `git stash`를 절대 실행하지 않는다.** 앞선 작업에서 이 명령이 작성 중이던 문서를 통째로 날린 적이 있다. 되돌리고 싶으면 파일을 직접 고쳐라.
- `git add .` / `git add -A` / `git commit -a`를 쓰지 않는다. **파일 이름을 하나씩 적어** `git add <경로> <경로>` 로만 스테이징한다.
- `server/data/`, `.env`, `docs/*.dxf`, `docs/*.bak`는 커밋 대상이 아니다(`.gitignore`).
- 모든 커밋 메시지의 마지막 줄은 정확히 다음과 같다(글자 하나도 다르면 안 된다):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

- 커밋 제목과 본문은 한국어로 쓴다.

### 산출 방식 (스펙 1장)

- 오토캐드(Design Automation)를 쓰지 않는다. 서버가 DXF를 직접 읽고 쓴다.
- 표는 **진짜 표 객체를 고치지 않는다.** 칸의 자리를 계산해 그 위에 글자를 얹는다.
- 산출물은 **원본 그대로 + 손상 추가**다.
- 앱 화면은 바뀌지 않는다. 산출은 PC 업로드 페이지에서 내려받는다.

### 원본 보관 (스펙 2장)

- 업로드한 파일을 서버에도 보관한다: `server/data/drawings/<id>.dxf` (`.dwg`도 같은 규칙으로 보관한다).
- `.dwg`로 올린 도면: `DXF로 올린 도면만 산출할 수 있습니다`
- 사본이 없는 예전 도면: `원본 파일이 없습니다. 도면을 다시 올려 주세요`

### 산출 API (스펙 3장)

`GET /api/drawings/:id/export.dxf` (접근키 필요, 다른 API와 같다)

- 성공: `Content-Type: application/dxf`, 파일명 `<원본이름 확장자 뺀 것>_손상.dxf`, UTF-8.
- 손상이 하나도 없으면 400 `표기한 손상이 없습니다`.
- 원본이 없거나 DWG면 2장의 메시지로 400.
- 업로드 페이지 도면 목록에 `DXF 내려받기`를 더한다. 접근키를 붙여 요청한다.

### DXF 읽고 쓰기 (스펙 4장)

- DXF는 `코드\n값\n` 쌍이 이어지는 글자 파일이다. 줄 끝(`\r\n` 또는 `\n`)은 **원본 그대로 기억해 쓸 때 되돌린다.**
- 새 엔티티는 `ENTITIES` 구역의 `ENDSEC` 바로 앞에 끼워 넣는다.
- 핸들(코드 5)은 `$HANDSEED`부터 1씩 올려 쓰고, 마지막에 `$HANDSEED`를 갱신한다. **같은 핸들이 두 번 나오면 캐드가 파일을 열지 못한다.**
- 소유자(코드 330)는 `BLOCK_RECORD` 표의 `*Model_Space` 핸들이다.
- 레이어 `신규손상`이 `LAYER` 표에 없으면 추가한다(색 1, 선종류 `Continuous`, 핸들 새로 할당). 표의 항목 수(코드 70)는 캐드가 무시하므로 **손대지 않는다.**
- 한글은 UTF-8 그대로 쓴다(2018 형식 DXF는 UTF-8이다).
- 손상은 `geometry.dwg`(도면 모델 좌표, mm)를 그대로 쓴다. `dwg`가 없는 손상은 **뺀다.** 뺀 개수를 응답 헤더 `X-Mangdo-Skipped`로 알린다.
- 블록 안 좌표를 절대 좌표로: `절대 = 삽입점 + 배율 × 회전(블록 좌표)`. 회전(코드 50)이 0이 아니면 적용한다. 배율은 x·y가 같은 것만 지원하고, 다르면 `표의 배율이 가로·세로가 달라 채울 수 없습니다`로 400.

### 손상 도형 출력 (스펙 5장, 2026-09-12 설계 8장)

모든 엔티티는 레이어 `신규손상`, 색 1(빨강).

| 유형 | 출력 |
|---|---|
| 선형 (균열, 균열/백태) | 열린 `LWPOLYLINE` |
| 면형 + 해치 | 닫힌 `LWPOLYLINE` + `HATCH` |
| 철근노출 | 닫힌 `LWPOLYLINE` + 기호(나란한 `LINE` 2개, 양 끝 ✕ = `LINE` 4개) |
| 균열/백태 | 열린 `LWPOLYLINE` + 선을 따라 158mm 간격으로 지름 54.4mm `CIRCLE`, 위·아래 번갈아 |

유형별 해치(2026-09-12 설계 2장, 2026-09-15 설계 5장):

| 유형 id | 이름 | 해치 | 축척 |
|---|---|---|---|
| `crack` | 균열 | 없음 (선형) | |
| `map_crack` | 망상균열 | `ANCHORLK` | 50 |
| `breakage` | 파손 | `ANSI33` (기타와 동일) | 50 |
| `segregation` | 재료분리 | `CORK` | 35 |
| `delamination` | 박리 | `ANSI31` | 50 |
| `spalling` | 박락 | `ANSI37` | 60 |
| `efflorescence` | 백태·열화 | `TRIANG` | 25 |
| `etc` | 기타 | `ANSI33` | 50 |
| `rebar_exposure` | 철근노출 | 없음 — 기호 | |
| `crack_efflorescence` | 균열/백태 | 없음 — 기호 | |

- `HATCH`는 무늬 이름만으로는 부족하고 **패턴 선 정의를 엔티티 안에 담아야 한다.** 정의값은 `docs/exam.dxf`에서 읽어 `server/src/export/hatchPatterns.ts`에 고정값으로 둔다. 해치는 **비연관(코드 71 = 0)** 이며 경계는 닫힌 폴리라인 네 점이다.

기호 치수(2026-09-12 설계 4.1절, 도면 실치수 mm):

| 철근노출 | 값 |
|---|---|
| 두 선 사이 간격 | 57.4 |
| ✕ 하나의 크기 | 212 × 212 |
| 선 길이 | 사각형 긴 변 길이 − 212 |

| 균열/백태 | 값 |
|---|---|
| 원 지름 | 54.4 |
| 선에서 원 중심까지 | 77 |
| 원 사이 간격 | 158 |

### 라벨 출력 (스펙 6장, 2026-09-13 설계 §5.2·§9.5)

- 글자 높이 **300**, 번호 원 반지름 **255**(= 300 × 0.85), 도형 위쪽 경계에서 **100** 떨어진 곳부터 위로 쌓는다. 줄 간격은 앱과 같은 비율(글자 높이 × 1.3).
- 첫 줄: 번호 원(`CIRCLE`) + 가운데 번호 `TEXT` + 이름 `TEXT`(균열은 이름 없음, 기타는 사용자가 적은 손상현황).
- 둘째 줄: `dimensionTextOf`. 셋째 줄: `photoTextOf`. 없는 줄은 건너뛰어 빈 줄을 남기지 않는다.
- 문구를 만드는 함수는 앱과 **같은 파일**(`server/public/viewer/quantities.js`)을 서버가 그대로 불러 쓴다.
- `TEXT`는 정렬 코드 **72=1(가운데)**, **73=2(중간)**로 두고 정렬점(11, 21)에 위치를 넣는다. 글꼴 스타일은 `Standard`(코드 7을 쓰지 않는다 — `docs/exam.dxf`의 `균열` 글자와 같은 방식).

### 손상물량표 (스펙 7장)

열 매핑(0부터 센 열 번호):

| 열 | 채우는 값 |
|---|---|
| 0 번호 | 표에 이미 인쇄돼 있다. **채우지 않는다.** 손상은 이 번호 순서로 놓는다 |
| 1 손상위치 | **비워 둔다** |
| 2 손상현황 | `statusTextOf` (구간 포함, 예 `균열(0.3mm미만)`) |
| 3 가로/폭 | `measured.width` → `formatQuantity` |
| 4 세로/길이 | `measured.length` → `formatQuantity` |
| 5 개소 | `measured.count` (정수 그대로) |
| 6 면적/연장 | `quantityOf` → `formatQuantity` |
| 7 단위 | `unitOf` (`m` / `㎡`) |

- 값이 `null`이면 그 칸은 **비워 둔다**(`-`를 쓰지 않는다).
- 번호 N인 손상은 데이터 N행에 들어간다. 글자는 셀 가운데(x·y 중앙)에 높이 = 셀 글자 높이 × 배율로 놓는다.
- 사진번호는 표에 넣지 않는다.
- 산출 코드는 표 치수를 **박아 두지 않는다.** `ACAD_TABLE`에서 행 높이(코드 141)·열 너비(코드 142)·삽입점(10/20)을, 표 블록의 `MTEXT`에서 글자 높이와 데이터 1행 위치를, 블록의 `INSERT`에서 삽입점·배율·회전을 그때그때 읽는다.
- 표가 하나도 없으면 손상 도형·라벨만 그리고 `X-Mangdo-Warning`으로 알린다. **산출은 성공한다.**
- 표가 여러 개면 **손상들의 경계상자 중심에서 가장 가까운 표** 하나를 쓴다.
- 데이터 행은 **`번호 1`이 인쇄된 셀의 y 대역이 1행**이다. 머리글 줄 수를 세지 않는다.
- 데이터 행 수를 넘으면 표를 **오른쪽에 한 장 더** `LINE`·`TEXT`로 직접 그린다. 위치는 원본 표 오른쪽 끝에서 **첫 열 너비(번호 열)만큼** 띄운 곳, 위쪽 끝은 같은 높이. 번호는 이어서 인쇄한다. 또 넘치면 세 번째 표를 또 오른쪽에 둔다. 글자 높이·열 너비·행 높이·머리글은 원본 값을 읽어 쓴다.

### 번호와 순서 (스펙 8장)

- 번호는 앱과 같은 `computeNumbers`(왼쪽 우선)로 **`geometry.world`에서** 계산한다. `geometry.dwg`로 다시 매기지 않는다.
- 산출은 이 번호로 손상을 정렬해 표 행에 놓고 라벨 원에 적는다.
- `dwg`가 없어 도면에서 빠진 손상도 번호는 그대로 소비한다. 그 번호의 표 행은 비어 있다.

### 범위 밖 (스펙 10장)

- 도면 단위는 mm로 확정했다. `$INSUNITS`가 4(mm)·0(없음)·1(인치)이 아니면 **경고 헤더만** 붙인다.
- 진짜 표 칸 채우기(Design Automation)는 이 설계 밖이다.
- 손상위치 칸은 비워 둔다.

### 이 계획에서 정한 값 (스펙이 말하지 않아 구현이 정한 것)

구현 중 이 값들을 바꾸지 않는다. 바꾸려면 스펙을 먼저 고친다.

| 항목 | 정한 값 | 이유 |
|---|---|---|
| 경고 헤더 문구 | `표 없음` / `표 모양을 알 수 없음` / `도면 단위 확인 필요` | 스펙 7.3은 `표 없음`만 정했다 |
| 경고 헤더 인코딩 | `encodeURIComponent`로 퍼센트 인코딩해 보낸다 | Node는 코드포인트 255 초과 문자를 헤더 값에 넣으면 `ERR_INVALID_CHAR`로 던진다. 한글을 그대로 넣을 수 없다 |
| 파일명 헤더 | `attachment; filename="damage.dxf"; filename*=UTF-8''<퍼센트 인코딩>` | 같은 이유 |
| 균열/백태 원의 첫 위치 | 선 시작에서 `간격/2`(79mm), 이후 158mm마다 | 스펙은 간격만 정했다. 짧은 선에도 원이 하나는 찍히게 한다 |
| 균열/백태 원 개수 상한 | 1000개 | 아주 긴 선에서 파일이 폭발하지 않게 |
| 철근노출 기호 생략 조건 | 긴 변 길이 ≤ 212면 기호를 그리지 않고 테두리만 | 선 길이가 0 이하가 된다 |
| 표 열 수 | 8열 미만이면 채우지 않고 `표 모양을 알 수 없음` 경고 | 스펙 7.2의 열 매핑이 8열을 전제한다 |
| 넘침 표의 행 수 | 항상 원본과 같은 데이터 행 수(가득 찬 표) | "원본 표와 같은 열 너비·행 높이·머리글" |
| 표 글자 색 | 손상 도형과 같은 색 1(빨강) | 스펙 5장 "모든 엔티티는 레이어 `신규손상`, 색 1" |
| 가로/폭 칸 단위 표기 | 붙이지 않는다(`formatQuantity`만) | 스펙 7.2가 그렇게 적었다. `quantities.js` 주석의 `widthUnitOf` 권고보다 최신 스펙이 우선한다 |

### 코드베이스 규칙

- `server/public/viewer/*.js`는 **빌드 단계가 없는 순수 ES 모듈**이고 정적으로 서빙된다. `server/src/*.ts`와 `server/test/*.test.ts`가 이 파일들을 `../public/viewer/xxx.js` 형태로 직접 import한다(`allowJs: true`, `checkJs: false`). `server/src/damagesStore.ts`가 이미 그렇게 한다.
- 테스트 환경에 **DOM이 없다**(vitest, `environment: 'node'`). `overlay.js`는 모듈을 읽는 시점에 DOM을 건드리지 않으므로 서버에서 import해도 안전하다(`labelAnchor`·`labelLayout`·`estimateTextWidthPx`는 순수 함수다). `main.js`·`crackTool.js`·`upload.js`의 브라우저 전용 코드는 **읽기 + `node --check`로만 검증한다. 가짜 DOM 하네스를 만들지 않는다.**
- 화면 문구는 한국어.
- 손상 원본 데이터는 JSON이 원본이고 DXF는 산출물이다.
- 검증 명령:
  - `npm --prefix server test`
  - `npm --prefix server run typecheck`
  - `node --check server/public/upload.js`

---

## File Structure

```
server/public/viewer/damageTypes.js          수정: map_crack→ANCHORLK 50, breakage→ANSI33 50, 기호 유형의 decoration 실측값
server/public/viewer/overlay.js              수정: ANCHORLK 화면 근사 무늬 추가, BASELINE_CENTER_FACTOR를 export

server/src/export/dxfDocument.ts             생성: DXF를 (코드,값) 쌍으로 읽고 쓰기, 구역·표·블록 찾기, 핸들 할당, 엔티티/레이어 끼워 넣기
server/src/export/hatchPatterns.ts           생성: exam.dxf에서 읽은 유형별 해치 패턴 선 정의(고정값)와 축척 환산
server/src/export/dxfEntities.ts             생성: LWPOLYLINE·CIRCLE·LINE·TEXT·HATCH 엔티티 쌍 만들기
server/src/export/damageEntities.ts          생성: 손상 하나 → 도형·해치·기호 엔티티 (유형별 규칙)
server/src/export/labelPlacement.ts          생성: 라벨 배치를 도면 실치수로 계산(overlay.js 순수 함수 재사용) + 라벨 엔티티
server/src/export/tableGrid.ts               생성: ACAD_TABLE 찾기, 블록→모델 좌표 변환, 격자·데이터 행·셀 중앙 좌표
server/src/export/tableFill.ts               생성: 표 행 값 계산, 표 채우기, 넘침 표 그리기
server/src/export/exportDrawing.ts           생성: 위 조각들을 엮는 오케스트레이션. ExportError와 경고 목록
server/src/originalsStore.ts                 생성: 업로드 원본 파일 보관/읽기 (server/data/drawings/<id>.<ext>)
server/src/jsonFile.ts                       수정: writeFileAtomic(Buffer도 받는 원자적 쓰기) 분리
server/src/app.ts                            수정: 업로드 때 원본 저장, GET /api/drawings/:id/export.dxf 라우트, deps에 originals 추가
server/src/index.ts                          수정: OriginalsStore 주입
server/public/upload.html                    수정: 목록에 `산출` 열 추가
server/public/upload.js                      수정: DXF 내려받기 버튼(접근키 헤더 + blob 저장), 건너뛴 개수·경고 표시
.gitignore                                   수정: server/test/fixtures/*.dxf 는 커밋하도록 예외 추가

server/test/fixtures/mangdo-template.dxf     생성: 손으로 쓴 최소 DXF(HEADER/TABLES/BLOCKS/ENTITIES, 망도틀 INSERT + *TX 표 블록)
server/test/dxfDocument.test.ts              생성: 쌍 읽기/쓰기, 줄끝 보존, 구역·핸들·레이어
server/test/hatchPatterns.test.ts            생성: 패턴 정의 무결성과 축척 환산
server/test/dxfEntities.test.ts              생성: 엔티티 쌍 규격
server/test/damageEntities.test.ts           생성: 유형별 도형·해치·기호
server/test/labelPlacement.test.ts           생성: 라벨 좌표·줄 쌓기·정렬
server/test/tableGrid.test.ts                생성: 표 찾기, 좌표 변환, 격자·데이터 행·셀 중앙
server/test/tableFill.test.ts                생성: 행 값, 표 채우기, 넘침 표
server/test/exportDrawing.test.ts            생성: 전체 산출 흐름과 오류·경고
server/test/damageTypes.test.ts              수정: ANCHORLK·ANSI33 기대값과 decoration 실측값
server/test/overlay.test.ts                  수정: ANCHORLK 근사 무늬와 BASELINE_CENTER_FACTOR export 확인
server/test/stores.test.ts                   수정: OriginalsStore 테스트 추가
server/test/app.test.ts                      수정: 업로드 원본 저장, 산출 라우트 4가지 오류와 정상 200, seed의 objectKey 확장자
README.md                                    수정: 사용 절에 DXF 내려받기 추가
docs/DXF산출-테스트-결과.md                   생성: 실기기·캐드 확인용 빈 체크 표(결과는 사용자가 채운다)
```

---

### Task 1: 손상 유형 정의를 설계에 맞춘다 (해치 이름·축척, 기호 치수)

산출 코드는 `damageTypes.js`를 읽어 유형별 해치와 기호 치수를 정한다. 그런데 지금 파일은 설계와 두 군데가 다르다: `map_crack`이 `NET 50`(설계는 `ANCHORLK 50`), `breakage`가 `fill: null`(설계는 `ANSI33 50`). 기호 유형의 `decoration` 숫자도 아직 `null`이다. 산출을 만들기 전에 이 정의부터 맞춘다.

**Files:**
- Modify: `server/public/viewer/damageTypes.js`
- Modify: `server/public/viewer/overlay.js`
- Modify: `server/test/damageTypes.test.ts`

**Interfaces:**
- Consumes: 없음 (정의 파일 자체)
- Produces:
  - `DAMAGE_TYPES[].fill` — `{ kind: 'hatch', pattern, scale, angle, spacingMm } | null`
  - `DAMAGE_TYPES[].decoration` — `{ kind: 'rebar', lineGapMm: 57.4, crossSizeMm: 212 }` (철근노출) / `{ kind: 'circles', diameterMm: 54.4, spacingMm: 158, offsetMm: 77 }` (균열/백태) / `null`
  - `overlay.js`의 `BASELINE_CENTER_FACTOR: 0.35` — export 추가 (산출 라벨이 베이스라인 대신 중간 정렬점을 쓰기 위해 필요)
  - `overlay.js`의 `HATCH_PATTERNS.ANCHORLK` — 화면 근사 무늬

- [ ] **Step 1: 실패하는 테스트로 바꾼다**

`server/test/damageTypes.test.ts`에서 아래 세 곳을 고친다.

`'각 유형의 이름과 채우기가 스펙과 같다'`의 기대값 두 줄:
```ts
      ['map_crack', '망상균열', 'area', 'ANCHORLK'],
      ['breakage', '파손', 'area', 'ANSI33'],
```

`'해치 축척과 무늬 간격은 스펙과 같다'`의 `hatchSpec`을 통째로 교체:
```ts
    const hatchSpec = [
      ['map_crack', 'ANCHORLK', 50, 3.952854 * 50],
      ['breakage', 'ANSI33', 50, 6.35 * 50],
      ['segregation', 'CORK', 35, 3.175 * 35],
      ['delamination', 'ANSI31', 50, 3.175 * 50],
      ['spalling', 'ANSI37', 60, 3.175 * 60],
      ['efflorescence', 'TRIANG', 25, 9.525 * 25],
      ['etc', 'ANSI33', 50, 6.35 * 50],
    ] as const;
```

`'선·원 도형 유형만 decoration을 갖고, 숫자는 아직 비어 있다'`를 통째로 교체:
```ts
  it('기호 유형의 decoration은 사내 망도 실측 치수를 담는다', () => {
    const withDecoration = DAMAGE_TYPES.filter((t: { decoration: unknown }) => t.decoration !== null);
    expect(withDecoration.map((t: { id: string }) => t.id)).toEqual(['rebar_exposure', 'crack_efflorescence']);
    expect(getDamageType('rebar_exposure')?.decoration).toEqual({
      kind: 'rebar',
      lineGapMm: 57.4,
      crossSizeMm: 212,
    });
    expect(getDamageType('crack_efflorescence')?.decoration).toEqual({
      kind: 'circles',
      diameterMm: 54.4,
      spacingMm: 158,
      offsetMm: 77,
    });
  });
```

`server/test/overlay.test.ts`의 맨 아래에 다음 describe를 더한다:
```ts
describe('ANCHORLK 화면 근사 무늬', () => {
  it('HATCH_PATTERNS에 ANCHORLK가 있다', () => {
    expect(typeof HATCH_PATTERNS.ANCHORLK).toBe('function');
  });

  it('베이스라인-중심 비율을 내보낸다', () => {
    expect(BASELINE_CENTER_FACTOR).toBe(0.35);
  });
});
```
같은 파일의 import 목록에 `HATCH_PATTERNS`, `BASELINE_CENTER_FACTOR`를 더한다.

`npm --prefix server test` — 위 테스트들이 실패하는 것을 확인한다.

- [ ] **Step 2: `damageTypes.js`를 고친다**

`PATTERN_BASE_SPACING`에 한 줄 더한다(ANCHORLK의 한 칸 크기. `docs/exam.dxf`의 축척 50 정의에서 197.6427 / 50):
```js
const PATTERN_BASE_SPACING = {
  ANSI31: 3.175,
  ANSI33: 6.35,
  ANSI37: 3.175,
  CORK: 3.175,
  TRIANG: 9.525,
  ANCHORLK: 3.952854,
  NET: 3.175,
};
```

`circles()` 헬퍼를 실측값 두 개로 바꾼다:
```js
// 선·원 기호의 실물 치수(mm). docs/exam.dxf 범례 실측값이며 도면이 바뀌어도 같다.
// 근거: docs/superpowers/specs/2026-09-12-damage-types-design.md 4.1절
function rebarSymbol() {
  return { kind: 'rebar', lineGapMm: 57.4, crossSizeMm: 212 };
}

function crackCircles() {
  return { kind: 'circles', diameterMm: 54.4, spacingMm: 158, offsetMm: 77 };
}
```

`DAMAGE_TYPES`의 네 줄을 고친다(나머지 여섯 줄은 그대로):
```js
  { id: 'map_crack', label: '망상균열', kind: 'area', fill: hatch('ANCHORLK', 50), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'breakage', label: '파손', kind: 'area', fill: hatch('ANSI33', 50), decoration: null, layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'rebar_exposure', label: '철근노출', kind: 'area', fill: null, decoration: rebarSymbol(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm2' },
  { id: 'crack_efflorescence', label: '균열/백태', kind: 'line', fill: null, decoration: crackCircles(), layer: LAYER, colorIndex: COLOR_INDEX, quantityUnit: 'm' },
```
`rebar_exposure`, `crack_efflorescence` 위에 붙어 있던 `// 모양을 받기 전까지:` 주석 두 줄은 지운다.

- [ ] **Step 3: `overlay.js`에 ANCHORLK 근사 무늬와 export를 더한다**

`const BASELINE_CENTER_FACTOR = 0.35;` 줄을 다음으로 바꾼다:
```js
// 텍스트 베이스라인에서 원 중심까지 거리 (글자 높이의 배수).
// 산출 DXF는 TEXT를 중간 정렬(73=2)로 놓으므로 이 값을 그대로 쓴다 — server/src/export/labelPlacement.ts
export const BASELINE_CENTER_FACTOR = 0.35;
```

`HATCH_PATTERNS`에 한 줄 더한다(마름모 격자 — 다른 무늬와 구분만 되면 된다. 진짜 무늬는 산출 DXF에 들어간다):
```js
  ANCHORLK: (size, strokeWidth) => [
    line(0, size / 2, size / 2, 0, strokeWidth),
    line(size / 2, 0, size, size / 2, strokeWidth),
    line(size, size / 2, size / 2, size, strokeWidth),
    line(size / 2, size, 0, size / 2, strokeWidth),
  ],
```

- [ ] **Step 4: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```
둘 다 통과해야 한다.

```bash
git add server/public/viewer/damageTypes.js server/public/viewer/overlay.js server/test/damageTypes.test.ts server/test/overlay.test.ts
git commit -m "$(cat <<'MSG'
손상 유형 정의를 2단계 설계에 맞춘다

망상균열의 해치를 NET에서 ANCHORLK(축척 50)로, 파손을 기타와 같은
ANSI33(축척 50)로 바로잡는다. 철근노출·균열/백태의 decoration에
사내 망도 실측 치수를 채운다. DXF 산출이 이 정의를 그대로 읽는다.

overlay.js에 ANCHORLK 화면 근사 무늬를 더하고,
산출 라벨이 쓸 BASELINE_CENTER_FACTOR를 내보낸다.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
MSG
)"
```

**Deliverable:** 유형 정의가 설계와 일치하고 기존 테스트가 모두 통과한다. 뷰어에서 망상균열·파손이 무늬로 구분된다.

---

### Task 2: DXF 쌍 읽기·쓰기, 구역 찾기, 핸들 할당, 레이어 추가

**Files:**
- Create: `server/test/fixtures/mangdo-template.dxf`
- Create: `server/src/export/dxfDocument.ts`
- Create: `server/test/dxfDocument.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 없음 (Node `node:fs`만)
- Produces (`server/src/export/dxfDocument.ts`):
  - `interface DxfPair { code: number; value: string; rawCode?: string }`
  - `interface DxfDocument { pairs: DxfPair[]; eol: string; trailingEol: boolean }`
  - `interface SectionRange { start: number; end: number }` — `start`는 `(0, SECTION)`/`(0, TABLE)` 쌍의 인덱스, `end`는 그 구역을 닫는 `(0, ENDSEC)`/`(0, ENDTAB)` 쌍의 인덱스
  - `function parseDxf(text: string): DxfDocument`
  - `function serializeDxf(doc: DxfDocument): string`
  - `function pair(code: number, value: string): DxfPair`
  - `function formatReal(value: number): string` — `1` → `'1.0'`, `-0` → `'0.0'`. 유한하지 않으면 던진다
  - `function formatInt(value: number): string`
  - `function findSection(doc: DxfDocument, name: string): SectionRange | null`
  - `function findTable(doc: DxfDocument, tableName: string): SectionRange | null`
  - `function headerValue(doc: DxfDocument, name: string): string | null`
  - `function setHeaderValue(doc: DxfDocument, name: string, value: string): boolean`
  - `function recordHandle(doc: DxfDocument, tableName: string, recordName: string): string | null`
  - `function layerNames(doc: DxfDocument): string[]`
  - `class HandleAllocator { constructor(start: number); next(): string; get seed(): string }`
  - `function createHandleAllocator(doc: DxfDocument): HandleAllocator`
  - `function insertEntities(doc: DxfDocument, pairs: DxfPair[]): void`
  - `function ensureLayer(doc: DxfDocument, alloc: HandleAllocator, name: string, colorIndex: number): void`
  - `const DAMAGE_LAYER = '신규손상'`, `const DAMAGE_COLOR = 1`

- [ ] **Step 1: `.gitignore`에 픽스처 예외를 더한다**

`.gitignore`의 `*.dxf` 줄 아래(`*.bak` 위)에 두 줄을 넣는다:

```
# 테스트 픽스처 DXF는 손으로 쓴 작은 파일이라 커밋한다 (사내 도면이 아니다)
!server/test/fixtures/*.dxf
```

- [ ] **Step 2: 픽스처 DXF를 만든다**

`server/test/fixtures/mangdo-template.dxf` — 줄 끝은 **LF**로 저장한다(CRLF 보존은 테스트에서 메모리로 바꿔 확인한다). 사내 템플릿 `docs/빈도면(테이블버전).dxf`의 구조를 그대로 줄인 것이다: `망도틀` 블록 안에 `ACAD_TABLE`이 있고, 표의 모양은 익명 블록 `*TX`에 들어 있으며, 모델 공간에는 `망도틀`의 `INSERT` 하나가 배율 2로 놓여 있다.

표 치수(블록 좌표): 열 너비 `100 150 300 120 120 100 140 110` → 열 경계 `0 100 250 550 670 790 890 1030 1140`, 열 중앙 `50 175 400 610 730 840 960 1085`. 행 높이 `40 20 20 20 20` → 행 경계 `0 -40 -60 -80 -100 -120`, 행 중앙 `-20 -50 -70 -90 -110`. 데이터 1행은 `-60 ~ -80`(번호 `1`이 인쇄된 대역) → 데이터 행 3개. 글자 높이 10. 표 삽입점 `(500, 700)`, `망도틀`은 `(1000, 2000)`에 배율 2 → 데이터 1행·0열 중앙의 모델 좌표는 `(2100, 3260)`.

파일 내용(그대로):

```
  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1032
  9
$DWGCODEPAGE
  3
ANSI_949
  9
$INSUNITS
 70
     1
  9
$HANDSEED
  5
200
  0
ENDSEC
  0
SECTION
  2
TABLES
  0
TABLE
  2
LAYER
  5
2
330
0
100
AcDbSymbolTable
 70
     1
  0
LAYER
  5
10
330
2
100
AcDbSymbolTableRecord
100
AcDbLayerTableRecord
  2
0
 70
     0
 62
     7
  6
Continuous
370
    -3
390
F
  0
ENDTAB
  0
TABLE
  2
BLOCK_RECORD
  5
1
330
0
100
AcDbSymbolTable
 70
     3
  0
BLOCK_RECORD
  5
1F
330
1
100
AcDbSymbolTableRecord
100
AcDbBlockTableRecord
  2
*Model_Space
 70
     0
  0
BLOCK_RECORD
  5
30
330
1
100
AcDbSymbolTableRecord
100
AcDbBlockTableRecord
  2
망도틀
 70
     0
  0
BLOCK_RECORD
  5
31
330
1
100
AcDbSymbolTableRecord
100
AcDbBlockTableRecord
  2
*TX
 70
     1
  0
ENDTAB
  0
ENDSEC
  0
SECTION
  2
BLOCKS
  0
BLOCK
  5
40
330
1F
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
*Model_Space
 70
     0
 10
0.0
 20
0.0
 30
0.0
  3
*Model_Space
  1

  0
ENDBLK
  5
41
330
1F
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
BLOCK
  5
50
330
30
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
망도틀
 70
     0
 10
0.0
 20
0.0
 30
0.0
  3
망도틀
  1

  0
ACAD_TABLE
  5
51
330
30
100
AcDbEntity
  8
0
100
AcDbBlockReference
  2
*TX
 10
500.0
 20
700.0
 30
0.0
100
AcDbTable
 90
       22
 91
        5
 92
        8
141
40.0
141
20.0
141
20.0
141
20.0
141
20.0
142
100.0
142
150.0
142
300.0
142
120.0
142
120.0
142
100.0
142
140.0
142
110.0
  0
ENDBLK
  5
52
330
30
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
BLOCK
  5
60
330
31
100
AcDbEntity
  8
0
100
AcDbBlockBegin
  2
*TX
 70
     1
 10
0.0
 20
0.0
 30
0.0
  3
*TX
  1

  0
MTEXT
  5
61
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
570.0
 20
-20.0
 30
0.0
 40
10.0
 71
     5
  1
{\f굴림|b0|i0|c129|p2;손상물량}표
  0
MTEXT
  5
62
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
50.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
{\f굴림|b0|i0|c129|p2;번}호
  0
MTEXT
  5
63
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
175.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
{\f굴림|b0|i0|c129|p2;손상위}치
  0
MTEXT
  5
64
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
400.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
{\f굴림|b0|i0|c129|p2;손상현}황
  0
MTEXT
  5
65
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
610.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
가로/폭
  0
MTEXT
  5
66
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
730.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
세로/길이
  0
MTEXT
  5
67
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
840.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
개소
  0
MTEXT
  5
68
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
960.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
면적/연장
  0
MTEXT
  5
69
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
1085.0
 20
-50.0
 30
0.0
 40
10.0
 71
     5
  1
단위
  0
MTEXT
  5
6A
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
50.0
 20
-70.0
 30
0.0
 40
10.0
 71
     5
  1
1
  0
MTEXT
  5
6B
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
50.0
 20
-90.0
 30
0.0
 40
10.0
 71
     5
  1
2
  0
MTEXT
  5
6C
330
31
100
AcDbEntity
  8
0
100
AcDbMText
 10
50.0
 20
-110.0
 30
0.0
 40
10.0
 71
     5
  1
3
  0
LINE
  5
70
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
0.0
 30
0.0
 11
1140.0
 21
0.0
 31
0.0
  0
LINE
  5
71
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
-40.0
 30
0.0
 11
1140.0
 21
-40.0
 31
0.0
  0
LINE
  5
72
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
-60.0
 30
0.0
 11
1140.0
 21
-60.0
 31
0.0
  0
LINE
  5
73
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
-120.0
 30
0.0
 11
1140.0
 21
-120.0
 31
0.0
  0
LINE
  5
74
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
0.0
 30
0.0
 11
0.0
 21
-120.0
 31
0.0
  0
LINE
  5
75
330
31
100
AcDbEntity
  8
0
100
AcDbLine
 10
1140.0
 20
0.0
 30
0.0
 11
1140.0
 21
-120.0
 31
0.0
  0
ENDBLK
  5
76
330
31
100
AcDbEntity
  8
0
100
AcDbBlockEnd
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
INSERT
  5
80
330
1F
100
AcDbEntity
  8
0
100
AcDbBlockReference
  2
망도틀
 10
1000.0
 20
2000.0
 30
0.0
 41
2.0
 42
2.0
 43
2.0
 50
0.0
  0
LINE
  5
81
330
1F
100
AcDbEntity
  8
0
100
AcDbLine
 10
0.0
 20
0.0
 30
0.0
 11
10.0
 21
10.0
 31
0.0
  0
ENDSEC
  0
EOF
```

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`server/test/dxfDocument.test.ts` (새 파일):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createHandleAllocator,
  DAMAGE_LAYER,
  ensureLayer,
  findSection,
  findTable,
  formatInt,
  formatReal,
  HandleAllocator,
  headerValue,
  insertEntities,
  layerNames,
  pair,
  parseDxf,
  recordHandle,
  serializeDxf,
  setHeaderValue,
} from '../src/export/dxfDocument.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function templateText(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

describe('parseDxf / serializeDxf', () => {
  it('쌍으로 나누고 원래 글자 그대로 되돌린다 (LF)', async () => {
    const text = await templateText();
    const doc = parseDxf(text);
    expect(doc.eol).toBe('\n');
    expect(doc.pairs[0]).toMatchObject({ code: 0, value: 'SECTION' });
    expect(doc.pairs[1]).toMatchObject({ code: 2, value: 'HEADER' });
    expect(serializeDxf(doc)).toBe(text);
  });

  it('CRLF 파일도 CRLF 그대로 되돌린다', async () => {
    const text = (await templateText()).replace(/\n/g, '\r\n');
    const doc = parseDxf(text);
    expect(doc.eol).toBe('\r\n');
    expect(serializeDxf(doc)).toBe(text);
  });

  it('빈 값 줄도 잃지 않는다', () => {
    const doc = parseDxf('  1\n\n  0\nEOF\n');
    expect(doc.pairs).toHaveLength(2);
    expect(doc.pairs[0].value).toBe('');
    expect(serializeDxf(doc)).toBe('  1\n\n  0\nEOF\n');
  });

  it('줄 수가 홀수면 던진다', () => {
    expect(() => parseDxf('  0\nSECTION\n  2\n')).toThrow(/짝이 맞지 않습니다/);
  });

  it('코드가 숫자가 아니면 던진다', () => {
    expect(() => parseDxf('abc\nSECTION\n')).toThrow(/코드가 숫자가 아닙니다/);
  });
});

describe('formatReal / formatInt', () => {
  it('정수도 소수점을 붙인다', () => {
    expect(formatReal(1)).toBe('1.0');
    expect(formatReal(0)).toBe('0.0');
    expect(formatReal(-0)).toBe('0.0');
    expect(formatReal(-12)).toBe('-12.0');
  });

  it('소수는 그대로 쓴다', () => {
    expect(formatReal(1140.5)).toBe('1140.5');
    expect(formatReal(-112.2532015133644)).toBe('-112.2532015133644');
  });

  it('유한하지 않으면 던진다', () => {
    expect(() => formatReal(Number.NaN)).toThrow(/쓸 수 없는 숫자/);
    expect(() => formatReal(Number.POSITIVE_INFINITY)).toThrow(/쓸 수 없는 숫자/);
  });

  it('정수는 버림해서 쓴다', () => {
    expect(formatInt(5)).toBe('5');
    expect(formatInt(5.9)).toBe('5');
    expect(formatInt(-5.9)).toBe('-5');
  });
});

describe('구역과 표 찾기', () => {
  it('ENTITIES 구역의 시작과 ENDSEC을 찾는다', async () => {
    const doc = parseDxf(await templateText());
    const range = findSection(doc, 'ENTITIES');
    expect(range).not.toBeNull();
    expect(doc.pairs[range!.start]).toMatchObject({ code: 0, value: 'SECTION' });
    expect(doc.pairs[range!.start + 1]).toMatchObject({ code: 2, value: 'ENTITIES' });
    expect(doc.pairs[range!.end]).toMatchObject({ code: 0, value: 'ENDSEC' });
    const types = doc.pairs.slice(range!.start, range!.end).filter((p) => p.code === 0).map((p) => p.value);
    expect(types).toEqual(['SECTION', 'INSERT', 'LINE']);
  });

  it('없는 구역은 null', async () => {
    const doc = parseDxf(await templateText());
    expect(findSection(doc, 'OBJECTS')).toBeNull();
  });

  it('LAYER 표의 ENDTAB을 찾는다', async () => {
    const doc = parseDxf(await templateText());
    const range = findTable(doc, 'LAYER');
    expect(range).not.toBeNull();
    expect(doc.pairs[range!.end]).toMatchObject({ code: 0, value: 'ENDTAB' });
  });
});

describe('HEADER 값', () => {
  it('읽는다', async () => {
    const doc = parseDxf(await templateText());
    expect(headerValue(doc, '$HANDSEED')).toBe('200');
    expect(headerValue(doc, '$INSUNITS')).toBe('     1');
    expect(headerValue(doc, '$ACADVER')).toBe('AC1032');
    expect(headerValue(doc, '$NOPE')).toBeNull();
  });

  it('고쳐 쓴다', async () => {
    const doc = parseDxf(await templateText());
    expect(setHeaderValue(doc, '$HANDSEED', '2FF')).toBe(true);
    expect(headerValue(doc, '$HANDSEED')).toBe('2FF');
    expect(serializeDxf(doc)).toContain('$HANDSEED\n  5\n2FF\n');
  });

  it('없는 값은 false', async () => {
    const doc = parseDxf(await templateText());
    expect(setHeaderValue(doc, '$NOPE', 'x')).toBe(false);
  });
});

describe('표 레코드 핸들', () => {
  it('블록 레코드 핸들을 이름으로 찾는다', async () => {
    const doc = parseDxf(await templateText());
    expect(recordHandle(doc, 'BLOCK_RECORD', '*Model_Space')).toBe('1F');
    expect(recordHandle(doc, 'BLOCK_RECORD', '망도틀')).toBe('30');
    expect(recordHandle(doc, 'BLOCK_RECORD', '없는블록')).toBeNull();
  });
});

describe('HandleAllocator', () => {
  it('16진 대문자로 1씩 올린다', () => {
    const alloc = new HandleAllocator(0x1fe);
    expect(alloc.next()).toBe('1FE');
    expect(alloc.next()).toBe('1FF');
    expect(alloc.next()).toBe('200');
    expect(alloc.seed).toBe('201');
  });

  it('$HANDSEED와 파일 안 최대 핸들 중 큰 값에서 시작한다', async () => {
    const doc = parseDxf(await templateText());
    // 픽스처의 $HANDSEED는 200이고 실제 최대 핸들은 81이다 → 200부터
    expect(createHandleAllocator(doc).next()).toBe('200');

    const bumped = parseDxf((await templateText()).replace('$HANDSEED\n  5\n200\n', '$HANDSEED\n  5\n10\n'));
    // $HANDSEED가 최대 핸들보다 작으면 최대 핸들 + 1에서 시작한다
    expect(createHandleAllocator(bumped).next()).toBe('82');
  });
});

describe('insertEntities', () => {
  it('ENTITIES의 ENDSEC 바로 앞에 넣는다', async () => {
    const doc = parseDxf(await templateText());
    insertEntities(doc, [pair(0, 'CIRCLE'), pair(5, '200'), pair(8, DAMAGE_LAYER)]);

    const range = findSection(doc, 'ENTITIES')!;
    const types = doc.pairs.slice(range.start, range.end).filter((p) => p.code === 0).map((p) => p.value);
    expect(types).toEqual(['SECTION', 'INSERT', 'LINE', 'CIRCLE']);
    expect(doc.pairs[range.end - 1]).toMatchObject({ code: 8, value: DAMAGE_LAYER });
    expect(serializeDxf(doc)).toContain('  0\nCIRCLE\n  5\n200\n  8\n신규손상\n  0\nENDSEC\n');
  });

  it('ENTITIES 구역이 없으면 던진다', () => {
    const doc = parseDxf('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n');
    expect(() => insertEntities(doc, [pair(0, 'CIRCLE')])).toThrow(/ENTITIES 구역/);
  });
});

describe('ensureLayer', () => {
  it('없으면 LAYER 표의 ENDTAB 앞에 추가한다', async () => {
    const doc = parseDxf(await templateText());
    expect(layerNames(doc)).toEqual(['0']);

    ensureLayer(doc, createHandleAllocator(doc), DAMAGE_LAYER, 1);

    expect(layerNames(doc)).toEqual(['0', DAMAGE_LAYER]);
    const out = serializeDxf(doc);
    expect(out).toContain('  0\nLAYER\n  5\n200\n330\n2\n');
    expect(out).toContain('  2\n신규손상\n 70\n     0\n 62\n     1\n  6\nContinuous\n');
    // 표의 항목 수(코드 70)는 손대지 않는다
    expect(out).toContain('AcDbSymbolTable\n 70\n     1\n');
  });

  it('이미 있으면 아무것도 하지 않는다', async () => {
    const doc = parseDxf(await templateText());
    ensureLayer(doc, createHandleAllocator(doc), '0', 1);
    expect(layerNames(doc)).toEqual(['0']);
    expect(serializeDxf(doc)).toBe(await templateText());
  });
});
```

`npm --prefix server test` — 모듈이 없어 실패하는 것을 확인한다.

- [ ] **Step 4: `server/src/export/dxfDocument.ts`를 쓴다**

```ts
// DXF 파일을 (코드, 값) 쌍의 배열로 읽고, 필요한 곳만 고쳐 다시 쓴다.
// 전체를 객체로 바꿔 재직렬화하지 않는다 — 원본의 다른 부분은 한 바이트도 바뀌면 안 된다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4장

export interface DxfPair {
  code: number;
  value: string;
  // 원본의 코드 줄 그대로(예: '  0', ' 70', '1001'). 있으면 쓸 때 그대로 되돌려
  // 원본 바이트를 보존한다. 새로 만든 쌍에는 없고, 그때는 3칸 오른쪽 정렬로 쓴다.
  rawCode?: string;
}

export interface DxfDocument {
  pairs: DxfPair[];
  eol: string;
  trailingEol: boolean;
}

export interface SectionRange {
  /** (0, SECTION) 또는 (0, TABLE) 쌍의 인덱스 */
  start: number;
  /** 그 구역을 닫는 (0, ENDSEC) 또는 (0, ENDTAB) 쌍의 인덱스 */
  end: number;
}

export const DAMAGE_LAYER = '신규손상';
export const DAMAGE_COLOR = 1;

export function pair(code: number, value: string): DxfPair {
  return { code, value };
}

export function formatReal(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`DXF에 쓸 수 없는 숫자입니다: ${value}`);
  // -0은 0으로 눕힌다(0을 더하면 -0이 0이 된다).
  const text = String(value + 0);
  if (text.includes('.') || text.includes('e') || text.includes('E')) return text;
  return `${text}.0`;
}

export function formatInt(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`DXF에 쓸 수 없는 숫자입니다: ${value}`);
  return String(Math.trunc(value) + 0);
}

export function parseDxf(text: string): DxfDocument {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\n/);
  const trailingEol = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingEol) lines.pop();
  if (lines.length % 2 !== 0) throw new Error('DXF 줄 수가 홀수입니다 — 코드와 값의 짝이 맞지 않습니다.');

  const pairs: DxfPair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const rawCode = lines[i];
    const code = Number(rawCode.trim());
    if (!Number.isInteger(code)) throw new Error(`DXF ${i + 1}번째 줄의 코드가 숫자가 아닙니다: ${rawCode}`);
    pairs.push({ code, value: lines[i + 1], rawCode });
  }
  return { pairs, eol, trailingEol };
}

export function serializeDxf(doc: DxfDocument): string {
  const out: string[] = [];
  for (const p of doc.pairs) {
    out.push(p.rawCode ?? String(p.code).padStart(3, ' '));
    out.push(p.value);
  }
  return out.join(doc.eol) + (doc.trailingEol ? doc.eol : '');
}

// (0, opener) + (2, name) 으로 시작해 (0, closer) 로 닫히는 구역을 찾는다.
function findNamedRange(doc: DxfDocument, opener: string, closer: string, name: string): SectionRange | null {
  const { pairs } = doc;
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== opener) continue;
    const next = pairs[i + 1];
    if (!next || next.code !== 2 || next.value !== name) continue;
    for (let j = i + 2; j < pairs.length; j++) {
      if (pairs[j].code === 0 && pairs[j].value === closer) return { start: i, end: j };
    }
    return null;
  }
  return null;
}

export function findSection(doc: DxfDocument, name: string): SectionRange | null {
  return findNamedRange(doc, 'SECTION', 'ENDSEC', name);
}

export function findTable(doc: DxfDocument, tableName: string): SectionRange | null {
  return findNamedRange(doc, 'TABLE', 'ENDTAB', tableName);
}

// HEADER는 (9, 이름) 다음 쌍이 값이다. 값의 코드는 항목마다 다르다(1, 5, 70, 10…).
function headerIndex(doc: DxfDocument, name: string): number {
  const header = findSection(doc, 'HEADER');
  if (!header) return -1;
  for (let i = header.start; i < header.end; i++) {
    if (doc.pairs[i].code === 9 && doc.pairs[i].value === name) return i + 1;
  }
  return -1;
}

export function headerValue(doc: DxfDocument, name: string): string | null {
  const index = headerIndex(doc, name);
  return index >= 0 && index < doc.pairs.length ? doc.pairs[index].value : null;
}

export function setHeaderValue(doc: DxfDocument, name: string, value: string): boolean {
  const index = headerIndex(doc, name);
  if (index < 0 || index >= doc.pairs.length) return false;
  doc.pairs[index] = { ...doc.pairs[index], value };
  return true;
}

export function recordHandle(doc: DxfDocument, tableName: string, recordName: string): string | null {
  const table = findTable(doc, tableName);
  if (!table) return null;
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== tableName) continue;
    let handle: string | null = null;
    let name: string | null = null;
    for (let j = i + 1; j < table.end && doc.pairs[j].code !== 0; j++) {
      const p = doc.pairs[j];
      if (p.code === 5 && handle === null) handle = p.value.trim();
      else if (p.code === 2 && name === null) name = p.value;
    }
    if (name === recordName) return handle;
  }
  return null;
}

export function layerNames(doc: DxfDocument): string[] {
  const table = findTable(doc, 'LAYER');
  if (!table) return [];
  const names: string[] = [];
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code !== 0 || doc.pairs[i].value !== 'LAYER') continue;
    for (let j = i + 1; j < table.end && doc.pairs[j].code !== 0; j++) {
      if (doc.pairs[j].code === 2) {
        names.push(doc.pairs[j].value);
        break;
      }
    }
  }
  return names;
}

// 핸들은 16진 대문자다. 같은 핸들이 두 번 나오면 캐드가 파일을 열지 못한다.
export class HandleAllocator {
  private value: number;

  constructor(start: number) {
    this.value = Math.max(1, Math.trunc(start));
  }

  next(): string {
    const handle = this.value.toString(16).toUpperCase();
    this.value += 1;
    return handle;
  }

  get seed(): string {
    return this.value.toString(16).toUpperCase();
  }
}

// $HANDSEED가 실제 최대 핸들보다 작게 저장된 파일이 있다. 둘 중 큰 값에서 시작한다.
export function createHandleAllocator(doc: DxfDocument): HandleAllocator {
  const seed = Number.parseInt(headerValue(doc, '$HANDSEED')?.trim() ?? '', 16);
  let max = 0;
  for (const p of doc.pairs) {
    if (p.code !== 5 && p.code !== 105) continue;
    const value = Number.parseInt(p.value.trim(), 16);
    if (Number.isFinite(value) && value > max) max = value;
  }
  return new HandleAllocator(Math.max(Number.isFinite(seed) ? seed : 0, max + 1));
}

export function insertEntities(doc: DxfDocument, pairs: DxfPair[]): void {
  const entities = findSection(doc, 'ENTITIES');
  if (!entities) throw new Error('DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다');
  if (pairs.length === 0) return;
  doc.pairs.splice(entities.end, 0, ...pairs);
}

// LAYER 표에 레이어를 추가한다. 표의 항목 수(코드 70)는 캐드가 무시하므로 손대지 않는다.
export function ensureLayer(doc: DxfDocument, alloc: HandleAllocator, name: string, colorIndex: number): void {
  if (layerNames(doc).includes(name)) return;
  const table = findTable(doc, 'LAYER');
  if (!table) throw new Error('DXF 파일에서 LAYER 표를 찾을 수 없습니다');

  // LAYER 표 자체의 핸들이 새 레코드의 소유자(330)다.
  let ownerHandle = '2';
  for (let i = table.start + 2; i < table.end; i++) {
    if (doc.pairs[i].code === 0) break;
    if (doc.pairs[i].code === 5) {
      ownerHandle = doc.pairs[i].value.trim();
      break;
    }
  }

  const record: DxfPair[] = [
    pair(0, 'LAYER'),
    pair(5, alloc.next()),
    pair(330, ownerHandle),
    pair(100, 'AcDbSymbolTableRecord'),
    pair(100, 'AcDbLayerTableRecord'),
    pair(2, name),
    pair(70, '     0'),
    pair(62, String(colorIndex).padStart(6, ' ')),
    pair(6, 'Continuous'),
    pair(370, '    -3'),
    pair(390, 'F'),
  ];
  doc.pairs.splice(table.end, 0, ...record);
}
```

- [ ] **Step 5: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

사내 템플릿으로 왕복을 한 번 확인한다(임시 확인, 커밋하지 않는다). `server/scripts/check-roundtrip.ts`를 만들어 실행한 뒤 지운다:

```ts
import { readFileSync } from 'node:fs';
import { headerValue, layerNames, parseDxf, recordHandle, serializeDxf } from '../src/export/dxfDocument.js';

const text = readFileSync('../docs/빈도면(테이블버전).dxf', 'utf8');
const doc = parseDxf(text);
console.log('쌍', doc.pairs.length, '줄끝', JSON.stringify(doc.eol));
console.log('HANDSEED', headerValue(doc, '$HANDSEED'), 'INSUNITS', JSON.stringify(headerValue(doc, '$INSUNITS')));
console.log('모델공간', recordHandle(doc, 'BLOCK_RECORD', '*Model_Space'));
console.log('레이어 수', layerNames(doc).length, '신규손상 있나', layerNames(doc).includes('신규손상'));
console.log('왕복 동일', serializeDxf(doc) === text);
```

```bash
node --import tsx server/scripts/check-roundtrip.ts
```

기대 출력: `줄끝 "\r\n"`, `HANDSEED 40D0`, `모델공간 1F`, `신규손상 있나 false`, `왕복 동일 true`. 확인 후 `server/scripts/check-roundtrip.ts`를 지운다(커밋하지 않는다).

```bash
git add .gitignore server/test/fixtures/mangdo-template.dxf server/src/export/dxfDocument.ts server/test/dxfDocument.test.ts
git commit -m "$(printf '%s\n' 'DXF를 쌍 배열로 읽고 필요한 곳만 고쳐 쓰는 모듈' '' '전체를 재직렬화하지 않고 원본 코드 줄을 그대로 보존한다. 줄 끝(CRLF/LF)도' '원본대로 되돌린다. 구역·표 찾기, HEADER 값 읽기·쓰기, 핸들 할당,' 'ENTITIES 끝에 엔티티 끼워 넣기, LAYER 표에 신규손상 추가를 담았다.' '' '테스트는 사내 도면 대신 손으로 쓴 작은 픽스처를 쓴다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 사내 템플릿 4MB DXF를 읽어 바이트가 같게 되돌리고, `$HANDSEED`·모델 공간 핸들·레이어 목록을 정확히 읽는다.

---

### Task 3: 해치 패턴 정의값과 엔티티 쌍 만들기

DXF의 `HATCH`는 무늬 이름만으로는 부족하고 패턴 선 정의를 엔티티 안에 담아야 한다. 값은 사내 망도 `docs/exam.dxf`의 범례 해치에서 읽은 것이며 유형별 축척이 이미 반영돼 있다. 기준점(코드 43/44)은 원본이 아주 큰 절대값이라 **첫 번째 선의 기준점을 0으로 옮겨** 선 사이 상대 간격만 남겼다(무늬는 무한히 반복되므로 기준점의 절대 위치는 보이지 않는다). `ANCHORLK`만 원본 값이 이미 작아 부록 A 그대로 쓴다.

**Files:**
- Create: `server/src/export/hatchPatterns.ts`
- Create: `server/src/export/dxfEntities.ts`
- Create: `server/test/hatchPatterns.test.ts`
- Create: `server/test/dxfEntities.test.ts`

**Interfaces:**
- Consumes: `pair`, `formatReal`, `formatInt`, `DxfPair` from `./dxfDocument.js`
- Produces (`hatchPatterns.ts`):
  - `interface HatchPatternLine { angle: number; baseX: number; baseY: number; offsetX: number; offsetY: number; dashes: number[] }`
  - `interface HatchPattern { name: string; scale: number; angle: number; lines: HatchPatternLine[] }`
  - `const HATCH_PATTERNS: Readonly<Record<string, HatchPattern>>`
  - `function hatchPatternFor(name: string, scale: number): HatchPattern | null` — 이름이 없으면 `null`. 축척이 정의값과 다르면 기준점·간격·점선 길이에 `scale / 정의축척`을 곱한 새 객체를 돌려준다(각도는 그대로)
- Produces (`dxfEntities.ts`):
  - `type Point = [number, number]`
  - `interface EntityBase { handle: string; owner: string; layer: string; colorIndex: number }`
  - `function lwPolylineEntity(base: EntityBase, points: Point[], closed: boolean): DxfPair[]`
  - `function circleEntity(base: EntityBase, center: Point, radius: number): DxfPair[]`
  - `function lineEntity(base: EntityBase, from: Point, to: Point): DxfPair[]`
  - `function textEntity(base: EntityBase, position: Point, height: number, value: string, align: 'center' | 'left'): DxfPair[]` — 72=1/0, 73=2(중간), 정렬점 11/21. 글꼴 스타일 코드 7은 쓰지 않는다(`Standard`)
  - `function hatchEntity(base: EntityBase, boundary: Point[], pattern: HatchPattern): DxfPair[]` — 비연관(71=0), 경계는 닫힌 폴리라인. 시드점은 경계의 무게중심

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/hatchPatterns.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import { DAMAGE_TYPES } from '../public/viewer/damageTypes.js';
import { HATCH_PATTERNS, hatchPatternFor } from '../src/export/hatchPatterns.js';

describe('HATCH_PATTERNS', () => {
  it('손상 유형이 쓰는 여섯 무늬를 모두 담는다', () => {
    expect(Object.keys(HATCH_PATTERNS).sort()).toEqual(
      ['ANCHORLK', 'ANSI31', 'ANSI33', 'ANSI37', 'CORK', 'TRIANG'].sort(),
    );
  });

  it('유형 정의가 쓰는 무늬와 축척이 모두 정의에 있다', () => {
    for (const type of DAMAGE_TYPES) {
      if (!type.fill) continue;
      const pattern = hatchPatternFor(type.fill.pattern, type.fill.scale);
      expect(pattern, `${type.id}의 ${type.fill.pattern}`).not.toBeNull();
      expect(pattern!.scale).toBe(type.fill.scale);
    }
  });

  it('선 개수와 이름이 exam.dxf 실측과 같다', () => {
    expect(HATCH_PATTERNS.ANSI31.lines).toHaveLength(1);
    expect(HATCH_PATTERNS.ANSI33.lines).toHaveLength(2);
    expect(HATCH_PATTERNS.ANSI37.lines).toHaveLength(2);
    expect(HATCH_PATTERNS.CORK.lines).toHaveLength(4);
    expect(HATCH_PATTERNS.TRIANG.lines).toHaveLength(3);
    expect(HATCH_PATTERNS.ANCHORLK.lines).toHaveLength(4);
    expect(HATCH_PATTERNS.ANSI31.name).toBe('ANSI31');
  });

  it('ANSI31은 45도 한 줄, 간격은 3.175 × 50 = 158.75를 45도로 나눈 성분이다', () => {
    const [line] = HATCH_PATTERNS.ANSI31.lines;
    expect(line.angle).toBe(45);
    expect(line.baseX).toBe(0);
    expect(line.baseY).toBe(0);
    expect(Math.hypot(line.offsetX, line.offsetY)).toBeCloseTo(158.75, 6);
    expect(line.dashes).toEqual([]);
  });

  it('ANCHORLK는 부록 A의 네 줄을 그대로 담는다', () => {
    const angles = HATCH_PATTERNS.ANCHORLK.lines.map((l) => l.angle);
    expect(angles).toEqual([18.435, 333.435, 63.435, 108.435]);
    expect(HATCH_PATTERNS.ANCHORLK.lines[0].dashes).toEqual([125, -500]);
    expect(HATCH_PATTERNS.ANCHORLK.lines[1].dashes).toEqual([88.3883475, -353.5533905]);
  });

  it('첫 줄의 기준점은 항상 원점이거나 부록 A 값이다', () => {
    for (const name of ['ANSI31', 'ANSI33', 'ANSI37', 'CORK', 'TRIANG']) {
      expect(HATCH_PATTERNS[name].lines[0].baseX, name).toBe(0);
      expect(HATCH_PATTERNS[name].lines[0].baseY, name).toBe(0);
    }
  });

  it('ANSI33의 둘째 줄은 첫 줄에서 224.5065 떨어져 있고 점선이다', () => {
    const [, second] = HATCH_PATTERNS.ANSI33.lines;
    expect(second.baseX).toBeCloseTo(224.5065, 6);
    expect(second.baseY).toBe(0);
    expect(second.dashes).toEqual([158.75, -79.375]);
  });
});

describe('hatchPatternFor', () => {
  it('모르는 이름은 null', () => {
    expect(hatchPatternFor('NOPE', 50)).toBeNull();
  });

  it('정의와 같은 축척이면 정의를 그대로 준다', () => {
    expect(hatchPatternFor('ANSI31', 50)).toBe(HATCH_PATTERNS.ANSI31);
  });

  it('축척이 다르면 기준점·간격·점선에 비율을 곱하고 각도는 그대로 둔다', () => {
    const scaled = hatchPatternFor('ANSI33', 100)!;
    expect(scaled.scale).toBe(100);
    expect(scaled.lines[0].angle).toBe(45);
    expect(scaled.lines[1].baseX).toBeCloseTo(449.013, 3);
    expect(scaled.lines[1].dashes).toEqual([317.5, -158.75]);
    // 원본은 그대로다
    expect(HATCH_PATTERNS.ANSI33.lines[1].dashes).toEqual([158.75, -79.375]);
  });
});
```

`server/test/dxfEntities.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import type { DxfPair } from '../src/export/dxfDocument.js';
import { DAMAGE_COLOR, DAMAGE_LAYER } from '../src/export/dxfDocument.js';
import {
  circleEntity,
  hatchEntity,
  lineEntity,
  lwPolylineEntity,
  textEntity,
  type EntityBase,
} from '../src/export/dxfEntities.js';
import { HATCH_PATTERNS } from '../src/export/hatchPatterns.js';

const base: EntityBase = { handle: '2A0', owner: '1F', layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };

function codes(pairs: DxfPair[]): number[] {
  return pairs.map((p) => p.code);
}

function valueOf(pairs: DxfPair[], code: number): string | undefined {
  return pairs.find((p) => p.code === code)?.value;
}

function valuesOf(pairs: DxfPair[], code: number): string[] {
  return pairs.filter((p) => p.code === code).map((p) => p.value);
}

describe('공통 머리', () => {
  it('모든 엔티티가 핸들·소유자·레이어·색을 갖는다', () => {
    for (const pairs of [
      lwPolylineEntity(base, [[0, 0], [1, 1]], false),
      circleEntity(base, [0, 0], 1),
      lineEntity(base, [0, 0], [1, 1]),
      textEntity(base, [0, 0], 300, '가', 'center'),
      hatchEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], HATCH_PATTERNS.ANSI31),
    ]) {
      expect(pairs[0]).toMatchObject({ code: 0 });
      expect(valueOf(pairs, 5)).toBe('2A0');
      expect(valueOf(pairs, 330)).toBe('1F');
      expect(valueOf(pairs, 8)).toBe(DAMAGE_LAYER);
      expect(valueOf(pairs, 62)).toBe('     1');
    }
  });
});

describe('lwPolylineEntity', () => {
  it('열린 폴리라인은 70=0이고 꼭짓점 수를 적는다', () => {
    const pairs = lwPolylineEntity(base, [[0, 0], [10, 20], [30, 40]], false);
    expect(pairs[0].value).toBe('LWPOLYLINE');
    expect(valueOf(pairs, 90)).toBe('3');
    expect(valueOf(pairs, 70)).toBe('     0');
    expect(valuesOf(pairs, 10)).toEqual(['0.0', '10.0', '30.0']);
    expect(valuesOf(pairs, 20)).toEqual(['0.0', '20.0', '40.0']);
    expect(codes(pairs).filter((c) => c === 100)).toHaveLength(2);
  });

  it('닫힌 폴리라인은 70=1이고 첫 점을 되풀이하지 않는다', () => {
    const pairs = lwPolylineEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
    expect(valueOf(pairs, 70)).toBe('     1');
    expect(valueOf(pairs, 90)).toBe('4');
    expect(valuesOf(pairs, 10)).toHaveLength(4);
  });

  it('점이 둘 미만이면 던진다', () => {
    expect(() => lwPolylineEntity(base, [[0, 0]], false)).toThrow(/점이 둘 이상/);
  });
});

describe('circleEntity / lineEntity', () => {
  it('원은 중심과 반지름을 적는다', () => {
    const pairs = circleEntity(base, [100, -200], 27.2);
    expect(pairs[0].value).toBe('CIRCLE');
    expect(valueOf(pairs, 10)).toBe('100.0');
    expect(valueOf(pairs, 20)).toBe('-200.0');
    expect(valueOf(pairs, 40)).toBe('27.2');
  });

  it('선은 두 끝점을 적는다', () => {
    const pairs = lineEntity(base, [0, 0], [212, -212]);
    expect(pairs[0].value).toBe('LINE');
    expect(valueOf(pairs, 10)).toBe('0.0');
    expect(valueOf(pairs, 11)).toBe('212.0');
    expect(valueOf(pairs, 21)).toBe('-212.0');
    expect(valueOf(pairs, 31)).toBe('0.0');
  });
});

describe('textEntity', () => {
  it('가운데 정렬은 72=1, 73=2이고 정렬점에 위치를 넣는다', () => {
    const pairs = textEntity(base, [500, 900], 300, '균열', 'center');
    expect(pairs[0].value).toBe('TEXT');
    expect(valueOf(pairs, 40)).toBe('300.0');
    expect(valueOf(pairs, 1)).toBe('균열');
    expect(valueOf(pairs, 72)).toBe('     1');
    expect(valueOf(pairs, 73)).toBe('     2');
    expect(valueOf(pairs, 11)).toBe('500.0');
    expect(valueOf(pairs, 21)).toBe('900.0');
    // 10/20에도 같은 점을 넣어 둔다 (72·73을 무시하는 오래된 읽기 구현 대비)
    expect(valueOf(pairs, 10)).toBe('500.0');
    expect(valueOf(pairs, 20)).toBe('900.0');
    // 73은 두 번째 AcDbText 다음에 온다
    const marks = pairs.map((p, i) => (p.code === 100 && p.value === 'AcDbText' ? i : -1)).filter((i) => i >= 0);
    expect(marks).toHaveLength(2);
    expect(pairs.findIndex((p) => p.code === 73)).toBeGreaterThan(marks[1]);
  });

  it('왼쪽 정렬은 72=0', () => {
    expect(valueOf(textEntity(base, [0, 0], 300, 'a', 'left'), 72)).toBe('     0');
  });

  it('글꼴 스타일(코드 7)은 쓰지 않는다 — Standard', () => {
    expect(codes(textEntity(base, [0, 0], 300, 'a', 'center'))).not.toContain(7);
  });
});

describe('hatchEntity', () => {
  it('비연관 해치에 패턴 선 정의를 담는다', () => {
    const boundary: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const pairs = hatchEntity(base, boundary, HATCH_PATTERNS.ANSI33);

    expect(pairs[0].value).toBe('HATCH');
    expect(valueOf(pairs, 2)).toBe('ANSI33');
    expect(valueOf(pairs, 70)).toBe('     0'); // 단색 채우기 아님
    expect(valueOf(pairs, 71)).toBe('     0'); // 비연관
    expect(valueOf(pairs, 91)).toBe('        1'); // 경계 1개
    expect(valueOf(pairs, 92)).toBe('        7');
    expect(valueOf(pairs, 73)).toBe('     1'); // 닫힌 경계
    // 경계는 첫 점을 되풀이해 5개로 적는다 (AutoCAD가 내보낸 형식과 같게)
    expect(valueOf(pairs, 93)).toBe('        5');
    // 코드 10은 [높이 기준점, 경계 4점, 되풀이한 첫 점, 시드점] 순서다
    expect(valuesOf(pairs, 10).slice(1, -1)).toEqual(['0.0', '100.0', '100.0', '0.0', '0.0']);
    expect(valueOf(pairs, 97)).toBe('        0'); // 경계 원본 객체 없음
    expect(valueOf(pairs, 41)).toBe('50.0'); // 축척
    expect(valueOf(pairs, 52)).toBe('0.0'); // 각도
    expect(valueOf(pairs, 78)).toBe('     2'); // 패턴 선 2개
    expect(valuesOf(pairs, 53)).toEqual(['45.0', '45.0']);
    expect(valuesOf(pairs, 79)).toEqual(['     0', '     2']);
    expect(valuesOf(pairs, 49)).toEqual(['158.75', '-79.375']);
    // 시드점은 경계의 무게중심
    expect(valuesOf(pairs, 10).at(-1)).toBe('50.0');
    expect(valuesOf(pairs, 20).at(-1)).toBe('25.0');
  });

  it('점선이 없는 패턴은 49를 쓰지 않는다', () => {
    const pairs = hatchEntity(base, [[0, 0], [1, 0], [1, 1], [0, 1]], HATCH_PATTERNS.ANSI31);
    expect(valuesOf(pairs, 49)).toEqual([]);
    expect(valuesOf(pairs, 79)).toEqual(['     0']);
  });

  it('경계가 셋 미만이면 던진다', () => {
    expect(() => hatchEntity(base, [[0, 0], [1, 1]], HATCH_PATTERNS.ANSI31)).toThrow(/점이 셋 이상/);
  });
});
```

`npm --prefix server test` — 두 파일이 없어 실패하는 것을 확인한다.

- [ ] **Step 2: `server/src/export/hatchPatterns.ts`를 쓴다**

```ts
// 해치 패턴 선 정의. DXF의 HATCH는 무늬 이름만으로는 부족하고 이 정의를 엔티티 안에 담아야
// 받는 쪽에 .pat 파일이 없어도 같은 무늬로 그려진다.
//
// 값의 출처: 사내 망도 docs/exam.dxf 범례의 해치 엔티티(코드 53/43/44/45/46/79/49)를 그대로
// 읽은 것이며, 유형별 축척이 이미 반영돼 있다. 기준점(43/44)만 원본이 아주 큰 절대값이라
// 첫 줄의 기준점을 0으로 옮겨 선 사이 상대 간격만 남겼다 — 무늬는 무한히 반복되므로
// 기준점의 절대 위치는 화면에 보이지 않는다. ANCHORLK는 원본 값이 이미 작아 그대로 둔다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5장,
//       docs/superpowers/specs/2026-09-12-damage-types-design.md 2장·부록 A

export interface HatchPatternLine {
  /** 코드 53. 도 단위 */
  angle: number;
  /** 코드 43 */
  baseX: number;
  /** 코드 44 */
  baseY: number;
  /** 코드 45 */
  offsetX: number;
  /** 코드 46 */
  offsetY: number;
  /** 코드 49. 비어 있으면 실선(코드 79 = 0) */
  dashes: number[];
}

export interface HatchPattern {
  name: string;
  /** 코드 41. 아래 선 정의가 이미 이 축척으로 계산돼 있다 */
  scale: number;
  /** 코드 52 */
  angle: number;
  lines: HatchPatternLine[];
}

export const HATCH_PATTERNS: Readonly<Record<string, HatchPattern>> = {
  ANSI31: {
    name: 'ANSI31',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -112.2532015133644, offsetY: 112.2532015133644, dashes: [] },
    ],
  },
  ANSI33: {
    name: 'ANSI33',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -224.5064030267288, offsetY: 224.5064030267288, dashes: [] },
      { angle: 45, baseX: 224.5065, baseY: 0, offsetX: -224.5064030267288, offsetY: 224.5064030267288, dashes: [158.75, -79.375] },
    ],
  },
  ANSI37: {
    name: 'ANSI37',
    scale: 60,
    angle: 0,
    lines: [
      { angle: 45, baseX: 0, baseY: 0, offsetX: -134.7038418160373, offsetY: 134.7038418160373, dashes: [] },
      { angle: 135, baseX: 0, baseY: 0, offsetX: -134.7038418160373, offsetY: -134.7038418160373, dashes: [] },
    ],
  },
  CORK: {
    name: 'CORK',
    scale: 35,
    angle: 0,
    lines: [
      { angle: 0, baseX: 0, baseY: 0, offsetX: 0, offsetY: 111.125, dashes: [] },
      { angle: 135, baseX: 55.5625, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
      { angle: 135, baseX: 83.34375, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
      { angle: 135, baseX: 111.125, baseY: -55.5625, offsetX: -222.2500959986407, offsetY: -222.2500959986407, dashes: [157.15455, -157.15455] },
    ],
  },
  TRIANG: {
    name: 'TRIANG',
    scale: 25,
    angle: 0,
    lines: [
      { angle: 60, baseX: 0, baseY: 0, offsetX: -119.0624573255854, offsetY: 206.2222746380848, dashes: [119.0625, -119.0625] },
      { angle: 120, baseX: 0, baseY: 0, offsetX: -238.1249573255855, offsetY: 0.0000246380847909, dashes: [119.0625, -119.0625] },
      { angle: 0, baseX: -59.53125, baseY: 103.11125, offsetX: 119.0625, offsetY: 206.22225, dashes: [119.0625, -119.0625] },
    ],
  },
  ANCHORLK: {
    name: 'ANCHORLK',
    scale: 50,
    angle: 0,
    lines: [
      { angle: 18.435, baseX: -59.2926885, baseY: -19.7642885, offsetX: 395.2845309850569, offsetY: 197.6427068321105, dashes: [125, -500] },
      { angle: 333.435, baseX: -138.3494895, baseY: -177.878241, offsetX: 197.6423532051874, offsetY: 0.0001772066524852, dashes: [88.3883475, -353.5533905] },
      { angle: 63.435, baseX: -19.7644645, baseY: 256.9350425, offsetX: -0.0001763122260967, offsetY: 197.6423538760085, dashes: [88.3883475, -353.5533905] },
      { angle: 108.435, baseX: 19.7639355, baseY: 138.3496655, offsetX: -0.0001765358328187, offsetY: 197.6423537604449, dashes: [125, -500] },
    ],
  },
};

// 정의된 축척과 다른 축척을 쓰려면 기준점·간격·점선 길이에 비율을 곱한다(부록 A).
// 각도는 축척과 무관하다.
export function hatchPatternFor(name: string, scale: number): HatchPattern | null {
  const base = HATCH_PATTERNS[name];
  if (!base) return null;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  if (scale === base.scale) return base;
  const k = scale / base.scale;
  return {
    name: base.name,
    scale,
    angle: base.angle,
    lines: base.lines.map((line) => ({
      angle: line.angle,
      baseX: line.baseX * k,
      baseY: line.baseY * k,
      offsetX: line.offsetX * k,
      offsetY: line.offsetY * k,
      dashes: line.dashes.map((d) => d * k),
    })),
  };
}
```

- [ ] **Step 3: `server/src/export/dxfEntities.ts`를 쓴다**

```ts
// DXF 엔티티 하나를 (코드, 값) 쌍으로 만든다. 모양은 docs/exam.dxf가 실제로 담고 있는
// 형식을 그대로 따른다 — 사내 캐드에서 열리는 것이 확인된 형식이다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5·6장

import { formatInt, formatReal, pair, type DxfPair } from './dxfDocument.js';
import type { HatchPattern } from './hatchPatterns.js';

export type Point = [number, number];

export interface EntityBase {
  handle: string;
  /** 모델 공간 블록 레코드의 핸들 */
  owner: string;
  layer: string;
  colorIndex: number;
}

// 정수 값은 AutoCAD가 쓰는 자리 맞춤을 따른다(16비트 6칸, 32비트 9칸).
function int16(value: number): string {
  return formatInt(value).padStart(6, ' ');
}

function int32(value: number): string {
  return formatInt(value).padStart(9, ' ');
}

function head(base: EntityBase, type: string, subclass: string): DxfPair[] {
  return [
    pair(0, type),
    pair(5, base.handle),
    pair(330, base.owner),
    pair(100, 'AcDbEntity'),
    pair(8, base.layer),
    pair(62, int16(base.colorIndex)),
    pair(100, subclass),
  ];
}

function xy(point: Point, xCode: number, yCode: number): DxfPair[] {
  return [pair(xCode, formatReal(point[0])), pair(yCode, formatReal(point[1]))];
}

export function lwPolylineEntity(base: EntityBase, points: Point[], closed: boolean): DxfPair[] {
  if (points.length < 2) throw new Error('LWPOLYLINE은 점이 둘 이상이어야 합니다.');
  const pairs = head(base, 'LWPOLYLINE', 'AcDbPolyline');
  pairs.push(pair(90, formatInt(points.length)));
  pairs.push(pair(70, int16(closed ? 1 : 0)));
  pairs.push(pair(43, '0.0'));
  for (const point of points) pairs.push(...xy(point, 10, 20));
  return pairs;
}

export function circleEntity(base: EntityBase, center: Point, radius: number): DxfPair[] {
  const pairs = head(base, 'CIRCLE', 'AcDbCircle');
  pairs.push(...xy(center, 10, 20), pair(30, '0.0'), pair(40, formatReal(radius)));
  return pairs;
}

export function lineEntity(base: EntityBase, from: Point, to: Point): DxfPair[] {
  const pairs = head(base, 'LINE', 'AcDbLine');
  pairs.push(...xy(from, 10, 20), pair(30, '0.0'), ...xy(to, 11, 21), pair(31, '0.0'));
  return pairs;
}

// 글꼴 스타일(코드 7)은 쓰지 않는다 → Standard. docs/exam.dxf의 `균열` 글자와 같은 방식이고,
// 사내 망도에서 한글이 그대로 보이는 것이 확인됐다.
// 73(수직 정렬) = 2(중간)는 두 번째 AcDbText 표시 뒤에 와야 한다(DXF 규격).
export function textEntity(
  base: EntityBase,
  position: Point,
  height: number,
  value: string,
  align: 'center' | 'left',
): DxfPair[] {
  const pairs = head(base, 'TEXT', 'AcDbText');
  pairs.push(
    ...xy(position, 10, 20),
    pair(30, '0.0'),
    pair(40, formatReal(height)),
    pair(1, value),
    pair(72, int16(align === 'center' ? 1 : 0)),
    ...xy(position, 11, 21),
    pair(31, '0.0'),
    pair(100, 'AcDbText'),
    pair(73, int16(2)),
  );
  return pairs;
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

// AutoCAD가 내보낸 픽셀 크기 값. 무늬 모양에는 영향이 없고 화면 갱신 최적화에만 쓰인다.
const HATCH_PIXEL_SIZE = '0.1152036452310892';

export function hatchEntity(base: EntityBase, boundary: Point[], pattern: HatchPattern): DxfPair[] {
  if (boundary.length < 3) throw new Error('HATCH 경계는 점이 셋 이상이어야 합니다.');
  const pairs = head(base, 'HATCH', 'AcDbHatch');
  pairs.push(
    pair(10, '0.0'),
    pair(20, '0.0'),
    pair(30, '0.0'),
    pair(210, '0.0'),
    pair(220, '0.0'),
    pair(230, '1.0'),
    pair(2, pattern.name),
    pair(70, int16(0)), // 단색 채우기 아님
    pair(71, int16(0)), // 비연관
    pair(91, int32(1)), // 경계 1개
    pair(92, int32(7)), // 바깥 경계 + 폴리라인 + 파생
    pair(72, int16(0)), // 볼록(bulge) 없음
    pair(73, int16(1)), // 닫힌 경계
    pair(93, int32(boundary.length + 1)),
  );
  for (const point of boundary) pairs.push(...xy(point, 10, 20));
  // AutoCAD는 닫힌 경계의 첫 점을 한 번 더 적는다. 같은 형식으로 맞춘다.
  pairs.push(...xy(boundary[0], 10, 20));
  pairs.push(
    pair(97, int32(0)), // 경계 원본 객체 없음 (비연관)
    pair(75, int16(0)), // 해치 방식: 보통
    pair(76, int16(1)), // 미리 정의된 패턴
    pair(52, formatReal(pattern.angle)),
    pair(41, formatReal(pattern.scale)),
    pair(77, int16(0)), // 이중 해치 아님
    pair(78, int16(pattern.lines.length)),
  );
  for (const line of pattern.lines) {
    pairs.push(
      pair(53, formatReal(line.angle)),
      pair(43, formatReal(line.baseX)),
      pair(44, formatReal(line.baseY)),
      pair(45, formatReal(line.offsetX)),
      pair(46, formatReal(line.offsetY)),
      pair(79, int16(line.dashes.length)),
    );
    for (const dash of line.dashes) pairs.push(pair(49, formatReal(dash)));
  }
  pairs.push(pair(47, HATCH_PIXEL_SIZE), pair(98, int32(1)), ...xy(centroid(boundary), 10, 20));
  return pairs;
}
```

- [ ] **Step 4: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/hatchPatterns.ts server/src/export/dxfEntities.ts server/test/hatchPatterns.test.ts server/test/dxfEntities.test.ts
git commit -m "$(printf '%s\n' '해치 패턴 정의값과 DXF 엔티티 쌍 만들기' '' 'exam.dxf 범례에서 읽은 여섯 무늬(ANSI31/33/37, CORK, TRIANG, ANCHORLK)의' '패턴 선 정의를 고정값으로 둔다. 축척이 다르면 기준점·간격·점선에 비율을 곱한다.' '' 'LWPOLYLINE·CIRCLE·LINE·TEXT·HATCH를 exam.dxf가 담고 있는 형식 그대로 만든다.' 'TEXT는 72=1/73=2 중간 정렬이고 글꼴 스타일은 Standard다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 여섯 무늬의 패턴 정의와 다섯 엔티티 빌더가 규격대로 쌍을 만든다.

---

### Task 4: 손상 하나 → 도형·해치·기호 엔티티

**Files:**
- Create: `server/src/export/damageEntities.ts`
- Create: `server/test/damageEntities.test.ts`

**Interfaces:**
- Consumes:
  - `getDamageType(id)` from `../../public/viewer/damageTypes.js` — `{ id, label, kind, fill, decoration, layer, colorIndex, quantityUnit } | null`
  - `hatchPatternFor(name, scale)` from `./hatchPatterns.js`
  - `lwPolylineEntity`, `hatchEntity`, `lineEntity`, `circleEntity`, `EntityBase`, `Point` from `./dxfEntities.js`
  - `HandleAllocator`, `DAMAGE_LAYER`, `DAMAGE_COLOR`, `DxfPair` from `./dxfDocument.js`
- Produces:
  - `interface DamageLike { id?: unknown; type?: unknown; geometry?: { kind?: unknown; dwg?: unknown; world?: unknown } }`
  - `function dwgPointsOf(damage: unknown): Point[] | null` — `geometry.dwg`가 배열이고 점이 둘 이상이며 모두 유한한 수일 때만 점 배열, 아니면 `null`
  - `function rebarSymbolSegments(rect: Point[], lineGapMm: number, crossSizeMm: number): Array<[Point, Point]>` — 나란한 선 2개 + ✕ 4개 = 6개. 긴 변이 `crossSizeMm` 이하면 빈 배열
  - `function decorationCircles(points: Point[], diameterMm: number, spacingMm: number, offsetMm: number): Array<{ center: Point; radius: number }>` — 선을 따라 `spacingMm/2`부터 `spacingMm`마다, 위·아래 번갈아. 최대 1000개
  - `function damageEntities(damage: unknown, alloc: HandleAllocator, owner: string): DxfPair[]` — 도형 + 해치 + 기호. 라벨은 넣지 않는다. `dwg`가 없으면 빈 배열

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/damageEntities.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import {
  damageEntities,
  decorationCircles,
  dwgPointsOf,
  rebarSymbolSegments,
} from '../src/export/damageEntities.js';

type Pt = [number, number];

function damage(type: string, kind: 'polyline' | 'rect', dwg: Pt[] | null) {
  return {
    id: `d-${type}`,
    type,
    geometry: { kind, world: [[0, 0], [1, 1]] as Pt[], dwg },
  };
}

// 원점에서 시작하는 가로 3000 × 세로 1000 사각형
const RECT: Pt[] = [[0, 0], [3000, 0], [3000, 1000], [0, 1000]];

function entityTypes(pairs: DxfPair[]): string[] {
  return pairs.filter((p) => p.code === 0).map((p) => p.value);
}

function valuesOf(pairs: DxfPair[], code: number): string[] {
  return pairs.filter((p) => p.code === code).map((p) => p.value);
}

describe('dwgPointsOf', () => {
  it('점 배열을 그대로 준다', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', [[1, 2], [3, 4]]))).toEqual([[1, 2], [3, 4]]);
  });

  it('dwg가 null이면 null', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', null))).toBeNull();
  });

  it('점이 하나뿐이거나 숫자가 아니면 null', () => {
    expect(dwgPointsOf(damage('crack', 'polyline', [[1, 2]]))).toBeNull();
    expect(dwgPointsOf({ geometry: { kind: 'polyline', dwg: [[1, 2], [Number.NaN, 4]] } })).toBeNull();
    expect(dwgPointsOf({ geometry: { kind: 'polyline', dwg: 'nope' } })).toBeNull();
    expect(dwgPointsOf(null)).toBeNull();
  });
});

describe('rebarSymbolSegments', () => {
  it('나란한 선 2개와 ✕ 4개, 모두 6개를 만든다', () => {
    expect(rebarSymbolSegments(RECT, 57.4, 212)).toHaveLength(6);
  });

  it('선은 긴 변 방향이고 간격 57.4를 두며 길이는 긴 변 − 212다', () => {
    const [first, second] = rebarSymbolSegments(RECT, 57.4, 212);
    // 사각형 중심 (1500, 500), 긴 변은 x 방향(3000), 선 길이 3000 - 212 = 2788
    expect(first[0][0]).toBeCloseTo(1500 - 1394, 6);
    expect(first[1][0]).toBeCloseTo(1500 + 1394, 6);
    expect(Math.abs(first[0][1] - second[0][1])).toBeCloseTo(57.4, 6);
    expect((first[0][1] + second[0][1]) / 2).toBeCloseTo(500, 6);
  });

  it('✕는 212×212이고 중심이 선 끝에 있다', () => {
    const crosses = rebarSymbolSegments(RECT, 57.4, 212).slice(2);
    expect(crosses).toHaveLength(4);
    for (const [a, b] of crosses) {
      expect(Math.abs(a[0] - b[0])).toBeCloseTo(212, 6);
      expect(Math.abs(a[1] - b[1])).toBeCloseTo(212, 6);
    }
    // 두 ✕의 중심은 x = 1500 ± 1394
    const centers = [0, 2].map((i) => (crosses[i][0][0] + crosses[i][1][0]) / 2);
    expect(centers[0]).toBeCloseTo(106, 6);
    expect(centers[1]).toBeCloseTo(2894, 6);
  });

  it('세로로 긴 사각형은 세로 방향으로 그린다', () => {
    const tall: Pt[] = [[0, 0], [1000, 0], [1000, 3000], [0, 3000]];
    const [first, second] = rebarSymbolSegments(tall, 57.4, 212);
    expect(first[0][1]).toBeCloseTo(1500 - 1394, 6);
    expect(Math.abs(first[0][0] - second[0][0])).toBeCloseTo(57.4, 6);
  });

  it('긴 변이 ✕ 크기 이하면 기호를 그리지 않는다', () => {
    const tiny: Pt[] = [[0, 0], [200, 0], [200, 100], [0, 100]];
    expect(rebarSymbolSegments(tiny, 57.4, 212)).toEqual([]);
  });
});

describe('decorationCircles', () => {
  it('간격의 절반에서 시작해 간격마다 놓는다', () => {
    const circles = decorationCircles([[0, 0], [500, 0]], 54.4, 158, 77);
    expect(circles.map((c) => c.center[0])).toEqual([79, 237, 395]);
    expect(circles[0].radius).toBeCloseTo(27.2, 6);
  });

  it('위·아래를 번갈아 둔다', () => {
    const circles = decorationCircles([[0, 0], [500, 0]], 54.4, 158, 77);
    expect(circles.map((c) => c.center[1])).toEqual([77, -77, 77]);
  });

  it('선이 간격의 절반보다 짧으면 원이 없다', () => {
    expect(decorationCircles([[0, 0], [50, 0]], 54.4, 158, 77)).toEqual([]);
  });

  it('꺾인 선에서도 그 구간의 법선 방향으로 놓는다', () => {
    // 아래로 내려가는 선: 방향 (0,-1), 법선 (1, 0)
    const circles = decorationCircles([[0, 0], [0, -500]], 54.4, 158, 77);
    expect(circles[0].center[0]).toBeCloseTo(77, 6);
    expect(circles[0].center[1]).toBeCloseTo(-79, 6);
  });

  it('아주 긴 선에서도 1000개를 넘지 않는다', () => {
    expect(decorationCircles([[0, 0], [1_000_000, 0]], 54.4, 158, 77)).toHaveLength(1000);
  });
});

describe('damageEntities', () => {
  const owner = '1F';

  it('균열은 열린 폴리라인 하나다', () => {
    const pairs = damageEntities(damage('crack', 'polyline', [[0, 0], [100, 100]]), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE']);
    expect(valuesOf(pairs, 70)).toEqual(['     0']);
    expect(valuesOf(pairs, 8)).toEqual(['신규손상']);
  });

  it('박락은 닫힌 폴리라인과 ANSI37 해치다', () => {
    const pairs = damageEntities(damage('spalling', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'HATCH']);
    expect(valuesOf(pairs, 2)).toEqual(['ANSI37']);
    expect(valuesOf(pairs, 41)).toEqual(['60.0']);
  });

  it('망상균열은 ANCHORLK, 파손은 ANSI33을 쓴다', () => {
    const anchor = damageEntities(damage('map_crack', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(valuesOf(anchor, 2)).toEqual(['ANCHORLK']);
    const breakage = damageEntities(damage('breakage', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(valuesOf(breakage, 2)).toEqual(['ANSI33']);
  });

  it('철근노출은 닫힌 폴리라인과 선 6개다 (해치 없음)', () => {
    const pairs = damageEntities(damage('rebar_exposure', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE', 'LINE']);
  });

  it('균열/백태는 열린 폴리라인과 원들이다', () => {
    const pairs = damageEntities(
      damage('crack_efflorescence', 'polyline', [[0, 0], [500, 0]]),
      new HandleAllocator(0x100),
      owner,
    );
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE', 'CIRCLE', 'CIRCLE', 'CIRCLE']);
  });

  it('핸들을 엔티티마다 하나씩 새로 받는다', () => {
    const alloc = new HandleAllocator(0x100);
    const pairs = damageEntities(damage('spalling', 'rect', RECT), alloc, owner);
    expect(valuesOf(pairs, 5)).toEqual(['100', '101']);
    expect(alloc.seed).toBe('102');
  });

  it('dwg가 없으면 아무것도 만들지 않는다', () => {
    expect(damageEntities(damage('crack', 'polyline', null), new HandleAllocator(0x100), owner)).toEqual([]);
  });

  it('유형 목록에 없는 type도 테두리는 그린다', () => {
    const pairs = damageEntities(damage('없는유형', 'rect', RECT), new HandleAllocator(0x100), owner);
    expect(entityTypes(pairs)).toEqual(['LWPOLYLINE']);
    expect(valuesOf(pairs, 70)).toEqual(['     1']);
  });
});
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/export/damageEntities.ts`를 쓴다**

```ts
// 손상 하나를 도면 엔티티로 바꾼다. 유형별 규칙은 damageTypes.js의 정의를 그대로 읽는다 —
// 유형이 늘거나 해치가 바뀌어도 이 파일은 손대지 않는다.
// 좌표는 geometry.dwg(도면 모델 좌표, mm)를 그대로 쓴다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 5장,
//       docs/superpowers/specs/2026-09-12-damage-types-design.md 4.1절·8장

import { getDamageType } from '../../public/viewer/damageTypes.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, hatchEntity, lineEntity, lwPolylineEntity, type EntityBase, type Point } from './dxfEntities.js';
import { hatchPatternFor } from './hatchPatterns.js';

// 아주 긴 선에 원을 무한히 찍어 파일이 폭발하는 것을 막는다.
const MAX_DECORATION_CIRCLES = 1000;

export function dwgPointsOf(damage: unknown): Point[] | null {
  const raw = (damage as { geometry?: { dwg?: unknown } } | null)?.geometry?.dwg;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const points: Point[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) return null;
    points.push([entry[0] as number, entry[1] as number]);
  }
  return points;
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

function unit(dx: number, dy: number): Point {
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

// 사각형의 긴 변 방향으로 가운데에 선 2개를 긋고 양 끝에 ✕를 둔다.
// 선 간격(lineGapMm)과 ✕ 크기(crossSizeMm)는 고정값이고 선 길이만 사각형 크기에 맞춘다.
export function rebarSymbolSegments(rect: Point[], lineGapMm: number, crossSizeMm: number): Array<[Point, Point]> {
  if (rect.length < 4) return [];
  const center: Point = [
    (rect[0][0] + rect[1][0] + rect[2][0] + rect[3][0]) / 4,
    (rect[0][1] + rect[1][1] + rect[2][1] + rect[3][1]) / 4,
  ];
  const edgeA = Math.hypot(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1]);
  const edgeB = Math.hypot(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const longIsA = edgeA >= edgeB;
  const longLength = longIsA ? edgeA : edgeB;
  const along = longIsA
    ? unit(rect[1][0] - rect[0][0], rect[1][1] - rect[0][1])
    : unit(rect[3][0] - rect[0][0], rect[3][1] - rect[0][1]);
  const across: Point = [-along[1], along[0]];

  const lineLength = longLength - crossSizeMm;
  if (!(lineLength > 0)) return [];

  const half = lineLength / 2;
  const gap = lineGapMm / 2;
  const at = (u: number, v: number): Point => [
    center[0] + along[0] * u + across[0] * v,
    center[1] + along[1] * u + across[1] * v,
  ];

  const segments: Array<[Point, Point]> = [
    [at(-half, gap), at(half, gap)],
    [at(-half, -gap), at(half, -gap)],
  ];
  const arm = crossSizeMm / 2;
  for (const u of [-half, half]) {
    segments.push([at(u - arm, -arm), at(u + arm, arm)]);
    segments.push([at(u - arm, arm), at(u + arm, -arm)]);
  }
  return segments;
}

// 그은 선을 따라 일정 간격으로 원을 반복하고 위·아래를 번갈아 둔다.
// 첫 원은 선 시작에서 간격의 절반 지점이다 — 짧은 선에도 원이 하나는 찍히게 한다.
export function decorationCircles(
  points: Point[],
  diameterMm: number,
  spacingMm: number,
  offsetMm: number,
): Array<{ center: Point; radius: number }> {
  if (points.length < 2 || !(spacingMm > 0)) return [];
  const radius = diameterMm / 2;
  const circles: Array<{ center: Point; radius: number }> = [];

  let travelled = 0;
  let nextAt = spacingMm / 2;
  let index = 0;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const direction = unit(dx, dy);
    const normal: Point = [-direction[1], direction[0]];
    while (nextAt <= travelled + length) {
      if (circles.length >= MAX_DECORATION_CIRCLES) return circles;
      const t = nextAt - travelled;
      const sign = index % 2 === 0 ? 1 : -1;
      circles.push({
        center: [
          from[0] + direction[0] * t + normal[0] * offsetMm * sign,
          from[1] + direction[1] * t + normal[1] * offsetMm * sign,
        ],
        radius,
      });
      index += 1;
      nextAt += spacingMm;
    }
    travelled += length;
  }
  return circles;
}

export function damageEntities(damage: unknown, alloc: HandleAllocator, owner: string): DxfPair[] {
  const points = dwgPointsOf(damage);
  if (!points) return [];

  const type = getDamageType((damage as { type?: unknown }).type);
  const closed = (damage as { geometry?: { kind?: unknown } }).geometry?.kind === 'rect';
  const pairs: DxfPair[] = [...lwPolylineEntity(baseFor(alloc, owner), points, closed)];

  const fill = type?.fill;
  if (fill && fill.kind === 'hatch' && closed && points.length >= 3) {
    const pattern = hatchPatternFor(fill.pattern, fill.scale);
    // 정의에 없는 무늬는 테두리만 남긴다 — 이름만 적은 HATCH는 캐드에서 빈 채로 열린다.
    if (pattern) pairs.push(...hatchEntity(baseFor(alloc, owner), points, pattern));
  }

  const decoration = type?.decoration;
  if (decoration && decoration.kind === 'rebar' && closed) {
    for (const [from, to] of rebarSymbolSegments(points, decoration.lineGapMm, decoration.crossSizeMm)) {
      pairs.push(...lineEntity(baseFor(alloc, owner), from, to));
    }
  } else if (decoration && decoration.kind === 'circles') {
    for (const { center, radius } of decorationCircles(
      points,
      decoration.diameterMm,
      decoration.spacingMm,
      decoration.offsetMm,
    )) {
      pairs.push(...circleEntity(baseFor(alloc, owner), center, radius));
    }
  }

  return pairs;
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/damageEntities.ts server/test/damageEntities.test.ts
git commit -m "$(printf '%s\n' '손상 하나를 도형·해치·기호 엔티티로 바꾼다' '' '선형은 열린 폴리라인, 면형은 닫힌 폴리라인 + 유형별 해치.' '철근노출은 나란한 선 2개와 양 끝 ✕(212×212), 균열/백태는 선을 따라' '158mm 간격으로 지름 54.4mm 원을 위·아래 번갈아 찍는다.' '' '유형별 규칙은 damageTypes.js 정의를 그대로 읽는다. dwg 좌표가 없는 손상은' '아무것도 만들지 않는다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 손상 10종이 각자의 규칙대로 엔티티가 되고, 기호 치수가 사내 망도 실측값과 같다.

---

### Task 5: 라벨을 도면 실치수로 배치한다

앱 화면과 **같은 배치**여야 하므로 `overlay.js`의 `labelAnchor`·`labelLayout`을 그대로 부른다. 두 함수는 화면 좌표계(y가 아래로 증가)를 전제하므로, 도면 좌표를 넣을 때 **y 부호를 뒤집어 넣고 결과의 y를 다시 뒤집는다**. 배치 규칙을 베낀 코드가 두 벌이 되면 언젠가 어긋나므로 그렇게 하지 않는다.

`labelLayout`이 주는 `y`는 글자의 **베이스라인**이다. 산출 `TEXT`는 수직 중간 정렬(73=2)이므로 정렬점은 베이스라인에서 `글자 높이 × BASELINE_CENTER_FACTOR`만큼 위다 — 같은 값을 쓰는 번호 원의 중심 높이와 정확히 같은 줄이다.

**Files:**
- Create: `server/src/export/labelPlacement.ts`
- Create: `server/test/labelPlacement.test.ts`

**Interfaces:**
- Consumes:
  - `labelAnchor(screenPoints, gapPx)`, `labelLayout({ anchor, name, dimension, photo, number, fontPx, circleRPx })`, `FONT_HEIGHT_MM`(300), `CIRCLE_RADIUS_FACTOR`(0.85), `LABEL_GAP_MM`(100), `BASELINE_CENTER_FACTOR`(0.35) from `../../public/viewer/overlay.js`
  - `drawingNameOf`, `dimensionTextOf`, `photoTextOf` from `../../public/viewer/quantities.js`
  - `dwgPointsOf` from `./damageEntities.js`
  - `circleEntity`, `textEntity`, `EntityBase`, `Point` from `./dxfEntities.js`
  - `HandleAllocator`, `DAMAGE_LAYER`, `DAMAGE_COLOR`, `DxfPair` from `./dxfDocument.js`
- Produces:
  - `interface LabelTextLine { position: Point; text: string; align: 'center' | 'left' }`
  - `interface DamageLabel { circle: { center: Point; radius: number } | null; lines: LabelTextLine[]; height: number }`
  - `function damageLabel(damage: unknown, number: number | null): DamageLabel | null` — `dwg`가 없으면 `null`. 그릴 것이 없으면 `{ circle: null, lines: [], height: 300 }`
  - `function labelEntities(label: DamageLabel, alloc: HandleAllocator, owner: string): DxfPair[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/labelPlacement.test.ts` (새 파일):

```ts
import { describe, expect, it } from 'vitest';
import {
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
  LABEL_GAP_MM,
} from '../public/viewer/overlay.js';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import { damageLabel, labelEntities } from '../src/export/labelPlacement.js';

type Pt = [number, number];

// 가로 0..1000, 세로 0..400 사각형. 위쪽 경계는 y = 400, 가로 가운데는 x = 500.
const RECT: Pt[] = [[0, 0], [1000, 0], [1000, 400], [0, 400]];

function rect(type: string, measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    type,
    geometry: { kind: 'rect', world: RECT, dwg: RECT },
    measured: { width: null, length: null, count: null, ...measured },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}

function entityTypes(pairs: DxfPair[]): string[] {
  return pairs.filter((p) => p.code === 0).map((p) => p.value);
}

describe('damageLabel', () => {
  it('dwg가 없으면 null', () => {
    const damage = { id: 'a', type: 'crack', geometry: { kind: 'polyline', world: RECT, dwg: null } };
    expect(damageLabel(damage, 1)).toBeNull();
  });

  it('맨 아래 줄이 도형 위쪽 경계에서 100만큼 떨어진 자리다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    // 줄이 둘(이름줄, 치수줄)이고 맨 아래가 치수줄이다.
    expect(label.lines).toHaveLength(3); // 번호 + 이름 + 치수
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    // 베이스라인은 400 + 100, 중간 정렬점은 거기서 글자 높이 × 0.35 위
    expect(dimension.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    expect(dimension.position[0]).toBeCloseTo(500, 6);
    expect(dimension.align).toBe('center');
  });

  it('윗줄은 한 줄 간격(글자 높이 × 1.3)만큼 위에 있다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(name.position[1] - dimension.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('번호 원의 반지름은 글자 높이 × 0.85이고 중심은 이름줄과 같은 높이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(label.circle).not.toBeNull();
    expect(label.circle!.radius).toBeCloseTo(FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR, 6);
    expect(label.circle!.center[1]).toBeCloseTo(name.position[1], 6);
    expect(label.circle!.center[0]).toBeLessThan(name.position[0]);
  });

  it('번호 글자는 원 가운데, 이름은 원 오른쪽에서 왼쪽 정렬이다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const number = label.lines.find((l) => l.text === '7')!;
    const name = label.lines.find((l) => l.text === '박락')!;
    expect(number.align).toBe('center');
    expect(number.position[0]).toBeCloseTo(label.circle!.center[0], 6);
    expect(name.align).toBe('left');
  });

  it('균열은 이름 없이 번호 원만 그린다', () => {
    const label = damageLabel(rect('crack', { width: 0.2, length: 1.5, count: 1 }), 3)!;
    expect(label.lines.map((l) => l.text)).toEqual(['3', '0.2/1.5']);
    expect(label.circle!.center[0]).toBeCloseTo(500, 6);
  });

  it('사진번호가 있으면 맨 아래 줄이 사진 줄이다', () => {
    const label = damageLabel(
      rect('spalling', { width: 1.2, length: 1.5, count: 1 }, { photoNumbers: ['12', '13'] }),
      7,
    )!;
    const photo = label.lines.find((l) => l.text === '사진 12, 13')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
    const dimension = label.lines.find((l) => l.text === '1.2x1.5')!;
    expect(dimension.position[1] - photo.position[1]).toBeCloseTo(FONT_HEIGHT_MM * 1.3, 6);
  });

  it('치수가 없으면 사진 줄이 그 자리로 올라온다 — 빈 줄을 남기지 않는다', () => {
    const label = damageLabel(rect('spalling', {}, { photoNumbers: ['12'] }), 7)!;
    expect(label.lines.map((l) => l.text)).toEqual(['7', '박락', '사진 12']);
    const photo = label.lines.find((l) => l.text === '사진 12')!;
    expect(photo.position[1]).toBeCloseTo(400 + LABEL_GAP_MM + FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR, 6);
  });

  it('번호가 없고 이름도 없으면 그릴 것이 없다', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(label.circle).toBeNull();
    expect(label.lines).toEqual([]);
  });

  it('글자 높이는 300이다', () => {
    expect(damageLabel(rect('spalling', {}), 1)!.height).toBe(300);
  });
});

describe('labelEntities', () => {
  it('원 하나와 글자들을 만들고 핸들을 하나씩 받는다', () => {
    const label = damageLabel(rect('spalling', { width: 1.2, length: 1.5, count: 1 }), 7)!;
    const alloc = new HandleAllocator(0x300);
    const pairs = labelEntities(label, alloc, '1F');

    expect(entityTypes(pairs)).toEqual(['CIRCLE', 'TEXT', 'TEXT', 'TEXT']);
    expect(pairs.filter((p) => p.code === 5).map((p) => p.value)).toEqual(['300', '301', '302', '303']);
    expect(alloc.seed).toBe('304');
    expect(pairs.filter((p) => p.code === 8).every((p) => p.value === '신규손상')).toBe(true);
    expect(pairs.filter((p) => p.code === 40).some((p) => p.value === '300.0')).toBe(true);
  });

  it('그릴 것이 없으면 빈 배열', () => {
    const label = damageLabel(rect('crack', {}), null)!;
    expect(labelEntities(label, new HandleAllocator(0x300), '1F')).toEqual([]);
  });
});
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/export/labelPlacement.ts`를 쓴다**

```ts
// 손상 옆 라벨을 도면 실치수(mm)로 배치한다.
//
// 배치 규칙을 베껴 쓰지 않는다 — 앱 화면이 쓰는 overlay.js의 labelAnchor·labelLayout을
// 그대로 부른다. 두 함수는 화면 좌표계(y가 아래로 증가)를 전제하므로 도면 좌표의 y 부호를
// 뒤집어 넣고 결과의 y를 다시 뒤집는다. 그러면 "도형 위쪽 바깥에 위로 쌓기"가 도면에서도
// 그대로 성립한다.
//
// labelLayout이 주는 y는 글자의 베이스라인이다. 산출 TEXT는 수직 중간 정렬(73=2)을 쓰므로
// 정렬점은 베이스라인에서 글자 높이 × BASELINE_CENTER_FACTOR만큼 위다 — overlay가 번호 원의
// 중심을 잡는 데 쓰는 바로 그 값이라 원과 글자가 같은 줄에 놓인다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 6장,
//       docs/superpowers/specs/2026-09-13-damage-attributes-design.md §5.2·§9.5

import {
  BASELINE_CENTER_FACTOR,
  CIRCLE_RADIUS_FACTOR,
  FONT_HEIGHT_MM,
  LABEL_GAP_MM,
  labelAnchor,
  labelLayout,
} from '../../public/viewer/overlay.js';
import { dimensionTextOf, drawingNameOf, photoTextOf } from '../../public/viewer/quantities.js';
import { dwgPointsOf } from './damageEntities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { circleEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';

export interface LabelTextLine {
  position: Point;
  text: string;
  align: 'center' | 'left';
}

export interface DamageLabel {
  circle: { center: Point; radius: number } | null;
  lines: LabelTextLine[];
  height: number;
}

const CIRCLE_RADIUS_MM = FONT_HEIGHT_MM * CIRCLE_RADIUS_FACTOR;
// 베이스라인 → 중간 정렬점까지의 거리(도면 mm)
const BASELINE_TO_MIDDLE_MM = FONT_HEIGHT_MM * BASELINE_CENTER_FACTOR;

export function damageLabel(damage: unknown, number: number | null): DamageLabel | null {
  const points = dwgPointsOf(damage);
  if (!points) return null;

  // 화면 좌표계로 넘기기 위해 y를 뒤집는다.
  const flipped = points.map(([x, y]) => [x, -y] as Point);
  const anchor = labelAnchor(flipped, LABEL_GAP_MM);
  const layout = labelLayout({
    anchor,
    name: drawingNameOf(damage),
    dimension: dimensionTextOf(damage),
    photo: photoTextOf(damage),
    number,
    fontPx: FONT_HEIGHT_MM,
    circleRPx: CIRCLE_RADIUS_MM,
  });

  const circle = layout.circle
    ? { center: [layout.circle.cx, -layout.circle.cy] as Point, radius: layout.circle.r }
    : null;

  const lines: LabelTextLine[] = layout.lines.map((line: { x: number; y: number; text: string; anchor: string }) => ({
    // 뒤집힌 좌표계에서 "위"는 y가 작아지는 쪽이다. 중간 정렬점은 베이스라인보다 위.
    position: [line.x, -(line.y - BASELINE_TO_MIDDLE_MM)] as Point,
    text: line.text,
    align: line.anchor === 'middle' ? 'center' : 'left',
  }));

  return { circle, lines, height: FONT_HEIGHT_MM };
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

export function labelEntities(label: DamageLabel, alloc: HandleAllocator, owner: string): DxfPair[] {
  const pairs: DxfPair[] = [];
  if (label.circle) {
    pairs.push(...circleEntity(baseFor(alloc, owner), label.circle.center, label.circle.radius));
  }
  for (const line of label.lines) {
    if (line.text === '') continue;
    pairs.push(...textEntity(baseFor(alloc, owner), line.position, label.height, line.text, line.align));
  }
  return pairs;
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/labelPlacement.ts server/test/labelPlacement.test.ts
git commit -m "$(printf '%s\n' '라벨을 도면 실치수로 배치한다' '' '앱 화면이 쓰는 overlay.js의 labelAnchor·labelLayout을 그대로 부른다.' 'y 부호만 뒤집어 넣고 결과를 되돌려, 배치 규칙이 두 벌이 되지 않게 했다.' '' '글자 높이 300, 번호 원 반지름 255, 도형에서 100 띄우기, 줄 간격 1.3배는' '모두 앱과 같은 상수다. TEXT는 수직 중간 정렬이라 베이스라인에서' '글자 높이 × 0.35만큼 올린 점을 정렬점으로 쓴다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 라벨 좌표가 앱 화면 배치와 같은 규칙으로 도면 mm 단위에 놓인다.

---

### Task 6: 표 찾기와 칸 좌표 계산

`ACAD_TABLE` 엔티티가 격자를 직접 들고 있다 — 행 높이(코드 141), 열 너비(코드 142), 삽입점(10/20), 표 모양이 담긴 익명 블록 이름(코드 2). 사내 템플릿 `docs/빈도면(테이블버전).dxf`에서 확인한 값이 스펙 7.1의 실측과 정확히 같다(열 경계 `0 1003.1 2719.2 5891.2 7088.3 8295.0 9299.5 10695.4 11795.5`, 행 높이 `840.1` + `667.1` × 37, 표 삽입점 `(879243.6, 71105.5)`). 그래서 격자는 `ACAD_TABLE`에서 읽고, **글자 높이와 데이터 1행 위치는 스펙 7.3대로 표 블록의 `MTEXT`(`번호`와 인쇄된 `1`)에서 읽는다.**

표가 `망도틀` 같은 블록 안에 있으면 그 블록의 `INSERT`를 따라 절대 좌표로 옮긴다. 사내 템플릿은 `망도틀`이 7번 삽입돼 있어 같은 표가 7장 나온다 — 스펙 7.3의 "표가 여러 개"가 이 경우다. 어느 블록에도 삽입되지 않은 블록 안의 표는 도면에 보이지 않으므로 후보에서 뺀다.

**Files:**
- Create: `server/src/export/tableGrid.ts`
- Create: `server/test/tableGrid.test.ts`

**Interfaces:**
- Consumes: `DxfDocument`, `DxfPair`, `findSection` from `./dxfDocument.js`; `Point` from `./dxfEntities.js`
- Produces:
  - `interface Transform { x: number; y: number; scaleX: number; scaleY: number; rotationRad: number }`
  - `const IDENTITY: Transform`
  - `function applyTransform(t: Transform, point: Point): Point` — `절대 = 삽입점 + 회전(배율 × 블록좌표)`
  - `function composeTransform(outer: Transform, inner: Transform): Transform`
  - `interface BlockLine { from: Point; to: Point }`
  - `interface BlockText { text: string; position: Point; height: number }`
  - `interface TableCandidate { blockName: string; position: Point; rowHeights: number[]; colWidths: number[]; transform: Transform }`
  - `interface TableGrid { blockName: string; position: Point; transform: Transform; colBoundaries: number[]; rowBoundaries: number[]; firstDataRow: number; dataRowCount: number; textHeight: number; numberColumn: number; headerLines: BlockLine[]; headerTexts: BlockText[] }`
  - `function mtextPlainText(raw: string): string`
  - `function findTableCandidates(doc: DxfDocument): TableCandidate[]`
  - `function tableCenter(candidate: TableCandidate): Point`
  - `function nearestTable(candidates: TableCandidate[], center: Point): TableCandidate | null`
  - `function buildGrid(doc: DxfDocument, candidate: TableCandidate): TableGrid | null` — 데이터 1행을 못 찾거나 열이 8개 미만이면 `null`
  - `function cellCenter(grid: TableGrid, dataRow: number, column: number): Point` — `dataRow`는 1부터. 표 로컬 → 모델 좌표
  - `function modelTextHeight(grid: TableGrid): number` — `textHeight × |scaleX|`
  - `function hasUniformScale(t: Transform): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/tableGrid.test.ts` (새 파일):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDxf } from '../src/export/dxfDocument.js';
import {
  applyTransform,
  buildGrid,
  cellCenter,
  composeTransform,
  findTableCandidates,
  hasUniformScale,
  IDENTITY,
  modelTextHeight,
  mtextPlainText,
  nearestTable,
  tableCenter,
  type Transform,
} from '../src/export/tableGrid.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function templateDoc() {
  return parseDxf(await readFile(fixturePath, 'utf8'));
}

describe('mtextPlainText', () => {
  it('글꼴 지정과 중괄호를 걷어낸다', () => {
    expect(mtextPlainText('{\\f굴림|b0|i0|c129|p2;번}호')).toBe('번호');
    expect(mtextPlainText('{\\f굴림|b0|i0|c129|p2;손상현}황')).toBe('손상현황');
  });

  it('꾸밈이 없는 글자는 그대로 둔다', () => {
    expect(mtextPlainText('가로/폭')).toBe('가로/폭');
    expect(mtextPlainText('1')).toBe('1');
  });

  it('줄바꿈·이스케이프를 푼다', () => {
    expect(mtextPlainText('가\\P나')).toBe('가\n나');
    expect(mtextPlainText('가\\~나')).toBe('가 나');
    expect(mtextPlainText('\\\\')).toBe('\\');
    expect(mtextPlainText('\\{가\\}')).toBe('{가}');
  });

  it('높이·색 지정도 걷어낸다', () => {
    expect(mtextPlainText('\\H1.5x;\\C1;빨강')).toBe('빨강');
  });
});

describe('applyTransform / composeTransform', () => {
  it('항등 변환은 좌표를 그대로 둔다', () => {
    expect(applyTransform(IDENTITY, [10, 20])).toEqual([10, 20]);
  });

  it('배율과 삽입점을 적용한다', () => {
    const t: Transform = { x: 1000, y: 2000, scaleX: 2, scaleY: 2, rotationRad: 0 };
    expect(applyTransform(t, [50, -70])).toEqual([1100, 1860]);
  });

  it('회전을 적용한다 (90도)', () => {
    const t: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: Math.PI / 2 };
    const [x, y] = applyTransform(t, [10, 0]);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(10, 9);
  });

  it('겹친 변환은 안쪽 삽입점을 바깥 변환으로 옮기고 배율·회전을 곱해 더한다', () => {
    const outer: Transform = { x: 100, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 };
    const inner: Transform = { x: 10, y: 5, scaleX: 3, scaleY: 3, rotationRad: 0 };
    const composed = composeTransform(outer, inner);
    expect(composed).toMatchObject({ x: 120, y: 10, scaleX: 6, scaleY: 6, rotationRad: 0 });
    expect(applyTransform(composed, [1, 0])).toEqual([126, 10]);
  });
});

describe('hasUniformScale', () => {
  it('가로·세로 배율이 같으면 참', () => {
    expect(hasUniformScale({ x: 0, y: 0, scaleX: 2, scaleY: 2, rotationRad: 0 })).toBe(true);
    expect(hasUniformScale({ x: 0, y: 0, scaleX: 2, scaleY: 3, rotationRad: 0 })).toBe(false);
  });
});

describe('findTableCandidates', () => {
  it('망도틀 안의 표를 INSERT를 따라 절대 좌표로 찾는다', async () => {
    const candidates = findTableCandidates(await templateDoc());
    expect(candidates).toHaveLength(1);
    const [table] = candidates;
    expect(table.blockName).toBe('*TX');
    expect(table.position).toEqual([500, 700]);
    expect(table.colWidths).toEqual([100, 150, 300, 120, 120, 100, 140, 110]);
    expect(table.rowHeights).toEqual([40, 20, 20, 20, 20]);
    expect(table.transform).toMatchObject({ x: 1000, y: 2000, scaleX: 2, scaleY: 2, rotationRad: 0 });
  });

  it('어느 블록에도 삽입되지 않은 블록 안의 표는 후보가 아니다', async () => {
    const text = await readFile(fixturePath, 'utf8');
    // 망도틀 INSERT의 블록 이름을 없는 블록으로 바꾼다 → 망도틀은 어디에도 삽입되지 않는다
    const doc = parseDxf(text.replace('AcDbBlockReference\n  2\n망도틀\n 10\n1000.0', 'AcDbBlockReference\n  2\n없는블록\n 10\n1000.0'));
    expect(findTableCandidates(doc)).toEqual([]);
  });

  it('INSERT가 여러 개면 표도 그만큼 나온다', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const insertBlock = text.slice(text.indexOf('  0\nINSERT\n'), text.indexOf('  0\nLINE\n  5\n81\n'));
    const doc = parseDxf(text.replace(insertBlock, insertBlock + insertBlock.replace('\n1000.0\n', '\n50000.0\n')));
    const candidates = findTableCandidates(doc);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.transform.x)).toEqual([1000, 50000]);
  });
});

describe('tableCenter / nearestTable', () => {
  it('표의 가운데를 모델 좌표로 준다', async () => {
    const [table] = findTableCandidates(await templateDoc());
    // 로컬 가운데 (570, -60) → 블록 (1070, 640) → 모델 (1000 + 2140, 2000 + 1280)
    expect(tableCenter(table)).toEqual([3140, 3280]);
  });

  it('손상 중심에서 가까운 표를 고른다', async () => {
    const [table] = findTableCandidates(await templateDoc());
    const far = { ...table, transform: { ...table.transform, x: 999_000 } };
    expect(nearestTable([far, table], [3000, 3000])).toBe(table);
    expect(nearestTable([], [0, 0])).toBeNull();
  });
});

describe('buildGrid', () => {
  it('열·행 경계와 데이터 1행, 글자 높이를 읽는다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;

    expect(grid.colBoundaries).toEqual([0, 100, 250, 550, 670, 790, 890, 1030, 1140]);
    expect(grid.rowBoundaries).toEqual([0, -40, -60, -80, -100, -120]);
    expect(grid.firstDataRow).toBe(2);
    expect(grid.dataRowCount).toBe(3);
    expect(grid.textHeight).toBe(10);
    expect(grid.numberColumn).toBe(0);
    expect(modelTextHeight(grid)).toBe(20);
  });

  it('머리글 영역의 선과 글자만 모은다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;

    // y = -120 짜리 가로선은 데이터 영역 아래라 빠지고, 세로선 둘은 -60까지 잘린다
    expect(grid.headerLines).toEqual([
      { from: [0, 0], to: [1140, 0] },
      { from: [0, -40], to: [1140, -40] },
      { from: [0, -60], to: [1140, -60] },
      { from: [0, 0], to: [0, -60] },
      { from: [1140, 0], to: [1140, -60] },
    ]);
    expect(grid.headerTexts.map((t) => t.text)).toEqual([
      '손상물량표',
      '번호',
      '손상위치',
      '손상현황',
      '가로/폭',
      '세로/길이',
      '개소',
      '면적/연장',
      '단위',
    ]);
    expect(grid.headerTexts[1]).toEqual({ text: '번호', position: [50, -50], height: 10 });
  });

  it('인쇄된 번호 1을 못 찾으면 null', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const doc = parseDxf(text.replace('AcDbMText\n 10\n50.0\n 20\n-70.0\n 30\n0.0\n 40\n10.0\n 71\n     5\n  1\n1\n', 'AcDbMText\n 10\n50.0\n 20\n-70.0\n 30\n0.0\n 40\n10.0\n 71\n     5\n  1\n\n'));
    expect(buildGrid(doc, findTableCandidates(doc)[0])).toBeNull();
  });

  it('열이 8개 미만이면 null', async () => {
    const text = await readFile(fixturePath, 'utf8');
    const doc = parseDxf(text.replace(' 92\n        8\n', ' 92\n        7\n').replace('142\n110.0\n', ''));
    expect(buildGrid(doc, findTableCandidates(doc)[0])).toBeNull();
  });
});

describe('cellCenter', () => {
  it('데이터 1행 0열의 모델 좌표를 준다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;
    expect(cellCenter(grid, 1, 0)).toEqual([2100, 3260]);
  });

  it('열과 행이 달라지면 그만큼 옮겨 간다', async () => {
    const doc = await templateDoc();
    const grid = buildGrid(doc, findTableCandidates(doc)[0])!;
    // 2열 중앙 400, 데이터 1행 중앙 -70 → 블록 (900, 630) → 모델 (2800, 3260)
    expect(cellCenter(grid, 1, 2)).toEqual([2800, 3260]);
    // 7열 중앙 1085, 데이터 3행 중앙 -110 → 블록 (1585, 590) → 모델 (4170, 3180)
    expect(cellCenter(grid, 3, 7)).toEqual([4170, 3180]);
  });
});
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/export/tableGrid.ts`를 쓴다**

```ts
// 손상물량표를 찾아 칸의 자리를 계산한다. 표 객체를 고치지 않고 그 위에 글자를 얹기 위한
// 좌표만 구한다.
//
// 격자는 ACAD_TABLE 엔티티가 직접 들고 있다 — 행 높이(141), 열 너비(142), 삽입점(10/20),
// 표 모양이 담긴 익명 블록 이름(2). 글자 높이와 데이터 1행은 스펙 7.3대로 그 블록의
// MTEXT(`번호`와 인쇄된 `1`)에서 읽는다. 어떤 숫자도 코드에 박아 두지 않는다.
//
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4.1·4.3·7장

import { findSection, type DxfDocument, type DxfPair } from './dxfDocument.js';
import type { Point } from './dxfEntities.js';

/** 스펙 7.2의 열 매핑이 전제하는 최소 열 수 */
const MIN_COLUMNS = 8;
/** 블록 안의 블록을 따라가는 최대 깊이. 사내 템플릿은 1단계면 충분하다 */
const MAX_INSERT_DEPTH = 4;

export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationRad: number;
}

export const IDENTITY: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotationRad: 0 };

// 절대 = 삽입점 + 회전(배율 × 블록좌표)
export function applyTransform(t: Transform, point: Point): Point {
  const sx = point[0] * t.scaleX;
  const sy = point[1] * t.scaleY;
  if (t.rotationRad === 0) return [t.x + sx, t.y + sy];
  const cos = Math.cos(t.rotationRad);
  const sin = Math.sin(t.rotationRad);
  return [t.x + sx * cos - sy * sin, t.y + sx * sin + sy * cos];
}

// 안쪽 블록의 삽입점을 바깥 변환으로 옮기고 배율은 곱하고 회전은 더한다.
// 배율이 가로·세로 같을 때 정확하다 — 표를 고를 때 hasUniformScale로 거른다.
export function composeTransform(outer: Transform, inner: Transform): Transform {
  const [x, y] = applyTransform(outer, [inner.x, inner.y]);
  return {
    x,
    y,
    scaleX: outer.scaleX * inner.scaleX,
    scaleY: outer.scaleY * inner.scaleY,
    rotationRad: outer.rotationRad + inner.rotationRad,
  };
}

export function hasUniformScale(t: Transform): boolean {
  return Math.abs(t.scaleX - t.scaleY) < 1e-9;
}

export interface BlockLine {
  from: Point;
  to: Point;
}

export interface BlockText {
  text: string;
  position: Point;
  height: number;
}

export interface TableCandidate {
  /** 표 모양이 담긴 익명 블록 이름 (예: *T8) */
  blockName: string;
  /** 표의 삽입점(표를 담고 있는 블록의 좌표계) */
  position: Point;
  rowHeights: number[];
  colWidths: number[];
  /** 표를 담고 있는 블록 좌표 → 모델 좌표 */
  transform: Transform;
}

export interface TableGrid {
  blockName: string;
  position: Point;
  transform: Transform;
  /** 표 로컬 좌표. 길이 = 열 수 + 1 */
  colBoundaries: number[];
  /** 표 로컬 좌표(0, 음수로 내려간다). 길이 = 행 수 + 1 */
  rowBoundaries: number[];
  /** 데이터 1행의 행 인덱스 */
  firstDataRow: number;
  dataRowCount: number;
  /** 표 로컬 글자 높이 */
  textHeight: number;
  numberColumn: number;
  /** 데이터 영역 위쪽(머리글 영역)의 선. 데이터 시작선까지 잘라 둔다 */
  headerLines: BlockLine[];
  /** 머리글 영역의 글자 */
  headerTexts: BlockText[];
}

// MTEXT의 꾸밈 코드를 걷어내고 실제 글자만 남긴다.
export function mtextPlainText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) break;
      if (next === '\\' || next === '{' || next === '}') {
        out += next;
        i += 1;
        continue;
      }
      if (next === 'P' || next === 'X') {
        out += '\n';
        i += 1;
        continue;
      }
      if (next === '~') {
        out += ' ';
        i += 1;
        continue;
      }
      if ('fFHCcTQWApS'.includes(next)) {
        // 세미콜론까지가 한 지정이다. \S는 분수라 본문을 살린다.
        const end = raw.indexOf(';', i + 2);
        const stop = end === -1 ? raw.length : end;
        if (next === 'S') out += raw.slice(i + 2, stop).replace(/[\^#/]/g, ' ').trim();
        i = stop;
        continue;
      }
      out += next;
      i += 1;
      continue;
    }
    if (ch === '{' || ch === '}') continue;
    out += ch;
  }
  return out;
}

interface RawEntity {
  type: string;
  values: Map<number, string[]>;
}

function numberAt(entity: RawEntity, code: number, fallback: number): number {
  const raw = entity.values.get(code)?.[0];
  if (raw === undefined) return fallback;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : fallback;
}

function textAt(entity: RawEntity, code: number): string | null {
  return entity.values.get(code)?.[0] ?? null;
}

function numbersAt(entity: RawEntity, code: number): number[] {
  return (entity.values.get(code) ?? []).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
}

// (0, 타입)부터 다음 (0, …) 직전까지를 한 엔티티로 모은다.
function readEntities(pairs: DxfPair[], from: number, to: number): RawEntity[] {
  const entities: RawEntity[] = [];
  let current: RawEntity | null = null;
  for (let i = from; i < to; i++) {
    const p = pairs[i];
    if (p.code === 0) {
      current = { type: p.value, values: new Map() };
      entities.push(current);
      continue;
    }
    if (!current) continue;
    const list = current.values.get(p.code);
    if (list) list.push(p.value);
    else current.values.set(p.code, [p.value]);
  }
  return entities;
}

interface BlockContents {
  name: string;
  entities: RawEntity[];
}

function readBlocks(doc: DxfDocument): BlockContents[] {
  const section = findSection(doc, 'BLOCKS');
  if (!section) return [];
  const blocks: BlockContents[] = [];
  let start = -1;
  for (let i = section.start; i < section.end; i++) {
    const p = doc.pairs[i];
    if (p.code !== 0) continue;
    if (p.value === 'BLOCK') start = i;
    else if (p.value === 'ENDBLK' && start >= 0) {
      const entities = readEntities(doc.pairs, start, i);
      const name = textAt(entities[0], 2) ?? '';
      blocks.push({ name, entities: entities.slice(1) });
      start = -1;
    }
  }
  return blocks;
}

function insertTransform(entity: RawEntity): Transform {
  return {
    x: numberAt(entity, 10, 0),
    y: numberAt(entity, 20, 0),
    scaleX: numberAt(entity, 41, 1),
    scaleY: numberAt(entity, 42, 1),
    rotationRad: (numberAt(entity, 50, 0) * Math.PI) / 180,
  };
}

function tableOf(entity: RawEntity, transform: Transform): TableCandidate | null {
  const blockName = textAt(entity, 2);
  if (!blockName) return null;
  const rowHeights = numbersAt(entity, 141);
  const colWidths = numbersAt(entity, 142);
  if (rowHeights.length === 0 || colWidths.length === 0) return null;
  return {
    blockName,
    position: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
    rowHeights,
    colWidths,
    transform,
  };
}

// 모델 공간의 INSERT를 따라 내려가며 블록 안의 ACAD_TABLE을 절대 좌표로 옮긴다.
// 어느 곳에도 삽입되지 않은 블록 안의 표는 도면에 보이지 않으므로 후보가 아니다.
export function findTableCandidates(doc: DxfDocument): TableCandidate[] {
  const entitiesSection = findSection(doc, 'ENTITIES');
  if (!entitiesSection) return [];
  const blocks = new Map(readBlocks(doc).map((b) => [b.name, b.entities]));
  const candidates: TableCandidate[] = [];

  const walk = (entities: RawEntity[], transform: Transform, depth: number, seen: Set<string>): void => {
    for (const entity of entities) {
      if (entity.type === 'ACAD_TABLE') {
        const table = tableOf(entity, transform);
        if (table) candidates.push(table);
        continue;
      }
      if (entity.type !== 'INSERT' || depth >= MAX_INSERT_DEPTH) continue;
      const name = textAt(entity, 2);
      if (!name || seen.has(name)) continue;
      const contents = blocks.get(name);
      if (!contents) continue;
      walk(contents, composeTransform(transform, insertTransform(entity)), depth + 1, new Set([...seen, name]));
    }
  };

  walk(readEntities(doc.pairs, entitiesSection.start, entitiesSection.end), IDENTITY, 0, new Set());
  return candidates;
}

function boundariesOf(sizes: number[], sign: 1 | -1): number[] {
  const boundaries = [0];
  let total = 0;
  for (const size of sizes) {
    total += size * sign;
    boundaries.push(total);
  }
  return boundaries;
}

export function tableCenter(candidate: TableCandidate): Point {
  const width = candidate.colWidths.reduce((sum, w) => sum + w, 0);
  const height = candidate.rowHeights.reduce((sum, h) => sum + h, 0);
  return applyTransform(candidate.transform, [
    candidate.position[0] + width / 2,
    candidate.position[1] - height / 2,
  ]);
}

export function nearestTable(candidates: TableCandidate[], center: Point): TableCandidate | null {
  let best: TableCandidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const [x, y] = tableCenter(candidate);
    const distance = Math.hypot(x - center[0], y - center[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function indexOfBand(boundaries: number[], value: number): number {
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const lo = Math.min(boundaries[i], boundaries[i + 1]);
    const hi = Math.max(boundaries[i], boundaries[i + 1]);
    if (value >= lo && value <= hi) return i;
  }
  return -1;
}

export function buildGrid(doc: DxfDocument, candidate: TableCandidate): TableGrid | null {
  if (candidate.colWidths.length < MIN_COLUMNS) return null;
  const colBoundaries = boundariesOf(candidate.colWidths, 1);
  const rowBoundaries = boundariesOf(candidate.rowHeights, -1);

  const block = readBlocks(doc).find((b) => b.name === candidate.blockName);
  if (!block) return null;

  const texts: BlockText[] = [];
  const lines: BlockLine[] = [];
  for (const entity of block.entities) {
    if (entity.type === 'MTEXT' || entity.type === 'TEXT') {
      // MTEXT의 긴 글은 코드 3이 여러 번 나온 뒤 코드 1로 끝난다.
      const raw = [...(entity.values.get(3) ?? []), ...(entity.values.get(1) ?? [])].join('');
      texts.push({
        text: mtextPlainText(raw),
        position: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        height: numberAt(entity, 40, 0),
      });
    } else if (entity.type === 'LINE') {
      lines.push({
        from: [numberAt(entity, 10, 0), numberAt(entity, 20, 0)],
        to: [numberAt(entity, 11, 0), numberAt(entity, 21, 0)],
      });
    }
  }

  // 번호 열: `번호`라고 적힌 칸의 열. 없으면 첫 열로 본다.
  const numberHeader = texts.find((t) => t.text.replace(/\s/g, '') === '번호');
  const numberColumn = numberHeader ? Math.max(0, indexOfBand(colBoundaries, numberHeader.position[0])) : 0;

  // 데이터 1행: 번호 열에 `1`이 인쇄된 칸의 행 대역(스펙 7.3).
  const headerRow = numberHeader ? indexOfBand(rowBoundaries, numberHeader.position[1]) : -1;
  let firstDataRow = -1;
  let textHeight = 0;
  for (const text of texts) {
    if (text.text.trim() !== '1') continue;
    if (indexOfBand(colBoundaries, text.position[0]) !== numberColumn) continue;
    const row = indexOfBand(rowBoundaries, text.position[1]);
    if (row < 0 || row <= headerRow) continue;
    if (firstDataRow === -1 || row < firstDataRow) {
      firstDataRow = row;
      textHeight = text.height;
    }
  }
  if (firstDataRow < 0 || !(textHeight > 0)) return null;

  const dataTop = rowBoundaries[firstDataRow];
  const clampedLines: BlockLine[] = [];
  for (const line of lines) {
    // 데이터 영역에만 있는 선은 버린다(넘침 표는 데이터 격자를 새로 그린다).
    if (line.from[1] < dataTop && line.to[1] < dataTop) continue;
    // 머리글 영역만 남기고, 아래로 뻗은 선은 데이터 시작선에서 자른다.
    const from: Point = [line.from[0], Math.max(line.from[1], dataTop)];
    const to: Point = [line.to[0], Math.max(line.to[1], dataTop)];
    if (from[0] === to[0] && from[1] === to[1]) continue;
    clampedLines.push({ from, to });
  }

  return {
    blockName: candidate.blockName,
    position: candidate.position,
    transform: candidate.transform,
    colBoundaries,
    rowBoundaries,
    firstDataRow,
    dataRowCount: rowBoundaries.length - 1 - firstDataRow,
    textHeight,
    numberColumn,
    headerLines: clampedLines,
    headerTexts: texts.filter((t) => t.position[1] > dataTop && t.text !== ''),
  };
}

/** dataRow는 1부터. 표 로컬 좌표를 모델 좌표로 옮겨 준다. */
export function cellCenter(grid: TableGrid, dataRow: number, column: number): Point {
  const rowIndex = grid.firstDataRow + dataRow - 1;
  const top = grid.rowBoundaries[rowIndex];
  const bottom = grid.rowBoundaries[rowIndex + 1];
  const left = grid.colBoundaries[column];
  const right = grid.colBoundaries[column + 1];
  return applyTransform(grid.transform, [
    grid.position[0] + (left + right) / 2,
    grid.position[1] + (top + bottom) / 2,
  ]);
}

export function modelTextHeight(grid: TableGrid): number {
  return grid.textHeight * Math.abs(grid.transform.scaleX);
}
```

- [ ] **Step 3: 사내 템플릿으로 실측값을 확인한다**

`server/scripts/check-table.ts`를 만들어 실행한 뒤 지운다:

```ts
import { readFileSync } from 'node:fs';
import { parseDxf } from '../src/export/dxfDocument.js';
import { buildGrid, cellCenter, findTableCandidates, modelTextHeight } from '../src/export/tableGrid.js';

const doc = parseDxf(readFileSync('../docs/빈도면(테이블버전).dxf', 'utf8'));
const candidates = findTableCandidates(doc);
console.log('표 후보', candidates.length, candidates.map((c) => c.blockName));
const first = candidates[0];
console.log('삽입점', first.position, '배율', first.transform.scaleX);
console.log('열 경계', first.colWidths.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]));
console.log('행 높이 앞 3개', first.rowHeights.slice(0, 3), '행 수', first.rowHeights.length);
const grid = buildGrid(doc, first)!;
console.log('데이터 1행 인덱스', grid.firstDataRow, '데이터 행 수', grid.dataRowCount);
console.log('글자 높이', grid.textHeight, '모델 글자 높이', modelTextHeight(grid));
console.log('머리글', grid.headerTexts.map((t) => t.text));
console.log('1행 0열 중앙', cellCenter(grid, 1, 0));
```

```bash
node --import tsx server/scripts/check-table.ts
```

기대: 표 후보 **7개**(`망도틀`이 7번 삽입돼 있다), 블록 이름 `*T8`, 삽입점 `[879243.6175168979, 71105.52639577456]`, 배율 `1.268494382022469`, 열 경계가 `0, 1003.1…, 2719.2…, 5891.1…, 7088.2…, 8295.0…, 9299.5…, 10695.4…, 11795.5…`, 행 높이 `[840.12…, 667.15…, 667.15…]`에 행 수 **38**, 데이터 1행 인덱스 **3**, 데이터 행 수 **35**, 글자 높이 **150**, 머리글에 `손상물량표 번호 손상위치 손상현황 손상규모 가로/폭 세로/길이 개소 면적/연장 단위`가 들어 있어야 한다. 확인 후 `server/scripts/check-table.ts`를 지운다(커밋하지 않는다).

> 값이 다르면 멈추고 사용자에게 알린다. 특히 데이터 행 수가 35가 아니면 템플릿이 바뀐 것이다 — 코드는 읽은 값을 그대로 쓰므로 동작에는 문제가 없지만 스펙 7.1의 실측 기록을 갱신해야 한다.

- [ ] **Step 4: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/tableGrid.ts server/test/tableGrid.test.ts
git commit -m "$(printf '%s\n' '손상물량표를 찾아 칸의 자리를 계산한다' '' 'ACAD_TABLE이 들고 있는 행 높이·열 너비·삽입점으로 격자를 만들고,' '표 블록의 MTEXT에서 글자 높이와 인쇄된 번호 1의 행 대역을 읽어' '데이터 1행을 정한다. 어떤 숫자도 코드에 박아 두지 않는다.' '' '표가 블록 안에 있으면 그 블록의 INSERT를 따라 절대 좌표로 옮긴다.' '어디에도 삽입되지 않은 블록 안의 표는 후보에서 뺀다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 사내 템플릿에서 표 7장을 찾고, 데이터 행 35개와 셀 중앙 좌표를 스펙 7.1 실측값대로 계산한다.

---

### Task 7: 표 채우기와 넘침 표 그리기

번호 N인 손상은 데이터 N행에 들어간다. 데이터 행 수를 넘으면 표를 오른쪽에 한 장 더 `LINE`·`TEXT`로 직접 그린다(표 객체가 아니다). 넘침 표의 머리글은 원본 표 블록의 선·글자를 그대로 오른쪽으로 옮겨 그린 것이고(Task 6의 `headerLines`·`headerTexts`), 데이터 격자는 원본의 열 너비·행 높이로 새로 긋는다.

**Files:**
- Create: `server/src/export/tableFill.ts`
- Create: `server/test/tableFill.test.ts`

**Interfaces:**
- Consumes:
  - `formatQuantity`, `quantityOf`, `statusTextOf`, `unitOf` from `../../public/viewer/quantities.js`
  - `TableGrid`, `applyTransform`, `cellCenter`, `modelTextHeight` from `./tableGrid.js`
  - `lineEntity`, `textEntity`, `EntityBase`, `Point` from `./dxfEntities.js`
  - `HandleAllocator`, `DAMAGE_LAYER`, `DAMAGE_COLOR`, `DxfPair` from `./dxfDocument.js`
- Produces:
  - `const TABLE_COLUMN = { number: 0, place: 1, status: 2, width: 3, length: 4, count: 5, quantity: 6, unit: 7 }`
  - `interface TableRow { number: number; cells: string[] }` — `cells`는 길이 8. 비울 칸은 `''`
  - `function rowValuesOf(damage: unknown, number: number): TableRow`
  - `function fillTable(grid: TableGrid, rows: TableRow[], alloc: HandleAllocator, owner: string): DxfPair[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/tableFill.test.ts` (새 파일):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HandleAllocator, type DxfPair } from '../src/export/dxfDocument.js';
import { buildGrid, findTableCandidates, type TableGrid } from '../src/export/tableGrid.js';
import { fillTable, rowValuesOf, TABLE_COLUMN } from '../src/export/tableFill.js';
import { parseDxf } from '../src/export/dxfDocument.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function grid(): Promise<TableGrid> {
  const doc = parseDxf(await readFile(fixturePath, 'utf8'));
  return buildGrid(doc, findTableCandidates(doc)[0])!;
}

function damage(type: string, measured: Record<string, number | null>, attrs: Record<string, unknown> = {}) {
  return {
    id: `d-${type}`,
    type,
    geometry: { kind: 'rect', world: [[0, 0]], dwg: [[0, 0], [1, 1]] },
    measured: { width: null, length: null, count: null, ...measured },
    attrs: { note: '', statusText: '', photoNumbers: [], ...attrs },
  };
}

interface TextEntity {
  text: string;
  x: number;
  y: number;
}

// 만들어진 쌍에서 TEXT 엔티티만 뽑아 본다.
function textsOf(pairs: DxfPair[]): TextEntity[] {
  const result: TextEntity[] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].code !== 0 || pairs[i].value !== 'TEXT') continue;
    let text = '';
    let x = Number.NaN;
    let y = Number.NaN;
    for (let j = i + 1; j < pairs.length && pairs[j].code !== 0; j++) {
      if (pairs[j].code === 1) text = pairs[j].value;
      else if (pairs[j].code === 11) x = Number(pairs[j].value);
      else if (pairs[j].code === 21) y = Number(pairs[j].value);
    }
    result.push({ text, x, y });
  }
  return result;
}

function lineCount(pairs: DxfPair[]): number {
  return pairs.filter((p) => p.code === 0 && p.value === 'LINE').length;
}

describe('rowValuesOf', () => {
  it('손상현황·가로/폭·세로/길이·개소·물량·단위를 채우고 번호와 손상위치는 비운다', () => {
    const row = rowValuesOf(damage('crack', { width: 0.2, length: 1.5, count: 2 }), 7);
    expect(row.number).toBe(7);
    expect(row.cells).toEqual(['', '', '균열(0.3mm미만)', '0.2', '1.5', '2', '3.0', 'm']);
  });

  it('면형은 가로 × 세로 × 개소가 물량이고 단위가 ㎡다', () => {
    const row = rowValuesOf(damage('spalling', { width: 1.2, length: 1.5, count: 1 }), 1);
    expect(row.cells[TABLE_COLUMN.status]).toBe('박락');
    expect(row.cells[TABLE_COLUMN.quantity]).toBe('1.8');
    expect(row.cells[TABLE_COLUMN.unit]).toBe('㎡');
  });

  it('값이 없는 칸은 비워 둔다 (-를 쓰지 않는다)', () => {
    const row = rowValuesOf(damage('spalling', { width: null, length: 1.5, count: null }), 2);
    expect(row.cells).toEqual(['', '', '박락', '', '1.5', '', '', '㎡']);
  });

  it('0은 유효한 값이라 적는다', () => {
    const row = rowValuesOf(damage('spalling', { width: 0, length: 0, count: 0 }), 3);
    expect(row.cells[TABLE_COLUMN.width]).toBe('0.0');
    expect(row.cells[TABLE_COLUMN.count]).toBe('0');
    expect(row.cells[TABLE_COLUMN.quantity]).toBe('0.0');
  });

  it('기타는 사용자가 적은 손상현황을 쓴다', () => {
    const row = rowValuesOf(damage('etc', {}, { statusText: '받침 손상' }), 4);
    expect(row.cells[TABLE_COLUMN.status]).toBe('받침 손상');
  });
});

describe('fillTable — 원본 표 안', () => {
  it('번호 순서대로 데이터 행에 글자를 놓는다', async () => {
    const g = await grid();
    const pairs = fillTable(
      g,
      [
        rowValuesOf(damage('spalling', { width: 1.2, length: 1.5, count: 1 }), 1),
        rowValuesOf(damage('crack', { width: 0.2, length: 1.5, count: 2 }), 3),
      ],
      new HandleAllocator(0x400),
      '1F',
    );
    const texts = textsOf(pairs);
    // 1행: 박락 1.2 1.5 1 1.8 ㎡ (6칸), 3행: 균열(...) 0.2 1.5 2 3.0 m (6칸)
    expect(texts).toHaveLength(12);
    const first = texts.find((t) => t.text === '박락')!;
    // 2열 중앙, 데이터 1행 중앙 → 모델 (2800, 3260)
    expect(first.x).toBeCloseTo(2800, 6);
    expect(first.y).toBeCloseTo(3260, 6);
    const third = texts.find((t) => t.text.startsWith('균열'))!;
    // 데이터 3행 중앙 y = -110 → 모델 3180
    expect(third.y).toBeCloseTo(3180, 6);
  });

  it('빈 칸은 글자를 만들지 않는다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 1)], new HandleAllocator(0x400), '1F');
    expect(textsOf(pairs).map((t) => t.text)).toEqual(['박락', '1.5', '㎡']);
  });

  it('원본 표 안에 들어가면 선을 하나도 긋지 않는다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 1)], new HandleAllocator(0x400), '1F');
    expect(lineCount(pairs)).toBe(0);
  });

  it('글자 높이는 셀 글자 높이 × 배율이다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 1)], new HandleAllocator(0x400), '1F');
    expect(pairs.filter((p) => p.code === 40).map((p) => p.value)).toEqual(['20.0', '20.0']);
  });
});

describe('fillTable — 넘침 표', () => {
  // 픽스처의 데이터 행 수는 3이다. 번호 4부터는 오른쪽에 새 표가 생긴다.
  it('데이터 행 수를 넘으면 오른쪽에 표를 한 장 더 그린다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    const texts = textsOf(pairs);

    // 머리글 9개 + 번호 3개 + 값 3개
    expect(texts.map((t) => t.text)).toEqual([
      '손상물량표', '번호', '손상위치', '손상현황', '가로/폭', '세로/길이', '개소', '면적/연장', '단위',
      '4', '5', '6',
      '박락', '1.5', '㎡',
    ]);
    // 머리글 선 5개 + 가로 3개(데이터 행 경계) + 세로 9개
    expect(lineCount(pairs)).toBe(17);
  });

  it('새 표는 원본 오른쪽 끝에서 첫 열 너비만큼 띄운 자리에 있다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], new HandleAllocator(0x400), '1F');
    const value = textsOf(pairs).find((t) => t.text === '박락')!;
    // 표 너비 1140 + 첫 열 너비 100 = 1240 만큼 로컬로 이동 → 모델에서는 배율 2를 곱해 2480
    expect(value.x).toBeCloseTo(2800 + 2480, 6);
    // 첫 데이터 행 높이는 원본과 같다
    expect(value.y).toBeCloseTo(3260, 6);
  });

  it('번호 열은 원본 다음 번호부터 이어서 인쇄한다', async () => {
    const g = await grid();
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', {}), 7)], new HandleAllocator(0x400), '1F');
    const numbers = textsOf(pairs).filter((t) => /^\d+$/.test(t.text)).map((t) => t.text);
    // 번호 7은 세 번째 표(7~9)에 들어간다
    expect(numbers).toEqual(['7', '8', '9']);
  });

  it('여러 넘침 표가 필요하면 각각 한 번씩만 그린다', async () => {
    const g = await grid();
    const pairs = fillTable(
      g,
      [rowValuesOf(damage('spalling', {}), 4), rowValuesOf(damage('crack', {}), 5), rowValuesOf(damage('etc', {}), 7)],
      new HandleAllocator(0x400),
      '1F',
    );
    // 두 번째 표 머리글 1벌 + 세 번째 표 머리글 1벌 = 머리글 글자 18개
    expect(textsOf(pairs).filter((t) => t.text === '손상물량표')).toHaveLength(2);
    expect(lineCount(pairs)).toBe(34);
  });

  it('핸들이 겹치지 않는다', async () => {
    const g = await grid();
    const alloc = new HandleAllocator(0x400);
    const pairs = fillTable(g, [rowValuesOf(damage('spalling', { length: 1.5 }), 4)], alloc, '1F');
    const handles = pairs.filter((p) => p.code === 5).map((p) => p.value);
    expect(new Set(handles).size).toBe(handles.length);
  });
});
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/export/tableFill.ts`를 쓴다**

```ts
// 손상물량표를 채운다. 표 객체를 고치지 않고 칸 가운데에 글자를 얹는다.
// 데이터 행 수를 넘으면 오른쪽에 같은 모양의 표를 LINE·TEXT로 직접 그린다.
// 문구는 앱 화면과 같은 quantities.js 함수로 만든다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 7장

import { formatQuantity, quantityOf, statusTextOf, unitOf } from '../../public/viewer/quantities.js';
import { DAMAGE_COLOR, DAMAGE_LAYER, type DxfPair, type HandleAllocator } from './dxfDocument.js';
import { lineEntity, textEntity, type EntityBase, type Point } from './dxfEntities.js';
import { applyTransform, cellCenter, modelTextHeight, type TableGrid } from './tableGrid.js';

export const TABLE_COLUMN = {
  number: 0,
  place: 1,
  status: 2,
  width: 3,
  length: 4,
  count: 5,
  quantity: 6,
  unit: 7,
} as const;

const COLUMN_COUNT = 8;

export interface TableRow {
  number: number;
  /** 길이 8. 비울 칸은 빈 문자열 */
  cells: string[];
}

function amountText(value: unknown): string {
  return Number.isFinite(value) && (value as number) >= 0 ? formatQuantity(value as number) : '';
}

function countText(value: unknown): string {
  return Number.isInteger(value) && (value as number) >= 0 ? String(value) : '';
}

export function rowValuesOf(damage: unknown, number: number): TableRow {
  const measured = (damage as { measured?: Record<string, unknown> } | null)?.measured ?? {};
  const quantity = quantityOf(damage);
  const cells = new Array<string>(COLUMN_COUNT).fill('');
  // 번호(0)는 표에 이미 인쇄돼 있고 손상위치(1)는 비워 둔다.
  cells[TABLE_COLUMN.status] = statusTextOf(damage);
  cells[TABLE_COLUMN.width] = amountText(measured.width);
  cells[TABLE_COLUMN.length] = amountText(measured.length);
  cells[TABLE_COLUMN.count] = countText(measured.count);
  cells[TABLE_COLUMN.quantity] = quantity === null ? '' : formatQuantity(quantity);
  cells[TABLE_COLUMN.unit] = unitOf(damage) ?? '';
  return { number, cells };
}

function baseFor(alloc: HandleAllocator, owner: string): EntityBase {
  return { handle: alloc.next(), owner, layer: DAMAGE_LAYER, colorIndex: DAMAGE_COLOR };
}

// 넘침 표 k장째(k ≥ 1)가 원본에서 오른쪽으로 얼마나 떨어지는지(표 로컬 단위).
// 원본 표 오른쪽 끝에서 첫 열 너비(번호 열)만큼 띄운다.
function offsetOf(grid: TableGrid, tableIndex: number): number {
  const width = grid.colBoundaries[grid.colBoundaries.length - 1];
  return tableIndex * (width + grid.colBoundaries[1]);
}

function localToModel(grid: TableGrid, local: Point, dx: number): Point {
  return applyTransform(grid.transform, [grid.position[0] + local[0] + dx, grid.position[1] + local[1]]);
}

function textAt(grid: TableGrid, local: Point, dx: number, value: string, alloc: HandleAllocator, owner: string): DxfPair[] {
  return textEntity(baseFor(alloc, owner), localToModel(grid, local, dx), modelTextHeight(grid), value, 'center');
}

function lineAt(grid: TableGrid, from: Point, to: Point, dx: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  return lineEntity(baseFor(alloc, owner), localToModel(grid, from, dx), localToModel(grid, to, dx));
}

function columnCenter(grid: TableGrid, column: number): number {
  return (grid.colBoundaries[column] + grid.colBoundaries[column + 1]) / 2;
}

function rowCenter(grid: TableGrid, dataRow: number): number {
  const index = grid.firstDataRow + dataRow - 1;
  return (grid.rowBoundaries[index] + grid.rowBoundaries[index + 1]) / 2;
}

// 넘침 표 한 장의 틀: 원본 머리글(선·글자)을 그대로 옮겨 그리고, 데이터 격자를 새로 긋고,
// 번호 열에 이어지는 번호를 인쇄한다. 행 수는 원본과 같다(가득 찬 표).
function overflowFrame(grid: TableGrid, tableIndex: number, alloc: HandleAllocator, owner: string): DxfPair[] {
  const dx = offsetOf(grid, tableIndex);
  const pairs: DxfPair[] = [];

  for (const line of grid.headerLines) pairs.push(...lineAt(grid, line.from, line.to, dx, alloc, owner));
  for (const text of grid.headerTexts) pairs.push(...textAt(grid, text.position, dx, text.text, alloc, owner));

  const left = grid.colBoundaries[0];
  const right = grid.colBoundaries[grid.colBoundaries.length - 1];
  const top = grid.rowBoundaries[grid.firstDataRow];
  const bottom = grid.rowBoundaries[grid.rowBoundaries.length - 1];

  // 가로선: 데이터 행 경계. 데이터 시작선은 머리글 선이 이미 그었다.
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const y = grid.rowBoundaries[grid.firstDataRow + row];
    pairs.push(...lineAt(grid, [left, y], [right, y], dx, alloc, owner));
  }
  // 세로선: 모든 열 경계를 데이터 영역만큼
  for (const x of grid.colBoundaries) {
    pairs.push(...lineAt(grid, [x, top], [x, bottom], dx, alloc, owner));
  }
  // 번호 열
  const numberX = columnCenter(grid, grid.numberColumn);
  for (let row = 1; row <= grid.dataRowCount; row++) {
    const number = tableIndex * grid.dataRowCount + row;
    pairs.push(...textAt(grid, [numberX, rowCenter(grid, row)], dx, String(number), alloc, owner));
  }
  return pairs;
}

export function fillTable(grid: TableGrid, rows: TableRow[], alloc: HandleAllocator, owner: string): DxfPair[] {
  const capacity = grid.dataRowCount;
  if (capacity <= 0) return [];

  // 어느 넘침 표가 필요한지 먼저 모아 틀을 한 번씩만 그린다.
  const neededTables = new Set<number>();
  for (const row of rows) {
    const tableIndex = Math.floor((row.number - 1) / capacity);
    if (tableIndex > 0) neededTables.add(tableIndex);
  }

  const pairs: DxfPair[] = [];
  for (const tableIndex of [...neededTables].sort((a, b) => a - b)) {
    pairs.push(...overflowFrame(grid, tableIndex, alloc, owner));
  }

  for (const row of rows) {
    if (row.number < 1) continue;
    const tableIndex = Math.floor((row.number - 1) / capacity);
    const dataRow = row.number - tableIndex * capacity;
    const dx = offsetOf(grid, tableIndex);
    const y = rowCenter(grid, dataRow);
    for (let column = 0; column < COLUMN_COUNT; column++) {
      const value = row.cells[column];
      if (!value) continue;
      if (tableIndex === 0) {
        pairs.push(...textEntity(baseFor(alloc, owner), cellCenter(grid, dataRow, column), modelTextHeight(grid), value, 'center'));
      } else {
        pairs.push(...textAt(grid, [columnCenter(grid, column), y], dx, value, alloc, owner));
      }
    }
  }
  return pairs;
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/tableFill.ts server/test/tableFill.test.ts
git commit -m "$(printf '%s\n' '손상물량표를 채우고 넘치면 오른쪽에 표를 더 그린다' '' '번호 N인 손상이 데이터 N행에 들어간다. 손상현황·가로/폭·세로/길이·개소·물량·' '단위를 quantities.js 함수로 만들어 칸 가운데에 얹고, 값이 없는 칸은 비워 둔다.' '번호와 손상위치 칸은 채우지 않는다.' '' '데이터 행 수를 넘으면 원본 표 오른쪽 끝에서 첫 열 너비만큼 띄운 자리에' '같은 모양의 표를 LINE·TEXT로 직접 그리고 번호를 이어서 인쇄한다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 표 한 장에 손상 값이 번호 순서로 들어가고, 행 수를 넘기면 두 번째·세 번째 표가 오른쪽에 생긴다.

---

### Task 8: 산출 오케스트레이션 (`exportDrawing`)

조각들을 엮어 "원본 DXF 글자 + 손상 문서" → "산출 DXF 글자"를 만든다. HTTP는 모른다.

번호는 `computeNumbers`가 **`geometry.world`로** 계산한 결과를 그대로 쓴다. `geometry.dwg`가 없는 손상은 도면에서 빼지만 **번호는 그대로 소비한다** — 앱 화면의 번호와 어긋나면 안 되기 때문이다(그 번호의 표 행은 비어 있다).

**Files:**
- Create: `server/src/export/exportDrawing.ts`
- Create: `server/test/exportDrawing.test.ts`

**Interfaces:**
- Consumes: `computeNumbers` from `../../public/viewer/quantities.js`; Task 2·4·5·6·7의 모든 모듈
- Produces:
  - `class ExportError extends Error`
  - `const EXPORT_WARNINGS = { noTable: '표 없음', unknownTable: '표 모양을 알 수 없음', units: '도면 단위 확인 필요' }`
  - `interface ExportResult { dxfText: string; skipped: number; warnings: string[] }`
  - `function exportDamagesToDxf(dxfText: string, damages: unknown[]): ExportResult`

오류(모두 `ExportError`, 라우트가 400으로 바꾼다):
- `표기한 손상이 없습니다`
- `표의 배율이 가로·세로가 달라 채울 수 없습니다`
- `DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다` (`insertEntities`가 던지는 것을 그대로 쓴다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/exportDrawing.test.ts` (새 파일):

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerNames, parseDxf } from '../src/export/dxfDocument.js';
import { EXPORT_WARNINGS, ExportError, exportDamagesToDxf } from '../src/export/exportDrawing.js';

const fixturePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

async function template(): Promise<string> {
  return readFile(fixturePath, 'utf8');
}

type Pt = [number, number];

function damage(id: string, type: string, worldX: number, dwg: Pt[] | null, measured: Record<string, number | null> = {}) {
  const world: Pt[] = [[worldX, 0], [worldX + 10, 0], [worldX + 10, 10], [worldX, 10]];
  return {
    id,
    type,
    createdAt: '2026-09-15T00:00:00.000Z',
    geometry: { kind: 'rect', world, dwg },
    measured: { width: null, length: null, count: null, ...measured },
    computed: { lengthDwg: null, areaDwg: null },
    attrs: { note: '', statusText: '', photoNumbers: [] },
  };
}

const RECT_A: Pt[] = [[0, 0], [1000, 0], [1000, 400], [0, 400]];
const RECT_B: Pt[] = [[2000, 0], [3000, 0], [3000, 400], [2000, 400]];

function entityCount(text: string, type: string): number {
  const doc = parseDxf(text);
  return doc.pairs.filter((p) => p.code === 0 && p.value === type).length;
}

describe('exportDamagesToDxf', () => {
  it('손상이 없으면 던진다', async () => {
    expect(() => exportDamagesToDxf(await template(), [])).toThrow(ExportError);
    expect(() => exportDamagesToDxf(await template(), [])).toThrow('표기한 손상이 없습니다');
  });

  it('원본 엔티티는 글자 그대로 남고 새 엔티티는 ENTITIES 끝에 붙는다', async () => {
    const original = await template();
    const result = exportDamagesToDxf(original, [damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 })]);

    // BLOCKS 구역 전체가 한 글자도 바뀌지 않는다
    const blocks = original.slice(
      original.indexOf('  0\nSECTION\n  2\nBLOCKS\n'),
      original.indexOf('  0\nSECTION\n  2\nENTITIES\n'),
    );
    expect(result.dxfText).toContain(blocks);

    // 원본 ENTITIES의 INSERT·LINE도 그대로다
    const entitiesHead = original.slice(
      original.indexOf('  0\nSECTION\n  2\nENTITIES\n'),
      original.indexOf('  0\nENDSEC\n  0\nEOF\n'),
    );
    expect(result.dxfText).toContain(entitiesHead);
    expect(result.dxfText.endsWith('  0\nENDSEC\n  0\nEOF\n')).toBe(true);
  });

  it('신규손상 레이어를 만들고 $HANDSEED를 올린다', async () => {
    const result = exportDamagesToDxf(await template(), [damage('a', 'spalling', 0, RECT_A)]);
    const doc = parseDxf(result.dxfText);
    expect(layerNames(doc)).toContain('신규손상');
    const seed = doc.pairs[doc.pairs.findIndex((p) => p.code === 9 && p.value === '$HANDSEED') + 1].value;
    expect(Number.parseInt(seed, 16)).toBeGreaterThan(0x200);
    // 핸들이 겹치지 않는다
    const handles = doc.pairs.filter((p) => p.code === 5).map((p) => p.value.trim());
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('도형·해치·라벨·표 글자를 모두 만든다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, RECT_A, { width: 1.2, length: 1.5, count: 1 }),
    ]);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    expect(entityCount(result.dxfText, 'HATCH')).toBe(1);
    expect(entityCount(result.dxfText, 'CIRCLE')).toBe(1); // 번호 원
    // 라벨 3줄(번호·이름·치수) + 표 6칸
    expect(entityCount(result.dxfText, 'TEXT')).toBe(9);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('번호는 world 좌표로 왼쪽부터 매기고 dwg로 다시 매기지 않는다', async () => {
    // world에서는 a가 왼쪽(0), b가 오른쪽(500)이지만 dwg에서는 반대다
    const a = damage('a', 'crack', 0, RECT_B);
    const b = damage('b', 'crack', 500, RECT_A);
    const result = exportDamagesToDxf(await template(), [a, b]);
    const doc = parseDxf(result.dxfText);
    const texts = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => doc.pairs.slice(i, i + 20).find((p) => p.code === 1)!.value);
    expect(texts).toContain('1');
    expect(texts).toContain('2');
  });

  it('dwg가 없는 손상은 빼고 세어서 알린다. 번호는 그대로 소비한다', async () => {
    const result = exportDamagesToDxf(await template(), [
      damage('a', 'spalling', 0, null, { width: 1, length: 1, count: 1 }),
      damage('b', 'spalling', 500, RECT_A, { width: 2, length: 2, count: 1 }),
    ]);
    expect(result.skipped).toBe(1);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
    const doc = parseDxf(result.dxfText);
    // 2번 손상의 값이 데이터 2행에 들어간다 (모델 y = 2000 + 2*(700-90) = 3220)
    const ys = doc.pairs
      .map((p, i) => (p.code === 0 && p.value === 'TEXT' ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => Number(doc.pairs.slice(i, i + 24).find((p) => p.code === 21)!.value));
    expect(ys).toContain(3220);
    expect(ys).not.toContain(3260);
  });

  it('표가 없으면 경고만 붙이고 도형은 그린다', async () => {
    const text = await template();
    // ACAD_TABLE을 다른 이름으로 바꿔 표를 없앤다
    const noTable = text.replace('  0\nACAD_TABLE\n', '  0\nPOINT\n');
    const result = exportDamagesToDxf(noTable, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toEqual([EXPORT_WARNINGS.noTable]);
    expect(entityCount(result.dxfText, 'LWPOLYLINE')).toBe(1);
  });

  it('표의 배율이 가로·세로가 다르면 던진다', async () => {
    const text = (await template()).replace(' 41\n2.0\n 42\n2.0\n', ' 41\n2.0\n 42\n3.0\n');
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)])).toThrow(
      '표의 배율이 가로·세로가 달라 채울 수 없습니다',
    );
  });

  it('표 모양을 알 수 없으면 경고만 붙인다', async () => {
    const text = (await template()).replace(' 92\n        8\n', ' 92\n        7\n').replace('142\n110.0\n', '');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toEqual([EXPORT_WARNINGS.unknownTable]);
  });

  it('$INSUNITS가 mm·없음·인치가 아니면 단위 경고를 붙인다', async () => {
    const text = (await template()).replace('$INSUNITS\n 70\n     1\n', '$INSUNITS\n 70\n     6\n');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.warnings).toContain(EXPORT_WARNINGS.units);
  });

  it('$INSUNITS가 4·0·1이면 경고가 없다', async () => {
    for (const value of ['     4', '     0', '     1']) {
      const text = (await template()).replace('$INSUNITS\n 70\n     1\n', `$INSUNITS\n 70\n${value}\n`);
      const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
      expect(result.warnings).not.toContain(EXPORT_WARNINGS.units);
    }
  });

  it('ENTITIES 구역이 없으면 던진다', () => {
    const text = '  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n';
    expect(() => exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)])).toThrow(/ENTITIES 구역/);
  });

  it('CRLF 원본은 CRLF로 돌려준다', async () => {
    const text = (await template()).replace(/\n/g, '\r\n');
    const result = exportDamagesToDxf(text, [damage('a', 'crack', 0, RECT_A)]);
    expect(result.dxfText.includes('\r\n')).toBe(true);
    expect(/[^\r]\n/.test(result.dxfText)).toBe(false);
  });
});
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/export/exportDrawing.ts`를 쓴다**

```ts
// 원본 DXF 글자 + 손상 문서 → 산출 DXF 글자. HTTP는 모른다.
// 번호는 computeNumbers가 geometry.world로 계산한 결과를 그대로 쓴다 — geometry.dwg로 다시
// 매기면 페이지→모델 변환의 회전·반전 때문에 앱 화면의 번호와 어긋날 수 있다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 4~8·10장

import { computeNumbers } from '../../public/viewer/quantities.js';
import { damageEntities, dwgPointsOf } from './damageEntities.js';
import {
  createHandleAllocator,
  DAMAGE_COLOR,
  DAMAGE_LAYER,
  ensureLayer,
  findSection,
  findTable,
  headerValue,
  insertEntities,
  parseDxf,
  recordHandle,
  serializeDxf,
  setHeaderValue,
  type DxfDocument,
  type DxfPair,
} from './dxfDocument.js';
import type { Point } from './dxfEntities.js';
import { damageLabel, labelEntities } from './labelPlacement.js';
import { fillTable, rowValuesOf, type TableRow } from './tableFill.js';
import { buildGrid, findTableCandidates, hasUniformScale, nearestTable } from './tableGrid.js';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
  }
}

export const EXPORT_WARNINGS = {
  noTable: '표 없음',
  unknownTable: '표 모양을 알 수 없음',
  units: '도면 단위 확인 필요',
} as const;

export interface ExportResult {
  dxfText: string;
  /** geometry.dwg가 없어 도면에 놓지 못한 손상 수 */
  skipped: number;
  warnings: string[];
}

// mm(4), 없음(0), 인치(1)만 허용한다. 인치는 캐드 기본값이 남은 것이라 실제로는 mm다(스펙 10장).
const ALLOWED_INSUNITS = new Set([0, 1, 4]);

function boundsCenter(pointGroups: Point[][]): Point {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of pointGroups) {
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return [0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export function exportDamagesToDxf(dxfText: string, damages: unknown[]): ExportResult {
  const list = Array.isArray(damages) ? damages : [];
  if (list.length === 0) throw new ExportError('표기한 손상이 없습니다');

  const doc = parseDxf(dxfText);
  // 고칠 자리가 없는 파일은 여기서 멈춘다 — 반쯤 고친 DXF를 내보내지 않는다.
  if (!findSection(doc, 'ENTITIES')) throw new ExportError('DXF 파일에서 ENTITIES 구역을 찾을 수 없습니다');
  if (!findTable(doc, 'LAYER')) throw new ExportError('DXF 파일에서 LAYER 표를 찾을 수 없습니다');

  const warnings: string[] = [];

  const insUnits = Number(headerValue(doc, '$INSUNITS')?.trim() ?? '');
  if (!Number.isFinite(insUnits) || !ALLOWED_INSUNITS.has(insUnits)) warnings.push(EXPORT_WARNINGS.units);

  // 번호는 dwg가 없는 손상까지 포함한 전체 목록에서 world 좌표로 매긴다.
  const numbers = computeNumbers(list);
  const included: Array<{ damage: unknown; number: number; points: Point[] }> = [];
  let skipped = 0;
  for (const damage of list) {
    const points = dwgPointsOf(damage);
    if (!points) {
      skipped += 1;
      continue;
    }
    included.push({ damage, number: numbers.get(String((damage as { id?: unknown }).id)) ?? 0, points });
  }
  included.sort((a, b) => a.number - b.number);

  const alloc = createHandleAllocator(doc);
  ensureLayer(doc, alloc, DAMAGE_LAYER, DAMAGE_COLOR);
  const owner = recordHandleOrThrow(doc);

  const pairs: DxfPair[] = [];
  for (const entry of included) {
    pairs.push(...damageEntities(entry.damage, alloc, owner));
    const label = damageLabel(entry.damage, entry.number > 0 ? entry.number : null);
    if (label) pairs.push(...labelEntities(label, alloc, owner));
  }

  const candidates = findTableCandidates(doc);
  if (candidates.length === 0) {
    warnings.push(EXPORT_WARNINGS.noTable);
  } else {
    const center = boundsCenter(included.map((entry) => entry.points));
    const candidate = nearestTable(candidates, center)!;
    if (!hasUniformScale(candidate.transform)) {
      throw new ExportError('표의 배율이 가로·세로가 달라 채울 수 없습니다');
    }
    const grid = buildGrid(doc, candidate);
    if (!grid) {
      warnings.push(EXPORT_WARNINGS.unknownTable);
    } else {
      const rows: TableRow[] = included
        .filter((entry) => entry.number > 0)
        .map((entry) => rowValuesOf(entry.damage, entry.number));
      pairs.push(...fillTable(grid, rows, alloc, owner));
    }
  }

  insertEntities(doc, pairs);
  setHeaderValue(doc, '$HANDSEED', alloc.seed);
  return { dxfText: serializeDxf(doc), skipped, warnings };
}
```

`recordHandleOrThrow`를 같은 파일 아래쪽에 둔다:

```ts
// 새 엔티티의 소유자(코드 330)는 모델 공간 블록 레코드의 핸들이다.
function recordHandleOrThrow(doc: DxfDocument): string {
  const handle = recordHandle(doc, 'BLOCK_RECORD', '*Model_Space');
  if (!handle) throw new ExportError('DXF 파일에서 모델 공간 블록 레코드를 찾을 수 없습니다');
  return handle;
}
```

- [ ] **Step 3: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/export/exportDrawing.ts server/test/exportDrawing.test.ts
git commit -m "$(printf '%s\n' '산출 흐름을 엮는다 — 도형·라벨·표를 원본 DXF에 더한다' '' '번호는 computeNumbers가 geometry.world로 계산한 결과를 그대로 쓰고,' 'dwg 좌표가 없는 손상은 빼되 번호는 그대로 소비한다(그 표 행은 빈다).' '' '표가 여러 장이면 손상 경계상자 중심에서 가장 가까운 표를 쓴다.' '표가 없거나 모양을 알 수 없거나 도면 단위가 mm 계열이 아니면 경고만 남기고' '산출은 성공한다. 표의 가로·세로 배율이 다르면 던진다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 픽스처 DXF에 손상을 얹어 캐드가 읽을 수 있는 DXF 글자가 나오고, 원본 구간은 바이트가 같다.

---

### Task 9: 업로드한 원본을 서버에 보관한다

지금은 업로드 파일을 APS에만 올린다. 산출은 서버 사본에서 시작하므로 `server/data/drawings/<id>.<확장자>`에 함께 보관한다. `.dwg`도 보관한다 — 산출은 못 하지만 사본이 없는 것과 구분해 알려야 한다(스펙 2장).

**Files:**
- Create: `server/src/originalsStore.ts`
- Modify: `server/src/jsonFile.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/test/stores.test.ts`
- Modify: `server/test/app.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic` from `./jsonFile.js`, `isDrawingId` from `./drawingsStore.js`
- Produces:
  - `server/src/jsonFile.ts`: `function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void>` (기존 `writeJsonFileAtomic`이 이 함수를 쓰도록 바꾼다)
  - `server/src/originalsStore.ts`:
    - `class OriginalsStore { constructor(dir: string); save(objectKey: string, data: Buffer): Promise<void>; read(objectKey: string): Promise<Buffer | null> }`
    - `objectKey`는 `d_<32자리 16진수>.dwg` 또는 `.dxf` 꼴이어야 하고 아니면 던진다(경로 조작 방지)
  - `server/src/app.ts`: `AppDeps`에 `originals: OriginalsStore` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/stores.test.ts` 맨 아래에 다음 describe를 더하고, 파일 위쪽 import에 `OriginalsStore`를 넣는다:

```ts
import { OriginalsStore } from '../src/originalsStore.js';
```

```ts
describe('OriginalsStore', () => {
  it('저장한 원본을 바이트 그대로 읽는다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    const id = newDrawingId();
    const data = Buffer.from('  0\nSECTION\n한글\n', 'utf8');
    await store.save(`${id}.dxf`, data);
    expect(await store.read(`${id}.dxf`)).toEqual(data);
  });

  it('없는 파일은 null', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    expect(await store.read(`${newDrawingId()}.dxf`)).toBeNull();
  });

  it('형식이 틀린 objectKey는 던진다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    for (const key of ['../secret.dxf', 'a.dxf', `${newDrawingId()}.txt`, newDrawingId()]) {
      await expect(store.save(key, Buffer.from('x'))).rejects.toThrow(/잘못된 파일 이름/);
      await expect(store.read(key)).rejects.toThrow(/잘못된 파일 이름/);
    }
  });

  it('덮어써도 깨지지 않는다', async () => {
    const store = new OriginalsStore(join(dir, 'drawings'));
    const id = newDrawingId();
    await store.save(`${id}.dxf`, Buffer.from('처음'));
    await store.save(`${id}.dxf`, Buffer.from('나중'));
    expect((await store.read(`${id}.dxf`))?.toString('utf8')).toBe('나중');
  });
});
```

`server/test/app.test.ts`의 `setup()`에 원본 저장소를 더한다(기존 함수를 아래처럼 바꾼다):

```ts
function setup(apsOverrides: Record<string, unknown> = {}, maxUploadBytes?: number) {
  const aps = fakeAps(apsOverrides);
  const drawings = new DrawingsStore(join(dir, 'data', 'drawings.json'));
  const damages = new DamagesStore(join(dir, 'data', 'damages'));
  const originals = new OriginalsStore(join(dir, 'data', 'drawings'));
  const app = createApp({
    accessKey: KEY,
    aps,
    drawings,
    damages,
    originals,
    publicDir: join(dir, 'public'),
    now: () => NOW,
    maxUploadBytes,
  });
  return { app, aps, drawings, damages, originals };
}
```

파일 위쪽 import에 `import { OriginalsStore } from '../src/originalsStore.js';`를 더하고, `describe('POST /api/drawings')`에 두 테스트를 더한다:

```ts
  it('업로드한 DXF 원본을 서버에도 보관한다', async () => {
    const { app, originals } = setup();
    const res = await request(app)
      .post('/api/drawings')
      .set('x-access-key', KEY)
      .field('name', '교량.dxf')
      .attach('file', Buffer.from('  0\nSECTION\n'), 'bridge.dxf');

    expect(res.status).toBe(201);
    expect(await originals.read(`${res.body.id}.dxf`)).toEqual(Buffer.from('  0\nSECTION\n'));
  });

  it('DWG 원본도 보관한다', async () => {
    const { app, originals } = setup();
    const res = await request(app).post('/api/drawings').set('x-access-key', KEY).attach('file', Buffer.from('dwg'), 'a.dwg');
    expect(await originals.read(`${res.body.id}.dwg`)).toEqual(Buffer.from('dwg'));
  });
```

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/jsonFile.ts`에서 원자적 쓰기를 분리한다**

`writeJsonFileAtomic`을 다음 두 함수로 바꾼다(파일의 나머지는 그대로 둔다):

```ts
// 임시 파일에 쓴 뒤 rename한다. 쓰는 도중 서버가 꺼져도 원래 파일은 깨지지 않는다.
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, data);
    await renameWithRetry(tempPath, filePath);
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}
```

> `writeFile(tempPath, data)`는 문자열이면 UTF-8, `Uint8Array`면 바이트 그대로 쓴다. 기존 `'utf8'` 인자는 필요 없어져 뺀다.

- [ ] **Step 3: `server/src/originalsStore.ts`를 쓴다**

```ts
// 업로드한 원본 파일을 서버에 보관한다. DXF 산출은 이 사본에서 시작한다.
// 근거: docs/superpowers/specs/2026-09-15-dxf-export-design.md 2장

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './jsonFile.js';

// 업로드 라우트가 만드는 이름만 받는다. 경로 조각이 섞여 들어오면 던진다.
const OBJECT_KEY_PATTERN = /^d_[0-9a-f]{32}\.(dwg|dxf)$/;

export class OriginalsStore {
  constructor(private readonly dir: string) {}

  async save(objectKey: string, data: Buffer): Promise<void> {
    await writeFileAtomic(this.pathFor(objectKey), data);
  }

  async read(objectKey: string): Promise<Buffer | null> {
    const path = this.pathFor(objectKey);
    try {
      return await readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private pathFor(objectKey: string): string {
    if (!OBJECT_KEY_PATTERN.test(objectKey)) throw new Error(`잘못된 파일 이름: ${objectKey}`);
    return join(this.dir, objectKey);
  }
}
```

> `pathFor`가 동기적으로 던지므로 `save`/`read`는 `async` 함수 본문 안에서 호출해 거부된 Promise가 되게 한다(위 코드가 그렇다).

- [ ] **Step 4: `server/src/app.ts`에 저장소를 끼운다**

import에 한 줄 더한다:

```ts
import type { OriginalsStore } from './originalsStore.js';
```

`AppDeps`에 한 줄 더한다:

```ts
  originals: OriginalsStore;
```

업로드 라우트에서 APS 업로드에 성공한 뒤, 레코드를 저장하기 **전에** 원본을 보관한다. `try` 블록 안을 다음으로 바꾼다:

```ts
    try {
      const { urn } = await deps.aps.uploadDrawing(file.buffer, objectKey);
      await deps.aps.startTranslation(urn);
      // 산출은 이 사본에서 시작한다(스펙 2장). APS가 성공한 뒤에만 남긴다.
      await deps.originals.save(objectKey, file.buffer);
      const record: DrawingRecord = {
```

- [ ] **Step 5: `server/src/index.ts`에 주입한다**

import에 한 줄 더한다:

```ts
import { OriginalsStore } from './originalsStore.js';
```

`createApp` 호출에 한 줄 더한다:

```ts
    originals: new OriginalsStore(join(config.dataDir, 'drawings')),
```

- [ ] **Step 6: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
```

```bash
git add server/src/originalsStore.ts server/src/jsonFile.ts server/src/app.ts server/src/index.ts server/test/stores.test.ts server/test/app.test.ts
git commit -m "$(printf '%s\n' '업로드한 원본을 서버에도 보관한다' '' 'server/data/drawings/<id>.<확장자>에 원자적으로 쓴다. DXF 산출은 이 사본에서' '시작한다. DWG도 보관한다 — 산출은 못 하지만 사본이 없는 경우와 구분해' '알려야 하기 때문이다.' '' 'jsonFile의 원자적 쓰기를 writeFileAtomic으로 분리해 바이트도 쓸 수 있게 했다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 업로드하면 `server/data/drawings/<id>.dxf`가 생기고 바이트가 같다. 기존 테스트가 모두 통과한다.

---

### Task 10: 산출 라우트와 내려받기 버튼

`GET /api/drawings/:id/export.dxf`를 더하고 업로드 페이지 목록에 내려받기 버튼을 붙인다.

한글은 HTTP 헤더 값에 그대로 넣을 수 없다(Node가 `ERR_INVALID_CHAR`로 던진다). 파일명은 RFC 5987 `filename*`으로, 경고 문구는 `encodeURIComponent`로 보내고 화면에서 푼다.

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/public/upload.html`
- Modify: `server/public/upload.js`
- Modify: `server/test/app.test.ts`

**Interfaces:**
- Consumes: `exportDamagesToDxf`, `ExportError` from `./export/exportDrawing.js`; `OriginalsStore.read`; `DamagesStore.get`
- Produces: 라우트 하나. 응답 헤더:
  - `Content-Type: application/dxf; charset=utf-8`
  - `Content-Disposition: attachment; filename="damage.dxf"; filename*=UTF-8''<퍼센트 인코딩한 이름>`
  - `X-Mangdo-Skipped: <숫자>`
  - `X-Mangdo-Warning: <퍼센트 인코딩한 경고들, "; "로 이어 붙임>` (경고가 있을 때만)


- [ ] **Step 1: 실패하는 테스트를 쓴다**

`server/test/app.test.ts` 위쪽 import를 보탠다. `OriginalsStore`는 Task 9에서 이미 들여왔으므로 두 가지만 더하면 된다:

```ts
import { fileURLToPath } from 'node:url';
```

그리고 기존 `import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';` 목록에 `readFile`을 더한다.

기존 `seed`가 항상 `.dwg` 확장자의 `objectKey`를 만든다. 이름의 확장자를 따르도록 바꾼다 — 산출 라우트가 `objectKey`로 DXF 여부를 판정하기 때문이다:

```ts
async function seed(drawings: DrawingsStore, patch: Partial<DrawingRecord> = {}): Promise<DrawingRecord> {
  const id = newDrawingId();
  const name = patch.name ?? '교량.dwg';
  const extension = name.toLowerCase().endsWith('.dxf') ? '.dxf' : '.dwg';
  const record: DrawingRecord = {
    id,
    name,
    objectKey: `${id}${extension}`,
    urn: `urn-${id}`,
    status: 'pending',
    progress: '',
    error: null,
    uploadedAt: '2026-09-09T00:00:00.000Z',
    ...patch,
  };
  await drawings.add(record);
  return record;
}
```

그리고 파일 맨 아래에 다음을 더한다:

```ts
const templatePath = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'mangdo-template.dxf');

const RECT_DWG = [[0, 0], [1000, 0], [1000, 400], [0, 400]];

function exportDoc(drawingId: string) {
  return {
    schemaVersion: 4,
    drawingId,
    updatedAt: '2026-09-15T01:00:00.000Z',
    damages: [
      {
        id: 'e1',
        type: 'spalling',
        createdAt: '2026-09-15T01:00:00.000Z',
        geometry: { kind: 'rect', world: RECT_DWG, dwg: RECT_DWG as number[][] | null },
        measured: { width: 1.2, length: 1.5, count: 1 },
        computed: { lengthDwg: null, areaDwg: null },
        attrs: { note: '', statusText: '', photoNumbers: [] as string[] },
      },
    ],
  };
}

// application/dxf는 supertest가 파싱하지 않는다. 텍스트로 왔든 버퍼로 왔든 글자로 읽는다.
function bodyText(res: { text?: string; body: unknown }): string {
  if (typeof res.text === 'string' && res.text.length > 0) return res.text;
  return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body);
}

describe('GET /api/drawings/:id/export.dxf', () => {
  it('손상을 얹은 DXF를 파일로 돌려준다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: '교량 A.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/dxf');
    expect(res.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('교량 A_손상.dxf')}`);
    expect(res.headers['x-mangdo-skipped']).toBe('0');
    expect(res.headers['x-mangdo-warning']).toBeUndefined();
    expect(bodyText(res)).toContain('신규손상');
    expect(bodyText(res)).toContain('ANSI37');
  });

  it('손상이 없으면 400', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '표기한 손상이 없습니다' });
  });

  it('DWG로 올린 도면은 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: '교량.dwg' });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'DXF로 올린 도면만 산출할 수 있습니다' });
  });

  it('사본이 없으면 400', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));
    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '원본 파일이 없습니다. 도면을 다시 올려 주세요' });
  });

  it('없는 도면은 404', async () => {
    const { app } = setup();
    const res = await request(app).get(`/api/drawings/${newDrawingId()}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: '도면을 찾을 수 없습니다.' });
  });

  it('접근키가 없으면 401', async () => {
    const { app, drawings } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    expect((await request(app).get(`/api/drawings/${drawing.id}/export.dxf`)).status).toBe(401);
  });

  it('dwg 좌표가 없는 손상은 헤더로 개수를 알린다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    await originals.save(drawing.objectKey, await readFile(templatePath));
    const doc = exportDoc(drawing.id);
    doc.damages.push({
      ...doc.damages[0],
      id: 'e2',
      geometry: { kind: 'rect', world: RECT_DWG, dwg: null },
    });
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(doc);

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(res.headers['x-mangdo-skipped']).toBe('1');
  });

  it('표가 없으면 경고 헤더를 퍼센트 인코딩해 붙인다', async () => {
    const { app, drawings, originals } = setup();
    const drawing = await seed(drawings, { name: 'a.dxf' });
    const template = (await readFile(templatePath, 'utf8')).replace('  0\nACAD_TABLE\n', '  0\nPOINT\n');
    await originals.save(drawing.objectKey, Buffer.from(template, 'utf8'));
    await request(app).put(`/api/drawings/${drawing.id}/damages`).set('x-access-key', KEY).send(exportDoc(drawing.id));

    const res = await request(app).get(`/api/drawings/${drawing.id}/export.dxf`).set('x-access-key', KEY);
    expect(res.status).toBe(200);
    expect(decodeURIComponent(res.headers['x-mangdo-warning'])).toBe('표 없음');
  });
});
```

> 기존 테스트 중 `'DWG를 올리고 변환을 요청한 뒤…'`는 `seed`를 쓰지 않으므로 영향이 없다. `seed`의 기본 이름이 `교량.dwg`라 `objectKey`는 예전과 같은 `<id>.dwg`다.

`npm --prefix server test` — 실패를 확인한다.

- [ ] **Step 2: `server/src/app.ts`에 라우트를 더한다**

import 한 줄을 더한다:

```ts
import { ExportError, exportDamagesToDxf } from './export/exportDrawing.js';
```

`api.put('/drawings/:id/damages', …)` 아래, `api.use((_req, res) => …)` **위에** 다음을 넣는다:

```ts
  api.get('/drawings/:id/export.dxf', async (req, res) => {
    const drawing = await findDrawing(deps, req.params.id);
    if (!drawing) {
      res.status(404).json({ error: '도면을 찾을 수 없습니다.' });
      return;
    }
    if (!drawing.objectKey.toLowerCase().endsWith('.dxf')) {
      res.status(400).json({ error: 'DXF로 올린 도면만 산출할 수 있습니다' });
      return;
    }
    const original = await deps.originals.read(drawing.objectKey);
    if (!original) {
      res.status(400).json({ error: '원본 파일이 없습니다. 도면을 다시 올려 주세요' });
      return;
    }

    const doc = await deps.damages.get(drawing.id);
    let result;
    try {
      result = exportDamagesToDxf(original.toString('utf8'), doc.damages);
    } catch (err) {
      if (err instanceof ExportError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('[export]', drawing.id, err);
      res.status(500).json({ error: `DXF 산출에 실패했습니다: ${messageOf(err)}` });
      return;
    }

    // 한글은 HTTP 헤더 값에 그대로 넣을 수 없다(Node가 ERR_INVALID_CHAR로 던진다).
    // 파일명은 RFC 5987 filename*, 경고 문구는 퍼센트 인코딩으로 보낸다.
    const fileName = `${drawing.name.replace(/\.[^.]*$/, '')}_손상.dxf`;
    res.setHeader('Content-Type', 'application/dxf; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="damage.dxf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('X-Mangdo-Skipped', String(result.skipped));
    if (result.warnings.length > 0) {
      res.setHeader('X-Mangdo-Warning', encodeURIComponent(result.warnings.join('; ')));
    }
    res.send(Buffer.from(result.dxfText, 'utf8'));
  });
```

- [ ] **Step 3: 업로드 페이지에 내려받기를 붙인다**

`server/public/upload.html`의 표 머리글 줄을 바꾼다:

```html
            <tr><th>도면</th><th>상태</th><th>진행률</th><th>업로드 시각</th><th>산출</th><th></th></tr>
```

`server/public/upload.js`에서:

`api` 함수 아래에 파일을 받아 오는 함수를 더한다:

```js
// 산출은 JSON이 아니라 파일이라 별도 함수로 받는다. 접근키는 다른 API와 같은 헤더로 보낸다.
async function download(path, fallbackName) {
  const res = await fetch(`/api${path}`, {
    headers: { 'x-access-key': getKey() || $('accessKey').value.trim() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? '접근키를 확인하세요.' : body.error ?? `요청에 실패했습니다 (${res.status}).`);
  }
  // 한글 파일명은 RFC 5987 filename*으로 온다.
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // 브라우저가 내려받기를 시작할 시간을 주고 정리한다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  const warning = res.headers.get('x-mangdo-warning');
  return {
    name,
    skipped: Number(res.headers.get('x-mangdo-skipped') ?? '0'),
    warning: warning ? decodeURIComponent(warning) : '',
  };
}
```

`renderRows`의 `actionTd` 앞에 산출 칸을 더한다(`tr.append(textCell(...uploadedAt...))` 다음 줄에 넣는다):

```js
    const exportTd = document.createElement('td');
    if (drawing.objectKey && drawing.objectKey.toLowerCase().endsWith('.dxf')) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = 'DXF 내려받기';
      exportButton.addEventListener('click', () => exportDxf(drawing, exportButton));
      exportTd.append(exportButton);
    } else {
      exportTd.textContent = 'DXF로 올린 도면만';
    }
    tr.append(exportTd);
```

`retry` 함수 아래에 다음을 더한다:

```js
async function exportDxf(drawing, button) {
  button.disabled = true;
  showMessage('산출 중…');
  try {
    const result = await download(`/drawings/${drawing.id}/export.dxf`, 'damage.dxf');
    const notes = [];
    if (result.skipped > 0) notes.push(`도면 좌표를 구하지 못한 손상 ${result.skipped}개는 빠졌습니다.`);
    if (result.warning) notes.push(result.warning);
    showMessage(`내려받았습니다: ${result.name}${notes.length > 0 ? ` — ${notes.join(' / ')}` : ''}`);
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    button.disabled = false;
  }
}
```

- [ ] **Step 4: 검증하고 커밋한다**

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/upload.js
```

브라우저 확인(수동): 서버를 띄우고 `http://localhost:3000/upload.html`에서 DXF 도면 줄의 `DXF 내려받기`를 눌러 파일이 저장되는지, DWG 줄에는 버튼 대신 `DXF로 올린 도면만`이 보이는지 확인한다.

```bash
git add server/src/app.ts server/public/upload.html server/public/upload.js server/test/app.test.ts
git commit -m "$(printf '%s\n' 'DXF 산출 라우트와 업로드 페이지 내려받기 버튼' '' 'GET /api/drawings/:id/export.dxf — 사본이 없거나 DWG거나 손상이 없으면 400,' '표 배율이 어긋나면 400. 건너뛴 손상 수와 경고는 응답 헤더로 알린다.' '' '한글은 HTTP 헤더 값에 그대로 넣을 수 없어 파일명은 RFC 5987 filename*,' '경고 문구는 퍼센트 인코딩으로 보내고 화면에서 푼다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 업로드 페이지에서 DXF 도면을 눌러 `<이름>_손상.dxf`를 내려받을 수 있고, 네 가지 오류가 스펙 문구 그대로 나온다.

---

### Task 11: 문서와 사용자 확인표

**Files:**
- Modify: `README.md`
- Create: `docs/DXF산출-테스트-결과.md`

**Interfaces:**
- Consumes: 앞선 Task들이 만든 동작
- Produces: 문서만. 코드 변경 없음

- [ ] **Step 1: `README.md`를 고친다**

맨 위 소개 문단을 바꾼다:

```md
태블릿에서 DXF 망도를 열어 손상을 표기하고, 손상물량표가 반영된 DXF로 내보내는 앱.
현재 **2단계**: DXF 업로드 → APS 변환 → 태블릿 뷰어 → 펜/드래그로 손상 입력 → 도면 좌표 JSON 저장
→ PC에서 손상 도형·라벨·물량표가 얹힌 DXF 내려받기.
```

`## 구성`의 설계 목록 줄 끝에 한 건을 더한다:

```md
`docs/superpowers/specs/2026-09-15-dxf-export-design.md`(DXF 산출·손상물량표)
```

`## 사용`의 1번 항목을 바꾸고 5번을 새로 더한다:

```md
1. PC 브라우저 `http://localhost:3000/upload.html` → 접근키 저장 → **DXF 업로드** → `완료`까지 대기
   - 산출(내려받기)은 **DXF로 올린 도면만** 됩니다. DWG로 올리면 뷰어는 되지만 산출 버튼이 없습니다.
```

```md
5. 표기가 끝나면 PC 업로드 페이지에서 그 도면 줄의 **DXF 내려받기**를 누릅니다
   - `<도면이름>_손상.dxf`가 저장됩니다. 원본은 그대로 있고 `신규손상` 레이어에 빨간색으로 손상이 더해집니다
   - 손상마다 도형(선/사각형 + 유형별 해치·기호)과 라벨(번호 원, 이름, 치수, 사진번호)이 들어갑니다
   - 도면 오른쪽 끝 **손상물량표**의 각 칸 자리에 손상현황·가로/폭·세로/길이·개소·면적/연장·단위가 얹힙니다
     (표 객체를 고치는 것이 아니라 칸 위에 글자를 놓는 방식입니다 — 캐드에서 표를 더블클릭하면 칸은 비어 있습니다)
   - 손상이 표의 행 수를 넘으면 표를 오른쪽에 한 장 더 그립니다
   - 도면 좌표를 구하지 못한 손상이 있으면 내려받은 뒤 화면에 `… n개는 빠졌습니다`라고 알립니다
   - 도면에 손상물량표가 없으면 `표 없음` 경고가 뜨고 도형·라벨만 들어갑니다
```

`## 문제 해결` 절 끝에 다음을 더한다:

```md
### DXF 내려받기가 안 될 때

| 메시지 | 뜻 |
|---|---|
| `DXF로 올린 도면만 산출할 수 있습니다` | `.dwg`로 올린 도면입니다. 같은 도면을 `.dxf`로 저장해 다시 올리세요 |
| `원본 파일이 없습니다. 도면을 다시 올려 주세요` | 원본 보관 기능이 생기기 전에 올린 도면입니다. 다시 올리면 됩니다 |
| `표기한 손상이 없습니다` | 그 도면에 저장된 손상이 없습니다 |
| `표의 배율이 가로·세로가 달라 채울 수 없습니다` | 물량표가 가로·세로 배율이 다르게 삽입돼 있습니다. 캐드에서 표 블록의 배율을 맞춰 주세요 |
```

- [ ] **Step 2: `docs/DXF산출-테스트-결과.md`를 만든다**

결과는 사용자가 실기기·지스타캐드에서 채운다. 항목은 스펙 9장의 "실기기·캐드 확인(사용자)"을 그대로 옮긴 것이다.

```md
# DXF 산출 확인 결과

- 확인 일자:
- 커밋:
- 확인 도면:
- 캐드: 지스타캐드 (버전:            )

| # | 확인 항목 | 결과 | 비고 |
|---|---|---|---|
| 1 | 내려받은 DXF가 지스타캐드에서 오류 없이 열린다 | | |
| 2 | 원본 도면이 그대로 있다 (선·글자·표가 하나도 사라지거나 바뀌지 않았다) | | |
| 3 | 손상이 빨간색 `신규손상` 레이어로 올라가 있다 (레이어 끄면 손상만 사라진다) | | |
| 4 | 손상 위치가 앱 화면에서 본 자리와 같다 | | |
| 5 | 균열은 열린 선, 면형은 닫힌 사각형으로 들어갔다 | | |
| 6 | 해치 무늬가 사내 망도와 **같은 간격**이다 (박리 ANSI31, 박락 ANSI37, 재료분리 CORK, 백태·열화 TRIANG, 기타·파손 ANSI33, 망상균열 ANCHORLK) | | |
| 7 | 망상균열의 `ANCHORLK` 무늬가 사내 망도와 똑같이 보인다 (`.pat` 파일 없이도) | | |
| 8 | 철근노출 기호가 나란한 선 2개 + 양 끝 ✕ 모양이고 크기가 범례와 같다 | | |
| 9 | 균열/백태의 원이 선을 따라 위·아래 번갈아 찍혀 있다 | | |
| 10 | 라벨의 번호 원과 글자 크기가 도면의 다른 글자와 어울린다 (글자 높이 300) | | |
| 11 | 라벨 줄 순서가 앱 화면과 같다 (번호+이름 / 치수 / 사진번호) | | |
| 12 | 라벨의 한글이 깨지지 않는다 | | |
| 13 | 물량표의 각 칸에 값이 들어가고 번호 순서가 앱과 같다 | | |
| 14 | 값이 없는 칸은 비어 있다 (`-`가 찍히지 않는다) | | |
| 15 | 번호 칸과 손상위치 칸은 손대지 않았다 | | |
| 16 | 물량표의 한글(손상현황)이 깨지지 않는다 | | |
| 17 | 표 글자가 칸 가운데에 놓여 있다 (칸을 벗어나지 않는다) | | |
| 18 | **손상을 36개 넘게 그린 도면**에서 두 번째 표가 오른쪽에 생긴다 | | |
| 19 | 두 번째 표의 번호가 36부터 이어진다 | | |
| 20 | 두 번째 표의 열 너비·행 높이·머리글이 원본 표와 같다 | | |
| 21 | 지스타캐드에서 저장한 뒤 다시 열어도 손상이 그대로 있다 (왕복) | | |
| 22 | 지스타캐드에서 DWG로 저장한 뒤 다시 열어도 손상이 그대로 있다 | | |
| 23 | 손상을 하나도 표기하지 않은 도면에서 내려받으면 `표기한 손상이 없습니다`가 뜬다 | | |
| 24 | DWG로 올린 도면 줄에는 내려받기 버튼 대신 `DXF로 올린 도면만`이 보인다 | | |

## 두 번째 표 위치

스펙 10장에서 "두 번째 표가 도면 틀 밖으로 나가는 문제는 실제 도면을 본 뒤 조정한다"고 미뤄 둔 항목이다.

- 두 번째 표가 도면 틀 안에 들어오는가:
- 들어오지 않는다면 원하는 자리(원본 표 기준 어느 방향으로 얼마나):

## 발견한 문제

## 다음에 고칠 것
```

- [ ] **Step 3: 전체 검증**

```bash
npm --prefix server test
npm --prefix server run typecheck
node --check server/public/upload.js
```

세 명령이 모두 통과해야 한다. 그리고 사내 템플릿으로 실제 산출을 한 번 만들어 본다 — `server/scripts/check-export.ts`를 만들어 실행한 뒤 지운다:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { exportDamagesToDxf } from '../src/export/exportDrawing.js';

const rect = (x: number, y: number) => [[x, y], [x + 2000, y], [x + 2000, y + 800], [x, y + 800]];
const types = [
  'crack', 'map_crack', 'breakage', 'segregation', 'delamination',
  'spalling', 'efflorescence', 'etc', 'rebar_exposure', 'crack_efflorescence',
];
const damages = types.map((type, i) => ({
  id: `d${i}`,
  type,
  createdAt: '2026-09-15T00:00:00.000Z',
  geometry: { kind: type === 'crack' || type === 'crack_efflorescence' ? 'polyline' : 'rect', world: rect(i * 3000, 0), dwg: rect(130000 + i * 3000, 45000) },
  measured: { width: 1.2, length: 1.5, count: 1 },
  computed: { lengthDwg: null, areaDwg: null },
  attrs: { note: '', statusText: type === 'etc' ? '받침 손상' : '', photoNumbers: ['12'] },
}));

const original = readFileSync('../docs/빈도면(테이블버전).dxf', 'utf8');
const result = exportDamagesToDxf(original, damages);
console.log('건너뜀', result.skipped, '경고', result.warnings);
console.log('늘어난 글자 수', result.dxfText.length - original.length);
writeFileSync('../docs/산출확인.dxf', result.dxfText, 'utf8');
```

```bash
node --import tsx server/scripts/check-export.ts
```

기대: `건너뜀 0 경고 []`. 만들어진 `docs/산출확인.dxf`를 **지스타캐드에서 열어** 위 확인표의 1~17번을 사용자와 함께 본다. 확인이 끝나면 `server/scripts/check-export.ts`와 `docs/산출확인.dxf`를 지운다(둘 다 커밋하지 않는다 — `docs/*.dxf`는 `.gitignore` 대상이다).

- [ ] **Step 4: 커밋한다**

```bash
git add README.md docs/DXF산출-테스트-결과.md
git commit -m "$(printf '%s\n' 'DXF 산출 사용법과 확인표' '' 'README에 내려받기 절차와 오류 메시지 뜻을 적는다.' '지스타캐드에서 사용자가 채울 빈 확인표를 더한다 — 해치 간격, 기호 모양,' '한글 깨짐, 표 채우기, 넘침 표, 왕복 저장을 본다.' '' 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>')"
```

**Deliverable:** 사용자가 문서만 보고 산출을 실행하고, 지스타캐드에서 무엇을 확인할지 알 수 있다.

---

## 검증 명령 모음

작업 중 언제든 아래를 돌린다.

```bash
npm --prefix server test          # vitest 전체
npm --prefix server run typecheck # tsc --noEmit
node --check server/public/upload.js
```

브라우저·캐드 확인은 Task 10 Step 4와 Task 11 Step 3에 적었다.

## 스펙 조항 → Task 대응

| 스펙 조항 | Task |
|---|---|
| 1장 산출 방식(오토캐드 안 씀, 표 위에 글자) | 2·7·8 전체 설계 |
| 2장 원본 보관, DWG·사본 없음 메시지 | 9, 10 |
| 3장 API·헤더·파일명·업로드 페이지 링크 | 10 |
| 4.1 읽기(쌍 배열, 줄끝, HEADER·LAYER·BLOCKS·INSERT·ACAD_TABLE) | 2, 6 |
| 4.2 쓰기(ENDSEC 앞 삽입, 핸들, 소유자, 레이어, UTF-8) | 2, 8 |
| 4.3 좌표(dwg 사용, 건너뛰기·헤더, 블록→절대, 배율 불일치 400) | 4, 6, 8 |
| 5장 유형별 도형·해치·기호 치수 | 1, 3, 4 |
| 6장 라벨 배치·같은 함수 재사용·TEXT 정렬 | 1, 5 |
| 7.1 표 모양(실측을 코드에 박지 않음) | 6 |
| 7.2 열 매핑·빈 칸·글자 높이 | 7 |
| 7.3 표 없음·여러 개·데이터 행 판정 | 6, 8 |
| 7.4 넘침 표 | 7 |
| 8장 번호(world 기준, 정렬) | 8 |
| 9장 단위 테스트 | 2~10의 각 테스트 파일 |
| 9장 실기기·캐드 확인 | 11 |
| 10장 `$INSUNITS` 경고 | 8 |
