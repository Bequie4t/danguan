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
  normalize,
  parseStored,
  readRaw,
  snapshot,
  withCardLock,
  browserLocks,
  LOCK_TIMEOUT_MS,
  type LockManagerLike,
  saveCard,
  STORAGE_KEY,
  urlProblem,
  type Food,
  type HardDayCard as Card,
  type KeyValueStore,
  type Snapshot,
} from "@/lib/hardday/card";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const bigButton = `flex min-h-14 w-full items-center justify-center rounded-full px-5 text-lg font-semibold ${focusRing}`;

type Draft = { foods: Food[]; people: string[]; message: string };
/** unknown: 지우기 뒤 저장 상태를 확인하지 못함 — 이전 카드를 숨기고 '저장 상태 다시 확인'만 제공 */
type Phase = "loading" | "edit" | "view" | "unknown";
type Notice =
  | null
  | "saved"
  | "save-failed"
  | "conflict-removed"
  | "conflict-changed"
  | "cleared"
  | "clear-conflict"
  | "clear-failed"
  | "broken"
  | "unavailable"
  | "removed-elsewhere"
  | "removed-elsewhere-kept"
  | "changed-elsewhere"
  | "changed-while-editing"
  | "preview-removed"
  | "save-unknown"
  | "clear-unknown"
  | "clear-not-done"
  | "sync-unknown"
  | "sync-unknown-kept"
  | "sync-same"
  | "changed-after-save"
  | "save-cancelled"
  | "clear-cancelled"
  | "lock-busy"
  | "lock-unsupported";

/** 사용자가 실제로 입력한 값 그대로 비교 (정리한 값이 아니라 — 'https://'만 쓴 칸도 바뀐 것으로) */
function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function emptyDraft(): Draft {
  const e = emptyCard();
  return { foods: e.foods, people: e.people, message: e.message };
}

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

/** 충돌 때 지금 저장돼 있는 카드를 보여 준다 (초안을 버리지 않고 비교할 수 있게) */
function ConflictPreview({ raw }: { raw: string | null }) {
  if (raw === null) {
    return <p className="rounded border border-line bg-surface p-3 text-sm">지금 이 브라우저에 저장된 카드는 없어요 (다른 창에서 지웠어요).</p>;
  }
  const r = parseStored(raw);
  if (r.status !== "ok") {
    return <p className="rounded border border-line bg-surface p-3 text-sm">지금 저장된 카드는 읽을 수 없는 상태예요.</p>;
  }
  const c = r.card;
  return (
    <div data-conflict-preview className="space-y-1 rounded border border-line bg-surface p-3 text-sm">
      <p className="font-semibold">지금 저장돼 있는 카드 (다른 창에서 바뀐 내용)</p>
      <p>먹을 것: {c.foods.length ? c.foods.map((f) => f.name || "이름 없음").join(", ") : "없음"}</p>
      <p>부탁할 사람: {c.people.length ? c.people.join(", ") : "없음"}</p>
      <p>부탁 문장: {c.message || "없음"}</p>
    </div>
  );
}

export default function HardDayCard() {
  const store = useRef<KeyValueStore | null>(null);
  /**
   * 이 화면이 보고 있는 저장 카드의 원본 (없으면 null). 저장소를 한 번 읽은 같은 값으로 화면과 함께 정한다.
   * 저장·지우기 직전에 지금 값과 비교해, 그사이 다른 창(탭)의 삭제·변경을 덮어쓰지 않는다.
   */
  const baseRaw = useRef<string | null>(null);
  /** 이 화면이 아는 저장 카드 (임시 카드와 따로 둔다) */
  const stored = useRef<Card | null>(null);
  const [available, setAvailable] = useState(true);
  const [phase, setPhase] = useState<Phase>("loading");
  /** 보기 화면에 보이는 카드: 저장 카드 또는 '이번에만 보기' 카드 */
  const [saved, setSaved] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [notice, setNotice] = useState<Notice>(null);
  /** 지우기 확인을 연 카드의 원본. 지우기는 이 버전에만 적용된다. null이면 확인을 열지 않음 */
  const [confirmRaw, setConfirmRaw] = useState<string | null>(null);
  /** 저장이 충돌로 멈췄을 때, 그 순간 저장소 값. '그래도 저장'은 이 버전을 덮어쓰는 데에만 동의한 것 */
  const [conflict, setConflict] = useState<{ currentRaw: string | null } | null>(null);
  /** '저장하지 않고 이번에만 보기'로 연 카드 (저장소에 없음) */
  const [temporary, setTemporary] = useState(false);
  /** stale: 복사하는 사이 카드 문장이 바뀜 (누른 문장과 지금 문장이 다름) */
  const [copied, setCopied] = useState<{ result: "copied" | "failed" | "stale"; text: string } | null>(null);
  /** 잠금을 기다리며 저장·지우는 중 (버튼을 잠시 끈다) */
  /** 잠금을 기다리며 저장·지우는 중. 이때는 입력·화면 전환을 잠시 막고 '취소'만 받는다 */
  const [busy, setBusy] = useState<null | "save" | "clear">(null);
  /** 기다리는 요청을 철회하는 신호 (취소하면 잠금을 얻어도 실행하지 않음) */
  const pending = useRef<AbortController | null>(null);
  // 키보드 초점: 기다리는 동안 '취소'로 옮기고, 끝나면 원래 자리로 돌려준다
  const cancelSaveRef = useRef<HTMLButtonElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const deleteOpenRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<(() => void) | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const conflictRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const recheckRef = useRef<HTMLButtonElement>(null);
  /** 지우려던 카드의 원본 (다시 확인할 때 '아직 남음'과 '다른 창이 바꿈'을 구분) */
  const clearTarget = useRef<string | null>(null);
  /** 다시 확인 화면에 온 이유: 지우기 뒤(clear) 또는 다른 창의 변경을 읽지 못함(sync) */
  const recheckReason = useRef<"clear" | "sync">("clear");
  /** 클립보드 쓰기는 한 번에 하나만 (겹치면 붙여넣을 값이 안내와 달라질 수 있음) */
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  /** 가장 최근 복사 요청 번호. 늦게 끝난 이전 요청은 안내를 바꾸지 않는다 */
  const copySeq = useRef(0);
  /** 지금 보기 화면에 보이는 부탁 문장 (복사 중 바뀌었는지 확인) */
  const shownMessage = useRef("");
  const [hostname, setHostname] = useState("");
  /** 탭 사이 잠금을 쓸 수 있는지. 없으면 저장·지우기를 하지 않는다 */
  const [lockable, setLockable] = useState(true);
  const locks = useRef<LockManagerLike | null>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const live = useRef({
    phase: "loading" as Phase,
    temporary: false,
    draft: emptyDraft(),
    conflictRaw: undefined as string | null | undefined,
  });
  const uid = useId();
  live.current = { phase, temporary, draft, conflictRaw: conflict ? conflict.currentRaw : undefined };
  const confirmClear = confirmRaw !== null;
  // 보기 화면에 보이는 문장 (보기가 아니면 없음) — 복사 중 카드가 바뀌거나 지워졌는지 확인하는 데 쓴다
  shownMessage.current = phase === "view" && saved ? saved.message : "";

  /** 저장소를 한 번 읽은 값으로 화면을 맞춘다 (처음 열 때·다시 불러올 때) */
  function applySnapshot(snap: Snapshot, fallbackNotice: Notice = null) {
    baseRaw.current = snap.raw;
    setConflict(null);
    setConfirmRaw(null);
    setTemporary(false);
    setCopied(null);
    const r = snap.result;
    if (r.status === "ok") {
      stored.current = r.card;
      setSaved(r.card);
      setDraft(fromCard(r.card));
      setNotice(fallbackNotice);
      setPhase("view");
      return;
    }
    stored.current = null;
    setSaved(null);
    setDraft(emptyDraft());
    if (r.status === "unavailable") {
      setAvailable(false);
      setNotice("unavailable");
    } else setNotice(r.status === "broken" ? "broken" : fallbackNotice);
    setPhase("edit");
  }

  // 처음 열 때 이 기기에 저장된 카드를 읽는다 (서버 렌더링 때는 읽지 않음). 읽기·저장·지우기는 따로 다룬다.
  useEffect(() => {
    store.current = browserStore();
    locks.current = browserLocks();
    setHostname(window.location.host);
    setLockable(locks.current !== null);
    applySnapshot(snapshot(store.current));

    // 다른 창(탭)에서 지우거나 바꾸면 바로 반영한다. 지운 저장 카드는 되살리지 않고, 따로 적던 내용은 지킨다.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      const now = readRaw(store.current); // 한 번만 읽은 값으로 판단
      if (now === undefined) {
        // 다른 창의 변경 알림을 받았는데 지금 값을 읽지 못함: 이전 카드를 지금 상태처럼 두지 않는다
        const { phase: ph0, temporary: temp0, draft: d0 } = live.current;
        setConfirmRaw(null);
        setConflict(null);
        // 저장 카드를 보는 중이거나, 편집만 열고 고치지 않은 상태(입력칸 = 저장 카드)면 이전 카드를 숨기고 다시 확인
        const untouchedEdit = ph0 === "edit" && !temp0 && !!stored.current && sameDraft(d0, fromCard(stored.current));
        if ((ph0 === "view" && !temp0) || untouchedEdit) {
          const focusInside = document.activeElement !== document.body;
          showClearUnknown("sync", "sync-unknown");
          if (focusInside) requestAnimationFrame(() => recheckRef.current?.focus());
        } else {
          stored.current = null; // '돌아가기'로 이전 카드를 다시 보여 주지 않게
          setNotice("sync-unknown-kept");
        }
        return;
      }
      // 충돌 미리보기에 보여 주던 카드는 편집 시작 때의 카드와 따로 비교한다
      // (처음에 카드가 없던 탭에서도, 미리보기의 카드가 지워지거나 바뀌면 미리보기·덮어쓰기 확인을 닫는다)
      const previewRaw = live.current.conflictRaw;
      // 비교 안내가 닫힐 때 그 안에 초점이 있었다면 상태 안내로 옮긴다 (초점이 본문으로 빠지지 않게)
      const focusWasInConflict = !!conflictRef.current?.contains(document.activeElement);
      if (focusWasInConflict) requestAnimationFrame(() => statusRef.current?.focus());
      if (previewRaw !== undefined && now !== previewRaw) {
        setConflict(null);
        setNotice(now === null ? "preview-removed" : "changed-while-editing");
      }
      if (now === baseRaw.current) return;
      setConfirmRaw(null); // 확인하던 카드가 바뀌었으니 지우기 확인은 닫는다
      setConflict(null); // 이전 버전에 대한 덮어쓰기 확인·미리보기는 더 이상 맞지 않는다 (저장하면 새로 확인)
      const { phase: ph, temporary: temp, draft: d } = live.current;
      const viewingStored = ph === "view" && !temp;
      const next = parseStored(now);
      if (viewingStored) {
        // 저장 카드를 보는 중: 새 상태로 바꾼다 (지워졌으면 비움)
        applySnapshot({ result: next, raw: now }, now === null ? "removed-elsewhere" : next.status === "ok" ? "changed-elsewhere" : null);
        return;
      }
      if (now === null && ph === "edit" && !temp && stored.current && sameDraft(d, fromCard(stored.current))) {
        // 지워진 카드를 고치지 않고 열어 둔 상태: 지운 내용이 남지 않게 비운다
        applySnapshot({ result: { status: "empty" }, raw: null }, "removed-elsewhere");
        return;
      }
      // 따로 적던 내용·'이번에만 보기' 카드는 지킨다. 비교 기준은 그대로 두어, 저장하려면 다시 확인받는다.
      if (now === null) stored.current = null;
      setNotice(now === null ? "removed-elsewhere-kept" : "changed-while-editing");
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      // 카드 화면을 떠나면 기다리던 저장·지우기도 철회한다 (떠난 뒤 잠금이 풀려도 실행하지 않음)
      pending.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 기다리기 시작하면 '취소'로 초점을 옮기고, 끝나면(취소·시간 초과·실패) 원래 자리로 돌려준다
  useEffect(() => {
    if (busy === "save") cancelSaveRef.current?.focus();
    else if (busy === "clear") cancelClearRef.current?.focus();
    else if (restoreFocus.current) {
      const back = restoreFocus.current;
      restoreFocus.current = null;
      back();
    }
  }, [busy]);

  const problems = draft.foods.map((f) => urlProblem(f.url));
  const valid = hasContent(draft) && problems.every((p) => p === null);
  const canSave = available && lockable && valid && !busy;

  /** overwrite: 충돌 경고를 본 뒤 '그래도 저장' — 경고를 띄운 그 버전에만 적용된다 */
  async function save(overwrite = false) {
    if (!canSave) return;
    const card = normalize(draft, new Date());
    const expected = overwrite && conflict ? conflict.currentRaw : baseRaw.current;
    const ctrl = new AbortController();
    pending.current = ctrl;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backToFrom = () => {
      if (from && from.isConnected && !(from as HTMLButtonElement).disabled) from.focus();
    };
    restoreFocus.current = backToFrom;
    setBusy("save");
    // 잠금 안에서 다시 읽어 비교한 뒤 쓴다 (다른 탭의 저장·지우기가 끼어들지 못함). 기다리는 동안 취소할 수 있다.
    const locked = await withCardLock(locks.current, () => saveCard(store.current, card, expected), LOCK_TIMEOUT_MS, ctrl.signal);
    pending.current = null;
    if (locked.status !== "done") {
      setNotice(locked.status === "cancelled" ? "save-cancelled" : locked.status === "busy" ? "lock-busy" : "lock-unsupported");
      setBusy(null);
      return;
    }
    const r = locked.value;
    // 결과는 잠금 안에서 읽은 값이다. 화면에 반영하기 직전에 지금 저장값을 다시 확인해, 그사이 다른 탭이 바꾼
    // (그리고 이 화면이 이미 처리했을 수 있는) 상태를 늦게 온 결과로 덮지 않는다. 적던 내용은 그대로 둔다.
    const now = readRaw(store.current);
    if (now === undefined && r.status !== "failed") {
      // 지금 저장 상태를 읽지 못함: 늦게 온 결과(성공 화면·이전 미리보기)를 지금 상태처럼 보여 주지 않는다. 초안은 남긴다.
      // 방금 쓴 값을 기준으로 두어, 다시 저장할 때 내가 저장한 카드와 충돌하지 않게 한다.
      if (r.status === "saved" || r.status === "unverified") baseRaw.current = r.raw;
      stored.current = null;
      setConflict(null);
      setNotice("save-unknown");
      restoreFocus.current = () => statusRef.current?.focus();
      setBusy(null);
      return;
    }
    if (r.status === "saved" || r.status === "unverified") {
      // unverified(확인 읽기만 실패)도 여기서 다시 읽은 값이 방금 쓴 값과 정확히 같으면 저장된 것으로 본다
      if (now !== undefined && now !== r.raw) {
        baseRaw.current = r.raw; // 내가 저장한 버전 기준 → 다시 저장하려면 지금 상태로 확인받는다
        stored.current = now === null ? null : (() => { const p = parseStored(now); return p.status === "ok" ? p.card : null; })();
        setConflict(null);
        // 확인 읽기를 못 했던 저장이면 '저장 뒤 바뀜'이라고 단정하지 않는다
        setNotice(r.status === "unverified" ? "save-unknown" : "changed-after-save");
        restoreFocus.current = () => titleRef.current?.focus();
      } else {
        baseRaw.current = r.raw;
        stored.current = card;
        setConflict(null);
        setSaved(card);
        setTemporary(false);
        setDraft(fromCard(card));
        setNotice("saved");
        setCopied(null);
        setPhase("view");
        restoreFocus.current = () => titleRef.current?.focus(); // 저장 버튼이 사라지므로 카드 제목으로
      }
    } else if (r.status === "conflict") {
      const current = now as string | null; // 늦게 온 결과 대신 지금 값을 보여 준다 (읽지 못한 경우는 위에서 처리)
      if (current === expected) {
        // 그사이 원래대로 돌아옴(예: 미리보기 카드가 지워짐): 경고할 것이 없다. 다시 누르면 저장된다.
        setConflict(null);
        setNotice(current === null ? "preview-removed" : "changed-while-editing");
        restoreFocus.current = backToFrom;
      } else {
        setConflict({ currentRaw: current }); // 또 바뀌었으면 새 버전으로 다시 묻는다
        setNotice(current === null ? "conflict-removed" : "conflict-changed");
        restoreFocus.current = () => conflictRef.current?.focus(); // 비교 안내로
      }
    } else {
      setNotice("save-failed"); // 입력은 그대로 둔다
    }
    setBusy(null);
  }

  /** 지우기 뒤 지금 상태를 읽지 못함: 이전 카드를 숨기고 다시 확인하게 한다 */
  function showClearUnknown(reason: "clear" | "sync" = "clear", why: Notice = "clear-unknown") {
    recheckReason.current = reason;
    if (reason === "sync") clearTarget.current = baseRaw.current; // 보고 있던 카드
    stored.current = null;
    baseRaw.current = null;
    setSaved(null);
    setConfirmRaw(null);
    setConflict(null);
    setTemporary(false);
    setCopied(null);
    setDraft(emptyDraft());
    setPhase("unknown");
    setNotice(why);
    restoreFocus.current = () => recheckRef.current?.focus();
  }

  /** '저장 상태 다시 확인': 저장소를 한 번 읽은 값으로 화면과 안내를 함께 정한다. 못 읽으면 이 화면(버튼)을 그대로 둔다 */
  function recheck() {
    const snap = snapshot(store.current);
    if (snap.result.status === "unavailable") {
      setNotice(recheckReason.current === "sync" ? "sync-unknown" : "clear-unknown");
      requestAnimationFrame(() => (statusRef.current ?? recheckRef.current)?.focus());
      return;
    }
    // 비었으면 지운 것 → 새 카드 입력, 지우려던 그 카드면 아직 남은 것, 다른 카드면 다른 창이 바꾼 것
    const sync = recheckReason.current === "sync";
    const notice: Notice =
      snap.raw === null
        ? sync ? "removed-elsewhere" : "cleared"
        : snap.raw === clearTarget.current
          ? sync ? "sync-same" : "clear-not-done"
          : "changed-elsewhere";
    applySnapshot(snap, notice);
    requestAnimationFrame(() => (snap.raw === null ? statusRef.current : titleRef.current)?.focus());
  }

  function viewWithoutSaving() {
    if (!valid) return;
    setSaved(normalize(draft, new Date()));
    setTemporary(true);
    setConflict(null);
    setCopied(null);
    setNotice(null);
    setPhase("view");
  }

  function reloadStored() {
    applySnapshot(snapshot(store.current));
  }

  /** 고치지 않고 돌아가기: 저장 카드를 고치던 중이면 지금 저장소를 다시 읽고, 임시 카드면 임시 보기로 */
  function cancelEdit() {
    if (temporary && saved) {
      setDraft(fromCard(saved));
      setConflict(null);
      setNotice(null);
      setPhase("view");
      return;
    }
    applySnapshot(snapshot(store.current));
  }

  async function clear() {
    if (confirmRaw === null || busy) return;
    const expected = confirmRaw;
    const ctrl = new AbortController();
    pending.current = ctrl;
    restoreFocus.current = () => deleteOpenRef.current?.focus();
    setBusy("clear");
    const locked = await withCardLock(locks.current, () => clearCard(store.current, expected), LOCK_TIMEOUT_MS, ctrl.signal);
    pending.current = null;
    if (locked.status !== "done") {
      setConfirmRaw(null);
      setNotice(locked.status === "cancelled" ? "clear-cancelled" : locked.status === "busy" ? "lock-busy" : "lock-unsupported");
      setBusy(null);
      return;
    }
    const r = locked.value;
    // 지우기 결과와 상관없이 지금 상태를 '한 번' 읽어, 그 같은 값으로 화면과 안내를 함께 정한다
    // (지우기는 됐는데 확인 읽기만 실패한 경우에도 지운 카드를 계속 보여 주지 않게)
    const snap = snapshot(store.current);
    if (snap.result.status === "unavailable") {
      clearTarget.current = expected;
      showClearUnknown();
      setBusy(null);
      return;
    }
    if (r.status === "failed" && snap.raw === expected) {
      setConfirmRaw(null);
      setNotice("clear-failed"); // 카드가 그대로 남아 있음
      setBusy(null);
      return;
    }
    // 비었으면 지운 것, 확인한 카드가 아닌 다른 카드가 있으면 다른 창이 바꾼 것
    const notice: Notice = snap.raw === null ? "cleared" : r.status === "conflict" ? "clear-conflict" : "changed-elsewhere";
    applySnapshot(snap, notice);
    restoreFocus.current = () => (snap.raw === null ? statusRef.current : deleteOpenRef.current ?? titleRef.current)?.focus();
    setBusy(null);
  }

  async function copy(text: string) {
    if (!canSend(text) || copyingRef.current) return; // 진행 중인 복사가 끝나기 전에는 새로 쓰지 않는다
    copyingRef.current = true;
    setCopying(true);
    try {
      await copyOnce(text);
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  }

  async function copyOnce(text: string) {
    const seq = ++copySeq.current;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // 그사이 더 최근 복사 요청이 있었으면, 이 늦은 결과로 안내를 바꾸지 않는다
    if (seq !== copySeq.current) return;
    // 기다리는 사이 화면의 문장이 바뀌었으면(다른 탭에서 카드 변경) 대체 복사로 새 문장을 복사하지 않는다
    if (shownMessage.current !== text) {
      setCopied({ result: "stale", text: shownMessage.current });
      return;
    }
    if (!ok && msgRef.current && msgRef.current.value === text) {
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
    "save-failed": "저장하지 못했어요 (저장 공간 부족 등). 적은 내용은 그대로 있어요. 아래 ‘저장하지 않고 이번에만 보기’로 쓸 수 있어요.",
    "conflict-removed": "다른 창에서 저장된 카드를 지웠어요. 그래서 저장하지 않았어요. 적은 내용은 그대로 있어요.",
    "conflict-changed": "다른 창에서 저장된 카드를 바꿨어요. 그래서 저장하지 않았어요. 적은 내용은 그대로 있어요.",
    cleared: "이 기기에서 카드를 지웠어요.",
    "clear-conflict": "다른 창에서 카드가 바뀌어서 지우지 않았어요. 바뀐 카드를 확인하고, 지우려면 다시 눌러 주세요.",
    "clear-failed": "지우지 못했어요. 브라우저 설정에서 이 사이트 데이터를 지울 수도 있어요.",
    broken: "저장된 카드를 읽을 수 없어서 쓰지 않았어요. 새로 적어 저장하면 바뀌어요.",
    unavailable: "이 브라우저에서는 저장할 수 없어요 (사생활 보호 모드 등). ‘저장하지 않고 이번에만 보기’로 쓸 수 있어요.",
    "removed-elsewhere": "다른 창에서 이 카드를 지웠어요. 이 화면에서도 지웠어요.",
    "removed-elsewhere-kept": "다른 창에서 저장된 카드를 지웠어요. 이 화면에 따로 적은 내용은 그대로 있어요. 저장하려면 한 번 더 확인해요.",
    "changed-elsewhere": "다른 창에서 카드를 고쳐서 새 내용으로 바꿨어요.",
    "changed-while-editing": "다른 창에서 카드가 바뀌었어요. 지금 적은 내용은 그대로 있고, 저장할 때 다시 확인해요.",
    "preview-removed": "다른 창에서 미리보기의 카드를 지웠어요. 적은 내용은 그대로 있어요. 저장하면 다시 확인해요.",
    "save-unknown": "저장됐는지 확인하지 못했어요. 적은 내용은 이 화면에 남아 있어요. 화면을 닫지 말고, 잠시 뒤 ‘이 기기에 저장하기’를 다시 눌러 주세요.",
    "clear-unknown": "카드가 지워졌는지 확인하지 못했어요. 이전 카드는 화면에서 숨겼어요. 잠시 뒤 저장 상태를 다시 확인해 주세요.",
    "sync-unknown": "다른 창에서 카드가 바뀐 것 같은데 확인하지 못했어요. 이전 카드는 화면에서 숨겼어요. 잠시 뒤 저장 상태를 다시 확인해 주세요.",
    "sync-unknown-kept": "다른 창에서 카드가 바뀐 것 같은데 확인하지 못했어요. 적은 내용은 그대로 있고, 저장할 때 다시 확인해요.",
    "sync-same": "확인했어요. 카드는 그대로예요.",
    "clear-not-done": "카드가 아직 이 브라우저에 남아 있어요. 지우려면 ‘이 기기에서 지우기’를 다시 눌러 주세요.",
    "changed-after-save": "저장했지만 바로 뒤 다른 창에서 카드를 바꾸거나 지웠어요. 적은 내용은 그대로 있고, 다시 저장하려면 확인해요.",
    "save-cancelled": "저장을 취소했어요. 적은 내용은 그대로 있어요.",
    "clear-cancelled": "지우기를 취소했어요. 카드는 그대로 있어요.",
    "lock-busy": "다른 창에서 카드를 저장하거나 지우는 중이에요. 적은 내용은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.",
    "lock-unsupported": "이 브라우저에서는 여러 창 사이에 안전하게 저장할 수 없어요. 저장된 카드는 볼 수 있고, ‘저장하지 않고 이번에만 보기’로 쓸 수 있어요.",
  };

  const header = (
    <div className="space-y-2">
      <span className="eyebrow">HARD DAY CARD</span>
      <h1 ref={titleRef} tabIndex={-1} className="text-2xl leading-snug font-bold focus:outline-none focus-visible:outline-2">
        힘든 날 카드
      </h1>
      <p className="text-muted">괜찮은 날 미리 적어 두면, 힘든 날 생각하지 않고 꺼내 쓸 수 있어요.</p>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="min-h-6 font-semibold focus:outline-none focus-visible:outline-2">
        {notice && noticeText[notice]}
      </p>
    </div>
  );

  if (phase === "loading") return <div className="space-y-6">{header}</div>;

  if (phase === "unknown") {
    return (
      <div className="space-y-6">
        {header}
        <button
          ref={recheckRef}
          type="button"
          onClick={recheck}
          className={`pastel-fill ${bigButton}`}
        >
          저장 상태 다시 확인
        </button>
      </div>
    );
  }

  if (phase === "edit") {
    return (
      <div className="space-y-8 [overflow-wrap:anywhere]">
        {header}
        <form
          className="space-y-7"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* 잠금을 기다리는 동안 입력·화면 전환을 잠시 막는다 (기다리던 저장이 바뀐 입력과 어긋나지 않게) */}
          <fieldset disabled={busy !== null} className="min-w-0 space-y-7 border-0 p-0">
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
              <a
                href="/ask"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex min-h-11 items-center underline underline-offset-4 ${focusRing}`}
              >
                부탁하기 (새 탭에서 열려요)
              </a>
              에서 만들어 붙여 넣어도 돼요. 이 화면에 적던 내용은 그대로 있어요.
            </p>
          </div>

          <div className="space-y-3 rounded bg-tint-sky p-4">
            <p className="text-sm">
              <strong>이 카드는 이 브라우저에 저장돼요.</strong> 로그아웃해도 남고, 같은 브라우저를 쓰는 사람은 로그인 없이 볼 수
              있어요. 함께 쓰는 기기라면 ‘저장하지 않고 이번에만 보기’를 골라 주세요. 서버나 계정에는 올리지 않아요.
            </p>
            {conflict ? (
              <div ref={conflictRef} tabIndex={-1} role="group" aria-label="다른 창의 변경 — 저장하지 않았어요" className={`space-y-2 ${focusRing}`}>
                <ConflictPreview raw={conflict.currentRaw} />
                <button type="button" onClick={() => void save(true)} disabled={!canSave} className={`pastel-fill ${bigButton} disabled:opacity-50`}>
                  {conflict.currentRaw === null ? "그래도 지금 적은 내용으로 새로 저장하기" : "그래도 지금 적은 내용으로 바꾸기"}
                </button>
                <button type="button" onClick={reloadStored} className={`min-h-11 w-full rounded-full border border-fg px-4 font-semibold ${focusRing}`}>
                  {conflict.currentRaw === null ? "적은 내용 버리고 처음부터" : "다른 창에서 바꾼 카드 불러오기 (적은 내용은 사라져요)"}
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={!canSave}
                className={`pastel-fill ${bigButton} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {busy === "save" ? "저장하는 중…" : "이 기기에 저장하기"}
              </button>
            )}
            {!available && <p className="text-sm">이 브라우저에서는 저장할 수 없어요.</p>}
            {available && !lockable && <p className="text-sm">이 브라우저에서는 여러 창 사이에 안전하게 저장할 수 없어 저장을 막았어요.</p>}
            {!hasContent(draft) && <p className="text-sm">하나라도 적으면 저장하거나 볼 수 있어요.</p>}
            <button
              type="button"
              disabled={!valid}
              onClick={viewWithoutSaving}
              className={`min-h-11 w-full rounded-full border border-fg px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            >
              저장하지 않고 이번에만 보기
            </button>
            {(temporary ? saved !== null : stored.current !== null) && (
              <button
                type="button"
                onClick={cancelEdit}
                className={`min-h-11 w-full rounded-full border border-line px-4 ${focusRing}`}
              >
                고치지 않고 카드로 돌아가기
              </button>
            )}
          </div>
          </fieldset>
          {busy === "save" && (
            <div className="space-y-2 rounded border border-fg p-3">
              <p role="status" className="text-sm font-semibold">
                다른 창이 카드를 저장하거나 지우는 중이라 기다리고 있어요 (최대 5초). 그동안 입력은 잠시 멈춰요.
              </p>
              <button
                type="button"
                ref={cancelSaveRef}
                onClick={() => pending.current?.abort()}
                className={`min-h-11 w-full rounded-full border border-fg px-4 font-semibold ${focusRing}`}
              >
                저장 취소
              </button>
            </div>
          )}
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
            <button
              type="button"
              onClick={() => void copy(message)}
              disabled={copying}
              aria-busy={copying || undefined}
              className={`pastel-fill ${bigButton} disabled:cursor-progress disabled:opacity-70`}
            >
              {copying ? "복사 중…" : "문장 복사하기"}
            </button>
            <p aria-live="polite" className="min-h-6 text-sm">
              {copiedNow === "copied" && "복사했어요. 메시지 앱이나 카카오톡에 붙여 넣어 직접 보내 주세요."}
              {copiedNow === "failed" && "복사하지 못했어요. 문장을 길게 눌러 직접 복사해 주세요."}
              {copiedNow === "stale" && "복사하는 사이 다른 창에서 카드 문장이 바뀌었어요. 새 문장을 확인하고 다시 눌러 주세요."}
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
          disabled={busy !== null}
          onClick={() => {
            setNotice(null);
            setPhase("edit");
          }}
          className={`min-h-11 rounded-full border border-fg px-5 font-semibold ${focusRing}`}
        >
          카드 고치기
        </button>
        {temporary ? (
          <p className="text-sm text-muted">저장하지 않은 카드예요. 이 화면을 닫거나 새로 열면 다시 적어야 해요.</p>
        ) : (
          <p className="text-sm text-muted">
            {formatSaved(card.savedAt)}에 이 브라우저에 저장했어요. 로그아웃해도 남고, 같은 브라우저를 쓰는 사람은 로그인 없이 볼 수
            있어요. 함께 쓰는 기기라면 지워 주세요.
          </p>
        )}
        {temporary ? null : !confirmClear ? (
          <button
            type="button"
            disabled={!lockable || busy !== null}
            aria-describedby={!lockable ? `${uid}-nolock` : undefined}
            ref={deleteOpenRef}
            onClick={() => {
              setConfirmRaw(baseRaw.current);
              // 이 버튼이 사라지므로 초점을 확인 영역의 '취소'로 옮긴다. 화면 낭독기는 묶음 이름(지울까요? 질문)과 함께 읽고,
              // 실수로 바로 지우지 않도록 되돌리기 쉬운 쪽에 둔다. 취소하면 이 버튼으로 돌아온다.
              requestAnimationFrame(() => cancelClearRef.current?.focus());
            }}
            className={`min-h-11 rounded-full border border-line px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
          >
            이 기기에서 지우기
          </button>
        ) : (
          <div role="group" aria-labelledby={`${uid}-confirm`} className="space-y-2 rounded border border-fg p-3">
            <p id={`${uid}-confirm`} className="font-semibold">
              이 기기에서 카드를 지울까요? 지우면 되돌릴 수 없어요.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void clear()}
                disabled={busy !== null}
                className={`min-h-11 rounded-full bg-fg px-5 font-semibold text-bg disabled:opacity-60 ${focusRing}`}
              >
                {busy === "clear" ? "지우는 중… (다른 창을 기다려요)" : "지우기"}
              </button>
              <button
                type="button"
                ref={cancelClearRef}
                onClick={() => {
                  pending.current?.abort(); // 기다리는 지우기 요청을 철회 — 잠금이 풀려도 지우지 않음
                  setConfirmRaw(null);
                  if (!busy) requestAnimationFrame(() => deleteOpenRef.current?.focus());
                }}
                className={`min-h-11 rounded-full border border-line px-5 ${focusRing}`}
              >
                취소
              </button>
            </div>
          </div>
        )}
        {!temporary && !lockable && (
          <div id={`${uid}-nolock`} className="space-y-2 text-sm">
            <p>
              이 브라우저에서는 여러 창 사이에 안전하게 지울 수 없어 지우기 버튼을 껐어요. 지우려면 브라우저 설정에서{" "}
              <strong>이 사이트{hostname ? ` (${hostname})` : ""}의 데이터만</strong> 골라 지워 주세요. 주소창에 보이는 이 사이트 주소만
              고르면 돼요.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                컴퓨터 크롬: 설정 → 개인 정보 보호 및 보안 → 서드 파티 쿠키 → 모든 사이트 데이터 및 권한 보기 → 이 사이트 주소를 검색해
                삭제 아이콘. (메뉴 이름은 버전에 따라 조금 다를 수 있어요.)
              </li>
              <li>
                아이폰 Safari: 설정 → 앱 → Safari → 고급 → 웹사이트 데이터에서 이 사이트 항목만 지워요.{" "}
                <strong>‘모든 웹사이트 데이터 제거’는 누르지 마세요</strong> (다른 사이트의 정보까지 지워져요).
              </li>
            </ul>
            <p>
              지우면 카드뿐 아니라 이 브라우저의 로그인 상태와 이 사이트 설정도 지워질 수 있어요. 서버에 저장된 계정 기록은 지워지지
              않아요.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
