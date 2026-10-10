import { test } from "node:test";
import assert from "node:assert/strict";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { clearDeletedSessionCookies, type CookieEntry } from "../src/lib/account/browserSession";

const base = "sb-synthetic-auth-token";
const token = (uid: string) => `e30.${Buffer.from(JSON.stringify({ sub: uid })).toString("base64url")}.fake`;
const session = (uid: string) => "base64-" + stringToBase64URL(JSON.stringify({ user: { id: uid }, access_token: token(uid) }));
function fixture(initial: CookieEntry[]) {
  let cookies = initial;
  const expired: string[] = [];
  return {
    read: () => cookies.map(c => ({ ...c })),
    expire: (names: string[]) => { expired.push(...names); cookies = cookies.filter(c => !names.includes(c.name)); },
    expired,
  };
}
test("deleted A cleanup removes only its session chunks, preserving Vercel and other auth cookies", () => {
  const f = fixture([...createChunks(base, session("A"), 25), { name: "vercel-protection", value: "synthetic" }, { name: `${base}-code-verifier`, value: "new-login" }, { name: "sb-other-auth-token", value: session("B") }]);
  assert.equal(clearDeletedSessionCookies(base, "A", f.read, f.expire), "cleared");
  assert.deepEqual(f.read().map(c => c.name), ["vercel-protection", `${base}-code-verifier`, "sb-other-auth-token"]);
});
test("a delayed deleted A cleanup cannot remove current B session", () => {
  const f = fixture([{ name: base, value: session("B") }]);
  assert.equal(clearDeletedSessionCookies(base, "A", f.read, f.expire), "changed");
  assert.equal(f.expired.length, 0);
  assert.equal(f.read()[0].value, session("B"));
});
test("cleanup rechecks session snapshot immediately before expiration", () => {
  let reads = 0;
  let expired = false;
  assert.equal(clearDeletedSessionCookies(base, "A", () => [{ name: base, value: session(++reads === 1 ? "A" : "B") }], () => { expired = true; }), "changed");
  assert.equal(expired, false);
});
test("missing, malformed, ambiguous and mismatched session cookies are never broadly cleared", () => {
  for (const cookies of [[], [{ name: base, value: "bad" }], [{ name: `${base}.1`, value: session("A") }], [{ name: base, value: session("A") }, { name: `${base}.0`, value: session("B") }], [{ name: base, value: JSON.stringify({ user: { id: "A" }, access_token: token("B") }) }]]) {
    const f = fixture(cookies);
    assert.ok(["absent", "unverified"].includes(clearDeletedSessionCookies(base, "A", f.read, f.expire)));
    assert.equal(f.expired.length, 0);
  }
});
test("cleanup verifies actual cookie removal instead of assuming success", () => {
  assert.equal(clearDeletedSessionCookies(base, "A", () => [{ name: base, value: session("A") }], () => {}), "unverified");
});
