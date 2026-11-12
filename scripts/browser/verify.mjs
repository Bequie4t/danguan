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
      await page.getByRole("heading", { name: screen === "form" ? "지금 어느 정도 버거운가요?" : screen === "consent" ? "기록을 계정에 저장하기 전에" : screen === "home" ? "지금 얼마나 버거워요?" : "내 기록", exact: true }).waitFor();
      if (screen === "records") await page.getByText("가상 A 기록", { exact: true }).waitFor();
    };
    const prepare = async (note) => {
      await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).click();
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.locator("#note").fill(note);
    };
    // 같은 제목의 화면이 A·B 모두에 있으므로, 실제로 B 화면으로 바뀐 뒤에 검사한다.
    const waitScope = (who) => page.waitForFunction((who) => {
      const f = window.__fixture;
      return document.querySelector(`[data-scope-uid="${f[who]}"]`) !== null;
    }, who);
    const scenario = async (name, fn) => {
      await fn();
      assert.deepEqual(errors, [], "브라우저 예외 없음");
      passed++;
      console.log(`PASS ${viewport.width}px ${name}`);
    };

    await scenario("늦은 A 동의 조회가 B를 다음 화면으로 보내지 않음", async () => {
      await fresh("consent");
      await page.evaluate(() => { const f = window.__fixture; f.setConsent(f.A, true); f.hold("consents"); f.mount("consent"); });
      await page.waitForFunction(() => window.__fixture.started("consents"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("consents"); });
      await waitScope("B");
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
      await waitScope("B");
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
      await waitScope("B");
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
      await waitScope("B");
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
      await waitScope("B");
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

    const uliLabel = () => page.locator('svg[role="img"]').first().getAttribute("aria-label");
    const homeSaved = () => page.getByText("남겨 뒀어요", { exact: false });

    await scenario("홈: 울이가 내 최근 기록을 따르고, 한 번 누르면 서버 확인 뒤 저장 표시", async () => {
      await fresh("home");
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      const before = (await page.evaluate(() => window.__fixture.snapshot())).rows.length;
      await page.evaluate(() => window.__fixture.hold("create_checkin"));
      await page.getByRole("button", { name: "많이 버거워요", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("create_checkin"));
      assert.equal(await homeSaved().count(), 0, "서버 확인 전에는 저장 표시 없음");
      assert.ok((await uliLabel()).includes("무겁게"), "서버 확인 전에는 울이가 바뀌지 않음");
      await page.evaluate(() => window.__fixture.release("create_checkin"));
      await homeSaved().waitFor();
      assert.ok((await uliLabel()).includes("녹듯"));
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.rows.length, before + 1);
      const mine = snap.rows.filter((r) => r.burden === "very_heavy");
      assert.equal(mine.length, 1);
      assert.equal(mine[0].owner_id, await page.evaluate(() => window.__fixture.A));
      assert.equal(mine[0].note, null);
      assert.deepEqual(mine[0].tags, []);
    });

    const homeSave = async (label) => {
      await page.getByRole("button", { name: label, exact: true }).click();
      await homeSaved().waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      return snap.calls.filter((c) => c.operation === "create_checkin").at(-1).id;
    };

    await scenario("홈 되돌리기: 방금 남긴 기록만 지우고 울이는 남은 최근 기록으로", async () => {
      await fresh("home");
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      const id = await homeSave("괜찮은 편이에요");
      assert.ok((await uliLabel()).includes("가볍게"));
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.getByText("되돌렸어요. 방금 남긴 기록을 지웠어요.", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.rows.some((r) => r.id === id), false);
      assert.equal(snap.rows.length, 2, "가상 A·B 기존 기록은 그대로");
      const del = snap.calls.filter((c) => c.operation === "delete_checkin");
      assert.equal(del.length, 1); assert.equal(del[0].id, id);
    });

    await scenario("홈 되돌리기: 응답이 사라져도 다시 누르면 확인 후 완료, 다른 기록 무사", async () => {
      await fresh("home");
      const id = await homeSave("버거워요");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.getByText("되돌리지 못했어요.", { exact: false }).waitFor();
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.getByText("되돌렸어요. 방금 남긴 기록을 지웠어요.", { exact: true }).waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.rows.some((r) => r.id === id), false);
      assert.equal(snap.rows.length, 2);
    });

    await scenario("홈 되돌리기: 다른 기기에서 먼저 바뀐 기록은 지우지 않음", async () => {
      await fresh("home");
      const id = await homeSave("모르겠어요");
      await page.evaluate((id) => window.__fixture.touch(id), id);
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.getByText("다른 기기에서 먼저 바뀌어서 지우지 않았어요", { exact: false }).waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.rows.some((r) => r.id === id), true);
      assert.equal(await page.getByRole("button", { name: "되돌리기", exact: true }).count(), 0);
    });

    await scenario("홈 되돌리기: 늦은 A 응답이 B 홈에 반영되지 않고 B 기록은 그대로", async () => {
      await fresh("home");
      await homeSave("견딜 만해요");
      await page.evaluate(() => window.__fixture.hold("delete_checkin"));
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("delete_checkin"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("delete_checkin"); });
      await homeSaved().waitFor({ state: "detached" });
      await page.getByRole("button", { name: "견딜 만해요", exact: true }).waitFor();
      await page.waitForTimeout(200);
      assert.equal(await page.getByText("되돌렸어요", { exact: false }).count(), 0);
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      const B = await page.evaluate(() => window.__fixture.B);
      assert.equal(snap.rows.filter((r) => r.owner_id === B).length, 1);
      const del = snap.calls.filter((c) => c.operation === "delete_checkin");
      assert.equal(del.length, 1); assert.equal(del[0].uid, await page.evaluate(() => window.__fixture.A));
      await page.evaluate(() => window.__fixture.switchUser(window.__fixture.A));
    });

    await scenario("홈: 응답 유실 뒤 '저장됐는지 확인하기'는 조회만 하고 기록은 하나", async () => {
      await fresh("home");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "견딜 만해요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      assert.equal(await homeSaved().count(), 0);
      assert.equal(await page.getByRole("button", { name: "다시 남기기", exact: true }).count(), 0, "결과를 모를 때는 다시 만드는 버튼이 없음");
      assert.equal(await page.getByRole("button", { name: "견딜 만해요", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await homeSaved().waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      const sends = snap.calls.filter((c) => c.operation === "create_checkin");
      assert.equal(sends.length, 1, "확인 단계에서 생성 요청 없음");
      const reads = snap.calls.filter((c) => c.operation === "checkins_by_id");
      assert.equal(reads.length, 1); assert.equal(reads[0].id, sends[0].id);
      assert.equal(snap.rows.filter((r) => r.id === sends[0].id).length, 1);
      assert.ok(await page.getByRole("button", { name: "되돌리기", exact: true }).count() === 1, "손대지 않은 기록이면 되돌리기 가능");
    });

    await scenario("홈: 응답 유실 → 다른 탭에서 삭제 → 확인해도 되살리지 않고, 새로 남기기는 새 ID", async () => {
      await fresh("home");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      const id = (await page.evaluate(() => window.__fixture.snapshot())).calls.find((c) => c.operation === "create_checkin").id;
      await page.evaluate((id) => window.__fixture.removeElsewhere(id), id);
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await page.getByText("아직 이 기록을 찾지 못했어요.", { exact: false }).waitFor();
      let snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.rows.some((r) => r.id === id), false, "지운 기록이 되살아나지 않음");
      assert.equal(snap.calls.filter((c) => c.operation === "create_checkin").length, 1, "확인은 생성 요청을 보내지 않음");
      assert.equal(await homeSaved().count(), 0);
      assert.equal(await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).isDisabled(), false, "없음이 확인되면 다시 고를 수 있음");
      await page.getByRole("button", { name: "‘버거워요’ 새로 남기기", exact: true }).click();
      await homeSaved().waitFor();
      snap = await page.evaluate(() => window.__fixture.snapshot());
      const creates = snap.calls.filter((c) => c.operation === "create_checkin");
      assert.equal(creates.length, 2);
      assert.notEqual(creates[1].id, id, "새로 남길 때는 새 ID");
      assert.equal(snap.rows.some((r) => r.id === id), false);
      assert.equal(snap.rows.filter((r) => r.id === creates[1].id).length, 1);
    });

    await scenario("홈: 다른 탭에서 지운 기록을 울이가 보여 주던 중 확인하면 기본·남은 기록으로", async () => {
      await fresh("home");
      // 처음 울이 조회를 실패시켜 '울이 다시 불러오기'를 띄운다
      await page.evaluate(() => { const f = window.__fixture; f.failure = "list_error"; f.mount("home"); });
      await page.getByRole("button", { name: "울이 다시 불러오기", exact: true }).waitFor();
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "많이 버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      await page.getByRole("button", { name: "울이 다시 불러오기", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("녹듯"));
      const id = (await page.evaluate(() => window.__fixture.snapshot())).calls.find((c) => c.operation === "create_checkin").id;
      await page.evaluate((id) => window.__fixture.removeElsewhere(id), id);
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await page.getByText("아직 이 기록을 찾지 못했어요.", { exact: false }).waitFor();
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      assert.equal((await uliLabel()).includes("녹듯"), false, "지운 기록의 모습에 머물지 않음");
    });

    await scenario("홈: 찾지 못한 기록이 늦게 저장되면 '다시 확인하기'로 찾고 두 건이 생기지 않음", async () => {
      await fresh("home");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      const snap0 = await page.evaluate(() => window.__fixture.snapshot());
      const id = snap0.calls.find((c) => c.operation === "create_checkin").id;
      const row = snap0.rows.find((r) => r.id === id);
      await page.evaluate((id) => window.__fixture.removeElsewhere(id), id); // 아직 도착하지 않은 것처럼
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await page.getByText("아직 이 기록을 찾지 못했어요.", { exact: false }).waitFor();
      await page.evaluate((row) => window.__fixture.putRow(row), row); // 늦게 저장됨
      await page.getByRole("button", { name: "다시 확인하기", exact: true }).click();
      await homeSaved().waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.calls.filter((c) => c.operation === "create_checkin").length, 1, "다시 확인은 생성 요청 없음");
      assert.equal(snap.calls.filter((c) => c.operation === "checkins_by_id" && c.id === id).length, 2);
      assert.equal(snap.rows.filter((r) => r.id === id).length, 1);
      assert.equal(snap.rows.length, 3, "가상 A·B 기존 기록 2개 + 이 기록 1개 (두 건이 생기지 않음)");
    });

    await scenario("홈: 다시 확인 중 세션 확인이 실패해도 조회 버튼만 유지, 새로 만들지 않음", async () => {
      await fresh("home");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      const snap0 = await page.evaluate(() => window.__fixture.snapshot());
      const id = snap0.calls.find((c) => c.operation === "create_checkin").id;
      const row = snap0.rows.find((r) => r.id === id);
      await page.evaluate((id) => window.__fixture.removeElsewhere(id), id); // 아직 도착하지 않은 것처럼
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await page.getByText("아직 이 기록을 찾지 못했어요.", { exact: false }).waitFor();
      await page.evaluate(() => { window.__fixture.failure = "session_error"; });
      await page.getByRole("button", { name: "다시 확인하기", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "다시 남기기", exact: true }).count(), 0, "새로 만드는 버튼이 보이면 안 됨");
      assert.equal(await page.getByRole("button", { name: "‘버거워요’ 새로 남기기", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).isDisabled(), true, "결과를 모르는 동안 다른 값 잠김");
      await page.evaluate((row) => { window.__fixture.failure = null; window.__fixture.putRow(row); }, row); // 늦게 저장됨
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await homeSaved().waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      assert.equal(snap.calls.filter((c) => c.operation === "create_checkin").length, 1, "생성 요청은 처음 1번뿐");
      assert.equal(snap.rows.filter((r) => r.id === id).length, 1);
      assert.equal(snap.rows.length, 3, "기존 2개 + 이 기록 1개");
    });

    await scenario("홈 되돌리기 뒤 울이 조회가 실패해도 지운 기록 모습에 머물지 않음", async () => {
      await fresh("home");
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      await homeSave("괜찮은 편이에요");
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("가볍게"));
      await page.evaluate(() => { window.__fixture.failure = "list_error"; });
      await page.getByRole("button", { name: "되돌리기", exact: true }).click();
      await page.getByText("되돌렸어요. 방금 남긴 기록을 지웠어요.", { exact: true }).waitFor();
      await page.getByRole("button", { name: "울이 다시 불러오기", exact: true }).waitFor();
      assert.ok((await uliLabel()).includes("조용히"), "지운 기록 대신 기본 모습");
      await page.getByRole("button", { name: "울이 다시 불러오기", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      assert.equal(await page.getByRole("button", { name: "울이 다시 불러오기", exact: true }).count(), 0);
    });

    await scenario("홈: 응답 유실 → 다른 탭에서 메모·태그 추가 → 확인해도 덮어쓰지 않음", async () => {
      await fresh("home");
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).isDisabled(), true, "확인 전에는 다른 값을 고를 수 없음");
      const id = (await page.evaluate(() => window.__fixture.snapshot())).calls.find((c) => c.operation === "create_checkin").id;
      await page.evaluate((id) => window.__fixture.editElsewhere(id, { note: "가상 다른 탭 메모", tags: ["sleep", "meal"] }), id);
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await page.getByText("이미 남겨진 기록이에요", { exact: false }).waitFor();
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      const rec = snap.rows.find((r) => r.id === id);
      assert.equal(rec.note, "가상 다른 탭 메모");
      assert.deepEqual(rec.tags, ["sleep", "meal"]);
      assert.equal(rec.version, 2);
      assert.equal(snap.calls.filter((c) => c.operation === "update_checkin").length, 0, "홈은 수정 요청을 보내지 않음");
      assert.equal(snap.calls.filter((c) => c.operation === "create_checkin" && c.id === id).length, 1, "확인 단계에서 생성 요청 없음");
      assert.equal(await page.getByRole("button", { name: "되돌리기", exact: true }).count(), 0, "다른 곳에서 고친 기록은 되돌리기 대상 아님");
      assert.equal(await page.getByRole("link", { name: "내 기록에서 확인", exact: true }).getAttribute("href"), "/records");
      assert.equal(await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).isDisabled(), false, "확인 뒤에는 다시 고를 수 있음");
    });

    await scenario("홈: 옛 기록 저장을 확인해도 울이는 경험 시점이 가장 늦은 기록을 따름", async () => {
      await fresh("home");
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("무겁게"));
      await page.evaluate(() => { window.__fixture.failure = "lost_response"; });
      await page.getByRole("button", { name: "많이 버거워요", exact: true }).click();
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).waitFor();
      const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await page.evaluate((t) => { const f = window.__fixture; f.addRecord(f.A, "0000000000c1", "okay", t); }, later);
      await page.getByRole("button", { name: "저장됐는지 확인하기", exact: true }).click();
      await homeSaved().waitFor();
      await page.waitForFunction(() => document.querySelector('svg[role="img"]')?.getAttribute("aria-label")?.includes("가볍게"));
      assert.equal((await uliLabel()).includes("녹듯"), false, "방금 확인한 옛 기록으로 울이를 바꾸지 않음");
    });

    await scenario("홈: 늦은 A 저장 응답을 B 홈에 반영하지 않음", async () => {
      await fresh("home");
      await page.evaluate(() => window.__fixture.hold("create_checkin"));
      await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).click();
      await page.waitForFunction(() => window.__fixture.started("create_checkin"));
      await page.evaluate(() => { const f = window.__fixture; f.switchUser(f.B); f.release("create_checkin"); });
      await page.getByText("남기는 중이에요", { exact: false }).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).waitFor();
      await page.waitForTimeout(200);
      assert.equal(await homeSaved().count(), 0);
      assert.equal(await page.getByRole("button", { name: "괜찮은 편이에요", exact: true }).getAttribute("aria-pressed"), "false");
      const snap = await page.evaluate(() => window.__fixture.snapshot());
      const sent = snap.rows.filter((r) => r.burden === "okay");
      assert.equal(sent.length, 1);
      assert.equal(sent[0].owner_id, await page.evaluate(() => window.__fixture.A));
      await page.evaluate(() => window.__fixture.switchUser(window.__fixture.A));
    });

    await scenario("홈: 로그아웃하면 저장 화면이 사라지고 로그인 안내만 보임", async () => {
      await fresh("home");
      await page.getByRole("button", { name: "버거워요", exact: true }).waitFor();
      await page.evaluate(() => window.__fixture.switchUser(null));
      await page.getByRole("link", { name: "로그인하고 남기기", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "버거워요", exact: true }).count(), 0);
      assert.ok((await uliLabel()).includes("조용히"), "로그아웃 상태에서는 이전 계정 기록을 따르지 않음");
      assert.equal(new URL(page.url()).pathname, "/");
      await page.evaluate(() => window.__fixture.switchUser(window.__fixture.A));
    });

    await scenario("홈: 동의 전에는 저장 요청 없이 동의 안내", async () => {
      await fresh("home");
      await page.evaluate(() => { const f = window.__fixture; f.setConsent(f.A, false); f.mount("home"); });
      await page.getByRole("link", { name: "동의 내용 보기", exact: true }).waitFor();
      const creates = (await page.evaluate(() => window.__fixture.snapshot())).calls.filter((c) => c.operation === "create_checkin");
      assert.equal(creates.length, 0);
      await page.evaluate(() => window.__fixture.setConsent(window.__fixture.A, true));
    });

    // 도움 화면: 색 대비 계산 (CSS 색을 캔버스로 sRGB로 바꿔 WCAG 대비를 구함)
    const helpContrast = () => page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0.99) return c; } return rgba(getComputedStyle(document.body).backgroundColor); };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (el) => { const bg = bgOf(el); let fg = rgba(getComputedStyle(el).color); fg = [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])); const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      const out = [];
      for (const card of document.querySelectorAll("[data-help-number]")) for (const span of card.querySelectorAll("span")) if (span.children.length === 0 && span.textContent.trim()) out.push({ text: span.textContent.trim().slice(0, 12), ratio: Math.round(ratio(span) * 100) / 100 });
      for (const el of document.querySelectorAll("main p, main h1, main h2, main a[download], main li")) if (el.textContent.trim()) out.push({ text: el.textContent.trim().slice(0, 12), ratio: Math.round(ratio(el) * 100) / 100 });
      return out;
    });

    await scenario("도움 화면: 109가 맨 위·가장 크게, 모든 번호가 전화 링크, 저장·출처·확인 날짜 유지", async () => {
      await page.goto(`${base}/?screen=help`);
      await page.locator('[data-help-number="109"]').waitFor();
      const cards = await page.locator("[data-help-number]").evaluateAll((els) => els.map((a) => {
        const nums = [...a.querySelectorAll("span")].filter((s) => /^[0-9-]+$/.test(s.textContent.trim()));
        const r = a.getBoundingClientRect();
        return { number: a.dataset.helpNumber, href: a.getAttribute("href"), label: a.getAttribute("aria-label"), size: parseFloat(getComputedStyle(nums[0]).fontSize), top: r.top, h: r.height, w: r.width };
      }));
      assert.deepEqual(cards.map((c) => c.number), ["109", "1577-0199", "119", "112"]);
      assert.deepEqual(cards.map((c) => c.href), ["tel:109", "tel:15770199", "tel:119", "tel:112"]);
      for (const c of cards) { assert.ok(c.h >= 44 && c.w >= 44, `${c.number} 누르는 영역이 작음`); assert.ok(c.label.includes(c.number) && c.label.includes("전화 걸기")); }
      assert.ok(cards[0].size > Math.max(...cards.slice(1).map((c) => c.size)), "109가 가장 크지 않음");
      assert.ok(cards[0].top < cards[1].top, "109가 맨 위가 아님");
      assert.equal(await page.locator('a[href="/help/contact-card"][download]').count(), 1, "연락처 저장 링크");
      const text = await page.locator("#root").innerText();
      assert.ok(text.includes("2026년 10월 8일에 공식 기관 누리집을 기준으로 확인"), "확인 날짜");
      assert.ok(text.includes("안전을 보장하지 않아요"));
      assert.ok((await page.locator('a[target="_blank"][rel~="noopener"]').count()) >= 6, "출처 링크");
      assert.equal(await page.locator('svg[role="img"]').count(), 0, "도움 화면에 울이·그림 없음");
      const low = (await helpContrast()).filter((x) => x.ratio < 4.5);
      assert.deepEqual(low, [], "밝은 화면 글씨 대비 4.5:1 미만");
    });

    await scenario("도움 화면: 어두운 화면에서도 글씨 대비 4.5:1 이상", async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(`${base}/?screen=help`);
      await page.locator('[data-help-number="109"]').waitFor();
      const low = (await helpContrast()).filter((x) => x.ratio < 4.5);
      await page.emulateMedia({ colorScheme: "light" });
      assert.deepEqual(low, [], "어두운 화면 글씨 대비 4.5:1 미만");
    });

    await scenario("도움 화면: 200% 확대(폭 절반)에서도 가로로 넘치지 않고 번호가 다 보임", async () => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: Math.floor(vp.width / 2), height: vp.height });
      await page.goto(`${base}/?screen=help`);
      await page.locator('[data-help-number="109"]').waitFor();
      const r = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cut: [...document.querySelectorAll("[data-help-number]")].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.dataset.helpNumber),
      }));
      await page.setViewportSize(vp);
      assert.ok(r.overflow <= 0, `가로로 ${r.overflow}px 넘침`);
      assert.deepEqual(r.cut, [], "카드 안에서 잘린 번호");
    });

    await scenario("도움 화면: 키보드 Tab으로 109부터 차례로 이동", async () => {
      await page.goto(`${base}/?screen=help`);
      await page.locator('[data-help-number="109"]').waitFor();
      const order = [];
      for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement?.getAttribute("data-help-number"))); }
      assert.deepEqual(order, ["109", "1577-0199", "119", "112"]);
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert.notEqual(ring, "none", "키보드 초점 표시 없음");
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
