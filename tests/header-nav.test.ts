// 머리글 링크: 지금 화면 링크를 다시 눌러도 새로 열지 않는다 (작성 중 입력 보호). 도움 버튼은 그대로.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCurrentPage, shouldStay } from "../src/components/HeaderNav";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

test("지금 화면인지: 쿼리·해시·끝의 / 무시, 다른 화면·하위 경로는 아님", () => {
  assert.equal(isCurrentPage("/today", "/today"), true);
  assert.equal(isCurrentPage("/today/", "/today"), true);
  assert.equal(isCurrentPage("/today?x=1#a", "/today"), true);
  assert.equal(isCurrentPage("/", "/"), true);
  assert.equal(isCurrentPage("/records", "/today"), false);
  assert.equal(isCurrentPage("/today/extra", "/today"), false);
  assert.equal(isCurrentPage("/", "/today"), false);
  assert.equal(isCurrentPage(null, "/today"), false);
});

test("같은 화면 링크의 일반 클릭만 머무르고, 새 탭 조합키·가운데 클릭은 브라우저에 맡긴다", () => {
  assert.equal(shouldStay("/today", "/today", click), true);
  assert.equal(shouldStay("/records", "/today", click), false, "다른 화면으로는 그대로 이동");
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) assert.equal(shouldStay("/today", "/today", { ...click, [k]: true }), false, k);
  assert.equal(shouldStay("/today", "/today", { ...click, button: 1 }), false);
});

test("머리글: 링크는 next/link 없이 일반 <a>, 도움 버튼은 HeaderNav 밖에서 항상 그대로", () => {
  const nav = readFileSync(join(__dirname, "..", "src", "components", "HeaderNav.tsx"), "utf8");
  assert.ok(!/from\s+["']next\/link["']/.test(nav), "next/link를 쓰면 도움 화면이 홈·로그인 코드를 내려받음");
  assert.ok(!nav.includes('"/help"'), "도움 버튼은 같은 화면 처리 대상이 아님");
  const layout = readFileSync(join(__dirname, "..", "src", "app", "layout.tsx"), "utf8");
  assert.match(layout, /<a\s+href="\/help"[\s\S]*?도움이 필요해요\s*<\/a>/);
  assert.match(layout, /<HeaderNav \/>/);
});
