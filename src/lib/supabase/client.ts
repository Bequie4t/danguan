import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let cached: SupabaseClient | null = null;
let broken = false;

/**
 * 브라우저용 클라이언트. 설정이 비어 있거나 잘못되어 만들 수 없으면 null.
 * (도움 화면 등은 그대로 동작해야 하므로 오류를 던지지 않는다. 오류 내용은 기록하지 않는다.)
 */
export function getBrowserClient(): SupabaseClient | null {
  if (cached) return cached;
  if (broken) return null;
  const env = supabaseEnv();
  if (!env) return null;
  try {
    cached = createBrowserClient(env.url, env.key);
  } catch {
    broken = true; // 예: 주소 형식이 잘못됨. 설정이 없는 것과 같이 다룬다.
    return null;
  }
  return cached;
}
