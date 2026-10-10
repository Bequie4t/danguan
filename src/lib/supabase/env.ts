// 이 모듈은 공개 설정값만 읽는다. 계정 삭제 시험의 관리자 키는 별도 서버 전용 모듈에서만 읽는다.
export function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("xxxxxxxx") || key.startsWith("여기에")) return null;
  return { url, key };
}
