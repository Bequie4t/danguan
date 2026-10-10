// 오늘 기록 저장 흐름. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 해결하려는 문제
//   서버는 저장했는데 응답만 사라진 경우(연결 끊김 등), 클라이언트는 저장 여부를 모른다.
//   그 사이 사용자가 입력을 바꾸고 같은 기록 ID로 바뀐 내용을 보내면, 서버는 "이미 있음"으로 처음 내용을 돌려준다.
//   ID만 보고 완료로 표시하면 바뀐 입력이 조용히 사라진다.
//
// 규칙
//   1. 결과가 불확실한 요청(pending.phase = "uncertain")은 처음 보낸 내용 그대로 다시 보내 저장 여부를 확인한다.
//   2. 서버 기록을 받으면 현재 입력과 비교한다. 같으면 완료.
//   3. 다르면 받은 version으로 update_checkin 을 호출한다 (버전 검사). 성공해야 완료.
//   4. 수정 결과도 불확실하면 다음 재시도에서 다시 버전 검사로 확인한다. 서버 내용이 이미 내 입력과 같으면 완료.
//   5. 서버가 확실히 거절한 요청(로그인 끝남·동의 없음·잘못된 값)은 저장되지 않았으므로,
//      이전에 불확실한 요청이 없었다면 다음 시도에서 현재 입력으로 새로 만든다.
//   6. 사용자가 고친 입력(draft)은 화면 상태에 따로 남고, 이 함수는 그것을 바꾸지 않는다.
//   7. 확인 전에는 '언제'(경험 시점)를 바꿀 수 없다 — 이미 저장됐을 수 있는 기록의 시점은 수정 함수로 바꾸지 않는다.
import { buildCreateParams, type Checkin, type CreateCheckinParams, type Draft, type DraftProblem } from "./model";
import { createCheckin, isUncertain, updateCheckin, type FailReason, type RecordsClient } from "./api";

export type PendingSave =
  /** 보냈지만 저장됐는지 모름 */
  | { phase: "uncertain"; params: CreateCheckinParams }
  /** 서버에 있는 것을 확인함. 현재 입력과 다르면 이 version으로 수정해야 함 */
  | { phase: "exists"; params: CreateCheckinParams; record: Checkin };

export type SaveOutcome =
  | { kind: "saved"; record: Checkin; pending: null }
  | { kind: "invalid"; problem: DraftProblem; pending: PendingSave | null }
  | { kind: "error"; reason: FailReason; pending: PendingSave | null; newIdRequired: boolean }
  /** 확인해 보니 다른 기기에서 먼저 바뀜. 덮어쓰지 않았다. 사용자가 다시 저장하면 이 version 기준으로 수정한다. */
  | { kind: "conflict"; server: Checkin; pending: PendingSave };

function normNote(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t === "" ? null : t;
}

/** 서버 기록 내용이 화면 입력과 같은가 (버거움·생활 항목·메모) */
export function sameContent(record: Pick<Checkin, "burden" | "tags" | "note">, draft: Draft): boolean {
  if (record.burden !== draft.burden) return false;
  const a = [...new Set(record.tags)].sort();
  const b = [...new Set(draft.tags)].sort();
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) return false;
  return normNote(record.note) === normNote(draft.note);
}

/** pending이 있으면 '언제'를 바꿀 수 없다 */
export function timeLocked(pending: PendingSave | null): boolean {
  return pending !== null;
}

async function reconcile(
  client: RecordsClient,
  draft: Draft,
  params: CreateCheckinParams,
  record: Checkin,
): Promise<SaveOutcome> {
  if (sameContent(record, draft)) return { kind: "saved", record, pending: null };
  if (!draft.burden) return { kind: "invalid", problem: "no_burden", pending: { phase: "exists", params, record } };

  const res = await updateCheckin(client, {
    id: record.id,
    expectedVersion: record.version,
    burden: draft.burden,
    tags: draft.tags,
    note: draft.note,
  });
  switch (res.kind) {
    case "saved":
      return sameContent(res.record, draft)
        ? { kind: "saved", record: res.record, pending: null }
        : { kind: "error", reason: "unknown", pending: { phase: "exists", params, record: res.record }, newIdRequired: false };
    case "conflict":
      // 응답이 사라졌던 내 수정이 이미 반영된 경우: 서버 내용이 내 입력과 같으면 완료
      if (sameContent(res.server, draft)) return { kind: "saved", record: res.server, pending: null };
      return { kind: "conflict", server: res.server, pending: { phase: "exists", params, record: res.server } };
    case "not_found":
      // 확인 직후 다른 기기에서 지워짐. 같은 ID로 새로 만들 수 있도록 pending을 비운다.
      return { kind: "error", reason: "unknown", pending: null, newIdRequired: false };
    case "error":
      // 수정이 반영됐는지 모를 수 있다. 다음 시도에서 같은 version으로 다시 확인한다.
      return { kind: "error", reason: res.reason, pending: { phase: "exists", params, record }, newIdRequired: false };
    default:
      return { kind: "error", reason: "unknown", pending: { phase: "exists", params, record }, newIdRequired: false };
  }
}

/**
 * 현재 입력(draft)을 저장한다. 이전 시도의 pending을 넘기면 그 결과부터 확인한다.
 * 반환된 pending을 다음 시도에 그대로 넘긴다. "saved"일 때만 완료로 표시한다.
 */
export async function saveDraft(
  client: RecordsClient,
  draft: Draft,
  pending: PendingSave | null,
  now: Date,
  tz: string,
): Promise<SaveOutcome> {
  // 다른 기록 ID의 pending은 쓰지 않는다 (방어)
  if (pending && pending.params.p_id !== draft.id) pending = null;

  if (pending?.phase === "exists") {
    return reconcile(client, draft, pending.params, pending.record);
  }

  let params: CreateCheckinParams;
  if (pending?.phase === "uncertain") {
    params = pending.params; // 규칙 1: 처음 보낸 내용 그대로
  } else {
    const built = buildCreateParams(draft, now, tz);
    if (!built.ok) return { kind: "invalid", problem: built.problem, pending: null };
    params = built.params;
  }

  const res = await createCheckin(client, params);
  if (res.kind === "saved") return reconcile(client, draft, params, res.record);

  if (res.reason === "id_unavailable") {
    // 이 ID는 다른 계정 기록과 겹침. 내 기록이 저장된 적은 없다.
    return { kind: "error", reason: res.reason, pending: null, newIdRequired: true };
  }
  const stillUncertain = pending?.phase === "uncertain" || isUncertain(res.reason);
  return {
    kind: "error",
    reason: res.reason,
    pending: stillUncertain ? { phase: "uncertain", params } : null,
    newIdRequired: false,
  };
}
