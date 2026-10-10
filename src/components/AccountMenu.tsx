"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrowserClient, browserAuthTransactionMode } from "@/lib/supabase/client";

/** 로그인 상태 표시와 로그아웃. 실패해도 머리글(도움 버튼)은 그대로 보인다. */
export default function AccountMenu() {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");
  const [busy, setBusy] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setState("out");
      return;
    }
    let alive = true;
    supabase.auth
      .getUser()
      .then(({ data }) => alive && setState(data.user ? "in" : "out"))
      .catch(() => alive && setState("out"));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState(session?.user ? "in" : "out");
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = getBrowserClient();
    setBusy(true);
    setSignOutFailed(false);
    try {
      const result = await supabase?.auth.signOut({ scope: "local" });
      if (browserAuthTransactionMode() && (!result || result.error)) {
        setBusy(false);
        setSignOutFailed(true);
        return;
      }
    } catch {
      if (browserAuthTransactionMode()) {
        setBusy(false);
        setSignOutFailed(true);
        return;
      }
      // 네트워크가 끊겨도 이 기기의 로그인 정보는 지운다 (scope: local)
    }
    // 화면에 남은 이전 사용자의 기록을 모두 비우기 위해 페이지를 새로 연다.
    window.location.replace("/login?signedOut=1");
  }

  if (state === "in") {
    return (
      <>
      <Link href="/account" className="rounded-lg px-2.5 py-2 text-[0.95rem] text-muted hover:bg-accent-soft">계정</Link>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="rounded-lg px-2.5 py-2 text-[0.95rem] text-muted hover:bg-accent-soft disabled:opacity-60"
      >
        {busy ? "로그아웃 중…" : "로그아웃"}
      </button>
      {signOutFailed && <p role="alert" className="text-sm text-warn">로그아웃을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.</p>}
      </>
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
