"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseEnv } from "@/lib/supabase/env";
import { safeNext } from "@/lib/safeNext";
import { completeBrowserCallback, readCallbackCookies } from "@/lib/account/callback";
import { sessionCookieName, type CookieEntry } from "@/lib/account/browserSession";
import { isChunkLike } from "@supabase/ssr";

export default function CallbackConfirmation() {
  const code = useRef<string | null>(null);
  const next = useRef("/consent");
  const flow = useRef<string | undefined>(undefined);
  const expected = useRef<CookieEntry[]>([]);
  const initialized = useRef(false);
  const submitted = useRef(false);
  const active = useRef(true);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "changed" | "error">("loading");
  const [existing, setExisting] = useState(false);
  useEffect(() => {
    active.current = true;
    if (initialized.current) return () => { active.current = false; };
    initialized.current = true;
    const url = new URL(window.location.href);
    code.current = url.searchParams.get("exchange_code");
    next.current = safeNext(url.searchParams.get("next"), "/consent");
    flow.current = url.searchParams.get("exchange_flow") ?? undefined;
    window.history.replaceState(null, "", "/auth/complete");
    const env = supabaseEnv();
    if (!env || !code.current || code.current.length > 4096) { setState("error"); return; }
    expected.current = readCallbackCookies(env.url);
    setExisting(expected.current.some(c => isChunkLike(c.name, sessionCookieName(env.url))));
    setState("ready");
    return () => { active.current = false; };
  }, []);
  async function confirm() {
    if (submitted.current || !code.current) return;
    submitted.current = true;
    setState("busy");
    const env = supabaseEnv();
    if (!env) { code.current = null; setState("error"); return; }
    const result = await completeBrowserCallback(env.url, env.key, code.current, expected.current, flow.current, () => active.current);
    code.current = null;
    if (!active.current) return;
    if (result === "saved") window.location.replace(next.current);
    else setState(result);
  }
  return <div className="mx-auto max-w-md space-y-4">
    <h1 className="text-2xl font-bold">가입 확인</h1>
    {state === "loading" && <p>확인할 준비를 하고 있어요…</p>}
    {state === "ready" && <>
      <p>{existing ? "이미 로그인한 계정이 있어요. 이 링크의 계정으로 바꾸려면 아래에서 계속하기를 선택해 주세요." : "메일의 확인 링크를 이어서 처리할까요?"}</p>
      <button type="button" onClick={() => void confirm()} className="min-h-14 rounded-xl bg-accent px-5 font-semibold text-accent-fg">가입 확인 계속하기</button>
    </>}
    {state === "busy" && <p role="status">가입을 확인하는 중이에요…</p>}
    {state === "changed" && <p role="alert">확인하는 동안 로그인 상태가 바뀌어서 현재 계정을 유지했어요. 다시 로그인해 주세요.</p>}
    {state === "error" && <p role="alert">링크를 확인하지 못했어요. 만료되었거나 이 브라우저에 확인 정보가 없을 수 있어요. 다시 로그인해 주세요.</p>}
    <Link onClick={() => { active.current = false; code.current = null; }} href={existing ? "/today" : "/login"} className="block text-accent underline">{existing ? "현재 로그인 유지하기" : "로그인으로 돌아가기"}</Link>
  </div>;
}
