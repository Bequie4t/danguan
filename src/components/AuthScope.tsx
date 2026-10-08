"use client";

// 로그인한 사용자 단위로 화면을 나눈다.
// - 사용자가 바뀌면(다른 탭에서 로그아웃·다른 계정 로그인) 아래 화면을 통째로 새로 만든다(key).
//   → 이전 사용자의 입력, 재시도 대기 요청, 저장 결과가 새 계정 화면으로 넘어가지 않는다.
// - 진행 중이던 요청의 응답은 guard.isCurrent(표)로 한 번 더 걸러서 버린다.
// - 로그아웃되면 로그인 화면으로 보낸다.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { createSessionGuard, type SessionGuard } from "@/lib/session/guard";

interface Scope {
  uid: string;
  guard: SessionGuard;
}

const ScopeContext = createContext<Scope | null>(null);

export function useAuthScope(): Scope {
  const s = useContext(ScopeContext);
  if (!s) throw new Error("AuthScope 밖에서 사용됨");
  return s;
}

export default function AuthScope({ children }: { children: ReactNode }) {
  const guardRef = useRef<SessionGuard>(createSessionGuard());
  const [view, setView] = useState<{ uid: string | null | undefined; generation: number; switched: boolean }>({
    uid: undefined,
    generation: 0,
    switched: false,
  });

  useEffect(() => {
    const supabase = getBrowserClient();
    const guard = guardRef.current;
    if (!supabase) {
      setView({ uid: null, generation: guard.generation, switched: false });
      return;
    }
    let alive = true;

    const apply = (uid: string | null) => {
      if (!alive) return;
      const before = guard.uid;
      const changed = guard.setUser(uid);
      if (uid === null) {
        window.location.replace("/login?signedOut=1");
      }
      setView((v) =>
        changed || v.uid === undefined
          ? { uid, generation: guard.generation, switched: changed && before !== null && uid !== null }
          : v,
      );
    };

    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session?.user?.id ?? null))
      .catch(() => apply(null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user?.id ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (view.uid === undefined) return <p className="text-muted">로그인 상태를 확인하는 중이에요…</p>;
  if (view.uid === null) return <p className="text-muted">로그인 화면으로 이동하는 중이에요…</p>;

  return (
    <ScopeContext.Provider value={{ uid: view.uid, guard: guardRef.current }}>
      {view.switched && (
        <p role="status" className="mb-4 rounded-xl border border-line p-3 text-sm">
          다른 계정으로 바뀌어서, 이전 계정 화면의 입력과 기록을 비웠어요.
        </p>
      )}
      <div key={`${view.uid}:${view.generation}`}>{children}</div>
    </ScopeContext.Provider>
  );
}
