"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import type { Checkin } from "@/lib/checkins/model";
import { listCheckins, type FailReason, type RecordsClient } from "@/lib/checkins/api";
import { ownedBy } from "@/lib/session/guard";
import { useAuthScope, useScopedRequest } from "./AuthScope";
import RecordItem from "./RecordItem";

// 이 화면은 AuthScope 안에서만 쓴다. 계정이 바뀌거나 로그아웃하면 AuthScope가
// 이 화면을 새로 만들거나 로그인 화면으로 보내므로, 이전 계정의 목록이 남지 않는다.
export default function RecordList() {
  const { uid } = useAuthScope();
  const run = useScopedRequest();
  const [records, setRecords] = useState<Checkin[] | null>(null);
  const [error, setError] = useState<FailReason | null>(null);
  const [loading, setLoading] = useState(true);
  // 가장 최근에 시작한 조회만 반영한다 (다시 불러오기를 여러 번 눌러도 늦게 온 옛 응답이 덮지 않도록)
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!getBrowserClient()) {
      setError("unknown");
      setLoading(false);
      return;
    }
    const mine = ++latest.current;
    setLoading(true);
    // 이 계정의 인증으로 고정해 조회한다
    const r = await run((client) => listCheckins(client as unknown as RecordsClient));
    // 화면이 닫혔거나 계정이 바뀌었거나 더 새로운 조회가 있으면 반영하지 않는다
    if (!r.ok || mine !== latest.current) return;
    const res = r.value;
    if (res.kind === "ok") {
      // 서버 RLS가 막지만, 요청한 계정의 기록만 화면에 둔다 (한 번 더 확인)
      setRecords(res.records.filter((rec) => ownedBy(rec, r.ticket)));
      setError(null);
    } else {
      setError(res.reason);
    }
    setLoading(false);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(rec: Checkin) {
    if (rec.owner_id !== uid) return;
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
