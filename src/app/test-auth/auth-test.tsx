"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthScope, { useAuthScope } from "@/components/AuthScope";
import { browserAuthTransactionMode, getBrowserClient } from "@/lib/supabase/client";
import { createRefreshResponseTest, runRefreshTest, type RefreshTestStage } from "@/lib/account/refreshTest";

const TEXT: Record<RefreshTestStage, string> = {
  idle: "테스트 계정으로 로그인한 뒤 갱신 시험을 실행하세요.",
  armed: "다음 TEST 갱신 성공 응답을 기다리는 중입니다.",
  held: "갱신 성공 응답을 보류했습니다. 다른 탭에서 B 로그인을 시도한 뒤 응답을 전달하세요. 대기 한도는 10초입니다.",
  released: "보류한 갱신 응답을 전달했습니다. SDK 처리와 새 계정 화면을 별도로 확인하세요.",
  not_held: "보류한 성공 응답이 없습니다. 경쟁 시험 완료로 기록하지 마세요.",
  cancelled: "시험을 취소했거나 대기 한도를 넘겼습니다. 보류는 해제됐지만 경쟁 시험 완료로 기록하지 마세요.",
};
function Controls({ busy, onRun }: { busy: boolean; onRun: (hold: boolean, current: () => boolean, uid: string) => void }) {
  const { guard, ticket, uid } = useAuthScope();
  return <div className="flex flex-wrap gap-3">
    <button disabled={busy} type="button" onClick={() => onRun(false, () => guard.isCurrent(ticket), uid)} className="rounded-xl border border-line px-4 py-3 disabled:opacity-50">정상 갱신 실행</button>
    <button disabled={busy} type="button" onClick={() => onRun(true, () => guard.isCurrent(ticket), uid)} className="rounded-xl border border-line px-4 py-3 disabled:opacity-50">갱신 성공 응답 보류 실행</button>
  </div>;
}
export default function AuthTest() {
  const control = useRef<ReturnType<typeof createRefreshResponseTest> | null>(null);
  const running = useRef(false);
  const cancelled = useRef(false);
  const alive = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<RefreshTestStage>("idle");
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    if (!browserAuthTransactionMode()) return () => { alive.current = false; };
    const original = window.fetch;
    const test = createRefreshResponseTest(original.bind(window), next => {
      if (next === "cancelled") cancelled.current = true;
      if (alive.current) setStage(next);
    });
    control.current = test;
    window.fetch = test.fetch;
    setReady(true);
    return () => {
      alive.current = false;
      test.cancel();
      if (window.fetch === test.fetch) window.fetch = original;
      control.current = null;
    };
  }, []);
  async function run(hold: boolean, current: () => boolean, uid: string) {
    if (running.current || !control.current || !current()) return;
    running.current = true; cancelled.current = false;
    setBusy(true); setResult(null); setStage("idle");
    try {
      const client = getBrowserClient();
      if (!client) throw new Error("unavailable");
      const refreshed = await runRefreshTest(client.auth, current, uid, () => {
        if (cancelled.current || !alive.current) throw new Error("cancelled");
        if (hold) control.current?.arm();
      });
      if (!alive.current || cancelled.current) return;
      setResult(refreshed === "changed" ? "계정이 바뀌어 이전 갱신 결과를 완료로 표시하지 않았습니다."
        : refreshed === "failed" ? "갱신을 확인하지 못했습니다. 이 시험은 완료되지 않았습니다." : "갱신 요청이 성공했습니다.");
    } catch {
      if (alive.current && !cancelled.current) setResult(current() ? "갱신을 확인하지 못했습니다. 이 시험은 완료되지 않았습니다." : "계정이 바뀌어 이전 갱신 결과를 완료로 표시하지 않았습니다.");
    } finally {
      control.current?.cancel();
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return <div className="space-y-5">
    <h1 className="text-2xl font-bold">인증 갱신 시험</h1>
    <p>분리 TEST 계정 전용입니다. 기록을 생성·수정·삭제하지 않습니다. 다른 탭의 로그인은 기존 로그인 화면에서 직접 진행하세요.</p>
    <p>보류 중 로그인은 잠금 때문에 기다리거나 실패할 수 있습니다. 실패한 로그인은 성공 시험으로 세지 않습니다. 갱신은 잠금 안에서 SDK가 확인한 현재 세션을 사용하며, 계정이 바뀌면 이전 계정의 성공으로 표시하지 않습니다. 실제 토큰 갱신 성공과 경쟁 순서 확인을 구분하세요.</p>
    <p role="status" className="rounded-xl border border-line p-3">{TEXT[stage]}</p>
    {result && <p role="status" className="rounded-xl border border-line p-3">{result}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!ready || stage !== "held"} onClick={() => control.current?.release()} className="rounded-xl border border-line px-4 py-3 disabled:opacity-50">갱신 응답 전달</button>
      <button type="button" disabled={!ready || !busy} onClick={() => control.current?.cancel()} className="rounded-xl border border-line px-4 py-3 disabled:opacity-50">갱신 시험 취소</button>
    </div>
    {ready ? <AuthScope redirectOnLogout={false}><Controls busy={busy} onRun={(...args) => void run(...args)} /></AuthScope> : <p>인증 작업 잠금 설정을 확인하는 중입니다. 활성화되지 않았다면 시험할 수 없습니다.</p>}
    <div className="flex flex-wrap gap-4"><Link href="/login" target="_blank" rel="noopener noreferrer" className="underline">다른 탭에서 로그인</Link><Link href="/records" className="underline">내 기록 확인</Link></div>
  </div>;
}
