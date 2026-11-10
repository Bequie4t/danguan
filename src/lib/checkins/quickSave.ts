// 홈의 '한 번 눌러 남기기' 저장 규칙. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 오늘 기록 화면(saveFlow.ts)과 다른 점
//   홈은 새 기록을 만들기만 한다. 이미 있는 기록을 고치지 않는다.
//   응답이 사라진 뒤 다시 보내면, 같은 ID로 처음 보낸 값 그대로 다시 보내 "저장됐는지"만 확인한다.
//   그사이 다른 탭·기기에서 그 기록에 메모·생활 항목을 더했어도 덮어쓰지 않는다.
//
// 규칙
//   1. 결과가 불확실한 요청(pending)이 있으면 그 요청을 같은 값 그대로 다시 보낸다. 새 값을 섞지 않는다.
//   2. update_checkin을 부르지 않는다.
//   3. 서버가 돌려준 기록이 보낸 값과 같고 version이 1이면 '손대지 않은 기록'(untouched)이다.
//      되돌리기는 이 경우에만 허용한다 (다른 곳에서 고친 기록을 지우지 않도록).
//   4. 서버가 확실히 거절한 요청(로그인 끝남·동의 없음·잘못된 값)은 저장되지 않았다.
//      이전에 불확실한 요청이 없었다면 pending을 남기지 않는다.
import { buildCreateParams, type Checkin, type CreateCheckinParams, type Draft, type DraftProblem } from "./model";
import { createCheckin, isUncertain, type FailReason, type RecordsClient } from "./api";

export type QuickOutcome =
  | { kind: "saved"; record: Checkin; untouched: boolean }
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

/**
 * pending이 있으면 그것을 그대로 다시 보내 확인한다. 없으면 draft로 새로 만든다.
 * 반환된 pending을 다음 시도에 넘긴다.
 */
export async function quickSave(
  client: RecordsClient,
  draft: Draft,
  pending: CreateCheckinParams | null,
  now: Date,
  tz: string,
): Promise<QuickOutcome> {
  let params: CreateCheckinParams;
  if (pending) {
    params = pending; // 규칙 1
  } else {
    const built = buildCreateParams(draft, now, tz);
    if (!built.ok) return { kind: "invalid", problem: built.problem };
    params = built.params;
  }

  const res = await createCheckin(client, params);
  if (res.kind === "saved") return { kind: "saved", record: res.record, untouched: matchesSent(res.record, params) };

  if (res.reason === "id_unavailable") {
    return { kind: "error", reason: res.reason, pending: null, newIdRequired: true };
  }
  const stillUncertain = pending !== null || isUncertain(res.reason);
  return { kind: "error", reason: res.reason, pending: stillUncertain ? params : null, newIdRequired: false };
}
