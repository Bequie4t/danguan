// 실제 화면 컴포넌트 + 모의 인증·DB. 실서비스 로그인·Supabase DB E2E가 아니다.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = resolve(root, "scripts/browser/fixture.jsx");
const work = await mkdtemp(resolve(tmpdir(), "danguan-browser-"));
const { chromium } = process.env.TEST_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href)
  : await import("playwright");
await build({
  absWorkingDir: root, entryPoints: [fixturePath], bundle: true,
  outfile: resolve(work, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "isolated-browser-fixture", setup(b) {
    b.onResolve({ filter: /^@\/lib\/supabase\/(client|pinned)$/ }, () => ({ path: fixturePath }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: "js", resolveDir: root }));
  } }],
});
const js = await readFile(resolve(work, "fixture.js"));
const cssDir = resolve(root, ".next/static/css");
const css = (await Promise.all((await readdir(cssDir)).filter((p) => p.endsWith(".css")).map((p) => readFile(resolve(cssDir, p), "utf8")))).join("\n");
const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "text/javascript"); res.end(js); }
  else if (req.url.startsWith("/style.css")) { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else if (req.url.startsWith("/login")) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><h1>가상 로그아웃 화면</h1></body></html>'); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main id="root" class="mx-auto max-w-3xl px-4 pt-6"></main><script src="/fixture.js"></script></body></html>'); }
});
let browser;
let passed = 0;
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const fresh = async (screen = "form") => {
      await page.goto(`${base}/?screen=${screen}`);
      await page.getByRole("heading", { name: screen === "form" ? "지금 어느 정도 버거운가요?" : screen === "consent" ? "기록을 계정에 저장하기 전에" : screen === "account" ? "계정 삭제" : "내 기록", exact: true }).waitFor();
      if (screen === "records") await page.getByText("가상 A 기록", { exact: true }).waitFor();
    };
    const prepare = async (note) => {
      await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).click();
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.locator("#note").fill(note);
    };
    const scenario = async (name, fn) => {
      await fn();
      assert.deepEqual(errors, [], "브라우저 예외 없음");
      passed++;
      console.log(`PASS ${viewport.width}px ${name}`);
    };

    const prepareDelete = async () => {
      await page.getByText("a@example.invalid", { exact: true }).waitFor();
      await page.getByLabel("비밀번호 다시 입력").fill("synthetic-password");
      await page.getByLabel("확인을 위해 ‘계정 삭제’를 입력해 주세요.").fill("계정 삭제");
    };
    await scenario("삭제 요청은 원래 A 인증으로 고정되고 늦은 성공이 B 화면에 반영되지 않음", async () => {
      await fresh("account");
      await prepareDelete();
      await page.evaluate(() => window.__fixture.hold("delete_account"));
      await page.getByRole("button", { name: "이 계정 삭제", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("delete_account"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("delete_account"); });
      await page.getByText("b@example.invalid", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("비밀번호 다시 입력").inputValue(), "");
      assert.equal(await page.getByLabel("확인을 위해 ‘계정 삭제’를 입력해 주세요.").inputValue(), "");
      assert.equal(await page.getByText("계정과 이 계정의 기록·저장 동의를 삭제했어요.", { exact: false }).count(), 0);
      const snapshot = await page.evaluate(() => window.__fixture.snapshot());
      const writes = snapshot.calls.filter(c => c.operation === "delete_account");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].uid, writes[0].expectedUid);
      assert.equal(writes[0].uid, await page.evaluate(() => window.__fixture.A));
      const b = await page.evaluate(() => window.__fixture.B);
      assert.ok(snapshot.rows.some(r => r.owner_id === b));
    });
    for (const failure of ["delete_wrong_password", "delete_uncertain"]) {
      await scenario(`삭제 ${failure}는 완료로 표시하지 않고 비밀번호를 비운 뒤 재시도`, async () => {
        await fresh("account");
        await prepareDelete();
        await page.evaluate(f => { window.__fixture.failure = f; }, failure);
        await page.getByRole("button", { name: "이 계정 삭제", exact: true }).click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.getByLabel("비밀번호 다시 입력").inputValue(), "");
        assert.equal(await page.getByRole("button", { name: "이 계정 삭제", exact: true }).isDisabled(), true);
        await page.evaluate(() => { window.__fixture.failure = null; });
        await page.getByLabel("비밀번호 다시 입력").fill("synthetic-password");
        await page.getByRole("button", { name: "이 계정 삭제", exact: true }).click();
        await page.getByText("계정과 이 계정의 기록·저장 동의를 삭제했어요.", { exact: false }).waitFor();
      });
    }

    await scenario("늦은 A 동의 조회가 B를 다음 화면으로 보내지 않음", async () => {
      await fresh("consent");
      await page.evaluate(() => { const f = window.__fixture; f.setConsent(f.A, true); f.hold("consents"); f.mount("consent"); });
      await page.waitForFunction(() => window.__fixture.started("consents"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("consents"); });
      await page.getByRole("heading", { name: "기록을 계정에 저장하기 전에", exact: true }).waitFor();
      assert.equal(await page.locator("#consent-check").isChecked(), false);
      assert.equal(new URL(page.url()).searchParams.get("screen"), "consent");
    });

    await scenario("A 동의 체크·지연 저장이 B로 넘어가지 않음", async () => {
      await fresh("consent");
      await page.locator("#consent-check").check();
      await page.evaluate(() => window.__fixture.hold("grant_consent"));
      await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("grant_consent"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("grant_consent"); });
      await page.getByRole("heading", { name: "기록을 계정에 저장하기 전에", exact: true }).waitFor();
      assert.equal(await page.locator("#consent-check").isChecked(), false);
      assert.equal(new URL(page.url()).searchParams.get("screen"), "consent");
      const writes = (await page.evaluate(() => window.__fixture.snapshot())).calls.filter(c => c.operation === "grant_consent");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].uid, await page.evaluate(() => window.__fixture.A));
    });

    await scenario("동의 조회 실패 후 같은 화면에서 다시 확인", async () => {
      await fresh("consent");
      await page.evaluate(() => { window.__fixture.failure = "consent_query_error"; window.__fixture.mount("consent"); });
      await page.getByRole("button", { name: "다시 확인하기", exact: true }).waitFor();
      await page.evaluate(() => { window.__fixture.failure = null; });
      await page.getByRole("button", { name: "다시 확인하기", exact: true }).click();
      await page.getByRole("heading", { name: "기록을 계정에 저장하기 전에", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "다시 확인하기", exact: true }).count(), 0);
    });

    for (const failure of ["session_error", "bad_token", "consent_write_error"]) {
      await scenario(`${failure}: 동의 체크 유지·잠금 해제·재시도`, async () => {
        await fresh("consent");
        await page.locator("#consent-check").check();
        await page.evaluate(failure => { window.__fixture.failure = failure; }, failure);
        await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).click();
        await page.getByText("동의를 저장하지 못했어요. 연결을 확인하고 다시 눌러 주세요.", { exact: true }).waitFor();
        assert.equal(await page.locator("#consent-check").isChecked(), true);
        assert.equal(await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).isEnabled(), true);
        await page.evaluate(() => { window.__fixture.failure = null; });
        await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).click();
        await page.waitForURL(/\/consent-done$/);
      });
    }

    await scenario("A 잔존 콜백: B 전환과 같은 순간 호출해도 요청 없음", async () => {
      await fresh();
      const result = await page.evaluate(async () => {
        const f = window.__fixture; const before = f.snapshot().calls.length;
        f.switchUser(f.B); const r = await f.runStale();
        return { r, before, after: f.snapshot().calls.filter((c) => c.operation === "create_checkin").length };
      });
      assert.equal(result.r.ok, false);
      assert.equal(result.after, 0);
      await page.getByRole("heading", { name: "지금 어느 정도 버거운가요?" }).waitFor();
    });

    await scenario("A 입력이 B 화면으로 넘어가지 않고 B 목록만 표시", async () => {
      await fresh(); await prepare("가상 A 작성 중");
      await page.evaluate(() => window.__fixture.switchUser(window.__fixture.B));
      await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).waitFor();
      await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).click();
      assert.equal(await page.locator("#note").inputValue(), "");
      await page.evaluate(() => window.__fixture.mount("records"));
      await page.getByText("가상 B 기록", { exact: true }).waitFor();
      assert.equal(await page.getByText("가상 A 기록", { exact: true }).count(), 0);
    });

    await scenario("늦은 A 저장 응답을 B 화면에 반영하지 않음", async () => {
      await fresh(); await prepare("가상 A 지연 저장");
      await page.evaluate(() => window.__fixture.hold("create_checkin"));
      await page.getByRole("button", { name: "저장하기", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("create_checkin"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("create_checkin"); });
      await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).waitFor();
      assert.equal(await page.getByText("저장했어요.", { exact: true }).count(), 0);
      const snapshot = await page.evaluate(() => window.__fixture.snapshot());
      const saved = snapshot.rows.find((r) => r.note === "가상 A 지연 저장");
      assert.equal(saved.owner_id, await page.evaluate(() => window.__fixture.A));
    });

    await scenario("응답 유실 뒤 입력·ID 유지하고 재시도 중복 없음", async () => {
      await fresh(); await prepare("가상 재시도 메모");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "저장하기", exact: true }).click();
      await page.getByRole("button", { name: "다시 저장하기", exact: true }).waitFor();
      assert.equal(await page.locator("#note").inputValue(), "가상 재시도 메모");
      await page.getByRole("button", { name: "다시 저장하기", exact: true }).click();
      await page.getByText("저장했어요.", { exact: true }).waitFor();
      const snapshot = await page.evaluate(() => window.__fixture.snapshot());
      const sends = snapshot.calls.filter((c) => c.operation === "create_checkin");
      assert.equal(sends.length, 2); assert.equal(sends[0].id, sends[1].id);
      assert.equal(snapshot.rows.filter((r) => r.note === "가상 재시도 메모").length, 1);
    });

    for (const failure of ["session_error", "bad_token", "request_error"]) {
      await scenario(`${failure}: 저장 잠금 해제·입력 유지·복구`, async () => {
        await fresh(); await prepare("가상 실패 입력");
        await page.evaluate((failure) => { window.__fixture.failure = failure; }, failure);
        await page.getByRole("button", { name: "저장하기", exact: true }).click();
        await page.getByRole("button", { name: "다시 저장하기", exact: true }).waitFor();
        assert.equal(await page.locator("#note").inputValue(), "가상 실패 입력");
        assert.equal(await page.getByRole("button", { name: "저장하기", exact: true }).isEnabled(), true);
        await page.evaluate(() => { window.__fixture.failure = null; });
        await page.getByRole("button", { name: "다시 저장하기", exact: true }).click();
        await page.getByText("저장했어요.", { exact: true }).waitFor();
      });
    }

    await scenario("늦은 A 목록 응답이 B 목록을 덮지 않음", async () => {
      await fresh("records");
      await page.evaluate(() => window.__fixture.hold("checkins"));
      await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("checkins"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("checkins"); });
      await page.getByText("가상 B 기록", { exact: true }).waitFor();
      assert.equal(await page.getByText("가상 A 기록", { exact: true }).count(), 0);
    });

    await scenario("조회·수정·삭제 인증 실패 후 버튼이 복구됨", async () => {
      await fresh("records");
      await page.evaluate(() => { window.__fixture.failure = "bad_token"; });
      await page.getByRole("button", { name: "다시 불러오기", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button", { name: "다시 불러오기", exact: true }).isEnabled(), true);
      await page.getByRole("button", { name: "고치기", exact: true }).click();
      await page.locator("textarea").fill("가상 수정 입력");
      await page.getByRole("button", { name: "고친 내용 저장", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === "고친 내용 저장" && !b.disabled));
      assert.equal(await page.locator("textarea").inputValue(), "가상 수정 입력");
      await page.getByRole("button", { name: "그만두기", exact: true }).click();
      await page.getByRole("button", { name: "지우기", exact: true }).click();
      await page.getByRole("button", { name: "지우기", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === "지우기" && !b.disabled));
      assert.equal((await page.evaluate(() => window.__fixture.snapshot())).rows.length, 2);
    });

    await scenario("화면이 닫힌 뒤 저장 응답이 새 화면을 바꾸지 않음", async () => {
      await fresh(); await prepare("가상 닫힌 화면 입력");
      await page.evaluate(() => window.__fixture.hold("create_checkin"));
      await page.getByRole("button", { name: "저장하기", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("create_checkin"));
      await page.evaluate(() => { const f = window.__fixture; f.mount("records"); });
      await page.getByRole("heading", { name: "내 기록", exact: true }).waitFor();
      await page.evaluate(() => window.__fixture.release("create_checkin"));
      assert.equal(await page.getByText("저장했어요.", { exact: true }).count(), 0);
    });

    await scenario("로그아웃하면 이전 계정 화면에서 빠져나옴", async () => {
      await fresh("records");
      await page.evaluate(() => window.__fixture.switchUser(null));
      await page.waitForURL(/\/login\?signedOut=1$/);
      await page.getByRole("heading", { name: "가상 로그아웃 화면" }).waitFor();
      assert.equal(await page.getByText("가상 A 기록", { exact: true }).count(), 0);
    });
    await context.close();
  }
  console.log(`BROWSER_COMPONENT_TESTS_PASSED ${passed}/${passed}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
