import { AuthClient, type Session } from "@supabase/supabase-js";
import { createChunks, DEFAULT_COOKIE_OPTIONS, isChunkLike, parseCookieHeader, serializeCookieHeader, stringFromBase64URL, stringToBase64URL } from "@supabase/ssr";
import { sessionCookieName, withSessionCookieLock, type CookieEntry } from "./browserSession";
import { tokenSubject } from "../session/guard";

export function projectCookies(cookies: CookieEntry[], base: string): CookieEntry[] {
  return cookies.filter(c => isChunkLike(c.name, base) || (c.name.startsWith(`${base}-`) && /-code-verifier(?:\.\d+)?$/.test(c.name)));
}
export function sameCookies(a: CookieEntry[], b: CookieEntry[]): boolean {
  return a.length === b.length && a.every(c => b.some(v => v.name === c.name && v.value === c.value));
}
export function commitCallbackSession(base: string, expected: CookieEntry[], session: Session, read: () => CookieEntry[], write: (name: string, value: string, maxAge: number) => void, flowId?: string): boolean {
  if (tokenSubject(session.access_token) !== session.user.id) return false;
  if (!sameCookies(expected, projectCookies(read(), base))) return false;
  const chunks = createChunks(base, "base64-" + stringToBase64URL(JSON.stringify(session)));
  for (const c of expected.filter(c => isChunkLike(c.name, base))) if (!chunks.some(v => v.name === c.name)) write(c.name, "", 0);
  for (const c of chunks) write(c.name, c.value, DEFAULT_COOKIE_OPTIONS.maxAge!);
  if (!sameCookies(chunks, read().filter(c => isChunkLike(c.name, base)))) return false;
  const consumed = flowId ? `${base}-flow-${flowId}-code-verifier` : `${base}-code-verifier`;
  for (const c of expected.filter(c => isChunkLike(c.name, consumed))) write(c.name, "", 0);
  if (flowId) {
    const raw = (name: string) => expected.filter(c => isChunkLike(c.name, name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(c => c.value).join("");
    const legacy = `${base}-code-verifier`;
    if (raw(consumed) && raw(consumed) === raw(legacy)) for (const c of expected.filter(c => isChunkLike(c.name, legacy))) write(c.name, "", 0);
  }
  return true;
}

export async function exchangeIsolatedCode(url: string, key: string, code: string, expected: CookieEntry[], fetcher: typeof fetch = fetch, flowId?: string) {
  const base = sessionCookieName(url);
  const values = new Map<string, string>();
  // SDK에게 PKCE 검증값만 전달한다. 기존 계정 세션은 복사하거나 갱신하지 않는다.
  const verifierCookies = expected.filter(c => !isChunkLike(c.name, base));
  for (const name of new Set(verifierCookies.map(c => c.name.replace(/\.\d+$/, "")))) {
    const parts = verifierCookies.filter(c => isChunkLike(c.name, name)).sort((a, b) => Number(a.name.slice(name.length + 1)) - Number(b.name.slice(name.length + 1)));
    const direct = parts.find(c => c.name === name);
    if (direct && parts.length !== 1) continue;
    if (!direct && parts.some((c, i) => c.name !== `${name}.${i}`)) continue;
    const value = direct?.value ?? parts.map(c => c.value).join("");
    try {
      const decoded = value.startsWith("base64-") ? stringFromBase64URL(value.slice(7)) : value;
      values.set(name, decoded);
    } catch { /* SDK가 검증값 없음으로 거부한다. */ }
  }
  const auth = new AuthClient({ url: `${url}/auth/v1`, headers: { apikey: key }, storageKey: base,
    flowType: "pkce", autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
    storage: { getItem: name => values.get(name) ?? null, setItem: (name, value) => { values.set(name, value); }, removeItem: name => { values.delete(name); } }, fetch: fetcher,
  });
  try {
    const result = await auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (result.error || !result.data.session) return null;
    return result.data.session;
  } finally { values.clear(); }
}

export function readCallbackCookies(url: string): CookieEntry[] {
  return projectCookies(parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? "" })), sessionCookieName(url));
}
export async function completeBrowserCallback(url: string, key: string, code: string, expected: CookieEntry[], flowId?: string, shouldCommit: () => boolean = () => true): Promise<"saved" | "changed" | "error"> {
  try {
    const unchanged = await withSessionCookieLock(sessionCookieName(url), () => shouldCommit() && sameCookies(expected, readCallbackCookies(url)));
    if (!unchanged) return "changed";
    const session = await exchangeIsolatedCode(url, key, code, expected, fetch, flowId);
    if (!session) return "error";
    return await withSessionCookieLock(sessionCookieName(url), () => shouldCommit() && commitCallbackSession(sessionCookieName(url), expected, session,
      () => readCallbackCookies(url), (name, value, maxAge) => { document.cookie = serializeCookieHeader(name, value, { ...DEFAULT_COOKIE_OPTIONS, maxAge }); }, flowId)) ? "saved" : "changed";
  } catch { return "error"; }
}
