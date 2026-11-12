// 부탁하기 (4단계): 문장 규칙, 화면 상태, 로그인·저장 코드와의 독립성. 가상 값만.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_OPTIONS,
  SOFTENER,
  askReducer,
  buildSentence,
  clean,
  currentText,
  initialAskState,
  smsHref,
  vocative,
  type AskKind,
} from "../src/lib/ask/sentence";
import { SRC, listFiles, violations } from "./helpers/import-graph";

const KINDS = ASK_OPTIONS.map((o) => o.kind);

test("상황 4가지마다 빈칸 표시 없이 바로 보낼 수 있는 문장이 만들어진다", () => {
  assert.deepEqual(KINDS, ["clinic", "meal", "call", "booking"]);
  for (const kind of KINDS) {
    for (const soften of [true, false]) {
      const t = buildSentence({ kind, name: "", detail: "", soften });
      assert.ok(t.length > 10, kind);
      assert.ok(!/[[\]{}]|undefined|null/.test(t), `${kind}: ${t}`);
      assert.equal(t.includes(SOFTENER), soften, kind);
      assert.ok(t.includes("?"), `${kind}: 부탁은 질문으로 끝나 거절할 여지를 남긴다`);
    }
  }
});

test("칸 값이 문장에 들어가고, 대괄호·여러 칸 공백은 정리된다", () => {
  assert.match(buildSentence({ kind: "clinic", name: "", detail: "이번 주 목요일 오후", soften: false }), /^이번 주 목요일 오후 병원 가는데/);
  assert.match(buildSentence({ kind: "meal", name: "", detail: "  [죽]  ", soften: false }), /이거면 돼: 죽\.$/);
  assert.match(buildSentence({ kind: "call", name: "", detail: "저녁", soften: false }), /저녁에 전화 한 번만/);
  // 칸이 없는 상황은 칸 값을 무시
  assert.equal(
    buildSentence({ kind: "booking", name: "", detail: "무시됨", soften: false }),
    buildSentence({ kind: "booking", name: "", detail: "", soften: false }),
  );
  assert.equal(clean("a\n\n b  [c]", 10), "a b c");
  // 칸 값으로 끝나도 문장 끝맺음이 있어 덧붙이는 한마디와 붙어 읽히지 않는다
  assert.match(buildSentence({ kind: "meal", name: "", detail: "죽", soften: true }), /죽\. 어려우면/);
  assert.match(buildSentence({ kind: "meal", name: "", detail: "김밥!", soften: true }), /김밥! 어려우면/);
});

test("받는 사람 이름: 받침에 따라 아/야, 한글이 아니면 쉼표만, 비우면 없음", () => {
  assert.equal(vocative("민지"), "민지야, ");
  assert.equal(vocative("지훈"), "지훈아, ");
  assert.equal(vocative("Alex"), "Alex, ");
  assert.equal(vocative("   "), "");
  assert.match(buildSentence({ kind: "call", name: "지훈", detail: "", soften: false }), /^지훈아, 오늘은/);
});

test("메시지 앱 주소: 받는 번호 없이 본문만, 한글·줄바꿈·특수문자 안전하게", () => {
  const href = smsHref("민지야, 병원 & 같이?\n고마워");
  assert.ok(href.startsWith("sms:?&body="));
  assert.equal(decodeURIComponent(href.slice("sms:?&body=".length)), "민지야, 병원 & 같이?\n고마워");
  assert.ok(!href.includes(" ") && !href.includes("&같") && !/body=.*&(?!body)/.test(href.replace("?&body", "")));
});

test("직접 고친 문장은 다른 칸을 바꿔도 덮어쓰지 않고, '처음 문장으로'를 눌러야 다시 만든다", () => {
  let s = askReducer(initialAskState, { type: "edit", value: "가상 직접 쓴 문장" });
  s = askReducer(s, { type: "name", value: "민지" });
  s = askReducer(s, { type: "detail", value: "내일" });
  s = askReducer(s, { type: "soften", value: false });
  assert.equal(currentText(s), "가상 직접 쓴 문장");
  s = askReducer(s, { type: "regenerate" });
  assert.match(currentText(s), /^민지야, 내일 병원 가는데/);
});

test("상황을 바꾸면 그 상황의 새 문장, 칸 값은 비움 (이름은 유지)", () => {
  let s = askReducer(initialAskState, { type: "name", value: "민지" });
  s = askReducer(s, { type: "detail", value: "내일" });
  s = askReducer(s, { type: "edit", value: "가상 고친 문장" });
  s = askReducer(s, { type: "pick", kind: "meal" as AskKind });
  assert.equal(s.detail, "");
  assert.equal(s.edited, null);
  assert.match(currentText(s), /^민지야, 오늘 밥 좀 시켜 줄 수 있어/);
});

test("복사는 '보냄'이 아니다: 상태는 copied/failed뿐이고, 내용을 바꾸면 안내가 사라진다", () => {
  let s = askReducer(initialAskState, { type: "copied", ok: true });
  assert.equal(s.copied, "copied");
  s = askReducer(s, { type: "name", value: "가" });
  assert.equal(s.copied, "idle");
  assert.ok(!Object.keys(s).some((k) => /sent|send/i.test(k)), "보냄 상태를 두지 않음");
  assert.deepEqual(askReducer(s, { type: "reset" }), initialAskState);
});

test("이름·칸·문장 길이 제한", () => {
  const long = "가".repeat(600);
  assert.equal(askReducer(initialAskState, { type: "name", value: long }).name.length, 20);
  assert.equal(askReducer(initialAskState, { type: "edit", value: long }).edited?.length, 500);
});

test("화면 문구에 '보냈어요'·'전송 완료' 같은 말이 없다 (앱이 대신 보내지 않음)", () => {
  const code = readFileSync(join(SRC, "components", "AskBuilder.tsx"), "utf8");
  assert.ok(!/보냈어요|전송 완료|발송 완료|보내는 중/.test(code));
  assert.ok(code.includes("앱이 대신 보내지 않아요"));
  assert.ok(!/console\.|fetch\(|localStorage|sessionStorage|indexedDB/.test(code), "로그·네트워크·저장 없음");
});

test("부탁하기는 로그인·기록 저장·Supabase 코드를 가져오지 않는다 (import를 끝까지 따라감)", () => {
  const files = listFiles(join(SRC, "app", "ask")).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 0);
  assert.deepEqual(violations(files), []);
  const mw = readFileSync(join(SRC, "middleware.ts"), "utf8");
  assert.match(mw.match(/matcher\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "", /\|ask\|/, "미들웨어가 /ask를 거치지 않음");
});
