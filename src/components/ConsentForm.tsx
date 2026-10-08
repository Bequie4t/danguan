"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { getStorageConsent, grantStorageConsent, type ConsentState } from "@/lib/consent";
import { CONSENT_POLICY_VERSION } from "@/lib/checkins/model";

// 동의 문구는 출시 전 개인정보 전문가 검토가 필요하다 (개발용 초안).
export default function ConsentForm({ next }: { next: string }) {
  const [state, setState] = useState<ConsentState | "loading">("loading");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setState("error");
      return;
    }
    getStorageConsent(supabase).then((s) => {
      if (s === "granted") window.location.replace(next);
      else setState(s);
    });
  }, [next]);

  async function agree() {
    const supabase = getBrowserClient();
    if (!supabase || !checked) return;
    setBusy(true);
    setFailed(false);
    const ok = await grantStorageConsent(supabase);
    setBusy(false);
    if (ok) window.location.replace(next);
    else setFailed(true);
  }

  if (state === "loading") return <p className="text-muted">확인하는 중이에요…</p>;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">기록을 계정에 저장하기 전에</h1>
        <p className="text-muted">마음 상태 기록은 민감한 정보라서 따로 동의를 받아요.</p>
      </div>

      {state === "error" && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">
          동의 상태를 확인하지 못했어요. 새로고침하거나 잠시 후 다시 시도해 주세요.
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-semibold">저장하는 것</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>내가 고른 버거운 정도, 고른 생활 항목, 직접 쓴 메모</li>
          <li>그 일을 겪은 때와 기록한 때, 그때의 시간대</li>
        </ul>
        <h2 className="pt-2 font-semibold">저장하는 곳과 볼 수 있는 사람</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>당우안 계정 서버(Supabase)에 저장돼요. 이 계정으로 로그인한 나만 볼 수 있어요.</li>
          <li>기록 내용을 광고·분석 도구나 외부 AI로 보내지 않아요.</li>
          <li>기록은 언제든 &lsquo;내 기록&rsquo;에서 지울 수 있어요.</li>
        </ul>
        <p className="text-sm text-muted">동의 문서 버전 {CONSENT_POLICY_VERSION}</p>
      </section>

      <label className="flex items-start gap-3 rounded-xl p-2">
        <input
          id="consent-check"
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-6 w-6 accent-[var(--accent)]"
        />
        <span>위 내용을 읽었고, 내 기록을 계정에 저장하는 데 동의해요.</span>
      </label>

      {failed && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">
          동의를 저장하지 못했어요. 연결을 확인하고 다시 눌러 주세요.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={agree}
          disabled={!checked || busy}
          className="min-h-14 rounded-xl bg-accent px-6 font-semibold text-accent-fg disabled:opacity-50"
        >
          {busy ? "저장하는 중…" : "동의하고 계속하기"}
        </button>
        <Link href="/" className="inline-flex min-h-14 items-center rounded-xl px-4 text-muted hover:bg-accent-soft">
          지금은 동의하지 않을래요
        </Link>
      </div>
    </div>
  );
}
