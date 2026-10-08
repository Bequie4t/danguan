// 오늘 기록 화면의 상태. 외부 라이브러리 없음 (단위 테스트 대상).
// 규칙
//  - 서버가 저장된 기록을 돌려주기 전에는 "saved"가 되지 않는다.
//  - 실패하면 입력과 기록 ID를 그대로 둔다 → 다시 저장해도 중복 생성되지 않는다.
//  - 성공하면 다음 기록을 위해 새 ID로 비운다.
import type { Burden, Checkin, Draft, DraftProblem, TagCode } from "./model";
import type { FailReason } from "./api";

export type FormStatus = "editing" | "saving" | "saved" | "failed";

export interface FormState {
  draft: Draft;
  status: FormStatus;
  failReason: FailReason | null;
  problem: DraftProblem | null;
  lastSaved: Checkin | null;
}

export type FormAction =
  | { type: "setBurden"; burden: Burden }
  | { type: "toggleTag"; tag: TagCode }
  | { type: "setNote"; note: string }
  | { type: "setRecall"; value: string | null }
  | { type: "invalid"; problem: DraftProblem }
  | { type: "submitStart" }
  | { type: "submitSuccess"; record: Checkin; nextId: string }
  | { type: "submitFail"; reason: FailReason }
  | { type: "replaceDraft"; draft: Draft };

export function initialFormState(draft: Draft): FormState {
  return { draft, status: "editing", failReason: null, problem: null, lastSaved: null };
}

function edited(state: FormState, draft: Draft): FormState {
  // 저장 중에는 입력을 바꾸지 않는다 (보낸 내용과 화면 내용이 달라지지 않도록)
  if (state.status === "saving") return state;
  return {
    ...state,
    draft,
    problem: null,
    status: state.status === "failed" ? "failed" : "editing",
  };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "setBurden":
      return edited(state, { ...state.draft, burden: action.burden });
    case "toggleTag": {
      const has = state.draft.tags.includes(action.tag);
      const tags = has ? state.draft.tags.filter((t) => t !== action.tag) : [...state.draft.tags, action.tag];
      return edited(state, { ...state.draft, tags });
    }
    case "setNote":
      return edited(state, { ...state.draft, note: action.note });
    case "setRecall":
      return edited(state, { ...state.draft, recallLocal: action.value });
    case "invalid":
      return { ...state, problem: action.problem };
    case "submitStart":
      if (state.status === "saving") return state;
      return { ...state, status: "saving", failReason: null, problem: null };
    case "submitSuccess":
      // 다른 기록에 대한 늦은 응답은 무시
      if (action.record.id !== state.draft.id) return state;
      return {
        draft: { id: action.nextId, burden: null, tags: [], note: "", recallLocal: null },
        status: "saved",
        failReason: null,
        problem: null,
        lastSaved: action.record,
      };
    case "submitFail":
      return { ...state, status: "failed", failReason: action.reason };
    case "replaceDraft":
      return initialFormState(action.draft);
    default:
      return state;
  }
}
