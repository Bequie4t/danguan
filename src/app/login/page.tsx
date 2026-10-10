import LoginForm from "@/components/LoginForm";
import { supabaseEnv } from "@/lib/supabase/env";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string; error?: string }>;
}) {
  const sp = await searchParams;
  if (!supabaseEnv()) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">아직 서버 설정이 되지 않았어요</h1>
        <p className="text-muted">
          README의 &lsquo;처음 설정하기&rsquo;를 따라 <code>.env.local</code>에 Supabase 주소와 공개 키를 넣은 뒤 다시 실행해 주세요.
        </p>
        <p className="text-muted">도움 화면은 설정과 상관없이 열려요.</p>
      </div>
    );
  }
  return (
    <LoginForm
      next={safeNext(sp.next)}
      signedOut={sp.signedOut === "1"}
      linkError={sp.error === "link"}
    />
  );
}
