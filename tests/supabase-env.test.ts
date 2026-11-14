// 공개 설정값 읽기: 주소 형식이 잘못되면 '설정 없음'(null)으로 다룬다.
// 그대로 쓰면 미들웨어·서버의 Supabase 클라이언트가 예외를 던져 모든 화면이 500이 된다.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { isHttpUrl, supabaseEnv } from "../src/lib/supabase/env";

const KEY = "virtual-test-key";
const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});
const withEnv = (url: string | undefined, key: string | null = KEY) => {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === null) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
  return supabaseEnv();
};

const GOOD = ["https://abcdefgh.supabase.co", "http://127.0.0.1:54321", "HTTPS://example.test/", " https://example.test "];
const BAD = ["not-a-valid-url", "https:example.test", "ftp://example.test", "//example.test", "example.supabase.co", "https://", "javascript:alert(1)"];

test("올바른 http(s) 주소는 그대로 쓴다", () => {
  for (const url of GOOD) assert.deepEqual(withEnv(url), { url, key: KEY }, url);
});

test("주소 형식이 잘못되면 설정 없음(null)", () => {
  for (const url of BAD) assert.equal(withEnv(url), null, url);
});

test("값이 없거나 안내용 자리표시자면 설정 없음 (기존 동작 유지)", () => {
  assert.equal(withEnv(undefined), null);
  assert.equal(withEnv("https://example.test", null), null);
  assert.equal(withEnv("https://xxxxxxxx.supabase.co"), null);
  assert.equal(withEnv("https://example.test", "여기에 키를 넣으세요"), null);
});

test("판정이 supabase-js와 같다: 통과한 주소는 클라이언트를 만들 수 있고, 거부한 주소는 클라이언트도 거부한다", () => {
  for (const url of GOOD) {
    assert.equal(isHttpUrl(url), true, url);
    assert.doesNotThrow(() => createClient(url, KEY, { auth: { persistSession: false, autoRefreshToken: false } }), url);
  }
  for (const url of BAD.filter((u) => u !== "https://")) {
    assert.equal(isHttpUrl(url), false, url);
    assert.throws(() => createClient(url, KEY, { auth: { persistSession: false, autoRefreshToken: false } }), url);
  }
});
