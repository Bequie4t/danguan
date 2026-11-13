// 도움 화면(/help)은 로그인·기록 저장·Supabase 설정과 독립이어야 한다 (CLAUDE.md 3장).
// 도움 화면 파일에서 시작해 import를 끝까지 따라가며, 금지된 모듈에 닿지 않는지 확인한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FORBIDDEN, ROOT, SRC, listFiles, walk } from "./helpers/import-graph";

const helpFiles = listFiles(join(SRC, "app", "help")).filter((f) => /\.(ts|tsx)$/.test(f));

test("도움 화면 파일이 있다 (page·contacts·연락처 파일 내려받기)", () => {
  const names = helpFiles.map((f) => relative(SRC, f));
  for (const need of ["app/help/page.tsx", "app/help/contacts.ts", "app/help/contact-card/route.ts"]) {
    assert.ok(names.some((n) => n.split("\\").join("/") === need), need);
  }
});

test("도움 화면은 로그인·기록 저장·Supabase 코드를 가져오지 않는다 (import를 끝까지 따라감)", () => {
  const { files, packages } = walk(helpFiles);
  for (const [file, via] of files) {
    for (const rule of FORBIDDEN) assert.ok(!rule.test("", file), `${rule.why}에 닿음: ${via.join(" → ")}`);
  }
  for (const { spec, via } of packages) {
    for (const rule of FORBIDDEN) assert.ok(!rule.test(spec, null), `${rule.why}(${spec})에 닿음: ${via.join(" → ")}`);
  }
});

test("시험이 실제로 잡는지: 금지 모듈을 가져오는 파일이면 걸린다", () => {
  // 기록 화면은 Supabase·기록 코드를 쓰므로, 같은 검사를 하면 반드시 걸려야 한다
  const { files, packages } = walk([join(SRC, "components", "HomeCheckin.tsx")]);
  const hit =
    [...files.keys()].some((f) => FORBIDDEN.some((r) => r.test("", f) && !f.endsWith("HomeCheckin.tsx"))) ||
    packages.some(({ spec }) => FORBIDDEN.some((r) => r.test(spec, null)));
  assert.ok(hit, "검사가 금지 모듈을 찾지 못함");
});

test("미들웨어가 도움 화면을 건드리지 않는다 (matcher에서 /help 제외)", () => {
  const mw = join(SRC, "middleware.ts");
  if (!existsSync(mw)) return;
  const code = readFileSync(mw, "utf8");
  const matcher = code.match(/matcher\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  assert.ok(matcher.includes("help"), `미들웨어 matcher에 help 제외가 없음: ${matcher.trim()}`);
});

test("공통 머리글(layout)은 로그인 코드를 바로 가져오지 않는다 (도움 화면에서 불러오지 않도록 필요할 때만 불러옴)", () => {
  const { files, packages } = walk([join(SRC, "app", "layout.tsx")], true);
  for (const [file, via] of files) {
    for (const rule of FORBIDDEN.slice(0, 5)) assert.ok(!rule.test("", file), `${rule.why}에 닿음: ${via.join(" → ")}`);
  }
  for (const { spec, via } of packages) assert.ok(!spec.startsWith("@supabase/"), `${spec}에 닿음: ${via.join(" → ")}`);
  // 계정 메뉴는 로그인 코드를 import() 로만 불러온다
  const menu = readFileSync(join(SRC, "components", "AccountMenu.tsx"), "utf8");
  assert.match(menu, /import\(\s*["']@\/lib\/supabase\/client["']\s*\)/);
  assert.match(readFileSync(join(SRC, "app", "layout.tsx"), "utf8"), /<QuietBoundary>\s*<AccountMenu \/>/);
});
