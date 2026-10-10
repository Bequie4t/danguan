import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthClient, type Session } from "@supabase/supabase-js";
import { enableTestRefreshGuard } from "../src/lib/account/refreshGuard";
import { authWriteTransaction, strictAuthLock } from "../src/lib/account/authTransaction";
import { queuedLocks } from "./helpers/auth-locks";

// 실제 네트워크·DB·토큰을 사용하지 않는 설치 SDK의 공개 API 회귀 시험.
const key = "synthetic-refresh-order";
const session = (id: string): Session => ({
  access_token: `synthetic-access-${id}`, refresh_token: `synthetic-refresh-${id}`,
  token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" },
});

function fixture(hooks: { beforeSet?: (values: Map<string, string>) => void; beforeRemove?: (values: Map<string, string>) => void; lock?: typeof strictAuthLock; passwordLogin?: boolean } = {}) {
  const values = new Map([[key, JSON.stringify(session("A"))]]);
  let respond!: (response: Response) => void;
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const response = new Promise<Response>(resolve => { respond = resolve; });
  let requests = 0;
  const auth = new AuthClient({
    url: "https://synthetic.invalid/auth/v1", storageKey: key,
    autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    ...(hooks.lock ? { lock: hooks.lock } : {}),
    storage: {
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => { if (name === key) hooks.beforeSet?.(values); values.set(name, value); },
      removeItem: name => { if (name === key) hooks.beforeRemove?.(values); values.delete(name); },
    },
    fetch: async input => {
      assert.match(String(input), /^https:\/\/synthetic\.invalid\/auth\/v1\/token\?/);
      requests += 1;
      if (hooks.passwordLogin && String(input).includes("grant_type=password")) return new Response(JSON.stringify(session("B")), { status: 200, headers: { "Content-Type": "application/json" } });
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

test("opt-in SDK guard preserves expired B and emits no sign-out for rejected A", async () => {
  const f = fixture();
  enableTestRefreshGuard(f.auth);
  const events: string[] = [];
  f.auth.onAuthStateChange(event => { events.push(event); });
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify({ ...session("B"), expires_at: 1 }));
  f.respond(new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.equal(result.error?.name, "AuthRefreshDiscardedError");
  const stored = f.values.get(key);
  assert.ok(stored, "A의 갱신 실패가 B의 저장 세션을 제거하면 안 된다");
  assert.equal(JSON.parse(stored).user.id, "B");
  assert.equal(events.includes("SIGNED_OUT"), false);
});

test("guard is opt-in: unchanged SDK still removes expired B on rejected A", async () => {
  const f = fixture();
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify({ ...session("B"), expires_at: 1 }));
  f.respond(new Response(JSON.stringify({ message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  await pending;
  assert.equal(f.values.has(key), false);
});

test("guard still clears the original expired A when its own refresh is rejected", async () => {
  const f = fixture();
  enableTestRefreshGuard(f.auth);
  const events: string[] = [];
  f.auth.onAuthStateChange(event => { events.push(event); });
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify({ ...session("A"), expires_at: 1 }));
  f.respond(new Response(JSON.stringify({ message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.ok(result.error);
  assert.notEqual(result.error.name, "AuthRefreshDiscardedError");
  assert.equal(f.values.has(key), false);
  assert.equal(events.includes("SIGNED_OUT"), true);
});

// Transaction-off comparisons: passing reproduces the bug, NOT protection success.
test("[transaction off reproduction] B replacement inside A refresh storage write is overwritten", async () => {
  let armed = false;
  const f = fixture({ beforeSet: values => {
    if (armed) { armed = false; values.set(key, JSON.stringify(session("B"))); }
  } });
  enableTestRefreshGuard(f.auth);
  const events: string[] = [];
  f.auth.onAuthStateChange(event => { events.push(event); });
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  armed = true;
  f.respond(new Response(JSON.stringify(session("A")), { status: 200, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.equal(armed, false, "storage write boundary must be reached");
  assert.equal(result.error, null);
  assert.equal(JSON.parse(f.values.get(key)!).user.id, "A", "reproduces undesirable overwrite, not protection");
  assert.equal(events.includes("TOKEN_REFRESHED"), true);
});

test("[transaction off reproduction] B replacement inside rejected A refresh removal is erased", async () => {
  let armed = false;
  const f = fixture({ beforeRemove: values => {
    if (armed) { armed = false; values.set(key, JSON.stringify(session("B"))); }
  } });
  enableTestRefreshGuard(f.auth);
  const events: string[] = [];
  f.auth.onAuthStateChange(event => { events.push(event); });
  const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
  await f.requestStarted;
  f.values.set(key, JSON.stringify({ ...session("A"), expires_at: 1 }));
  armed = true;
  f.respond(new Response(JSON.stringify({ message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
  const result = await pending;
  assert.equal(armed, false, "storage removal boundary must be reached");
  assert.ok(result.error);
  assert.equal(f.values.has(key), false, "reproduces undesirable removal, not protection");
  assert.equal(events.includes("SIGNED_OUT"), true);
});

for (const failure of [false, true]) {
  test(`transaction protection: B auth writer queued at A ${failure ? "removal" : "save"} boundary is retained`, async () => {
    const locks = queuedLocks();
    let armed = false;
    let bWrite: Promise<void> | undefined;
    const replaceB = (values: Map<string, string>) => {
      if (!armed) return;
      armed = false;
      bWrite = authWriteTransaction(f.auth, key, async () => {
        const result = await f.auth.signInWithPassword({ email: "b@example.invalid", password: "synthetic-password" });
        assert.equal(result.error, null);
        assert.equal(result.data.session?.user.id, "B");
      }, locks);
    };
    const f = fixture({ passwordLogin: true, lock: (name, timeout, work) => strictAuthLock(name, timeout, work, locks),
      ...(failure ? { beforeRemove: replaceB } : { beforeSet: replaceB }),
    });
    enableTestRefreshGuard(f.auth);
    const events: string[] = [];
    f.auth.onAuthStateChange(event => { events.push(event); });
    const pending = f.auth.refreshSession({ refresh_token: session("A").refresh_token });
    await f.requestStarted;
    if (failure) f.values.set(key, JSON.stringify({ ...session("A"), expires_at: 1 }));
    armed = true;
    f.respond(new Response(JSON.stringify(failure ? { message: "Synthetic rejection" } : session("A")), { status: failure ? 400 : 200, headers: { "Content-Type": "application/json" } }));
    await pending;
    assert.ok(bWrite, "writer must attempt to enter at the storage boundary");
    await bWrite;
    assert.equal(JSON.parse(f.values.get(key)!).user.id, "B");
    assert.equal(events.at(-1), "SIGNED_IN");
    const count = events.length;
    await Promise.resolve();
    assert.equal(events.length, count, "old refresh must not notify after B commit");
  });
}
