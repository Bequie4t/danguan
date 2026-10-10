// 가상 데이터로만 테스트한다. 실행: npm test (또는 npx tsx --test tests/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreateParams, newDraft, type Checkin, type CreateCheckinParams, type Draft } from "../src/lib/checkins/model";
import { createCheckin, updateCheckin, deleteCheckin, classifyError, type RecordsClient } from "../src/lib/checkins/api";
import { formReducer, initialFormState } from "../src/lib/checkins/formState";
import { saveDraft, sameContent, timeLocked, type PendingSave } from "../src/lib/checkins/saveFlow";
import { createSessionGuard, ownedBy } from "../src/lib/session/guard";

let n = 0;
const fakeId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const NOW = new Date("2026-10-07T13:00:00.000Z");

function fakeRecord(p: CreateCheckinParams, version = 1): Checkin {
  return {
    id: p.p_id, owner_id: "user-a", occurred_at: p.p_occurred_at, occurred_tz: p.p_occurred_tz,
    recorded_at: p.p_recorded_at, recorded_tz: p.p_recorded_tz, source: p.p_source, burden: p.p_burden,
    tags: p.p_tags, note: p.p_note, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), version,
  };
}

/** 서버 흉내: 같은 ID는 한 번만 저장. failTimes 만큼 먼저 연결 실패를 낸다. */
function fakeServer(opts: { failTimes?: number; lostResponseOnce?: boolean; lostUpdateResponseOnce?: boolean; rejectAuthOnce?: boolean } = {}) {
  const rows = new Map<string, Checkin>();
  let fails = opts.failTimes ?? 0;
  let lose = opts.lostResponseOnce ?? false;
  let loseUpdate = opts.lostUpdateResponseOnce ?? false;
  let rejectAuth = opts.rejectAuthOnce ?? false;
  const calls: string[] = [];
  const sent: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RecordsClient = {
    async rpc(fn, args) {
      calls.push(fn);
      sent.push({ fn, args: { ...args } });
      if (rejectAuth) { rejectAuth = false; return { data: null, error: { code: "28000", message: "not_authenticated" } }; }
      if (fails > 0) { fails--; throw new TypeError("Failed to fetch"); }
      if (fn === "create_checkin") {
        const p = args as unknown as CreateCheckinParams;
        const existing = rows.get(p.p_id);
        if (!existing) rows.set(p.p_id, fakeRecord(p));
        if (lose) { lose = false; throw new TypeError("Failed to fetch"); } // 서버는 저장했지만 응답이 사라짐
        return { data: { created: !existing, record: rows.get(p.p_id) }, error: null };
      }
      if (fn === "update_checkin") {
        const cur = rows.get(args.p_id as string);
        if (!cur) return { data: { status: "not_found", record: null }, error: null };
        if (cur.version !== args.p_expected_version) return { data: { status: "conflict", record: cur }, error: null };
        const next = { ...cur, burden: args.p_burden as Checkin["burden"], tags: (args.p_tags ?? []) as Checkin["tags"], note: args.p_note as string | null, version: cur.version + 1 };
        rows.set(cur.id, next);
        if (loseUpdate) { loseUpdate = false; throw new TypeError("Failed to fetch"); } // 수정은 됐지만 응답이 사라짐
        return { data: { status: "ok", record: next }, error: null };
      }
      if (fn === "delete_checkin") {
        const cur = rows.get(args.p_id as string);
        if (!cur) return { data: { status: "not_found", record: null }, error: null };
        if (cur.version !== args.p_expected_version) return { data: { status: "conflict", record: cur }, error: null };
        rows.delete(cur.id);
        return { data: { status: "ok", record: null }, error: null };
      }
      return { data: null, error: { code: "42883", message: "unknown function" } };
    },
    from() { throw new Error("not used"); },
  };
  return { client, rows, calls, sent };
}

test("버거움 하나만 골라도 저장 요청이 만들어진다 (태그·메모 없음)", () => {
  const d = { ...newDraft(fakeId), burden: "heavy" as const };
  const r = buildCreateParams(d, NOW, "Asia/Seoul");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.params.p_source, "direct");
    assert.deepEqual(r.params.p_tags, []);
    assert.equal(r.params.p_note, null);
    assert.equal(r.params.p_occurred_at, NOW.toISOString());
    assert.equal(r.params.p_recorded_tz, "Asia/Seoul");
  }
});

test("버거움을 고르지 않으면 저장 요청을 만들지 않는다", () => {
  const r = buildCreateParams(newDraft(fakeId), NOW, "Asia/Seoul");
  assert.deepEqual(r, { ok: false, problem: "no_burden" });
});

test("돌아보며 기록: 경험 시점과 입력 시점을 구분하고 출처를 recall로", () => {
  const d = { ...newDraft(fakeId), burden: "very_heavy" as const, recallLocal: "2026-10-05T21:30" };
  const r = buildCreateParams(d, NOW, "Asia/Seoul");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.params.p_source, "recall");
    assert.notEqual(r.params.p_occurred_at, r.params.p_recorded_at);
    assert.equal(r.params.p_recorded_at, NOW.toISOString());
  }
  const future = buildCreateParams({ ...d, recallLocal: "2099-01-01T00:00" }, NOW, "Asia/Seoul");
  assert.deepEqual(future, { ok: false, problem: "recall_in_future" });
});

test("메모 공백은 비우고, 중복 태그는 하나로", () => {
  const d = { ...newDraft(fakeId), burden: "bearable" as const, note: "   ", tags: ["sleep", "sleep", "meal"] as const };
  const r = buildCreateParams({ ...d, tags: [...d.tags] }, NOW, "Asia/Seoul");
  assert.equal(r.ok && r.params.p_note, null);
  assert.deepEqual(r.ok && r.params.p_tags, ["sleep", "meal"]);
});

test("연결 실패 → 입력과 ID 유지, 완료로 표시하지 않음 → 재시도 시 같은 ID로 1개만 생성", async () => {
  const server = fakeServer({ failTimes: 1 });
  let state = initialFormState(newDraft(fakeId));
  state = formReducer(state, { type: "setBurden", burden: "heavy" });
  state = formReducer(state, { type: "toggleTag", tag: "sleep" });
  state = formReducer(state, { type: "setNote", note: "가상 메모" });
  const firstId = state.draft.id;

  const built = buildCreateParams(state.draft, NOW, "Asia/Seoul");
  assert.ok(built.ok);
  state = formReducer(state, { type: "submitStart" });
  assert.equal(state.status, "saving");
  const r1 = await createCheckin(server.client, built.params);
  assert.deepEqual(r1, { kind: "error", reason: "network" });
  state = formReducer(state, { type: "submitFail", reason: r1.kind === "error" ? r1.reason : "unknown" });
  assert.equal(state.status, "failed");
  assert.equal(state.draft.id, firstId);
  assert.equal(state.draft.burden, "heavy");
  assert.deepEqual(state.draft.tags, ["sleep"]);
  assert.equal(state.draft.note, "가상 메모");
  assert.equal(state.lastSaved, null);
  assert.equal(server.rows.size, 0);

  // 다시 저장
  const again = buildCreateParams(state.draft, NOW, "Asia/Seoul");
  assert.ok(again.ok);
  assert.equal(again.params.p_id, firstId);
  state = formReducer(state, { type: "submitStart" });
  const r2 = await createCheckin(server.client, again.params);
  assert.equal(r2.kind, "saved");
  if (r2.kind === "saved") state = formReducer(state, { type: "submitSuccess", record: r2.record, nextId: fakeId() });
  assert.equal(state.status, "saved");
  assert.equal(state.lastSaved?.id, firstId);
  assert.notEqual(state.draft.id, firstId, "다음 기록은 새 ID");
  assert.equal(server.rows.size, 1);
});

test("서버는 저장했지만 응답이 사라진 경우: 재전송해도 중복 없이 기존 기록으로 완료", async () => {
  const server = fakeServer({ lostResponseOnce: true });
  const d = { ...newDraft(fakeId), burden: "okay" as const };
  const built = buildCreateParams(d, NOW, "Asia/Seoul");
  assert.ok(built.ok);
  const r1 = await createCheckin(server.client, built.params);
  assert.equal(r1.kind, "error");
  const r2 = await createCheckin(server.client, built.params);
  assert.equal(r2.kind, "saved");
  if (r2.kind === "saved") assert.equal(r2.created, false);
  assert.equal(server.rows.size, 1);
});

test("저장 중에는 입력이 바뀌지 않고, 다른 기록의 늦은 응답은 무시", () => {
  let state = initialFormState({ ...newDraft(fakeId), burden: "heavy" });
  state = formReducer(state, { type: "submitStart" });
  const before = state.draft;
  state = formReducer(state, { type: "setBurden", burden: "okay" });
  assert.equal(state.draft, before);
  const stale = { ...fakeRecord({ p_id: "other", p_occurred_at: "", p_occurred_tz: "UTC", p_recorded_at: "", p_recorded_tz: "UTC", p_source: "direct", p_burden: "okay", p_tags: [], p_note: null }) };
  state = formReducer(state, { type: "submitSuccess", record: stale, nextId: fakeId() });
  assert.equal(state.status, "saving");
});

test("다른 기기에서 먼저 수정된 기록은 덮어쓰지 않고 conflict", async () => {
  const server = fakeServer();
  const built = buildCreateParams({ ...newDraft(fakeId), burden: "heavy" }, NOW, "Asia/Seoul");
  assert.ok(built.ok);
  await createCheckin(server.client, built.params);
  const id = built.params.p_id;
  const deviceA = await updateCheckin(server.client, { id, expectedVersion: 1, burden: "bearable", tags: [], note: "기기 A" });
  assert.equal(deviceA.kind, "saved");
  const deviceB = await updateCheckin(server.client, { id, expectedVersion: 1, burden: "okay", tags: [], note: "기기 B" });
  assert.equal(deviceB.kind, "conflict");
  if (deviceB.kind === "conflict") assert.equal(deviceB.server.note, "기기 A");
  assert.equal(server.rows.get(id)?.note, "기기 A");

  const staleDelete = await deleteCheckin(server.client, { id, expectedVersion: 1 });
  assert.equal(staleDelete.kind, "conflict");
  assert.equal(server.rows.has(id), true);
  const okDelete = await deleteCheckin(server.client, { id, expectedVersion: 2 });
  assert.equal(okDelete.kind, "deleted");
});

test("오류 분류", () => {
  assert.equal(classifyError({ code: "42501", message: "new row violates row-level security policy" }), "no_consent");
  assert.equal(classifyError({ code: "28000", message: "not_authenticated" }), "signed_out");
  assert.equal(classifyError({ code: "", message: "TypeError: Failed to fetch" }), "network");
  assert.equal(classifyError({ code: "22023", message: "invalid_tag" }), "invalid");
  assert.equal(classifyError({ code: "23505", message: "id_unavailable" }), "id_unavailable");
});

// ---------------------------------------------------------------------------
// 저장 결과가 불확실할 때의 재시도 (saveFlow.ts)
// ---------------------------------------------------------------------------

test("서버 저장 성공 → 응답 유실 → 입력 변경 → 재시도: 원래 내용으로 재확인 후 버전 검사로 수정", async () => {
  const server = fakeServer({ lostResponseOnce: true });
  let draft: Draft = { ...newDraft(fakeId), burden: "heavy", tags: ["sleep"], note: "처음 메모" };

  // 1차: 서버는 저장했지만 응답이 사라짐
  const r1 = await saveDraft(server.client, draft, null, NOW, "Asia/Seoul");
  assert.equal(r1.kind, "error");
  assert.equal(r1.pending?.phase, "uncertain");
  assert.equal(server.rows.get(draft.id)?.note, "처음 메모", "서버에는 이미 저장됨");
  assert.equal(timeLocked(r1.pending), true, "확인 전에는 시점 잠금");

  // 사용자가 입력을 바꿈 (화면 상태에 따로 보존)
  draft = { ...draft, burden: "okay", tags: [], note: "바꾼 메모" };

  // 2차: 재시도
  const r2 = await saveDraft(server.client, draft, r1.pending, NOW, "Asia/Seoul");
  assert.equal(r2.kind, "saved");
  // 재확인 요청은 처음 보낸 내용 그대로
  const recheck = server.sent[1];
  assert.equal(recheck.fn, "create_checkin");
  assert.equal(recheck.args.p_note, "처음 메모");
  assert.equal(recheck.args.p_burden, "heavy");
  // 그 다음 version 1 기준으로 수정
  const upd = server.sent[2];
  assert.equal(upd.fn, "update_checkin");
  assert.equal(upd.args.p_expected_version, 1);
  assert.equal(upd.args.p_note, "바꾼 메모");
  if (r2.kind === "saved") {
    assert.equal(r2.record.note, "바꾼 메모");
    assert.equal(r2.record.burden, "okay");
    assert.equal(r2.record.version, 2);
    assert.ok(sameContent(r2.record, draft), "완료로 표시된 내용 = 사용자가 마지막으로 입력한 내용");
  }
  assert.equal(server.rows.size, 1, "기록은 하나");
  assert.equal(server.rows.get(draft.id)?.note, "바꾼 메모");
});

test("예전 방식(바뀐 입력을 같은 ID로 생성)만 했다면 서버는 처음 내용을 돌려준다 — 그래서 ID만 보고 완료하면 안 됨", async () => {
  const server = fakeServer({ lostResponseOnce: true });
  const d1 = { ...newDraft(fakeId), burden: "heavy" as const, note: "처음 메모" };
  const b1 = buildCreateParams(d1, NOW, "Asia/Seoul");
  assert.ok(b1.ok);
  await createCheckin(server.client, b1.params);
  const d2 = { ...d1, note: "바꾼 메모" };
  const b2 = buildCreateParams(d2, NOW, "Asia/Seoul");
  assert.ok(b2.ok);
  const r = await createCheckin(server.client, b2.params);
  assert.equal(r.kind, "saved");
  if (r.kind === "saved") {
    assert.equal(r.record.id, d2.id, "ID는 같지만");
    assert.equal(r.record.note, "처음 메모", "내용은 처음 것");
    assert.equal(sameContent(r.record, d2), false, "새 흐름은 이 차이를 잡아 수정 단계로 넘어간다");
  }
});

test("처음 요청이 실제로 저장되지 않았던 경우에도 재시도 후 마지막 입력으로 1개만 남는다", async () => {
  const server = fakeServer({ failTimes: 1 });
  let draft = { ...newDraft(fakeId), burden: "heavy" as const, note: "처음" };
  const r1 = await saveDraft(server.client, draft, null, NOW, "Asia/Seoul");
  assert.equal(r1.kind, "error");
  assert.equal(server.rows.size, 0);
  draft = { ...draft, note: "바꿈" };
  const r2 = await saveDraft(server.client, draft, r1.pending, NOW, "Asia/Seoul");
  assert.equal(r2.kind, "saved");
  assert.equal(server.rows.size, 1);
  assert.equal(server.rows.get(draft.id)?.note, "바꿈");
});

test("수정 응답까지 사라진 경우: 다시 시도하면 서버 내용이 이미 내 입력과 같아 완료 (중복 수정 없음)", async () => {
  const server = fakeServer({ lostResponseOnce: true, lostUpdateResponseOnce: true });
  let draft = { ...newDraft(fakeId), burden: "heavy" as const, note: "처음" };
  const r1 = await saveDraft(server.client, draft, null, NOW, "Asia/Seoul");
  draft = { ...draft, note: "바꿈" };
  const r2 = await saveDraft(server.client, draft, r1.pending, NOW, "Asia/Seoul");
  assert.equal(r2.kind, "error", "수정 응답 유실");
  assert.equal(r2.pending?.phase, "exists");
  const r3 = await saveDraft(server.client, draft, r2.pending, NOW, "Asia/Seoul");
  assert.equal(r3.kind, "saved");
  assert.equal(server.rows.get(draft.id)?.version, 2, "수정은 한 번만 반영");
});

test("확인 중 다른 기기가 먼저 고쳤다면 덮어쓰지 않고 conflict, 사용자가 다시 저장하면 최신 version으로 수정", async () => {
  const server = fakeServer({ lostResponseOnce: true });
  let draft = { ...newDraft(fakeId), burden: "heavy" as const, note: "처음" };
  const r1 = await saveDraft(server.client, draft, null, NOW, "Asia/Seoul");
  // 다른 기기에서 먼저 수정 (version 2)
  await updateCheckin(server.client, { id: draft.id, expectedVersion: 1, burden: "bearable", tags: [], note: "다른 기기" });
  // 이 기기: 확인 결과는 version 2를 받으므로 그 version으로 수정이 진행된다
  draft = { ...draft, note: "이 기기" };
  const r2 = await saveDraft(server.client, draft, r1.pending, NOW, "Asia/Seoul");
  // 재확인 응답이 이미 version 2를 담고 있어, 그 기준으로 수정됨
  assert.equal(r2.kind, "saved");
  assert.equal(server.rows.get(draft.id)?.note, "이 기기");

  // 확인과 수정 사이에 끼어든 경우를 직접 재현: pending이 옛 version을 들고 있음
  const stalePending: PendingSave = { phase: "exists", params: r1.pending!.params, record: { ...server.rows.get(draft.id)!, version: 1 } };
  const r3 = await saveDraft(server.client, { ...draft, note: "또 바꿈" }, stalePending, NOW, "Asia/Seoul");
  assert.equal(r3.kind, "conflict");
  assert.equal(server.rows.get(draft.id)?.note, "이 기기", "덮어쓰지 않음");
  if (r3.kind === "conflict") {
    const r4 = await saveDraft(server.client, { ...draft, note: "또 바꿈" }, r3.pending, NOW, "Asia/Seoul");
    assert.equal(r4.kind, "saved");
    assert.equal(server.rows.get(draft.id)?.note, "또 바꿈");
  }
});

test("서버가 확실히 거절한 요청(로그인 끝남)은 저장되지 않았으므로 다음 시도는 현재 입력으로 새로 만든다", async () => {
  const server = fakeServer({ rejectAuthOnce: true });
  let draft = { ...newDraft(fakeId), burden: "heavy" as const, note: "처음" };
  const r1 = await saveDraft(server.client, draft, null, NOW, "Asia/Seoul");
  assert.equal(r1.kind, "error");
  if (r1.kind === "error") assert.equal(r1.reason, "signed_out");
  assert.equal(r1.pending, null);
  draft = { ...draft, note: "바꿈" };
  const r2 = await saveDraft(server.client, draft, r1.pending, NOW, "Asia/Seoul");
  assert.equal(r2.kind, "saved");
  assert.equal(server.sent.filter((c) => c.fn === "update_checkin").length, 0, "수정 단계 없이 바로 생성");
  assert.equal(server.rows.get(draft.id)?.note, "바꿈");
});

// ---------------------------------------------------------------------------
// 계정 전환 보호 (session/guard.ts)
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test("A의 조회 응답이 B 로그인 뒤에 도착하면 화면에 반영하지 않는다", async () => {
  const guard = createSessionGuard();
  guard.setUser("user-a");
  let shown: string[] | null = null;
  const slow = deferred<string[]>();

  // A로 조회 시작 (화면 코드와 같은 순서: 표 받기 → 요청 → 응답 후 확인)
  const loading = (async () => {
    const t = guard.ticket();
    const rows = await slow.promise;
    if (guard.isCurrent(t)) shown = rows;
  })();

  guard.setUser(null); // 로그아웃
  guard.setUser("user-b"); // B 로그인
  slow.resolve(["A의 가상 기록"]); // 늦게 도착한 A 응답
  await loading;
  assert.equal(shown, null, "A의 기록이 B 화면에 보이지 않음");
});

test("같은 A가 로그아웃 후 다시 로그인해도 이전 세대의 응답·저장 결과는 버린다", () => {
  const guard = createSessionGuard("user-a");
  const t = guard.ticket();
  guard.setUser(null);
  guard.setUser("user-a");
  assert.equal(guard.isCurrent(t), false);
  assert.equal(guard.isCurrent(guard.ticket()), true);
});

test("로그인 상태가 아니면 어떤 응답도 반영하지 않는다", () => {
  const guard = createSessionGuard(null);
  assert.equal(guard.isCurrent(guard.ticket()), false);
});

test("저장 응답의 소유자가 요청한 사용자가 아니면 반영하지 않는다", () => {
  const t = { uid: "user-a", generation: 1 };
  assert.equal(ownedBy({ owner_id: "user-a" }, t), true);
  assert.equal(ownedBy({ owner_id: "user-b" }, t), false);
  assert.equal(ownedBy({ owner_id: "user-a" }, { uid: null, generation: 1 }), false);
});

test("A의 저장 재시도 중 B로 바뀌면 결과를 반영하지 않고, B 화면은 새 입력에서 시작", async () => {
  const guard = createSessionGuard("user-a");
  const server = fakeServer({ lostResponseOnce: true });
  let formA = initialFormState({ ...newDraft(fakeId), burden: "heavy" as const, note: "A의 가상 메모" });
  const r1 = await saveDraft(server.client, formA.draft, null, NOW, "Asia/Seoul");
  formA = formReducer(formReducer(formA, { type: "submitStart" }), { type: "submitFail", reason: "network" });

  const t = guard.ticket();
  const retry = saveDraft(server.client, formA.draft, r1.pending, NOW, "Asia/Seoul");
  guard.setUser("user-b"); // 재시도 응답 전에 계정 전환
  const r2 = await retry;
  assert.equal(r2.kind, "saved", "A 계정 기준으로는 서버에 저장됨");
  const applied = guard.isCurrent(t);
  assert.equal(applied, false, "B 화면에는 A의 저장 결과를 반영하지 않음");

  // AuthScope는 사용자별로 화면을 새로 만든다: B 화면은 새 입력·pending 없음에서 시작
  const formB = initialFormState(newDraft(fakeId));
  assert.equal(formB.draft.note, "");
  assert.equal(formB.lastSaved, null);
});
