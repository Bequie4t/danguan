"use client";

// 오늘 최소한 (PRD B2)
//  - 큰 버튼을 눌러 한 것만 표시한다. 하지 않은 것·개수·연속 기록·점수는 보여 주지 않는다.
//  - 이 기기에만 저장한다. 로그인·기록·Supabase 코드를 가져오지 않는다. 서버로 보내지 않는다.
//  - 날이 바뀌면 체크는 비워진다 (지난 날 체크는 남기지 않음). 항목은 고치고 줄이고 더할 수 있다.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DEFAULT_ITEMS,
  ITEMS_MAX,
  LABEL_MAX,
  STORAGE_KEY,
  browserLocks,
  browserStore,
  clearAll,
  cleanLabel,
  defaultStored,
  deviceToday,
  newItemId,
  readStored,
  replaceItems,
  rollover,
  sameItems,
  setDone,
  update,
  withLock,
  type Item,
  type Stored,
} from "@/lib/minimum/today";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

type Mode = "stored" | "memory";
type Notice =
  | null
  | "unavailable" // 저장소를 쓸 수 없음 → 이번에만
  | "write-failed" // 저장 실패 → 이번에만
  | "busy" // 다른 창이 쓰는 중
  | "changed-elsewhere" // 다른 창에서 바뀌어 새로 불러옴
  | "changed-while-editing" // 고치는 중 다른 창에서 항목이 바뀜
  | "saved-items"
  | "cleared";

const NOTICE_TEXT: Record<Exclude<Notice, null>, string> = {
  unavailable: "이 브라우저에서는 저장할 수 없어서, 이 화면을 닫으면 체크가 사라져요.",
  "write-failed": "이 기기에 저장하지 못했어요. 이 화면을 닫기 전까지만 표시해요.",
  busy: "다른 창에서 저장하는 중이에요. 잠시 뒤 다시 눌러 주세요.",
  "changed-elsewhere": "다른 창에서 바꾼 내용으로 새로 불러왔어요.",
  "changed-while-editing": "고치는 사이 다른 창에서 항목이 바뀌었어요. 저장하면 이 화면의 항목으로 바뀌어요.",
  "saved-items": "항목을 저장했어요.",
  cleared: "이 기기에서 지웠어요. 기본 항목으로 돌아왔어요.",
};

type Draft = { id: string; label: string }[];

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export default function TodayMinimum() {
  const ids = { list: useId(), edit: useId() };
  const [today, setToday] = useState(() => deviceToday());
  const [mode, setMode] = useState<Mode>("stored");
  const [state, setState] = useState<Stored | null>(null);
  const [broken, setBroken] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [working, setWorking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const baseItems = useRef<Item[] | null>(null);
  const modeRef = useRef<Mode>("stored");
  modeRef.current = mode;
  const editingRef = useRef(false);
  editingRef.current = draft !== null;
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);

  const load = useCallback((day: string, why: Notice = null) => {
    const r = readStored(browserStore(), day);
    if (r.status === "unavailable") {
      setMode("memory");
      setState((s) => (s ? rollover(s, day) : defaultStored(day)));
      setNotice("unavailable");
      return;
    }
    if (r.status === "broken") {
      setBroken(true);
      setState(null);
      return;
    }
    setBroken(false);
    setMode("stored");
    setState(r.value);
    if (why) setNotice(why);
  }, []);

  // 처음 열 때
  useEffect(() => {
    load(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다른 창에서 바뀌면 새로 불러온다 (고치는 중이면 쓰던 항목은 지키고 알리기만)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      if (modeRef.current === "memory") return;
      const day = deviceToday();
      if (editingRef.current) {
        const r = readStored(browserStore(), day);
        if (r.status !== "ok" || !baseItems.current || !sameItems(r.value.items, baseItems.current)) setNotice("changed-while-editing");
        if (r.status === "ok") setState(r.value);
        return;
      }
      load(day, "changed-elsewhere");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  // 날이 바뀌면 체크를 비운다 (화면을 켜 둔 채 자정이 지나거나, 다음 날 다시 볼 때)
  useEffect(() => {
    const check = () => {
      const day = deviceToday();
      setToday((prev) => {
        if (prev === day) return prev;
        if (modeRef.current === "memory") setState((s) => (s ? rollover(s, day) : s));
        else load(day);
        return day;
      });
    };
    const timer = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [load]);

  async function apply(change: (s: Stored) => Stored, after: Notice = null): Promise<boolean> {
    const day = deviceToday();
    if (day !== today) setToday(day);
    if (mode === "memory") {
      setState((s) => change(s ? rollover(s, day) : defaultStored(day)));
      if (after) setNotice(after);
      return true;
    }
    setWorking(true);
    try {
      const r = await withLock(browserLocks(), () => update(browserStore(), day, change));
      if (r.status === "busy") {
        setNotice("busy");
        return false;
      }
      const w = r.value;
      if (w.status === "saved") {
        setState(w.value);
        setNotice(after);
        return true;
      }
      if (w.status === "broken") {
        setBroken(true);
        setState(null);
        return false;
      }
      // 저장 실패: 이번 화면에서만 계속 쓴다 (지금 누른 것도 반영)
      setMode("memory");
      setState((s) => change(s ? rollover(s, day) : defaultStored(day)));
      setNotice("write-failed");
      return true;
    } finally {
      setWorking(false);
    }
  }

  function toggle(id: string, on: boolean) {
    if (working) return;
    void apply((s) => setDone(s, id, on, deviceToday()));
  }

  function startEdit() {
    if (!state) return;
    baseItems.current = state.items.map((i) => ({ ...i }));
    setDraft(state.items.map((i) => ({ ...i })));
    setNotice(null);
    setConfirmClear(false);
  }

  function endEdit() {
    setDraft(null);
    baseItems.current = null;
    requestAnimationFrame(() => editRef.current?.focus());
  }

  async function saveEdit() {
    if (!draft) return;
    const items = draft.map((d) => ({ id: d.id, label: cleanLabel(d.label) })).filter((d) => d.label);
    const ok = await apply((s) => replaceItems(s, items, deviceToday()), "saved-items");
    if (ok) endEdit();
  }

  function resetBroken() {
    if (clearAll(browserStore())) {
      load(deviceToday(), "cleared");
    } else {
      setBroken(false);
      setMode("memory");
      setState(defaultStored(deviceToday()));
      setNotice("write-failed");
    }
  }

  async function doClear() {
    setConfirmClear(false);
    if (mode === "memory") {
      setState(defaultStored(deviceToday()));
      setNotice("cleared");
      endEdit();
      return;
    }
    const r = await withLock(browserLocks(), () => clearAll(browserStore()));
    if (r.status === "busy") {
      setNotice("busy");
      return;
    }
    if (!r.value) {
      setNotice("write-failed");
      return;
    }
    endEdit();
    load(deviceToday(), "cleared");
  }

  const done = new Set(state?.checks.date === today ? state.checks.done : []);

  return (
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <div className="space-y-2">
        <span className="eyebrow">TODAY, JUST THIS</span>
        <h1 className="text-2xl leading-snug font-bold">오늘 최소한</h1>
        <p className="text-muted">할 수 있는 것만 눌러요. 누르지 않은 건 따로 표시하지 않아요. 내일이 되면 비워져요.</p>
      </div>

      <div aria-live="polite">
        {notice && (
          <p
            role="status"
            className={`rounded p-3 ${notice === "write-failed" || notice === "unavailable" || notice === "busy" || notice === "changed-while-editing" ? "bg-warn-soft text-warn" : "bg-tint-sky"}`}
          >
            {NOTICE_TEXT[notice]}
          </p>
        )}
      </div>

      {broken && (
        <div role="alert" className="space-y-3 rounded bg-warn-soft p-4 text-warn">
          <p>이 기기에 저장된 내용을 읽을 수 없어서 쓰지 않았어요.</p>
          <button type="button" onClick={resetBroken} className={`min-h-12 rounded border border-warn bg-surface px-4 font-bold ${focusRing}`}>
            기본 항목으로 다시 시작하기
          </button>
        </div>
      )}

      {state && !draft && (
        <section aria-labelledby={ids.list} className="space-y-3">
          <h2 id={ids.list} className="sr-only">
            오늘 할 수 있는 것
          </h2>
          {state.items.length === 0 ? (
            <p className="rounded border border-dashed border-line p-5 text-muted">항목이 없어요. 아래 ‘항목 고치기’에서 더할 수 있어요.</p>
          ) : (
            <ul className="space-y-3">
              {state.items.map((it) => {
                const on = done.has(it.id);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(it.id, !on)}
                      className={`flex min-h-20 w-full items-center justify-between gap-3 rounded-2xl border-2 px-5 text-left text-xl ${on ? "pastel-fill border-transparent font-bold" : "border-line bg-surface"} ${focusRing}`}
                    >
                      <span className="min-w-0">{it.label}</span>
                      <span aria-hidden="true" className="shrink-0 text-base">
                        {on ? "✓ 했어요" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-sm text-muted">
            잘못 눌렀으면 한 번 더 누르면 돼요. 이 기기(브라우저)에만 저장돼요. 같은 기기를 쓰는 사람은 볼 수 있어요.
          </p>
          <button
            ref={editRef}
            type="button"
            onClick={startEdit}
            className={`min-h-11 rounded border border-line px-4 ${focusRing}`}
          >
            항목 고치기
          </button>
        </section>
      )}

      {state && draft && (
        <section aria-labelledby={ids.edit} className="space-y-4">
          <h2 id={ids.edit} className="text-lg font-bold">
            항목 고치기
          </h2>
          <p className="text-muted">이름을 바꾸거나 빼고, {ITEMS_MAX}개까지 더할 수 있어요. 빈 칸은 저장할 때 빠져요.</p>
          <ul className="space-y-2">
            {draft.map((d, i) => (
              <li key={d.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={d.label}
                  maxLength={LABEL_MAX}
                  aria-label={`항목 ${i + 1}`}
                  autoComplete="off"
                  onChange={(e) => setDraft(draft.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)))}
                  className={`min-h-12 min-w-0 flex-1 rounded border border-line bg-surface px-3 ${focusRing}`}
                />
                <button
                  type="button"
                  aria-label={`항목 ${i + 1} 빼기`}
                  onClick={() => setDraft(draft.filter((x) => x.id !== d.id))}
                  className={`min-h-12 shrink-0 rounded border border-line px-3 ${focusRing}`}
                >
                  빼기
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {draft.length < ITEMS_MAX && (
              <button
                type="button"
                onClick={() => setDraft([...draft, { id: newItemId(draft, randomId), label: "" }])}
                className={`min-h-11 rounded border border-line px-4 ${focusRing}`}
              >
                항목 더하기
              </button>
            )}
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_ITEMS.map((x) => ({ ...x })))}
              className={`min-h-11 rounded border border-line px-4 ${focusRing}`}
            >
              기본 항목으로
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={working}
              onClick={() => void saveEdit()}
              className={`min-h-12 rounded bg-accent px-5 font-bold text-accent-fg disabled:opacity-50 ${focusRing}`}
            >
              저장하기
            </button>
            <button type="button" onClick={endEdit} className={`min-h-12 rounded border border-line px-5 ${focusRing}`}>
              취소
            </button>
          </div>

          <div className="border-t border-line pt-4">
            {!confirmClear ? (
              <button
                ref={clearRef}
                type="button"
                onClick={() => {
                  setConfirmClear(true);
                  requestAnimationFrame(() => cancelClearRef.current?.focus());
                }}
                className={`min-h-11 rounded border border-line px-4 ${focusRing}`}
              >
                이 기기에서 모두 지우기
              </button>
            ) : (
              <div role="group" aria-label="모두 지우기 확인" className="space-y-2 rounded bg-warn-soft p-3">
                <p className="text-warn">항목과 오늘 체크를 이 기기에서 지울까요? 기본 항목으로 돌아가요.</p>
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
                  <button type="button" onClick={() => void doClear()} className={`min-h-11 rounded border border-warn px-4 font-bold text-warn ${focusRing}`}>
                    지우기
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
