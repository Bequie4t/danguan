// 부탁하기: 상황을 고르면 부탁 문장을 만든다. 외부 라이브러리·저장·네트워크 없음 (단위 테스트 대상).
//
// 원칙
//  - 앱이 대신 보내지 않는다. 문장은 사용자가 복사하거나 메시지 앱으로 넘겨 직접 보낸다.
//  - 받는 사람 이름과 문장은 저장하지 않는다 (화면을 떠나면 사라진다). 로그·분석 도구로 보내지 않는다.
//  - 빈칸 표시([ ])를 남기지 않는다. 비워 두면 자연스러운 기본 문장이 된다.
//  - 죄책감·재촉 표현을 쓰지 않고, 거절할 여지를 남기는 한마디를 기본으로 덧붙인다.

export type AskKind = "clinic" | "meal" | "call" | "booking";

export interface AskOption {
  kind: AskKind;
  label: string;
  /** 이 상황에서 채울 수 있는 칸 (없으면 null) */
  field: { label: string; hint: string; maxLength: number } | null;
}

export const ASK_OPTIONS: ReadonlyArray<AskOption> = [
  { kind: "clinic", label: "병원에 같이 가 주기", field: { label: "언제 가요? (선택)", hint: "예: 이번 주 목요일 오후", maxLength: 30 } },
  { kind: "meal", label: "밥 시켜 주기", field: { label: "먹고 싶은 것 (선택)", hint: "예: 죽, 김밥", maxLength: 30 } },
  { kind: "call", label: "전화 한 번 해 주기", field: { label: "언제쯤이면 좋아요? (선택)", hint: "예: 저녁", maxLength: 20 } },
  { kind: "booking", label: "예약 전화 대신 걸어 주기", field: null },
];

/** 주소(?kind=)로 받은 값이 정해진 상황인지 */
export function isAskKind(v: string): v is AskKind {
  return ASK_OPTIONS.some((o) => o.kind === v);
}

export const SOFTENER = "어려우면 편하게 말해 줘. 괜찮아.";
export const NAME_MAX = 20;

export interface AskInput {
  kind: AskKind;
  /** 받는 사람 이름 (선택, 저장하지 않음) */
  name: string;
  /** 상황별 칸 값 (선택) */
  detail: string;
  /** 거절할 여지를 남기는 한마디 덧붙이기 */
  soften: boolean;
}

/** 한글 이름 끝 글자의 받침에 따라 부르는 말(아/야)을 붙인다. 한글이 아니면 쉼표만. */
export function vocative(name: string): string {
  const n = clean(name, NAME_MAX);
  if (!n) return "";
  const last = n.charCodeAt(n.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const hasBatchim = (last - 0xac00) % 28 !== 0;
    return `${n}${hasBatchim ? "아" : "야"}, `;
  }
  return `${n}, `;
}

/** 앞뒤 공백·줄바꿈 정리, 대괄호 제거(빈칸 표시처럼 보이지 않게), 길이 제한 */
export function clean(s: string, max: number): string {
  return s.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function body(kind: AskKind, detail: string): string {
  switch (kind) {
    case "clinic":
      return detail
        ? `${detail} 병원 가는데, 같이 가 줄 수 있어? 가는 길만 같이 있어 줘도 돼.`
        : "병원 가는 날 같이 가 줄 수 있어? 가는 길만 같이 있어 줘도 돼.";
    case "meal":
      return detail ? `오늘 밥 좀 시켜 줄 수 있어? 이거면 돼: ${detail}` : "오늘 밥 좀 시켜 줄 수 있어? 아무거나 괜찮아.";
    case "call":
      return detail
        ? `오늘은 답장을 못 할 수도 있어. ${detail}에 전화 한 번만 줄 수 있어?`
        : "오늘은 답장을 못 할 수도 있어. 시간 될 때 전화 한 번만 줄 수 있어?";
    case "booking":
      return "병원 예약 전화를 대신 걸어 줄 수 있어? 번호랑 할 말은 내가 보내 줄게.";
  }
}

/** 고른 상황과 칸 값으로 보낼 문장을 만든다 */
export function buildSentence(input: AskInput): string {
  const option = ASK_OPTIONS.find((o) => o.kind === input.kind) ?? ASK_OPTIONS[0];
  const detail = option.field ? clean(input.detail, option.field.maxLength) : "";
  let main = vocative(input.name) + body(option.kind, detail);
  // 칸 값으로 끝나면(예: "이거면 돼: 죽") 마침표를 붙여 다음 문장과 이어 읽히지 않게 한다
  if (!/[.?!~]$/.test(main)) main += ".";
  const parts = [main];
  if (input.soften) parts.push(SOFTENER);
  return parts.join(" ");
}

/** 메시지 앱으로 넘기는 주소. 받는 사람 번호는 넣지 않는다 (앱에서 사용자가 고름). */
export function smsHref(text: string): string {
  // iOS·안드로이드 모두에서 열리는 형태 (?&body=)
  return `sms:?&body=${encodeURIComponent(text)}`;
}

// ── 화면 상태 ─────────────────────────────────────────
export interface AskState extends AskInput {
  /** 사용자가 직접 고친 문장 (null이면 자동으로 만든 문장을 쓴다) */
  edited: string | null;
  /** 복사 결과 안내: 복사는 '보냄'이 아니다 */
  copied: "idle" | "copied" | "failed" | "stale";
}

export const initialAskState: AskState = { kind: "clinic", name: "", detail: "", soften: true, edited: null, copied: "idle" };

export type AskAction =
  | { type: "pick"; kind: AskKind }
  | { type: "name"; value: string }
  | { type: "detail"; value: string }
  | { type: "soften"; value: boolean }
  | { type: "edit"; value: string }
  | { type: "regenerate" }
  /** 복사가 끝났을 때. text = 복사를 시작할 때의 문장 (그사이 문장이 바뀌었으면 안내하지 않음) */
  | { type: "copied"; ok: boolean; text: string }
  | { type: "reset" };

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "pick":
      // 칸 값은 상황마다 뜻이 달라 비운다. 직접 고친 문장은 지우지 않는다
      // ('처음 문장으로'를 눌러야 새 상황의 문장으로 바뀐다).
      return { ...state, kind: action.kind, detail: "", copied: "idle" };
    case "name":
      return { ...state, name: action.value.slice(0, NAME_MAX), copied: "idle" };
    case "detail":
      return { ...state, detail: action.value.slice(0, 40), copied: "idle" };
    case "soften":
      return { ...state, soften: action.value, copied: "idle" };
    case "edit":
      return { ...state, edited: action.value.slice(0, 500), copied: "idle" };
    case "regenerate":
      return { ...state, edited: null, copied: "idle" };
    case "copied":
      // 복사하는 사이 문장이 바뀌었으면 결과 대신 '다시 눌러 주세요'를 보여 준다 (바뀐 문장이 복사된 것처럼 보이지 않게)
      if (action.text !== currentText(state)) return { ...state, copied: "stale" };
      // 빈 문장은 복사 성공으로 표시하지 않는다
      if (!canSend(action.text)) return { ...state, copied: "failed" };
      return { ...state, copied: action.ok ? "copied" : "failed" };
    case "reset":
      return initialAskState;
  }
}

/** 보낼 내용이 있는지 (공백뿐이면 복사·메시지 앱 버튼을 끈다) */
export function canSend(text: string): boolean {
  return text.trim().length > 0;
}

/** 지금 화면에 보일(보낼) 문장 */
export function currentText(state: AskState): string {
  return state.edited ?? buildSentence(state);
}
