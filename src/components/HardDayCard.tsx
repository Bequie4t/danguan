"use client";

// 힘든 날 카드 (6단계)
//  - 괜찮은 날: 먹을 것·연락할 사람·부탁 문장을 적고 '이 기기에 저장하기'.
//  - 힘든 날: 큰 버튼으로 꺼내 보기 (먹을 것 열기, 부탁 문장 복사, 답이 없을 때 다음 선택).
//  - 저장은 이 기기 브라우저에만. 서버·계정·로그로 보내지 않는다. 로그인·Supabase 코드를 가져오지 않는다.
//  - 앱이 대신 보내지 않는다. 복사를 '보냄'으로 표시하지 않는다.
import { useEffect, useId, useRef, useState } from "react";
import {
  LIMITS,
  MAX_FOODS,
  MAX_PEOPLE,
  browserStore,
  canSend,
  clearCard,
  emptyCard,
  hasContent,
  loadCard,
  normalize,
  saveCard,
  urlProblem,
  type Food,
  type HardDayCard as Card,
  type KeyValueStore,
} from "@/lib/hardday/card";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const bigButton = `flex min-h-14 w-full items-center justify-center rounded-full px-5 text-lg font-semibold ${focusRing}`;

type Draft = { foods: Food[]; people: string[]; message: string };
type Phase = "loading" | "edit" | "view";
type Notice = null | "saved" | "save-failed" | "cleared" | "clear-failed" | "broken" | "unavailable";

function fromCard(c: Card): Draft {
  return {
    foods: c.foods.length ? c.foods.map((f) => ({ ...f })) : [{ name: "", url: "" }],
    people: c.people.length ? [...c.people] : [""],
    message: c.message,
  };
}

function formatSaved(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function HardDayCard() {
  const store = useRef<KeyValueStore | null>(null);
  const [available, setAvailable] = useState(true);
  const [phase, setPhase] = useState<Phase>("loading");
  const [saved, setSaved] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Draft>(() => {
    const e = emptyCard();
    return { foods: e.foods, people: e.people, message: e.message };
  });
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** 저장할 수 없는 브라우저에서 '저장하지 않고 이번에만 보기'로 연 카드 */
  const [temporary, setTemporary] = useState(false);
  const [copied, setCopied] = useState<{ result: "copied" | "failed"; text: string } | null>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();

  // 처음 열 때 이 기기에 저장된 카드를 읽는다 (서버 렌더링 때는 읽지 않음)
  useEffect(() => {
    store.current = browserStore();
    const r = loadCard(store.current);
    if (r.status === "ok") {
      setSaved(r.card);
      setDraft(fromCard(r.card));
      setPhase("view");
      return;
    }
    if (r.status === "unavailable") {
      setAvailable(false);
      setNotice("unavailable");
    }
    if (r.status === "broken") setNotice("broken");
    setPhase("edit");
  }, []);

  const problems = draft.foods.map((f) => urlProblem(f.url));
  const canSave = available && hasContent(draft) && problems.every((p) => p === null);

  function save() {
    if (!canSave) return;
    const card = normalize(draft, new Date());
    if (saveCard(store.current, card)) {
      setSaved(card);
      setDraft(fromCard(card));
      setNotice("saved");
      setCopied(null);
      setPhase("view");
    } else {
      setNotice("save-failed"); // 입력은 그대로 둔다
    }
  }

  function clear() {
    if (clearCard(store.current)) {
      const e = emptyCard();
      setSaved(null);
      setDraft({ foods: e.foods, people: e.people, message: e.message });
      setNotice("cleared");
      setCopied(null);
      setPhase("edit");
    } else {
      setNotice("clear-failed");
    }
    setConfirmClear(false);
  }

  async function copy(text: string) {
    if (!canSend(text)) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok && msgRef.current) {
      msgRef.current.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
    }
    setCopied({ result: ok ? "copied" : "failed", text });
  }

  const setFood = (i: number, patch: Partial<Food>) =>
    setDraft((d) => ({ ...d, foods: d.foods.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const setPerson = (i: number, v: string) => setDraft((d) => ({ ...d, people: d.people.map((p, j) => (j === i ? v : p)) }));

  const noticeText: Record<Exclude<Notice, null>, string> = {
    saved: "이 기기에 저장했어요.",
    "save-failed": "저장하지 못했어요. 적은 내용은 그대로 있어요. 다시 눌러 보거나, 이번에는 저장 없이 써 주세요.",
    cleared: "이 기기에서 카드를 지웠어요.",
    "clear-failed": "지우지 못했어요. 브라우저 설정에서 이 사이트 데이터를 지울 수도 있어요.",
    broken: "저장된 카드를 읽을 수 없어서 쓰지 않았어요. 새로 적어 저장하면 바뀌어요.",
    unavailable: "이 브라우저에서는 저장할 수 없어요 (사생활 보호 모드 등). 이번에만 쓰고 저장은 되지 않아요.",
  };

  const header = (
    <div className="space-y-2">
      <span className="eyebrow">HARD DAY CARD</span>
      <h1 className="text-2xl leading-snug font-bold">힘든 날 카드</h1>
      <p className="text-muted">괜찮은 날 미리 적어 두면, 힘든 날 생각하지 않고 꺼내 쓸 수 있어요.</p>
      <p role="status" aria-live="polite" className="min-h-6 font-semibold">
        {notice && noticeText[notice]}
      </p>
    </div>
  );

  if (phase === "loading") return <div className="space-y-6">{header}</div>;

  if (phase === "edit") {
    return (
      <div className="space-y-8 [overflow-wrap:anywhere]">
        {header}
        <form
          className="space-y-7"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset className="space-y-3">
            <legend className="text-lg font-bold">먹을 것 (최대 {MAX_FOODS}개)</legend>
            {draft.foods.map((f, i) => {
              const nameId = `${uid}-food-${i}`;
              const urlId = `${uid}-url-${i}`;
              return (
                <div key={i} className="space-y-2 rounded border border-line p-3">
                  <label htmlFor={nameId} className="block font-semibold">
                    먹을 것 {i + 1}
                  </label>
                  <input
                    id={nameId}
                    value={f.name}
                    maxLength={LIMITS.foodName}
                    placeholder="예: 동네 죽집 소고기죽"
                    autoComplete="off"
                    onChange={(e) => setFood(i, { name: e.target.value })}
                    className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
                  />
                  <label htmlFor={urlId} className="block text-sm font-semibold">
                    주문할 때 여는 주소 (선택)
                  </label>
                  <input
                    id={urlId}
                    type="url"
                    inputMode="url"
                    value={f.url}
                    maxLength={LIMITS.foodUrl}
                    placeholder="https://"
                    autoComplete="off"
                    aria-invalid={problems[i] ? true : undefined}
                    aria-describedby={problems[i] ? `${urlId}-err` : undefined}
                    onChange={(e) => setFood(i, { url: e.target.value })}
                    className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
                  />
                  {problems[i] && (
                    <p id={`${urlId}-err`} className="text-sm font-semibold">
                      {problems[i]}
                    </p>
                  )}
                </div>
              );
            })}
            {draft.foods.length < MAX_FOODS && (
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, foods: [...d.foods, { name: "", url: "" }] }))}
                className={`min-h-11 rounded-full border border-line px-4 ${focusRing}`}
              >
                먹을 것 더하기
              </button>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-lg font-bold">부탁할 사람 (선택, 최대 {MAX_PEOPLE}명)</legend>
            <p className="text-sm text-muted">부르는 이름만 적어요. 전화번호는 받지 않아요. 비워 둬도 괜찮아요.</p>
            {draft.people.map((p, i) => {
              const id = `${uid}-person-${i}`;
              return (
                <div key={i} className="space-y-1.5">
                  <label htmlFor={id} className="block font-semibold">
                    {i === 0 ? "먼저 부탁할 사람" : "그다음 사람"}
                  </label>
                  <input
                    id={id}
                    value={p}
                    maxLength={LIMITS.person}
                    placeholder="예: 민지"
                    autoComplete="off"
                    onChange={(e) => setPerson(i, e.target.value)}
                    className={`min-h-12 w-full rounded border border-line bg-surface px-3 ${focusRing}`}
                  />
                </div>
              );
            })}
            {draft.people.length < MAX_PEOPLE && (
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, people: [...d.people, ""] }))}
                className={`min-h-11 rounded-full border border-line px-4 ${focusRing}`}
              >
                사람 더하기
              </button>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <label htmlFor={`${uid}-msg`} className="block text-lg font-bold">
              부탁 문장 (선택)
            </label>
            <textarea
              id={`${uid}-msg`}
              value={draft.message}
              rows={3}
              maxLength={LIMITS.message}
              onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
              className={`w-full resize-y rounded border border-line bg-surface p-3 leading-relaxed ${focusRing}`}
            />
            <p className="text-sm">
              다른 부탁이 필요하면{" "}
              <a href="/ask" className={`inline-flex min-h-11 items-center underline underline-offset-4 ${focusRing}`}>
                부탁하기
              </a>
              에서 만들어 붙여 넣어도 돼요.
            </p>
          </div>

          <div className="space-y-3 rounded bg-tint-sky p-4">
            <p className="text-sm">
              <strong>이 기기 브라우저에만 저장돼요.</strong> 서버나 계정에는 올리지 않아요. 다른 기기에서는 보이지 않고, 다른
              사람이 같이 쓰는 기기라면 저장하지 않는 편이 좋아요.
            </p>
            <button
              type="submit"
              disabled={!canSave}
              className={`pastel-fill ${bigButton} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              이 기기에 저장하기
            </button>
            {!available && (
              <>
                <p className="text-sm">이 브라우저에서는 저장할 수 없어요.</p>
                <button
                  type="button"
                  disabled={!hasContent(draft) || problems.some((p) => p !== null)}
                  onClick={() => {
                    setSaved(normalize(draft, new Date()));
                    setTemporary(true);
                    setCopied(null);
                    setPhase("view");
                  }}
                  className={`min-h-11 w-full rounded-full border border-fg px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                >
                  저장하지 않고 이번에만 보기
                </button>
              </>
            )}
            {available && !hasContent(draft) && <p className="text-sm">하나라도 적으면 저장할 수 있어요.</p>}
            {saved && (
              <button
                type="button"
                onClick={() => {
                  setDraft(fromCard(saved));
                  setNotice(null);
                  setPhase("view");
                }}
                className={`min-h-11 w-full rounded-full border border-line px-4 ${focusRing}`}
              >
                고치지 않고 카드로 돌아가기
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  // 보기 (힘든 날)
  const card = saved!;
  const message = card.message;
  const first = card.people[0];
  const second = card.people[1];
  const copiedNow = copied && copied.text === message ? copied.result : null;

  return (
    <div className="space-y-8 [overflow-wrap:anywhere]">
      {header}

      <section aria-labelledby="hd-food" className="space-y-3">
        <h2 id="hd-food" className="text-lg font-bold">
          먹을 것
        </h2>
        {card.foods.length === 0 ? (
          <p className="text-muted">적어 둔 먹을 것이 없어요.</p>
        ) : (
          <ul className="space-y-3">
            {card.foods.map((f, i) => (
              <li key={i} data-food={i} className="space-y-2 rounded bg-surface p-4 shadow-sm">
                {f.name && <p className="text-xl font-semibold">{f.name}</p>}
                {f.url && (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${bigButton} border border-fg`}
                  >
                    주문 화면 열기 (새 창)
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="hd-ask" className="space-y-3 rounded bg-tint-pink p-4">
        <h2 id="hd-ask" className="text-lg font-bold">
          부탁하기
        </h2>
        {first && (
          <p>
            먼저 <strong>{first}</strong>에게{second ? <>, 어렵다면 <strong>{second}</strong>에게</> : null} 보내 봐요.
          </p>
        )}
        {canSend(message) ? (
          <>
            <textarea
              ref={msgRef}
              readOnly
              value={message}
              rows={3}
              aria-label="부탁 문장"
              className="w-full resize-none rounded border border-line bg-surface p-3 text-lg leading-relaxed"
            />
            <button type="button" onClick={() => void copy(message)} className={`pastel-fill ${bigButton}`}>
              문장 복사하기
            </button>
            <p aria-live="polite" className="min-h-6 text-sm">
              {copiedNow === "copied" && "복사했어요. 메시지 앱이나 카카오톡에 붙여 넣어 직접 보내 주세요."}
              {copiedNow === "failed" && "복사하지 못했어요. 문장을 길게 눌러 직접 복사해 주세요."}
            </p>
          </>
        ) : (
          <p className="text-muted">적어 둔 부탁 문장이 없어요.</p>
        )}
      </section>

      <section aria-labelledby="hd-next" className="space-y-2">
        <h2 id="hd-next" className="text-lg font-bold">
          {first ? "답이 없거나 어렵다고 하면" : "부탁할 사람이 없다면"}
        </h2>
        <p>{first ? "내 잘못이 아니에요. 다른 방법도 있어요." : "괜찮아요. 이런 방법도 있어요."}</p>
        <ul className="space-y-1">
          {first && second && (
            <li>
              <strong>{second}</strong>에게 같은 문장을 보내 봐요.
            </li>
          )}
          <li>
            <a href="/ask" className={`inline-flex min-h-11 items-center font-semibold underline underline-offset-4 ${focusRing}`}>
              부탁하기에서 다른 부탁 만들기
            </a>
          </li>
          <li>
            정신건강위기상담전화{" "}
            <a href="tel:15770199" className={`inline-flex min-h-11 items-center font-bold underline underline-offset-4 ${focusRing}`}>
              1577-0199
            </a>
            에 물어볼 수 있어요.
          </li>
          <li>
            <a href="/help" className={`inline-flex min-h-11 items-center font-semibold underline underline-offset-4 ${focusRing}`}>
              지금 많이 힘들다면: 연락할 수 있는 곳
            </a>
          </li>
        </ul>
      </section>

      <section aria-labelledby="hd-store" className="space-y-3 border-t border-line pt-4">
        <h2 id="hd-store" className="sr-only">
          카드 관리
        </h2>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setPhase("edit");
          }}
          className={`min-h-11 rounded-full border border-fg px-5 font-semibold ${focusRing}`}
        >
          카드 고치기
        </button>
        {temporary ? (
          <p className="text-sm text-muted">저장되지 않은 카드예요. 이 화면을 닫으면 다시 적어야 해요.</p>
        ) : (
          <p className="text-sm text-muted">
            {formatSaved(card.savedAt)}에 이 기기 브라우저에 저장했어요. 다른 사람이 같이 쓰는 기기라면 지워 주세요.
          </p>
        )}
        {temporary ? null : !confirmClear ? (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className={`min-h-11 rounded-full border border-line px-4 text-sm ${focusRing}`}
          >
            이 기기에서 지우기
          </button>
        ) : (
          <div role="group" aria-labelledby={`${uid}-confirm`} className="space-y-2 rounded border border-fg p-3">
            <p id={`${uid}-confirm`} className="font-semibold">
              이 기기에서 카드를 지울까요? 지우면 되돌릴 수 없어요.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={clear} className={`min-h-11 rounded-full bg-fg px-5 font-semibold text-bg ${focusRing}`}>
                지우기
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className={`min-h-11 rounded-full border border-line px-5 ${focusRing}`}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
