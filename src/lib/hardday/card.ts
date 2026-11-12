// 힘든 날 카드 (6단계): 괜찮은 날 미리 적어 두고, 힘든 날 꺼내 보는 카드.
// 저장 위치는 '이 기기'뿐이다 (2026-11-13 사용자 합의). 서버·계정·분석 도구로 보내지 않는다.
//
// 원칙
//  - '저장하기'를 눌렀을 때만 이 기기 브라우저에 저장한다. 지우기를 언제든 할 수 있다.
//  - 연락할 사람은 부르는 이름만, 필수 아님 (제3자 정보 최소 수집). 전화번호는 받지 않는다.
//  - 주문 주소는 https:// 주소만 받는다 (다른 형식은 링크로 만들지 않음).
//  - 앱이 대신 보내지 않는다. 복사를 '보냄'으로 표시·기록하지 않는다.
//  - 저장된 값은 믿지 않고 다시 검사한다 (손상·다른 버전이면 무시하고 알린다).

export const STORAGE_KEY = "404blue.hardday.v1";
export const MAX_FOODS = 3;
export const MAX_PEOPLE = 2;
export const LIMITS = { foodName: 30, foodUrl: 300, person: 20, message: 300 } as const;

export interface Food {
  name: string;
  /** 주문할 때 여는 주소 (선택, https만) */
  url: string;
}

export interface HardDayCard {
  version: 1;
  foods: Food[];
  /** 부를 이름만 (선택) */
  people: string[];
  /** 힘든 날 보낼 부탁 문장 (선택) */
  message: string;
  /** 저장한 때 (이 기기 시각, ISO) */
  savedAt: string;
}

export const DEFAULT_MESSAGE = "오늘 좀 힘들어. 밥 좀 시켜 줄 수 있어? 어려우면 편하게 말해 줘. 괜찮아.";

export function emptyCard(): Omit<HardDayCard, "savedAt"> {
  return { version: 1, foods: [{ name: "", url: "" }], people: [""], message: DEFAULT_MESSAGE };
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** https:// 주소만 허용. 아니면 빈 문자열 (링크로 만들지 않음) */
export function safeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password) return "";
    return u.toString().slice(0, LIMITS.foodUrl);
  } catch {
    return "";
  }
}

/** 입력칸의 주소가 쓸 수 없는 형식인지 (비어 있으면 문제 없음) */
export function urlProblem(raw: string): string | null {
  if (!raw.trim()) return null;
  return safeUrl(raw) ? null : "https:// 로 시작하는 주소만 넣을 수 있어요.";
}

/** 입력 내용을 저장할 모양으로 정리: 빈 칸 제거, 길이 제한, 개수 제한 */
export function normalize(input: { foods: Food[]; people: string[]; message: string }, now: Date): HardDayCard {
  const foods = input.foods
    .map((f) => ({ name: clip(f.name, LIMITS.foodName), url: safeUrl(f.url ?? "") }))
    .filter((f) => f.name || f.url)
    .slice(0, MAX_FOODS);
  const people = input.people.map((p) => clip(p, LIMITS.person)).filter(Boolean).slice(0, MAX_PEOPLE);
  const message = typeof input.message === "string" ? input.message.trim().slice(0, LIMITS.message) : "";
  return { version: 1, foods, people, message, savedAt: now.toISOString() };
}

/** 카드에 적힌 것이 하나라도 있는지 */
export function hasContent(c: Pick<HardDayCard, "foods" | "people" | "message">): boolean {
  return c.foods.some((f) => f.name || f.url) || c.people.some(Boolean) || c.message.trim().length > 0;
}

export type LoadResult =
  | { status: "empty" }
  | { status: "ok"; card: HardDayCard }
  | { status: "broken" } // 저장된 값이 손상됐거나 모르는 버전
  | { status: "unavailable" }; // 이 브라우저에서 저장소를 쓸 수 없음 (사생활 보호 모드 등)

/** 저장된 문자열을 검사해 카드로 바꾼다. 믿을 수 없는 값은 쓰지 않는다. */
export function parseStored(raw: string | null): LoadResult {
  if (raw === null) return { status: "empty" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "broken" };
  }
  if (!data || typeof data !== "object") return { status: "broken" };
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.foods) || !Array.isArray(d.people) || typeof d.message !== "string") {
    return { status: "broken" };
  }
  const savedAt = typeof d.savedAt === "string" && !Number.isNaN(Date.parse(d.savedAt)) ? d.savedAt : null;
  if (!savedAt) return { status: "broken" };
  const foods = (d.foods as unknown[]).filter((f): f is Record<string, unknown> => !!f && typeof f === "object").map((f) => ({
    name: typeof f.name === "string" ? f.name : "",
    url: typeof f.url === "string" ? f.url : "",
  }));
  const people = (d.people as unknown[]).filter((p): p is string => typeof p === "string");
  const card = normalize({ foods, people, message: d.message }, new Date(savedAt));
  return { status: "ok", card: { ...card, savedAt } };
}

/** 최소한의 저장소 모양 (시험에서 가짜로 바꿀 수 있게) */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadCard(store: KeyValueStore | null): LoadResult {
  if (!store) return { status: "unavailable" };
  try {
    return parseStored(store.getItem(STORAGE_KEY));
  } catch {
    return { status: "unavailable" };
  }
}

/** 저장하고, 다시 읽어 같은지 확인한다. 확인될 때만 성공. */
export function saveCard(store: KeyValueStore | null, card: HardDayCard): boolean {
  if (!store) return false;
  try {
    const text = JSON.stringify(card);
    store.setItem(STORAGE_KEY, text);
    return store.getItem(STORAGE_KEY) === text;
  } catch {
    return false;
  }
}

/** 이 기기에서 지우고, 지워졌는지 확인한다. */
export function clearCard(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.removeItem(STORAGE_KEY);
    return store.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/** 브라우저 저장소. 쓸 수 없으면 null (접근만 해도 오류가 나는 브라우저가 있다) */
export function browserStore(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    const probe = "404blue.probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** 부탁 문장을 보낼 수 있는지 (공백뿐이면 복사를 끈다) */
export function canSend(text: string): boolean {
  return text.trim().length > 0;
}
