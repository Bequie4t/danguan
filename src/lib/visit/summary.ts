// 진료 준비: 기간 안의 기록을 세어 한 장 메모로 정리한다. 외부 라이브러리·저장·네트워크 없음 (단위 테스트 대상).
//
// 원칙 (docs/개발계획서.md 3.3)
//  - 기록 수와 날짜 수를 구분한다. 버거움을 숫자로 바꾸거나 평균·대표값으로 확정하지 않는다 (고른 표현별 개수만 센다).
//  - 기록이 없는 날은 '기록 없음'일 뿐이다. 괜찮았던 날·0으로 바꾸지 않는다.
//  - 지금 기록 / 돌아보며 기록 / 기기 측정을 나눠 센다.
//  - 날짜는 기록이 경험된 시점(occurred_at)을 그 기록의 시간대(occurred_tz)로 본 날짜다.
//  - 지난 기간과 비교하거나 좋아졌다·나빠졌다고 평가하지 않는다.
import { BURDEN_OPTIONS, TAG_OPTIONS, type Burden, type Checkin, type CheckinSource, type TagCode } from "../checkins/model";

/** 날짜 문자열 YYYY-MM-DD (양 끝 포함) */
export interface Period {
  from: string;
  to: string;
}

export const PERIOD_MAX_DAYS = 92;
export const PRESET_DAYS = [7, 14, 28] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtcMs(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // 2월 30일 같은 날짜를 거른다
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const ms = toUtcMs(date);
  if (ms === null) throw new RangeError("invalid date");
  return fromUtcMs(ms + n * DAY_MS);
}

/** 어떤 시점을 주어진 시간대의 날짜(YYYY-MM-DD)로. 시간대가 잘못되면 UTC로 본다. */
export function localDate(iso: string, tz: string): string {
  const d = new Date(iso);
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

/** 주어진 시간대의 시각 (오후 3:05 같은 꼴) */
export function localTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const fmt = (zone: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(d);
  try {
    return fmt(tz);
  } catch {
    return fmt("UTC");
  }
}

/** '오늘까지 n일' 기간 */
export function presetPeriod(today: string, days: number): Period {
  return { from: addDays(today, -(days - 1)), to: today };
}

export type PeriodProblem = "invalid" | "reversed" | "too_long";

export const PERIOD_PROBLEM_TEXT: Record<PeriodProblem, string> = {
  invalid: "시작 날짜와 끝 날짜를 다시 골라 주세요.",
  reversed: "시작 날짜가 끝 날짜보다 늦어요. 다시 골라 주세요.",
  too_long: `한 번에 ${PERIOD_MAX_DAYS}일까지 볼 수 있어요.`,
};

export function checkPeriod(p: Period): PeriodProblem | null {
  const a = toUtcMs(p.from);
  const b = toUtcMs(p.to);
  if (a === null || b === null) return "invalid";
  if (a > b) return "reversed";
  if ((b - a) / DAY_MS + 1 > PERIOD_MAX_DAYS) return "too_long";
  return null;
}

/** 기간의 날짜 수 (양 끝 포함) */
export function periodLength(p: Period): number {
  const a = toUtcMs(p.from);
  const b = toUtcMs(p.to);
  if (a === null || b === null || a > b) return 0;
  return (b - a) / DAY_MS + 1;
}

/**
 * 서버에 물어볼 범위 (occurred_at, UTC). 기록마다 시간대가 달라 날짜 경계가 최대 하루 남짓 어긋나므로
 * 앞뒤로 이틀씩 넓혀 가져온 뒤, 각 기록의 시간대 날짜로 다시 거른다.
 */
export function queryRange(p: Period): { fromIso: string; toIso: string } {
  return { fromIso: `${addDays(p.from, -2)}T00:00:00.000Z`, toIso: `${addDays(p.to, 3)}T00:00:00.000Z` };
}

export function inPeriod(c: Pick<Checkin, "occurred_at" | "occurred_tz">, p: Period): boolean {
  const d = localDate(c.occurred_at, c.occurred_tz);
  return d >= p.from && d <= p.to;
}

export interface DayEntry {
  id: string;
  time: string;
  burden: Burden;
  source: CheckinSource;
}

export interface Summary {
  period: Period;
  periodDays: number;
  records: number;
  /** 기록이 하나라도 있는 날 */
  recordedDays: number;
  /** 기록이 없는 날 (그날 상태를 알 수 없음) */
  unrecordedDays: number;
  bySource: Record<CheckinSource, number>;
  /** 고른 표현별 기록 수. 화면의 선택지 순서 그대로, 0개도 포함 */
  burdens: { value: Burden; records: number; days: number }[];
  /** 생활 항목별 기록 수·날짜 수. 한 번도 없는 항목은 뺀다 */
  tags: { value: TagCode; records: number; days: number }[];
  /** 기록이 있는 날만, 오래된 날부터. 하루 안에서는 시간 순 */
  days: { date: string; entries: DayEntry[] }[];
  /** 메모가 있는 기록 (오래된 순) */
  notes: { id: string; date: string; time: string; text: string }[];
}

export function summarize(records: ReadonlyArray<Checkin>, p: Period): Summary {
  const picked = records
    .filter((c) => inPeriod(c, p))
    .slice()
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));

  const bySource: Record<CheckinSource, number> = { direct: 0, recall: 0, device: 0 };
  const burdenRecords = new Map<Burden, number>();
  const burdenDays = new Map<Burden, Set<string>>();
  const tagRecords = new Map<TagCode, number>();
  const tagDays = new Map<TagCode, Set<string>>();
  const dayMap = new Map<string, DayEntry[]>();
  const notes: Summary["notes"] = [];

  for (const c of picked) {
    const date = localDate(c.occurred_at, c.occurred_tz);
    const time = localTime(c.occurred_at, c.occurred_tz);
    bySource[c.source] += 1;
    burdenRecords.set(c.burden, (burdenRecords.get(c.burden) ?? 0) + 1);
    if (!burdenDays.has(c.burden)) burdenDays.set(c.burden, new Set());
    burdenDays.get(c.burden)!.add(date);
    for (const t of new Set(c.tags)) {
      tagRecords.set(t, (tagRecords.get(t) ?? 0) + 1);
      if (!tagDays.has(t)) tagDays.set(t, new Set());
      tagDays.get(t)!.add(date);
    }
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push({ id: c.id, time, burden: c.burden, source: c.source });
    const text = c.note?.trim();
    if (text) notes.push({ id: c.id, date, time, text });
  }

  const periodDays = periodLength(p);
  const recordedDays = dayMap.size;
  const tagOrder = new Map(TAG_OPTIONS.map((t, i) => [t.value, i]));
  return {
    period: p,
    periodDays,
    records: picked.length,
    recordedDays,
    unrecordedDays: Math.max(0, periodDays - recordedDays),
    bySource,
    burdens: BURDEN_OPTIONS.map((o) => ({
      value: o.value,
      records: burdenRecords.get(o.value) ?? 0,
      days: burdenDays.get(o.value)?.size ?? 0,
    })),
    tags: [...tagRecords.entries()]
      .map(([value, n]) => ({ value, records: n, days: tagDays.get(value)?.size ?? 0 }))
      .sort((a, b) => b.records - a.records || (tagOrder.get(a.value) ?? 99) - (tagOrder.get(b.value) ?? 99)),
    days: [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => ({ date, entries })),
    notes,
  };
}

/** 2026-11-03 → 11월 3일 (월) */
export function formatDate(date: string): string {
  const ms = toUtcMs(date);
  if (ms === null) return date;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(new Date(ms));
}
