import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthClient, type Session } from "@supabase/supabase-js";

// 실제 네트워크·DB·토큰을 사용하지 않는 설치 SDK의 공개 API 회귀 시험.
const key = "synthetic-refresh-order";
const session = (id: string): Session => ({
  access_token: `synthetic-access-${id}`, refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" },
});

function fixture() {
  const values = new Map([[key, JSON.stringify(session("A"))]]);
  let respond!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const response = new Promise<Response>(resolve => { respond = resolve; });
  let requests = 0;
  const auth = new AuthClient({
    url: "https://synthetic.invalid/auth/v1", storageKey: key,
    autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storage: {
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => { values.set(name, value); },
      removeItem: name => { values.delete(name); },
    },
    fetch: async input => {
      assert.match(String(input), /^https:\/\/synthetic\.invalid\/auth\/v1\/token\?/);
      requests += 1;
      started();
      return response;
    },
  });
  return { auth, values, requestStarted, respond, requests: () => requests };
}

test("SDK discards successful A refresh arriving after storage switched to B", async () => {
  const f = fixture();
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify(session("B")));
  f.respond(new Response(JSON.stringify(session("A")), { status: 200, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.equal(result.error?.name, "AuthRefreshDiscardedError");
  assert.equal(JSON.parse(f.values.get(key)!).user.id, "B");
  assert.equal(f.requests(), 1);
});

test("SDK preserves valid B session when delayed A refresh is rejected", async () => {
  const f = fixture();
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify(session("B")));
  f.respond(new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.ok(result.error);
  assert.equal(JSON.parse(f.values.get(key)!).user.id, "B");
  assert.equal(f.requests(), 1);
});

test("SDK must preserve expired B when an unrelated A refresh is rejected", {
  todo: "설치 SDK는 실패 경로에서 만료된 현재 세션을 제거한다. 운영 활성화 전 해결 필요.",
}, async () => {
  const f = fixture();
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify({ ...session("B"), expires_at: 1 }));
  f.respond(new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  await pending;
  const stored = f.values.get(key);
  assert.ok(stored, "A의 갱신 실패가 B의 저장 세션을 제거하면 안 된다");
  assert.equal(JSON.parse(stored).user.id, "B");
});
