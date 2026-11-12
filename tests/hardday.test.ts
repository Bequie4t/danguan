// 힘든 날 카드 (6단계): 이 기기 저장 규칙, 손상된 값 처리, 주소 안전, 로그인·저장 코드와의 독립성. 가상 값만.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MESSAGE,
  LIMITS,
  STORAGE_KEY,
  canSend,
  clearCard,
  emptyCard,
  hasContent,
  loadCard,
  normalize,
  parseStored,
  safeUrl,
  saveCard,
  urlProblem,
  type KeyValueStore,
} from "../src/lib/hardday/card";
import { SRC, listFiles, violations } from "./helpers/import-graph";

const NOW = new Date("2026-11-13T02:00:00.000Z");

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

test("주문 주소는 https만, 그 밖(javascript:·http:·data:·계정 정보 포함)은 링크로 만들지 않는다", () => {
  assert.equal(safeUrl("https://example.test/order?a=1"), "https://example.test/order?a=1");
  for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "http://example.test", "data:text/html,x", "//example.test", "example.test", "https://user:pw@example.test", " "]) {
    assert.equal(safeUrl(bad), "", bad);
  }
  assert.equal(urlProblem(""), null);
  assert.match(urlProblem("http://example.test") ?? "", /https:\/\//);
});

test("저장 모양으로 정리: 빈 칸 제거, 길이·개수 제한, 위험한 주소는 비움", () => {
  const c = normalize(
    {
      foods: [
        { name: "  가상 죽  ", url: "https://example.test/juk" },
        { name: "", url: "" },
        { name: "가상 김밥", url: "javascript:alert(1)" },
        { name: "가상 셋", url: "" },
        { name: "가상 넷", url: "" },
      ],
      people: ["  민지 ", "", "지훈", "세 번째"],
      message: "  가상 부탁  ",
    },
    NOW,
  );
  assert.deepEqual(c.foods, [
    { name: "가상 죽", url: "https://example.test/juk" },
    { name: "가상 김밥", url: "" },
    { name: "가상 셋", url: "" },
  ]);
  assert.deepEqual(c.people, ["민지", "지훈"]);
  assert.equal(c.message, "가상 부탁");
  assert.equal(c.savedAt, NOW.toISOString());
  assert.equal(normalize({ foods: [{ name: "가".repeat(99), url: "" }], people: ["나".repeat(99)], message: "다".repeat(999) }, NOW).message.length, LIMITS.message);
});

test("아무것도 적지 않으면 저장 대상이 아니다. 기본 부탁 문장만 있어도 저장할 수 있다", () => {
  assert.equal(hasContent({ foods: [{ name: "", url: "" }], people: [""], message: "  " }), false);
  assert.equal(hasContent(emptyCard()), true, "기본 부탁 문장");
  assert.equal(emptyCard().message, DEFAULT_MESSAGE);
});

test("저장 → 다시 읽기 → 지우기, 저장은 다시 읽어 같을 때만 성공", () => {
  const s = new MemoryStore();
  assert.deepEqual(loadCard(s), { status: "empty" });
  const card = normalize({ foods: [{ name: "가상 죽", url: "" }], people: ["민지"], message: "가상 부탁" }, NOW);
  assert.equal(saveCard(s, card), true);
  assert.deepEqual(loadCard(s), { status: "ok", card });
  assert.deepEqual([...s.data.keys()], [STORAGE_KEY], "정해진 키 하나만 씀");
  assert.equal(clearCard(s), true);
  assert.deepEqual(loadCard(s), { status: "empty" });
});

test("저장소를 쓸 수 없거나 쓰기가 실패하면 성공으로 표시하지 않는다", () => {
  const card = normalize({ foods: [], people: [], message: "가상" }, NOW);
  assert.deepEqual(loadCard(null), { status: "unavailable" });
  assert.equal(saveCard(null, card), false);
  const throwing: KeyValueStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadCard(throwing), { status: "unavailable" });
  assert.equal(saveCard(throwing, card), false);
  assert.equal(clearCard(throwing), false);
  const silent: KeyValueStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.equal(saveCard(silent, card), false, "써도 남지 않으면 실패");
  const sticky: KeyValueStore = { getItem: () => "x", setItem: () => {}, removeItem: () => {} };
  assert.equal(clearCard(sticky), false, "지워지지 않으면 실패");
});

test("손상되거나 모르는 버전의 저장값은 쓰지 않고, 저장값 안의 위험한 주소도 다시 걸러낸다", () => {
  for (const raw of ["{", "null", "[]", '"x"', '{"version":2,"foods":[],"people":[],"message":"","savedAt":"2026-11-13T00:00:00Z"}', '{"version":1,"foods":{},"people":[],"message":"","savedAt":"2026-11-13T00:00:00Z"}', '{"version":1,"foods":[],"people":[],"message":"","savedAt":"아님"}']) {
    assert.deepEqual(parseStored(raw), { status: "broken" }, raw);
  }
  const r = parseStored(JSON.stringify({ version: 1, foods: [{ name: "가상", url: "javascript:alert(1)" }, 7, null], people: ["민지", 3], message: "가상", savedAt: "2026-11-13T00:00:00.000Z" }));
  assert.equal(r.status, "ok");
  if (r.status === "ok") {
    assert.deepEqual(r.card.foods, [{ name: "가상", url: "" }]);
    assert.deepEqual(r.card.people, ["민지"]);
    assert.equal(r.card.savedAt, "2026-11-13T00:00:00.000Z");
  }
});

test("공백뿐인 부탁 문장은 복사할 수 없다", () => {
  assert.equal(canSend("  \n"), false);
  assert.equal(canSend("가"), true);
});

test("화면: 로그·네트워크·쿠키 없음, 이 기기 저장소만, 앱이 대신 보내지 않음, 전화번호 받지 않음, 금지 표현 없음", () => {
  const code = readFileSync(join(SRC, "components", "HardDayCard.tsx"), "utf8");
  const lib = readFileSync(join(SRC, "lib", "hardday", "card.ts"), "utf8");
  for (const c of [code, lib]) assert.ok(!/console\.|fetch\(|XMLHttpRequest|sendBeacon|document\.cookie|sessionStorage|indexedDB/.test(c));
  assert.ok(!/localStorage/.test(code), "저장은 lib의 browserStore로만");
  assert.ok(!/type="tel"|전화번호를 (입력|적어)/.test(code), "전화번호 입력칸 없음");
  assert.deepEqual([...code.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]), ["15770199"]);
  assert.ok(!/보냈어요|전송 완료|발송 완료/.test(code));
  const visible = code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/진단|치료|완치|처방|연속|출석|배지|스트릭|매일/.test(visible), "금지 표현");
  assert.ok(/target="_blank"\s+rel="noopener noreferrer"/.test(code), "주문 주소는 새 창 + noopener");
});

test("힘든 날 카드는 로그인·기록 저장·Supabase 코드를 가져오지 않고, 미들웨어를 거치지 않는다", () => {
  const files = listFiles(join(SRC, "app", "hardday")).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 0);
  assert.deepEqual(violations(files), []);
  const mw = readFileSync(join(SRC, "middleware.ts"), "utf8");
  assert.match(mw.match(/matcher\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "", /\|hardday\|/);
});
