#!/usr/bin/env bash
# PR #7 홈 기록 실제 로그인·실제 DB 구조 시험 (로컬 전용).
#
# 하는 일
#   1. 임시 폴더에 로컬 Supabase 프로젝트를 만들고 이 저장소의 마이그레이션을 그대로 적용해 띄운다.
#   2. 로컬 DB 주소로 앱을 '새로 빌드'한다 (브라우저용 환경 변수는 빌드 때 고정되므로 재사용하지 않음).
#      빌드 결과에 *.supabase.co 주소가 남아 있으면 중단한다.
#   3. 로컬 앱을 띄우고 scripts/local-e2e/pr7-home.mjs를 실행한다 (외부 요청은 브라우저에서 차단).
#   4. 끝나면 앱과 로컬 Supabase를 멈추고 임시 폴더를 지운다. 시험이 하나라도 실패하면 종료 코드 1.
#
# 필요한 것: Docker(실행 중), Node 22, npx(supabase CLI를 그때 내려받음), Playwright + Chromium
#   (전역에 없으면 TEST_PLAYWRIGHT_MODULE=/경로/playwright/index.mjs 지정)
# 주의: 저장소의 .next 폴더를 로컬 주소용 빌드로 덮어쓴다. 배포에는 영향 없음 (배포는 Vercel이 따로 빌드).
# 운영·테스트 Supabase 프로젝트와 실제 계정은 쓰지 않는다. 가상 계정은 시험마다 새로 만든다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${E2E_APP_PORT:-3100}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/danguan-local-e2e.XXXXXX")"
PROJECT_ID="danguan-e2e-$$"
SUPABASE=(npx -y supabase@2)
APP_PID=""

cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  (cd "$WORK" && "${SUPABASE[@]}" stop --no-backup >/dev/null 2>&1) || true
  rm -rf "$WORK"
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || { echo "Docker가 실행 중이 아닙니다." >&2; exit 2; }

echo "== 1. 로컬 Supabase 준비 ($WORK)"
cd "$WORK"
"${SUPABASE[@]}" init --force >/dev/null
sed -i.bak "s/^project_id = .*/project_id = \"$PROJECT_ID\"/" supabase/config.toml
mkdir -p supabase/migrations
cp "$ROOT"/supabase/migrations/*.sql supabase/migrations/
"${SUPABASE[@]}" start -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,realtime,storage-api,postgres-meta,mailpit >/dev/null
eval "$("${SUPABASE[@]}" status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
case "$API_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "로컬 주소가 아닙니다: $API_URL" >&2; exit 2;; esac
echo "   API $API_URL · 마이그레이션 $(ls supabase/migrations | wc -l)개 적용"

echo "== 2. 로컬 주소로 새로 빌드"
cd "$ROOT"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" npm run build >"$WORK/build.log" 2>&1 \
  || { tail -30 "$WORK/build.log" >&2; exit 1; }
# 빌드가 로컬 주소를 담았는지 확인. 원격 주소는 미리보기 시험 도구의 비교용 상수(TEST_DATABASE) 하나만 허용.
grep -rqF "$API_URL" .next/static || { echo "빌드에 로컬 Supabase 주소가 없습니다." >&2; exit 1; }
ALLOWED="$(sed -nE 's/.*TEST_DATABASE = "https:\/\/([a-z0-9]{20}\.supabase\.co)".*/\1/p' src/lib/checkins/responseTest.ts)"
REMOTE="$(grep -rhoE '[a-z0-9]{20}\.supabase\.co' .next/static .next/server 2>/dev/null | sort -u | grep -vxF "${ALLOWED:-none}" || true)"
if [ -n "$REMOTE" ]; then echo "빌드에 원격 Supabase 주소가 남아 있어 중단합니다: $REMOTE" >&2; exit 1; fi

echo "== 3. 앱 실행 (포트 $PORT)"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" npx next start -p "$PORT" >"$WORK/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/help" && break; sleep 1; done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/help" || { tail -30 "$WORK/app.log" >&2; exit 1; }

echo "== 4. 시험"
E2E_APP_URL="http://127.0.0.1:$PORT" E2E_SUPABASE_URL="$API_URL" E2E_ANON_KEY="$ANON_KEY" \
E2E_SERVICE_KEY="$SERVICE_ROLE_KEY" E2E_DB_CONTAINER="supabase_db_$PROJECT_ID" \
  node "$ROOT/scripts/local-e2e/pr7-home.mjs"
