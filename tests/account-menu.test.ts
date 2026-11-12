// 계정 메뉴·브라우저 클라이언트: 도움 화면과 잘못된 설정에서 오류를 내지 않는지. 가상 값만.
import assert from "node:assert/strict";
import { test } from "node:test";

test("도움 화면 경로 판별: /help 와 그 아래만", async () => {
  const { isHelpPath } = await import("../src/components/AccountMenu");
  for (const p of ["/help", "/help/contact-card"]) assert.equal(isHelpPath(p), true, p);
  for (const p of ["/", "/helpful", "/records", "/today", null]) assert.equal(isHelpPath(p), false, String(p));
});

test("주소 형식이 잘못된 설정이면 브라우저 클라이언트는 오류 대신 null (설정 없음과 같이)", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-valid-url";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "virtual-test-key";
  const { getBrowserClient } = await import("../src/lib/supabase/client");
  assert.equal(getBrowserClient(), null);
  assert.equal(getBrowserClient(), null, "두 번째 호출도 null (다시 시도하며 오류를 내지 않음)");
});
