// 브라우저 회귀 시험 전용. 실제 서비스에서 import하지 않는다.
// 인증·DB를 메모리 모의 응답으로 대체하고 실제 React 컴포넌트와 훅을 렌더한다.
import React from "react";
import { createRoot } from "react-dom/client";
import { clearDeletedBrowserSession, withSessionCookieLock } from "../../src/lib/account/browserSession";
import { enableTestRefreshGuard } from "../../src/lib/account/refreshGuard";
import { createBrowserClient, parseCookieHeader, serializeCookieHeader, stringToBase64URL, stringFromBase64URL } from "@supabase/ssr";
import AuthScope, { useScopedRequest } from "../../src/components/AuthScope";
import CheckinForm from "../../src/components/CheckinForm";
import RecordList from "../../src/components/RecordList";
import ConsentForm from "../../src/components/ConsentForm";
import AccountDeletion from "../../src/components/AccountDeletion";
import CallbackConfirmation from "../../src/components/CallbackConfirmation";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const listeners = new Set();
const rows = new Map();
const gates = new Map();
const calls = [];
const consents = new Map();
let screenGeneration = 0;
const now = new Date().toISOString();
function seed(uid, suffix, note) {
  const id = `00000000-0000-4000-9000-${suffix}`;
  rows.set(id, {
    id, owner_id: uid, occurred_at: now, occurred_tz: "Asia/Seoul",
    recorded_at: now, recorded_tz: "Asia/Seoul", source: "direct",
    burden: "heavy", tags: [], note, created_at: now, updated_at: now, version: 1,
  });
}
seed(A, "00000000000a", "가상 A 기록");
seed(B, "00000000000b", "가상 B 기록");
const token = (uid) => `e30.${btoa(JSON.stringify({ sub: uid }))}.fake`;
const subject = (jwt) => JSON.parse(atob(jwt.split(".")[1])).sub;
export const fixture = {
  A, B, uid: A, failure: null, staleRun: null,
  switchUser(uid) {
    this.uid = uid;
    const session = uid ? { user: { id: uid }, access_token: token(uid) } : null;
    for (const fn of listeners) fn(uid ? "SIGNED_IN" : "SIGNED_OUT", session);
  },
  hold(operation) {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    gates.set(operation, { promise, release, started: false });
  },
  release(operation) {
    gates.get(operation)?.release();
    gates.delete(operation);
  },
  started(operation) { return gates.get(operation)?.started === true; },
  snapshot() { return { rows: [...rows.values()], calls: [...calls] }; },
  setConsent(uid, granted) { consents.set(uid, granted); },
  mount(screen) {
    if (screen === "callback") { root.render(<CallbackConfirmation />); return; }
    root.render(<AuthScope><Probe /><React.Fragment key={++screenGeneration}>{screen === "records" ? <RecordList /> : screen === "consent" ? <ConsentForm next="/consent-done" /> : screen === "account" ? <AccountDeletion enabled /> : <CheckinForm />}</React.Fragment></AuthScope>);
  },
  async runStale() {
    return this.staleRun((client) => client.rpc("create_checkin", {
      p_id: "00000000-0000-4000-9000-000000000099", p_burden: "heavy",
      p_tags: [], p_note: "가상 A 잔존 입력", p_occurred_at: now,
      p_occurred_tz: "Asia/Seoul", p_recorded_at: now,
      p_recorded_tz: "Asia/Seoul", p_source: "direct",
    }));
  },
};
async function waitGate(operation) {
  const gate = gates.get(operation);
  if (gate) { gate.started = true; await gate.promise; }
}
function clientFor(uid) {
  return {
    async rpc(fn, params) {
      calls.push({ operation: fn, uid, id: params.p_id });
      let response;
      const existing = rows.get(params.p_id);
      if (fn === "create_checkin") {
        if (existing && existing.owner_id !== uid) return { data: null, error: { code: "23505", message: "id_unavailable" } };
        if (!existing) rows.set(params.p_id, {
          id: params.p_id, owner_id: uid, occurred_at: params.p_occurred_at,
          occurred_tz: params.p_occurred_tz, recorded_at: params.p_recorded_at,
          recorded_tz: params.p_recorded_tz, source: params.p_source,
          burden: params.p_burden, tags: params.p_tags, note: params.p_note,
          created_at: now, updated_at: now, version: 1,
        });
        response = { created: !existing, record: { ...rows.get(params.p_id) } };
      } else if (!existing || existing.owner_id !== uid) {
        response = { status: "not_found", record: null };
      } else if (existing.version !== params.p_expected_version) {
        response = { status: "conflict", record: { ...existing } };
      } else if (fn === "update_checkin") {
        const next = { ...existing, burden: params.p_burden, tags: params.p_tags, note: params.p_note, version: existing.version + 1 };
        rows.set(next.id, next);
        response = { status: "ok", record: next };
      } else {
        rows.delete(params.p_id);
        response = { status: "ok", record: null };
      }
      await waitGate(fn);
      if (fixture.failure === "lost_response") { fixture.failure = null; throw new Error("fake network failure after save"); }
      return { data: response, error: null };
    },
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; },
        async limit() {
          calls.push({ operation: table, uid });
          const data = table === "consents" ? (consents.get(uid) !== false ? [{ id: "fake-consent" }] : []) : [...rows.values()].filter((r) => r.owner_id === uid).map((r) => ({ ...r }));
          await waitGate(table);
          if (table === "consents" && fixture.failure === "consent_query_error") return { data: null, error: { message: "fake consent query failure" } };
          return { data, error: null };
        },
        async insert() {
          calls.push({ operation: "grant_consent", uid });
          if (fixture.failure === "consent_write_error") return { error: { message: "fake consent write failure" } };
          consents.set(uid, true);
          await waitGate("grant_consent");
          return { error: null };
        },
      };
      return query;
    },
  };
}
const browserClient = {
  from(table) { return clientFor(fixture.uid).from(table); },
  auth: {
    async getUser(jwt) {
      const uid = subject(jwt);
      return { data: { user: { id: uid, email: uid === A ? "a@example.invalid" : "b@example.invalid" } }, error: null };
    },
    async getSession() {
      if (fixture.failure === "session_error") throw new Error("fake session failure");
      const uid = fixture.uid;
      return { data: { session: uid ? { user: { id: uid }, access_token: token(fixture.failure === "bad_token" ? B : uid) } : null }, error: null };
    },
    onAuthStateChange(fn) {
      listeners.add(fn);
      return { data: { subscription: { unsubscribe() { listeners.delete(fn); } } } };
    },
  },
};
export function getBrowserClient() { return browserClient; }
export async function clearDeletedAccountSession(uid) {
  calls.push({ operation: "cleanup_deleted_session", uid });
  return fixture.failure === "cleanup_failed" ? "unverified" : fixture.uid === uid ? "cleared" : "changed";
}
export function pinnedClient(jwt) {
  if (fixture.failure === "request_error") throw new Error("fake client setup failure");
  return clientFor(subject(jwt));
}
function Probe() {
  const run = useScopedRequest();
  if (!fixture.staleRun) fixture.staleRun = run;
  return null;
}
const root = createRoot(document.getElementById("root"));
window.__fixture = fixture;
fixture.writeSyntheticSession = uid => withSessionCookieLock("sb-synthetic-auth-token", () => {
  document.cookie = serializeCookieHeader("sb-synthetic-auth-token", "base64-" + stringToBase64URL(JSON.stringify({ user: { id: uid }, access_token: token(uid) })), { path: "/" });
});
fixture.clearSyntheticSession = uid => clearDeletedBrowserSession("https://synthetic.supabase.co", uid);
// 실제 SSR 쿠키 어댑터 + 설치 인증 SDK. 네트워크는 제어 응답으로 완전히 대체한다.
fixture.beginRefreshCookieRace = async () => {
  const cookie = "sb-refresh-fixture-auth-token";
  const make = (uid, expired = false) => ({
    user: { id: uid, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: now },
    access_token: token(uid), refresh_token: `synthetic-refresh-${uid}`,
    token_type: "bearer", expires_in: 3600, expires_at: expired ? 1 : Math.floor(Date.now() / 1000) + 3600,
  });
  const write = uid => withSessionCookieLock(cookie, () => {
    document.cookie = serializeCookieHeader(cookie, "base64-" + stringToBase64URL(JSON.stringify(make(uid, uid === B))), { path: "/" });
  });
  await write(A);
  let release;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  const sdk = createBrowserClient("https://refresh-fixture.supabase.co", "synthetic-public-key", {
    isSingleton: false,
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    cookies: {
      getAll: () => parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? "" })),
      setAll: cookies => withSessionCookieLock(cookie, () => {
        cookies.forEach(({ name, value, options }) => { document.cookie = serializeCookieHeader(name, value, options); });
      }),
    },
    global: { fetch: async url => {
      if (!String(url).startsWith("https://refresh-fixture.supabase.co/auth/v1/token?")) throw new Error("unexpected_synthetic_request");
      started();
      return response;
    } },
  });
  enableTestRefreshGuard(sdk.auth);
  const events = [];
  sdk.auth.onAuthStateChange(event => { events.push(event); });
  const pending = sdk.auth.refreshSession({ refresh_token: make(A).refresh_token });
  await began;
  fixture.writeExpiredRefreshB = () => write(B);
  fixture.finishRefreshCookieRace = async () => {
    release(new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic rejection" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const result = await pending;
    const entry = parseCookieHeader(document.cookie).find(c => c.name === cookie);
    const uid = entry ? JSON.parse(stringFromBase64URL(entry.value.slice(7))).user.id : null;
    return { rejected: !!result.error, remainingUid: uid, signedOut: events.includes("SIGNED_OUT") };
  };
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  if (String(url).startsWith("https://synthetic.supabase.co/auth/v1/token?grant_type=pkce")) {
    calls.push({ operation: "callback_exchange" });
    await waitGate("callback_exchange");
    if (fixture.failure === "callback_error") return new Response(JSON.stringify({ message: "Synthetic expired link" }), { status: 400, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ user: { id: A, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: now }, access_token: token(A), refresh_token: "synthetic-callback-refresh", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url !== "/api/account/delete") return originalFetch(url, options);
  // 보호된 Preview는 인증 쿠키가 빠진 요청을 앱 API에 전달하지 않는다.
  if (options.credentials !== "same-origin") return new Response(JSON.stringify({ error: { code: "401" } }), { status: 401 });
  const uid = subject(options.headers.Authorization.slice(7));
  const body = JSON.parse(options.body);
  calls.push({ operation: "delete_account", uid, expectedUid: body.expectedUid });
  const reason = fixture.failure === "delete_wrong_password" ? "wrong_password" : fixture.failure === "delete_uncertain" ? "uncertain" : "deleted";
  if (reason === "deleted") for (const [id, row] of rows) if (row.owner_id === uid) rows.delete(id);
  await waitGate("delete_account");
  return new Response(JSON.stringify({ reason }), { status: reason === "deleted" ? 200 : 503 });
};
const initialScreen = new URLSearchParams(location.search).get("screen") ?? "form";
if (initialScreen === "consent") { consents.set(A, false); consents.set(B, false); }
fixture.mount(initialScreen);
