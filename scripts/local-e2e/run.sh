#!/usr/bin/env bash
# 한 번의 명령 안에서: 도커 → 로컬 Supabase → 앱 → 시험. 끝나면 정리.
set -u
SP=/tmp/claude-0/-home-claude/fdd603a3-282f-5530-b028-8c4df4045bf9/scratchpad
export ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
export SERVICE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

if ! docker info >/dev/null 2>&1; then
  dockerd > "$SP/docker/dockerd.log" 2>&1 &
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
cd "$SP/localsb" && npx -y supabase@2 start -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,realtime,storage-api,postgres-meta,mailpit > "$SP/e2e/sb.log" 2>&1
echo "supabase: $(tail -1 "$SP/e2e/sb.log" | cut -c1-60)"

cd "$SP/gh"
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON" npx next start -p 3000 > "$SP/next-local.log" 2>&1 &
NEXT_PID=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3000/help && break; sleep 1; done
echo "app: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/help)"

cd "$SP/e2e" && rm -f shots/* && node "$SP/gh/scripts/local-e2e/pr7-home.mjs" 2>&1 | grep -E "^(PASS|FAIL|SUMMARY)"
kill $NEXT_PID 2>/dev/null
