"use client";

// 홈에서 바로 기록하기 (2단계).
//  - 버거움을 한 번 누르면 새 기록을 만든다. 저장 규칙은 quickSave.ts: 만들거나 확인만 하고, 고치지 않는다.
//  - 서버가 저장된 기록을 돌려주기 전에는 '남겨 뒀어요'를 보이지 않는다. 실패하면 고른 값과 기록 ID를 그대로 둔다.
//  - 응답이 사라진 뒤에는 처음 값 그대로 저장 여부만 확인한다. 그사이 다른 곳에서 고친 내용은 덮어쓰지 않는다.
//  - 울이는 서버에서 확인한 내 기록 중 경험 시점이 가장 늦은 하나를 따른다. 평균·대표값을 만들지 않는다.
//  - 로그인 전에는 저장하지 않고 로그인 안내만 보인다. 로그아웃하면 이 화면 상태는 통째로 사라진다(AuthScope).
//  - 방금 남긴 기록은 "되돌리기"로 지울 수 있다. 다른 곳에서 고치지 않은 기록(version 1, 보낸 값 그대로)만 대상이고,
//    지울 때도 버전을 검사한다.
//  - 기록 내용을 console·로그로 보내지 않는다.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { getStorageConsent, type ConsentState } from "@/lib/consent";
import {
  BURDEN_OPTIONS,
  burdenLabel,
  currentTimeZone,
  formatOccurred,
  type Burden,
  type Checkin,
  type CreateCheckinParams,
} from "@/lib/checkins/model";
import { FAIL_TEXT, deleteCheckin, listCheckins, type FailReason, type RecordsClient } from "@/lib/checkins/api";
import { quickSave } from "@/lib/checkins/quickSave";
import { ownedBy } from "@/lib/session/guard";
import { latestOwnBurden, uliStateFor } from "@/lib/uli";
import AuthScope, { useAuthScope, useScopedRequest } from "./AuthScope";
import Uli from "./Uli";

const makeId = () => crypto.randomUUID();
const QUESTION = "지금 얼마나 버거워요?";

function Stage({ burden, children }: { burden: Burden | null; children: React.ReactNode }) {
  return (
    <section aria-labelledby="home-question" className="space-y-5 rounded bg-tint-sky p-5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">TODAY</span>
      </div>
      <div className="flex justify-center">
        <Uli state={uliStateFor(burden)} size={168} />
      </div>
      {children}
    </section>
  );
}

function SignedOut({ note }: { note: string }) {
  return (
    <Stage burden={null}>
      <h1 id="home-question" className="text-2xl font-bold">
        {QUESTION}
      </h1>
      <p className="text-muted">{note}</p>
      <Link
        href="/login?next=/"
        className="pastel-fill inline-flex min-h-12 items-center rounded-full px-6 font-semibold"
      >
        로그인하고 남기기
      </Link>
    </Stage>
  );
}

function Checking() {
  return (
    <Stage burden={null}>
      <h1 id="home-question" className="text-2xl font-bold">
        {QUESTION}
      </h1>
      <p className="text-muted" role="status">
        로그인 상태를 확인하는 중이에요…
      </p>
    </Stage>
  );
}

type Saved = { record: Checkin; untouched: boolean };

function QuickCheckin() {
  const { uid, guard } = useAuthScope();
  const run = useScopedRequest();
  const [consent, setConsent] = useState<ConsentState | "loading">("loading");
  // 울이가 따르는 값: 서버에서 확인한 내 기록 중 경험 시점이 가장 늦은 기록의 버거움
  const [shown, setShown] = useState<Burden | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [failReason, setFailReason] = useState<FailReason | null>(null);
  const [picked, setPicked] = useState<Burden | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  // 새 기록 ID. 저장이 확인될 때까지 바뀌지 않는다 (재전송해도 중복 없음).
  const draftId = useRef(makeId());
  // 결과를 모르는 저장 요청. 다음 시도는 이 값 그대로 다시 보내 확인만 한다 (quickSave.ts 규칙).
  const pending = useRef<{ uid: string; params: CreateCheckinParams } | null>(null);
  const [hasPending, setHasPending] = useState(false);
  // 방금 남긴 기록 되돌리기 상태 (어떤 기록에 대한 것인지 id로 묶는다)
  const [undo, setUndo] = useState<{ id: string; status: "working" | "done" | "failed" | "conflict" } | null>(null);
  // 가장 최근에 시작한 울이 조회만 반영한다
  const latestLoad = useRef(0);

  function setPending(params: CreateCheckinParams | null) {
    pending.current = params ? { uid, params } : null;
    setHasPending(params !== null);
  }

  const loadLatest = useCallback(() => {
    const mineLoad = ++latestLoad.current;
    void run((client) => listCheckins(client as unknown as RecordsClient, 20)).then((r) => {
      if (mineLoad !== latestLoad.current) return;
      if (!("ticket" in r) || !guard.isCurrent(r.ticket) || !r.ok || r.value.kind !== "ok") return;
      const mine = r.value.records.filter((rec) => ownedBy(rec, r.ticket));
      setShown(latestOwnBurden(mine, uid));
    });
  }, [run, guard, uid]);

  useEffect(() => {
    if (!getBrowserClient()) {
      setConsent("error");
      return;
    }
    void run((client) => getStorageConsent(client)).then((r) => {
      if ("ticket" in r && guard.isCurrent(r.ticket)) setConsent(r.ok ? r.value : "error");
    });
    loadLatest();
  }, [run, guard, loadLatest]);

  async function save(b: Burden) {
    if (status === "saving" || undo?.status === "working") return;
    const prev = pending.current && pending.current.uid === uid ? pending.current.params : null;
    // 결과를 모르는 요청이 있으면 그 값만 다시 확인한다. 다른 값을 섞지 않는다.
    const value = prev ? prev.p_burden : b;
    setUndo(null);
    setPicked(value);
    setFailReason(null);
    setStatus("saving");
    const draft = { id: draftId.current, burden: value, tags: [], note: "", recallLocal: null };
    const r = await run((client) => quickSave(client as unknown as RecordsClient, draft, prev, new Date(), currentTimeZone()));
    if (!("ticket" in r) || !guard.isCurrent(r.ticket)) return;
    if (!r.ok) {
      setFailReason("unknown");
      setStatus("failed");
      return;
    }
    const res = r.value;
    if (res.kind === "saved") {
      if (!ownedBy(res.record, r.ticket)) {
        setFailReason("unknown");
        setStatus("failed");
        return;
      }
      setPending(null);
      draftId.current = makeId();
      setSaved({ record: res.record, untouched: res.untouched });
      setStatus("saved");
      // 울이는 방금 확인한 기록이 아니라, 내 기록 중 경험 시점이 가장 늦은 기록을 다시 확인해 따른다.
      loadLatest();
      return;
    }
    if (res.kind === "invalid") {
      setFailReason("invalid");
      setStatus("failed");
      return;
    }
    setPending(res.pending);
    if (res.newIdRequired) draftId.current = makeId();
    setFailReason(res.reason);
    setStatus("failed");
    if (res.reason === "no_consent") setConsent("missing");
  }

  async function undoLast() {
    if (!saved || !saved.untouched || status !== "saved" || undo?.status === "working") return;
    const rec = saved.record;
    const id = rec.id;
    setUndo({ id, status: "working" });
    // 저장할 때 받은 version으로만 지운다. 그사이 다른 기기에서 바뀌었으면 지우지 않는다.
    const r = await run((client) => deleteCheckin(client as unknown as RecordsClient, { id, expectedVersion: rec.version }));
    if (!("ticket" in r) || !guard.isCurrent(r.ticket)) return;
    if (!r.ok) {
      setUndo({ id, status: "failed" });
      return;
    }
    const res = r.value;
    if (res.kind === "deleted" || res.kind === "not_found") {
      // not_found: 앞선 되돌리기 요청이 이미 지웠는데 응답만 사라진 경우 등. 내 기록이 남아 있지 않다.
      setUndo({ id, status: "done" });
      loadLatest();
    } else if (res.kind === "conflict") {
      setUndo({ id, status: ownedBy(res.server, r.ticket) ? "conflict" : "failed" });
    } else {
      setUndo({ id, status: "failed" });
    }
  }

  if (consent === "missing") {
    return (
      <Stage burden={shown}>
        <h1 id="home-question" className="text-2xl font-bold">
          {QUESTION}
        </h1>
        <p className="text-muted">기록을 계정에 남기려면 먼저 민감정보 저장 동의가 필요해요.</p>
        <Link href="/consent?next=/" className="pastel-fill inline-flex min-h-12 items-center rounded-full px-6 font-semibold">
          동의 내용 보기
        </Link>
      </Stage>
    );
  }

  const saving = status === "saving";
  const failed = status === "failed";
  const undoing = undo?.status === "working";
  const undoFor = saved && undo?.id === saved.record.id ? undo.status : null;
  const recordsLink = (
    <Link href="/records" className="text-accent underline underline-offset-4">
      내 기록에서 확인
    </Link>
  );

  return (
    <Stage burden={shown}>
      <div className="flex items-baseline justify-between gap-3">
        <h1 id="home-question" className="text-2xl font-bold">
          {QUESTION}
        </h1>
        <span className="shrink-0 text-xs text-muted">누르면 저장</span>
      </div>
      <fieldset disabled={saving || undoing || hasPending || consent === "loading"} aria-busy={saving || undoing}>
        <legend className="sr-only">버거운 정도</legend>
        <div className="flex flex-wrap gap-2">
          {BURDEN_OPTIONS.map((o) => {
            const on = (saving || failed) && picked === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => void save(o.value)}
                className={`min-h-11 rounded-full px-4 text-[0.95rem] disabled:opacity-60 ${
                  on ? "pastel-fill border border-transparent font-medium" : "border border-muted/50 hover:border-accent"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* 저장 상태: 서버 확인 전에는 완료로 보이지 않는다 */}
      <div aria-live="polite" className="text-sm">
        {saving && <p>남기는 중이에요. 아직 완료되지 않았어요.</p>}
        {status === "saved" && saved && undoFor === "done" && <p>되돌렸어요. 방금 남긴 기록을 지웠어요.</p>}
        {status === "saved" && saved && undoFor !== "done" && saved.untouched && (
          <div className="space-y-2">
            <p>
              남겨 뒀어요 · {burdenLabel(saved.record.burden)} · {formatOccurred(saved.record)} · {recordsLink}
            </p>
            {undoFor !== "conflict" && (
              <button
                type="button"
                onClick={() => void undoLast()}
                disabled={undoing}
                className="min-h-11 rounded-full border border-muted/50 px-4 hover:border-accent disabled:opacity-60"
              >
                {undoing ? "되돌리는 중…" : "되돌리기"}
              </button>
            )}
            {undoFor === "failed" && (
              <p role="alert" className="rounded bg-warn-soft p-3 text-warn">
                되돌리지 못했어요. 기록이 아직 남아 있을 수 있어요. 다시 눌러도 다른 기록은 지워지지 않아요.
              </p>
            )}
            {undoFor === "conflict" && (
              <p role="alert" className="rounded bg-warn-soft p-3 text-warn">
                이 기록이 다른 기기에서 먼저 바뀌어서 지우지 않았어요. {recordsLink}해 주세요.
              </p>
            )}
          </div>
        )}
        {status === "saved" && saved && !saved.untouched && (
          <p>
            이미 남겨진 기록이에요 · {burdenLabel(saved.record.burden)}. 다른 곳에서 고친 내용은 그대로 두었어요. {recordsLink}해 주세요.
          </p>
        )}
        {failed && failReason && (
          <div role="alert" className="space-y-2 rounded bg-warn-soft p-3 text-warn">
            <p>{FAIL_TEXT[failReason]}</p>
            {hasPending && <p>저장됐는지 확인할 때까지 다른 값은 고를 수 없어요. 처음 고른 값 그대로 확인해요.</p>}
            {failReason === "signed_out" ? (
              <a href="/login?next=/" className="inline-block rounded-full border border-current px-4 py-2 font-semibold">
                다시 로그인하기
              </a>
            ) : failReason !== "no_consent" && picked ? (
              <button
                type="button"
                onClick={() => void save(picked)}
                className="rounded-full border border-current px-4 py-2 font-semibold"
              >
                다시 남기기
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Stage>
  );
}

export default function HomeCheckin() {
  return (
    <AuthScope
      redirectOnLogout={false}
      fallbacks={{
        checking: <Checking />,
        out: <SignedOut note="로그인하면 여기서 한 번 눌러 남길 수 있어요. 매일 쓰지 않아도 괜찮아요." />,
        unconfigured: <SignedOut note="아직 기록 저장 설정이 되지 않았어요. 도움 화면은 그대로 열려요." />,
      }}
    >
      <QuickCheckin />
    </AuthScope>
  );
}
