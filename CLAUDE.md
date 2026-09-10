# 망도 손상조사 앱 — Claude Code 작업 가이드

## 프로젝트 개요
태블릿(iPad, 갤럭시탭)에서 캐드 망도(DWG)를 열어 보고, 펜/손으로 손상을 표기한 뒤,
손상 레이어와 손상물량표가 반영된 DWG로 다시 내보내는 앱.

상세 요구사항은 `docs/기능명세서.md`를 반드시 먼저 읽을 것.

## 기술 스택
- **앱**: React Native (Expo, TypeScript). 현재 빈 화면 상태.
- **도면 뷰어**: Autodesk Platform Services(APS) Viewer SDK — 웹 기술이므로
  `react-native-webview` 안에서 구동한다. (의존성에 이미 포함됨)
- **도면 변환**: APS Model Derivative API (DWG → SVF2)
- **DWG 생성/수정**: APS Design Automation for AutoCAD (별도 .NET 플러그인 필요)
- **백엔드**: 미정 (Node.js 권장). APS 토큰 발급은 반드시 서버에서 처리하고
  client_secret을 앱에 넣지 않는다.
- **사내 캐드**: 지스타캐드(GstarCAD). 산출 DWG는 지스타캐드에서 열리는지 왕복 테스트 필요.

## 개발 순서 (기능명세서 5장 기준)
1. **PoC**: DWG 업로드 → APS 변환 → 웹뷰에서 뷰어 표시 → 펜으로 손상 1종 입력 → JSON 저장
2. Design Automation으로 손상 레이어가 들어간 DWG 산출 → 지스타캐드 왕복 테스트
3. 손상 유형 전체 구현, 물량 자동 계산, 물량표(Table 객체) 자동 작성
4. 프로젝트/사용자 관리, 조사 이력, 사진 첨부

한 번에 다 만들지 말고 반드시 단계별로 진행하고, 각 단계마다 사용자가 실기기에서
테스트할 수 있는 상태로 마무리할 것.

## 주의사항
- APS API 키(client id/secret)는 `.env`로 관리하고 절대 커밋하지 않는다.
- 뷰어 위 손상 입력은 화면 좌표가 아닌 **도면 좌표계** 기준으로 저장한다.
- 손상 입력은 자유곡선이 아니라 유형별 정형 입력(선형=폴리라인, 면형=폐합영역, 점형=심볼).
- 손상 원본 데이터는 JSON이 원본이고 DWG는 산출물이다.
