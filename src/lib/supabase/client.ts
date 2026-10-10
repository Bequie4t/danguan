import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";
import { clearDeletedBrowserSession, sessionCookieName, withSessionCookieLock } from "../account/browserSession";

let cached: SupabaseClient | null = null;

/** 브라우저용 클라이언트. 설정이 비어 있으면 null (도움 화면 등은 그대로 동작해야 하므로 오류를 던지지 않는다). */
export function getBrowserClient(): SupabaseClient | null {
  if (cached) return cached;
  const env = supabaseEnv();
  if (!env) return null;
  // 이번 Preview 시험의 브라우저 쿠키 쓰기와 삭제 후 정리를 같은 Web Lock으로 직렬화한다.
  // 운영 프로젝트의 인증 동작은 바꾸지 않는다.
  const testPreview = env.url === "https://wxqmqksqjmfflzghozuq.supabase.co" && typeof document !== "undefined" && typeof navigator !== "undefined" && !!navigator.locks;
  cached = createBrowserClient(env.url, env.key, testPreview ? { cookies: {
    getAll: () => parseCookieHeader(document.cookie).map(c => ({ name: c.name, value: c.value ?? "" })),
    setAll: cookies => withSessionCookieLock(sessionCookieName(env.url), () => {
      cookies.forEach(({ name, value, options }) => { document.cookie = serializeCookieHeader(name, value, options); });
    }),
  } } : undefined);
  return cached;
}

export async function clearDeletedAccountSession(uid: string) {
  const env = supabaseEnv();
  if (!env || env.url !== "https://wxqmqksqjmfflzghozuq.supabase.co") return "unverified" as const;
  return clearDeletedBrowserSession(env.url, uid);
}
