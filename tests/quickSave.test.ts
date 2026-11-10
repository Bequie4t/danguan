// 홈 '한 번 눌러 남기기' 저장 규칙 (quickSave.ts). 가상 데이터만 쓴다.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Checkin, CreateCheckinParams, Draft } from "../src/lib/checkins/model";
import type { RecordsClient } from "../src/lib/checkins/api";
import { matchesSent, quickSave } from "../src/lib/checkins/quickSave";

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

/** 같은 ID는 한 번만 저장하는 서버 흉내. loseOnce: 저장은 하고 응답만 잃는다. */
function server(opts: { loseOnce?: boolean; rejectAuthOnce?: boolean } = {}) {
  const rows = new Map<string, Checkin>();
  let lose = opts.loseOnce ?? false;
  let rejectAuth = opts.rejectAuthOnce ?? false;
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
    from() { throw new Error("not used"); },
  };
  /** 다른 탭에서 메모·생활 항목을 더한 것처럼 바꾼다 (version 증가) */
  function editElsewhere(id: string, patch: Partial<Pick<Checkin, "note" | "tags" | "burden">>) {
    const cur = rows.get(id)!;
    rows.set(id, { ...cur, ...patch, version: cur.version + 1 });
  }
  return { client, rows, calls, editElsewhere };
}

const draft = (burden: Draft["burden"]): Draft => ({ id: ID, burden, tags: [], note: "", recallLocal: null });

test("홈 저장: 한 번 누르면 기록 1개, 손대지 않은 기록이라 되돌리기 가능", async () => {
  const s = server();
  const r = await quickSave(s.client, draft("heavy"), null, NOW, TZ);
  assert.equal(r.kind, "saved");
  if (r.kind !== "saved") return;
  assert.equal(r.record.burden, "heavy");
  assert.equal(r.untouched, true);
  assert.deepEqual(s.calls, ["create_checkin"]);
  assert.equal(s.rows.size, 1);
});

test("응답 유실 → 다른 탭에서 메모·태그 추가 → 같은 값 재시도: 덮어쓰지 않고, 되돌리기 대상 아님", async () => {
  const s = server({ loseOnce: true });
  const r1 = await quickSave(s.client, draft("heavy"), null, NOW, TZ);
  assert.equal(r1.kind, "error");
  if (r1.kind !== "error") return;
  assert.ok(r1.pending, "결과를 모르는 요청은 다음 확인을 위해 남긴다");

  s.editElsewhere(ID, { note: "가상 메모", tags: ["sleep", "meal"] });

  const r2 = await quickSave(s.client, draft("heavy"), r1.pending, NOW, TZ);
  assert.equal(r2.kind, "saved");
  if (r2.kind !== "saved") return;
  assert.equal(r2.untouched, false);
  const kept = s.rows.get(ID)!;
  assert.equal(kept.note, "가상 메모");
  assert.deepEqual(kept.tags, ["sleep", "meal"]);
  assert.equal(kept.version, 2);
  assert.equal(s.rows.size, 1);
  assert.ok(!s.calls.includes("update_checkin"), "홈은 수정 요청을 보내지 않는다");
  assert.deepEqual(s.calls, ["create_checkin", "create_checkin"]);
});

test("결과를 모르는 동안에는 다른 값을 눌러도 처음 값 그대로 확인만 한다", async () => {
  const s = server({ loseOnce: true });
  const r1 = await quickSave(s.client, draft("heavy"), null, NOW, TZ);
  assert.equal(r1.kind, "error");
  if (r1.kind !== "error") return;
  const r2 = await quickSave(s.client, draft("okay"), r1.pending, NOW, TZ);
  assert.equal(r2.kind, "saved");
  if (r2.kind !== "saved") return;
  assert.equal(r2.record.burden, "heavy");
  assert.equal(s.rows.get(ID)!.burden, "heavy");
  assert.ok(!s.calls.includes("update_checkin"));
});

test("다른 곳에서 버거움만 바꿔도(같은 version이 아님) 되돌리기 대상이 아니다", async () => {
  const s = server({ loseOnce: true });
  const r1 = await quickSave(s.client, draft("heavy"), null, NOW, TZ);
  if (r1.kind !== "error") return assert.fail("응답 유실이어야 함");
  s.editElsewhere(ID, { burden: "okay" });
  const r2 = await quickSave(s.client, draft("heavy"), r1.pending, NOW, TZ);
  assert.equal(r2.kind, "saved");
  if (r2.kind === "saved") assert.equal(r2.untouched, false);
  assert.equal(s.rows.get(ID)!.burden, "okay", "다른 곳에서 고친 값을 그대로 둔다");
});

test("확실히 거절된 요청(로그인 끝남)은 pending을 남기지 않는다", async () => {
  const s = server({ rejectAuthOnce: true });
  const r = await quickSave(s.client, draft("heavy"), null, NOW, TZ);
  assert.equal(r.kind, "error");
  if (r.kind === "error") {
    assert.equal(r.reason, "signed_out");
    assert.equal(r.pending, null);
  }
  assert.equal(s.rows.size, 0);
});

test("matchesSent: version·버거움·태그·메모가 모두 보낸 값과 같아야 손대지 않은 기록", () => {
  const p: CreateCheckinParams = {
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
