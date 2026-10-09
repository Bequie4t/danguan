import test from "node:test";
import assert from "node:assert/strict";
import { createResponseLossTest, responseTestEnabled, TEST_DATABASE } from "../src/lib/checkins/responseTest";

test("응답 시험은 미리보기와 지정 테스트 DB에서만 활성화된다", () => {
  assert.equal(responseTestEnabled("preview", TEST_DATABASE), true);
  for (const environment of ["production", "development", undefined]) assert.equal(responseTestEnabled(environment, TEST_DATABASE), false);
  assert.equal(responseTestEnabled("preview", "https://production.supabase.co"), false);
});

test("서버 성공 후 첫 생성 응답만 유실하고 재시도는 전달한다", async () => {
  let writes = 0;
  const messages: string[] = [];
  const fake: typeof fetch = async () => { writes++; return new Response("{}", { status: 200 }); };
  const control = createResponseLossTest(fake, message => messages.push(message));
  control.arm();
  const url = `${TEST_DATABASE}/rest/v1/rpc/create_checkin`;
  await assert.rejects(control.fetch(url, { method: "POST" }), TypeError);
  assert.equal(writes, 1);
  assert.equal(messages.length, 1);
  assert.equal((await control.fetch(url, { method: "POST" })).status, 200);
  assert.equal(writes, 2);
});

test("다른 DB 요청은 건드리지 않고 거절 응답은 정상 전달한다", async () => {
  const control = createResponseLossTest(async () => new Response("{}", { status: 403 }), () => {});
  control.arm();
  assert.equal((await control.fetch("https://other.supabase.co/rest/v1/rpc/create_checkin", { method: "POST" })).status, 403);
  assert.equal((await control.fetch(`${TEST_DATABASE}/rest/v1/rpc/create_checkin`, { method: "POST" })).status, 403);
});

test("첫 조회 응답만 보류하고 새 계정 조회는 전달한다", async () => {
  let started!: () => void;
  const held = new Promise<void>(resolve => { started = resolve; });
  const control = createResponseLossTest(async () => new Response("[]"), () => started());
  control.holdNextList();
  let delivered = false;
  const previous = control.fetch(`${TEST_DATABASE}/rest/v1/checkins`).then(response => { delivered = true; return response; });
  await held;
  assert.equal(delivered, false);
  assert.equal((await control.fetch(`${TEST_DATABASE}/rest/v1/checkins`)).status, 200);
  assert.equal(delivered, false);
  control.release();
  assert.equal((await previous).status, 200);
  assert.equal(delivered, true);
});

for (const operation of ["create_checkin", "update_checkin", "delete_checkin"] as const) {
  test(`${operation}: 성공 응답만 보류하고 다음 계정 요청은 전달한다`, async () => {
    let signal!: () => void;
    const held = new Promise<void>(resolve => { signal = resolve; });
    const control = createResponseLossTest(async () => new Response("{}"), () => signal());
    control.holdNextWrite(operation);
    const url = `${TEST_DATABASE}/rest/v1/rpc/${operation}`;
    let delivered = false;
    const pending = control.fetch(url, { method: "POST" }).then(r => { delivered = true; return r; });
    await held;
    assert.equal(delivered, false);
    assert.equal((await control.fetch(url, { method: "POST" })).status, 200);
    assert.equal(delivered, false);
    control.release();
    assert.equal((await pending).status, 200);
    assert.equal(delivered, true);
  });
}

test("대기 중 취소하면 뒤늦은 서버 응답이 새 보류를 만들지 않는다", async () => {
  let finish!: (response: Response) => void;
  const backend = new Promise<Response>(resolve => { finish = resolve; });
  const messages: string[] = [];
  const control = createResponseLossTest(() => backend, message => messages.push(message));
  control.holdNextWrite("create_checkin");
  const request = control.fetch(`${TEST_DATABASE}/rest/v1/rpc/create_checkin`, { method: "POST" });
  control.cancel();
  finish(new Response("{}"));
  assert.equal((await request).status, 200);
  assert.deepEqual(messages, []);
});

test("쓰기 거절 응답과 다른 DB 요청은 보류하지 않는다", async () => {
  const control = createResponseLossTest(async () => new Response("{}", { status: 403 }), () => assert.fail("보류하면 안 됨"));
  control.holdNextWrite("delete_checkin");
  assert.equal((await control.fetch("https://other.supabase.co/rest/v1/rpc/delete_checkin", { method: "POST" })).status, 403);
  assert.equal((await control.fetch(`${TEST_DATABASE}/rest/v1/rpc/delete_checkin`, { method: "POST" })).status, 403);
});
