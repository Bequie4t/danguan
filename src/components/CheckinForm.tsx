"use client";

import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { getStorageConsent, type ConsentState } from "@/lib/consent";
import {
  BURDEN_OPTIONS,
  TAG_OPTIONS,
  NOTE_MAX,
  DRAFT_PROBLEM_TEXT,
  buildCreateParams,
  burdenLabel,
  currentTimeZone,
  formatOccurred,
  localInputValue,
  newDraft,
  type Burden,
  type CreateCheckinParams,
  type Draft,
} from "@/lib/checkins/model";
import { createCheckin, FAIL_TEXT, type RecordsClient } from "@/lib/checkins/api";
import { formReducer, initialFormState } from "@/lib/checkins/formState";
import { ownedBy } from "@/lib/session/guard";
import { useAuthScope, useScopedRequest } from "./AuthScope";

const makeId = () => crypto.randomUUID();

// 이 화면은 AuthScope 안에서만 쓴다. 계정이 바뀌면 AuthScope가 이 화면을 새로 만들어
// 입력·동의 상태·재시도 요청·저장 결과가 모두 비워진다.
export default function CheckinForm() {
  const { uid } = useAuthScope();
  const run = useScopedRequest();
  const [consent, setConsent] = useState<ConsentState | "loading">("loading");
  const [state, dispatch] = useReducer(formReducer, undefined, () => initialFormState(newDraft(makeId)));
  const [expanded, setExpanded] = useState(false);
  // 처음 보낸 요청을 기억했다가, 입력이 그대로면 재시도 때 같은 값을 다시 보낸다.
  // 어느 계정의 요청인지 함께 기억해 다른 계정으로 다시 보내지 않는다.
  const pending = useRef<{ uid: string; draft: Draft; params: CreateCheckinParams } | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) {
      setConsent("error");
      return;
    }
    // 이전 계정에서 시작한 동의 확인 결과는 반영하지 않는다
    void run(() => getStorageConsent(supabase)).then((r) => {
      if (r.ok) setConsent(r.value);
    });
  }, [run]);

  // 저장 중이거나 저장에 실패한 입력이 있으면 창을 닫기 전에 묻는다.
  useEffect(() => {
    const risky = state.status === "saving" || state.status === "failed";
    if (!risky) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.status]);

  async function submit(draft: Draft) {
    const supabase = getBrowserClient();
    if (!supabase || state.status === "saving") return;

    // 다른 계정에서 만든 재시도 요청은 버린다 (AuthScope가 화면을 새로 만들지만 한 번 더 확인)
    if (pending.current && pending.current.uid !== uid) pending.current = null;

    let params: CreateCheckinParams;
    if (pending.current && pending.current.draft === draft) {
      params = pending.current.params;
    } else {
      const built = buildCreateParams(draft, new Date(), currentTimeZone());
      if (!built.ok) {
        dispatch({ type: "invalid", problem: built.problem });
        return;
      }
      params = built.params;
      pending.current = { uid, draft, params };
    }

    dispatch({ type: "submitStart" });
    // 보내기 전에 실제 로그인 계정이 이 화면의 계정인지 확인하고, 응답이 늦게 와서
    // 그사이 계정이 바뀌었거나 화면이 닫혔으면 아무것도 반영하지 않는다.
    const r = await run(() => createCheckin(supabase as unknown as RecordsClient, params));
    if (!r.ok) return;
    const res = r.value;
    if (res.kind === "saved" && !ownedBy(res.record, r.ticket)) {
      dispatch({ type: "submitFail", reason: "unknown" });
      return;
    }
    if (res.kind === "saved") {
      pending.current = null;
      dispatch({ type: "submitSuccess", record: res.record, nextId: makeId() });
      setExpanded(false);
    } else {
      dispatch({ type: "submitFail", reason: res.reason });
      if (res.reason === "no_consent") setConsent("missing");
    }
  }

  function pickBurden(b: Burden) {
    if (state.status === "saving") return;
    const draft = { ...state.draft, burden: b };
    dispatch({ type: "setBurden", burden: b });
    // 선택 사항을 펼치지 않았다면 한 번 고르는 것으로 저장
    if (!expanded) void submit(draft);
  }

  if (consent === "loading") return <p className="text-muted">불러오는 중이에요…</p>;

  if (consent === "missing") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">오늘 기록</h1>
        <p className="rounded-2xl border border-line bg-surface p-5">
          기록을 계정에 저장하려면 먼저 민감정보 저장 동의가 필요해요.
        </p>
        <Link href="/consent?next=/today" className="inline-flex min-h-14 items-center rounded-xl bg-accent px-6 font-semibold text-accent-fg">
          동의 내용 보기
        </Link>
      </div>
    );
  }

  const saving = state.status === "saving";
  const d = state.draft;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">지금 어느 정도 버거운가요?</h1>
        <p className="text-muted">
          {expanded ? "고른 뒤 아래 ‘저장하기’를 눌러 주세요." : "하나만 고르면 바로 저장돼요. 나머지는 하지 않아도 괜찮아요."}
        </p>
      </div>

      {consent === "error" && (
        <p role="alert" className="rounded-xl bg-warn-soft p-3 text-warn">
          연결 상태를 확인하지 못했어요. 기록은 해 볼 수 있지만, 저장이 확인될 때만 완료로 표시돼요.
        </p>
      )}

      <fieldset disabled={saving} aria-busy={saving} className="space-y-3">
        <legend className="sr-only">버거운 정도</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {BURDEN_OPTIONS.map((o) => {
            const selected = d.burden === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={selected}
                onClick={() => pickBurden(o.value)}
                className={`min-h-16 rounded-2xl border-2 px-5 text-left text-lg font-medium transition-colors disabled:opacity-60 ${
                  selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="extras"
        onClick={() => setExpanded((v) => !v)}
        disabled={saving}
        className="rounded-xl px-1 py-2 text-accent underline-offset-4 hover:underline"
      >
        {expanded ? "선택 사항 접기" : "선택 사항 더하기 (생활 항목 · 메모 · 언제)"}
      </button>

      {expanded && (
        <div id="extras" className="space-y-6 rounded-2xl border border-line bg-surface p-5">
          <fieldset disabled={saving} className="space-y-2">
            <legend className="font-semibold">신경 쓰이는 생활 항목 (고르지 않아도 돼요)</legend>
            <div className="flex flex-wrap gap-2">
              {TAG_OPTIONS.map((t) => {
                const on = d.tags.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => dispatch({ type: "toggleTag", tag: t.value })}
                    className={`min-h-11 rounded-full border px-4 ${on ? "border-accent bg-accent-soft font-medium" : "border-line"}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="block space-y-1">
            <span className="font-semibold">메모 (쓰지 않아도 돼요)</span>
            <textarea
              id="note"
              value={d.note}
              maxLength={NOTE_MAX}
              rows={3}
              disabled={saving}
              onChange={(e) => dispatch({ type: "setNote", note: e.target.value })}
              className="w-full rounded-xl border border-line bg-bg px-3 py-2"
            />
            <span className="block text-right text-sm text-muted">
              {d.note.length}/{NOTE_MAX}
            </span>
          </label>

          <fieldset disabled={saving} className="space-y-2">
            <legend className="font-semibold">언제의 일인가요?</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="when"
                checked={d.recallLocal === null}
                onChange={() => dispatch({ type: "setRecall", value: null })}
                className="h-5 w-5"
              />
              지금
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input
                type="radio"
                name="when"
                checked={d.recallLocal !== null}
                onChange={() =>
                  dispatch({ type: "setRecall", value: localInputValue(new Date(Date.now() - 3 * 60 * 60 * 1000)) })
                }
                className="h-5 w-5"
              />
              지난 일을 돌아보며 기록
              {d.recallLocal !== null && (
                <input
                  id="recall-at"
                  type="datetime-local"
                  value={d.recallLocal}
                  max={localInputValue(new Date())}
                  onChange={(e) => dispatch({ type: "setRecall", value: e.target.value })}
                  className="rounded-lg border border-line bg-bg px-2 py-1"
                  aria-label="그 일이 있었던 날짜와 시간"
                />
              )}
            </label>
          </fieldset>

          <button
            type="button"
            onClick={() => submit(state.draft)}
            disabled={saving || !d.burden}
            className="min-h-14 w-full rounded-xl bg-accent px-4 font-semibold text-accent-fg disabled:opacity-50"
          >
            {saving ? "저장하는 중…" : "저장하기"}
          </button>
        </div>
      )}

      {/* 저장 상태 안내: 서버 확인 전에는 완료로 표시하지 않는다 */}
      <div aria-live="polite" className="space-y-2">
        {state.problem && <p className="rounded-xl bg-warn-soft p-3 text-warn">{DRAFT_PROBLEM_TEXT[state.problem]}</p>}

        {state.status === "saving" && (
          <p className="rounded-xl border border-line p-3">저장하는 중이에요. 아직 완료되지 않았어요.</p>
        )}

        {state.status === "failed" && state.failReason && (
          <div role="alert" className="space-y-3 rounded-xl bg-warn-soft p-4 text-warn">
            <p>{FAIL_TEXT[state.failReason]}</p>
            <div className="flex flex-wrap gap-2">
              {state.failReason === "signed_out" ? (
                <a href="/login" className="rounded-lg border border-current px-4 py-2 font-semibold">
                  로그인 화면으로 가기 (입력은 사라져요)
                </a>
              ) : state.failReason === "no_consent" ? (
                <Link href="/consent?next=/today" className="rounded-lg border border-current px-4 py-2 font-semibold">
                  동의 내용 보기
                </Link>
              ) : null}
              {state.failReason !== "no_consent" && (
                <button
                  type="button"
                  onClick={() => submit(state.draft)}
                  className="rounded-lg bg-warn px-4 py-2 font-semibold text-white dark:text-[#1a0f0c]"
                >
                  다시 저장하기
                </button>
              )}
            </div>
          </div>
        )}

        {state.status === "saved" && state.lastSaved && (
          <div className="rounded-xl bg-accent-soft p-4">
            <p className="font-semibold">저장했어요.</p>
            <p className="text-muted">
              {formatOccurred(state.lastSaved)} · {burdenLabel(state.lastSaved.burden)}
            </p>
            <Link href="/records" className="mt-2 inline-block text-accent underline underline-offset-4">
              내 기록 보기
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
