"use client";

// 부탁하기 (4단계)
//  - 상황 고르기 → 문장 만들기 → 고치기 → 복사하거나 메시지 앱으로 넘기기.
//  - 앱이 대신 보내지 않는다. 복사를 '보냄'으로 기록하거나 표시하지 않는다.
//  - 받는 사람 이름과 문장은 이 화면 안에만 있다. 저장·전송·로그 없음 (로그인·저장 코드를 가져오지 않음).
import { useId, useReducer, useRef } from "react";
import {
  ASK_OPTIONS,
  NAME_MAX,
  SOFTENER,
  askReducer,
  canSend,
  currentText,
  initialAskState,
  smsHref,
  type AskKind,
} from "@/lib/ask/sentence";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function AskBuilder() {
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ids = { detail: useId(), name: useId(), text: useId(), status: useId() };
  const option = ASK_OPTIONS.find((o) => o.kind === state.kind) ?? ASK_OPTIONS[0];
  const text = currentText(state);
  const sendable = canSend(text);

  async function copy() {
    // 복사를 시작할 때의 문장. 끝났을 때 문장이 그대로일 때만 '복사했어요'를 보여 준다 (reducer가 비교).
    const target = text;
    if (!canSend(target)) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(target);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok && textRef.current) {
      // 클립보드 권한이 없을 때: 문장을 선택해 두고 기기 복사 기능을 쓴다
      textRef.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    dispatch({ type: "copied", ok, text: target });
  }

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <span className="eyebrow">ASK ONE THING</span>
        <h1 className="text-2xl leading-snug font-bold">
          막연한 “도와줘” 대신
          <br />
          할 일 하나를 건네요
        </h1>
        <p className="text-muted">상황을 고르면 보낼 문장을 만들어 드려요. 고친 뒤 직접 보내면 돼요.</p>
      </div>

      {/* 1. 상황 고르기 */}
      <fieldset className="space-y-2">
        <legend className="mb-2 font-bold">어떤 도움이 필요해요?</legend>
        <div className="divide-y divide-line border-y border-line">
          {ASK_OPTIONS.map((o, i) => {
            const on = o.kind === state.kind;
            return (
              <label
                key={o.kind}
                className={`flex min-h-14 cursor-pointer items-center gap-3 px-3 ${on ? "bg-tint-sky font-bold" : ""}`}
              >
                <input
                  type="radio"
                  name="ask-kind"
                  value={o.kind}
                  checked={on}
                  onChange={() => dispatch({ type: "pick", kind: o.kind as AskKind })}
                  className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                />
                <span className="font-label text-sm text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 2. 채울 칸 (선택) */}
      <div className="grid gap-4 sm:grid-cols-2">
        {option.field && (
          <div className="space-y-1.5">
            <label htmlFor={ids.detail} className="block font-semibold">
              {option.field.label}
            </label>
            <input
              id={ids.detail}
              type="text"
              value={state.detail}
              maxLength={option.field.maxLength}
              placeholder={option.field.hint}
              autoComplete="off"
              onChange={(e) => dispatch({ type: "detail", value: e.target.value })}
              className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label htmlFor={ids.name} className="block font-semibold">
            받는 사람 이름 (선택)
          </label>
          <input
            id={ids.name}
            type="text"
            value={state.name}
            maxLength={NAME_MAX}
            placeholder="예: 민지"
            autoComplete="off"
            aria-describedby={`${ids.name}-note`}
            onChange={(e) => dispatch({ type: "name", value: e.target.value })}
            className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
          />
          <p id={`${ids.name}-note`} className="text-sm text-muted">
            이름과 문장은 이 기기나 서버에 저장하지 않아요. 다 쓰면 아래 ‘입력 지우고 처음부터’로 지울 수 있어요.
          </p>
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={state.soften}
          onChange={(e) => dispatch({ type: "soften", value: e.target.checked })}
          className="h-5 w-5 shrink-0 accent-[var(--accent)]"
        />
        <span>
          부담을 덜어 주는 한마디 덧붙이기 <span className="text-muted">— “{SOFTENER}”</span>
        </span>
      </label>

      {/* 3. 보낼 문장 · 고치기 */}
      <section aria-labelledby={`${ids.text}-label`} className="space-y-2 rounded bg-tint-pink p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label id={`${ids.text}-label`} htmlFor={ids.text} className="font-bold">
            보낼 문장
          </label>
          <span className="text-sm text-muted">눌러서 고칠 수 있어요</span>
        </div>
        <textarea
          id={ids.text}
          ref={textRef}
          value={text}
          rows={4}
          maxLength={500}
          onChange={(e) => dispatch({ type: "edit", value: e.target.value })}
          className={`w-full resize-y rounded border border-line bg-surface p-3 leading-relaxed ${focusRing}`}
        />
        {state.edited !== null && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>직접 고친 문장이에요. 위에서 상황·이름을 바꿔도 이 문장은 그대로예요. 새로 만들려면 ‘처음 문장으로’를 눌러요.</span>
            <button
              type="button"
              onClick={() => dispatch({ type: "regenerate" })}
              className={`min-h-11 rounded-full border border-current px-3 ${focusRing}`}
            >
              처음 문장으로
            </button>
          </p>
        )}
      </section>

      {/* 4. 직접 보내기: 복사가 먼저 (메시지 앱 본문 채우기는 휴대폰마다 다를 수 있음) */}
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!sendable}
            aria-describedby={ids.status}
            className={`pastel-fill flex min-h-12 items-center justify-center rounded-full px-5 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          >
            복사하기
          </button>
          {sendable ? (
            <a
              href={smsHref(text)}
              className={`flex min-h-12 items-center justify-center rounded-full border border-fg px-5 text-center font-semibold hover:bg-tint-sky ${focusRing}`}
            >
              메시지 앱으로
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="flex min-h-12 cursor-not-allowed items-center justify-center rounded-full border border-fg px-5 font-semibold opacity-50"
            >
              메시지 앱으로
            </button>
          )}
        </div>
        <p id={ids.status} aria-live="polite" className="min-h-6 text-sm">
          {!sendable && "보낼 문장이 비어 있어요. 문장을 쓰거나 ‘처음 문장으로’를 눌러 주세요."}
          {sendable && state.copied === "copied" && "복사했어요. 카카오톡이나 메시지 앱에 붙여 넣어 직접 보내 주세요."}
          {sendable && state.copied === "failed" && "복사하지 못했어요. 문장을 길게 눌러 직접 복사해 주세요."}
        </p>
        <p className="text-sm text-muted">휴대폰에 따라 메시지 앱에 문장이 채워지지 않을 수 있어요. 그럴 땐 복사해서 붙여 넣어 주세요.</p>
      </div>

      <section aria-labelledby="ask-after" className="space-y-2 border-t border-line pt-4 text-[0.95rem]">
        <h2 id="ask-after" className="font-bold">
          앱이 대신 보내지 않아요
        </h2>
        <p>보낼지 말지, 누구에게 보낼지는 언제나 내가 정해요.</p>
        <p>답이 없거나 어렵다는 답이 와도 내 잘못이 아니에요. 다른 사람에게 보내거나, 정신건강복지센터에 물어볼 수도 있어요.</p>
        <a
          href="/help"
          className={`inline-flex min-h-11 items-center font-semibold underline decoration-accent decoration-2 underline-offset-4 ${focusRing}`}
        >
          연락할 수 있는 곳 보기
        </a>
        <br />
        <button
          type="button"
          onClick={() => dispatch({ type: "reset" })}
          className={`min-h-11 rounded-full border border-line px-4 text-sm text-muted hover:border-accent ${focusRing}`}
        >
          입력 지우고 처음부터
        </button>
      </section>
    </div>
  );
}
