import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteOwnAccount, type DeleteDependencies } from "../src/lib/account/delete";
import { deletionAllowed } from "../src/lib/account/config";
import { TEST_DATABASE } from "../src/lib/checkins/responseTest";
import { sameOrigin } from "../src/lib/account/http";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const input = { token: "fake-original-A", expectedUid: A, password: "fake-password" };
test("same-origin validation uses received Host and rejects cross-site or forwarded host substitution", () => {
  const request = (origin: string | undefined, host = "127.0.0.1:3198") => new Request("http://localhost:3198/api/account/delete", {
    headers: { host, ...(origin ? { origin } : {}), "x-forwarded-host": "other.invalid" },
  });
  assert.equal(sameOrigin(request("http://127.0.0.1:3198")), true);
  assert.equal(sameOrigin(request("https://other.invalid")), false);
  assert.equal(sameOrigin(request(undefined)), false);
  assert.equal(sameOrigin(request("http://127.0.0.1:3198", "bad.invalid,127.0.0.1:3198")), false);
});
function fixture(overrides: Partial<DeleteDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: DeleteDependencies = {
    async verify() { calls.push("verify"); return { id: A, email: "a@example.invalid" }; },
    async reauthenticate(email) { calls.push(`reauth:${email}`); return { uid: A, token: "fake-fresh-A" }; },
    async revoke(token, scope) { calls.push(`revoke:${scope}:${token}`); return true; },
    async remove(uid) { calls.push(`remove:${uid}`); return true; },
    ...overrides,
  };
  return { calls, dependencies };
}
test("deletion hard gate only allows explicitly enabled separated test Preview", () => {
  const key = "sb_secret_fake_test_only_key";
  assert.equal(deletionAllowed("preview", TEST_DATABASE, "true", key), true);
  for (const args of [
    ["production", TEST_DATABASE, "true", key], ["development", TEST_DATABASE, "true", key],
    ["preview", "https://production.invalid", "true", key], ["preview", TEST_DATABASE, undefined, key],
    ["preview", TEST_DATABASE, "true", undefined], ["preview", TEST_DATABASE, "true", "anon"],
  ]) assert.equal(deletionAllowed(...args as [string, string, string | undefined, string | undefined]), false);
  const legacy = (role: string, ref: string) => `fake.${Buffer.from(JSON.stringify({ role, ref })).toString("base64url")}.fake`;
  assert.equal(deletionAllowed("preview", TEST_DATABASE, "true", legacy("service_role", "wxqmqksqjmfflzghozuq")), true);
  assert.equal(deletionAllowed("preview", TEST_DATABASE, "true", legacy("anon", "wxqmqksqjmfflzghozuq")), false);
  assert.equal(deletionAllowed("preview", TEST_DATABASE, "true", legacy("service_role", "another-project")), false);
});
test("verified own account is reauthenticated and globally revoked before deletion", async () => {
  const f = fixture();
  assert.equal(await deleteOwnAccount(f.dependencies, input), "deleted");
  assert.deepEqual(f.calls, ["verify", "reauth:a@example.invalid", "verify", "revoke:global:fake-fresh-A", `remove:${A}`]);
});
test("unauthenticated requests never reauthenticate or delete", async () => {
  const f = fixture({ verify: async () => null });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "signed_out");
  assert.deepEqual(f.calls, []);
});
test("body UID cannot choose another account to delete", async () => {
  const f = fixture();
  assert.equal(await deleteOwnAccount(f.dependencies, { ...input, expectedUid: B }), "account_changed");
  assert.deepEqual(f.calls, ["verify"]);
});
test("wrong password never revokes or deletes the existing account", async () => {
  const f = fixture({ reauthenticate: async () => null });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "wrong_password");
  assert.deepEqual(f.calls, ["verify"]);
});
test("reauthentication UID mismatch cleans only the fresh session, never deletes", async () => {
  const f = fixture({ reauthenticate: async () => ({ uid: B, token: "fake-fresh-B" }) });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "account_changed");
  assert.deepEqual(f.calls, ["verify", "revoke:local:fake-fresh-B"]);
});
test("authentication disappears during reauthentication: no deletion", async () => {
  let count = 0;
  const f = fixture({ verify: async () => ++count === 1 ? { id: A, email: "a@example.invalid" } : null });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "signed_out");
  assert.deepEqual(f.calls, ["reauth:a@example.invalid", "revoke:local:fake-fresh-A"]);
});
test("revocation failure prevents deletion", async () => {
  const f = fixture({ revoke: async () => false });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "revoke_failed");
  assert.ok(!f.calls.some(c => c.startsWith("remove:")));
});
test("explicit removal failure is not reported as success", async () => {
  const f = fixture({ remove: async () => false });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "delete_failed");
});
test("lost deletion response stays uncertain without leaking error content", async () => {
  const f = fixture({ remove: async () => { throw new Error("sensitive fake error"); } });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "uncertain");
});
test("pre-deletion network failure stays unavailable and cleans fresh verification session", async () => {
  let count = 0;
  const f = fixture({ verify: async () => { if (++count === 2) throw new Error("fake network"); return { id: A, email: "a@example.invalid" }; } });
  assert.equal(await deleteOwnAccount(f.dependencies, input), "unavailable");
  assert.deepEqual(f.calls, ["reauth:a@example.invalid", "revoke:local:fake-fresh-A"]);
});
