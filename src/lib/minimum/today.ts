// 오늘 최소한 (PRD B2): 물 마시기·뭐라도 먹기 같은 아주 기본적인 것을 큰 버튼으로 체크한다.
// 저장 위치는 '이 기기'뿐이다. 서버·계정·분석 도구로 보내지 않는다. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 원칙
//  - 한 것만 표시한다. 하지 않은 것은 표시하지 않고, 개수·비율·연속 기록·점수를 만들지 않는다.
//  - 오늘(이 기기 날짜) 체크만 둔다. 지난 날의 체크는 남기지 않는다 (날이 바뀌면 버림).
//  - 체크는 '켜기/끄기 값'으로 저장한다 (뒤집기가 아님). 두 창에서 같은 버튼을 눌러도 결과가 같다.
//  - 항목은 사용자가 고치고 줄이고 더할 수 있다.
//  - 저장된 값은 믿지 않고 다시 검사한다.

export const STORAGE_KEY = "404blue.minimum.v1";
export const LOCK_NAME = "404blue.minimum";
export const ITEMS_MAX = 8;
export const LABEL_MAX = 20;

export interface Item {
  id: string;
  label: string;
}

export interface Stored {
  version: 1;
  items: Item[];
  /** 체크한 날 (이 기기 날짜 YYYY-MM-DD)과 그날 체크한 항목 ID */
  checks: { date: string; done: string[] };
}

export const DEFAULT_ITEMS: ReadonlyArray<Item> = [
  { id: "water", label: "물 마시기" },
  { id: "eat", label: "뭐라도 먹기" },
  { id: "meds", label: "약 먹기" },
  { id: "wash", label: "세수하기" },
];

export function defaultStored(today: string): Stored {
  return { version: 1, items: DEFAULT_ITEMS.map((i) => ({ ...i })), checks: { date: today, done: [] } };
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

export function cleanLabel(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

/** 항목 목록 정리: 이름 없는 칸·잘못된 ID·중복 ID 제거, 개수 제한 */
export function normalizeItems(items: ReadonlyArray<{ id: unknown; label: unknown }>): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of items) {
    if (typeof it.id !== "string" || !ID_RE.test(it.id) || seen.has(it.id)) continue;
    const label = typeof it.label === "string" ? cleanLabel(it.label) : "";
    if (!label) continue;
    seen.add(it.id);
    out.push({ id: it.id, label });
    if (out.length >= ITEMS_MAX) break;
  }
  return out;
}

/** 저장된 문자열을 검사한다. 없으면 기본값, 손상됐으면 broken. */
export function parseStored(raw: string | null, today: string): { status: "ok"; value: Stored } | { status: "broken" } {
  if (raw === null) return { status: "ok", value: defaultStored(today) };
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return { status: "broken" };
  }
  if (!d || typeof d !== "object") return { status: "broken" };
  const o = d as Record<string, unknown>;
  const checks = o.checks as Record<string, unknown> | undefined;
  if (o.version !== 1 || !Array.isArray(o.items) || !checks || typeof checks !== "object" || !Array.isArray(checks.done)) {
    return { status: "broken" };
  }
  const items = normalizeItems((o.items as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object") as { id: unknown; label: unknown }[]);
  return { status: "ok", value: { version: 1, items, checks: todayChecks(items, checks.date, checks.done as unknown[], today) } };
}

/** 오늘 체크만 남긴다: 날짜가 다르면 비우고, 없는 항목 ID는 뺀다 */
function todayChecks(items: Item[], date: unknown, done: unknown[], today: string): Stored["checks"] {
  if (date !== today) return { date: today, done: [] };
  const ids = new Set(items.map((i) => i.id));
  return { date: today, done: [...new Set(done.filter((x): x is string => typeof x === "string" && ids.has(x)))] };
}

/** 하루가 바뀌었으면 체크를 비운 값 (항목은 그대로) */
export function rollover(s: Stored, today: string): Stored {
  return s.checks.date === today ? s : { ...s, checks: { date: today, done: [] } };
}

/** 체크 켜기/끄기 (값으로 정함: 같은 동작을 두 번 해도 결과가 같다) */
export function setDone(s: Stored, id: string, on: boolean, today: string): Stored {
  const base = rollover(s, today);
  if (!base.items.some((i) => i.id === id)) return base;
  const rest = base.checks.done.filter((x) => x !== id);
  return { ...base, checks: { date: today, done: on ? [...rest, id] : rest } };
}

/** 항목 바꾸기. 남아 있는 항목의 오늘 체크는 유지하고, 지운 항목의 체크는 뺀다. */
export function replaceItems(s: Stored, items: ReadonlyArray<Item>, today: string): Stored {
  const next = normalizeItems(items);
  const base = rollover(s, today);
  const ids = new Set(next.map((i) => i.id));
  return { version: 1, items: next, checks: { date: today, done: base.checks.done.filter((x) => ids.has(x)) } };
}

export function sameItems(a: ReadonlyArray<Item>, b: ReadonlyArray<Item>): boolean {
  return JSON.stringify(a.map((i) => [i.id, i.label])) === JSON.stringify(b.map((i) => [i.id, i.label]));
}

/** 새 항목 ID (기존과 겹치지 않게) */
export function newItemId(existing: ReadonlyArray<Item>, rand: () => string): string {
  const ids = new Set(existing.map((i) => i.id));
  for (let n = 0; n < 20; n++) {
    const id = `my-${rand().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || n}`;
    if (!ids.has(id) && ID_RE.test(id)) return id;
  }
  let k = existing.length + 1;
  while (ids.has(`my-${k}`)) k++;
  return `my-${k}`;
}

/** 이 기기 날짜 YYYY-MM-DD */
export function deviceToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── 저장소 ─────────────────────────────────────────────
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export type Read = { status: "ok"; value: Stored; raw: string | null } | { status: "broken"; raw: string } | { status: "unavailable" };

export function readStored(store: KeyValueStore | null, today: string): Read {
  if (!store) return { status: "unavailable" };
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  const p = parseStored(raw, today);
  return p.status === "ok" ? { status: "ok", value: p.value, raw } : { status: "broken", raw: raw as string };
}

export type Write = { status: "saved"; value: Stored } | { status: "failed" } | { status: "broken" };

/**
 * 지금 저장된 값을 다시 읽어 change를 적용하고 쓴 뒤, 다시 읽어 확인한다.
 * (화면이 들고 있던 값이 아니라 저장소의 최신 값에 적용하므로, 다른 창에서 한 체크를 지우지 않는다)
 * 저장된 값이 손상돼 있으면 덮어쓰지 않는다.
 */
export function update(store: KeyValueStore | null, today: string, change: (s: Stored) => Stored): Write {
  const r = readStored(store, today);
  if (r.status === "unavailable") return { status: "failed" };
  if (r.status === "broken") return { status: "broken" };
  const next = change(r.value);
  const text = JSON.stringify(next);
  try {
    store!.setItem(STORAGE_KEY, text);
    return store!.getItem(STORAGE_KEY) === text ? { status: "saved", value: next } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

/** 이 기기에서 모두 지우기 (항목·체크). 지운 뒤에는 기본 항목으로 보인다. */
export function clearAll(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    return store.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

// ── 탭 사이 잠금 (있으면 쓴다) ─────────────────────────
export interface LockManagerLike {
  request(name: string, options: { mode: "exclusive"; signal: AbortSignal }, callback: () => unknown): Promise<unknown>;
}

export function browserLocks(): LockManagerLike | null {
  try {
    const l = (navigator as Navigator & { locks?: LockManagerLike }).locks;
    return l && typeof l.request === "function" ? l : null;
  } catch {
    return null;
  }
}

/**
 * 읽기-적용-쓰기를 다른 탭과 겹치지 않게 잠금 안에서 한다. 잠금을 쓸 수 없는 브라우저에서는 그냥 실행한다.
 * 그 경우 두 창에서 거의 같은 순간에 누르면 한쪽 체크가 저장되지 않을 수 있다 (드묾, 체크는 다시 누르면 됨).
 * 시간 안에 잠금을 못 얻으면 실행하지 않고 busy.
 */
export async function withLock<T>(locks: LockManagerLike | null, fn: () => T, timeoutMs = 3000): Promise<{ status: "done"; value: T } | { status: "busy" }> {
  if (!locks) return { status: "done", value: fn() };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let out: { status: "done"; value: T } | { status: "busy" } = { status: "busy" };
  try {
    await locks.request(LOCK_NAME, { mode: "exclusive", signal: ctrl.signal }, () => {
      if (ctrl.signal.aborted) return;
      out = { status: "done", value: fn() };
    });
  } catch {
    // 철회됨: 실행하지 않았다
  } finally {
    clearTimeout(timer);
  }
  return out;
}
