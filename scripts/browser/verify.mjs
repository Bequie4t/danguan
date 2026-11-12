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

    await scenario("부탁하기: 복사 중 문장을 고치면 이전 문장 복사 결과를 '복사했어요'로 표시하지 않음", async () => {
      await openAsk();
      // 복사가 늦게 끝나도록 가상 클립보드를 붙잡아 둔다
      await page.evaluate(() => {
        window.__clip = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => new Promise((r) => { window.__clip.push({ t, r }); }) } });
      });
      const a = await sentence().inputValue();
      await page.getByRole("button", { name: "복사하기" }).click();
      await sentence().fill("가상 B 문장");
      await page.evaluate(() => window.__clip[0].r());
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => window.__clip[0].t), a, "복사된 것은 이전 문장");
      assert.equal(await page.getByText("복사했어요.", { exact: false }).count(), 0, "바뀐 문장에 '복사했어요'가 뜸");
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.evaluate(() => window.__clip[1].r());
      await page.getByText("복사했어요.", { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.__clip[1].t), "가상 B 문장");
    });

    await scenario("부탁하기: 복사는 한 번에 하나('복사 중…'), 늦게 실패해도 고친 다른 문장을 대신 복사하지 않고 다시 누르라고 안내", async () => {
      await openAsk();
      await page.evaluate(() => {
        window.__clip = []; window.__exec = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => new Promise((res, rej) => { window.__clip.push({ t, res, rej }); }) } });
        document.execCommand = () => { window.__exec.push(document.activeElement?.value ?? ""); return true; };
      });
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.getByRole("button", { name: "복사 중…" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "복사 중…" }).isDisabled(), true);
      await sentence().fill("가상 B 문장");
      await page.evaluate(() => window.__clip[0].rej(new Error("가상 늦은 실패")));
      await page.getByText("복사하는 사이 문장이 바뀌었어요.", { exact: false }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__exec), [], "누르지 않은 B를 대신 복사함");
      assert.equal(await page.evaluate(() => window.__clip.length), 1, "진행 중에 두 번째 쓰기가 시작됨");
    });

    await scenario("부탁하기: 고친 문장은 상황을 바꿔도 그대로, 빈 문장이면 복사·메시지 앱 버튼이 꺼짐, 복사가 첫 버튼", async () => {
      await openAsk();
      const buttons = await page.locator("main").getByRole("button", { name: /^(복사하기|메시지 앱으로)$/ }).or(page.locator("main").getByRole("link", { name: "메시지 앱으로" })).allInnerTexts();
      assert.deepEqual(buttons.map((t) => t.trim()), ["복사하기", "메시지 앱으로"], "복사하기가 먼저");
      await sentence().fill("가상 직접 고친 부탁");
      await page.getByRole("radio", { name: /전화 한 번 해 주기/ }).check();
      assert.equal(await sentence().inputValue(), "가상 직접 고친 부탁", "상황을 바꾸자 고친 문장이 사라짐");
      await sentence().fill("   ");
      assert.equal(await page.getByRole("button", { name: "복사하기" }).isDisabled(), true);
      assert.equal(await page.getByRole("link", { name: "메시지 앱으로" }).count(), 0, "빈 문장인데 메시지 앱 링크가 살아 있음");
      assert.equal(await page.getByRole("button", { name: "메시지 앱으로" }).isDisabled(), true);
      await page.getByText("보낼 문장이 비어 있어요", { exact: false }).waitFor();
      await page.getByRole("button", { name: "처음 문장으로" }).click();
      assert.match(await sentence().inputValue(), /전화 한 번만 줄 수 있어/);
      assert.equal(await page.getByRole("button", { name: "복사하기" }).isEnabled(), true);
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

    // ── 예약 대본 (5단계): 읽기만 하면 되는 대본, 앱이 대신 연락하지 않음 ──
    const openBooking = async () => {
      await page.goto(`${base}/?screen=booking`);
      await page.getByRole("heading", { name: /병원 예약 대본/ }).waitFor();
    };
    const stepIds = () => page.locator("[data-step]").evaluateAll((els) => els.map((e) => e.dataset.step));
    const scriptText = () => page.locator("ol").innerText();

    await scenario("예약 대본: 고른 것대로 전화 대본, 글씨 크게, 걱정 풀기 출처, 저장·네트워크 없음", async () => {
      const requests = [];
      const onReq = (r) => requests.push(r.url());
      page.on("request", onReq);
      await openBooking();
      const before = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length }));
      requests.length = 0;
      assert.deepEqual(await stepIds(), ["hello", "visit", "when", "close"]);
      assert.match(await scriptText(), /이 병원은 처음이에요/);
      assert.match(await scriptText(), /가장 빠른 날이 언제인지/);
      await page.getByRole("radio", { name: "다닌 적 있어요" }).check();
      await page.getByLabel("원하는 때 (선택)").fill("이번 주 목요일 오후");
      await page.getByRole("checkbox", { name: "첫 진료 비용이 대략 얼마인지" }).check();
      assert.deepEqual(await stepIds(), ["hello", "visit", "when", "ask", "close"]);
      const t = await scriptText();
      assert.ok(t.includes("전에 다닌 적이 있어요") && t.includes("이번 주 목요일 오후에 예약할 수 있을까요?") && t.includes("첫 진료 때 비용이"));
      // 글씨 크게
      const size = () => page.locator('[data-step="hello"] p').nth(1).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      const small = await size();
      await page.getByRole("checkbox", { name: "글씨 크게" }).check();
      assert.ok((await size()) > small + 4, "글씨 크게가 동작하지 않음");
      // 걱정 풀기: 펼치면 근거 링크
      await page.locator('[data-worry="record"] summary').click();
      assert.equal(await page.locator('[data-worry="record"] a[href^="https://www.law.go.kr/"][target="_blank"][rel~="noopener"]').count(), 1);
      assert.ok((await page.locator("#root").innerText()).includes("2026년 11월 13일에 확인한 내용"));
      // 연결: 부탁하기·상담전화. 병원 전화 걸기·번호 입력 없음
      assert.equal(await page.locator('main a[href="/ask?kind=booking"]').count(), 1, "예약 전화 부탁으로 바로 여는 링크");
      assert.deepEqual(await page.locator('a[href^="tel:"]').evaluateAll((els) => els.map((e) => e.getAttribute("href"))), ["tel:15770199"]);
      assert.equal(await page.locator('input[type="tel"]').count(), 0);
      const after = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length }));
      page.off("request", onReq);
      assert.deepEqual(after, before, "브라우저 저장소에 쓰지 않음");
      assert.deepEqual(requests, [], "예약 대본 화면에서 네트워크 요청 없음");
      await page.getByRole("button", { name: "입력 지우고 처음부터" }).click();
      assert.equal(await page.getByLabel("원하는 때 (선택)").inputValue(), "");
      assert.deepEqual(await stepIds(), ["hello", "visit", "when", "close"]);
    });

    await scenario("예약 대본: 글로 문의 → 고친 글 유지 → '처음 글로' → 복사는 '보냈어요·예약했어요'라고 하지 않음", async () => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await openBooking();
      await page.getByRole("radio", { name: /글로/ }).check();
      const box = page.getByRole("textbox", { name: "예약 문의 글" });
      assert.equal(await box.inputValue(), "안녕하세요, 진료 예약 문의드려요. 이 병원은 처음이에요. 가장 빠른 날이 언제인지 알 수 있을까요? 감사합니다.");
      await box.fill("가상 직접 쓴 문의");
      await page.getByRole("checkbox", { name: "가져갈 것이 있는지" }).check();
      assert.equal(await box.inputValue(), "가상 직접 쓴 문의");
      await page.getByRole("button", { name: "처음 글로" }).click();
      assert.match(await box.inputValue(), /가져가야 할 것이 있을까요\?/);
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.getByText("복사했어요.", { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await box.inputValue());
      const text = await page.locator("#root").innerText();
      assert.ok(!/보냈어요|예약했어요|예약 완료|전송 완료/.test(text));
      await context.clearPermissions();
    });

    await scenario("예약 대본: 복사 중 글을 고치면 이전 글 결과를 표시하지 않음, 빈 글이면 복사 버튼 꺼짐", async () => {
      await openBooking();
      await page.getByRole("radio", { name: /글로/ }).check();
      const box = page.getByRole("textbox", { name: "예약 문의 글" });
      await page.evaluate(() => {
        window.__clip = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => new Promise((r) => { window.__clip.push({ t, r }); }) } });
      });
      await page.getByRole("button", { name: "복사하기" }).click();
      await box.fill("가상 B 문의");
      await page.evaluate(() => window.__clip[0].r());
      await page.waitForTimeout(200);
      assert.equal(await page.getByText("복사했어요.", { exact: false }).count(), 0, "바뀐 글에 '복사했어요'가 뜸");
      await box.fill("  ");
      assert.equal(await page.getByRole("button", { name: "복사하기" }).isDisabled(), true);
      await page.getByText("보낼 글이 비어 있어요", { exact: false }).waitFor();
    });

    await scenario("예약 대본: 복사는 한 번에 하나('복사 중…'), 늦게 실패해도 고친 다른 글을 대신 복사하지 않음 / '예약 전화 부탁' 링크는 예약 전화 문장으로 열림", async () => {
      await openBooking();
      await page.getByRole("radio", { name: /글로/ }).check();
      const box = page.getByRole("textbox", { name: "예약 문의 글" });
      await page.evaluate(() => {
        window.__clip = []; window.__exec = [];
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => new Promise((res, rej) => { window.__clip.push({ t, res, rej }); }) } });
        document.execCommand = () => { window.__exec.push(document.activeElement?.value ?? ""); return true; };
      });
      await page.getByRole("button", { name: "복사하기" }).click();
      await page.getByRole("button", { name: "복사 중…" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "복사 중…" }).isDisabled(), true);
      await box.fill("가상 B 문의");
      await page.evaluate(() => window.__clip[0].rej(new Error("가상 늦은 실패")));
      await page.getByText("복사하는 사이 글이 바뀌었어요.", { exact: false }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__exec), [], "누르지 않은 B를 대신 복사함");
      // 링크로 연 부탁하기는 '예약 전화 대신 걸어 주기'가 골라져 있음
      await page.goto(`${base}/?screen=ask&kind=booking`);
      await page.getByRole("heading", { name: /할 일 하나를 건네요/ }).waitFor();
      assert.equal(await page.getByRole("radio", { name: /예약 전화 대신 걸어 주기/ }).isChecked(), true, "예약 전화가 아닌 다른 상황으로 열림");
      assert.match(await page.getByRole("textbox", { name: "보낼 문장" }).inputValue(), /예약 전화를 대신 걸어 줄 수 있어/);
      // 정해지지 않은 값은 무시하고 기본 상황
      await page.goto(`${base}/?screen=ask&kind=__proto__`);
      await page.getByRole("heading", { name: /할 일 하나를 건네요/ }).waitFor();
      assert.equal(await page.getByRole("radio", { name: /병원에 같이 가 주기/ }).isChecked(), true);
    });

    await scenario("예약 대본: 키보드로 고르기·펼치기, 초점 표시, 누르는 영역 44px", async () => {
      await openBooking();
      await page.getByRole("radio", { name: "전화로" }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("radio", { name: /글로/ }).isChecked(), true, "화살표로 방법 바꾸기");
      await page.getByRole("radio", { name: /글로/ }).focus();
      await page.keyboard.press("ArrowLeft");
      const sum = page.locator('[data-worry="insurance"] summary');
      await sum.focus();
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none", "키보드 초점 표시 없음");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator('[data-worry="insurance"]').evaluate((d) => d.open), true, "Enter로 펼쳐지지 않음");
      const small = await page.locator("main input, main textarea, main button, main a, main summary").evaluateAll((els) => els.map((e) => { const l = e.closest("label") ?? e; const r = l.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("type") || e.tagName).trim().slice(0, 12), h: r.height }; }).filter((x) => x.h < 44));
      assert.deepEqual(small, [], "누르는 영역이 44px보다 작음");
    });

    for (const scheme of ["light", "dark"]) {
      await scenario(`예약 대본: ${scheme === "dark" ? "어두운" : "밝은"} 화면 글씨 대비 4.5:1 이상 (대본·걱정 풀기 펼친 상태)`, async () => {
        await page.emulateMedia({ colorScheme: scheme });
        await openBooking();
        await page.getByRole("checkbox", { name: "첫 진료 비용이 대략 얼마인지" }).check();
        for (const id of ["cost", "record", "insurance"]) await page.locator(`[data-worry="${id}"] summary`).click();
        const low = (await helpContrast(askSel + ", main summary, main h3, main ol p, main li")).filter((x) => x.ratio < 4.5);
        await page.getByRole("radio", { name: /글로/ }).check();
        const low2 = (await helpContrast(askSel)).filter((x) => x.ratio < 4.5);
        await page.emulateMedia({ colorScheme: "light" });
        assert.deepEqual([...low, ...low2], [], "글씨 대비 4.5:1 미만");
      });
    }

    await scenario("예약 대본: 200% 확대(폭 절반)·글씨 크게에서도 가로로 넘치지 않음", async () => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: Math.floor(vp.width / 2), height: vp.height });
      await openBooking();
      await page.getByLabel("원하는 때 (선택)").fill("가".repeat(30));
      for (const a of ["첫 진료 비용이 대략 얼마인지", "진료가 얼마나 걸리는지", "가져갈 것이 있는지"]) await page.getByRole("checkbox", { name: a }).check();
      await page.getByRole("checkbox", { name: "글씨 크게" }).check();
      for (const id of ["cost", "record", "insurance"]) await page.locator(`[data-worry="${id}"] summary`).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.setViewportSize(vp);
      assert.ok(overflow <= 0, `가로로 ${overflow}px 넘침`);
    });

    // ── 힘든 날 카드 (6단계): 이 기기에만 저장, 서버로 보내지 않음 ──
    const HD_KEY = "404blue.hardday.v1";
    const openHard = async () => {
      await page.goto(`${base}/?screen=hardday`);
      await page.getByRole("heading", { name: "힘든 날 카드", exact: true }).waitFor();
    };
    const hdStored = () => page.evaluate((k) => localStorage.getItem(k), HD_KEY);
    const fillHard = async () => {
      await page.getByLabel("먹을 것 1").fill("가상 동네 죽집 소고기죽");
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("https://example.test/order");
      await page.getByLabel("먼저 부탁할 사람").fill("민지");
      await page.getByRole("button", { name: "사람 더하기" }).click();
      await page.getByLabel("그다음 사람").fill("지훈");
    };

    await scenario("힘든 날 카드: 적고 저장 → 새로 열어도 그대로 → 복사 → 고치기 → 지우기(확인)까지, 서버 요청 없음", async () => {
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      const requests = [];
      const onReq = (r) => { if (!/\/(fixture\.js|style\.css)|\?screen=hardday$/.test(r.url())) requests.push(r.url()); };
      page.on("request", onReq);
      await openHard();
      assert.equal(await hdStored(), null);
      await fillHard();
      // 잘못된 주소면 저장 버튼이 꺼지고 이유를 보여 준다
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("javascript:alert(1)");
      assert.equal(await page.getByRole("button", { name: "이 기기에 저장하기" }).isDisabled(), true);
      await page.getByText("https:// 로 시작하는 주소만", { exact: false }).waitFor();
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("https://example.test/order");
      await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      const stored = JSON.parse(await hdStored());
      assert.deepEqual(stored.people, ["민지", "지훈"]);
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [HD_KEY], "정해진 키 하나만");
      // 새로 열어도 카드가 보임 (이 기기 저장)
      await openHard();
      await page.getByRole("heading", { name: "먹을 것", exact: true }).waitFor();
      const order = page.getByRole("link", { name: "주문 화면 열기 (새 창)" });
      assert.equal(await order.getAttribute("href"), "https://example.test/order");
      assert.equal(await order.getAttribute("target"), "_blank");
      assert.match(await order.getAttribute("rel"), /noopener/);
      assert.ok((await page.locator("#root").innerText()).includes("먼저 민지에게, 어렵다면 지훈에게"));
      assert.ok((await page.locator("#root").innerText()).includes("지훈에게 같은 문장을 보내 봐요"));
      assert.equal(await page.locator('main a[href="/help"]').count(), 1);
      // 복사: '보냈어요'라고 하지 않음
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
      await page.getByRole("button", { name: "문장 복사하기" }).click();
      await page.getByText("복사했어요.", { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), stored.message);
      assert.ok(!/보냈어요|전송 완료/.test(await page.locator("#root").innerText()));
      await context.clearPermissions();
      // 고치기 → 돌아가기
      await page.getByRole("button", { name: "카드 고치기" }).click();
      assert.equal(await page.getByLabel("먹을 것 1").inputValue(), "가상 동네 죽집 소고기죽");
      await page.getByRole("button", { name: "고치지 않고 카드로 돌아가기" }).click();
      // 지우기: 확인을 거쳐야 지워짐, 취소하면 그대로
      await page.getByRole("button", { name: "이 기기에서 지우기" }).click();
      await page.getByRole("button", { name: "취소" }).click();
      assert.notEqual(await hdStored(), null, "취소했는데 지워짐");
      await page.getByRole("button", { name: "이 기기에서 지우기" }).click();
      await page.getByRole("button", { name: "지우기", exact: true }).click();
      await page.getByText("이 기기에서 카드를 지웠어요.", { exact: true }).waitFor();
      assert.equal(await hdStored(), null);
      await openHard();
      assert.equal(await page.getByLabel("먹을 것 1").inputValue(), "", "지웠는데 남아 있음");
      page.off("request", onReq);
      assert.deepEqual(requests, [], "힘든 날 카드에서 서버 요청 없음");
    });

    await scenario("힘든 날 카드: 손상된 저장값·위험한 주소는 쓰지 않고, 저장소를 못 쓰면 '이번에만 보기'", async () => {
      await page.goto(`${base}/?screen=form`);
      await page.evaluate((k) => localStorage.setItem(k, "{망가진"), HD_KEY);
      await openHard();
      await page.getByText("저장된 카드를 읽을 수 없어서", { exact: false }).waitFor();
      await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ version: 1, foods: [{ name: "가상 위험", url: "javascript:alert(1)" }], people: [], message: "가상", savedAt: "2026-11-13T00:00:00.000Z" })), HD_KEY);
      await openHard();
      await page.getByText("가상 위험", { exact: true }).waitFor();
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0, "위험한 주소가 링크가 됨");
      assert.equal(await page.getByRole("link", { name: "주문 화면 열기 (새 창)" }).count(), 0);
      assert.ok((await page.locator("#root").innerText()).includes("부탁할 사람이 없다면"));
      await page.evaluate(() => localStorage.clear());
      // 저장소를 못 쓰는 브라우저 (사생활 보호 모드 등)
      await page.evaluate(() => { Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } }); });
      await page.evaluate(() => window.__fixture.mount("hardday"));
      await page.getByText("이 브라우저에서는 저장할 수 없어요 (사생활", { exact: false }).waitFor();
      await fillHard();
      assert.equal(await page.getByRole("button", { name: "이 기기에 저장하기" }).isDisabled(), true);
      await page.getByRole("button", { name: "저장하지 않고 이번에만 보기" }).click();
      await page.getByText("저장하지 않은 카드예요", { exact: false }).waitFor();
      assert.equal(await page.getByRole("button", { name: "이 기기에서 지우기" }).count(), 0);
    });

    await scenario("힘든 날 카드: 다른 탭에서 지우면 이 탭에서도 바로 사라지고, 다른 탭에서 바꾸면 저장 직전에 알리고 덮어쓰지 않음", async () => {
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      await openHard(); await fillHard();
      await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      const other = await context.newPage();
      try {
        await other.goto(`${base}/?screen=hardday`);
        await other.getByRole("button", { name: "카드 고치기" }).waitFor();
        // 1) 다른 탭(other)에서 지움 → 이 탭(page)의 보기에서 이름·문장이 사라짐
        await other.getByRole("button", { name: "이 기기에서 지우기" }).click();
        await other.getByRole("button", { name: "지우기", exact: true }).click();
        await page.getByText("다른 창에서 이 카드를 지웠어요.", { exact: false }).waitFor();
        assert.ok(!(await page.locator("#root").innerText()).includes("민지"), "지운 카드의 이름이 남음");
        assert.equal(await page.getByLabel("먹을 것 1").inputValue(), "");
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), HD_KEY), null);
        // 2) 이 탭에서 다시 저장 → 다른 탭이 고치는 중 → 이 탭에서 바꿈 → 다른 탭 저장은 충돌로 멈춤
        await fillHard();
        await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
        await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
        await other.reload();
        await other.getByRole("button", { name: "카드 고치기" }).click();
        await other.getByLabel("먹을 것 1").fill("가상 다른 탭 메뉴");
        await page.getByRole("button", { name: "카드 고치기" }).click();
        await page.getByLabel("먼저 부탁할 사람").fill("가상 새 이름");
        await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
        await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
        await other.getByText("다른 창에서 카드가 바뀌었어요.", { exact: false }).waitFor();
        await other.getByRole("button", { name: "이 기기에 저장하기" }).click();
        await other.getByText("다른 창에서 이 카드를 지우거나 바꿨어요. 그래서 저장하지 않았어요.", { exact: false }).waitFor();
        assert.match(await page.evaluate((k) => localStorage.getItem(k), HD_KEY), /가상 새 이름/, "다른 탭이 확인 없이 덮어씀");
        assert.equal(await other.getByLabel("먹을 것 1").inputValue(), "가상 다른 탭 메뉴", "충돌 때 적던 내용이 사라짐");
        await other.getByRole("button", { name: "그래도 지금 적은 내용으로 저장하기" }).click();
        await other.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
        assert.match(await page.evaluate((k) => localStorage.getItem(k), HD_KEY), /가상 다른 탭 메뉴/);
        // 보기 중인 탭은 다른 탭의 새 내용으로 바뀜
        await page.getByText("다른 창에서 카드를 고쳐서 새 내용으로 바꿨어요.", { exact: false }).waitFor().catch(async () => {
          // page는 저장 뒤 보기 상태 → storage 이벤트로 새 내용 반영
          throw new Error("보기 중인 탭에 다른 탭의 변경이 반영되지 않음");
        });
        await page.getByText("가상 다른 탭 메뉴", { exact: true }).waitFor();
      } finally {
        await other.close();
        await page.evaluate(() => localStorage.clear());
      }
    });

    await scenario("힘든 날 카드: 저장 공간이 꽉 차 저장에 실패해도 입력 유지·기존 카드 유지·'이번에만 보기', 쓰기만 안 되는 브라우저도 기존 카드는 보임", async () => {
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      await openHard(); await fillHard();
      await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      const kept = await page.evaluate((k) => localStorage.getItem(k), HD_KEY);
      // 이제부터 쓰기만 실패 (가상 용량 초과)
      await page.evaluate(() => { Storage.prototype.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException("가상 용량 초과", "QuotaExceededError"); }; });
      try {
        await page.getByRole("button", { name: "카드 고치기" }).click();
        await page.getByLabel("먹을 것 1").fill("가상 새 메뉴");
        await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
        await page.getByText("저장하지 못했어요 (저장 공간 부족 등).", { exact: false }).waitFor();
        assert.equal(await page.getByLabel("먹을 것 1").inputValue(), "가상 새 메뉴", "실패했는데 입력이 사라짐");
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), HD_KEY), kept, "실패한 저장이 기존 카드를 바꿈");
        await page.getByRole("button", { name: "저장하지 않고 이번에만 보기" }).click();
        await page.getByText("가상 새 메뉴", { exact: true }).waitFor();
        await page.getByText("저장하지 않은 카드예요.", { exact: false }).waitFor();
        // 처음부터 쓰기만 안 되는 경우: 기존 카드는 그대로 보여야 함 (예전에는 미리 써 보는 시험 때문에 숨겨짐)
        await page.evaluate(() => window.__fixture.mount("hardday"));
        await page.getByText("저장하지 않은 카드예요.", { exact: false }).waitFor({ state: "detached" });
        await page.getByText("가상 동네 죽집 소고기죽", { exact: true }).waitFor({ timeout: 5000 }).catch(() => { throw new Error("읽을 수 있는 기존 카드가 안 보임"); });
        await page.getByRole("button", { name: "카드 고치기" }).waitFor();
      } finally {
        await page.evaluate(() => { Storage.prototype.setItem = Storage.prototype.__set; delete Storage.prototype.__set; localStorage.clear(); });
      }
    });

    await scenario("힘든 날 카드: 적는 중 '부탁하기'는 새 탭으로 열려 적던 내용이 그대로, 한글 주문 주소는 잘리지 않음", async () => {
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      await openHard();
      const korean = "https://example.test/가상매장/주문?매장=서울특별시중구가상동123번지&메뉴=소고기야채죽특&옵션=덜맵게";
      await page.getByLabel("먹을 것 1").fill("가상 한글 주소 메뉴");
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill(korean);
      await page.getByLabel("먼저 부탁할 사람").fill("민지");
      const ask = page.getByRole("link", { name: /부탁하기 \(새 탭에서 열려요\)/ });
      assert.equal(await ask.getAttribute("target"), "_blank");
      const [popup] = await Promise.all([context.waitForEvent("page"), ask.click()]);
      await popup.close();
      assert.equal(new URL(page.url()).searchParams.get("screen"), "hardday", "원래 탭이 이동함");
      assert.equal(await page.getByLabel("먹을 것 1").inputValue(), "가상 한글 주소 메뉴", "적던 내용이 사라짐");
      await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      const href = await page.getByRole("link", { name: "주문 화면 열기 (새 창)" }).getAttribute("href");
      assert.equal(decodeURI(href), korean, "주문 주소가 잘리거나 바뀜");
      // 너무 긴 주소는 자르지 않고 저장 전에 알림
      await page.getByRole("button", { name: "카드 고치기" }).click();
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("https://example.test/" + "a".repeat(2000));
      await page.getByText("주소가 너무 길어요", { exact: false }).waitFor();
      assert.equal(await page.getByRole("button", { name: "이 기기에 저장하기" }).isDisabled(), true);
      await page.evaluate(() => localStorage.clear());
    });

    await scenario("힘든 날 카드: 키보드·초점·누르는 영역 44px (적기·보기)", async () => {
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      await openHard();
      const smallOf = () => page.locator("main input, main textarea, main button, main a").evaluateAll((els) => els.filter((e) => !e.readOnly).map((e) => { const r = (e.closest("label") ?? e).getBoundingClientRect(); return { t: (e.textContent || e.getAttribute("aria-label") || e.id || e.tagName).trim().slice(0, 12), h: r.height }; }).filter((x) => x.h < 44));
      assert.deepEqual(await smallOf(), [], "적기 화면: 누르는 영역이 44px보다 작음");
      await page.getByLabel("먹을 것 1").focus();
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), "none", "초점 표시 없음");
      await fillHard();
      await page.getByLabel("먹을 것 1").focus();
      await page.keyboard.press("Enter"); // 폼 제출 = 저장
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      assert.deepEqual(await smallOf(), [], "보기 화면: 누르는 영역이 44px보다 작음");
      await page.evaluate(() => localStorage.clear());
    });

    for (const scheme of ["light", "dark"]) {
      await scenario(`힘든 날 카드: ${scheme === "dark" ? "어두운" : "밝은"} 화면 글씨 대비 4.5:1 이상 (적기·보기)`, async () => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
        await openHard();
        await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("http://example.test");
        const lowEdit = (await helpContrast(askSel + ", main legend, main strong")).filter((x) => x.ratio < 4.5);
        await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("");
        await fillHard();
        await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
        await page.getByRole("button", { name: "이 기기에서 지우기" }).click();
        const lowView = (await helpContrast(askSel + ", main strong")).filter((x) => x.ratio < 4.5);
        await page.evaluate(() => localStorage.clear());
        await page.emulateMedia({ colorScheme: "light" });
        assert.deepEqual([...lowEdit, ...lowView], [], "글씨 대비 4.5:1 미만");
      });
    }

    await scenario("힘든 날 카드: 200% 확대(폭 절반)에서 가로로 넘치지 않음 (긴 이름·주소)", async () => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: Math.floor(vp.width / 2), height: vp.height });
      await page.goto(`${base}/?screen=form`); await page.evaluate(() => localStorage.clear());
      await openHard();
      await page.getByLabel("먹을 것 1").fill("가".repeat(30));
      await page.getByLabel("주문할 때 여는 주소 (선택)").first().fill("https://example.test/" + "a".repeat(200));
      await page.getByLabel("먼저 부탁할 사람").fill("나".repeat(20));
      const o1 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.getByRole("button", { name: "이 기기에 저장하기" }).click();
      await page.getByText("이 기기에 저장했어요.", { exact: true }).waitFor();
      const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.evaluate(() => localStorage.clear());
      await page.setViewportSize(vp);
      assert.ok(o1 <= 0 && o2 <= 0, `가로로 넘침: 적기 ${o1}px, 보기 ${o2}px`);
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
