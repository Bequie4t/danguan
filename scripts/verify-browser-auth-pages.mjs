// 실제 Next HTTP, 가상 설정/쿠키만 사용. 실제 Supabase로 요청하지 않는다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const origin = "http://127.0.0.1:3197";
const browserMode = process.argv.includes("--browser");
const cases = browserMode ? [["preview", "https://wxqmqksqjmfflzghozuq.supabase.co", "true", true]] : [
  ["preview", "https://wxqmqksqjmfflzghozuq.supabase.co", "true", true],
  ["production", "https://wxqmqksqjmfflzghozuq.supabase.co", "true", false],
  ["preview", "https://wxqmqksqjmfflzghozuq.supabase.co", "false", false],
  ["preview", "https://synthetic-other.invalid", "true", false],
];
for (const [environment, database, flag, enabled] of cases) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3197", "-H", "127.0.0.1"], {
    stdio: "ignore",
    env: { ...process.env, VERCEL_ENV: environment, NEXT_PUBLIC_SUPABASE_URL: database, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-public-key", TEST_BROWSER_AUTH_PREVIEW_ENABLED: flag },
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("local Next stopped");
      try { if ((await fetch(`${origin}/help`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready);
    for (const path of ["/today", "/records", "/consent", "/account"]) {
      const response = await fetch(origin + path, { redirect: "manual" });
      assert.equal(response.status, enabled ? 200 : 307);
      assert.equal(response.headers.get("set-cookie"), null);
      if (enabled) {
        assert.match(response.headers.get("cache-control"), /private.*no-store/);
        assert.match(await response.text(), /로그인 상태를 확인하는 중/);
      } else assert.match(response.headers.get("location"), /\/login\?next=/);
    }
    if (browserMode) {
      const { chromium } = await import(pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const pageA = await context.newPage();
      const pageB = await context.newPage();
      await pageA.goto(origin + "/help");
      await pageB.goto(origin + "/help");
      const name = "sb-wxqmqksqjmfflzghozuq-auth-token";
      await context.addCookies([{ name, value: "synthetic-A", url: origin }]);
      let release;
      let started;
      const held = new Promise(resolve => { release = resolve; });
      const began = new Promise(resolve => { started = resolve; });
      await pageA.route("**/records", async route => {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["set-cookie"], undefined);
        started();
        await held;
        await route.fulfill({ response });
      });
      const pending = pageA.evaluate(() => fetch("/records").then(r => r.status));
      await began;
      await context.addCookies([{ name, value: "synthetic-B", url: origin }]);
      release();
      assert.equal(await pending, 200);
      assert.ok((await pageA.evaluate(() => document.cookie)).includes(`${name}=synthetic-B`));
      assert.ok((await pageB.evaluate(() => document.cookie)).includes(`${name}=synthetic-B`));
      console.log("DELAYED_NEXT_PAGE_PRESERVES_B_COOKIE");
    }
  } finally {
    await browser?.close();
    if (child.exitCode === null) {
      const done = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await done;
    }
  }
}
console.log("BROWSER_PAGE_AUTH_HTTP_GATE_PASSED");
