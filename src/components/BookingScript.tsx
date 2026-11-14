"use client";

// 예약 대본 (5단계)
//  - 전화로 할지 글로 할지, 처음인지, 원하는 때, 물어볼 것 → 읽기만 하면 되는 대본.
//  - 앱이 대신 전화하거나 보내지 않는다. 병원 검색 없음. 저장·전송·로그 없음.
//  - 로그인·기록 저장·Supabase 코드를 가져오지 않는다.
import { useId, useReducer, useRef, useState } from "react";
import { LOCAL_CENTER } from "@/app/help/contacts";
import {
  ASK_ITEMS,
  IF_STUCK,
  THEY_MAY_ASK,
  WHEN_MAX,
  WORRIES,
  WORRIES_CHECKED_ON,
  bookingReducer,
  buildCallScript,
  canSendMessage,
  currentMessage,
  initialBookingState,
  type Channel,
  type Visit,
} from "@/lib/booking/script";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function Choice<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded border px-3 ${on ? "border-accent bg-tint-sky font-bold" : "border-line"}`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => onChange(o.value)}
                className="h-5 w-5 shrink-0 accent-[var(--accent)]"
              />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

export default function BookingScript() {
  const [state, dispatch] = useReducer(bookingReducer, initialBookingState);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ids = { when: useId(), text: useId(), status: useId() };
  const steps = buildCallScript(state);
  const message = currentMessage(state);
  const sendable = canSendMessage(message);
  const sayClass = state.large ? "text-2xl leading-snug" : "text-lg leading-relaxed";

  // 클립보드 쓰기는 한 번에 하나만 (겹치면 실제로 붙여넣을 글과 안내가 달라질 수 있음)
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);

  async function copy() {
    // 복사를 시작할 때의 글. 끝났을 때 글이 그대로일 때만 결과를 보여 준다 (reducer가 비교).
    const target = message;
    if (!canSendMessage(target) || copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      dispatch({ type: "copied", ok: await writeOnce(target), text: target });
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  async function writeOnce(target: string): Promise<boolean> {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(target);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // 대체 복사는 누른 글이 그대로일 때만 (기다리는 사이 고친 다른 글을 대신 복사하지 않게)
    if (!ok && textRef.current && textRef.current.value === target) {
      textRef.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    return ok;
  }

  return (
    // 사용자가 띄어쓰기 없이 길게 입력해도 좁은 화면에서 줄이 바뀌도록 (200% 확대)
    <div className="space-y-8 [overflow-wrap:anywhere]">
      <div className="space-y-2">
        <span className="eyebrow">BOOK A VISIT</span>
        <h1 className="text-2xl leading-snug font-bold">
          읽기만 하면 되는
          <br />
          병원 예약 대본
        </h1>
        <p className="text-muted">몇 가지만 고르면 예약할 때 할 말을 순서대로 만들어 드려요. 연락은 내가 직접 해요.</p>
      </div>

      {/* 1. 고르기 */}
      <div className="space-y-5">
        <Choice<Channel>
          name="booking-channel"
          legend="어떻게 예약할까요?"
          value={state.channel}
          options={[
            { value: "call", label: "전화로" },
            { value: "text", label: "글로 (문자·카톡·누리집)" },
          ]}
          onChange={(v) => dispatch({ type: "channel", value: v })}
        />
        <Choice<Visit>
          name="booking-visit"
          legend="이 병원에 가 본 적 있어요?"
          value={state.visit}
          options={[
            { value: "first", label: "처음이에요" },
            { value: "again", label: "다닌 적 있어요" },
          ]}
          onChange={(v) => dispatch({ type: "visit", value: v })}
        />
        <div className="space-y-1.5">
          <label htmlFor={ids.when} className="block font-bold">
            원하는 때 (선택)
          </label>
          <input
            id={ids.when}
            type="text"
            value={state.when}
            maxLength={WHEN_MAX}
            placeholder="예: 이번 주 목요일 오후"
            autoComplete="off"
            aria-describedby={`${ids.when}-note`}
            onChange={(e) => dispatch({ type: "when", value: e.target.value })}
            className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
          />
          <p id={`${ids.when}-note`} className="text-sm text-muted">
            비워 두면 “가장 빠른 날”을 묻는 말로 만들어요. 입력한 내용은 저장하지 않아요.
          </p>
        </div>
        <fieldset>
          <legend className="mb-2 font-bold">함께 물어볼 것 (선택)</legend>
          <div className="space-y-1">
            {ASK_ITEMS.map((a) => (
              <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={state.asks.includes(a.id)}
                  onChange={(e) => dispatch({ type: "toggleAsk", id: a.id, on: e.target.checked })}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <span>{a.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {/* 2. 대본 */}
      {state.channel === "call" ? (
        <section aria-labelledby="script-title" className="space-y-4 rounded bg-tint-sky p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="script-title" className="text-lg font-bold">
              전화 대본
            </h2>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.large}
                onChange={(e) => dispatch({ type: "large", value: e.target.checked })}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              글씨 크게
            </label>
          </div>
          <ol className="space-y-4">
            {steps.map((s, i) => (
              <li key={s.id} data-step={s.id} className="rounded bg-surface p-4">
                <p className="text-sm font-semibold text-muted">
                  <span className="font-label">{String(i + 1).padStart(2, "0")}</span> {s.title}
                </p>
                {s.say.map((line) => (
                  <p key={line} className={`mt-1 font-semibold ${sayClass}`}>
                    “{line}”
                  </p>
                ))}
                {s.tip && <p className="mt-2 text-sm text-muted">{s.tip}</p>}
              </li>
            ))}
          </ol>

          <div className="space-y-3 rounded bg-surface p-4">
            <h3 className="font-bold">상대가 이렇게 물어볼 수 있어요</h3>
            <ul className="space-y-3">
              {THEY_MAY_ASK.map((t) => (
                <li key={t.q}>
                  <p className="text-sm font-semibold text-muted">{t.q}</p>
                  {t.say.map((a) => (
                    <p key={a} className={`mt-1 font-semibold ${state.large ? "text-xl" : ""}`}>
                      “{a}”
                    </p>
                  ))}
                  {t.tip && <p className="mt-1 text-sm">{t.tip}</p>}
                </li>
              ))}
            </ul>
            <p className="text-sm">전화로 자세히 설명하지 않아도 괜찮아요. 이야기는 진료실에서 하면 돼요.</p>
          </div>

          <div className="space-y-2 rounded bg-surface p-4">
            <h3 className="font-bold">막히면 이렇게 말해요</h3>
            <ul className="space-y-1">
              {IF_STUCK.map((l) => (
                <li key={l} className={state.large ? "text-xl" : ""}>
                  “{l}”
                </li>
              ))}
            </ul>
            <p className="text-sm">중간에 끊어도 괜찮아요. 오늘 못 하면 다른 날 다시 하면 돼요.</p>
          </div>
        </section>
      ) : (
        <section aria-labelledby={`${ids.text}-label`} className="space-y-2 rounded bg-tint-sky p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label id={`${ids.text}-label`} htmlFor={ids.text} className="text-lg font-bold">
              예약 문의 글
            </label>
            <span className="text-sm text-muted">눌러서 고칠 수 있어요</span>
          </div>
          <textarea
            id={ids.text}
            ref={textRef}
            value={message}
            rows={5}
            maxLength={500}
            onChange={(e) => dispatch({ type: "edit", value: e.target.value })}
            className={`w-full resize-y rounded border border-line bg-surface p-3 leading-relaxed ${focusRing}`}
          />
          {state.edited !== null && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span>직접 고친 글이에요. 위에서 선택을 바꿔도 이 글은 그대로예요. 새로 만들려면 ‘처음 글로’를 눌러요.</span>
              <button
                type="button"
                onClick={() => dispatch({ type: "regenerate" })}
                className={`min-h-11 rounded-full border border-current px-3 ${focusRing}`}
              >
                처음 글로
              </button>
            </p>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!sendable || copying}
            aria-busy={copying || undefined}
            aria-describedby={ids.status}
            className={`pastel-fill flex min-h-12 w-full items-center justify-center rounded-full px-5 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            {copying ? "복사 중…" : "복사하기"}
          </button>
          <p id={ids.status} aria-live="polite" className="min-h-6 text-sm">
            {!sendable && "보낼 글이 비어 있어요. 글을 쓰거나 ‘처음 글로’를 눌러 주세요."}
            {sendable && state.copied === "copied" && "복사했어요. 병원 문자·카카오톡·누리집 예약 칸에 붙여 넣어 직접 보내 주세요."}
            {sendable && state.copied === "failed" && "복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요."}
            {sendable && state.copied === "stale" && "복사하는 사이 글이 바뀌었어요. 지금 글을 확인하고 다시 눌러 주세요."}
          </p>
          <p className="text-sm text-muted">글로 예약을 받는지는 병원마다 달라요. 안 되면 전화 대본으로 바꿀 수 있어요.</p>
        </section>
      )}

      {/* 3. 전화가 너무 어려울 때 */}
      <section aria-labelledby="booking-hard" className="space-y-2">
        <h2 id="booking-hard" className="text-lg font-bold">
          직접 연락하기가 너무 어렵다면
        </h2>
        <p>예약 전화를 다른 사람에게 부탁해도 돼요.</p>
        <a
          href="/ask?kind=booking"
          className={`inline-flex min-h-11 items-center font-semibold underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`}
        >
          예약 전화 부탁하는 문장 만들기
        </a>
      </section>

      <section aria-labelledby="booking-center" className="space-y-2 rounded bg-tint-pink p-4">
        <h2 id="booking-center" className="text-lg font-bold">
          병원이 아직 망설여진다면
        </h2>
        <p>{LOCAL_CENTER.body}</p>
        <p>
          어디로 연락할지 모르겠으면 정신건강위기상담전화{" "}
          <a href="tel:15770199" className={`inline-flex min-h-11 items-center font-bold underline underline-offset-4 ${focusRing}`}>
            1577-0199
          </a>
          로 물어볼 수도 있어요.
        </p>
      </section>

      {/* 4. 걱정 풀기 */}
      <section aria-labelledby="booking-worries" className="space-y-3">
        <h2 id="booking-worries" className="text-lg font-bold">
          이런 게 걱정된다면
        </h2>
        <div className="divide-y divide-line border-y border-line">
          {WORRIES.map((w) => (
            <details key={w.id} data-worry={w.id} className="group">
              <summary className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 py-2 font-semibold ${focusRing}`}>
                {w.title}
                <span aria-hidden="true" className="text-muted group-open:rotate-45">
                  +
                </span>
              </summary>
              <div className="space-y-2 pb-4">
                {w.body.map((b) => (
                  <p key={b}>{b}</p>
                ))}
                {w.sources.map((s) => (
                  <p key={s.url} className="text-sm">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex min-h-11 items-center underline underline-offset-4 ${focusRing}`}
                    >
                      근거: {s.label}
                    </a>
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
        <p className="text-sm text-muted">
          {formatDate(WORRIES_CHECKED_ON)}에 확인한 내용이에요. 법이나 제도는 바뀔 수 있고, 법률·의학 조언이 아니에요.
        </p>
      </section>

      <div className="border-t border-line pt-4">
        <button
          type="button"
          onClick={() => dispatch({ type: "reset" })}
          className={`min-h-11 rounded-full border border-line px-4 text-sm text-muted hover:border-accent ${focusRing}`}
        >
          입력 지우고 처음부터
        </button>
      </div>
    </div>
  );
}
