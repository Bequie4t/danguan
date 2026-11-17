// 진료 준비 메모: 기간 계산·세기·메모 상태. 가상 데이터만 쓴다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Burden, Checkin, CheckinSource, TagCode } from "../src/lib/checkins/model";
import { listCheckinsBetween, type RangeClient } from "../src/lib/checkins/api";
import {
  addDays,
  checkPeriod,
  formatDate,
  inPeriod,
  localDate,
  periodLength,
  presetPeriod,
  queryRange,
  summarize,
} from "../src/lib/visit/summary";
import { QUESTIONS_MAX, TEXT_MAX, hasWriting, initialMemoState, memoReducer } from "../src/lib/visit/memo";

let n = 0;
function rec(occurred_at: string, burden: Burden, opts: { tz?: string; tags?: TagCode[]; note?: string | null; source?: CheckinSource; owner?: string } = {}): Checkin {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    owner_id: opts.owner ?? "user-a",
    occurred_at,
    occurred_tz: opts.tz ?? "Asia/Seoul",
    recorded_at: occurred_at,
    recorded_tz: opts.tz ?? "Asia/Seoul",
    source: opts.source ?? "direct",
    burden,
    tags: opts.tags ?? [],
    note: opts.note ?? null,
    created_at: occurred_at,
    updated_at: occurred_at,
    version: 1,
  };
}

test("날짜 계산: 기간 길이·미리 정한 기간·잘못된 날짜", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.deepEqual(presetPeriod("2026-11-17", 7), { from: "2026-11-11", to: "2026-11-17" });
  assert.deepEqual(presetPeriod("2026-11-17", 28), { from: "2026-10-21", to: "2026-11-17" });
  assert.equal(periodLength({ from: "2026-11-11", to: "2026-11-17" }), 7);
  assert.equal(checkPeriod({ from: "2026-11-11", to: "2026-11-17" }), null);
  assert.equal(checkPeriod({ from: "2026-11-18", to: "2026-11-17" }), "reversed");
  assert.equal(checkPeriod({ from: "", to: "2026-11-17" }), "invalid");
  assert.equal(checkPeriod({ from: "2026-02-30", to: "2026-03-02" }), "invalid");
  assert.equal(checkPeriod({ from: "2026-01-01", to: "2026-04-02" }), null); // 92일
  assert.equal(checkPeriod({ from: "2026-01-01", to: "2026-04-03" }), "too_long");
});

test("날짜는 기록이 경험된 시점을 그 기록의 시간대로 본다", () => {
  // 서울 11월 18일 오전 1시 = UTC 11월 17일 16시
  assert.equal(localDate("2026-11-17T16:00:00.000Z", "Asia/Seoul"), "2026-11-18");
  assert.equal(localDate("2026-11-17T16:00:00.000Z", "America/Los_Angeles"), "2026-11-17");
  assert.equal(localDate("2026-11-17T16:00:00.000Z", "Not/AZone"), "2026-11-17"); // 잘못된 시간대는 UTC
  const p = { from: "2026-11-11", to: "2026-11-17" };
  assert.equal(inPeriod(rec("2026-11-17T16:00:00.000Z", "okay"), p), false); // 서울 18일
  assert.equal(inPeriod(rec("2026-11-10T15:00:00.000Z", "okay"), p), true); // 서울 11일 0시
  assert.equal(inPeriod(rec("2026-11-10T14:59:59.000Z", "okay"), p), false); // 서울 10일
});

test("서버 조회 범위는 기간 앞뒤로 넉넉하다 (시간대가 달라도 빠지지 않게)", () => {
  const p = { from: "2026-11-11", to: "2026-11-17" };
  const r = queryRange(p);
  assert.equal(r.fromIso, "2026-11-09T00:00:00.000Z");
  assert.equal(r.toIso, "2026-11-20T00:00:00.000Z");
  // 가장 이른 시간대(UTC+14)의 11일 0시, 가장 늦은 시간대(UTC-12)의 17일 끝이 범위 안
  assert.ok(new Date("2026-11-10T10:00:00.000Z") >= new Date(r.fromIso));
  assert.ok(new Date("2026-11-18T11:59:59.000Z") < new Date(r.toIso));
});

test("세기: 기록 수와 날짜 수를 나누고, 평균·대표값 없이 고른 표현별로만 센다", () => {
  const p = { from: "2026-11-11", to: "2026-11-17" };
  const s = summarize(
    [
      rec("2026-11-12T03:00:00.000Z", "heavy", { tags: ["sleep", "meal"] }),
      rec("2026-11-12T12:00:00.000Z", "okay", { tags: ["sleep"], note: "가상 메모 하나" }),
      rec("2026-11-14T01:00:00.000Z", "heavy", { tags: ["sleep", "sleep"] as TagCode[], source: "recall" }),
      rec("2026-11-20T01:00:00.000Z", "very_heavy", { note: "기간 밖" }), // 기간 밖
    ],
    p,
  );
  assert.equal(s.periodDays, 7);
  assert.equal(s.records, 3);
  assert.equal(s.recordedDays, 2);
  assert.equal(s.unrecordedDays, 5);
  assert.deepEqual(s.bySource, { direct: 2, recall: 1, device: 0 });
  assert.deepEqual(
    s.burdens.map((b) => [b.value, b.records, b.days]),
    [["okay", 1, 1], ["bearable", 0, 0], ["heavy", 2, 2], ["very_heavy", 0, 0], ["unsure", 0, 0]],
  );
  // 같은 기록 안의 중복 항목은 한 번만, 많이 고른 순
  assert.deepEqual(s.tags.map((t) => [t.value, t.records, t.days]), [["sleep", 3, 2], ["meal", 1, 1]]);
  assert.deepEqual(s.days.map((d) => [d.date, d.entries.map((e) => e.burden)]), [["2026-11-12", ["heavy", "okay"]], ["2026-11-14", ["heavy"]]]);
  assert.deepEqual(s.notes.map((x) => x.text), ["가상 메모 하나"]);
  // 요약 어디에도 숫자 점수·평균이 없다
  assert.equal(JSON.stringify(s).includes("average"), false);
});

test("기록이 없는 기간: 0개로 세고, 기록 없는 날은 기간 전체", () => {
  const s = summarize([], { from: "2026-11-11", to: "2026-11-17" });
  assert.equal(s.records, 0);
  assert.equal(s.recordedDays, 0);
  assert.equal(s.unrecordedDays, 7);
  assert.deepEqual(s.days, []);
});

test("날짜 표시", () => {
  assert.equal(formatDate("2026-11-17"), "11월 17일 (화)");
});

test("기간 조회: 경험 시점 범위로 오래된 순, 한도에 닿으면 '일부만'으로 표시", async () => {
  const calls: unknown[] = [];
  const rows = [rec("2026-11-12T03:00:00.000Z", "heavy"), rec("2026-11-13T03:00:00.000Z", "okay")];
  const client: RangeClient = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(cols) {
          calls.push(["select", cols]);
          return {
            gte(col, v) {
              calls.push(["gte", col, v]);
              return {
                lt(col2, v2) {
                  calls.push(["lt", col2, v2]);
                  return {
                    order(col3, o) {
                      calls.push(["order", col3, o.ascending]);
                      return {
                        limit(k) {
                          calls.push(["limit", k]);
                          return Promise.resolve({ data: rows.slice(0, k), error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const r = await listCheckinsBetween(client, "2026-11-09T00:00:00.000Z", "2026-11-20T00:00:00.000Z");
  assert.equal(r.kind, "ok");
  assert.equal(r.kind === "ok" && r.truncated, false);
  assert.deepEqual(calls, [
    ["from", "checkins"],
    ["select", "*"],
    ["gte", "occurred_at", "2026-11-09T00:00:00.000Z"],
    ["lt", "occurred_at", "2026-11-20T00:00:00.000Z"],
    ["order", "occurred_at", true],
    ["limit", 1000],
  ]);
  const full = await listCheckinsBetween(client, "a", "b", 2);
  assert.equal(full.kind === "ok" && full.truncated, true);
});

test("기간 조회 실패: 연결 오류·인증 끝남을 구분한다", async () => {
  const failing = (err: { code: string; message: string } | "throw"): RangeClient => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          lt: () => ({
            order: () => ({
              limit: () => (err === "throw" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ data: null, error: err })),
            }),
          }),
        }),
      }),
    }),
  });
  assert.deepEqual(await listCheckinsBetween(failing("throw"), "a", "b"), { kind: "error", reason: "network" });
  const auth = await listCheckinsBetween(failing({ code: "PGRST301", message: "JWT expired" }), "a", "b");
  assert.equal(auth.kind, "error");
});

test("메모 상태: 질문 넣기·빼기, 길이 제한, 개수 제한", () => {
  let s = initialMemoState("2026-11-17", "2026-10-21");
  assert.equal(hasWriting(s), false);
  assert.deepEqual(s.hidden, ["days"]);
  s = memoReducer(s, { type: "draftQuestion", value: "   " });
  s = memoReducer(s, { type: "addQuestion" });
  assert.deepEqual(s.questions, []);
  s = memoReducer(s, { type: "draftQuestion", value: "  가상   질문  " });
  assert.equal(hasWriting(s), true);
  s = memoReducer(s, { type: "addQuestion" });
  assert.deepEqual(s.questions, ["가상 질문"]);
  assert.equal(s.draftQuestion, "");
  for (let i = 0; i < 20; i++) {
    s = memoReducer(s, { type: "draftQuestion", value: `질문 ${i}` });
    s = memoReducer(s, { type: "addQuestion" });
  }
  assert.equal(s.questions.length, QUESTIONS_MAX);
  s = memoReducer(s, { type: "removeQuestion", index: 0 });
  assert.equal(s.questions[0], "질문 0");
  s = memoReducer(s, { type: "concern", value: "가".repeat(TEXT_MAX + 10) });
  assert.equal(s.concern.length, TEXT_MAX);
});

test("메모 상태: 기록 메모는 고른 것만, 부분 끄고 켜기, 쓴 내용 지우기", () => {
  let s = initialMemoState("2026-11-17", "2026-10-21");
  assert.deepEqual(s.pickedNotes, []);
  s = memoReducer(s, { type: "toggleNote", id: "x", on: true });
  s = memoReducer(s, { type: "toggleNote", id: "x", on: true });
  assert.deepEqual(s.pickedNotes, ["x"]);
  s = memoReducer(s, { type: "toggleSection", key: "days", on: true });
  s = memoReducer(s, { type: "toggleSection", key: "tags", on: false });
  assert.deepEqual(s.hidden, ["tags"]);
  s = memoReducer(s, { type: "impact", value: "가상 영향" });
  s = memoReducer(s, { type: "preset", value: 7 });
  s = memoReducer(s, { type: "clearWriting" });
  assert.equal(hasWriting(s), false);
  assert.deepEqual(s.pickedNotes, []);
  // 기간·넣을 부분 설정은 그대로
  assert.equal(s.preset, 7);
  assert.deepEqual(s.hidden, ["tags"]);
});
