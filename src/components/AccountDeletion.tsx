"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useAuthScope, useScopedAuthRequest } from "./AuthScope";

const messages: Record<string, string> = {
  wrong_password: "비밀번호를 확인해 주세요. 계정은 삭제하지 않았어요.",
  signed_out: "로그인 상태를 확인하지 못했어요. 다시 로그인한 뒤 계정을 확인해 주세요.",
  account_changed: "계정이 바뀌어서 진행하지 않았어요. 현재 계정을 다시 확인해 주세요.",
  disabled: "이 환경에서는 계정 삭제 시험이 아직 준비되지 않았어요.",
  retry_later: "잠시 후 다시 시도해 주세요. 진행 중인 요청이 있다면 먼저 결과를 확인해 주세요.",
  revoke_failed: "로그인 종료를 확인하지 못해서 삭제를 진행하지 않았어요. 다시 로그인해 계정을 확인해 주세요.",
  delete_failed: "삭제를 완료하지 못했어요. 다시 로그인해 계정 상태를 확인해 주세요.",
  uncertain: "삭제 결과를 확인하지 못했어요. 완료됐다고 표시하지 않았어요. 다시 로그인해 계정 상태를 확인해 주세요.",
  unavailable: "연결 또는 본인 확인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

export default function AccountDeletion({ enabled }: { enabled: boolean }) {
  const { guard } = useAuthScope();
  const run = useScopedAuthRequest();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let alive = true;
    void run(async (auth) => {
      const client = getBrowserClient();
      if (!client) throw new Error("unconfigured");
      const { data, error } = await client.auth.getUser(auth.accessToken);
      if (error || data.user?.id !== auth.uid) throw new Error("unverified");
      return data.user.email ?? null;
    }).then((result) => {
      if (!alive || !("ticket" in result) || !guard.isCurrent(result.ticket)) return;
      if (result.ok && result.value) setEmail(result.value);
      else setMessage(messages.signed_out);
    });
    return () => { alive = false; };
  }, [run, guard]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!enabled || !email || !password || confirmation !== "계정 삭제" || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage(null);
    const result = await run(async (auth) => {
      const response = await fetch("/api/account/delete", {
        // Vercel Preview 보호 쿠키를 전달한다. 삭제 API는 쿠키 대신 아래 고정 Bearer로만 사용자를 검증한다.
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
        body: JSON.stringify({ expectedUid: auth.uid, password, confirmation }),
      });
      const data: { reason?: string } = await response.json();
      return { success: response.ok && data.reason === "deleted", reason: data.reason ?? "uncertain" };
    });
    if (!("ticket" in result) || !guard.isCurrent(result.ticket)) return;
    submitting.current = false;
    setBusy(false);
    setPassword("");
    if (result.ok && result.value.success) {
      setConfirmation("");
      setDeleted(true);
    } else {
      setMessage(result.ok ? messages[result.value.reason] ?? messages.uncertain : messages.uncertain);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-bold">계정 삭제</h1>
      {deleted ? (
        <div role="status" className="space-y-3">
          <p>계정과 이 계정의 기록·저장 동의를 삭제했어요. 이 계정으로 다시 로그인할 수 없어요.</p>
          {/* 공유 브라우저의 signOut을 자동 호출하지 않는다. 늦은 A 응답으로 B 세션을 지울 수 있다. */}
          <Link href="/login" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4">로그인 화면으로 이동</Link>
        </div>
      ) : (
        <>
          <p>계정을 삭제하면 이 계정의 기록과 저장 동의도 삭제돼요. 되돌릴 수 없어요.</p>
          <p className="text-sm text-muted">서버 백업·관리형 로그의 보관 사본은 즉시 없어지는 것으로 보장하지 않아요.</p>
          {!enabled ? <p role="status">계정 삭제는 분리된 테스트 환경에서 준비 중이에요.</p> : (
            <form onSubmit={submit} className="space-y-4">
              <p>삭제할 계정: <strong>{email ?? "확인하는 중…"}</strong></p>
              <p className="text-sm text-muted">승인한 삭제 요청은 다른 탭에서 계정을 바꿔도 취소되지 않아요. 확인한 계정만 대상으로 진행돼요.</p>
              <fieldset disabled={busy || !email} className="space-y-4">
                <label className="block space-y-1">
                  <span>비밀번호 다시 입력</span>
                  <input type="password" autoComplete="current-password" required maxLength={1000} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3 py-3" />
                </label>
                <label className="block space-y-1">
                  <span>확인을 위해 ‘계정 삭제’를 입력해 주세요.</span>
                  <input type="text" autoComplete="off" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="w-full rounded-xl border border-line bg-surface px-3 py-3" />
                </label>
                <button type="submit" disabled={!password || confirmation !== "계정 삭제"} className="min-h-12 rounded-xl bg-warn px-5 font-semibold text-white disabled:opacity-60 dark:text-[#1a0f0c]">
                  {busy ? "삭제 결과를 확인하는 중…" : "이 계정 삭제"}
                </button>
              </fieldset>
            </form>
          )}
          {message && <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">{message}</p>}
          <Link href="/records" className="inline-block text-accent underline underline-offset-4">내 기록으로 돌아가기</Link>
        </>
      )}
    </div>
  );
}
