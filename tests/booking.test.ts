// 예약 대본 (5단계): 대본 규칙, 화면 상태, 걱정 풀기의 출처, 로그인·저장 코드와의 독립성. 가상 값만.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASK_ITEMS,
  IF_STUCK,
  THEY_MAY_ASK,
  WORRIES,
  WORRIES_CHECKED_ON,
  bookingReducer,
  buildCallScript,
  buildTextMessage,
  canSendMessage,
  cleanWhen,
  currentMessage,
  initialBookingState,
  type BookingInput,
} from "../src/lib/booking/script";
import { ROOT, SRC, listFiles, violations } from "./helpers/import-graph";

const base: BookingInput = { channel: "call", visit: "first", when: "", asks: [] };
const said = (i: BookingInput) => buildCallScript(i).flatMap((s) => s.say);

test("전화 대본: 인사 → 처음인지 → 날짜 → (물을 것) → 끝내기 순서", () => {
  assert.deepEqual(buildCallScript(base).map((s) => s.id), ["hello", "visit", "when", "close"]);
  assert.deepEqual(buildCallScript({ ...base, asks: ["cost"] }).map((s) => s.id), ["hello", "visit", "when", "ask", "close"]);
  assert.ok(said(base).includes("이 병원은 처음이에요."));
  assert.ok(said({ ...base, visit: "again" }).includes("전에 다닌 적이 있어요."));
});

test("원하는 때: 넣으면 그 날로 묻고, 비우면 가장 빠른 날을 묻는다. 괄호·공백 정리", () => {
  assert.ok(said({ ...base, when: "이번 주 목요일 오후" }).includes("이번 주 목요일 오후에 예약할 수 있을까요?"));
  assert.ok(said(base).includes("가장 빠른 날이 언제인지 알 수 있을까요?"));
  assert.ok(said({ ...base, when: "   " }).includes("가장 빠른 날이 언제인지 알 수 있을까요?"));
  assert.equal(cleanWhen("  [다음 주]\n 월요일 "), "다음 주 월요일");
  assert.equal(cleanWhen("가".repeat(50)).length, 30);
});

test("물어볼 것: 화면 순서대로, 중복 없이", () => {
  const lines = buildCallScript({ ...base, asks: ["bring", "cost", "cost"] }).find((s) => s.id === "ask")!.say;
  assert.deepEqual(lines, [ASK_ITEMS[0].line, ASK_ITEMS[2].line]);
});

test("글 문의: 한 문단으로 바로 보낼 수 있고, 빈칸 표시가 없다", () => {
  const t = buildTextMessage({ ...base, channel: "text", when: "[내일]", asks: ["duration"] });
  assert.equal(t, "안녕하세요, 진료 예약 문의드려요. 이 병원은 처음이에요. 내일에 예약할 수 있을까요? 첫 진료는 시간이 얼마나 걸리나요? 감사합니다.");
  assert.ok(!/[[\]{}<>]|undefined|null/.test(t));
});

test("직접 고친 글은 다른 선택을 바꿔도 덮어쓰지 않고, '처음 글로'를 눌러야 다시 만든다", () => {
  let s = bookingReducer(initialBookingState, { type: "channel", value: "text" });
  s = bookingReducer(s, { type: "edit", value: "가상 직접 쓴 문의" });
  s = bookingReducer(s, { type: "visit", value: "again" });
  s = bookingReducer(s, { type: "when", value: "금요일" });
  s = bookingReducer(s, { type: "toggleAsk", id: "cost", on: true });
  assert.equal(currentMessage(s), "가상 직접 쓴 문의");
  s = bookingReducer(s, { type: "regenerate" });
  assert.match(currentMessage(s), /전에 다닌 적이 있어요\. 금요일에 예약할 수 있을까요\? 첫 진료 때 비용/);
  s = bookingReducer(s, { type: "toggleAsk", id: "cost", on: false });
  assert.ok(!currentMessage(s).includes("비용"));
  s = bookingReducer(s, { type: "copied", ok: true, text: currentMessage(s) });
  assert.equal(s.copied, "copied");
  assert.equal(bookingReducer(s, { type: "when", value: "토" }).copied, "idle", "바꾸면 복사 안내가 사라짐");
  assert.deepEqual(bookingReducer(s, { type: "reset" }), initialBookingState);
});

test("복사하는 사이 글이 바뀌면 이전 글의 복사 결과를 표시하지 않고, 빈 글은 보낼 수 없다", () => {
  let s = bookingReducer(initialBookingState, { type: "channel", value: "text" });
  const a = currentMessage(s);
  s = bookingReducer(s, { type: "edit", value: "가상 B 문의" });
  s = bookingReducer(s, { type: "copied", ok: true, text: a });
  assert.equal(s.copied, "idle");
  s = bookingReducer(s, { type: "copied", ok: true, text: "가상 B 문의" });
  assert.equal(s.copied, "copied");
  // 방법을 전화로 바꿨다가 돌아와도 고친 글은 그대로
  s = bookingReducer(s, { type: "channel", value: "call" });
  s = bookingReducer(s, { type: "channel", value: "text" });
  assert.equal(currentMessage(s), "가상 B 문의");
  assert.equal(canSendMessage("  \n"), false);
  s = bookingReducer(s, { type: "edit", value: "   " });
  s = bookingReducer(s, { type: "copied", ok: true, text: "   " });
  assert.notEqual(s.copied, "copied");
});

// 화면에 나오는 모든 문장 (대본·도움말·걱정 풀기)
function allText(): string[] {
  const out: string[] = [];
  for (const channel of ["call", "text"] as const)
    for (const visit of ["first", "again"] as const)
      for (const asks of [[], ["cost", "duration", "bring"]] as const) {
        const i = { channel, visit, when: "내일", asks };
        out.push(buildTextMessage(i));
        for (const s of buildCallScript(i)) out.push(s.title, ...s.say, s.tip ?? "");
      }
  for (const t of THEY_MAY_ASK) out.push(t.q, ...t.say, t.tip ?? "");
  out.push(...IF_STUCK, ...ASK_ITEMS.map((a) => a.label));
  for (const w of WORRIES) out.push(w.title, ...w.body);
  const code = readFileSync(join(SRC, "components", "BookingScript.tsx"), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  out.push(code);
  return out;
}

test("진단·치료·완치·처방 표현과 재촉·죄책감 표현을 쓰지 않는다", () => {
  for (const t of allText()) {
    assert.ok(!/진단|치료|완치|처방/.test(t), `금지 표현: ${t.slice(0, 60)}`);
    assert.ok(!/꼭 (전화|예약)|(^|\s)어서\s|왜 아직|미루지 마/.test(t), `재촉 표현: ${t.slice(0, 60)}`);
  }
});

test("걱정 풀기: 비용은 숫자로 단정하지 않고, 법·제도를 말하는 항목은 출처가 있다. 확인 날짜 기록", () => {
  const cost = WORRIES.find((w) => w.id === "cost")!;
  assert.ok(!/\d|원\b|만 원|퍼센트|%/.test(cost.body.join(" ")), "비용 금액·비율을 단정함");
  for (const w of WORRIES.filter((w) => /법|보험|계약/.test(w.body.join(" ")))) {
    assert.ok(w.sources.length > 0, `${w.id}: 출처 없음`);
    for (const s of w.sources) assert.match(s.url, /^https:\/\/www\.law\.go\.kr\//);
  }
  assert.match(WORRIES_CHECKED_ON, /^\d{4}-\d{2}-\d{2}$/);
  const doc = join(ROOT, "docs", "booking-sources.md");
  assert.ok(existsSync(doc), "docs/booking-sources.md 없음");
  const md = readFileSync(doc, "utf8");
  assert.ok(md.includes(WORRIES_CHECKED_ON), "출처 문서의 확인 날짜가 화면과 다름");
  for (const w of WORRIES) assert.ok(md.includes(w.title), `출처 문서에 '${w.title}' 없음`);
});

test("앱이 대신 연락하지 않는다: 병원 번호를 받거나 전화를 거는 코드 없음, 저장·네트워크·로그 없음", () => {
  const code = readFileSync(join(SRC, "components", "BookingScript.tsx"), "utf8");
  assert.ok(!/console\.|fetch\(|localStorage|sessionStorage|indexedDB/.test(code));
  const tels = [...code.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tels, ["15770199"], "상담전화 외의 전화 걸기 없음");
  assert.ok(!/type="tel"/.test(code), "병원 번호 입력칸 없음");
  assert.ok(!/보냈어요|예약했어요|예약 완료|전송 완료/.test(code), "보냄·예약 완료로 표시하지 않음");
});

test("예약 대본은 로그인·기록 저장·Supabase 코드를 가져오지 않고, 미들웨어를 거치지 않는다", () => {
  const files = listFiles(join(SRC, "app", "booking")).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length > 0);
  assert.deepEqual(violations(files), []);
  const mw = readFileSync(join(SRC, "middleware.ts"), "utf8");
  assert.match(mw.match(/matcher\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "", /\|booking\|/);
});
