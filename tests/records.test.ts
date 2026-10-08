// 가상 데이터로만 테스트한다. 실행: npm test (또는 npx tsx --test tests/*.test.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCreateParams, newDraft, type Checkin, type CreateCheckinParams } from "../src/lib/checkins/model";
import { createCheckin, updateCheckin, deleteCheckin, classifyError, type RecordsClient } from "../src/lib/checkins/api";
import { formReducer, initialFormState } from "../src/lib/checkins/formState";

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
function fakeServer(opts: { failTimes?: number; lostResponseOnce?: boolean } = {}) {
  const rows = new Map<string, Checkin>();
  let fails = opts.failTimes ?? 0;
  let lose = opts.lostResponseOnce ?? false;
  const calls: string[] = [];
  const client: RecordsClient = {
    async rpc(fn, args) {
      calls.push(fn);
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
        const next = { ...cur, burden: args.p_burden as Checkin["burden"], note: args.p_note as string | null, version: cur.version + 1 };
        rows.set(cur.id, next);
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
  return { client, rows, calls };
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
