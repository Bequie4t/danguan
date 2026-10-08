import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

// 요청 하나를 특정 계정의 인증으로 고정하는 클라이언트.
// 브라우저 기본 클라이언트는 요청을 보내는 순간의 로그인 상태를 쓰므로, 계정을 확인한 직후
// 다른 계정으로 바뀌면 이전 계정의 입력이 새 계정 인증으로 전송될 수 있다.
// 이 클라이언트는 계정 확인 시점의 액세스 토큰만 쓴다. 로그인 정보를 저장하거나 갱신하지 않는다.
// 토큰이 만료됐으면 서버가 거절한다(다른 계정으로 바뀌어 실행되지 않는다).

let cachedToken: string | null = null;
let cachedClient: SupabaseClient | null = null;

export function pinnedClient(accessToken: string): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  if (cachedClient && cachedToken === accessToken) return cachedClient;
  cachedToken = accessToken;
  cachedClient = createClient(env.url, env.key, {
    accessToken: async () => accessToken,
  });
  return cachedClient;
}
