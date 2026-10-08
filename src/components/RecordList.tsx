"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Checkin } from "@/lib/checkins/model";
import { FAIL_TEXT, listCheckins, type FailReason, type RecordsClient } from "@/lib/checkins/api";
import RecordItem from "./RecordItem";

export default function RecordList() {
  const [records, setRecords] = useState<Checkin[] | null>(null);
  const [error, setError] = useState<FailReason | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setError("unknown");
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await listCheckins(supabase as unknown as RecordsClient);
    if (res.kind === "ok") {
      setRecords(res.records);
      setError(null);
    } else {
      setError(res.reason);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const supabase = getBrowserClient();
    if (!supabase) return;
    // 다른 탭에서 로그아웃하거나 계정이 바뀌면 화면의 기록을 즉시 비운다.
    let lastUser: string | null | undefined;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null;
      if (lastUser !== undefined && uid !== lastUser) {
        setRecords(null);
        if (uid) void load();
        else window.location.replace("/login?signedOut=1");
      }
      lastUser = uid;
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  function replace(rec: Checkin) {
    setRecords((rs) => (rs ? rs.map((r) => (r.id === rec.id ? rec : r)) : rs));
  }
  function remove(id: string) {
    setRecords((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">내 기록</h1>
          <p className="text-muted">최근 200개까지 보여요. 이 계정으로 로그인한 나만 볼 수 있어요.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-line px-4 py-2 hover:bg-accent-soft disabled:opacity-60"
        >
          {loading ? "불러오는 중…" : "다시 불러오기"}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">
          {error === "signed_out" ? FAIL_TEXT.signed_out : "기록을 불러오지 못했어요. 연결을 확인하고 ‘다시 불러오기’를 눌러 주세요."}
        </p>
      )}

      {records && records.length === 0 && (
        <div className="space-y-3 rounded-2xl border border-dashed border-line p-6">
          <p>아직 남긴 기록이 없어요.</p>
          <Link href="/today" className="inline-block text-accent underline underline-offset-4">
            오늘 기록 남기기
          </Link>
        </div>
      )}

      {records && records.length > 0 && (
        <ul className="space-y-3">
          {records.map((r) => (
            <RecordItem key={r.id} record={r} onReplace={replace} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  );
}
