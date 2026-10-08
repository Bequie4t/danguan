// 계정 전환 보호 시험. 가상 데이터만 쓴다. 실행: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionGuard, guardedRequest, ownedBy, type SessionGuard } from "../src/lib/session/guard";
import { buildCreateParams, newDraft, type Checkin, type CreateCheckinParams } from "../src/lib/checkins/model";
import { createCheckin, updateCheckin, deleteCheckin, type RecordsClient } from "../src/lib/checkins/api";
import { formReducer, initialFormState } from "../src/lib/checkins/formState";

const NOW = new Date("2026-10-08T13:00:00.000Z");
let n = 0;
const fakeId = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** 화면 한 개를 흉내: 보호 범위 + "지금 실제 세션 사용자" + 화면이 열려 있는지 */
function screen(uid: string | null) {
  const guard = createSessionGuard(null);
  guard.setUser(uid);
  const s = { guard, session: uid as string | null, mounted: true };
  const run = <T,>(send: () => Promise<T>) =>
    guardedRequest({ guard, getSessionUid: async () => s.session, isMounted: () => s.mounted, send });
  /** 다른 탭·이 탭에서 계정이 바뀐 상황: 실제 세션이 먼저 바뀌고, 화면은 알림을 받는다 */
  const switchTo = (next: string | null) => {
    s.session = next;
    guard.setUser(next);
  };
  return { ...s, get state() { return s; }, run, switchTo };
}

/** 계정별로 기록을 나눠 갖는 가상 서버. 요청은 "보낸 순간의 세션 계정"으로 처리된다. */
function fakeServer(getSession: () => string | null) {
  const rows = new Map<string, Checkin>();
  const sent: { fn: string; as: string | null; args: Record<string, unknown> }[] = [];
  let failNext = 0;
  const client: RecordsClient = {
    async rpc(fn, args) {
      const as = getSession();
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
        const next = { ...cur, burden: args.p_burden as Checkin["burden"], note: args.p_note as string | null, version: cur.version + 1 };
        rows.set(cur.id, next);
        return { data: { status: "ok", record: next }, error: null };
      }
      rows.delete(cur.id);
      return { data: { status: "ok", record: null }, error: null };
    },
    from() { throw new Error("not used"); },
  };
  return { client, rows, sent, failOnce: () => { failNext = 1; } };
}

const sampleParams = (id: string, note: string): CreateCheckinParams => {
  const b = buildCreateParams({ ...newDraft(() => id), burden: "heavy", note }, NOW, "Asia/Seoul");
  assert.ok(b.ok);
  return b.params;
};

// ---------------------------------------------------------------------------
// 1. 계정 A → B 전환
// ---------------------------------------------------------------------------

test("A→B: A의 늦은 조회 응답은 B 화면에 반영되지 않고, B의 조회는 반영된다", async () => {
  const sc = screen("user-a");
  const slow = deferred<string[]>();
  let shown: string[] | null = null;

  const loadingA = sc.run(() => slow.promise).then((r) => { if (r.ok) shown = r.value; return r; });
  await Promise.resolve(); // A 요청이 보내진 뒤
  sc.switchTo("user-b");
  slow.resolve(["A의 가상 기록"]);
  const ra = await loadingA;
  assert.equal(ra.ok, false);
  if (!ra.ok) assert.equal(ra.reason, "account_changed");
  assert.equal(shown, null, "A의 기록이 B 화면에 보이지 않음");

  const rb = await sc.run(async () => ["B의 가상 기록"]);
  assert.equal(rb.ok, true);
  if (rb.ok) assert.equal(rb.ticket.uid, "user-b");
});

test("A→B: A에서 시작한 동의 확인 결과는 B 화면에 반영되지 않는다", async () => {
  const sc = screen("user-a");
  const slow = deferred<"granted" | "missing">();
  let consent: string = "loading";
  const p = sc.run(() => slow.promise).then((r) => { if (r.ok) consent = r.value; });
  await Promise.resolve();
  sc.switchTo("user-b");
  slow.resolve("granted"); // A는 동의했지만
  await p;
  assert.equal(consent, "loading", "B 화면에 A의 동의 상태가 넘어가지 않음");
});

test("A→B: A의 저장·수정·삭제 응답이 늦게 와도 B 화면에 반영되지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer(() => sc.state.session);
  const id = fakeId();
  await createCheckin(server.client, sampleParams(id, "A의 가상 메모"));

  // 응답이 늦게 오도록 요청을 붙잡아 둔다
  const gate = deferred<void>();
  const late = <T,>(f: () => Promise<T>) => async () => { const v = await f(); await gate.promise; return v; };

  const upd = sc.run(late(() => updateCheckin(server.client, { id, expectedVersion: 1, burden: "okay", tags: [], note: "A 수정" })));
  const del = sc.run(late(() => deleteCheckin(server.client, { id, expectedVersion: 2 })));
  const cre = sc.run(late(() => createCheckin(server.client, sampleParams(fakeId(), "A 새 기록"))));
  await new Promise((r) => setTimeout(r, 0));
  sc.switchTo("user-b");
  gate.resolve();

  for (const r of await Promise.all([upd, del, cre])) {
    assert.equal(r.ok, false, "B 화면에는 반영하지 않음");
  }
});

// ---------------------------------------------------------------------------
// 2. 요청 전 계정 확인: 이전 계정의 입력·재시도 요청을 새 계정으로 보내지 않음
// ---------------------------------------------------------------------------

test("화면은 아직 A인데 실제 세션이 B로 바뀌었다면, A 화면의 재시도 요청은 보내지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer(() => sc.state.session);
  const params = sampleParams(fakeId(), "A의 가상 메모");

  // 다른 탭에서 B로 로그인: 실제 세션만 먼저 바뀌고 이 화면은 아직 알림을 못 받음
  sc.state.session = "user-b";
  const before = server.sent.length;
  const r = await sc.run(() => createCheckin(server.client, params));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "account_changed");
  assert.equal(server.sent.length, before, "요청을 보내지 않음");
  assert.equal(server.rows.size, 0, "B 계정에 A의 입력이 저장되지 않음");
  assert.equal(sc.guard.uid, "user-b", "화면에 계정 변경을 알림 → AuthScope가 화면을 새로 만든다");
});

test("A의 저장 실패 뒤 B로 바뀌면 B 화면은 빈 입력·새 ID에서 시작한다 (재시도 요청 이월 없음)", async () => {
  const sc = screen("user-a");
  const server = fakeServer(() => sc.state.session);
  server.failOnce();

  let formA = initialFormState({ ...newDraft(fakeId), burden: "heavy" as const, note: "A의 가상 메모" });
  const params = buildCreateParams(formA.draft, NOW, "Asia/Seoul");
  assert.ok(params.ok);
  formA = formReducer(formA, { type: "submitStart" });
  const r1 = await sc.run(() => createCheckin(server.client, params.params));
  assert.ok(r1.ok && r1.value.kind === "error");
  formA = formReducer(formA, { type: "submitFail", reason: "network" });

  sc.switchTo("user-b");
  // AuthScope는 사용자·세대를 key로 화면을 새로 만든다 → CheckinForm 상태가 처음부터
  const formB = initialFormState(newDraft(fakeId));
  assert.equal(formB.draft.note, "");
  assert.notEqual(formB.draft.id, formA.draft.id);
  assert.equal(formB.lastSaved, null);

  // 혹시 A 화면 객체가 남아 재시도해도 보내지지 않는다
  const before = server.sent.length;
  const stale = await guardedRequest({ guard: createStaleGuardFor("user-a"), getSessionUid: async () => sc.state.session, isMounted: () => true, send: () => createCheckin(server.client, params.params) });
  assert.equal(stale.ok, false);
  assert.equal(server.sent.length, before);
  assert.equal(server.rows.size, 0);
});

function createStaleGuardFor(uid: string): SessionGuard {
  const g = createSessionGuard(null);
  g.setUser(uid);
  return g;
}

// ---------------------------------------------------------------------------
// 3. 로그아웃
// ---------------------------------------------------------------------------

test("로그아웃 중 도착한 응답은 반영하지 않고, 로그아웃 상태에서는 요청을 보내지 않는다", async () => {
  const sc = screen("user-a");
  const server = fakeServer(() => sc.state.session);
  const slow = deferred<string[]>();
  const p = sc.run(() => slow.promise);
  await Promise.resolve();
  sc.switchTo(null);
  slow.resolve(["A의 가상 기록"]);
  const r = await p;
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "signed_out");

  const before = server.sent.length;
  const r2 = await sc.run(() => createCheckin(server.client, sampleParams(fakeId(), "x")));
  assert.equal(r2.ok, false);
  assert.equal(server.sent.length, before);
});

test("같은 A가 로그아웃 후 다시 로그인해도 이전 세대 응답은 버린다", async () => {
  const sc = screen("user-a");
  const slow = deferred<number>();
  const p = sc.run(() => slow.promise);
  await Promise.resolve();
  sc.switchTo(null);
  sc.switchTo("user-a");
  slow.resolve(1);
  assert.equal((await p).ok, false);
  assert.equal((await sc.run(async () => 2)).ok, true, "새 세대의 요청은 반영");
});

// ---------------------------------------------------------------------------
// 4. 같은 계정의 일시적 실패: 입력과 재시도 ID 유지
// ---------------------------------------------------------------------------

test("같은 계정의 일시적 저장 실패: 실패 결과는 반영되고 입력·ID를 유지, 재시도하면 같은 ID로 1개만", async () => {
  const sc = screen("user-a");
  const server = fakeServer(() => sc.state.session);
  server.failOnce();

  let form = initialFormState({ ...newDraft(fakeId), burden: "bearable" as const, note: "가상 메모" });
  const id = form.draft.id;
  const params = buildCreateParams(form.draft, NOW, "Asia/Seoul");
  assert.ok(params.ok);

  form = formReducer(form, { type: "submitStart" });
  const r1 = await sc.run(() => createCheckin(server.client, params.params));
  assert.equal(r1.ok, true, "같은 계정이므로 실패 결과는 화면에 반영");
  assert.ok(r1.ok && r1.value.kind === "error");
  form = formReducer(form, { type: "submitFail", reason: "network" });
  assert.equal(form.status, "failed");
  assert.equal(form.draft.id, id);
  assert.equal(form.draft.note, "가상 메모");

  form = formReducer(form, { type: "submitStart" });
  const r2 = await sc.run(() => createCheckin(server.client, params.params));
  assert.ok(r2.ok && r2.value.kind === "saved");
  if (r2.ok && r2.value.kind === "saved") {
    assert.equal(r2.value.record.id, id);
    form = formReducer(form, { type: "submitSuccess", record: r2.value.record, nextId: fakeId() });
  }
  assert.equal(form.status, "saved");
  assert.equal(server.rows.size, 1);
  assert.deepEqual(server.sent.map((s) => s.as), ["user-a", "user-a"], "두 번 모두 A 계정으로만 보냄");
});

// ---------------------------------------------------------------------------
// 5. 화면이 닫힌 뒤 도착한 응답
// ---------------------------------------------------------------------------

test("화면이 닫힌 뒤 도착한 응답은 버리고, 닫힌 화면에서는 요청을 보내지 않는다", async () => {
  const sc = screen("user-a");
  const slow = deferred<number>();
  const p = sc.run(() => slow.promise);
  await Promise.resolve();
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

test("보호 범위를 폐기하면(AuthScope 정리) 이전 표는 모두 무효", () => {
  const g = createSessionGuard(null);
  g.setUser("user-a");
  const t = g.ticket();
  assert.equal(g.isCurrent(t), true);
  g.dispose();
  assert.equal(g.isCurrent(t), false);
  assert.equal(g.isCurrent(g.ticket()), false);
  assert.equal(g.setUser("user-b"), false, "폐기 후에는 바뀌지 않음");
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
  const server = fakeServer(() => sc.state.session);
  const id = fakeId();
  const r = await sc.run(() => createCheckin(server.client, sampleParams(id, "A의 가상 메모")));
  assert.ok(r.ok);
  sc.switchTo("user-b");
  sc.switchTo(null);
  assert.equal(server.rows.has(id), true);
  assert.equal(server.sent.filter((s) => s.fn === "delete_checkin").length, 0);
});
