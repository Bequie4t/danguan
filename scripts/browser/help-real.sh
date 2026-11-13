#!/usr/bin/env bash
# 도움 화면을 실제 앱 전체로 시험한다: Supabase 설정이 없을 때 / 주소 형식이 잘못됐을 때 / 닿지 않는 주소일 때.
# 각 경우마다 그 설정으로 새로 빌드한다 (브라우저용 설정은 빌드 때 고정됨). 가상 값만 쓴다.
# 주의: 저장소의 .next 폴더를 덮어쓴다. 실패가 하나라도 있으면 종료 코드 1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${HELP_REAL_PORT:-3300}"
cd "$ROOT"
status=0
run_mode() {
  local mode="$1" url="$2" key="$3"
  echo "== $mode"
  NEXT_PUBLIC_SUPABASE_URL="$url" NEXT_PUBLIC_SUPABASE_ANON_KEY="$key" npm run build >/tmp/help-real-build.log 2>&1 \
    || { tail -20 /tmp/help-real-build.log; return 1; }
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then echo "포트 $PORT가 이미 쓰이고 있습니다" >&2; return 1; fi
  # 새 프로세스 묶음으로 띄워, 끝날 때 next-server까지 함께 멈춘다 (예전 빌드를 내주는 남은 서버 방지)
  NEXT_PUBLIC_SUPABASE_URL="$url" NEXT_PUBLIC_SUPABASE_ANON_KEY="$key" setsid npx next start -p "$PORT" >/tmp/help-real-app.log 2>&1 &
  local pid=$!
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/help" && break; sleep 1; done
  node scripts/browser/help-real.mjs "http://127.0.0.1:$PORT" "$mode" || status=1
  kill -- "-$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT" || break; sleep 0.5; done
}
run_mode "설정 없음" "" "" || status=1
run_mode "주소 형식 오류" "not-a-valid-url" "virtual-test-key" || status=1
run_mode "닿지 않는 주소" "https://unreachable-supabase.invalid" "virtual-test-key" || status=1
exit $status
