// 계정 전환 보호 시험. 가상 데이터만 쓴다. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionGuard,
  guardedRequest,
  ownedBy,
  tokenSubject,
  type SessionAuth,
  type SessionGuard,
} from "../src/lib/session/guard";
import { buildCreateParams, newDraft, type Checkin, type CreateCheckinParams } from "../src/lib/checkins/model";
import { createCheckin, updateCheckin, deleteCheckin, type RecordsClient } from "../src/lib/checkins/api";
import { formReducer, initialFormState } from "../src/lib/checkins/formState";
import { saveDraft } from "../src/lib/checkins/saveFlow";

const NOW = new Date("2026-10-08T13:00:00.000Z");
let n = 0;
const fakeId = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;

/** 가상 액세스 토큰 (JWT 모양, 서명 없음). 실제 토큰이 아니다. */
function fakeToken(uid: string, tag = "t"): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ sub: uid, tag })}.sig`;
}
const authOf = (uid: string | null): SessionAuth | null => (uid ? { uid, accessToken: fakeToken(uid) } : null);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * 계정별로 기록을 나눠 갖는 가상 서버.
 * 실제 서버처럼, 요청을 누구 것으로 처리할지는 "그 요청에 실린 토큰"으로 정한다.
 */
function fakeServer() {
  const rows = new Map<string, Checkin>();
  const sent: { fn: string; as: string | null; args: Record<string, unknown> }[] = [];
  let failNext = 0;
  const clientFor = (token: string): RecordsClient => ({
    async rpc(fn, args) {
      const as = tokenSubject(token);
      sent.push({ fn, as, args: { ...args } });
      if (failNext > 0) { failNext--; throw new TypeError("Failed to fetch"); }
      if (!as) return { data: null, error: { code: "28000", message: "not_authenticated" } };
      if (fn === "create_checkin") {
        const p = args as unknown as CreateCheckinParams;
        const cur = rows.get(p.p_id);
        if (cur && cur.owner_id !== as) return { data: null, error: { code: "23505", message: "id_unavailable" } };
        if (!cur) {
          rows.set(p.p_id, {
            id: p.p_id, owner_id: as, occurred_at: p.p_occurred_at, occurred_tz: p.p_occurred_tz,
            recorded_at: p.p_recorded_at, recorded_tz: p.p_recorded_tz, source: p.p_source, burden: p.p_burden,
            tags: p.p_tags, note: p.p_note, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), version: 1,
          });
        }
        return { data: { created: !cur, record: rows.get(p.p_id) }, error: null };
      }
      const cur = rows.get(args.p_id as string);
      if (!cur || cur.owner_id !== as) return { data: { status: "not_found", record: null }, error: null };
      if (cur.version !== args.p_expected_version) return { data: { status: "conflict", record: cur }, error: null };
      if (fn === "update_checkin") {
        const next = { ...cur, burden: args.p_burden as Checkin["burden"], tags: (args.p_tags ?? []) as Checkin["tags"], note: args.p_note as string | null, version: cur.version + 1 };
        rows.set(cur.id, next);
        return { data: { status: "ok", record: next }, error: null };
      }
      rows.delete(cur.id);
      return { data: { status: "ok", record: null }, error: null };
    },
    from() { throw new Error("not used"); },
  });
  return { clientFor, rows, sent, failOnce: () => { failNext = 1; } };
}

/** 화면 한 개를 흉내: 보호 범위 + "지금 실제 세션" + 화면이 열려 있는지 */
function screen(uid: string | null) {
  const guard = createSessionGuard(null);
  guard.setUser(uid);
  const s = { session: uid as string | null, mounted: true, sessionDelay: null as Promise<void> | null };
  const run = <T,>(send: (auth: SessionAuth) => Promise<T>) =>
    guardedRequest({
      guard,
      getSessionAuth: async () => {
        const seen = s.session; // 확인을 시작한 순간의 세션
        if (s.sessionDelay) await s.sessionDelay;
        return authOf(seen);
      },
      isMounted: () => s.mounted,
      send,
    });
  /** 계정 변경: 실제 세션이 바뀌고, 화면은 인증 이벤트로 알림을 받는다 */
  const switchTo = (next: string | null) => {
    s.session = next;
    guard.setUser(next);
  };
  return { guard, state: s, run, switchTo };
}

const sampleParams = (id: string, note: string): CreateCheckinParams => {
  const b = buildCreateParams({ ...newDraft(() => id), burden: "heavy", note }, NOW, "Asia/Seoul");
  assert.ok(b.ok);
  return b.params;
};

// ---------------------------------------------------------------------------
// 검토 지적 1: 늦은 계정 확인이 현재 계정을 되돌림 (회귀 시험)
// ---------------------------------------------------------------------------

test("[회귀] A 계정 확인 중 B로 전환 → 늦게 온 A 확인 결과가 보호 상태를 A로 되돌리지 않는다", async () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  const late = deferred<SessionAuth | null>();
  let sent = false;
  const p = guardedRequest({ guard: g, getSessionAuth: () => late.promise, isMounted: () => true, send: async () => { sent = true; return 1; } });
  g.setUser("user-b"); // B로 전환 (인증 이벤트)
  const genB = g.generation;
  late.resolve(authOf("user-a")); // 늦게 도착한 A 확인 결과
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(g.uid, "user-b", "보호 상태는 B 그대로");
  assert.equal(g.generation, genB, "세대도 그대로 (화면을 다시 만들지 않음)");
  assert.equal(sent, false, "A의 요청은 보내지 않음");
});

test("[회귀] 확인 중 로그아웃 → 늦게 온 A 확인 결과가 로그아웃 상태를 되돌리지 않는다", async () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  const late = deferred<SessionAuth | null>();
  let sent = false;
  const p = guardedRequest({ guard: g, getSessionAuth: () => late.promise, isMounted: () => true, send: async () => { sent = true; return 1; } });
  g.setUser(null);
  const genOut = g.generation;
  late.resolve(authOf("user-a"));
  assert.equal((await p).ok, false);
  assert.equal(g.uid, null, "로그아웃 상태 그대로");
  assert.equal(g.generation, genOut, "세대도 그대로");
  assert.equal(sent, false, "로그아웃 뒤에는 늦게 온 A 확인 결과로 요청을 보내지 않음");
});

test("[회귀] AuthScope 처음 세션 조회: 결과가 오기 전에 B 로그인 이벤트가 먼저 반영되면 늦은 A 결과는 버린다", () => {
  // AuthScope와 같은 순서: 시작 세대를 기억 → (이벤트) → 늦은 조회 결과는 setUserIfCurrent로만 반영
  const g = createSessionGuard(null);
  const startGeneration = g.generation;
  g.setUser("user-b"); // onAuthStateChange
  const applied = g.setUserIfCurrent("user-a", startGeneration); // 늦게 도착한 처음 조회 결과
  assert.equal(applied, false);
  assert.equal(g.uid, "user-b");
});

test("AuthScope 처음 세션 조회: 이벤트가 없었다면 조회 결과를 반영한다", () => {
  const g = createSessionGuard(null);
  const startGeneration = g.generation;
  assert.equal(g.setUserIfCurrent("user-a", startGeneration), true);
  assert.equal(g.uid, "user-a");
});

test("화면은 아직 A인데 실제 세션이 B(알림 전)면: 보내지 않고, 확인 시작 세대가 그대로일 때만 화면에 B를 알린다", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  sc.state.session = "user-b"; // 다른 탭에서 B 로그인, 이 화면은 아직 이벤트를 못 받음
  const r = await sc.run((auth) => createCheckin(server.clientFor(auth.accessToken), sampleParams(fakeId(), "A의 가상 메모")));
  assert.equal(r.ok, false);
  assert.equal(server.sent.length, 0, "요청을 보내지 않음");
  assert.equal(sc.guard.uid, "user-b", "화면에 계정 변경을 알림 → AuthScope가 화면을 새로 만든다");
});

// ---------------------------------------------------------------------------
// 검토 지적 2: 요청을 보내는 순간의 계정 보호 (인증 고정)
// ---------------------------------------------------------------------------

test("[회귀] 계정 확인 직후 A→B 전환: 저장 요청은 A의 인증으로만 실행되고 B 계정에는 아무것도 저장되지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  const params = sampleParams(fakeId(), "A의 가상 메모");

  const r = await sc.run(async (auth) => {
    // 확인은 끝났고 요청을 보내기 직전에 B로 바뀜
    sc.switchTo("user-b");
    // 요청은 확인 시점에 고정된 A의 토큰으로 나간다 (브라우저의 현재 세션을 다시 읽지 않는다)
    return createCheckin(server.clientFor(auth.accessToken), params);
  });

  assert.deepEqual(server.sent.map((s) => s.as), ["user-a"], "서버는 A의 요청으로 처리");
  assert.equal(server.rows.get(params.p_id)?.owner_id, "user-a");
  assert.equal([...server.rows.values()].filter((x) => x.owner_id === "user-b").length, 0, "B 계정에는 저장 없음");
  assert.equal(r.ok, false, "B 화면에는 A의 결과를 반영하지 않음");
});

test("[회귀] 계정 확인 직후 A→B 전환: 수정·삭제도 A의 인증으로만 실행된다 (B의 기록을 건드리지 않음)", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  const aId = fakeId();
  await createCheckin(server.clientFor(fakeToken("user-a")), sampleParams(aId, "A 기록"));
  const bId = fakeId();
  await createCheckin(server.clientFor(fakeToken("user-b")), sampleParams(bId, "B 기록"));

  const upd = await sc.run(async (auth) => {
    sc.switchTo("user-b");
    return updateCheckin(server.clientFor(auth.accessToken), { id: aId, expectedVersion: 1, burden: "okay", tags: [], note: "A 수정" });
  });
  assert.equal(upd.ok, false);
  assert.equal(server.sent.at(-1)?.as, "user-a");
  assert.equal(server.rows.get(bId)?.note, "B 기록", "B 기록은 그대로");

  sc.switchTo("user-a");
  const del = await sc.run(async (auth) => {
    sc.switchTo("user-b");
    return deleteCheckin(server.clientFor(auth.accessToken), { id: bId, expectedVersion: 1 });
  });
  assert.equal(del.ok, false);
  assert.equal(server.sent.at(-1)?.as, "user-a");
  assert.equal(server.rows.has(bId), true, "A의 인증으로는 B 기록을 지울 수 없음");
});

test("토큰의 사용자(sub)가 화면 계정과 다르면 보내지 않는다", async () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  let sent = false;
  const r = await guardedRequest({
    guard: g,
    getSessionAuth: async () => ({ uid: "user-a", accessToken: fakeToken("user-b") }),
    isMounted: () => true,
    send: async () => { sent = true; return 1; },
  });
  assert.equal(r.ok, false);
  assert.equal(sent, false);
});

test("tokenSubject: JWT 모양에서 sub를 읽고, 형식이 틀리면 null", () => {
  assert.equal(tokenSubject(fakeToken("user-a")), "user-a");
  assert.equal(tokenSubject("not-a-token"), null);
  assert.equal(tokenSubject("a.!!!.c"), null);
});

// ---------------------------------------------------------------------------
// 계정 A → B 전환: 늦은 응답
// ---------------------------------------------------------------------------

test("A→B: A의 늦은 조회 응답은 B 화면에 반영되지 않고, B의 조회는 반영된다", async () => {
  const sc = screen("user-a");
  const slow = deferred<string[]>();
  let shown: string[] | null = null;
  const loadingA = sc.run(() => slow.promise).then((r) => { if (r.ok) shown = r.value; return r; });
  await tick();
  sc.switchTo("user-b");
  slow.resolve(["A의 가상 기록"]);
  const ra = await loadingA;
  assert.equal(ra.ok, false);
  assert.equal(shown, null);
  const rb = await sc.run(async () => ["B의 가상 기록"]);
  assert.equal(rb.ok, true);
  if (rb.ok) assert.equal(rb.ticket.uid, "user-b");
});

test("A→B: A에서 시작한 동의 확인 결과는 B 화면에 반영되지 않는다", async () => {
  const sc = screen("user-a");
  const slow = deferred<"granted" | "missing">();
  let consent = "loading";
  const p = sc.run(() => slow.promise).then((r) => { if (r.ok) consent = r.value; });
  await tick();
  sc.switchTo("user-b");
  slow.resolve("granted");
  await p;
  assert.equal(consent, "loading");
});

test("A→B: A의 저장·수정·삭제 응답이 늦게 와도 B 화면에 반영되지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  const id = fakeId();
  await createCheckin(server.clientFor(fakeToken("user-a")), sampleParams(id, "A의 가상 메모"));
  const gate = deferred<void>();
  const late = <T,>(f: (auth: SessionAuth) => Promise<T>) => async (auth: SessionAuth) => { const v = await f(auth); await gate.promise; return v; };
  const upd = sc.run(late((a) => updateCheckin(server.clientFor(a.accessToken), { id, expectedVersion: 1, burden: "okay", tags: [], note: "A 수정" })));
  const del = sc.run(late((a) => deleteCheckin(server.clientFor(a.accessToken), { id, expectedVersion: 2 })));
  const cre = sc.run(late((a) => createCheckin(server.clientFor(a.accessToken), sampleParams(fakeId(), "A 새 기록"))));
  await tick();
  sc.switchTo("user-b");
  gate.resolve();
  for (const r of await Promise.all([upd, del, cre])) assert.equal(r.ok, false);
});

test("A의 저장 실패 뒤 B로 바뀌면: B 화면은 빈 입력·새 ID, A의 재시도 요청은 B로 보내지 않음", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  server.failOnce();
  let formA = initialFormState({ ...newDraft(fakeId), burden: "heavy" as const, note: "A의 가상 메모" });
  const r1 = await sc.run((auth) => saveDraft(server.clientFor(auth.accessToken), formA.draft, null, NOW, "Asia/Seoul"));
  assert.ok(r1.ok && r1.value.kind === "error");
  formA = formReducer(formReducer(formA, { type: "submitStart" }), { type: "submitFail", reason: "network" });
  const pendingA = r1.ok ? r1.value.pending : null;

  sc.switchTo("user-b");
  const formB = initialFormState(newDraft(fakeId)); // AuthScope가 화면을 새로 만든다
  assert.equal(formB.draft.note, "");
  assert.notEqual(formB.draft.id, formA.draft.id);

  // 남아 있던 A 화면이 재시도해도: 보호 범위가 이미 B이므로 보내지 않는다
  const staleGuard: SessionGuard = createSessionGuard(null);
  staleGuard.setUser("user-a");
  const before = server.sent.length;
  const stale = await guardedRequest({
    guard: staleGuard,
    getSessionAuth: async () => authOf(sc.state.session),
    isMounted: () => true,
    send: (auth) => saveDraft(server.clientFor(auth.accessToken), formA.draft, pendingA, NOW, "Asia/Seoul"),
  });
  assert.equal(stale.ok, false);
  assert.equal(server.sent.length, before);
  assert.equal([...server.rows.values()].filter((x) => x.owner_id === "user-b").length, 0);
});

// ---------------------------------------------------------------------------
// 로그아웃
// ---------------------------------------------------------------------------

test("로그아웃 중 도착한 응답은 반영하지 않고, 로그아웃 상태에서는 요청을 보내지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  const slow = deferred<string[]>();
  const p = sc.run(() => slow.promise);
  await tick();
  sc.switchTo(null);
  slow.resolve(["A의 가상 기록"]);
  const r = await p;
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "signed_out");
  const before = server.sent.length;
  const r2 = await sc.run((auth) => createCheckin(server.clientFor(auth.accessToken), sampleParams(fakeId(), "x")));
  assert.equal(r2.ok, false);
  assert.equal(server.sent.length, before);
});

test("같은 A가 로그아웃 후 다시 로그인해도 이전 세대 응답은 버린다", async () => {
  const sc = screen("user-a");
  const slow = deferred<number>();
  const p = sc.run(() => slow.promise);
  await tick();
  sc.switchTo(null);
  sc.switchTo("user-a");
  slow.resolve(1);
  assert.equal((await p).ok, false);
  assert.equal((await sc.run(async () => 2)).ok, true);
});

// ---------------------------------------------------------------------------
// 같은 계정의 일시적 실패: 입력과 재시도 ID 유지 (저장 재확인 흐름 포함)
// ---------------------------------------------------------------------------

test("같은 계정의 일시적 저장 실패: 결과는 반영되고 입력·ID 유지, 재시도하면 같은 ID로 1개만 (A의 인증으로만)", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  server.failOnce();
  let form = initialFormState({ ...newDraft(fakeId), burden: "bearable" as const, note: "가상 메모" });
  const id = form.draft.id;
  form = formReducer(form, { type: "submitStart" });
  const r1 = await sc.run((auth) => saveDraft(server.clientFor(auth.accessToken), form.draft, null, NOW, "Asia/Seoul"));
  assert.equal(r1.ok, true);
  assert.ok(r1.ok && r1.value.kind === "error");
  form = formReducer(form, { type: "submitFail", reason: "network" });
  assert.equal(form.draft.id, id);
  assert.equal(form.draft.note, "가상 메모");

  const pending = r1.ok ? r1.value.pending : null;
  const r2 = await sc.run((auth) => saveDraft(server.clientFor(auth.accessToken), form.draft, pending, NOW, "Asia/Seoul"));
  assert.ok(r2.ok && r2.value.kind === "saved");
  if (r2.ok && r2.value.kind === "saved") assert.equal(r2.value.record.id, id);
  assert.equal(server.rows.size, 1);
  assert.ok(server.sent.every((s) => s.as === "user-a"));
});

// ---------------------------------------------------------------------------
// 화면이 닫힌 뒤
// ---------------------------------------------------------------------------

test("화면이 닫힌 뒤 도착한 응답은 버리고, 닫힌 화면에서는 요청을 보내지 않는다", async () => {
  const sc = screen("user-a");
  const slow = deferred<number>();
  const p = sc.run(() => slow.promise);
  await tick();
  sc.state.mounted = false;
  slow.resolve(1);
  const r = await p;
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "closed");
  let sent = false;
  const r2 = await sc.run(async () => { sent = true; return 1; });
  assert.equal(r2.ok, false);
  assert.equal(sent, false);
});

test("보호 범위를 폐기하면(AuthScope 정리) 이전 표는 모두 무효이고 상태도 바뀌지 않는다", () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  const t = g.ticket();
  g.dispose();
  assert.equal(g.isCurrent(t), false);
  assert.equal(g.setUser("user-b"), false);
  assert.equal(g.setUserIfCurrent("user-b", g.generation), false);
});

// ---------------------------------------------------------------------------
// 기타
// ---------------------------------------------------------------------------

test("서버 응답 기록의 소유자가 요청한 계정이 아니면 반영하지 않는다", () => {
  assert.equal(ownedBy({ owner_id: "user-a" }, { uid: "user-a", generation: 2 }), true);
  assert.equal(ownedBy({ owner_id: "user-b" }, { uid: "user-a", generation: 2 }), false);
  assert.equal(ownedBy({ owner_id: "user-a" }, { uid: null, generation: 2 }), false);
});

test("같은 계정으로 다시 알려도 세대가 바뀌지 않는다 (토큰 갱신 등으로 화면이 비워지지 않음)", () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  const t = g.ticket();
  assert.equal(g.setUser("user-a"), false);
  assert.equal(g.isCurrent(t), true);
});

test("서버에 저장된 기록은 계정 전환으로 지워지지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer();
  const id = fakeId();
  const r = await sc.run((auth) => createCheckin(server.clientFor(auth.accessToken), sampleParams(id, "A의 가상 메모")));
  assert.ok(r.ok);
  sc.switchTo("user-b");
  sc.switchTo(null);
  assert.equal(server.rows.has(id), true);
  assert.equal(server.sent.filter((s) => s.fn === "delete_checkin").length, 0);
});
