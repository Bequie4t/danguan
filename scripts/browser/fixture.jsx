// 브라우저 회귀 시험 전용. 실제 서비스에서 import하지 않는다.
// 인증·DB를 메모리 모의 응답으로 대체하고 실제 React 컴포넌트와 훅을 렌더한다.
import React from "react";
import { createRoot } from "react-dom/client";
import AuthScope, { useAuthScope, useScopedRequest } from "../../src/components/AuthScope";
import CheckinForm from "../../src/components/CheckinForm";
import RecordList from "../../src/components/RecordList";
import ConsentForm from "../../src/components/ConsentForm";
import HomeCheckin from "../../src/components/HomeCheckin";
import HelpPage from "../../src/app/help/page";
import HeaderNav from "../../src/components/HeaderNav";
import AskPage from "../../src/app/ask/page";
import BookingPage from "../../src/app/booking/page";

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
  /** 다른 기기에서 먼저 고친 것처럼 version만 올린다 (시험 전용) */
  touch(id) { const r = rows.get(id); if (r) rows.set(id, { ...r, version: r.version + 1 }); },
  /** 다른 탭에서 지운 것처럼 기록을 없앤다 (시험 전용) */
  removeElsewhere(id) { rows.delete(id); },
  /** 늦게 도착한 저장처럼 기록을 그대로 다시 넣는다 (시험 전용) */
  putRow(row) { rows.set(row.id, { ...row }); },
  /** 다른 탭에서 메모·생활 항목을 더한 것처럼 고친다 (version 증가, 시험 전용) */
  editElsewhere(id, patch) { const r = rows.get(id); if (r) rows.set(id, { ...r, ...patch, version: r.version + 1 }); },
  /** 다른 곳에서 남긴 가상 기록을 더한다 (경험 시점 지정) */
  addRecord(uid, suffix, burden, occurredAt) {
    const id = `00000000-0000-4000-9000-${suffix}`;
    rows.set(id, {
      id, owner_id: uid, occurred_at: occurredAt, occurred_tz: "Asia/Seoul",
      recorded_at: occurredAt, recorded_tz: "Asia/Seoul", source: "direct",
      burden, tags: [], note: null, created_at: now, updated_at: now, version: 1,
    });
    return id;
  },
  mount(screen) {
    // 홈은 자체 AuthScope(로그아웃해도 이동하지 않음)를 가진다.
    if (screen === "home") { root.render(<React.Fragment key={++screenGeneration}><HomeCheckin /></React.Fragment>); return; }
    // 도움 화면은 로그인·저장과 무관: AuthScope 없이 그대로 렌더한다.
    if (screen === "help") { root.render(<React.Fragment key={++screenGeneration}><HelpPage /></React.Fragment>); return; }
    // 도움 버튼(머리글과 같은 data-leave-ok 일반 링크) + 기록 화면: 저장 중·실패에도 도움으로 바로 이동하는지
    if (screen === "form-help") { root.render(<><a href="/help-target" data-leave-ok="">도움이 필요해요</a> <a href="/elsewhere">다른 화면</a><AuthScope><Probe /><React.Fragment key={++screenGeneration}><CheckinForm /></React.Fragment></AuthScope></>); return; }
    // 머리글 메뉴 + 기록 작성 화면 (지금 화면 링크를 다시 눌러도 입력이 남는지)
    if (screen === "today-nav") { root.render(<><HeaderNav /><AuthScope><Probe /><React.Fragment key={++screenGeneration}><CheckinForm /></React.Fragment></AuthScope></>); return; }
    // 부탁하기도 로그인·저장과 무관: AuthScope 없이 렌더한다.
    if (screen === "ask") { root.render(<React.Fragment key={++screenGeneration}><AskPage /></React.Fragment>); return; }
    // 예약 대본도 로그인·저장과 무관
    if (screen === "booking") { root.render(<React.Fragment key={++screenGeneration}><BookingPage /></React.Fragment>); return; }
    root.render(<AuthScope><Probe /><React.Fragment key={++screenGeneration}>{screen === "records" ? <RecordList /> : screen === "consent" ? <ConsentForm next="/consent-done" /> : <CheckinForm />}</React.Fragment></AuthScope>);
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
      let byId = null;
      const query = {
        select() { return query; }, is() { return query; }, order() { return query; },
        eq(column, value) { if (table === "checkins" && column === "id") byId = value; return query; },
        async limit() {
          const operation = byId ? "checkins_by_id" : table;
          calls.push({ operation, uid, id: byId ?? undefined });
          const data = table === "consents" ? (consents.get(uid) !== false ? [{ id: "fake-consent" }] : []) : [...rows.values()].filter((r) => r.owner_id === uid && (!byId || r.id === byId)).map((r) => ({ ...r }));
          await waitGate(operation);
          if (table === "consents" && fixture.failure === "consent_query_error") return { data: null, error: { message: "fake consent query failure" } };
          if (operation === "checkins" && fixture.failure === "list_error") { fixture.failure = null; return { data: null, error: { message: "fake list failure" } }; }
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
  const { uid } = useAuthScope();
  if (!fixture.staleRun) fixture.staleRun = run;
  // 시험이 '지금 화면이 누구 것인지' 기다릴 수 있게 하는 표시 (시험 전용)
  return <span hidden data-scope-uid={uid} />;
}
const root = createRoot(document.getElementById("root"));
window.__fixture = fixture;
const initialScreen = new URLSearchParams(location.search).get("screen") ?? "form";
if (initialScreen === "consent") { consents.set(A, false); consents.set(B, false); }
fixture.mount(initialScreen);
