"use client";

// 계정별 화면 범위.
//  - 지금 로그인한 사용자와 세션 세대가 바뀌면 안쪽 화면을 통째로 새로 만든다 (key 변경).
//    → 이전 계정의 입력·동의 상태·재시도 요청·저장 결과가 새 계정 화면으로 넘어가지 않는다.
//  - 로그아웃되면 로그인 화면으로 보낸다.
//  - 서버에 저장된 기록은 건드리지 않는다.
//  - 처음 세션 조회 결과가 늦게 와도, 그사이 반영된 계정 변경을 되돌리지 않는다.
//  - 안쪽 화면의 모든 요청은 useScopedRequest()로 보낸다:
//    요청 전 계정 확인 + 확인한 계정의 인증으로 요청 고정 + 늦은 응답 무시.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { pinnedClient } from "@/lib/supabase/pinned";
import {
  createSessionGuard,
  guardedRequest,
  type Guarded,
  type SessionAuth,
  type SessionGuard,
} from "@/lib/session/guard";

interface Scope {
  guard: SessionGuard;
  uid: string;
}

const ScopeContext = createContext<Scope | null>(null);

type View =
  | { kind: "checking" }
  | { kind: "in"; uid: string; generation: number; switched: boolean }
  | { kind: "out" }
  | { kind: "unconfigured" };

/** 지금 브라우저 세션의 사용자와 액세스 토큰 */
async function currentSessionAuth(): Promise<SessionAuth | null> {
  const supabase = getBrowserClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  return s?.user?.id && s.access_token ? { uid: s.user.id, accessToken: s.access_token } : null;
}

export default function AuthScope({ children }: { children: ReactNode }) {
  const [guard, setGuard] = useState<SessionGuard | null>(null);
  const [view, setView] = useState<View>({ kind: "checking" });

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setView({ kind: "unconfigured" });
      return;
    }
    // 이 효과가 살아 있는 동안만 쓰는 보호 범위. 정리될 때 폐기해서 남은 응답을 모두 무효로 만든다.
    const g = createSessionGuard(null);
    setGuard(g);
    let shownUid: string | null = null;

    const apply = (uid: string | null, generation: number) => {
      if (uid) {
        const switched = shownUid !== null && shownUid !== uid;
        shownUid = uid;
        setView({ kind: "in", uid, generation, switched });
      } else {
        setView({ kind: "out" });
        window.location.replace("/login?signedOut=1");
      }
    };
    const unsubscribeGuard = g.subscribe(apply);

    let alive = true;
    // 처음 세션 조회. 결과가 오기 전에 인증 이벤트가 먼저 반영됐다면(세대가 바뀜) 이 결과는 낡았으므로 버린다.
    const startGeneration = g.generation;
    currentSessionAuth()
      .then((auth) => {
        if (!alive || g.generation !== startGeneration) return;
        const uid = auth?.uid ?? null;
        if (!g.setUserIfCurrent(uid, startGeneration)) apply(g.uid, g.generation); // 처음부터 로그아웃 상태인 경우
      })
      .catch(() => {
        if (alive) g.setUserIfCurrent(null, startGeneration);
      });

    // 다른 탭의 로그아웃·다른 계정 로그인도 여기로 들어온다. 이벤트는 지금 이 순간의 상태다.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) g.setUser(session?.user?.id ?? null);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
      unsubscribeGuard();
      g.dispose();
    };
  }, []);

  if (view.kind === "unconfigured") {
    return <p className="text-muted">서버 설정이 아직 되지 않았어요. 도움 화면은 그대로 열려요.</p>;
  }
  if (view.kind === "out") {
    return <p className="text-muted">로그인 화면으로 이동하는 중이에요…</p>;
  }
  if (view.kind !== "in" || !guard) {
    return <p className="text-muted">로그인 상태를 확인하는 중이에요…</p>;
  }
  return (
    <ScopeContext.Provider value={{ guard, uid: view.uid }}>
      {view.switched && (
        <p role="status" className="mb-4 rounded-xl border border-line p-3 text-sm">
          다른 계정으로 바뀌어서, 이전 계정 화면의 입력과 기록을 비웠어요.
        </p>
      )}
      {/* 사용자나 세대가 바뀌면 key가 바뀌어 안쪽 상태가 모두 새로 시작된다 */}
      <div key={`${view.uid}:${view.generation}`}>{children}</div>
    </ScopeContext.Provider>
  );
}

export function useAuthScope(): Scope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("AuthScope 안에서만 쓸 수 있어요");
  return scope;
}

/**
 * 계정 범위 안에서 요청을 보낸다.
 *  - 보내기 전에 실제 세션 사용자를 확인한다.
 *  - 요청은 확인한 계정의 액세스 토큰으로 고정된 클라이언트(client)로만 보낸다.
 *  - 응답이 오면 화면이 닫혔거나 계정이 바뀌었는지 확인한다.
 * 결과가 { ok: false }이면 화면에 아무것도 반영하지 않는다.
 */
export function useScopedRequest() {
  const { guard } = useAuthScope();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(
    async <T,>(send: (client: SupabaseClient) => Promise<T>): Promise<Guarded<T>> => {
      try {
        return await guardedRequest({
          guard,
          getSessionAuth: currentSessionAuth,
          isMounted: () => mounted.current,
          send: (auth) => {
            const client = pinnedClient(auth.accessToken);
            if (!client) throw new Error("unconfigured");
            return send(client);
          },
        });
      } catch {
        return { ok: false, reason: "closed" };
      }
    },
    [guard],
  );
}
