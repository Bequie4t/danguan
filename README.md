# 당우안 (웹)

마음 상태 기록과 진료 준비를 돕는 웹. 이번 버전은 **공통 기록 구조와 웹의 실제 저장 기능**까지 들어 있어요.

- 로그인 / 계정 만들기
- 민감정보 저장 동의
- 오늘 기록: 버거운 정도를 한 번 고르면 저장 (생활 항목·메모·회상 시점은 선택)
- 내 기록: 조회, 고치기, 지우기 (다른 기기와 충돌 시 덮어쓰지 않음)
- 도움 화면: 로그인 없이 항상 열림

## 지금 올라가 있는 곳 (2026-10-07 기준)
- 웹 주소: https://danguan.vercel.app (Vercel 프로젝트 `danguan`)
- Supabase 프로젝트: `danguan` (ref `fswhsjimqpwjfzhfkmfc`, 서울). 같은 조직의 `moabom`은 무료 한도 때문에 일시정지해 둠 (데이터 보존, 대시보드에서 다시 켤 수 있음).
- Vercel 환경변수 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`(publishable 키) 설정됨.
- 아래 '처음 설정하기'는 내 컴퓨터에서 직접 돌리거나 새로 설치할 때만 필요해요.

---

## 처음 설정하기

### 1. 컴퓨터 준비 (한 번만)
1. https://nodejs.org 에서 **LTS** 버전을 내려받아 설치해요.
2. 터미널(맥: 터미널 앱, 윈도우: PowerShell)을 열고 아래를 붙여넣어 버전이 나오면 준비 완료예요.
   ```bash
   node -v
   ```

### 2. Supabase 프로젝트 만들기 (한 번만)
Supabase는 로그인과 기록 저장을 맡는 서비스예요.

1. https://supabase.com 에 가입하고 **New project**를 눌러요.
2. 이름은 `danguan`, 지역(Region)은 **Northeast Asia (Seoul)**, 데이터베이스 비밀번호는 안전한 곳에 적어 두세요.
   - 이미 쓰고 있는 프로젝트가 아니라 **새 프로젝트**를 만드는 것을 권해요.
3. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query**를 눌러요.
4. 이 폴더의 `supabase/migrations/20261007000000_records_v1.sql` 파일 내용을 전부 복사해 붙여넣고 **Run**을 눌러요.
   - 새 표(consents, checkins)와 저장 함수만 만들어요. 기존 데이터를 지우지 않고, 두 번 실행해도 괜찮아요.
5. 왼쪽 메뉴 **Authentication**에서:
   - **Sign In / Providers → Email**이 켜져 있는지 확인해요.
   - 혼자 시험해 볼 때는 **Confirm email**을 꺼 두면 가입 메일 확인 없이 바로 시험할 수 있어요. *실제 사용자를 받기 전에 다시 켜 주세요.*
   - **URL Configuration**에서 Site URL을 `http://localhost:3000`으로, Redirect URLs에 `http://localhost:3000/auth/callback`을 추가해요.

### 3. 키 넣기
1. Supabase 왼쪽 아래 **Project Settings → API**(또는 **API Keys**)로 가요.
2. **Project URL**과 **anon / publishable** 키를 복사해요.
   - `service_role` 또는 `secret` 키는 **절대 넣지 마세요.** 이 웹에는 필요 없어요.
3. 이 폴더에 있는 `.env.example` 파일을 복사해서 이름을 `.env.local`로 바꾸고, 두 값을 붙여넣어요.

### 4. 실행
이 폴더에서 터미널을 열고:
```bash
npm install
npm run dev
```
브라우저에서 http://localhost:3000 을 열어요.

---

## 눌러볼 순서 (가상 계정·가상 기록으로)
1. 머리글 **도움이 필요해요** → 로그인 없이 연락처 화면이 열리는지
2. **로그인 → 처음이에요 · 계정 만들기**로 가상 계정 A(예: `a@test.danguan.dev`) 만들기
3. 동의 화면에서 체크 → **동의하고 계속하기**
4. **오늘 기록**에서 버거움 하나만 누르기 → "저장하는 중" 다음에 "저장했어요"가 뜨는지
5. **선택 사항 더하기** → 생활 항목·가상 메모·"지난 일을 돌아보며 기록" → **저장하기**
6. **내 기록**에서 두 기록이 보이는지 → 새로고침해도 남아 있는지
7. **고치기 / 지우기** 해 보기
8. 충돌 확인: 창 두 개로 내 기록을 열고, 창 1에서 고쳐 저장 → 창 2에서 같은 기록을 고쳐 저장 → "다른 기기에서 먼저 바뀌었어요"가 뜨고 덮어쓰지 않는지
9. 저장 실패 확인: 오늘 기록에서 선택 사항을 펼쳐 메모를 쓴 뒤, 인터넷을 끄고(또는 개발자 도구 Network → Offline) **저장하기** → 실패 안내가 뜨고 입력이 그대로인지 → 인터넷을 켜고 **다시 저장하기** → 기록이 한 개만 생기는지
10. **로그아웃** → 내 기록 주소(http://localhost:3000/records)로 가면 로그인 화면으로 가는지
11. 가상 계정 B로 가입 → 내 기록에 A의 기록이 하나도 없는지

## 검증 명령
```bash
npm test          # 기록 로직 단위 테스트 (가상 데이터)
npm run test:db   # 로컬 PostgreSQL로 RLS·중복·충돌 검증 (PostgreSQL 설치 필요)
npm run typecheck
npm run build
```

## 폴더 안내
- `supabase/migrations/` 데이터베이스 구조 (Supabase SQL Editor에 넣는 파일)
- `supabase/local-test/` 로컬 검증 전용 SQL (Supabase에 넣지 않아요)
- `src/lib/checkins/` 공통 기록 구조와 저장 로직
- `src/app/help/` 도움 화면 (로그인과 무관)
- `docs/개발계획서.md` 최신 계획서
- `CLAUDE.md` AI 작업 지침
