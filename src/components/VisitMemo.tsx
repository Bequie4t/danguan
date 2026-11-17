"use client";

// 진료 준비 메모
//  - 기간을 고르면 그 기간에 남긴 기록을 세어 보여 준다 (평균·점수·비교 없음, 기록 없는 날은 '알 수 없음').
//  - 가장 불편한 점·생활 영향·묻고 싶은 것을 적고, 넣을 부분을 골라 한 장 메모로 보거나 인쇄한다.
//  - 여기서 쓴 글은 저장하지 않는다. 기록 메모는 내가 고른 것만 메모에 들어간다.
//  - 기록 내용을 console·로그·외부로 보내지 않는다. 조회는 AuthScope의 이 계정 인증으로만 한다.
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { ownedBy } from "@/lib/session/guard";
import { installLeaveGuard } from "@/lib/leave-guard";
import { listCheckinsBetween, type RangeClient } from "@/lib/checkins/api";
import { SOURCE_LABEL, burdenLabel, currentTimeZone, tagLabel, type Checkin } from "@/lib/checkins/model";
import {
  PERIOD_PROBLEM_TEXT,
  checkPeriod,
  formatDate,
  localDate,
  presetPeriod,
  queryRange,
  summarize,
  type Period,
  type Summary,
} from "@/lib/visit/summary";
import {
  QUESTIONS_MAX,
  QUESTION_EXAMPLES,
  QUESTION_MAX,
  SECTION_LABEL,
  TEXT_MAX,
  hasWriting,
  initialMemoState,
  memoReducer,
  type PresetChoice,
  type SectionKey,
} from "@/lib/visit/memo";
import { useAuthScope, useScopedRequest } from "./AuthScope";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const fieldClass = `w-full rounded border border-line bg-surface px-3 py-2 ${focusRing}`;

const PRESETS: ReadonlyArray<{ value: PresetChoice; label: string }> = [
  { value: 7, label: "지난 1주" },
  { value: 14, label: "지난 2주" },
  { value: 28, label: "지난 4주" },
  { value: "custom", label: "직접 고르기" },
];

const SECTION_ORDER: ReadonlyArray<SectionKey> = ["concern", "impact", "questions", "counts", "burdens", "tags", "days", "notes"];

type Load =
  | { kind: "loading" }
  | { kind: "ok"; records: Checkin[]; truncated: boolean; period: Period }
  | { kind: "error"; signedOut: boolean };

export default function VisitMemo() {
  const { guard } = useAuthScope();
  const run = useScopedRequest();
  const ids = { concern: useId(), impact: useId(), question: useId(), from: useId(), to: useId() };

  const [today] = useState(() => localDate(new Date().toISOString(), currentTimeZone()));
  const [state, dispatch] = useReducer(memoReducer, null, () => initialMemoState(today, presetPeriod(today, 28).from));

  const period: Period = state.preset === "custom" ? state.custom : presetPeriod(today, state.preset);
  const problem = checkPeriod(period);

  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const latest = useRef(0);

  const fetchPeriod = useCallback(
    async (p: Period) => {
      if (!getBrowserClient()) {
        setLoad({ kind: "error", signedOut: false });
        return;
      }
      const mine = ++latest.current;
      setLoad({ kind: "loading" });
      const { fromIso, toIso } = queryRange(p);
      const r = await run((client) => listCheckinsBetween(client as unknown as RangeClient, fromIso, toIso));
      // 화면이 닫혔거나 계정이 바뀌었거나 더 새로운 조회가 있으면 반영하지 않는다
      if (!("ticket" in r) || !guard.isCurrent(r.ticket) || mine !== latest.current) return;
      if (!r.ok) {
        setLoad({ kind: "error", signedOut: false });
        return;
      }
      const res = r.value;
      if (res.kind === "ok") {
        // 서버 RLS가 막지만, 요청한 계정의 기록만 쓴다 (한 번 더 확인)
        setLoad({ kind: "ok", records: res.records.filter((rec) => ownedBy(rec, r.ticket)), truncated: res.truncated, period: p });
      } else {
        setLoad({ kind: "error", signedOut: res.reason === "signed_out" });
      }
    },
    [run, guard],
  );

  const periodKey = problem ? null : `${period.from}~${period.to}`;
  useEffect(() => {
    if (!periodKey) return;
    const [from, to] = periodKey.split("~");
    void fetchPeriod({ from, to });
  }, [periodKey, fetchPeriod]);

  const summary: Summary | null = useMemo(
    () => (load.kind === "ok" ? summarize(load.records, load.period) : null),
    [load],
  );

  // 쓴 글은 저장하지 않으므로, 떠나기 전에 묻는다 ('도움이 필요해요'는 묻지 않고 바로 이동)
  const writing = hasWriting(state);
  useEffect(() => {
    if (!writing) return;
    return installLeaveGuard();
  }, [writing]);

  // 고른 기록 메모 중 지금 기간에 있는 것만 메모에 넣는다
  const pickedNotes = summary ? summary.notes.filter((n) => state.pickedNotes.includes(n.id)) : [];
  const shown = (k: SectionKey) => !state.hidden.includes(k);

  const [confirmClear, setConfirmClear] = useState(false);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="space-y-8 [overflow-wrap:anywhere]">
      <div className="space-y-2 print:hidden">
        <span className="eyebrow">VISIT NOTE</span>
        <h1 className="text-2xl leading-snug font-bold">진료 준비 메모</h1>
        <p className="text-muted">
          남긴 기록을 기간별로 모아 보고, 진료실에서 보여 줄 한 장 메모를 만들어요. 여기서 쓰는 글은 저장하지 않아요. 화면을 그대로
          보여 주거나 인쇄해 가져가세요.
        </p>
      </div>

      {/* 1. 기간 */}
      <fieldset className="space-y-3 print:hidden">
        <legend className="mb-2 text-lg font-bold">어느 기간을 볼까요?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRESETS.map((o) => {
            const on = state.preset === o.value;
            return (
              <label
                key={String(o.value)}
                className={`flex min-h-12 cursor-pointer items-center gap-2 rounded border px-3 ${on ? "border-accent bg-tint-sky font-bold" : "border-line"}`}
              >
                <input
                  type="radio"
                  name="visit-period"
                  checked={on}
                  onChange={() => dispatch({ type: "preset", value: o.value })}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
        {state.preset === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={ids.from} className="block font-bold">
                시작 날짜
              </label>
              <input
                id={ids.from}
                type="date"
                value={state.custom.from}
                max={today}
                onChange={(e) => dispatch({ type: "custom", field: "from", value: e.target.value })}
                className={`min-h-12 ${fieldClass}`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.to} className="block font-bold">
                끝 날짜
              </label>
              <input
                id={ids.to}
                type="date"
                value={state.custom.to}
                onChange={(e) => dispatch({ type: "custom", field: "to", value: e.target.value })}
                className={`min-h-12 ${fieldClass}`}
              />
            </div>
          </div>
        )}
        {problem ? (
          <p role="alert" className="rounded bg-warn-soft p-3 text-warn">
            {PERIOD_PROBLEM_TEXT[problem]}
          </p>
        ) : (
          <p className="text-muted">
            {formatDate(period.from)} ~ {formatDate(period.to)}
          </p>
        )}
        <div aria-live="polite">
          {!problem && load.kind === "loading" && <p className="text-muted">기록을 불러오는 중…</p>}
          {!problem && load.kind === "error" && (
            <div role="alert" className="space-y-2 rounded bg-warn-soft p-3 text-warn">
              <p>{load.signedOut ? "로그인이 끝났어요. 다시 로그인해 주세요." : "기록을 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요."}</p>
              {!load.signedOut && (
                <button
                  type="button"
                  onClick={() => void fetchPeriod(period)}
                  className={`min-h-11 rounded border border-warn px-4 ${focusRing}`}
                >
                  다시 불러오기
                </button>
              )}
            </div>
          )}
          {load.kind === "ok" && load.truncated && (
            <p role="status" className="rounded bg-warn-soft p-3 text-warn">
              이 기간의 기록이 너무 많아 일부만 셌어요. 기간을 짧게 골라 주세요.
            </p>
          )}
        </div>
      </fieldset>

      {/* 2. 쓰기 */}
      <section aria-labelledby="visit-write" className="space-y-5 print:hidden">
        <h2 id="visit-write" className="text-lg font-bold">
          진료 때 하고 싶은 말 (선택)
        </h2>
        <div className="space-y-1">
          <label htmlFor={ids.concern} className="block font-bold">
            요즘 가장 불편한 점
          </label>
          <textarea
            id={ids.concern}
            value={state.concern}
            maxLength={TEXT_MAX}
            rows={3}
            placeholder="예: 아침에 일어나기가 너무 힘들어요"
            onChange={(e) => dispatch({ type: "concern", value: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.impact} className="block font-bold">
            생활에 미친 영향
          </label>
          <textarea
            id={ids.impact}
            value={state.impact}
            maxLength={TEXT_MAX}
            rows={3}
            placeholder="예: 이번 달에 회사를 두 번 쉬었어요"
            onChange={(e) => dispatch({ type: "impact", value: e.target.value })}
            className={fieldClass}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={ids.question} className="block font-bold">
            진료 때 묻고 싶은 것
          </label>
          {state.questions.length > 0 && (
            <ul className="space-y-2" aria-label="적어 둔 질문">
              {state.questions.map((q, i) => (
                <li key={`${i}-${q}`} className="flex items-start gap-2 rounded border border-line p-3">
                  <span className="min-w-0 flex-1">{q}</span>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "removeQuestion", index: i })}
                    aria-label={`질문 빼기: ${q}`}
                    className={`min-h-11 shrink-0 rounded px-3 text-muted hover:bg-accent-soft ${focusRing}`}
                  >
                    빼기
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.questions.length < QUESTIONS_MAX ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({ type: "addQuestion" });
              }}
              className="flex gap-2"
            >
              <input
                id={ids.question}
                type="text"
                value={state.draftQuestion}
                maxLength={QUESTION_MAX}
                autoComplete="off"
                placeholder="예: 약을 바꾸고 잠이 줄었는데 괜찮을까요?"
                onChange={(e) => dispatch({ type: "draftQuestion", value: e.target.value })}
                className={`min-h-12 min-w-0 flex-1 ${fieldClass}`}
              />
              <button
                type="submit"
                disabled={!state.draftQuestion.trim()}
                className={`min-h-12 shrink-0 rounded bg-accent px-4 font-bold text-accent-fg disabled:opacity-50 ${focusRing}`}
              >
                넣기
              </button>
            </form>
          ) : (
            <p className="text-muted">질문은 {QUESTIONS_MAX}개까지 적을 수 있어요.</p>
          )}
          <div className="space-y-1">
            <p className="text-sm text-muted">이런 질문도 있어요. 누르면 입력 칸에 들어가요.</p>
            <div className="flex flex-wrap gap-2">
              {QUESTION_EXAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    dispatch({ type: "draftQuestion", value: q });
                    document.getElementById(ids.question)?.focus();
                  }}
                  className={`min-h-11 rounded-full border border-line px-3 text-left text-sm hover:bg-accent-soft ${focusRing}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {summary && summary.notes.length > 0 && (
          <fieldset>
            <legend className="mb-1 font-bold">기록 메모 중 함께 보여 줄 것 (선택)</legend>
            <p className="mb-2 text-sm text-muted">고른 메모만 들어가요. 처음엔 아무것도 들어가지 않아요.</p>
            <div className="space-y-1">
              {summary.notes.map((n) => (
                <label key={n.id} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                  <input
                    type="checkbox"
                    checked={state.pickedNotes.includes(n.id)}
                    onChange={(e) => dispatch({ type: "toggleNote", id: n.id, on: e.target.checked })}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-muted">
                      {formatDate(n.date)} {n.time}
                    </span>
                    <span className="block whitespace-pre-wrap">{n.text}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          {!confirmClear ? (
            <button
              ref={clearRef}
              type="button"
              disabled={!writing && state.pickedNotes.length === 0}
              onClick={() => {
                setConfirmClear(true);
                requestAnimationFrame(() => cancelClearRef.current?.focus());
              }}
              className={`min-h-11 rounded border border-line px-4 disabled:opacity-50 ${focusRing}`}
            >
              쓴 내용 모두 지우기
            </button>
          ) : (
            <div role="group" aria-label="쓴 내용 지우기 확인" className="space-y-2 rounded bg-warn-soft p-3">
              <p className="text-warn">불편한 점·생활 영향·질문·고른 기록 메모를 모두 지울까요? 남긴 기록은 지워지지 않아요.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  ref={cancelClearRef}
                  type="button"
                  onClick={() => {
                    setConfirmClear(false);
                    requestAnimationFrame(() => clearRef.current?.focus());
                  }}
                  className={`min-h-11 rounded border border-line bg-surface px-4 ${focusRing}`}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "clearWriting" });
                    setConfirmClear(false);
                    requestAnimationFrame(() => clearRef.current?.focus());
                  }}
                  className={`min-h-11 rounded border border-warn px-4 font-bold text-warn ${focusRing}`}
                >
                  지우기
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3. 넣을 부분 */}
      <fieldset className="print:hidden">
        <legend className="mb-2 text-lg font-bold">메모에 넣을 부분</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {SECTION_ORDER.map((k) => (
            <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={shown(k)}
                onChange={(e) => dispatch({ type: "toggleSection", key: k, on: e.target.checked })}
                className="h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
              <span>{SECTION_LABEL[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 4. 한 장 메모 */}
      <section aria-labelledby="visit-memo" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <h2 className="text-lg font-bold">미리 보기</h2>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!summary}
            className={`min-h-12 rounded bg-accent px-5 font-bold text-accent-fg disabled:opacity-50 ${focusRing}`}
          >
            인쇄하기
          </button>
        </div>
        <article className="space-y-5 rounded border border-line bg-surface p-5 print:border-0 print:p-0">
          <header className="space-y-1">
            <h3 id="visit-memo" className="text-xl font-bold">
              진료 메모
            </h3>
            {!problem && (
              <p className="text-muted">
                {formatDate(period.from)} ~ {formatDate(period.to)}
              </p>
            )}
          </header>

          {shown("concern") && state.concern.trim() && (
            <MemoBlock title={SECTION_LABEL.concern}>
              <p className="whitespace-pre-wrap">{state.concern.trim()}</p>
            </MemoBlock>
          )}
          {shown("impact") && state.impact.trim() && (
            <MemoBlock title={SECTION_LABEL.impact}>
              <p className="whitespace-pre-wrap">{state.impact.trim()}</p>
            </MemoBlock>
          )}
          {shown("questions") && state.questions.length > 0 && (
            <MemoBlock title={SECTION_LABEL.questions}>
              <ol className="list-decimal space-y-1 pl-6">
                {state.questions.map((q, i) => (
                  <li key={`${i}-${q}`}>{q}</li>
                ))}
              </ol>
            </MemoBlock>
          )}

          {summary && <RecordPart summary={summary} shown={shown} pickedNotes={pickedNotes} />}
          {!summary && !problem && <p className="text-muted">기록을 불러오면 여기에 정리돼요.</p>}

          <p className="border-t border-line pt-3 text-sm text-muted">
            404 blue에 직접 남긴 기록의 개수를 센 것이에요. 평균이나 점수로 바꾸지 않았어요. 기록이 없는 날은 그날 상태를 알 수 없다는 뜻이에요.
          </p>
        </article>
      </section>
    </div>
  );
}

function MemoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 break-inside-avoid">
      <h4 className="font-bold">{title}</h4>
      {children}
    </div>
  );
}

function RecordPart({
  summary: s,
  shown,
  pickedNotes,
}: {
  summary: Summary;
  shown: (k: SectionKey) => boolean;
  pickedNotes: Summary["notes"];
}) {
  if (s.records === 0) {
    return shown("counts") ? (
      <MemoBlock title={SECTION_LABEL.counts}>
        <p>이 기간에 남긴 기록이 없어요.</p>
      </MemoBlock>
    ) : null;
  }
  const sources = (["direct", "recall", "device"] as const).filter((k) => s.bySource[k] > 0);
  return (
    <>
      {shown("counts") && (
        <MemoBlock title={SECTION_LABEL.counts}>
          <ul className="space-y-0.5">
            <li>
              기간 {s.periodDays}일 중 기록한 날 <strong>{s.recordedDays}일</strong>, 기록 {s.records}개
            </li>
            <li>기록이 없는 날 {s.unrecordedDays}일</li>
            <li className="text-muted">{sources.map((k) => `${SOURCE_LABEL[k]} ${s.bySource[k]}개`).join(" · ")}</li>
          </ul>
        </MemoBlock>
      )}
      {shown("burdens") && (
        <MemoBlock title={SECTION_LABEL.burdens}>
          <table className="w-full max-w-md text-left">
            <thead className="text-sm text-muted">
              <tr>
                <th scope="col" className="py-1 font-normal">
                  고른 표현
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  기록
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  날짜
                </th>
              </tr>
            </thead>
            <tbody>
              {s.burdens.map((b) => (
                <tr key={b.value} className="border-t border-line">
                  <th scope="row" className="py-1 font-normal">
                    {burdenLabel(b.value)}
                  </th>
                  <td className="py-1 text-right">{b.records}개</td>
                  <td className="py-1 text-right">{b.days}일</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted">하루에 여러 번 남기면 기록은 여러 개, 날짜는 하루로 세요.</p>
        </MemoBlock>
      )}
      {shown("tags") && (
        <MemoBlock title={SECTION_LABEL.tags}>
          {s.tags.length === 0 ? (
            <p className="text-muted">고른 생활 항목이 없어요.</p>
          ) : (
            <ul className="space-y-0.5">
              {s.tags.map((t) => (
                <li key={t.value}>
                  {tagLabel(t.value)} — 기록 {t.records}개 ({t.days}일)
                </li>
              ))}
            </ul>
          )}
        </MemoBlock>
      )}
      {shown("days") && (
        <MemoBlock title={SECTION_LABEL.days}>
          <ul className="space-y-1">
            {s.days.map((d) => (
              <li key={d.date}>
                <span className="font-bold">{formatDate(d.date)}</span>{" "}
                {d.entries
                  .map((e) => `${e.time} ${burdenLabel(e.burden)}${e.source === "direct" ? "" : ` (${SOURCE_LABEL[e.source]})`}`)
                  .join(" · ")}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">기록이 없는 날은 적지 않았어요.</p>
        </MemoBlock>
      )}
      {shown("notes") && pickedNotes.length > 0 && (
        <MemoBlock title={SECTION_LABEL.notes}>
          <ul className="space-y-2">
            {pickedNotes.map((n) => (
              <li key={n.id}>
                <span className="block text-sm text-muted">
                  {formatDate(n.date)} {n.time}
                </span>
                <span className="block whitespace-pre-wrap">{n.text}</span>
              </li>
            ))}
          </ul>
        </MemoBlock>
      )}
    </>
  );
}
