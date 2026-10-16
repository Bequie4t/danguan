import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshResponseTest, refreshTestEnabled, type RefreshTestStage } from "../src/lib/account/refreshTest";
import { TEST_DATABASE } from "../src/lib/checkins/responseTest";
const url = TEST_DATABASE + "/auth/v1/token?grant_type=refresh_token";
const post = { method: "POST" };
const turn = () => new Promise(resolve => setImmediate(resolve));

test("refresh test requires Preview, exact TEST DB and transaction opt-in", () => {
  assert.equal(refreshTestEnabled("preview", TEST_DATABASE, "true", "true"), true);
  assert.equal(refreshTestEnabled("preview", TEST_DATABASE, "true", "false"), false);
  for (const env of [undefined, "production", "development"]) assert.equal(refreshTestEnabled(env, TEST_DATABASE, "true", "true"), false);
  assert.equal(refreshTestEnabled("preview", TEST_DATABASE, undefined, "true"), false);
  assert.equal(refreshTestEnabled("preview", "https://other.invalid", "true", "true"), false);
});

test("only one successful actual refresh response is held, without consuming its body", async () => {
  const stages: RefreshTestStage[] = [];
  const response = new Response('{"synthetic_private_value":true}');
  const c = createRefreshResponseTest(async () => response, s => stages.push(s));
  c.arm(); c.arm();
  let done = false;
  const pending = c.fetch(url, post).then(r => { done = true; return r; });
  await turn();
  assert.equal(done, false); assert.equal(response.bodyUsed, false);
  c.arm(); // cannot replace an in-flight trial
  assert.equal((await c.fetch(url, post)), response);
  c.release(); c.release();
  assert.equal(await pending, response);
  assert.deepEqual(stages, ["armed", "held", "released", "not_held"]);
});

test("other origin, path, grant or method never consumes the prepared trial", async () => {
  const stages: RefreshTestStage[] = [];
  const c = createRefreshResponseTest(async () => new Response("{}"), s => stages.push(s));
  c.arm();
  for (const [u, method] of [["https://other.invalid/auth/v1/token?grant_type=refresh_token", "POST"], [TEST_DATABASE+"/rest/v1/checkins", "POST"], [url.replace("refresh_token", "password"), "POST"], [url,"GET"]]) await c.fetch(u, {method});
  assert.deepEqual(stages, ["armed"]);
  const request = c.fetch(new Request(url, post)); await turn(); c.release(); await request;
  assert.ok(stages.includes("held"));
});

test("server rejection and transport failure remain failures, not held successes", async () => {
  for (const rejects of [false, true]) {
    const stages: RefreshTestStage[] = [];
    const c = createRefreshResponseTest(async () => { if (rejects) throw new Error("synthetic-network"); return new Response("{}", {status:400}); }, s => stages.push(s));
    c.arm();
    if (rejects) await assert.rejects(c.fetch(url, post), /synthetic-network/);
    else assert.equal((await c.fetch(url, post)).status,400);
    assert.deepEqual(stages,["armed","not_held"]);
  }
});

test("cancel before response arrival prevents a late hold; cancel a held response releases it", async () => {
  let finish!: (r:Response)=>void;
  const stages: RefreshTestStage[]=[];
  const c = createRefreshResponseTest(()=>new Promise(resolve=>{finish=resolve;}),s=>stages.push(s));
  c.arm(); const pending=c.fetch(url,post); c.cancel(); finish(new Response("{}")); await pending;
  assert.deepEqual(stages,["armed","cancelled"]);
  const d=createRefreshResponseTest(async()=>new Response("{}"),s=>stages.push(s));
  d.arm(); const held=d.fetch(url,post); await turn(); d.cancel(); await held;
  assert.equal(stages.at(-1),"cancelled"); assert.equal(stages.includes("released"),false);
});

test("ten second watchdog releases without recording a manually completed trial", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const stages: RefreshTestStage[]=[];
  const c=createRefreshResponseTest(async()=>new Response("{}"),s=>stages.push(s));
  c.arm(); const pending=c.fetch(url,post); await turn();
  assert.equal(stages.at(-1),"held");
  t.mock.timers.tick(10_000); await pending;
  assert.equal(stages.at(-1),"cancelled"); assert.equal(stages.includes("released"),false);
});

test("release without a held response never claims completion",()=>{
  const stages: RefreshTestStage[]=[];
  createRefreshResponseTest(async()=>new Response("{}"),s=>stages.push(s)).release();
  assert.deepEqual(stages,["not_held"]);
});

test("watchdog also disarms preparation when the SDK never issues fetch", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const stages: RefreshTestStage[]=[];
  const c=createRefreshResponseTest(async()=>new Response("{}"),s=>stages.push(s));
  c.arm(); t.mock.timers.tick(10_000);
  assert.equal(stages.at(-1),"cancelled");
  await c.fetch(url,post);
  assert.equal(stages.includes("held"),false);
});

test("finishing a completed trial preserves release evidence when disarming", async()=>{
  const stages: RefreshTestStage[]=[];
  const c=createRefreshResponseTest(async()=>new Response("{}"),s=>stages.push(s));
  c.arm(); const pending=c.fetch(url,post); await turn(); c.release(); await pending; c.cancel();
  assert.equal(stages.at(-1),"released");
});
