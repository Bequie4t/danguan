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
  sameContent,
  snapshot,
  urlProblem,
  withCardLock,
  LOCK_NAME,
  type LockManagerLike,
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
  assert.deepEqual(clearCard(s, r.status === "saved" ? r.raw : null), { status: "cleared" });
  assert.deepEqual(loadCard(s), { status: "empty" });
});

test("저장·덮어쓰기는 확인한 버전에만: 다른 창에서 지우거나 바꾸면 멈추고, 경고 뒤 또 바뀌면 다시 멈춘다", () => {
  const s = new MemoryStore();
  const first = saveCard(s, normalize({ foods: [], people: ["민지"], message: "가상 A" }, NOW), null);
  assert.equal(first.status, "saved");
  const base = first.status === "saved" ? first.raw : null;
  const edited = normalize({ foods: [], people: ["민지"], message: "가상 A 고침" }, NOW);
  // 다른 창에서 지움 → 충돌(지금 값 null), 지운 카드가 되살아나지 않음
  s.removeItem(STORAGE_KEY);
  assert.deepEqual(saveCard(s, edited, base), { status: "conflict", currentRaw: null });
  assert.equal(s.getItem(STORAGE_KEY), null, "지운 카드가 되살아남");
  // 사용자가 '지워진 상태'를 보고 그래도 새로 저장하기로 함 → 그 사이 다른 창이 또 저장했다면 다시 멈춤
  const other = saveCard(s, normalize({ foods: [], people: [], message: "가상 다른 창" }, NOW), null);
  assert.equal(other.status, "saved");
  const again = saveCard(s, edited, null); // 경고 때 본 버전(null) 기준
  assert.equal(again.status, "conflict", "경고 뒤 또 바뀐 카드를 덮어씀");
  assert.match(s.getItem(STORAGE_KEY)!, /가상 다른 창/);
  // 새 경고(지금 버전)를 보고 확인하면 그때 저장
  const okNow = saveCard(s, edited, again.status === "conflict" ? again.currentRaw : null);
  assert.equal(okNow.status, "saved");
  assert.match(s.getItem(STORAGE_KEY)!, /가상 A 고침/);
});

test("지우기도 확인한 버전에만: 확인 뒤 다른 창에서 새로 저장된 카드는 지우지 않는다", () => {
  const s = new MemoryStore();
  const a = saveCard(s, normalize({ foods: [], people: [], message: "가상 옛 카드" }, NOW), null);
  const confirmed = a.status === "saved" ? a.raw : null;
  const b = saveCard(s, normalize({ foods: [], people: [], message: "가상 새 카드" }, NOW), confirmed); // 다른 창 저장
  assert.equal(b.status, "saved");
  const r = clearCard(s, confirmed);
  assert.equal(r.status, "conflict", "새 카드를 확인 없이 지움");
  assert.match(s.getItem(STORAGE_KEY)!, /가상 새 카드/);
  assert.deepEqual(clearCard(s, r.status === "conflict" ? r.currentRaw : null), { status: "cleared" }, "새 카드를 보고 다시 확인하면 지움");
  assert.deepEqual(clearCard(s, "아무 값"), { status: "cleared" }, "이미 없으면 지운 것으로");
});

test("한 번 읽은 값으로 카드와 비교 기준을 함께 정한다 (두 번 읽는 사이 삭제돼도 어긋나지 않음)", () => {
  const s = new MemoryStore();
  const w = saveCard(s, normalize({ foods: [], people: [], message: "가상" }, NOW), null);
  const snap = snapshot(s);
  assert.equal(snap.result.status, "ok");
  assert.equal(snap.raw, w.status === "saved" ? w.raw : undefined);
  // 읽은 뒤 다른 창이 지워도, 이 화면의 기준은 읽은 카드 → 평범한 저장은 충돌로 멈춤
  s.removeItem(STORAGE_KEY);
  assert.equal(saveCard(s, normalize({ foods: [], people: [], message: "가상 고침" }, NOW), snap.raw).status, "conflict");
  assert.deepEqual(snapshot(null), { result: { status: "unavailable" }, raw: null });
  assert.equal(sameContent(normalize({ foods: [], people: ["가"], message: "x" }, NOW), normalize({ foods: [], people: ["가"], message: "x" }, new Date(0))), true);
});

test("저장소를 쓸 수 없거나, 용량 초과로 쓰기가 실패하면 성공으로 표시하지 않는다. 읽기만 되면 기존 카드는 보인다", () => {
  const card = normalize({ foods: [], people: [], message: "가상" }, NOW);
  assert.deepEqual(loadCard(null), { status: "unavailable" });
  assert.deepEqual(saveCard(null, card, null), { status: "failed" });
  const throwing: KeyValueStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadCard(throwing), { status: "unavailable" });
  assert.deepEqual(saveCard(throwing, card, null), { status: "failed" });
  assert.deepEqual(clearCard(throwing, null), { status: "failed" });
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
  assert.deepEqual(clearCard(sticky, "x"), { status: "failed" }, "지워지지 않으면 실패");
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
  // 화면과 비교 기준은 한 번 읽은 값으로 함께 정한다 (따로 두 번 읽으면 사이에 삭제될 때 어긋남)
  assert.ok(!/loadCard\(/.test(code), "화면이 저장소를 따로 두 번 읽음");
});

test("힘든 날 카드는 로그인·기록 저장·Supabase 코드를 가져오지 않고, 미들웨어를 거치지 않는다", () => {
  const files = listFiles(join(SRC, "app", "hardday")).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 0);
  assert.deepEqual(violations(files), []);
  const mw = readFileSync(join(SRC, "middleware.ts"), "utf8");
  assert.match(mw.match(/matcher\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "", /\|hardday\|/);
});

// 가상 잠금: 같은 이름이면 하나씩 차례로, signal로 기다림을 그만둘 수 있다 (navigator.locks 흉내)
class FakeLocks implements LockManagerLike {
  tail: Promise<void> = Promise.resolve();
  names: string[] = [];
  request(name: string, opts: { mode: "exclusive"; signal: AbortSignal }, cb: () => unknown): Promise<unknown> {
    this.names.push(name);
    const prev = this.tail;
    let done!: () => void;
    this.tail = new Promise<void>((r) => (done = r));
    return new Promise((resolve, reject) => {
      let started = false;
      opts.signal.addEventListener("abort", () => {
        if (!started) {
          prev.then(done);
          reject(new DOMException("abort", "AbortError"));
        }
      });
      prev.then(async () => {
        if (opts.signal.aborted) return;
        started = true;
        try {
          resolve(await cb());
        } finally {
          done();
        }
      });
    });
  }
}

test("저장·지우기는 탭 사이 잠금 안에서: 다른 탭이 잠금을 쥐고 쓰는 동안 기다렸다가, 다시 읽어 비교한다", async () => {
  const s = new MemoryStore();
  const locks = new FakeLocks();
  const first = saveCard(s, normalize({ foods: [], people: [], message: "가상 처음" }, NOW), null);
  const base = first.status === "saved" ? first.raw : null;
  // 다른 탭: 잠금을 쥐고 카드를 바꾼다 (끝나기 전까지 이 탭은 기다림)
  let release!: () => void;
  const otherTab = locks.request(LOCK_NAME, { mode: "exclusive", signal: new AbortController().signal }, async () => {
    await new Promise<void>((r) => (release = r));
    s.setItem(STORAGE_KEY, JSON.stringify(normalize({ foods: [], people: [], message: "가상 다른 탭" }, NOW)));
  });
  const mine = withCardLock(locks, () => saveCard(s, normalize({ foods: [], people: [], message: "가상 이 탭" }, NOW), base), 1000);
  await new Promise((r) => setTimeout(r, 20));
  release();
  await otherTab;
  const r = await mine;
  assert.equal(r.status, "done");
  if (r.status === "done") assert.equal(r.value.status, "conflict", "잠금 뒤 다시 비교하지 않고 덮어씀");
  assert.match(s.getItem(STORAGE_KEY)!, /가상 다른 탭/);
  assert.deepEqual(locks.names, [LOCK_NAME, LOCK_NAME], "같은 이름의 잠금");
});

test("잠금을 쓸 수 없으면 저장·지우기를 하지 않고, 시간 안에 못 얻으면 실행하지 않는다", async () => {
  let ran = false;
  assert.deepEqual(await withCardLock(null, () => (ran = true)), { status: "unsupported" });
  assert.deepEqual(await withCardLock({} as LockManagerLike, () => (ran = true)), { status: "unsupported" });
  const locks = new FakeLocks();
  let release!: () => void;
  const holder = locks.request(LOCK_NAME, { mode: "exclusive", signal: new AbortController().signal }, () => new Promise<void>((r) => (release = r)));
  assert.deepEqual(await withCardLock(locks, () => (ran = true), 30), { status: "busy" });
  assert.equal(ran, false, "잠금 없이 실행됨");
  release();
  await holder;
  assert.deepEqual(await withCardLock(locks, () => 7, 30), { status: "done", value: 7 });
});
