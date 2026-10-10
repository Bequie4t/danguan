# 계정 삭제: 분리 Preview 전용 구현

## 승인과 범위
2026-10-10 17:36 KST 사용자가 본인 재확인 코드·테스트 Preview 관리자 권한·폐기용 가상 계정 삭제 시험을 승인했다. 운영 관리자 권한·DB 변경·삭제·병합·배포는 제외한다. 기준 main f30093b이다.

## 구현
- /account는 인증 보호와 UID/generation별 화면 초기화를 사용한다. 서버 검증한 현재 계정 이메일을 표시한다. 비밀번호 재입력과 ‘계정 삭제’ 입력으로 확인한다.
- /api/account/delete는 same-origin POST JSON과 제한된 본문을 받고, 화면에 고정한 Bearer 인증을 검증한다. 쿠키의 다른 계정으로 삭제 대상을 바꾸지 않는다.
- 검증된 UID·이메일만 사용해 별도 비영속 클라이언트에서 비밀번호를 재확인하고 UID를 대조한다. 관리자 global 세션 종료 뒤 hard-delete를 요청한다. 기록·동의를 미리 개별 삭제하지 않는다.
- 관리자 모듈은 server-only. VERCEL_ENV=preview, 지정 테스트 DB, ACCOUNT_DELETE_PREVIEW_ENABLED=true, SUPABASE_ACCOUNT_DELETE_KEY가 모두 있어야 활성화된다. 운영 환경에서는 키가 있어도 차단한다. legacy service_role 키는 프로젝트 ref까지 검사하며 신규 secret 키는 실제 프로젝트 일치 확인이 필요하다.
- 공개 설정과 관리자 키는 분리한다. 원문 오류·비밀번호·토큰을 로그에 출력하지 않는다. 삭제 요청 뒤 통신 오류는 uncertain으로 표시한다.
- 성공/실패 뒤 현재 화면의 비밀번호는 비운다. 계정 전환 뒤 옛 응답은 무시한다. 공유 클라이언트의 signOut을 자동 호출하지 않아 늦은 A 응답으로 B 세션이 지워지지 않는다.

## 확인한 근거
분리 테스트 DB wxqmqksqjmfflzghozuq에서 2026-10-10 메타데이터 조회: checkins·consents가 auth.users에 ON DELETE CASCADE, Storage 객체 수 0. 행 내용은 조회하지 않았다. 운영 DB 관계는 검증하거나 변경하지 않았다.
공식 문서·설치 SDK에서 관리자 deleteUser(uid,false), signOut(jwt,'global')과 발급 JWT의 잔여 유효 기간을 확인했다. auth.users 삭제를 기존 JWT 즉시 무효화로 표현하지 않는다.

## 검증 구분
- 로컬 단위 71개·타입·빌드 성공. 로컬 PostgreSQL 설치가 없어 임시 DB 시험은 CI에서 실행한다.
- 기존 tsx CLI의 IPC 권한 오류를 피해 node --import tsx --test tests/*.test.ts로 같은 시험을 실행한다.
- 추가 CI: 실제 Next.js HTTP 운영 차단, 가상 C의 CASCADE/실패 rollback/B 보존/삭제 UID 재생성 거부, 실제 React + mock의 늦은 삭제 응답 및 실패 후 재입력·재시도.
- CI의 최신 상태·정확한 HEAD·Preview 상태는 PR 설명을 우선한다.
- 실제 Supabase Auth 관리자 삭제는 서버 키 및 폐기용 C 계정 준비 뒤에 수행한다. 기존 A/B를 삭제하지 않는다.

## 운영 전에 남은 것
- Preview 전용 서버 키 설정과 실제 C 계정 삭제·재로그인 거부·옛 JWT 기록 RPC 시험·B 보존을 확인해야 한다.
- 인스턴스별 메모리 제한은 전역 요청 제한이 아니다. 지속적인 요청 제한 저장소가 필요하다.
- 완료 화면은 공유 세션을 자동으로 지우지 않는다. 삭제 계정의 남은 로컬 인증 정보 정리와 다른 탭의 새 계정 보호를 함께 검증해야 한다. 운영 완료 조건으로 남긴다.
- 삭제 성공 응답 유실 뒤 이미 삭제된 계정을 식별해 완료를 재확인하는 기능은 아직 없다. 성공으로 단정하지 않고 로그인 여부 확인을 안내한다.
- 백업·관리형 로그 보존 기간/삭제 범위, Storage 소유 객체가 생긴 경우의 처리, 폐기되지 않은 JWT의 민감 작업 세션 검사 여부도 별도 검토한다.
- MFA가 설정된 계정은 이번 비밀번호 전용 삭제 경로를 거부한다. 별도 MFA 본인 확인 흐름 전에는 관리자 권한으로 우회하지 않는다.

ChatGPT가 구현과 자체 검토를 함께 수행했다. 실제 보안 독립 검토나 운영 적용 완료로 표시하지 않는다.
