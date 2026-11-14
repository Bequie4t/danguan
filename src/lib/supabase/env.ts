// 공개 설정값만 읽는다. 비밀 키(service_role / secret)는 이 프로젝트 어디에서도 쓰지 않는다.
// 주소 형식이 잘못된 설정은 '설정 없음'과 같이 다룬다. 그대로 쓰면 미들웨어·서버에서 Supabase 클라이언트가
// 예외를 던져 모든 화면이 500이 된다 (브라우저 클라이언트는 원래 같은 경우를 '설정 없음'으로 다뤘다).
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("xxxxxxxx") || key.startsWith("여기에")) return null;
  if (!isHttpUrl(url)) return null;
  return { url, key };
}

/**
 * Supabase 클라이언트가 받는 주소인지. @supabase/supabase-js의 validateSupabaseUrl과 같은 규칙:
 * 앞뒤 공백을 뺀 값이 http:// 또는 https:// 로 시작하고 URL로 해석돼야 한다.
 */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
    return true;
  } catch {
    return false;
  }
}
