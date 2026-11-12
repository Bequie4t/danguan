// PR #7 홈 기록: 실제 로그인·실제 DB 구조 시험 (로컬 임시 Supabase + 로컬 빌드). 가상 계정·가상 데이터만.
// 직접 실행하지 말고 scripts/local-e2e/run.sh로 실행한다 (로컬 DB 주소로 새로 빌드하고 환경 변수를 넘겨 줌).
// 안전장치: 브라우저 요청은 127.0.0.1/localhost만 허용하고 나머지는 막는다. 로컬 주소가 아니면 시작하지 않는다.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`환경 변수 ${k}가 없습니다. run.sh로 실행하세요.`); process.exit(2); } return v; };
const APP = need("E2E_APP_URL");
const SB = need("E2E_SUPABASE_URL");
const ANON = need("E2E_ANON_KEY");
const SERVICE = need("E2E_SERVICE_KEY");
const DB_CONTAINER = need("E2E_DB_CONTAINER");
const isLocal = (u) => ["127.0.0.1", "localhost"].includes(new URL(u).hostname);
if (!isLocal(APP) || !isLocal(SB)) { console.error("로컬 주소가 아니어서 중단합니다."); process.exit(2); }
const { chromium } = process.env.TEST_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.TEST_PLAYWRIGHT_MODULE).href)
  : await import("playwright");
const modelTs = readFileSync(new URL("../../src/lib/checkins/model.ts", import.meta.url), "utf8");
const CONSENT = {
  key: modelTs.match(/CONSENT_KEY\s*=\s*"([^"]+)"/)?.[1],
  version: modelTs.match(/CONSENT_POLICY_VERSION\s*=\s*"?([^";\n]+)"?/)?.[1],
};
if (!CONSENT.key || !CONSENT.version) { console.error("model.ts에서 동의 상수를 읽지 못했습니다."); process.exit(2); }
const SHOTS = process.env.E2E_SHOTS_DIR ?? join(tmpdir(), "danguan-local-e2e-shots");
mkdirSync(SHOTS, { recursive: true });

const tag = Date.now().toString(36);
const A = { email: `local-a-${tag}@example.test`, password: randomBytes(12).toString("hex") };
const B = { email: `local-b-${tag}@example.test`, password: randomBytes(12).toString("hex") };

const sql = (q) => execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-tA", "-F", "|", "-c", q]).toString().trim();
const results = [];
let shot = 0;
async function step(name, page, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).split("\n")[0]]);
    console.log("FAIL", name, "-", String(e.message).split("\n")[0]);
  }
  if (page) await page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, "0")}.png`, fullPage: false }).catch(() => {});
}
const ok = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
// 로컬 밖으로 나가는 요청은 모두 막고 기록한다 (빌드가 다른 DB를 가리키면 여기서 드러남)
const blocked = [];
await ctx.route("**/*", (route) => {
  const u = route.request().url();
  if (u.startsWith("data:") || u.startsWith("blob:") || isLocal(u)) return route.fallback();
  blocked.push(new URL(u).host);
  return route.abort("blockedbyclient");
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const uli = () => page.locator('section[aria-labelledby="home-question"] svg[role="img"]').first().getAttribute("aria-label");
const waitUli = (word) => page.waitForFunction((w) => document.querySelector('section[aria-labelledby="home-question"] svg[role="img"]')?.getAttribute("aria-label")?.includes(w), word);
const btn = (name) => page.getByRole("button", { name, exact: true });

// '다른 탭/기기': 같은 계정으로 따로 로그인한 클라이언트가 실제 RPC를 부른다
const other = createClient(SB, ANON, { auth: { persistSession: false } });
let aId = null;

/** 다음 create_checkin 한 번: 서버에 보낸 뒤 응답만 끊는다 (서버 저장됨) */
const LOCAL_CREATE = `${new URL(SB).origin}/rest/v1/rpc/create_checkin`;
async function loseNextCreateResponse(holder) {
  await page.route("**/rest/v1/rpc/create_checkin", async (route) => {
    const u = new URL(route.request().url());
    // 공통 차단 규칙보다 먼저 실행되므로 여기서 직접 확인: 정확한 로컬 DB 주소가 아니면 보내지 않는다
    if (`${u.origin}${u.pathname}` !== LOCAL_CREATE) {
      blocked.push(u.host);
      return route.abort("blockedbyclient");
    }
    holder.body = JSON.parse(route.request().postData() ?? "{}");
    await route.fetch({ maxRedirects: 0 }); // 리다이렉트를 따라가지 않는다
    await route.abort("failed");
    await page.unroute("**/rest/v1/rpc/create_checkin");
  });
}
/** 다음 create_checkin 한 번: 서버에 닿지 않게 끊는다 (아직 도착 안 한 요청) */
async function dropNextCreate(holder) {
  await page.route("**/rest/v1/rpc/create_checkin", async (route) => {
    const u = new URL(route.request().url());
    if (`${u.origin}${u.pathname}` !== LOCAL_CREATE) blocked.push(u.host);
    holder.body = JSON.parse(route.request().postData() ?? "{}");
    await route.abort("failed");
    await page.unroute("**/rest/v1/rpc/create_checkin");
  });
}
let creates = 0;
page.on("request", (r) => { if (r.url().includes("/rpc/create_checkin")) creates++; });

await step("0. 도움 화면은 로그인 없이 열림", page, async () => {
  await page.goto(`${APP}/help`);
  await page.getByRole("heading").first().waitFor();
  ok(page.url().endsWith("/help"), "도움 화면이 다른 곳으로 이동함");
});

await step("1. 가상 계정 A 가입 → 동의 → 홈", page, async () => {
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: /계정 만들기/ }).first().click();
  await page.getByLabel("이메일").fill(A.email);
  await page.getByLabel("비밀번호").fill(A.password);
  await page.getByRole("button", { name: "계정 만들기", exact: true }).click();
  await page.waitForURL(/\/consent/);
  await page.locator("#consent-check").check();
  await page.getByRole("button", { name: "동의하고 계속하기", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/consent"));
  await page.goto(`${APP}/`);
  await page.getByRole("heading", { name: "지금 얼마나 버거워요?" }).waitFor();
  aId = sql(`select id from auth.users where email='${A.email}'`);
  ok(aId, "A 계정이 DB에 없음");
  await waitUli("조용히");
});

await step("2. 한 번 누르면 서버 확인 뒤 '남겨 뒀어요', DB에 A 소유 1건(version 1, 메모·태그 없음)", page, async () => {
  await btn("버거워요").click();
  await page.getByText("남겨 뒀어요", { exact: false }).waitFor();
  await waitUli("무겁게");
  const rows = sql(`select burden, version, coalesce(note,'-'), array_length(tags,1) from public.checkins where owner_id='${aId}'`).split("\n").filter(Boolean);
  ok(rows.length === 1, `기록 ${rows.length}건`);
  ok(rows[0] === "heavy|1|-|", `값이 다름: ${rows[0]}`);
});

await step("3. 되돌리기 → DB에서 삭제, 울이 기본 모습", page, async () => {
  await btn("되돌리기").click();
  await page.getByText("되돌렸어요", { exact: false }).waitFor();
  await waitUli("조용히");
  ok(sql(`select count(*) from public.checkins where owner_id='${aId}'`) === "0", "기록이 남아 있음");
});

await step("4. 새로고침해도 울이는 DB의 최근 기록을 따름", page, async () => {
  await btn("괜찮은 편이에요").click();
  await page.getByText("남겨 뒀어요", { exact: false }).waitFor();
  await page.reload();
  await waitUli("가볍게");
});

const h1 = {};
await step("5. 응답 유실 → '저장됐는지 확인하기'만, 다른 값 잠김 → 확인은 조회만, 1건", page, async () => {
  await loseNextCreateResponse(h1);
  const before = creates;
  await btn("견딜 만해요").click();
  await btn("저장됐는지 확인하기").waitFor();
  ok(await btn("많이 버거워요").isDisabled(), "다른 값 버튼이 잠기지 않음");
  ok((await btn("다시 남기기").count()) === 0, "결과를 모를 때 '다시 남기기'가 보임");
  ok(sql(`select count(*) from public.checkins where id='${h1.body.p_id}'`) === "1", "서버에 저장되지 않음(시험 준비 실패)");
  await btn("저장됐는지 확인하기").click();
  await page.getByText("남겨 뒀어요", { exact: false }).waitFor();
  ok((await btn("되돌리기").count()) === 1, "손대지 않은 기록인데 되돌리기 없음");
  ok(creates - before === 1, `생성 요청 ${creates - before}번`);
  ok(sql(`select count(*) from public.checkins where id='${h1.body.p_id}'`) === "1", "기록이 1건이 아님");
});

await step("6. 응답 유실 → 다른 탭에서 메모·태그 추가 → 확인: 덮어쓰지 않음, 되돌리기 없음", page, async () => {
  const { error: se } = await other.auth.signInWithPassword(A);
  ok(!se, "다른 탭 로그인 실패");
  const h = {};
  await loseNextCreateResponse(h);
  const before = creates;
  await btn("버거워요").click();
  await btn("저장됐는지 확인하기").waitFor();
  const { data, error } = await other.rpc("update_checkin", { p_id: h.body.p_id, p_expected_version: 1, p_burden: "heavy", p_tags: ["sleep", "meal"], p_note: "가상 다른 탭 메모" });
  ok(!error && data?.status === "ok", `다른 탭 수정 실패: ${error?.message ?? data?.status}`);
  await btn("저장됐는지 확인하기").click();
  await page.getByText("이미 남겨진 기록이에요", { exact: false }).waitFor();
  ok((await btn("되돌리기").count()) === 0, "고친 기록에 되돌리기가 보임");
  const row = sql(`select note, array_to_string(tags,','), version from public.checkins where id='${h.body.p_id}'`);
  ok(row === "가상 다른 탭 메모|sleep,meal|2", `DB 값: ${row}`);
  ok(creates - before === 1, `생성 요청 ${creates - before}번`);
  ok((await page.getByRole("link", { name: "내 기록에서 확인", exact: true }).first().getAttribute("href")) === "/records", "링크 주소");
});

await step("7. 응답 유실 기록을 다른 탭에서 지움 → 확인: '아직 찾지 못했어요', 되살리지 않음, 울이는 남은 기록", page, async () => {
  const h = {};
  await loseNextCreateResponse(h);
  const before = creates;
  await btn("많이 버거워요").click();
  await btn("저장됐는지 확인하기").waitFor();
  // 울이가 그 기록을 보여 주도록 새로고침 대신 화면을 다시 열지 않고 확인: 새 탭에서 열면 상태가 사라지므로 다른 탭 삭제만 한다
  const { data, error } = await other.rpc("delete_checkin", { p_id: h.body.p_id, p_expected_version: 1 });
  ok(!error && data?.status === "ok", `다른 탭 삭제 실패: ${error?.message ?? data?.status}`);
  await btn("저장됐는지 확인하기").click();
  await page.getByText("아직 이 기록을 찾지 못했어요", { exact: false }).waitFor();
  ok(!(await uli()).includes("녹듯"), "지운 기록 모습");
  await btn("다시 확인하기").click();
  await page.getByText("아직 이 기록을 찾지 못했어요", { exact: false }).waitFor();
  ok(sql(`select count(*) from public.checkins where id='${h.body.p_id}'`) === "0", "지운 기록이 되살아남");
  ok(creates - before === 1, `확인 단계에서 생성 요청 ${creates - before - 1}번`);
  await btn("‘많이 버거워요’ 새로 남기기").click();
  await page.getByText("남겨 뒀어요", { exact: false }).waitFor();
  ok(sql(`select count(*) from public.checkins where id='${h.body.p_id}'`) === "0", "새로 남기기가 지운 ID를 되살림");
  ok(sql(`select count(*) from public.checkins where owner_id='${aId}' and burden='very_heavy'`) === "1", "새 기록이 1건이 아님");
  await waitUli("녹듯");
});

await step("8. 요청이 늦게 도착: 확인 시 없음 → 늦게 저장 → '다시 확인하기'로 찾음, 두 건 안 생김", page, async () => {
  const h = {};
  await dropNextCreate(h);
  await btn("모르겠어요").click();
  await btn("저장됐는지 확인하기").waitFor();
  ok(sql(`select count(*) from public.checkins where id='${h.body.p_id}'`) === "0", "요청이 서버에 닿음(시험 준비 실패)");
  await btn("저장됐는지 확인하기").click();
  await page.getByText("아직 이 기록을 찾지 못했어요", { exact: false }).waitFor();
  const { error } = await other.rpc("create_checkin", h.body); // 같은 요청이 늦게 서버에 도착
  ok(!error, `늦은 저장 실패: ${error?.message}`);
  await btn("다시 확인하기").click();
  await page.getByText("남겨 뒀어요", { exact: false }).waitFor();
  ok(sql(`select count(*) from public.checkins where owner_id='${aId}' and burden='unsure'`) === "1", "기록이 1건이 아님");
});

await step("9. B는 A 기록을 볼 수도 지울 수도 없음(RLS) / 같은 브라우저에서 B로 바꾸면 원래 탭이 B 기록을 보여 줌", page, async () => {
  const admin = createClient(SB, SERVICE, { auth: { persistSession: false } });
  const { data: made, error } = await admin.auth.admin.createUser({ email: B.email, password: B.password, email_confirm: true });
  ok(!error && made?.user?.id, `B 생성 실패: ${error?.message}`);
  const bId = made.user.id;
  const b = createClient(SB, ANON, { auth: { persistSession: false } });
  const { data: signed, error: se } = await b.auth.signInWithPassword(B);
  ok(!se && signed?.session?.user?.id === bId, `B 로그인 실패: ${se?.message ?? "세션 없음"}`);
  // 조회가 '성공'했고 0건인지 (오류를 0건으로 착각하지 않게)
  const q1 = await b.from("checkins").select("id, owner_id");
  ok(!q1.error && Array.isArray(q1.data), `B 조회 실패: ${q1.error?.message}`);
  ok(q1.data.length === 0, `B가 기록 ${q1.data.length}건을 봄 (A 기록 노출)`);
  const del = await b.rpc("delete_checkin", { p_id: h1.body.p_id, p_expected_version: 1 });
  ok(!del.error && del.data?.status === "not_found", `B의 A 기록 삭제 시도 결과가 예상과 다름: ${del.error?.message ?? del.data?.status}`);
  ok(sql(`select count(*) from public.checkins where id='${h1.body.p_id}'`) === "1", "A 기록이 사라짐");
  // B의 가상 기록 하나 (동의 → 생성) — 조회가 실제로 동작하는지도 함께 확인
  const consent = await b.from("consents").insert({ consent_key: CONSENT.key, policy_version: CONSENT.version });
  ok(!consent.error, `B 동의 저장 실패: ${consent.error?.message}`);
  const bRecordId = crypto.randomUUID();
  const later = new Date(Date.now() + 60_000).toISOString();
  const made2 = await b.rpc("create_checkin", { p_id: bRecordId, p_occurred_at: later, p_occurred_tz: "Asia/Seoul", p_recorded_at: later, p_recorded_tz: "Asia/Seoul", p_source: "direct", p_burden: "bearable", p_tags: [], p_note: "가상 B 기록 e2e" });
  ok(!made2.error, `B 기록 생성 실패: ${made2.error?.message}`);
  const q2 = await b.from("checkins").select("id, owner_id");
  ok(!q2.error && q2.data.length === 1 && q2.data[0].id === bRecordId && q2.data[0].owner_id === bId, "B 조회가 B 기록 1건만 돌려주지 않음");
  // 같은 브라우저의 다른 탭에서 로그아웃 → B 로그인
  const page2 = await ctx.newPage();
  await page2.goto(`${APP}/`).catch(() => {});
  await page2.waitForLoadState("networkidle").catch(() => {});
  const out = page2.getByRole("button", { name: /로그아웃/ });
  ok((await out.count()) > 0, "로그아웃 버튼 없음");
  await out.first().click();
  await page2.waitForURL(/\/login/).catch(() => {});
  await page2.goto(`${APP}/login`).catch(() => {});
  await page2.getByLabel("이메일").fill(B.email);
  await page2.getByLabel("비밀번호").fill(B.password);
  await page2.getByRole("button", { name: "로그인", exact: true }).last().click();
  await page2.waitForURL((u) => !u.pathname.startsWith("/login"));
  // 원래 탭: A의 상태가 사라지고 B의 기록을 따르는지
  await page.bringToFront();
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  await page.getByText("다른 계정으로 바뀌어서", { exact: false }).waitFor();
  ok(!(await page.locator("body").innerText()).includes("남겨 뒀어요"), "A의 저장 안내가 남음");
  await waitUli("그럭저럭"); // B의 가상 기록(견딜 만해요)
  await page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, "0")}-after-switch.png` });
  // 원래 탭의 내 기록: B 기록만
  await page.goto(`${APP}/records`);
  await page.getByText("가상 B 기록 e2e", { exact: true }).waitFor();
  ok((await page.getByText("가상 다른 탭 메모", { exact: false }).count()) === 0, "원래 탭 내 기록에 A 기록이 보임");
  await page2.close();
});

await step("9b. 오늘 기록 작성 중 머리글 '오늘 기록'을 다시 눌러도 새로 열지 않고 입력 유지, 저장 요청 없음", page, async () => {
  await page.bringToFront();
  await page.goto(`${APP}/today`);
  await page.getByRole("heading", { name: "지금 어느 정도 버거운가요?", exact: true }).waitFor();
  await page.getByRole("button", { name: "선택 사항 더하기", exact: false }).click();
  await page.getByRole("button", { name: "버거워요", exact: true }).click();
  await page.locator("#note").fill("가상 작성 중 메모 e2e");
  await page.evaluate(() => { window.__noReload = true; });
  const before = creates;
  const today = page.getByRole("banner").getByRole("link", { name: "오늘 기록", exact: true });
  await today.click();
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => window.__noReload === true), "화면이 새로 열림");
  ok((await page.locator("#note").inputValue()) === "가상 작성 중 메모 e2e", "작성 중 메모가 사라짐");
  ok((await page.getByRole("button", { name: "버거워요", exact: true }).getAttribute("aria-pressed")) === "true", "고른 버거움이 사라짐");
  ok(creates === before, "저장 요청이 나감");
  ok((await page.getByRole("banner").getByRole("link", { name: "오늘 기록", exact: true }).getAttribute("aria-current")) === "page", "지금 화면 표시(aria-current) 없음");
  // 다른 화면 메뉴는 그대로 이동
  await page.getByRole("banner").getByRole("link", { name: "내 기록", exact: true }).click();
  await page.waitForURL(/\/records/);
});

await step("10. 로컬 밖으로 나간 요청 없음", null, async () => {
  ok(blocked.length === 0, `막은 외부 요청: ${[...new Set(blocked)].join(", ")}`);
});

await browser.close();
const failed = results.filter((r) => r[0] === "FAIL");
console.log("\nSUMMARY", results.length - failed.length, "/", results.length, "· 화면:", SHOTS);
for (const r of failed) console.log("FAIL:", r[1], "→", r[2]);
process.exit(failed.length ? 1 : 0);
