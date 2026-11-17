// 진료 메모 화면 상태. 내가 쓴 글은 저장하지 않는다 (이 화면을 닫으면 사라진다).
// 기록 요약은 서버에 저장된 기록에서 매번 다시 센다.
import type { Period } from "./summary";

export const TEXT_MAX = 500;
export const QUESTION_MAX = 200;
export const QUESTIONS_MAX = 10;

export type PresetChoice = 7 | 14 | 28 | "custom";

export type SectionKey = "counts" | "burdens" | "tags" | "days" | "notes" | "concern" | "impact" | "questions";

export const SECTION_LABEL: Record<SectionKey, string> = {
  counts: "기록한 날",
  burdens: "버거움 기록",
  tags: "자주 고른 생활 항목",
  days: "날짜별 기록",
  notes: "고른 기록 메모",
  concern: "요즘 가장 불편한 점",
  impact: "생활에 미친 영향",
  questions: "진료 때 묻고 싶은 것",
};

export interface MemoState {
  preset: PresetChoice;
  custom: Period;
  concern: string;
  impact: string;
  questions: string[];
  /** 질문 입력 칸 */
  draftQuestion: string;
  /** 메모에 넣을 기록 메모의 기록 ID (기본은 아무것도 넣지 않음) */
  pickedNotes: string[];
  /** 메모에서 뺀 부분 */
  hidden: SectionKey[];
}

export function initialMemoState(today: string, customFrom: string): MemoState {
  return {
    preset: 28,
    custom: { from: customFrom, to: today },
    concern: "",
    impact: "",
    questions: [],
    draftQuestion: "",
    pickedNotes: [],
    // 날짜별 기록은 길어질 수 있어 처음엔 빼 둔다 (켜면 들어감)
    hidden: ["days"],
  };
}

export type MemoAction =
  | { type: "preset"; value: PresetChoice }
  | { type: "custom"; field: "from" | "to"; value: string }
  | { type: "concern"; value: string }
  | { type: "impact"; value: string }
  | { type: "draftQuestion"; value: string }
  | { type: "addQuestion" }
  | { type: "removeQuestion"; index: number }
  | { type: "toggleNote"; id: string; on: boolean }
  | { type: "toggleSection"; key: SectionKey; on: boolean }
  | { type: "clearWriting" };

function clean(s: string, max: number): string {
  return s.slice(0, max);
}

export function memoReducer(state: MemoState, action: MemoAction): MemoState {
  switch (action.type) {
    case "preset":
      return { ...state, preset: action.value };
    case "custom":
      return { ...state, custom: { ...state.custom, [action.field]: action.value } };
    case "concern":
      return { ...state, concern: clean(action.value, TEXT_MAX) };
    case "impact":
      return { ...state, impact: clean(action.value, TEXT_MAX) };
    case "draftQuestion":
      return { ...state, draftQuestion: clean(action.value, QUESTION_MAX) };
    case "addQuestion": {
      const q = state.draftQuestion.replace(/\s+/g, " ").trim();
      if (!q || state.questions.length >= QUESTIONS_MAX) return state;
      return { ...state, questions: [...state.questions, q], draftQuestion: "" };
    }
    case "removeQuestion":
      return { ...state, questions: state.questions.filter((_, i) => i !== action.index) };
    case "toggleNote": {
      const rest = state.pickedNotes.filter((id) => id !== action.id);
      return { ...state, pickedNotes: action.on ? [...rest, action.id] : rest };
    }
    case "toggleSection": {
      const rest = state.hidden.filter((k) => k !== action.key);
      return { ...state, hidden: action.on ? rest : [...rest, action.key] };
    }
    case "clearWriting":
      return { ...state, concern: "", impact: "", questions: [], draftQuestion: "", pickedNotes: [] };
  }
}

/** 화면을 떠나면 사라질 내용이 있는지 (떠나기 전 확인용) */
export function hasWriting(s: MemoState): boolean {
  return s.concern.trim() !== "" || s.impact.trim() !== "" || s.questions.length > 0 || s.draftQuestion.trim() !== "";
}

/** 질문 예시 (누르면 입력 칸에 들어감). 약·진단에 대한 답을 앱이 하지 않고, 의료진에게 묻는 말만. */
export const QUESTION_EXAMPLES: ReadonlyArray<string> = [
  "요즘 잠이 들쭉날쭉한데, 어떻게 하면 좋을까요?",
  "약을 먹고 나서 생긴 변화가 약과 관련이 있을까요?",
  "다음 진료까지 힘들어지면 어떻게 연락하면 될까요?",
];
