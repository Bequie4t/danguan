// 기록 저장·조회 요청. Supabase 클라이언트를 직접 import 하지 않고 필요한 모양만 받는다 (테스트 가능).
// 중요: 기록 내용(버거움·태그·메모)을 console·로그·분석 도구로 보내지 않는다. 오류도 종류만 다룬다.
import {
  type Checkin,
  type CreateCheckinParams,
  type Burden,
  type TagCode,
  isBurden,
} from "./model";

interface PgError {
  code?: string;
  message?: string;
}
interface Result<T> {
  data: T | null;
  error: PgError | null;
}

/** supabase-js 클라이언트 중 여기서 쓰는 부분만 */
export interface RecordsClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Result<unknown>>;
  from(table: "checkins"): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): { limit(n: number): PromiseLike<Result<unknown[]>> };
    };
  };
}

export type FailReason =
  | "network" // 연결 문제 또는 응답 없음: 서버에 저장됐는지 알 수 없음
  | "signed_out"
  | "no_consent"
  | "invalid"
  | "id_unavailable"
  | "unknown";

/** 서버에 저장됐는지 알 수 없는 실패 (요청이 갔을 수 있음). 이때는 같은 내용으로 다시 확인해야 한다. */
export function isUncertain(reason: FailReason): boolean {
  return reason === "network" || reason === "unknown";
}

// 주의: 재로그인·동의 뒤 입력을 되살리는 기능은 아직 없다. 복구를 약속하는 문구를 쓰지 않는다.
export const FAIL_TEXT: Record<FailReason, string> = {
  network: "연결이 불안정해서 저장을 확인하지 못했어요. 입력은 이 화면에 그대로 있어요. 다시 저장해도 기록이 두 번 생기지 않아요.",
  signed_out:
    "로그인이 끝나서 저장하지 못했어요. 지금 입력은 이 화면에만 있어서, 로그인 화면으로 이동하면 사라져요. 필요하면 메모를 다른 곳에 옮겨 적어 두세요.",
  no_consent:
    "기록을 계정에 저장하려면 먼저 저장 동의가 필요해요. 동의 화면으로 이동하면 지금 입력은 사라져요. 필요하면 메모를 다른 곳에 옮겨 적어 두세요.",
  invalid: "저장할 수 없는 값이 있어요. 선택한 내용을 다시 확인해 주세요.",
  id_unavailable: "이 기록을 저장하지 못했어요. 새 기록으로 다시 시도해 주세요.",
  unknown: "저장하지 못했어요. 입력은 그대로 있어요. 잠시 후 다시 시도해 주세요.",
};

export function classifyError(err: PgError | null | undefined): FailReason {
  if (!err) return "unknown";
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();
  if (code === "28000" || msg.includes("not_authenticated") || msg.includes("jwt") || code === "PGRST301") return "signed_out";
  if (code === "42501" || msg.includes("row-level security")) return "no_consent";
  if (code === "23505" || msg.includes("id_unavailable")) return "id_unavailable";
  if (code === "22023" || code === "23514" || code === "22P02" || msg.includes("time zone")) return "invalid";
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("timeout") || code === "") return "network";
  return "unknown";
}

function parseCheckin(v: unknown): Checkin | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.version !== "number" || !isBurden(r.burden)) return null;
  return {
    id: r.id,
    owner_id: String(r.owner_id ?? ""),
    occurred_at: String(r.occurred_at ?? ""),
    occurred_tz: String(r.occurred_tz ?? "UTC"),
    recorded_at: String(r.recorded_at ?? ""),
    recorded_tz: String(r.recorded_tz ?? "UTC"),
    source: r.source === "recall" || r.source === "device" ? r.source : "direct",
    burden: r.burden as Burden,
    tags: Array.isArray(r.tags) ? (r.tags.filter((t) => typeof t === "string") as TagCode[]) : [],
    note: typeof r.note === "string" ? r.note : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
    version: r.version,
  };
}

async function callRpc(client: RecordsClient, fn: string, args: Record<string, unknown>) {
  try {
    const res = await client.rpc(fn, args);
    return res;
  } catch (e) {
    // fetch 자체가 실패한 경우. 내용은 기록하지 않는다.
    return { data: null, error: { code: "", message: e instanceof Error ? e.message : "network" } };
  }
}

export type CreateResult =
  | { kind: "saved"; record: Checkin; created: boolean }
  | { kind: "error"; reason: FailReason };

/** 생성. 같은 p_id로 몇 번을 보내도 기록은 하나만 생긴다. 서버 응답의 기록이 있어야만 saved. */
export async function createCheckin(client: RecordsClient, params: CreateCheckinParams): Promise<CreateResult> {
  const { data, error } = await callRpc(client, "create_checkin", { ...params });
  if (error) return { kind: "error", reason: classifyError(error) };
  const obj = data as { created?: unknown; record?: unknown } | null;
  const record = parseCheckin(obj?.record);
  if (!record || record.id !== params.p_id) return { kind: "error", reason: "unknown" };
  return { kind: "saved", record, created: obj?.created === true };
}

export type MutateResult =
  | { kind: "saved"; record: Checkin }
  | { kind: "deleted" }
  | { kind: "conflict"; server: Checkin }
  | { kind: "not_found" }
  | { kind: "error"; reason: FailReason };

function interpretMutation(data: unknown, error: PgError | null, onOk: (rec: Checkin | null) => MutateResult): MutateResult {
  if (error) return { kind: "error", reason: classifyError(error) };
  const obj = data as { status?: unknown; record?: unknown } | null;
  const status = obj?.status;
  if (status === "ok") return onOk(parseCheckin(obj?.record));
  if (status === "not_found") return { kind: "not_found" };
  if (status === "conflict") {
    const server = parseCheckin(obj?.record);
    return server ? { kind: "conflict", server } : { kind: "error", reason: "unknown" };
  }
  return { kind: "error", reason: "unknown" };
}

/** 수정. expectedVersion이 서버와 다르면 덮어쓰지 않고 conflict를 돌려준다. */
export async function updateCheckin(
  client: RecordsClient,
  input: { id: string; expectedVersion: number; burden: Burden; tags: TagCode[]; note: string },
): Promise<MutateResult> {
  const note = input.note.trim();
  const { data, error } = await callRpc(client, "update_checkin", {
    p_id: input.id,
    p_expected_version: input.expectedVersion,
    p_burden: input.burden,
    p_tags: Array.from(new Set(input.tags)),
    p_note: note === "" ? null : note,
  });
  return interpretMutation(data, error, (rec) => (rec ? { kind: "saved", record: rec } : { kind: "error", reason: "unknown" }));
}

/** 삭제. expectedVersion이 서버와 다르면 지우지 않고 conflict를 돌려준다. */
export async function deleteCheckin(client: RecordsClient, input: { id: string; expectedVersion: number }): Promise<MutateResult> {
  const { data, error } = await callRpc(client, "delete_checkin", {
    p_id: input.id,
    p_expected_version: input.expectedVersion,
  });
  return interpretMutation(data, error, () => ({ kind: "deleted" }));
}

export type ListResult = { kind: "ok"; records: Checkin[] } | { kind: "error"; reason: FailReason };

export async function listCheckins(client: RecordsClient, limit = 200): Promise<ListResult> {
  try {
    const { data, error } = await client.from("checkins").select("*").order("occurred_at", { ascending: false }).limit(limit);
    if (error) return { kind: "error", reason: classifyError(error) };
    const records = (data ?? []).map(parseCheckin).filter((r): r is Checkin => r !== null);
    return { kind: "ok", records };
  } catch {
    return { kind: "error", reason: "network" };
  }
}
