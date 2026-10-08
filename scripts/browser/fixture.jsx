// 브라우저 회귀 시험 전용. 실제 서비스에서 import하지 않는다.
// 인증·DB를 메모리 모의 응답으로 대체하고 실제 React 컴포넌트와 훅을 렌더한다.
import React from "react";
import { createRoot } from "react-dom/client";
import AuthScope, { useScopedRequest } from "../../src/components/AuthScope";
import CheckinForm from "../../src/components/CheckinForm";
import RecordList from "../../src/components/RecordList";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const listeners = new Set();
const rows = new Map();
const gates = new Map();
const calls = [];
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
  mount(screen) {
    root.render(<AuthScope><Probe />{screen === "records" ? <RecordList /> : <CheckinForm />}</AuthScope>);
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
          const data = table === "consents" ? [{ id: "fake-consent" }] : [...rows.values()].filter((r) => r.owner_id === uid).map((r) => ({ ...r }));
          await waitGate(table);
          return { data, error: null };
        },
      };
      return query;
    },
  };
}
const browserClient = {
  auth: {
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
fixture.mount(new URLSearchParams(location.search).get("screen") ?? "form");
