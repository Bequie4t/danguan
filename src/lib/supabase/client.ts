import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let cached: SupabaseClient | null = null;

/** 브라우저용 클라이언트. 설정이 비어 있으면 null (도움 화면 등은 그대로 동작해야 하므로 오류를 던지지 않는다). */
export function getBrowserClient(): SupabaseClient | null {
  if (cached) return cached;
  const env = supabaseEnv();
  if (!env) return null;
  cached = createBrowserClient(env.url, env.key);
  return cached;
}
