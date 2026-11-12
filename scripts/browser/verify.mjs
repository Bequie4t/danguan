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
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    b.onLoad({ filter: /^link$/, namespace: "fixture" }, () => ({ contents: 'import React from "react"; export default function Link({children,...props}) { return React.createElement("a",props,children); }', loader: "js", resolveDir: root }));
    // 머리글 시험용: 지금 주소를 그대로 돌려준다
    b.onLoad({ filter: /^navigation$/, namespace: "fixture" }, () => ({ contents: "export function usePathname() { return location.pathname; }", loader: "js", resolveDir: root }));
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
    const helpContrast = (extra = "") => page.evaluate((extra) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      // 배경이 그라데이션이면 그 안의 색 모두와 비교해 가장 낮은 대비를 쓴다
      const bgsOf = (el) => { for (let e = el; e; e = e.parentElement) { const st = getComputedStyle(e); const g = st.backgroundImage.match(/rgba?\([^)]*\)/g); if (g && st.backgroundImage.includes("gradient")) return g.map(rgba); const c = rgba(st.backgroundColor); if (c[3] > 0.99) return [c]; } return [rgba(getComputedStyle(document.body).backgroundColor)]; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (el) => Math.min(...bgsOf(el).map((bg) => { const c = rgba(getComputedStyle(el).color); const fg = [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3])); const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
      const out = [];
      for (const card of document.querySelectorAll("[data-help-number]")) for (const span of card.querySelectorAll("span")) if (span.children.length === 0 && span.textContent.trim()) out.push({ text: span.textContent.trim().slice(0, 12), ratio: Math.round(ratio(span) * 100) / 100 });
      for (const el of document.querySelectorAll("main p, main h1, main h2, main a[download], main li" + extra)) if (el.textContent.trim()) out.push({ text: el.textContent.trim().slice(0, 12), ratio: Math.round(ratio(el) * 100) / 100 });
      return out;
    }, extra);

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
      const described = await page.locator("[data-help-number]").evaluateAll((els) => els.map((a) => document.getElementById(a.getAttribute("aria-describedby") ?? "")?.textContent ?? ""));
      assert.ok(described.every((t) => t.length > 5), "번호마다 상세 안내가 설명(aria-describedby)으로 연결돼야 함");
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
      const measure = () => page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cut: [...document.querySelectorAll("[data-help-number]")].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.dataset.helpNumber),
        smallest: Math.min(...[...document.querySelectorAll("[data-help-number] span")].filter((s) => /^[0-9-]+$/.test(s.textContent.trim())).map((s) => parseFloat(getComputedStyle(s).fontSize))),
      }));
      const r = await measure();
      // 설치된 글꼴에 따라 폭이 달라지므로, 일부러 넓은 글꼴로도 확인한다 (CI 기기에서 잘렸던 경우)
      await page.addStyleTag({ content: '[data-help-number] span { font-family: "DejaVu Sans Mono", "Courier New", monospace !important; letter-spacing: 0.06em !important; }' });
      const wide = await measure();
      await page.setViewportSize(vp);
      assert.ok(r.overflow <= 0, `가로로 ${r.overflow}px 넘침`);
      assert.deepEqual(r.cut, [], "카드 밖으로 넘친 내용(번호·이름)");
      assert.ok(wide.overflow <= 0, `넓은 글꼴에서 가로로 ${wide.overflow}px 넘침`);
      assert.deepEqual(wide.cut, [], "넓은 글꼴에서 카드 밖으로 넘친 내용(번호·이름)");
      assert.ok(r.smallest >= 16, `번호 글씨가 너무 작아짐: ${r.smallest}px`);
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

    await scenario("머리글: 기록 작성 중 지금 화면 메뉴('오늘 기록')를 다시 눌러도 새로 열지 않고 입력 유지", async () => {
      await page.goto(`${base}/today?screen=today-nav`);
      await page.getByRole("heading", { name: "지금 어느 정도 버거운가요?", exact: true }).waitFor();
      await prepare("가상 작성 중 메모");
      await page.evaluate(() => { window.__noReload = true; });
      const today = page.getByRole("link", { name: "오늘 기록", exact: true });
      assert.equal(await today.getAttribute("aria-current"), "page");
      assert.equal(await page.getByRole("link", { name: "내 기록", exact: true }).getAttribute("aria-current"), null);
      await page.evaluate(() => window.scrollTo(0, 400));
      await today.click();
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__noReload === true), true, "화면이 새로 열림");
      assert.equal(new URL(page.url()).pathname, "/today");
      assert.equal(await page.locator("#note").inputValue(), "가상 작성 중 메모", "작성 중 메모가 사라짐");
      assert.equal(await page.getByRole("button", { name: "버거워요", exact: true }).getAttribute("aria-pressed"), "true", "고른 버거움이 사라짐");
      // 키보드(Enter)로 눌러도 같음
      await today.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__noReload === true), true, "Enter로 화면이 새로 열림");
      assert.equal(await page.locator("#note").inputValue(), "가상 작성 중 메모");
      // 다른 화면 링크는 그대로 이동
      await page.getByRole("link", { name: "내 기록", exact: true }).click();
      await page.waitForURL(/\/records(\?|$)/);
      assert.equal(await page.evaluate(() => window.__noReload === true), false);
    });

    // 저장 중·저장 실패 화면에서도 '도움이 필요해요'는 확인창 없이 바로 이동 (다른 링크는 계속 물음)
    for (const phase of ["saving", "failed"]) {
      await scenario(`기록 ${phase === "saving" ? "저장 중" : "저장 실패 직후"}: 도움 버튼은 확인창 없이 바로 이동, 다른 링크는 떠나기 전에 물음`, async () => {
        const dialogs = [];
        const onDialog = (d) => { dialogs.push(d.type()); void d.dismiss(); }; // 취소 = 이 화면에 남기
        page.on("dialog", onDialog);
        const start = async () => {
          await page.goto(`${base}/?screen=form-help`);
          await page.getByRole("heading", { name: "지금 어느 정도 버거운가요?", exact: true }).waitFor();
          await prepare("가상 도움 이동 메모");
          if (phase === "saving") await page.evaluate(() => window.__fixture.hold("create_checkin"));
          else await page.evaluate(() => { window.__fixture.failure = "request_error"; });
          await page.getByRole("button", { name: "저장하기", exact: true }).click();
          if (phase === "saving") await page.waitForFunction(() => window.__fixture.started("create_checkin"));
          else await page.getByRole("button", { name: "다시 저장하기", exact: true }).waitFor();
        };
        try {
          // 1) 다른 링크: 떠나기 전 확인이 뜨고, 취소하면 남는다 (확인 장치가 그대로 동작하는지)
          await start();
          await page.getByRole("link", { name: "다른 화면" }).click({ noWaitAfter: true });
          await page.waitForTimeout(800);
          assert.deepEqual(dialogs, ["beforeunload"], "다른 링크에서 떠나기 전 확인이 떠야 함");
          assert.equal(new URL(page.url()).pathname, "/");
          assert.equal(await page.locator("#note").inputValue(), "가상 도움 이동 메모");
          // 2) 도움 버튼: 확인 없이 바로 이동 (마우스)
          dialogs.length = 0;
          await page.getByRole("link", { name: "도움이 필요해요" }).click();
          await page.waitForURL(/\/help-target/);
          assert.deepEqual(dialogs, [], "도움 버튼에서 확인창이 뜸");
          // 3) 도움 버튼: 키보드(Enter)로도 바로 이동
          await page.evaluate(() => { window.__fixture.failure = null; });
          await start();
          dialogs.length = 0;
          await page.getByRole("link", { name: "도움이 필요해요" }).focus();
          await page.keyboard.press("Enter");
          await page.waitForURL(/\/help-target/);
          assert.deepEqual(dialogs, [], "Enter로 누른 도움 버튼에서 확인창이 뜸");
        } finally {
          page.off("dialog", onDialog);
          await page.evaluate(() => { const f = window.__fixture; if (f) { f.failure = null; f.release?.("create_checkin"); } }).catch(() => {});
        }
      });
    }

    // ── 부탁하기 (4단계): 로그인·저장과 무관, 앱이 대신 보내지 않음 ──
    const askSel = ", main legend, main label, main label span, main button, main a, main .eyebrow";
    const openAsk = async () => {
      await page.goto(`${base}/?screen=ask`);
      await page.getByRole("heading", { name: /할 일 하나를 건네요/ }).waitFor();
    };
    const sentence = () => page.getByRole("textbox", { name: "보낼 문장" });

    await scenario("부탁하기: 상황 고르기 → 문장 → 이름·칸 반영 → 직접 고치면 유지 → '처음 문장으로'", async () => {
      const requests = [];
      const onReq = (r) => requests.push(r.url());
      page.on("request", onReq);
      await openAsk();
      const before = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length }));
      requests.length = 0;
      assert.match(await sentence().inputValue(), /^병원 가는 날 같이 가 줄 수 있어\?.*어려우면 편하게 말해 줘/);
      await page.getByRole("radio", { name: /밥 시켜 주기/ }).check();
      await page.getByLabel("먹고 싶은 것 (선택)").fill("죽");
      await page.getByLabel("받는 사람 이름 (선택)").fill("민지");
      assert.equal(await sentence().inputValue(), "민지야, 오늘 밥 좀 시켜 줄 수 있어? 이거면 돼: 죽. 어려우면 편하게 말해 줘. 괜찮아.");
      await page.getByRole("checkbox", { name: /부담을 덜어 주는 한마디/ }).uncheck();
      assert.ok(!(await sentence().inputValue()).includes("어려우면"));
      // 직접 고치기: 다른 칸을 바꿔도 덮어쓰지 않음
      await sentence().fill("가상 직접 쓴 부탁");
      await page.getByLabel("받는 사람 이름 (선택)").fill("지훈");
      assert.equal(await sentence().inputValue(), "가상 직접 쓴 부탁");
      await page.getByRole("button", { name: "처음 문장으로" }).click();
      assert.match(await sentence().inputValue(), /^지훈아, 오늘 밥 좀/);
      // 메시지 앱 링크: 번호 없이 본문만
      const href = await page.getByRole("link", { name: "메시지 앱으로" }).getAttribute("href");
      assert.ok(href.startsWith("sms:?&body="));
      assert.equal(decodeURIComponent(href.slice(11)), await sentence().inputValue());
      // 도움 연결 유지, 저장·네트워크 없음
      assert.equal(await page.locator('main a[href="/help"]').count(), 1);
      const after = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length }));
      page.off("request", onReq);
      assert.deepEqual(after, before, "브라우저 저장소에 쓰지 않음");
      assert.deepEqual(requests, [], "부탁하기 화면에서 네트워크 요청 없음");
      // 입력 지우기
      await page.getByRole("button", { name: "입력 지우고 처음부터" }).click();
      assert.equal(await page.getByLabel("받는 사람 이름 (선택)").inputValue(), "");
      assert.match(await sentence().inputValue(), /^병원 가는 날/);
    });

    await scenario("부탁하기: 복사하면 '복사했어요'만 안내하고 '보냈어요'라고 하지 않음", async () => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await openAsk();
      await page.getByLabel("받는 사람 이름 (선택)").fill("Alex");
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.getByText("복사했어요.", { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await sentence().inputValue());
      const text = await page.locator("#root").innerText();
      assert.ok(!/보냈어요|전송 완료|발송 완료/.test(text));
      assert.ok(text.includes("직접 보내 주세요"));
      // 내용을 바꾸면 복사 안내는 사라진다 (바뀐 문장을 복사한 것처럼 보이지 않게)
      await page.getByLabel("받는 사람 이름 (선택)").fill("Sam");
      assert.equal(await page.getByText("복사했어요.", { exact: false }).count(), 0);
      await context.clearPermissions();
    });

    await scenario("부탁하기: 복사 권한이 없어도 화면이 멈추지 않고 안내", async () => {
      await openAsk();
      await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true }); document.execCommand = () => false; });
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.getByText("복사하지 못했어요.", { exact: false }).waitFor();
    });

    await scenario("부탁하기: 키보드만으로 상황 고르기·복사 버튼까지 이동, 초점 표시", async () => {
      await openAsk();
      await page.getByRole("radio", { name: /병원에 같이 가 주기/ }).focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.getByRole("radio", { name: /밥 시켜 주기/ }).isChecked(), true, "화살표로 상황 바꾸기");
      let found = false;
      for (let i = 0; i < 12 && !found; i++) {
        await page.keyboard.press("Tab");
        found = await page.evaluate(() => document.activeElement?.textContent?.trim() === "복사하기");
      }
      assert.ok(found, "Tab으로 복사하기에 닿지 않음");
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none", "키보드 초점 표시 없음");
      const small = await page.locator("main input, main textarea, main button, main a").evaluateAll((els) => els.map((e) => { const l = e.closest("label") ?? e; const r = l.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("type") || e.tagName).trim().slice(0, 10), h: r.height }; }).filter((x) => x.h < 44));
      assert.deepEqual(small, [], "누르는 영역이 44px보다 작음");
    });

    for (const scheme of ["light", "dark"]) {
      await scenario(`부탁하기: ${scheme === "dark" ? "어두운" : "밝은"} 화면 글씨 대비 4.5:1 이상`, async () => {
        await page.emulateMedia({ colorScheme: scheme });
        await openAsk();
        await page.getByRole("button", { name: "복사하기" }).focus();
        const low = (await helpContrast(askSel)).filter((x) => x.ratio < 4.5);
        await page.emulateMedia({ colorScheme: "light" });
        assert.deepEqual(low, [], "글씨 대비 4.5:1 미만");
      });
    }

    await scenario("부탁하기: 200% 확대(폭 절반)에서도 가로로 넘치지 않음", async () => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: Math.floor(vp.width / 2), height: vp.height });
      await openAsk();
      await page.getByLabel("받는 사람 이름 (선택)").fill("가".repeat(20));
      await page.getByLabel("언제 가요? (선택)").fill("나".repeat(30));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.setViewportSize(vp);
      assert.ok(overflow <= 0, `가로로 ${overflow}px 넘침`);
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
