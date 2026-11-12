// 실제 앱 전체 화면(공통 머리글 포함)에서 도움 화면·부탁하기·예약 대본을 연다. 모의 부품이 아닌 next start 결과를 본다.
// 사용: node scripts/browser/help-real.mjs <앱 주소> <모드 이름>   (scripts/browser/help-real.sh가 실행)
// 확인: 오류 화면 없음, 번호·도움 버튼·연락처 파일, 로그인 코드가 인증을 시작하지 않음(외부 요청 0건).
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [APP, MODE = "?"] = process.argv.slice(2);
if (!APP) { console.error("앱 주소가 필요합니다"); process.exit(2); }
const { chromium } = process.env.TEST_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href)
  : await import("playwright");

const origin = new URL(APP).origin;
const browser = await chromium.launch();
let failed = 0;
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    const outside = [];
    const scripts = [];
    page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().split("\n")[0]); });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== origin && !r.url().startsWith("data:")) outside.push(u.host);
      if (r.resourceType() === "script") scripts.push(r.url());
    });
    const name = `${MODE} ${viewport.width}px`;
    try {
      const res = await page.goto(`${APP}/help`);
      assert.equal(res.status(), 200, "도움 화면 응답");
      await page.locator('[data-help-number="109"]').waitFor({ timeout: 10000 });
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500); // 늦게 실행되는 머리글 부품까지 기다림
      const body = await page.locator("body").innerText();
      assert.ok(!/Application error|client-side exception|This page couldn/i.test(body), "오류 화면");
      assert.equal(await page.locator("a[href^='tel:']").count(), 4, "전화 링크 4개");
      assert.ok(await page.getByRole("link", { name: "도움이 필요해요" }).isVisible(), "머리글 도움 버튼");
      assert.equal(await page.getByRole("link", { name: "로그인", exact: true }).count(), 0, "도움 화면에서 계정 메뉴가 동작함");
      const described = await page.locator('[data-help-number="109"]').evaluate((a) => document.getElementById(a.getAttribute("aria-describedby"))?.textContent ?? "");
      assert.ok(described.includes("24시간"), "109 링크의 설명 연결");
      assert.deepEqual([...new Set(outside)], [], "도움 화면에서 외부로 나간 요청");
      // 로그인 코드 조각을 내려받지 않았는지 (불러온 스크립트에 인증 라이브러리 흔적이 없어야 함)
      for (const u of scripts) {
        const t = await (await ctx.request.get(u)).text();
        assert.ok(!t.includes("detectSessionInUrl"), `로그인 라이브러리(Supabase Auth)가 담긴 스크립트를 불러옴: ${u.split("/").pop()}`);
      }
      assert.deepEqual(errors, [], `브라우저 오류: ${errors.join(" | ")}`);
      const card = await ctx.request.get(`${APP}/help/contact-card`);
      assert.equal(card.status(), 200, "연락처 파일");
      assert.ok((await card.text()).includes("109"), "연락처 파일 내용");
      console.log(`PASS ${name} 도움 화면 실제 전체 화면`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name} - ${String(e.message).split("\n")[0]}`);
    }
    // 부탁하기(/ask)도 로그인 없이, Supabase 설정이 잘못돼도 쓸 수 있어야 한다.
    // 머리글의 계정 메뉴는 /ask에서 동작하므로 로그인 코드를 불러오는 것은 정상이다 (부탁하기 코드 자체가
    // 로그인 코드를 가져오지 않는 것은 tests/ask.test.ts의 import 검사로 확인).
    // 설정이 잘못된 경우 계정 메뉴의 /login 미리 불러오기가 실패하는 것은 기존 문제라 자원 실패 로그는 따로 센다.
    errors.length = 0; outside.length = 0; scripts.length = 0;
    try {
      const res = await page.goto(`${APP}/ask`);
      assert.equal(res.status(), 200, "부탁하기 응답");
      await page.getByRole("textbox", { name: "보낼 문장" }).waitFor({ timeout: 10000 });
      await page.waitForTimeout(1500); // 늦게 실행되는 머리글 부품까지 기다림
      const body = await page.locator("body").innerText();
      assert.ok(!/Application error|client-side exception|This page couldn/i.test(body), "오류 화면");
      assert.ok(await page.getByRole("link", { name: "도움이 필요해요" }).isVisible(), "머리글 도움 버튼");
      assert.equal(await page.locator('main a[href="/help"]').count(), 1, "본문의 도움 화면 연결");
      await page.getByRole("radio", { name: /밥 시켜 주기/ }).check();
      await page.getByLabel("받는 사람 이름 (선택)").fill("민지");
      assert.match(await page.getByRole("textbox", { name: "보낼 문장" }).inputValue(), /^민지야, 오늘 밥 좀/);
      assert.deepEqual([...new Set(outside)], [], "부탁하기에서 외부로 나간 요청");
      const real = errors.filter((e) => !/^Failed to load resource/.test(e));
      assert.deepEqual(real, [], `브라우저 오류: ${real.join(" | ")}`);
      const res2 = errors.length - real.length;
      console.log(`PASS ${name} 부탁하기 실제 전체 화면${res2 ? ` (자원 불러오기 실패 ${res2}건: 기존 계정 메뉴 문제)` : ""}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name} 부탁하기 - ${String(e.message).split("\n")[0]}`);
    }
    // 예약 대본(/booking)도 로그인 없이, Supabase 설정이 잘못돼도 쓸 수 있어야 한다 (부탁하기와 같은 기준)
    errors.length = 0; outside.length = 0;
    try {
      const res = await page.goto(`${APP}/booking`);
      assert.equal(res.status(), 200, "예약 대본 응답");
      await page.locator('[data-step="hello"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(1500);
      const body = await page.locator("body").innerText();
      assert.ok(!/Application error|client-side exception|This page couldn/i.test(body), "오류 화면");
      assert.ok(await page.getByRole("link", { name: "도움이 필요해요" }).isVisible(), "머리글 도움 버튼");
      await page.getByLabel("원하는 때 (선택)").fill("내일 오전");
      assert.ok((await page.locator("ol").innerText()).includes("내일 오전에 예약할 수 있을까요?"));
      assert.deepEqual([...new Set(outside)], [], "예약 대본에서 외부로 나간 요청");
      const real = errors.filter((e) => !/^Failed to load resource/.test(e));
      assert.deepEqual(real, [], `브라우저 오류: ${real.join(" | ")}`);
      const res2 = errors.length - real.length;
      console.log(`PASS ${name} 예약 대본 실제 전체 화면${res2 ? ` (자원 불러오기 실패 ${res2}건: 기존 계정 메뉴 문제)` : ""}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name} 예약 대본 - ${String(e.message).split("\n")[0]}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
