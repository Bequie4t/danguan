// 홈의 '한 번 눌러 남기기' 저장 규칙. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 오늘 기록 화면(saveFlow.ts)과 다른 점
//   홈은 새 기록을 만들기만 한다. 이미 있는 기록을 고치지 않는다.
//   응답이 사라진 뒤에는 쓰기 요청을 다시 보내지 않는다. 같은 ID를 '조회'해서 저장됐는지만 확인한다.
//   (같은 ID로 다시 만들면, 그사이 다른 탭에서 지운 기록이 되살아날 수 있다.)
//
// 규칙
//   1. quickSave: 처음 누를 때만 create_checkin을 보낸다. update_checkin은 부르지 않는다.
//   2. confirmSaved: 결과를 모르는 요청의 ID를 조회만 한다. 쓰기 요청 없음.
//      - 있으면 saved. 보낸 값과 같고 version 1이면 '손대지 않은 기록'(untouched) → 되돌리기 허용.
//      - 없으면 missing. 저장되지 않았거나 다른 곳에서 지운 것. 다시 남길지는 사용자가 정한다
//        (다시 남기면 새 ID로 새 기록을 만든다. 지운 ID를 되살리지 않는다).
//   3. 서버가 확실히 거절한 요청(로그인 끝남·동의 없음·잘못된 값)은 저장되지 않았다 → pending 없음.
import { buildCreateParams, type Checkin, type CreateCheckinParams, type Draft, type DraftProblem } from "./model";
import { createCheckin, getCheckin, isUncertain, type FailReason, type RecordsClient } from "./api";

export type QuickOutcome =
  | { kind: "saved"; record: Checkin; untouched: boolean }
  | { kind: "missing"; sent: CreateCheckinParams }
  | { kind: "invalid"; problem: DraftProblem }
  | { kind: "error"; reason: FailReason; pending: CreateCheckinParams | null; newIdRequired: boolean };

function normNote(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/** 서버 기록이 처음 보낸 값 그대로인가 (다른 곳에서 고치지 않았나) */
export function matchesSent(record: Pick<Checkin, "burden" | "tags" | "note" | "version">, params: CreateCheckinParams): boolean {
  if (record.version !== 1) return false;
  if (record.burden !== params.p_burden) return false;
  const a = [...new Set(record.tags)].sort();
  const b = [...new Set(params.p_tags)].sort();
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) return false;
  return normNote(record.note) === normNote(params.p_note);
}

/** 새 기록을 만든다 (규칙 1). 결과를 모르면 pending을 돌려준다. */
export async function quickSave(client: RecordsClient, draft: Draft, now: Date, tz: string): Promise<QuickOutcome> {
  const built = buildCreateParams(draft, now, tz);
  if (!built.ok) return { kind: "invalid", problem: built.problem };
  const params = built.params;
  const res = await createCheckin(client, params);
  if (res.kind === "saved") return { kind: "saved", record: res.record, untouched: matchesSent(res.record, params) };
  if (res.reason === "id_unavailable") return { kind: "error", reason: res.reason, pending: null, newIdRequired: true };
  return { kind: "error", reason: res.reason, pending: isUncertain(res.reason) ? params : null, newIdRequired: false };
}

/** 결과를 모르는 요청이 저장됐는지 조회만 한다 (규칙 2). */
export async function confirmSaved(client: RecordsClient, pending: CreateCheckinParams): Promise<QuickOutcome> {
  const res = await getCheckin(client, pending.p_id);
  if (res.kind === "found") return { kind: "saved", record: res.record, untouched: matchesSent(res.record, pending) };
  if (res.kind === "missing") return { kind: "missing", sent: pending };
  // 조회 실패: 여전히 모른다. pending을 그대로 둔다.
  return { kind: "error", reason: res.reason, pending, newIdRequired: false };
}
