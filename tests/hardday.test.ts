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
  const r = saveCard(s, card, null);
  assert.equal(r.status, "saved");
  const loaded = loadCard(s);
  assert.equal(loaded.status, "ok");
  if (loaded.status === "ok" && r.status === "saved") {
    assert.deepEqual(loaded.card, card);
    assert.equal(loaded.raw, r.raw);
  }
  assert.deepEqual([...s.data.keys()], [STORAGE_KEY], "정해진 키 하나만 씀");
  assert.equal(clearCard(s), true);
  assert.deepEqual(loadCard(s), { status: "empty" });
});

test("다른 창에서 지우거나 바꾼 카드는 저장 직전에 알아채고 덮어쓰지 않는다 (확인하면 저장)", () => {
  const s = new MemoryStore();
  const a = normalize({ foods: [], people: ["민지"], message: "가상 A" }, NOW);
  const first = saveCard(s, a, null);
  assert.equal(first.status, "saved");
  const base = first.status === "saved" ? first.raw : null;
  // 다른 창에서 지움 → 이 창의 저장은 충돌, 지운 카드가 되살아나지 않음
  s.removeItem(STORAGE_KEY);
  const edited = normalize({ foods: [], people: ["민지"], message: "가상 A 고침" }, NOW);
  assert.deepEqual(saveCard(s, edited, base), { status: "conflict" });
  assert.equal(s.getItem(STORAGE_KEY), null, "지운 카드가 되살아남");
  // 다른 창에서 바꿈 → 충돌, 다른 창 내용 유지
  const other = saveCard(s, normalize({ foods: [], people: [], message: "가상 다른 창" }, NOW), null);
  assert.equal(other.status, "saved");
  assert.deepEqual(saveCard(s, edited, base), { status: "conflict" });
  assert.match(s.getItem(STORAGE_KEY)!, /가상 다른 창/);
  // 사용자가 확인하고 저장(force)하면 저장
  assert.equal(saveCard(s, edited, base, true).status, "saved");
  assert.match(s.getItem(STORAGE_KEY)!, /가상 A 고침/);
});

test("저장소를 쓸 수 없거나, 용량 초과로 쓰기가 실패하면 성공으로 표시하지 않는다. 읽기만 되면 기존 카드는 보인다", () => {
  const card = normalize({ foods: [], people: [], message: "가상" }, NOW);
  assert.deepEqual(loadCard(null), { status: "unavailable" });
  assert.deepEqual(saveCard(null, card, null), { status: "failed" });
  const throwing: KeyValueStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadCard(throwing), { status: "unavailable" });
  assert.deepEqual(saveCard(throwing, card, null), { status: "failed" });
  assert.equal(clearCard(throwing), false);
  // 읽기는 되고 쓰기만 용량 초과
  const mem = new MemoryStore();
  const kept = saveCard(mem, card, null);
  assert.equal(kept.status, "saved");
  const quota: KeyValueStore = {
    getItem: (k) => mem.getItem(k),
    setItem: () => { throw new DOMException("가상 용량 초과", "QuotaExceededError"); },
    removeItem: (k) => mem.removeItem(k),
  };
  assert.equal(loadCard(quota).status, "ok", "쓰기가 안 돼도 저장된 카드는 읽힘");
  assert.deepEqual(saveCard(quota, normalize({ foods: [], people: [], message: "가상 새" }, NOW), kept.status === "saved" ? kept.raw : null), { status: "failed" });
  assert.match(mem.getItem(STORAGE_KEY)!, /"가상"/, "실패한 저장이 기존 카드를 망가뜨리지 않음");
  const silent: KeyValueStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.deepEqual(saveCard(silent, card, null), { status: "failed" }, "써도 남지 않으면 실패");
  const sticky: KeyValueStore = { getItem: () => "x", setItem: () => {}, removeItem: () => {} };
  assert.equal(clearCard(sticky), false, "지워지지 않으면 실패");
});

test("한글이 든 주문 주소는 자르지 않고 통째로 보존하고, 너무 길면 자르지 않고 저장 전에 알린다", () => {
  const korean = "https://example.test/가상매장/주문?매장=서울특별시중구가상동123번지&메뉴=소고기야채죽특&옵션=덜맵게";
  const kept = safeUrl(korean);
  assert.ok(kept.length > 300, "인코딩 뒤 300자를 넘는 정상 주소");
  assert.equal(decodeURI(kept), korean, "주소가 잘리거나 바뀜");
  assert.equal(urlProblem(korean), null);
  const card = normalize({ foods: [{ name: "가상", url: korean }], people: [], message: "" }, NOW);
  assert.equal(card.foods[0].url, kept);
  const tooLong = "https://example.test/" + "a".repeat(LIMITS.foodUrl);
  assert.match(urlProblem(tooLong) ?? "", /너무 길어요/);
  assert.equal(safeUrl(tooLong), "", "너무 긴 주소를 잘라서 저장하면 안 됨");
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
