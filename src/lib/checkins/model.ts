// 공통 기록 구조. 앱(후속)과 웹이 같은 정의를 쓴다.
// DB 정의: supabase/migrations/20261007000000_records_v1.sql 과 반드시 맞출 것.
// 이 파일은 외부 라이브러리에 의존하지 않는다 (단위 테스트 대상).

export type CheckinSource = "direct" | "recall" | "device";

// 버거움: 임상 점수가 아니라 사용자가 고른 표현. 숫자로 바꾸거나 평균내지 않는다.
export type Burden = "okay" | "bearable" | "heavy" | "very_heavy" | "unsure";

export const BURDEN_OPTIONS: ReadonlyArray<{ value: Burden; label: string }> = [
  { value: "okay", label: "괜찮은 편이에요" },
  { value: "bearable", label: "견딜 만해요" },
  { value: "heavy", label: "버거워요" },
  { value: "very_heavy", label: "많이 버거워요" },
  { value: "unsure", label: "모르겠어요" },
];

export type TagCode =
  | "sleep"
  | "meal"
  | "wash"
  | "outside"
  | "work_study"
  | "contact"
  | "body"
  | "medication"
  | "rest";

// 생활 항목. 고르지 않아도 된다.
export const TAG_OPTIONS: ReadonlyArray<{ value: TagCode; label: string }> = [
  { value: "sleep", label: "잠" },
  { value: "meal", label: "식사" },
  { value: "wash", label: "씻기" },
  { value: "outside", label: "바깥 나가기" },
  { value: "work_study", label: "일·공부" },
  { value: "contact", label: "연락·만남" },
  { value: "body", label: "몸 불편" },
  { value: "medication", label: "약" },
  { value: "rest", label: "쉬기" },
];

export const SOURCE_LABEL: Record<CheckinSource, string> = {
  direct: "지금 기록",
  recall: "돌아보며 기록",
  device: "기기 측정",
};

export const NOTE_MAX = 1000;
export const TAGS_MAX = 12;

export const CONSENT_KEY = "sensitive_record_storage";
export const CONSENT_POLICY_VERSION = "2026-10-07";

/** 서버에 저장된 기록 (DB 행과 같은 모양) */
export interface Checkin {
  id: string;
  owner_id: string;
  occurred_at: string;
  occurred_tz: string;
  recorded_at: string;
  recorded_tz: string;
  source: CheckinSource;
  burden: Burden;
  tags: TagCode[];
  note: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

/** create_checkin 함수에 보내는 값 */
export interface CreateCheckinParams {
  p_id: string;
  p_occurred_at: string;
  p_occurred_tz: string;
  p_recorded_at: string;
  p_recorded_tz: string;
  p_source: "direct" | "recall";
  p_burden: Burden;
  p_tags: TagCode[];
  p_note: string | null;
}

export interface Draft {
  /** 저장이 확인될 때까지 바뀌지 않는 기록 ID. 재전송해도 중복되지 않게 한다. */
  id: string;
  burden: Burden | null;
  tags: TagCode[];
  note: string;
  /** null이면 "지금", 값이 있으면 돌아보며 기록하는 시점 (datetime-local 문자열) */
  recallLocal: string | null;
}

export function isBurden(v: unknown): v is Burden {
  return BURDEN_OPTIONS.some((o) => o.value === v);
}

export function isTag(v: unknown): v is TagCode {
  return TAG_OPTIONS.some((o) => o.value === v);
}

export function burdenLabel(b: Burden): string {
  return BURDEN_OPTIONS.find((o) => o.value === b)?.label ?? b;
}

export function tagLabel(t: string): string {
  return TAG_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function newDraft(newId: () => string): Draft {
  return { id: newId(), burden: null, tags: [], note: "", recallLocal: null };
}

export type DraftProblem =
  | "no_burden"
  | "note_too_long"
  | "too_many_tags"
  | "recall_invalid"
  | "recall_in_future";

export const DRAFT_PROBLEM_TEXT: Record<DraftProblem, string> = {
  no_burden: "지금 버거운 정도를 하나 골라 주세요.",
  note_too_long: `메모는 ${NOTE_MAX}자까지 쓸 수 있어요.`,
  too_many_tags: `생활 항목은 ${TAGS_MAX}개까지 고를 수 있어요.`,
  recall_invalid: "언제의 일인지 날짜와 시간을 다시 골라 주세요.",
  recall_in_future: "돌아보는 기록은 지금보다 앞선 때만 고를 수 있어요.",
};

/**
 * 화면 입력을 저장 요청으로 바꾼다.
 * now: 입력 시점(기기 시계), tz: 기기 시간대.
 * datetime-local 값은 기기 시간대 기준으로 해석된다.
 */
export function buildCreateParams(
  draft: Draft,
  now: Date,
  tz: string,
): { ok: true; params: CreateCheckinParams } | { ok: false; problem: DraftProblem } {
  if (!draft.burden || !isBurden(draft.burden)) return { ok: false, problem: "no_burden" };
  const note = draft.note.trim();
  if (note.length > NOTE_MAX) return { ok: false, problem: "note_too_long" };
  const tags = Array.from(new Set(draft.tags.filter(isTag)));
  if (tags.length > TAGS_MAX) return { ok: false, problem: "too_many_tags" };

  let occurred = now;
  let source: "direct" | "recall" = "direct";
  if (draft.recallLocal) {
    const d = new Date(draft.recallLocal);
    if (Number.isNaN(d.getTime())) return { ok: false, problem: "recall_invalid" };
    if (d.getTime() > now.getTime()) return { ok: false, problem: "recall_in_future" };
    occurred = d;
    source = "recall";
  }

  return {
    ok: true,
    params: {
      p_id: draft.id,
      p_occurred_at: occurred.toISOString(),
      p_occurred_tz: tz,
      p_recorded_at: now.toISOString(),
      p_recorded_tz: tz,
      p_source: source,
      p_burden: draft.burden,
      p_tags: tags,
      p_note: note === "" ? null : note,
    },
  };
}

/** 기록이 경험된 시점을 그 시점의 시간대로 보여준다. */
export function formatOccurred(c: Pick<Checkin, "occurred_at" | "occurred_tz">): string {
  return formatInZone(c.occurred_at, c.occurred_tz);
}

export function formatInZone(iso: string, tz: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: tz,
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toLocaleString("ko-KR");
  }
}

/** 지금 이 기기 시간대 기준 datetime-local 기본값 (n시간 전) */
export function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
