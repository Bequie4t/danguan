import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BURDEN_OPTIONS } from "../src/lib/checkins/model";
import { ULI_LABEL, latestOwnBurden, uliStateFor, type UliState } from "../src/lib/uli";
import Uli from "../src/components/Uli";

test("울이는 고른 버거움 하나를 그대로 따른다", () => {
  assert.equal(uliStateFor("okay"), "light");
  assert.equal(uliStateFor("bearable"), "bearable");
  assert.equal(uliStateFor("heavy"), "heavy");
  assert.equal(uliStateFor("very_heavy"), "very_heavy");
  assert.equal(uliStateFor("unsure"), "unsure");
});

test("기록이 없으면 '괜찮음'으로 바꾸지 않고 기본 모습을 보여 준다", () => {
  assert.equal(uliStateFor(null), "rest");
  assert.equal(uliStateFor(undefined), "rest");
  assert.notEqual(uliStateFor(null), uliStateFor("okay"));
});

test("모든 버거움 선택지에 울이 모습이 있다", () => {
  for (const o of BURDEN_OPTIONS) {
    const s = uliStateFor(o.value);
    assert.notEqual(s, "rest", o.value);
    assert.ok(ULI_LABEL[s]);
  }
});

const STATES: UliState[] = ["light", "bearable", "heavy", "very_heavy", "unsure", "rest"];

test("울이 그림은 화면 낭독기용 이름이 있고, 장식일 때는 숨긴다", () => {
  for (const state of STATES) {
    const html = renderToStaticMarkup(createElement(Uli, { state }));
    assert.match(html, /^<svg/);
    assert.ok(html.includes(`aria-label="${ULI_LABEL[state]}"`), state);
    assert.ok(html.includes('role="img"'), state);
    const deco = renderToStaticMarkup(createElement(Uli, { state, decorative: true }));
    assert.ok(deco.includes('aria-hidden="true"'), state);
    assert.ok(!deco.includes("aria-label"), state);
  }
});

test("울이 색은 테마 변수만 써서 어두운 화면도 따른다", () => {
  for (const state of STATES) {
    const html = renderToStaticMarkup(createElement(Uli, { state }));
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(html), `${state}: 고정 색 코드가 있음`);
    assert.ok(html.includes("var(--uli-ink)"), state);
  }
});

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const rec = (owner_id: string, occurred_at: string, burden: "okay" | "heavy" | "very_heavy" | "unsure", recorded_at = occurred_at) => ({
  owner_id,
  occurred_at,
  recorded_at,
  burden,
});

test("울이는 내 기록 중 경험한 시점이 가장 늦은 하나만 따른다 (순서와 무관)", () => {
  const records = [
    rec(A, "2026-11-01T09:00:00Z", "okay"),
    rec(A, "2026-11-03T09:00:00Z", "very_heavy"),
    rec(A, "2026-11-02T09:00:00Z", "heavy"),
  ];
  assert.equal(latestOwnBurden(records, A), "very_heavy");
  assert.equal(latestOwnBurden([...records].reverse(), A), "very_heavy");
});

test("다른 사람의 기록은 울이에 반영하지 않는다", () => {
  const records = [rec(B, "2026-11-09T09:00:00Z", "okay"), rec(A, "2026-11-01T09:00:00Z", "heavy")];
  assert.equal(latestOwnBurden(records, A), "heavy");
  assert.equal(latestOwnBurden([rec(B, "2026-11-09T09:00:00Z", "okay")], A), null);
});

test("같은 시점이면 나중에 입력한 기록을 따르고, 평균을 내지 않는다", () => {
  const t = "2026-11-05T09:00:00Z";
  const records = [rec(A, t, "okay", "2026-11-05T09:01:00Z"), rec(A, t, "very_heavy", "2026-11-05T09:05:00Z"), rec(A, t, "okay", "2026-11-05T09:02:00Z")];
  assert.equal(latestOwnBurden(records, A), "very_heavy");
});

test("기록이 없으면 null → 울이는 기본 모습", () => {
  assert.equal(latestOwnBurden([], A), null);
  assert.equal(uliStateFor(latestOwnBurden([], A)), "rest");
});
