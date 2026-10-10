import { test } from "node:test";
import assert from "node:assert/strict";
import { browserOnlyPageAuth } from "../src/lib/account/browserAuthConfig";
const db = "https://wxqmqksqjmfflzghozuq.supabase.co";
test("browser page auth requires exact Preview, test database and explicit flag", () => {
  for (const path of ["/", "/today", "/records", "/consent", "/account", "/login"]) {
    assert.equal(browserOnlyPageAuth("preview", db, "true", path), true);
    for (const [env, url, flag] of [["production", db, "true"], [undefined, db, "true"], ["preview", "https://other.invalid", "true"], ["preview", db, undefined], ["preview", db, "false"]]) {
      assert.equal(browserOnlyPageAuth(env, url, flag, path), false);
    }
  }
});
test("approved callback pages bypass server refresh; other auth routes and API do not", () => {
  for (const path of ["/auth/callback", "/auth/complete"]) assert.equal(browserOnlyPageAuth("preview", db, "true", path), true);
  for (const path of ["/auth/other", "/api/account/delete", "/api/other"]) {
    assert.equal(browserOnlyPageAuth("preview", db, "true", path), false);
  }
});
