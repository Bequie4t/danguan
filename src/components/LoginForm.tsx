"use client";

import { useState } from "react";
import { getBrowserClient, runBrowserAuthWrite } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginForm({ next, signedOut, linkError }: { next: string; signedOut: boolean; linkError: boolean }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(
    signedOut
      ? { tone: "info", text: "로그아웃했어요. 이 기기에 표시되던 기록은 지웠어요." }
      : linkError
        ? { tone: "warn", text: "확인 링크가 만료되었거나 이미 사용되었어요. 다시 로그인해 주세요." }
        : null,
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = getBrowserClient();
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { error } = await runBrowserAuthWrite(supabase, () => supabase.auth.signInWithPassword({ email, password }));
        if (error) {
          setMessage({
            tone: "warn",
            text: error.message.toLowerCase().includes("confirm")
              ? "메일함에서 가입 확인 링크를 먼저 눌러 주세요."
              : "이메일 또는 비밀번호가 맞지 않아요.",
          });
          return;
        }
        // 서버 쪽 세션 쿠키를 반영하려고 페이지를 새로 연다.
        window.location.replace(`/consent?next=${encodeURIComponent(next)}`);
      } else {
        const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(`/consent?next=${next}`)}`;
        const { data, error } = await runBrowserAuthWrite(supabase, () => supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirect },
        }));
        if (error) {
          setMessage({
            tone: "warn",
            text: error.message.toLowerCase().includes("password")
              ? "비밀번호는 8자 이상으로 정해 주세요."
              : "가입하지 못했어요. 이메일을 확인하고 다시 시도해 주세요.",
          });
          return;
        }
        if (data.session) {
          window.location.replace(`/consent?next=${encodeURIComponent(next)}`);
        } else {
          setMessage({ tone: "info", text: "가입 확인 메일을 보냈어요. 메일의 링크를 누르면 이어서 진행돼요." });
        }
      }
    } catch {
      setMessage({ tone: "warn", text: "연결이 불안정해요. 잠시 후 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{mode === "signin" ? "로그인" : "계정 만들기"}</h1>
        <p className="text-muted">기록을 계정에 저장하면 다른 기기에서도 볼 수 있어요.</p>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-xl p-3 ${message.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft"}`}
        >
          {message.text}
        </p>
      )}

      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1">
          <span className="font-medium">이메일</span>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3"
          />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">비밀번호</span>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3"
          />
          {mode === "signup" && <span className="text-sm text-muted">8자 이상</span>}
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-14 w-full rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-60"
        >
          {busy ? "확인하는 중…" : mode === "signin" ? "로그인" : "계정 만들기"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="w-full rounded-xl px-4 py-3 text-accent underline-offset-4 hover:underline"
      >
        {mode === "signin" ? "처음이에요 · 계정 만들기" : "이미 계정이 있어요 · 로그인"}
      </button>

      <p className="text-sm text-muted">공용 기기라면 다 쓴 뒤 꼭 로그아웃해 주세요.</p>
    </div>
  );
}
