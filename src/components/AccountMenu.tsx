"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// 로그인 코드는 필요할 때만 불러온다. 도움 화면(/help)에서는 아예 불러오지 않는다.
const loadClient = () => import("@/lib/supabase/client").then((m) => m.getBrowserClient());

/** /help 와 그 아래(연락처 파일 등)는 로그인과 독립 */
export function isHelpPath(pathname: string | null): boolean {
  return pathname === "/help" || (pathname ?? "").startsWith("/help/");
}

/**
 * 로그인 상태 표시와 로그아웃. 실패해도 머리글(도움 버튼)은 그대로 보인다.
 * 도움 화면에서는 아무것도 하지 않고 표시하지도 않는다 (인증 초기화·네트워크 요청 없음).
 */
export default function AccountMenu() {
  const pathname = usePathname();
  const onHelp = isHelpPath(pathname);
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (onHelp) return;
    let alive = true;
    let unsubscribe: (() => void) | null = null;
    loadClient()
      .then((supabase) => {
        if (!alive) return;
        if (!supabase) {
          setState("out");
          return;
        }
        supabase.auth
          .getUser()
          .then(({ data }) => alive && setState(data.user ? "in" : "out"))
          .catch(() => alive && setState("out"));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          if (alive) setState(session?.user ? "in" : "out");
        });
        unsubscribe = () => sub.subscription.unsubscribe();
      })
      .catch(() => alive && setState("out"));
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [onHelp]);

  if (onHelp) return null;

  async function signOut() {
    const supabase = await loadClient().catch(() => null);
    setBusy(true);
    try {
      await supabase?.auth.signOut({ scope: "local" });
    } catch {
      // 네트워크가 끊겨도 이 기기의 로그인 정보는 지운다 (scope: local)
    }
    // 화면에 남은 이전 사용자의 기록을 모두 비우기 위해 페이지를 새로 연다.
    window.location.replace("/login?signedOut=1");
  }

  if (state === "in") {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="rounded-lg px-2.5 py-2 text-[0.95rem] text-muted hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? "로그아웃 중…" : "로그아웃"}
      </button>
    );
  }
  if (state === "out") {
    return (
      <Link href="/login" className="rounded-lg px-2.5 py-2 text-[0.95rem] text-muted hover:bg-accent-soft">
        로그인
      </Link>
    );
  }
  return null;
}
