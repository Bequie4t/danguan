// 계정 전환 보호. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 규칙
//  - 화면은 "지금 로그인한 사용자 ID"와 "세션 세대(generation)"를 들고 있다.
//    사용자가 바뀌거나 로그아웃하면 세대가 올라가고, 이전 세대에서 시작한 요청의 응답은 버린다.
//    같은 사용자가 로그아웃 후 다시 로그인해도 세대가 올라간다.
//  - 늦게 도착한 계정 확인 결과로 보호 상태를 되돌리지 않는다.
//    계정 확인을 시작한 뒤 세대가 바뀌었다면(그사이 다른 계정으로 바뀌었다면) 그 확인 결과는 버린다.
//  - 요청을 보내기 전에 실제 세션을 다시 확인하고, 그 세션의 인증(액세스 토큰)을 요청에 고정한다.
//    확인 직후 다른 계정으로 바뀌어도 요청은 확인한 계정의 인증으로만 실행된다
//    (새 계정의 인증으로 이전 계정의 입력이 저장되지 않는다).
//  - 화면(컴포넌트)이 닫힌 뒤 도착한 응답도 버린다.
//  - 서버에 저장된 기록은 건드리지 않는다. 여기서 하는 일은 보낼지, 화면에 반영할지 정하는 것뿐이다.

export interface Ticket {
  readonly uid: string | null;
  readonly generation: number;
}
/** 이전 이름 호환 */
export type SessionTicket = Ticket;

/** 요청에 고정할 인증: 계정 확인 시점의 사용자와 그 사용자의 액세스 토큰 */
export interface SessionAuth {
  uid: string;
  accessToken: string;
}

export interface SessionGuard {
  /** 지금 화면이 알고 있는 사용자 ID (로그인 안 했으면 null) */
  readonly uid: string | null;
  readonly generation: number;
  /** 사용자 변경을 알린다 (인증 이벤트처럼 지금 이 순간의 정보일 때). 바뀌었으면 true. */
  setUser(uid: string | null): boolean;
  /**
   * 조회를 시작할 때의 세대(expectedGeneration)가 아직 그대로일 때만 사용자 변경을 반영한다.
   * 늦게 도착한 조회 결과가 그사이 반영된 더 새로운 계정 상태를 덮어쓰지 않게 한다.
   */
  setUserIfCurrent(uid: string | null, expectedGeneration: number): boolean;
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

  const change = (next: string | null) => {
    uid = next;
    generation += 1;
    listeners.forEach((fn) => fn(uid, generation));
    return true;
  };

  return {
    get uid() {
      return uid;
    },
    get generation() {
      return generation;
    },
    setUser(next) {
      if (disposed || next === uid) return false;
      return change(next);
    },
    setUserIfCurrent(next, expectedGeneration) {
      if (disposed || expectedGeneration !== generation || next === uid) return false;
      return change(next);
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

/** 액세스 토큰(JWT)의 사용자(sub). 형식이 틀리면 null. 서명 검증은 서버가 한다. */
export function tokenSubject(accessToken: string): string | null {
  const part = accessToken.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64)) as { sub?: unknown };
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export type Guarded<T> =
  | { ok: true; value: T; ticket: Ticket }
  | { ok: false; reason: "session_error" | "invalid_session" | "request_error"; ticket: Ticket }
  | { ok: false; reason: "account_changed" | "signed_out" | "closed" };

/**
 * 계정 확인 → 인증 고정 → 요청 → 응답 확인을 한 번에 한다.
 *  1) 호출한 화면에 고정된 표를 확인한다. 화면이 닫혔거나 표가 이미 무효면 보내지 않는다.
 *  2) 실제 세션(사용자 + 액세스 토큰)을 확인한다.
 *     - 확인하는 사이 표가 무효가 됐으면(다른 계정으로 바뀜) 즉시 끝낸다. 이 늦은 확인 결과로 보호 상태를 바꾸지 않는다.
 *     - 세션 사용자가 화면의 사용자와 다르면 보내지 않는다. 확인을 시작한 세대가 그대로일 때만 화면에 변경을 알린다.
 *     - 토큰의 사용자(sub)가 화면의 사용자와 다르면 보내지 않는다.
 *  3) send(auth)로 요청한다. send는 반드시 auth.accessToken으로 고정된 클라이언트를 써야 한다.
 *     → 확인 직후 다른 계정으로 바뀌어도, 요청은 확인한 계정의 인증으로 실행된다.
 *  4) 응답이 오면 화면이 닫혔는지, 그사이 사용자·세대가 바뀌었는지 확인한다. 바뀌었으면 버린다.
 */
export async function guardedRequest<T>(opts: {
  guard: SessionGuard;
  /** 호출한 화면의 계정·세대. 요청 순간의 guard에서 새로 받지 않는다. */
  ticket: Ticket;
  getSessionAuth: () => Promise<SessionAuth | null>;
  isMounted: () => boolean;
  send: (auth: SessionAuth) => Promise<T>;
}): Promise<Guarded<T>> {
  const { guard, ticket: t, getSessionAuth, isMounted, send } = opts;
  if (!isMounted()) return { ok: false, reason: "closed" };
  if (!guard.isCurrent(t)) return { ok: false, reason: t.uid === null ? "signed_out" : "account_changed" };

  let auth: SessionAuth | null;
  try {
    auth = await getSessionAuth();
  } catch {
    if (!isMounted()) return { ok: false, reason: "closed" };
    if (!guard.isCurrent(t)) return { ok: false, reason: guard.uid === null ? "signed_out" : "account_changed" };
    return { ok: false, reason: "session_error", ticket: t };
  }
  if (!isMounted()) return { ok: false, reason: "closed" };
  // 확인하는 사이 계정이 바뀌었다: 이 확인 결과는 이미 낡았으므로 보호 상태를 건드리지 않고 끝낸다.
  if (!guard.isCurrent(t)) return { ok: false, reason: guard.uid === null ? "signed_out" : "account_changed" };

  const sessionUid = auth?.uid ?? null;
  if (sessionUid !== t.uid) {
    // 화면은 아직 알림을 못 받았지만 실제 세션은 바뀌어 있음. 확인을 시작한 세대가 그대로일 때만 알린다.
    guard.setUserIfCurrent(sessionUid, t.generation);
    return { ok: false, reason: sessionUid === null ? "signed_out" : "account_changed" };
  }
  if (!auth || tokenSubject(auth.accessToken) !== t.uid) {
    return { ok: false, reason: "invalid_session", ticket: t };
  }

  let value: T;
  try {
    value = await send(auth);
  } catch {
    if (!isMounted()) return { ok: false, reason: "closed" };
    if (!guard.isCurrent(t)) return { ok: false, reason: guard.uid === null ? "signed_out" : "account_changed" };
    return { ok: false, reason: "request_error", ticket: t };
  }
  if (!isMounted()) return { ok: false, reason: "closed" };
  if (!guard.isCurrent(t)) return { ok: false, reason: guard.uid === null ? "signed_out" : "account_changed" };
  return { ok: true, value, ticket: t };
}
