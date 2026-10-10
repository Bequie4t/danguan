import { stringFromBase64URL, isChunkLike, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { tokenSubject } from "../session/guard";
import { authTransactionsEnabled, withAuthTransaction } from "./authTransaction";

export type CookieEntry = { name: string; value: string };
export type CleanupResult = "cleared" | "absent" | "changed" | "unverified";

// 쿠키의 UID는 삭제 권한에 사용하지 않는다. 서버가 삭제한 UID와 일치하는 로컬 인증만 정리한다.
export function clearDeletedSessionCookies(
  base: string,
  deletedUid: string,
  read: () => CookieEntry[],
  expire: (names: string[]) => void,
): CleanupResult {
  const cookies = read().filter(c => isChunkLike(c.name, base));
  if (!cookies.length) return "absent";
  const direct = cookies.find(c => c.name === base);
  const chunks = cookies.filter(c => c.name !== base).sort((a, b) => Number(a.name.slice(base.length + 1)) - Number(b.name.slice(base.length + 1)));
  if (direct && chunks.length) return "unverified";
  if (!direct && chunks.some((c, i) => c.name !== `${base}.${i}`)) return "unverified";
  const raw = direct?.value ?? chunks.map(c => c.value).join("");
  try {
    const session = JSON.parse(raw.startsWith("base64-") ? stringFromBase64URL(raw.slice(7)) : raw);
    const uid = session?.user?.id;
    if (typeof uid !== "string" || typeof session?.access_token !== "string" || tokenSubject(session.access_token) !== uid) return "unverified";
    if (uid !== deletedUid) return "changed";
  } catch { return "unverified"; }
  // 읽기와 삭제 사이에 await를 두지 않고, 삭제 직전 스냅샷도 다시 대조한다.
  const current = read().filter(c => isChunkLike(c.name, base));
  if (current.length !== cookies.length || current.some(c => !cookies.some(before => before.name === c.name && before.value === c.value))) return "changed";
  expire(cookies.map(c => c.name));
  return read().some(c => isChunkLike(c.name, base)) ? "unverified" : "cleared";
}

export function sessionCookieName(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

export async function withSessionCookieLock<T>(base: string, work: () => T): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error("cookie_lock_unavailable");
  return navigator.locks.request(`danguan-cookie-write:${base}`, work);
}

export async function clearDeletedBrowserSession(url: string, deletedUid: string): Promise<CleanupResult> {
  const base = sessionCookieName(url);
  const clear = () => withSessionCookieLock(base, () => clearDeletedSessionCookies(base, deletedUid,
    () => parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? "" })),
    names => names.forEach(name => { document.cookie = serializeCookieHeader(name, "", { path: "/", sameSite: "lax", maxAge: 0 }); }),
  ));
  return authTransactionsEnabled(url, process.env.NEXT_PUBLIC_TEST_AUTH_TRANSACTION_LOCK_ENABLED) ? withAuthTransaction(base, clear) : clear();
}
