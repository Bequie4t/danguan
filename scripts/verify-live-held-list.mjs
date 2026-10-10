// 분리 TEST DB 조회 전용. 실제 로그인은 사용자가 직접 한다.
// 비밀번호/토큰/쿠키/기록 내용/UID를 출력하거나 결과에 저장하지 않는다.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const APP = 'https://danguan-83g42kpgh-onew4.vercel.app';
const DB = 'https://wxqmqksqjmfflzghozuq.supabase.co';
const functionalCommit = 'bdb1a39a8779e805f09e3458c7e5c54154bdfc14';
const modulePath = process.env.TEST_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(30000);
const out = `danguan-held-list-results-${Date.now()}`;
await mkdir(out);
const result = { app: APP, testDatabase: DB, functionalCommit, deploymentCommitVerifiedByScript: false, checks: [], passed: false };
let stage = 'A-login';
let holdNext = false;
let release;
let resolveHeld;
let rejectHeld;
let resolveDelivered;
let rejectDelivered;
let heldRequest;
const held = new Promise((resolve, reject) => { resolveHeld = resolve; rejectHeld = reject; });
const delivered = new Promise((resolve, reject) => { resolveDelivered = resolve; rejectDelivered = reject; });
// Attach rejection handlers before an intercepted request can fail.
held.catch(() => {});
delivered.catch(() => {});
const isList = r => {
  const u = new URL(r.url());
  return u.origin === DB && u.pathname === '/rest/v1/checkins' && r.request().method() === 'GET';
};
const pass = name => { result.checks.push({ name, passed: true }); console.log(`PASS ${name}`); };
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('stage timed out')), 30000); })]);
  } finally { clearTimeout(timer); }
}
await context.route('**/*', async route => {
  const req = route.request();
  const u = new URL(req.url());
  // Other Supabase projects and all record mutations are forbidden.
  if (u.hostname.endsWith('.supabase.co') && u.origin !== DB) return route.abort('blockedbyclient');
  if (u.origin === APP && u.pathname.startsWith('/api/') && req.method() !== 'GET') return route.abort('blockedbyclient');
  if (u.origin === DB && !u.pathname.startsWith('/auth/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return route.abort('blockedbyclient');
  if (!holdNext || u.origin !== DB || u.pathname !== '/rest/v1/checkins' || req.method() !== 'GET' || req.frame().page() !== page) return route.continue();
  holdNext = false;
  heldRequest = req;
  let response;
  try {
    response = await route.fetch();
    assert.equal(response.status(), 200);
    const rows = await response.json();
    const gate = new Promise(resolve => { release = resolve; });
    resolveHeld(rows);
    await gate;
    await route.fulfill({ response });
    resolveDelivered();
  } catch {
    rejectHeld(new Error('held request failed'));
    rejectDelivered(new Error('held response cancelled or failed'));
    await route.abort('failed').catch(() => {});
  } finally {
    await response?.dispose();
  }
});
try {
  console.log('첫 탭에서 Vercel 보호 인증과 당우안 A 로그인을 직접 완료하고 내 기록을 여세요. 가상 기록만 있는 계정을 사용하세요. Enter는 필요 없습니다.');
  const initialResponse = page.waitForResponse(isList, { timeout: 600000 });
  await page.goto(`${APP}/login`);
  const aResponse = await initialResponse;
  assert.equal(aResponse.status(), 200);
  const initialRows = await aResponse.json();
  assert.ok(Array.isArray(initialRows) && initialRows.length > 0);
  const aUid = initialRows[0].owner_id;
  assert.ok(aUid && initialRows.every(r => r.owner_id === aUid));
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).waitFor();
  stage = 'hold-real-A-list';
  holdNext = true;
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click();
  const aRows = await bounded(held);
  assert.ok(aRows.length > 0 && aRows.every(r => r.owner_id === aUid));
  pass('real A list fetched and held before browser delivery');
  stage = 'B-direct-signin';
  const switchTab = await context.newPage();
  const bResponsePromise = switchTab.waitForResponse(isList, { timeout: 600000 });
  await switchTab.goto(`${APP}/login`);
  console.log('두 번째 탭 로그인 폼에서 B로 직접 로그인하고 내 기록을 여세요. 로그아웃 버튼은 누르지 마세요. 원래 탭 응답은 계속 보류 중입니다.');
  const bResponse = await bResponsePromise;
  assert.equal(bResponse.status(), 200);
  const bRows = await bResponse.json();
  assert.ok(Array.isArray(bRows) && bRows.length > 0);
  const bUid = bRows[0].owner_id;
  assert.ok(bUid && bUid !== aUid && bRows.every(r => r.owner_id === bUid));
  const bNotes = new Set(bRows.map(r => r.note));
  const markers = aRows.map(r => r.note).filter(n => typeof n === 'string' && n.trim() && !bNotes.has(n));
  assert.ok(markers.length > 0, 'distinct synthetic A note required');
  pass('real B list confirmed before A response release');
  stage = 'deliver-real-A-after-B';
  const observed = page.waitForResponse(r => isList(r) && r.request() === heldRequest);
  release();
  release = null;
  await bounded(delivered);
  const lateResponse = await observed;
  await lateResponse.finished();
  pass('held A response delivered after real B list confirmation');
  // Short, explicit observation window; account transition must remain visible.
  await page.waitForTimeout(1500);
  assert.equal(new URL(page.url()).pathname, '/records');
  await page.getByText('다른 계정으로 바뀌어서, 이전 계정 화면의 입력과 기록을 비웠어요.', { exact: true }).waitFor();
  for (const note of markers) assert.equal(await page.getByText(note, { exact: true }).count(), 0);
  pass('original tab account switch notice and no distinct A notes after delivery');
  stage = 'completed';
  result.passed = true;
} catch (error) {
  result.failure = { stage, errorType: ['TimeoutError', 'AssertionError', 'Error'].includes(error?.name) ? error.name : 'OtherError' };
  process.exitCode = 1;
  console.error(`FAIL stage=${stage}. 오류 본문은 출력하지 않습니다. 취소된 응답을 전달 성공으로 세지 않습니다.`);
} finally {
  release?.();
  result.finalStage = stage;
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(`결과: ${out}/result.json. 기록 쓰기·삭제 없음. 브라우저를 종료합니다.`);
  await browser.close();
}
