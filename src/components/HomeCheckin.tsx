"use client";

// 홈에서 바로 기록하기 (2단계).
//  - 버거움을 한 번 누르면 저장한다. 저장 규칙은 오늘 기록 화면과 같은 saveFlow.ts를 쓴다.
//  - 서버가 저장된 기록을 돌려주기 전에는 '남겨 뒀어요'를 보이지 않는다. 실패하면 고른 값과 기록 ID를 그대로 둔다.
//  - 울이는 서버에서 확인한 내 가장 최근 기록 하나를 따른다. 평균·대표값을 만들지 않는다.
//  - 로그인 전에는 저장하지 않고 로그인 안내만 보인다. 로그아웃하면 이 화면 상태는 통째로 사라진다(AuthScope).
//  - 기록 내용을 console·로그로 보내지 않는다.

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { getStorageConsent, type ConsentState } from "@/lib/consent";
import { BURDEN_OPTIONS, burdenLabel, currentTimeZone, formatOccurred, newDraft, type Burden } from "@/lib/checkins/model";
import { FAIL_TEXT, listCheckins, type RecordsClient } from "@/lib/checkins/api";
import { formReducer, initialFormState } from "@/lib/checkins/formState";
import { saveDraft, type PendingSave } from "@/lib/checkins/saveFlow";
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

function QuickCheckin() {
  const { uid, guard } = useAuthScope();
  const run = useScopedRequest();
  const [consent, setConsent] = useState<ConsentState | "loading">("loading");
  // 울이가 따르는 값: 서버에서 확인한 내 가장 최근 기록의 버거움
  const [shown, setShown] = useState<Burden | null>(null);
  const [state, dispatch] = useReducer(formReducer, undefined, () => initialFormState(newDraft(makeId)));
  const pending = useRef<{ uid: string; save: PendingSave } | null>(null);

  useEffect(() => {
    if (!getBrowserClient()) {
      setConsent("error");
      return;
    }
    void run((client) => getStorageConsent(client)).then((r) => {
      if ("ticket" in r && guard.isCurrent(r.ticket)) setConsent(r.ok ? r.value : "error");
    });
    void run((client) => listCheckins(client as unknown as RecordsClient, 20)).then((r) => {
      if (!("ticket" in r) || !guard.isCurrent(r.ticket) || !r.ok || r.value.kind !== "ok") return;
      const mine = r.value.records.filter((rec) => ownedBy(rec, r.ticket));
      setShown(latestOwnBurden(mine, uid));
    });
  }, [run, guard, uid]);

  async function save(b: Burden) {
    if (state.status === "saving") return;
    const draft = { ...state.draft, burden: b };
    dispatch({ type: "setBurden", burden: b });
    const prev = pending.current && pending.current.uid === uid ? pending.current.save : null;
    dispatch({ type: "submitStart" });
    const r = await run((client) =>
      saveDraft(client as unknown as RecordsClient, draft, prev, new Date(), currentTimeZone()),
    );
    if (!("ticket" in r) || !guard.isCurrent(r.ticket)) return;
    if (!r.ok) {
      dispatch({ type: "submitFail", reason: "unknown" });
      return;
    }
    const res = r.value;
    if (res.kind === "saved") {
      if (!ownedBy(res.record, r.ticket)) {
        dispatch({ type: "submitFail", reason: "unknown" });
        return;
      }
      pending.current = null;
      dispatch({ type: "submitSuccess", record: res.record, nextId: makeId() });
      setShown(res.record.burden);
      return;
    }
    pending.current = res.pending ? { uid, save: res.pending } : null;
    if (res.kind === "invalid") {
      dispatch({ type: "submitFail", reason: "invalid" });
    } else if (res.kind === "conflict") {
      // 홈에서는 새 기록만 만든다. 충돌이 나면 오늘 기록 화면에서 고르게 안내한다.
      dispatch({ type: "submitFail", reason: "unknown" });
    } else {
      dispatch({ type: "submitFail", reason: res.reason });
      if (res.newIdRequired) dispatch({ type: "newId", id: makeId() });
      if (res.reason === "no_consent") setConsent("missing");
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

  const saving = state.status === "saving";
  const failed = state.status === "failed";
  const picked = state.draft.burden;

  return (
    <Stage burden={shown}>
      <div className="flex items-baseline justify-between gap-3">
        <h1 id="home-question" className="text-2xl font-bold">
          {QUESTION}
        </h1>
        <span className="shrink-0 text-xs text-muted">누르면 저장</span>
      </div>
      <fieldset disabled={saving || consent === "loading"} aria-busy={saving}>
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
        {state.status === "saved" && state.lastSaved && (
          <p>
            남겨 뒀어요 · {burdenLabel(state.lastSaved.burden)} · {formatOccurred(state.lastSaved)} ·{" "}
            <Link href="/records" className="text-accent underline underline-offset-4">
              더 남기기
            </Link>
          </p>
        )}
        {failed && state.failReason && (
          <div role="alert" className="space-y-2 rounded bg-warn-soft p-3 text-warn">
            <p>{FAIL_TEXT[state.failReason]}</p>
            {state.failReason === "signed_out" ? (
              <a href="/login?next=/" className="inline-block rounded-full border border-current px-4 py-2 font-semibold">
                다시 로그인하기
              </a>
            ) : state.failReason !== "no_consent" && picked ? (
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
