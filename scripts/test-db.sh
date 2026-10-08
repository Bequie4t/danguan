#!/usr/bin/env bash
# 로컬 Postgres(임시 클러스터)에 마이그레이션을 적용하고 RLS·중복·충돌 시나리오를 검증한다.
# 실제 Supabase 프로젝트에는 연결하지 않는다. 가상 데이터만 사용한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/local-test/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "== 적용: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
# 마이그레이션을 두 번 적용해도 오류 없이 넘어가는지 (기존 데이터 보존형인지) 확인
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
echo "== 재적용 OK"

"${PSQL[@]}" -f "$ROOT/supabase/local-test/10_rls_and_sync_tests.sql"
