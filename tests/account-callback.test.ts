import { test } from "node:test";
import assert from "node:assert/strict";
import { createChunks, stringToBase64URL } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";
import { commitCallbackSession, exchangeIsolatedCode, projectCookies } from "../src/lib/account/callback";
import type { CookieEntry } from "../src/lib/account/browserSession";
const url = "https://synthetic.supabase.co";
const base = "sb-synthetic-auth-token";
const session = (id: string): Session => ({ access_token: `e30.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.fake`, refresh_token: `synthetic-${id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
const verifier = (name = `${base}-code-verifier`) => ({ name, value: "base64-" + stringToBase64URL(JSON.stringify("synthetic-verifier")) });
test("isolated PKCE exchange never writes the existing B cookie snapshot", async () => {
  const cookies = [...createChunks(base, "base64-" + stringToBase64URL(JSON.stringify(session("B")))), verifier()];
  const original = JSON.stringify(cookies);
  let calls = 0;
  const result = await exchangeIsolatedCode(url, "synthetic-public-key", "synthetic-code", cookies, async (input, opts) => {
    calls++;
    assert.match(String(input), /grant_type=pkce/);
    assert.equal(JSON.parse(String(opts?.body)).code_verifier, "synthetic-verifier");
    return new Response(JSON.stringify(session("A")), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(result?.user.id, "A");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(cookies), original);
});
test("missing or wrong flow verifier never sends a code exchange", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; throw new Error("must_not_fetch"); };
  assert.equal(await exchangeIsolatedCode(url, "synthetic", "synthetic-code", [], fakeFetch), null);
  assert.equal(await exchangeIsolatedCode(url, "synthetic", "synthetic-code", [verifier()], fakeFetch, "a".repeat(32)), null);
  assert.equal(calls, 0);
});
test("flow-specific chunked PKCE verifier is supported", async () => {
  const flow = "a".repeat(32);
  const v = verifier(`${base}-flow-${flow}-code-verifier`);
  const result = await exchangeIsolatedCode(url, "synthetic", "synthetic-code", createChunks(v.name, v.value, 15), async () => new Response(JSON.stringify(session("A")), { status: 200, headers: { "Content-Type": "application/json" } }), flow);
  assert.equal(result?.user.id, "A");
});
test("callback cookie commit preserves a newly logged-in B without any write", () => {
  const expected = [verifier()];
  const now = [...expected, ...createChunks(base, "base64-" + stringToBase64URL(JSON.stringify(session("B"))))];
  let writes = 0;
  assert.equal(commitCallbackSession(base, expected, session("A"), () => now, () => { writes++; }), false);
  assert.equal(writes, 0);
});
test("confirmed unchanged snapshot commits only project session and verifies writes", () => {
  const expected = [verifier()];
  let cookies: CookieEntry[] = [...expected, { name: "vercel-protection", value: "synthetic" }];
  const write = (name: string, value: string, maxAge: number) => { cookies = cookies.filter(c => c.name !== name); if (maxAge !== 0) cookies.push({ name, value }); };
  assert.equal(commitCallbackSession(base, expected, session("A"), () => cookies, write), true);
  assert.ok(cookies.some(c => c.name === "vercel-protection"));
  assert.equal(cookies.some(c => c.name === `${base}-code-verifier`), false);
  assert.equal(commitCallbackSession(base, projectCookies(cookies, base), { ...session("A"), access_token: session("B").access_token }, () => cookies, write), false);
});
