// 예약 대본 (5단계): 고른 것에 맞춰 병원 예약 전화에서 읽기만 하면 되는 말과, 글로 보낼 예약 문의를 만든다.
// 외부 라이브러리·저장·네트워크 없음 (단위 테스트 대상).
//
// 원칙
//  - 앱이 대신 전화하거나 보내지 않는다. 병원 검색도 하지 않는다 (사용자가 아는 병원에 직접 연락).
//  - 입력값(원하는 때)은 저장하지 않는다. 이름·생년월일 같은 개인정보는 받지 않는다.
//  - 전화로 증상을 자세히 설명하지 않아도 된다는 선택지를 준다.
//  - 진단·치료 표현을 쓰지 않는다. 재촉·죄책감 표현을 쓰지 않는다.
//  - 비용 숫자를 단정하지 않는다 (병원·검사마다 다름). 대신 물어보는 말을 넣는다.

export type Channel = "call" | "text";
export type Visit = "first" | "again";
export type AskItem = "cost" | "duration" | "bring";

export const WHEN_MAX = 30;

export const ASK_ITEMS: ReadonlyArray<{ id: AskItem; label: string; line: string }> = [
  { id: "cost", label: "첫 진료 비용이 대략 얼마인지", line: "첫 진료 때 비용이 대략 얼마쯤인지 알 수 있을까요?" },
  { id: "duration", label: "진료가 얼마나 걸리는지", line: "첫 진료는 시간이 얼마나 걸리나요?" },
  { id: "bring", label: "가져갈 것이 있는지", line: "가져가야 할 것이 있을까요?" },
];

export interface BookingInput {
  channel: Channel;
  visit: Visit;
  /** 원하는 때 (선택, 저장하지 않음). 예: "이번 주 목요일 오후" */
  when: string;
  asks: ReadonlyArray<AskItem>;
}

/** 대괄호 제거·공백 정리·길이 제한 (빈칸 표시처럼 보이지 않게) */
export function cleanWhen(s: string): string {
  return s.replace(/[[\]{}<>]/g, "").replace(/\s+/g, " ").trim().slice(0, WHEN_MAX);
}

function visitLine(visit: Visit): string {
  return visit === "first" ? "이 병원은 처음이에요." : "전에 다닌 적이 있어요.";
}

function whenLine(when: string): string {
  const w = cleanWhen(when);
  return w ? `${w}에 예약할 수 있을까요?` : "가장 빠른 날이 언제인지 알 수 있을까요?";
}

function askLines(asks: ReadonlyArray<AskItem>): string[] {
  // 고른 순서와 상관없이 화면에 보이는 순서대로, 중복 없이
  return ASK_ITEMS.filter((a) => asks.includes(a.id)).map((a) => a.line);
}

export interface ScriptStep {
  id: string;
  title: string;
  /** 소리 내어 읽을 말 */
  say: string[];
  /** 읽지 않는 도움말 */
  tip?: string;
}

/** 상대가 물어볼 수 있는 것과 답하는 말 */
export const THEY_MAY_ASK: ReadonlyArray<{ q: string; say: string[]; tip?: string }> = [
  { q: "성함·생년월일·연락처를 물어요", say: [], tip: "물어보는 대로 답하면 돼요. 미리 메모해 두면 편해요." },
  {
    q: "“어떤 일로 오시나요?”",
    say: ["요즘 기분이 많이 가라앉아서 상담받고 싶어요.", "자세한 건 가서 말씀드릴게요."],
    tip: "둘 중 편한 말 하나만 하면 돼요.",
  },
];

/** 막힐 때 쓰는 말 */
export const IF_STUCK: ReadonlyArray<string> = [
  "잠시만요, 메모 좀 볼게요.",
  "죄송한데 다시 한 번 말씀해 주시겠어요?",
  "생각해 보고 다시 연락드릴게요.",
];

/** 전화 대본: 순서대로 읽는 단계 */
export function buildCallScript(input: BookingInput): ScriptStep[] {
  const steps: ScriptStep[] = [
    { id: "hello", title: "인사하기", say: ["안녕하세요, 진료 예약을 하고 싶어서 전화드렸어요."] },
    { id: "visit", title: "처음인지 말하기", say: [visitLine(input.visit)] },
    {
      id: "when",
      title: "날짜 묻기",
      say: [whenLine(input.when)],
      tip: "안 되는 날이면 “그럼 가능한 날을 알려 주시겠어요?”라고 하면 돼요.",
    },
  ];
  const asks = askLines(input.asks);
  if (asks.length) steps.push({ id: "ask", title: "궁금한 것 묻기", say: asks });
  steps.push({
    id: "close",
    title: "확인하고 끝내기",
    say: ["그럼 그날 뵐게요. 감사합니다."],
    tip: "끊기 전에 들은 날짜와 시간을 한 번 더 말해 확인하고, 바로 적어 두세요.",
  });
  return steps;
}

/** 글(문자·카카오톡·누리집)로 보낼 예약 문의 */
export function buildTextMessage(input: BookingInput): string {
  return [
    "안녕하세요, 진료 예약 문의드려요.",
    visitLine(input.visit),
    whenLine(input.when),
    ...askLines(input.asks),
    "감사합니다.",
  ].join(" ");
}

// ── 화면 상태 ─────────────────────────────────────────
export interface BookingState extends BookingInput {
  /** 글 문의를 직접 고친 문장 (null이면 자동 문장) */
  edited: string | null;
  copied: "idle" | "copied" | "failed";
  /** 전화하면서 읽기 편하게 글씨 크게 */
  large: boolean;
}

export const initialBookingState: BookingState = {
  channel: "call",
  visit: "first",
  when: "",
  asks: [],
  edited: null,
  copied: "idle",
  large: false,
};

export type BookingAction =
  | { type: "channel"; value: Channel }
  | { type: "visit"; value: Visit }
  | { type: "when"; value: string }
  | { type: "toggleAsk"; id: AskItem; on: boolean }
  | { type: "edit"; value: string }
  | { type: "regenerate" }
  /** 복사가 끝났을 때. text = 복사를 시작할 때의 글 (그사이 바뀌었으면 결과를 표시하지 않음) */
  | { type: "copied"; ok: boolean; text: string }
  | { type: "large"; value: boolean }
  | { type: "reset" };

export function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case "channel":
      return { ...state, channel: action.value, copied: "idle" };
    case "visit":
      return { ...state, visit: action.value, copied: "idle" };
    case "when":
      return { ...state, when: action.value.slice(0, 40), copied: "idle" };
    case "toggleAsk": {
      const rest = state.asks.filter((a) => a !== action.id);
      return { ...state, asks: action.on ? [...rest, action.id] : rest, copied: "idle" };
    }
    case "edit":
      return { ...state, edited: action.value.slice(0, 500), copied: "idle" };
    case "regenerate":
      return { ...state, edited: null, copied: "idle" };
    case "copied":
      if (action.text !== currentMessage(state)) return state;
      if (!canSendMessage(action.text)) return { ...state, copied: "failed" };
      return { ...state, copied: action.ok ? "copied" : "failed" };
    case "large":
      return { ...state, large: action.value };
    case "reset":
      return initialBookingState;
  }
}

/** 보낼 내용이 있는지 (공백뿐이면 복사 버튼을 끈다) */
export function canSendMessage(text: string): boolean {
  return text.trim().length > 0;
}

/** 글 문의로 보일(보낼) 문장 */
export function currentMessage(state: BookingState): string {
  return state.edited ?? buildTextMessage(state);
}

// ── 걱정 풀기: 출처와 확인 날짜를 함께 관리 (docs/booking-sources.md) ──
export interface WorrySource {
  label: string;
  url: string;
}
export interface Worry {
  id: string;
  title: string;
  body: string[];
  sources: WorrySource[];
}

export const WORRIES_CHECKED_ON = "2026-11-13";

export const WORRIES: ReadonlyArray<Worry> = [
  {
    id: "cost",
    title: "비용이 걱정돼요",
    body: [
      "비용은 병원과 받는 검사에 따라 달라서, 여기서 금액을 미리 말씀드리기 어려워요.",
      "예약할 때 첫 진료 비용을 물어봐도 괜찮아요. 위에서 ‘첫 진료 비용’을 고르면 대본에 넣어 드려요.",
    ],
    sources: [],
  },
  {
    id: "record",
    title: "진료 기록이 남는 게 걱정돼요",
    body: [
      "의료법에 따라 병원은, 법에 정한 경우가 아니면 나 아닌 다른 사람에게 진료 기록을 보여 주거나 내줄 수 없어요. 가족이나 회사도 마찬가지예요.",
      "법에 정한 경우에는 내가 동의한 경우 등이 있어요. 나는 내 기록을 볼 수 있어요.",
    ],
    sources: [{ label: "의료법 제21조(기록 열람 등) — 국가법령정보센터", url: "https://www.law.go.kr/법령/의료법" }],
  },
  {
    id: "insurance",
    title: "보험 가입이 걱정돼요",
    body: [
      "새 보험에 가입할 때 보험사가 최근 진료 이력을 글로 물으면 사실대로 답해야 해요. 일부러, 또는 크게 주의하지 않아 사실과 다르게 답하면 나중에 계약이 해지될 수 있어요.",
      "걱정되면 가입하려는 보험사에 어떤 것을 묻는지 미리 확인해 보세요.",
    ],
    sources: [{ label: "상법 제651조·제651조의2(고지의무) — 국가법령정보센터", url: "https://www.law.go.kr/법령/상법" }],
  },
];
