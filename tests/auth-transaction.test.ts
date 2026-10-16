import test from "node:test";
import assert from "node:assert/strict";
import { authTransactionsEnabled, strictAuthLock } from "../src/lib/account/authTransaction";
import { TEST_DATABASE } from "../src/lib/checkins/responseTest";
import { queuedLocks } from "./helpers/auth-locks";
import { NavigatorLockAcquireTimeoutError } from "@supabase/supabase-js";
import { AuthTransactionTimeout } from "../src/lib/account/authTransaction";

test("timeout is recognized by the SDK auto refresh skip path", () => {
  assert.ok(new AuthTransactionTimeout() instanceof NavigatorLockAcquireTimeoutError);
});

test("auth transaction is off by default and rejects a different database", () => {
  assert.equal(authTransactionsEnabled(TEST_DATABASE, "true"), true);
  assert.equal(authTransactionsEnabled(TEST_DATABASE, undefined), false);
  assert.equal(authTransactionsEnabled("https://production.supabase.co", "true"), false);
});

test("queued auth writer waits for the existing operation and retains order", async () => {
  const locks = queuedLocks();
  const order: string[] = [];
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const a = strictAuthLock("lock:synthetic", 100, async () => { order.push("A-start"); began(); await gate; order.push("A-end"); }, locks);
  await started;
  const b = strictAuthLock("lock:synthetic", 100, async () => { order.push("B"); }, locks);
  assert.deepEqual(order, ["A-start"]);
  release(); await Promise.all([a, b]);
  assert.deepEqual(order, ["A-start", "A-end", "B"]);
});

test("wait timeout never steals the lock or runs queued work", async () => {
  const locks = queuedLocks();
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const a = strictAuthLock("lock:synthetic", 100, async () => { began(); await gate; }, locks);
  await started;
  await assert.rejects(strictAuthLock("lock:synthetic", 5, async () => assert.fail("timed out work must not run"), locks), { name: "AuthTransactionTimeout" });
  await assert.rejects(strictAuthLock("lock:synthetic", 0, async () => assert.fail("unavailable work must not run"), locks), { name: "AuthTransactionTimeout" });
  release(); await a;
  assert.equal(await strictAuthLock("lock:synthetic", 100, async () => "next", locks), "next");
});

test("missing Web Locks rejects without executing auth work", async () => {
  await assert.rejects(strictAuthLock("lock:synthetic", 10, async () => assert.fail("must not run"), null), /auth_transaction_lock_unavailable/);
});

test("TEST login distinguishes an actual lock wait timeout without exposing error details", async () => {
  const { authWriteFailureText } = await import("../src/lib/account/authTransaction");
  const locks=queuedLocks();
  let release!:()=>void;
  let started!:()=>void;
  const began=new Promise<void>(resolve=>{started=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const holder=strictAuthLock("lock:synthetic-diagnostic",100,async()=>{started();await gate;},locks);
  await began;
  try {
    await strictAuthLock("lock:synthetic-diagnostic",5,async()=>assert.fail("must not execute"),locks);
    assert.fail("must time out");
  } catch(error) {
    assert.equal(authWriteFailureText(error,true),"다른 탭에서 로그인 상태를 처리하고 있어요. 그 작업이 끝나면 다시 로그인해 주세요.");
    assert.equal(authWriteFailureText(error,false),"연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
  } finally {release();await holder;}
});

test("unknown errors and spoofed timeout properties keep generic text with no private error content", async()=>{
  const {authWriteFailureText}=await import("../src/lib/account/authTransaction");
  for(const error of [new Error("synthetic-private-secret"),{name:"AuthTransactionTimeout",isAcquireTimeout:true},null]) {
    assert.equal(authWriteFailureText(error,true),"연결이 불안정해요. 잠시 후 다시 시도해 주세요.");
  }
});
