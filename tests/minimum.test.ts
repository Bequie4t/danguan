// 오늘 최소한: 이 기기 저장, 하루 단위 체크, 항목 고치기. 가상 데이터만.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ITEMS,
  ITEMS_MAX,
  LABEL_MAX,
  STORAGE_KEY,
  clearAll,
  defaultStored,
  deviceToday,
  newItemId,
  normalizeItems,
  parseStored,
  readStored,
  replaceItems,
  setDone,
  update,
  withLock,
  type KeyValueStore,
  type LockManagerLike,
} from "../src/lib/minimum/today";

const D1 = "2026-11-23";
const D2 = "2026-11-24";

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

test("처음: 기본 항목 4개, 체크 없음", () => {
  const p = parseStored(null, D1);
  assert.equal(p.status, "ok");
  assert.deepEqual(p.status === "ok" && p.value.items.map((i) => i.label), ["물 마시기", "뭐라도 먹기", "약 먹기", "세수하기"]);
  assert.deepEqual(p.status === "ok" && p.value.checks, { date: D1, done: [] });
});

test("체크는 켜기/끄기 값: 같은 동작을 두 번 해도 결과가 같다", () => {
  let s = defaultStored(D1);
  s = setDone(s, "water", true, D1);
  s = setDone(s, "water", true, D1);
  assert.deepEqual(s.checks.done, ["water"]);
  s = setDone(s, "water", false, D1);
  s = setDone(s, "water", false, D1);
  assert.deepEqual(s.checks.done, []);
  // 없는 항목은 무시
  assert.deepEqual(setDone(s, "nope", true, D1).checks.done, []);
});

test("날이 바뀌면 체크는 비워지고 지난 날 체크는 남지 않는다", () => {
  const s = setDone(defaultStored(D1), "eat", true, D1);
  const raw = JSON.stringify(s);
  const next = parseStored(raw, D2);
  assert.deepEqual(next.status === "ok" && next.value.checks, { date: D2, done: [] });
  // 다음 날 처음 누르면 그날 체크만
  const t = setDone(s, "water", true, D2);
  assert.deepEqual(t.checks, { date: D2, done: ["water"] });
  assert.equal(JSON.stringify(t).includes(D1), false, "지난 날짜가 남지 않음");
});

test("저장 값 검사: 손상·모르는 버전은 broken, 이상한 항목·중복·없는 체크는 걸러 냄", () => {
  assert.equal(parseStored("{", D1).status, "broken");
  assert.equal(parseStored("null", D1).status, "broken");
  assert.equal(parseStored(JSON.stringify({ version: 2, items: [], checks: { date: D1, done: [] } }), D1).status, "broken");
  const raw = JSON.stringify({
    version: 1,
    items: [{ id: "water", label: "  물   마시기 " }, { id: "water", label: "중복" }, { id: "BAD ID", label: "x" }, { id: "x1", label: "" }, null, { id: "eat", label: "가".repeat(50) }],
    checks: { date: D1, done: ["water", "water", "ghost", 3] },
  });
  const p = parseStored(raw, D1);
  assert.equal(p.status, "ok");
  if (p.status !== "ok") return;
  assert.deepEqual(p.value.items, [{ id: "water", label: "물 마시기" }, { id: "eat", label: "가".repeat(LABEL_MAX) }]);
  assert.deepEqual(p.value.checks.done, ["water"]);
});

test("항목 고치기: 남은 항목의 오늘 체크는 유지, 뺀 항목의 체크는 사라짐, 개수 제한", () => {
  let s = setDone(setDone(defaultStored(D1), "water", true, D1), "meds", true, D1);
  s = replaceItems(s, [{ id: "water", label: "물 한 잔" }, { id: "wash", label: "세수" }], D1);
  assert.deepEqual(s.items, [{ id: "water", label: "물 한 잔" }, { id: "wash", label: "세수" }]);
  assert.deepEqual(s.checks.done, ["water"]);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `my-${i}`, label: `항목 ${i}` }));
  assert.equal(normalizeItems(many).length, ITEMS_MAX);
  assert.deepEqual(replaceItems(s, [], D1).items, []);
});

test("새 항목 ID는 겹치지 않고 형식에 맞다", () => {
  const id = newItemId(DEFAULT_ITEMS, () => "AB-c!d");
  assert.equal(id, "my-abcd");
  assert.notEqual(newItemId([{ id: "my-abcd", label: "x" }], () => "abcd"), "my-abcd");
});

test("저장: 저장소의 최신 값에 적용한다 (다른 창에서 한 체크를 지우지 않음)", () => {
  const store = memStore();
  assert.equal(update(store, D1, (s) => setDone(s, "water", true, D1)).status, "saved");
  // 다른 창이 eat을 체크해 저장
  const other = JSON.parse(store.getItem(STORAGE_KEY)!);
  other.checks.done.push("eat");
  store.setItem(STORAGE_KEY, JSON.stringify(other));
  // 이 창은 예전 화면 상태와 상관없이 최신 값에 wash를 더한다
  const w = update(store, D1, (s) => setDone(s, "wash", true, D1));
  assert.equal(w.status, "saved");
  assert.deepEqual(w.status === "saved" && w.value.checks.done, ["water", "eat", "wash"]);
});

test("저장: 손상된 값은 덮어쓰지 않고, 저장소를 못 쓰면 failed", () => {
  const broken = memStore({ [STORAGE_KEY]: "{oops" });
  assert.equal(update(broken, D1, (s) => setDone(s, "water", true, D1)).status, "broken");
  assert.equal(broken.getItem(STORAGE_KEY), "{oops");
  assert.equal(readStored(broken, D1).status, "broken");
  const throwing: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => {} };
  assert.equal(update(throwing, D1, (s) => s).status, "failed");
  assert.equal(update(null, D1, (s) => s).status, "failed");
  const noRead: KeyValueStore = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(readStored(noRead, D1).status, "unavailable");
  // 쓰고 다시 읽은 값이 다르면 저장으로 보지 않음
  const lying: KeyValueStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.equal(update(lying, D1, (s) => setDone(s, "water", true, D1)).status, "failed");
});

test("모두 지우기", () => {
  const store = memStore();
  update(store, D1, (s) => setDone(s, "water", true, D1));
  assert.equal(clearAll(store), true);
  assert.equal(store.getItem(STORAGE_KEY), null);
  assert.equal(clearAll(null), false);
});

test("잠금: 있으면 그 안에서, 없으면 그냥 실행, 시간 안에 못 얻으면 실행하지 않음", async () => {
  assert.deepEqual(await withLock(null, () => 1), { status: "done", value: 1 });
  const free: LockManagerLike = { request: async (_n, _o, cb) => cb() };
  assert.deepEqual(await withLock(free, () => 2), { status: "done", value: 2 });
  let ran = false;
  const stuck: LockManagerLike = {
    request: (_n, o) => new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(new Error("AbortError")))),
  };
  assert.deepEqual(await withLock(stuck, () => { ran = true; }, 20), { status: "busy" });
  assert.equal(ran, false);
});

test("이 기기 날짜", () => {
  assert.equal(deviceToday(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("저장 내용에 개수·비율·연속 기록 같은 값이 없다", () => {
  const s = setDone(defaultStored(D1), "water", true, D1);
  assert.deepEqual(Object.keys(s).sort(), ["checks", "items", "version"]);
  assert.deepEqual(Object.keys(s.checks).sort(), ["date", "done"]);
});
