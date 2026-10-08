// 계정 전환 보호. 외부 라이브러리 없음 (단위 테스트 대상).
//
// 요청을 시작할 때 "누가, 몇 번째 세션 세대에서" 보냈는지 표(ticket)를 받아 두고,
// 응답이 왔을 때 지금 화면의 사용자·세대와 같을 때만 화면에 반영한다.
// 로그아웃·다른 계정 로그인으로 사용자가 바뀌면 세대가 올라가므로, 이전 사용자의 늦은 응답은 버려진다.

export interface SessionTicket {
  readonly uid: string | null;
  readonly generation: number;
}

export interface SessionGuard {
  /** 현재 사용자. 사용자가 바뀌었으면 세대를 올리고 true */
  setUser(uid: string | null): boolean;
  readonly uid: string | null;
  readonly generation: number;
  /** 요청 시작 시 받는 표 */
  ticket(): SessionTicket;
  /** 응답 반영 전 확인: 같은 사용자·같은 세대이고, 로그인 상태일 때만 true */
  isCurrent(t: SessionTicket): boolean;
}

export function createSessionGuard(initialUid: string | null = null): SessionGuard {
  let uid = initialUid;
  let generation = 0;
  return {
    setUser(next) {
      if (next === uid) return false;
      uid = next;
      generation += 1;
      return true;
    },
    get uid() {
      return uid;
    },
    get generation() {
      return generation;
    },
    ticket() {
      return { uid, generation };
    },
    isCurrent(t) {
      return t.uid !== null && t.uid === uid && t.generation === generation;
    },
  };
}

/** 서버가 돌려준 기록이 요청한 사용자의 것인지 (화면 반영 전 한 번 더 확인) */
export function ownedBy(record: { owner_id: string }, t: SessionTicket): boolean {
  return t.uid !== null && record.owner_id === t.uid;
}
