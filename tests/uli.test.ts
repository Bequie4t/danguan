import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BURDEN_OPTIONS } from "../src/lib/checkins/model";
import { ULI_LABEL, uliStateFor, type UliState } from "../src/lib/uli";
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
