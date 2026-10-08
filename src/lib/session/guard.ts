// 계정 전환 보호. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 규칙
//  - 화면은 "지금 로그인한 사용자 ID"와 "세션 세대(generation)"를 들고 있다.
//    사용자가 바뀌거나 로그아웃하면 세대가 올라가고, 이전 세대에서 시작한 요청의 응답은 버린다.
//    같은 사용자가 로그아웃 후 다시 로그인해도 세대가 올라간다.
//  - 요청을 보내기 전에 실제 세션의 사용자 ID를 다시 확인한다. 화면이 알고 있는 사용자와 다르면
//    보내지 않는다 (이전 계정의 입력·재시도 요청이 새 계정으로 가지 않도록).
//  - 화면(컴포넌트)이 닫힌 뒤 도착한 응답도 버린다.
//  - 서버에 저장된 기록은 건드리지 않는다. 여기서 하는 일은 화면에 반영할지 말지 정하는 것뿐이다.

export interface Ticket {
  uid: string | null;
  generation: number;
}

export interface SessionGuard {
  /** 지금 화면이 알고 있는 사용자 ID (로그인 안 했으면 null) */
  readonly uid: string | null;
  readonly generation: number;
  /** 사용자 변경을 알린다. 같은 사용자면 아무 일도 없다. 바뀌었으면 true. */
  setUser(uid: string | null): boolean;
  /** 요청을 시작할 때 받는 표 */
  ticket(): Ticket;
  /** 표가 아직 유효한지 (같은 사용자·같은 세대·로그인 상태·폐기 전) */
  isCurrent(t: Ticket): boolean;
  /** 이 보호 범위를 닫는다. 이후 모든 표는 무효. */
  dispose(): void;
  /** 사용자가 바뀔 때 알림을 받는다. 해제 함수를 돌려준다. */
  subscribe(fn: (uid: string | null, generation: number) => void): () => void;
}

export function createSessionGuard(initialUid: string | null = null): SessionGuard {
  let uid = initialUid;
  let generation = 1;
  let disposed = false;
  const listeners = new Set<(uid: string | null, generation: number) => void>();

  return {
    get uid() {
      return uid;
    },
    get generation() {
      return generation;
    },
    setUser(next) {
      if (disposed || next === uid) return false;
      uid = next;
      generation += 1;
      listeners.forEach((fn) => fn(uid, generation));
      return true;
    },
    ticket() {
      return { uid, generation };
    },
    isCurrent(t) {
      return !disposed && t.uid !== null && t.uid === uid && t.generation === generation;
    },
    dispose() {
      disposed = true;
      generation += 1;
      listeners.clear();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** 서버가 돌려준 기록의 소유자가 요청한 사용자와 같은지 (한 번 더 확인) */
export function ownedBy(record: { owner_id: string }, t: Ticket): boolean {
  return t.uid !== null && record.owner_id === t.uid;
}

export type Guarded<T> =
  | { ok: true; value: T; ticket: Ticket }
  | { ok: false; reason: "account_changed" | "signed_out" | "closed" };

/**
 * 계정 확인 → 요청 → 응답 확인을 한 번에 한다.
 *  1) 표를 받는다. 화면이 이미 무효(로그아웃·폐기)면 보내지 않는다.
 *  2) 실제 세션의 사용자를 확인한다. 화면의 사용자와 다르면 보내지 않고 화면에 사용자 변경을 알린다.
 *  3) 요청을 보낸다.
 *  4) 응답이 오면 화면이 닫혔는지, 그사이 사용자·세대가 바뀌었는지 확인한다. 바뀌었으면 버린다.
 */
export async function guardedRequest<T>(opts: {
  guard: SessionGuard;
  getSessionUid: () => Promise<string | null>;
  isMounted: () => boolean;
  send: () => Promise<T>;
}): Promise<Guarded<T>> {
  const { guard, getSessionUid, isMounted, send } = opts;
  const t = guard.ticket();
  if (!isMounted()) return { ok: false, reason: "closed" };
  if (!guard.isCurrent(t)) return { ok: false, reason: t.uid === null ? "signed_out" : "account_changed" };

  let sessionUid: string | null;
  try {
    sessionUid = await getSessionUid();
  } catch {
    sessionUid = null;
  }
  if (!isMounted()) return { ok: false, reason: "closed" };
  if (sessionUid !== t.uid || !guard.isCurrent(t)) {
    guard.setUser(sessionUid);
    return { ok: false, reason: sessionUid === null ? "signed_out" : "account_changed" };
  }

  const value = await send();
  if (!isMounted()) return { ok: false, reason: "closed" };
  if (!guard.isCurrent(t)) return { ok: false, reason: guard.uid === null ? "signed_out" : "account_changed" };
  return { ok: true, value, ticket: t };
}
