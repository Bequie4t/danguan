// 실제 Next.js HTTP 경로: 관리자 설정이 있어도 운영 환경에서는 삭제가 차단된다.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:3198";
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3198", "-H", "127.0.0.1"], {
  stdio: "ignore",
  env: { ...process.env, VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://wxqmqksqjmfflzghozuq.supabase.co", ACCOUNT_DELETE_PREVIEW_ENABLED: "true", SUPABASE_ACCOUNT_DELETE_KEY: "sb_secret_fake_no_real_permissions" },
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("local server stopped");
    try { const r = await fetch(`${origin}/help`); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "local Next.js starts");
  const url = `${origin}/api/account/delete`;
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://other.invalid", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const response = await fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: "Bearer fake.synthetic.token" }, body: JSON.stringify({ expectedUid: "cccccccc-0000-4000-8000-000000000003", password: "synthetic-password", confirmation: "계정 삭제" }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { reason: "disabled" });
  assert.match(response.headers.get("cache-control"), /no-store/);
  console.log("DELETION_PRODUCTION_GATE_PASSED");
} finally {
  if (child.exitCode === null) {
    const done = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await done;
  }
}
