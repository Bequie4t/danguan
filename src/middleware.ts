import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/supabase/env";
import { browserOnlyPageAuth } from "@/lib/account/browserAuthConfig";

// 로그인이 필요한 화면
const PROTECTED = ["/today", "/records", "/consent", "/account"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = supabaseEnv();
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));

  if (!env) {
    // 설정 전: 보호 화면은 로그인 화면(설정 안내 표시)으로 보낸다. 도움 화면은 이 미들웨어를 거치지 않는다.
    if (isProtected) return NextResponse.redirect(new URL("/login", request.url));
    return response;
  }

  if (browserOnlyPageAuth(process.env.VERCEL_ENV, env.url, process.env.TEST_BROWSER_AUTH_PREVIEW_ENABLED, path)) {
    // 서버는 개인 데이터를 내려주지 않는 화면 틀만 보낸다.
    // AuthScope가 표시를 제어하고 실제 데이터 권한은 RPC/RLS/API가 검증한다.
    // 늦은 일반 페이지 응답이 새 계정의 인증 쿠키를 덮어쓰지 않도록
    // 이 경로에서는 Supabase 클라이언트를 생성하거나 쿠키를 쓰지 않는다.
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
  } catch {
    userId = null;
  }

  if (isProtected && !userId) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // 개인 기록 화면은 브라우저·중간 서버에 캐시하지 않는다 (로그아웃 후 이전 화면이 보이지 않도록)
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  // 도움 화면(/help)과 정적 파일은 로그인·세션 처리를 거치지 않는다.
  matcher: ["/((?!help|api/account/delete|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
