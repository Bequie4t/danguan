# 분리 TEST 실제 인증 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 기존 합의대로 ChatGPT가 직접 구현·자체 검토한다. 독립 검토로 표시하지 않는다.

**Goal:** 기존 TEST A/B 계정을 보존하면서 실제 토큰 갱신과 다른 탭 로그인 경쟁의 검증 공백을 줄인다.

**Architecture:** 현재 Preview 전용 /test-response와 같은 접근 조건의 별도 /test-auth 화면을 사용한다. 공개 SDK refreshSession을 사용하고 실제 TEST 서버에서 받은 갱신 성공 응답만 메모리에서 일시 보류한다. 생산 인증 잠금·쿠키 작성 정책·환경 변수·DB는 변경하지 않는다. 실제 이메일 검증은 별도 작업으로 유지한다.

**Tech Stack:** 기존 Next.js, React, TypeScript, Supabase SDK, Web Locks. 새 의존성 없음.

**Spec:** docs/auth-transaction-race-review-20261010.md 및 PR #5의 02272d1 최신 검증 기록.

## Global Constraints
- 기준 HEAD 02272d1d121795949e4918b1a94792dd8f71d550. main f30093b4c980d22e4038780e0070e2f0aef607f1. 실행 전 재대조.
- 정확한 TEST DB https://wxqmqksqjmfflzghozuq.supabase.co + VERCEL_ENV=preview + 기존 인증 작업 잠금 활성화 조건에서만 시험 화면 제공.
- 운영 배포·main 병합·DB 변경·기존 계정 삭제·자격 증명 변경 금지.
- 비밀번호·토큰·메일 코드·인증 요청 본문·응답 본문을 로그/보고서/파일/브라우저 저장소에 추가 기록하지 않는다. 공개 SDK가 정상적으로 관리하는 세션 저장만 사용한다.
- 로그인은 사용자 보안 입력 또는 직접 입력. 모델이 비밀번호를 읽거나 채팅으로 받지 않는다.
- 시험은 저장 데이터를 만들지 않는다. 기존 기록은 대조용 조회만 사용한다.

## Review Focus
1. 로그인 대기 시간 초과: 기존 세션을 보존하고 실패를 성공으로 표시하지 않는다.
2. 준비/전달 중복 클릭: 갱신 요청 한 번, 응답 전달 한 번만 허용한다.
3. 화면 종료·취소: 보류 응답을 영구 방치하지 않고 fetch를 복구한다. 서버에서 이미 수행된 갱신을 되돌렸다고 주장하지 않는다.
4. 네트워크 거부/비정상 응답: 보류 성공으로 표시하지 않고 SDK에 원래 결과를 전달한다.
5. 관찰 한계: 잠금 대기 자체와 B 로그인 완료·최종 B 화면을 구분한다. 순서를 고정하지 못하면 경쟁 시험 미검증으로 남긴다.

## Task 1: 갱신 응답 보류 제어기
**Files:** Create src/lib/account/refreshTest.ts, tests/account-refresh-test.test.ts.
**Interfaces:** createRefreshResponseTest(original: typeof fetch, notify: (stage: RefreshTestStage) => void) -> { fetch: typeof fetch; arm(): void; release(): void; cancel(): void }. RefreshTestStage = idle | armed | held | released | not_held | cancelled. 서버/SDK 상세 오류 객체는 전달하지 않는다.
- [ ] 테스트: 정확한 TEST /auth/v1/token?grant_type=refresh_token POST 성공만 보류. password/다른 DB/실패 응답은 통과.
- [ ] 테스트: arm/release/cancel 중복 호출·취소 뒤 도착한 응답·대기 상한 10초 자동 해제. 미보류 전달은 완료로 표시하지 않음.
- [ ] 위 테스트를 먼저 실행해 실패를 확인한 뒤 최소 구현.
- [ ] node --import tsx --test tests/account-refresh-test.test.ts 통과 확인.

## Task 2: Preview 전용 시험 화면
**Files:** Create src/app/test-auth/page.tsx, src/app/test-auth/auth-test.tsx. Modify scripts/verify-browser-auth-pages.mjs, scripts/browser/fixture.jsx, scripts/browser/verify.mjs as needed for exact route/controls tests.
**Interfaces:** Task 1 제어기 및 getBrowserClient().auth.refreshSession() 공개 메서드만 사용. refresh 결과의 data/token/user 원문은 UI·로그로 출력하지 않는다. 로그인 상태 판정은 기존 AuthScope와 서버 getUser 검증 경로를 유지.
- [ ] 가상 계정 테스트: production/다른 DB/플래그 없음 거부, 인증 안 됨에서 갱신 금지, 중복 클릭·취소·에러·상한 해제 확인.
- [ ] 메모리 보류 제어기 설치 후 SDK 클라이언트 초기화 순서를 검증. 자동 갱신이 먼저 발생하면 수동 시험 성공으로 잘못 표시하지 않음.
- [ ] UI: 정상 갱신 실행, 다음 갱신 성공 보류 준비/실행, 보류 전달/취소, 현재 단계만 제공. B 로그인은 기존 /login 사용.
- [ ] 실제 두 탭 경쟁은 A 갱신 응답 held → B 로그인 시도 → A 응답 전달 → B 로그인 완료 순서를 기록한다. 5초 잠금 대기를 넘긴 B 실패는 정상 성공 시험과 구분한다.
- [ ] 실제 브라우저에서 순서를 확보하지 못하면 재현 불성립으로 기록한다. 잠금 강탈/대기 시간 변경으로 시험을 억지로 성공시키지 않는다.
- [ ] 단위·타입·빌드·Chromium 390px/1280px·기존 회귀 CI 통과 후 정확한 커밋 Preview만 배포.

## Task 3: 실제 TEST 실행과 보고
**Files:** Update docs/preview-manual-verification-20261010.md 또는 날짜별 검증 문서, PR #5 검증 항목.
- [ ] 연결 상태를 새로 확인. 현재 Supabase get_project는 권한 거부이므로 DB 상태 확인 완료라고 표시하지 않음. 앱 공개 SDK를 통한 갱신 시험과 관리자 도구 접근을 구분.
- [ ] 실제 TEST 로그인 후 같은 계정 정상 갱신·새로고침 기록 유지 확인.
- [ ] A 갱신 성공 보류/B 로그인 직렬화 시험과 대기 실패 시험을 별도 수행. 이전 화면/새 계정 기록·성공 안내를 대조.
- [ ] 실제 Auth 거부를 만들려고 A/B 세션을 관리자 권한으로 폐기하지 않는다. 실패 제거 경계는 기존 가상 시험 근거를 유지하고 실서버 거부 시험은 미검증으로 표시.
- [ ] 메일 가입 확인은 수신 가능한 미가입 TEST 이메일과 같은 브라우저 PKCE 문맥이 있어야 실행. 이미 확인된 A/B 가입 재발송·관리자 생성 코드로 대체하지 않음. 메일 발송·추가 인증 설정 변경은 실행 직전 범위 확인.
- [ ] 운영 배포 ID/커밋 유지, 최신 Preview SHA, CI, 미검증 범위를 PR에 기록.

## 2026-10-16 재개 확인 결과
- [x] 원격 PR #5 Draft/open/unmerged, HEAD 02272d1 확인.
- [x] 해당 HEAD CI 38061795700 success 재확인. 새 실행은 아님.
- [x] Preview dpl_DJmScroDhf5jrtbYMjhGi16GXBHi READY, 해당 SHA·Preview target 확인.
- [x] 운영 dpl_GKzdpsuYv27FCtS5JEgwmFJD3wEz / f30093b / production READY 유지 확인.
- [x] 정리된 로컬 폴더 대신 원격 브랜치 clone 복구, HEAD 일치 및 CLAUDE.md 확인.
- [x] Supabase 최신 문서·변경 이력 검토. 10월 12일 TLS CBC 폐기 공지는 이전 클라이언트 호환성 범위이며 이번 잠금 구현을 변경할 근거로 삼지 않음.
- [ ] 위 갱신 시험 도구 구현·로컬 단위/타입 검증 완료, CI 및 실제 TEST 실행 대기.
- [ ] 실제 메일 코드 교환: 아직 실행하지 않음.

## 진행률 기준
전체 제품 약 25%, 기본 기록·계정 보호 약 85%는 이전 대화의 임시 추정치로 보존한다. 최신 PRD 전체의 가중 작업표로 재산정하지 않았으므로 이번 준비 작업으로 비율을 올리지 않는다. 남은 실제 인증 검증 두 묶음(토큰 갱신 경쟁, 실제 가입 확인 메일)은 0/2 완료다.
