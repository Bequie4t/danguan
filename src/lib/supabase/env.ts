// 공개 설정값만 읽는다. 비밀 키(service_role / secret)는 이 프로젝트 어디에서도 쓰지 않는다.
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("xxxxxxxx") || key.startsWith("여기에")) return null;
  return { url, key };
}
