// 실제 Supabase SDK의 요청 헤더 검증. 가상 토큰·가상 응답만 사용하며 네트워크에 보내지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pinnedClient } from "../src/lib/supabase/pinned";

test("실제 SDK: B 클라이언트를 만든 뒤에도 A의 생성·수정·삭제·조회는 고정한 A 인증을 쓴다", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const seen: { url: string; authorization: string | null }[] = [];
  const token = (uid: string) => `e30.${Buffer.from(JSON.stringify({ sub: uid })).toString("base64url")}.fake`;
  const aToken = token("user-a");
  const bToken = token("user-b");
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-public-key";
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, authorization: request.headers.get("Authorization") });
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const a = pinnedClient(aToken);
    const b = pinnedClient(bToken);
    assert.ok(a && b);
    for (const fn of ["create_checkin", "update_checkin", "delete_checkin"]) {
      assert.equal((await a.rpc(fn, { p_id: "fake-id" })).error, null);
    }
    assert.equal((await a.from("checkins").select("id").limit(1)).error, null);
    assert.equal((await b.from("checkins").select("id").limit(1)).error, null);
    assert.equal(seen.length, 5);
    assert.ok(seen.slice(0, 4).every((r) => r.authorization === `Bearer ${aToken}`));
    assert.equal(seen[4].authorization, `Bearer ${bToken}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});
