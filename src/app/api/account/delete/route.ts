import { deleteOwnAccount } from "@/lib/account/delete";
import { deletionConfig, deletionDependencies } from "@/lib/account/server";
import { sameOrigin } from "@/lib/account/http";

export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; expires: number; busy: boolean }>();
const reply = (status: number, reason: string) => Response.json({ reason }, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply(403, "invalid_request");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415, "invalid_request");
  const config = deletionConfig();
  if (!config) return reply(503, "disabled");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]{1,8192})$/)?.[1];
  if (!token) return reply(401, "signed_out");
  let body: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(400, "invalid_request");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return reply(413, "invalid_request"); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, "invalid_request");
  } catch { return reply(400, "invalid_request"); }
  if (typeof body.expectedUid !== "string" || !/^[0-9a-f-]{36}$/i.test(body.expectedUid) || typeof body.password !== "string" || !body.password || body.password.length > 1000 || body.confirmation !== "계정 삭제") return reply(400, "invalid_request");
  const dependencies = deletionDependencies(config);
  let user;
  try { user = await dependencies.verify(token); } catch { return reply(503, "unavailable"); }
  if (!user) return reply(401, "signed_out");
  if (user.id !== body.expectedUid) return reply(409, "account_changed");
  const now = Date.now();
  for (const [uid, entry] of attempts) if (!entry.busy && entry.expires < now) attempts.delete(uid);
  const entry = attempts.get(user.id) ?? { count: 0, expires: now + 15 * 60_000, busy: false };
  // 실행 인스턴스 내 중복·횟수 제한. 여러 Vercel 인스턴스의 전역 제한은 별도 과제다.
  if (entry.busy || entry.count >= 5 || (!attempts.has(user.id) && attempts.size >= 1000)) return reply(429, "retry_later");
  entry.count += 1;
  entry.busy = true;
  attempts.set(user.id, entry);
  try {
    const result = await deleteOwnAccount(dependencies, { token, expectedUid: user.id, password: body.password });
    const status = result === "deleted" ? 200 : result === "wrong_password" ? 400 : result === "signed_out" ? 401 : result === "account_changed" ? 409 : 503;
    return reply(status, result);
  } finally { entry.busy = false; }
}
