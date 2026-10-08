"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Checkin } from "@/lib/checkins/model";
import { listCheckins, type FailReason, type RecordsClient } from "@/lib/checkins/api";
import { ownedBy } from "@/lib/session/guard";
import { useAuthScope } from "./AuthScope";
import RecordItem from "./RecordItem";

export default function RecordList() {
  // 계정이 바뀌면 AuthScope가 이 화면을 새로 만든다. 그 전에 출발한 요청의 응답은 guard로 버린다.
  const { guard } = useAuthScope();
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
    const t = guard.ticket();
    const res = await listCheckins(supabase as unknown as RecordsClient);
    if (!guard.isCurrent(t)) return; // 지연된 이전 사용자 응답
    if (res.kind === "ok") {
      setRecords(res.records.filter((r) => ownedBy(r, t)));
      setError(null);
    } else {
      setError(res.reason);
    }
    setLoading(false);
  }, [guard]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(rec: Checkin) {
    if (!ownedBy(rec, guard.ticket())) return;
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
          {error === "signed_out" ? "로그인이 끝났어요. 다시 로그인해 주세요." : "기록을 불러오지 못했어요. 연결을 확인하고 ‘다시 불러오기’를 눌러 주세요."}
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
