// 홈 '한 번 눌러 남기기' 저장 규칙 (quickSave.ts). 가상 데이터만 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Checkin, CreateCheckinParams, Draft } from "../src/lib/checkins/model";
import type { RecordsClient } from "../src/lib/checkins/api";
import { confirmSaved, matchesSent, quickSave } from "../src/lib/checkins/quickSave";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const TZ = "Asia/Seoul";
const ID = "00000000-0000-4000-8000-0000000000a1";

function record(p: CreateCheckinParams): Checkin {
  return {
    id: p.p_id, owner_id: "user-a", occurred_at: p.p_occurred_at, occurred_tz: p.p_occurred_tz,
    recorded_at: p.p_recorded_at, recorded_tz: p.p_recorded_tz, source: p.p_source, burden: p.p_burden,
    tags: p.p_tags, note: p.p_note, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), version: 1,
  };
}

/** 같은 ID는 한 번만 저장하는 서버 흉내. 지운 기록은 완전히 사라진다(실제 delete_checkin과 같음). */
function server(opts: { loseOnce?: boolean; rejectAuthOnce?: boolean; readFailOnce?: boolean } = {}) {
  const rows = new Map<string, Checkin>();
  let lose = opts.loseOnce ?? false;
  let rejectAuth = opts.rejectAuthOnce ?? false;
  let readFail = opts.readFailOnce ?? false;
  const calls: string[] = [];
  const client: RecordsClient = {
    async rpc(fn, args) {
      calls.push(fn);
      if (rejectAuth) { rejectAuth = false; return { data: null, error: { code: "28000", message: "not_authenticated" } }; }
      if (fn === "create_checkin") {
        const p = args as unknown as CreateCheckinParams;
        const existing = rows.get(p.p_id);
        if (!existing) rows.set(p.p_id, record(p));
        if (lose) { lose = false; throw new TypeError("Failed to fetch"); }
        return { data: { created: !existing, record: rows.get(p.p_id) }, error: null };
      }
      return { data: null, error: { code: "42883", message: "home must not call " + fn } };
    },
    from() {
      return {
        select() {
          return {
            order() { throw new Error("not used"); },
            eq(_col: "id", id: string) {
              return {
                async limit() {
                  calls.push("select_by_id");
                  if (readFail) { readFail = false; throw new TypeError("Failed to fetch"); }
                  const r = rows.get(id);
                  return { data: r ? [{ ...r }] : [], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  /** 다른 탭에서 고친 것처럼 (version 증가) */
  function editElsewhere(id: string, patch: Partial<Pick<Checkin, "note" | "tags" | "burden">>) {
    const cur = rows.get(id)!;
    rows.set(id, { ...cur, ...patch, version: cur.version + 1 });
  }
  return { client, rows, calls, editElsewhere };
}

const draft = (burden: Draft["burden"], id = ID): Draft => ({ id, burden, tags: [], note: "", recallLocal: null });

/** 첫 저장 응답을 잃은 상태를 만든다 */
async function lostFirstSave(s: ReturnType<typeof server>) {
  const r1 = await quickSave(s.client, draft("heavy"), NOW, TZ);
  assert.equal(r1.kind, "error");
  if (r1.kind !== "error" || !r1.pending) throw new Error("결과를 모르는 요청이 남아야 함");
  return r1.pending;
}

test("홈 저장: 한 번 누르면 기록 1개, 손대지 않은 기록이라 되돌리기 가능", async () => {
  const s = server();
  const r = await quickSave(s.client, draft("heavy"), NOW, TZ);
  assert.equal(r.kind, "saved");
  if (r.kind !== "saved") return;
  assert.equal(r.record.burden, "heavy");
  assert.equal(r.untouched, true);
  assert.deepEqual(s.calls, ["create_checkin"]);
});

test("응답 유실 뒤 확인은 조회만 한다: 저장돼 있으면 saved, 쓰기 요청 없음", async () => {
  const s = server({ loseOnce: true });
  const pending = await lostFirstSave(s);
  const r = await confirmSaved(s.client, pending);
  assert.equal(r.kind, "saved");
  if (r.kind === "saved") assert.equal(r.untouched, true);
  assert.deepEqual(s.calls, ["create_checkin", "select_by_id"]);
});

test("응답 유실 → 다른 탭에서 메모·태그 추가 → 확인: 덮어쓰지 않고, 되돌리기 대상 아님", async () => {
  const s = server({ loseOnce: true });
  const pending = await lostFirstSave(s);
  s.editElsewhere(ID, { note: "가상 메모", tags: ["sleep", "meal"] });
  const r = await confirmSaved(s.client, pending);
  assert.equal(r.kind, "saved");
  if (r.kind === "saved") assert.equal(r.untouched, false);
  const kept = s.rows.get(ID)!;
  assert.equal(kept.note, "가상 메모");
  assert.deepEqual(kept.tags, ["sleep", "meal"]);
  assert.equal(kept.version, 2);
  assert.ok(!s.calls.includes("update_checkin"));
});

test("응답 유실 → 다른 탭에서 그 기록 삭제 → 확인: 되살리지 않고 missing", async () => {
  const s = server({ loseOnce: true });
  const pending = await lostFirstSave(s);
  s.rows.delete(ID); // 다른 탭에서 지움
  const r = await confirmSaved(s.client, pending);
  assert.equal(r.kind, "missing");
  assert.equal(s.rows.has(ID), false, "지운 기록이 다시 생기지 않음");
  assert.equal(s.calls.filter((c) => c === "create_checkin").length, 1, "확인 단계에서 생성 요청 없음");
});

test("missing 뒤 사용자가 새로 남기면 새 ID로 만든다 (지운 ID를 되살리지 않음)", async () => {
  const s = server({ loseOnce: true });
  const pending = await lostFirstSave(s);
  s.rows.delete(ID);
  assert.equal((await confirmSaved(s.client, pending)).kind, "missing");
  const NEW_ID = "00000000-0000-4000-8000-0000000000a2";
  const r = await quickSave(s.client, draft("heavy", NEW_ID), NOW, TZ);
  assert.equal(r.kind, "saved");
  assert.equal(s.rows.has(ID), false);
  assert.equal(s.rows.has(NEW_ID), true);
});

test("확인 조회가 실패하면 여전히 모름: pending 유지, 쓰기 없음", async () => {
  const s = server({ loseOnce: true, readFailOnce: true });
  const pending = await lostFirstSave(s);
  const r = await confirmSaved(s.client, pending);
  assert.equal(r.kind, "error");
  if (r.kind === "error") {
    assert.equal(r.reason, "network");
    assert.equal(r.pending, pending);
  }
  assert.equal(s.calls.filter((c) => c === "create_checkin").length, 1);
});

test("다른 곳에서 버거움만 바꿔도 되돌리기 대상이 아니다", async () => {
  const s = server({ loseOnce: true });
  const pending = await lostFirstSave(s);
  s.editElsewhere(ID, { burden: "okay" });
  const r = await confirmSaved(s.client, pending);
  assert.equal(r.kind, "saved");
  if (r.kind === "saved") assert.equal(r.untouched, false);
  assert.equal(s.rows.get(ID)!.burden, "okay");
});

test("확실히 거절된 요청(로그인 끝남)은 pending을 남기지 않는다", async () => {
  const s = server({ rejectAuthOnce: true });
  const r = await quickSave(s.client, draft("heavy"), NOW, TZ);
  assert.equal(r.kind, "error");
  if (r.kind === "error") {
    assert.equal(r.reason, "signed_out");
    assert.equal(r.pending, null);
  }
  assert.equal(s.rows.size, 0);
});

test("matchesSent: version·버거움·태그·메모가 모두 보낸 값과 같아야 손대지 않은 기록", () => {
  const p = {
    p_id: ID, p_occurred_at: NOW.toISOString(), p_occurred_tz: TZ, p_recorded_at: NOW.toISOString(), p_recorded_tz: TZ,
    p_source: "direct", p_burden: "heavy", p_tags: [], p_note: null,
  } as CreateCheckinParams;
  const base = { burden: "heavy" as const, tags: [] as Checkin["tags"], note: null, version: 1 };
  assert.equal(matchesSent(base, p), true);
  assert.equal(matchesSent({ ...base, note: "  " }, p), true, "공백 메모는 없음과 같다");
  assert.equal(matchesSent({ ...base, version: 2 }, p), false);
  assert.equal(matchesSent({ ...base, note: "가상" }, p), false);
  assert.equal(matchesSent({ ...base, tags: ["wash"] }, p), false);
  assert.equal(matchesSent({ ...base, burden: "okay" }, p), false);
});
