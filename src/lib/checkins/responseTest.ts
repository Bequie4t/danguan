// 미리보기 전용 시험. 인증 정보나 요청 본문을 수집하지 않는다.
export const TEST_DATABASE = "https://wxqmqksqjmfflzghozuq.supabase.co";

export function responseTestEnabled(environment: string | undefined, database: string | undefined): boolean {
  return environment === "preview" && database === TEST_DATABASE;
}

export function createResponseLossTest(original: typeof fetch, notify: (message: string) => void) {
  let armed = false;
  let holdList = false;
  let holdWrite: string | null = null;
  let generation = 0;
  let retryId: string | null = null;
  let release: (() => void) | null = null;
  const finishHold = () => {
    const pending = release;
    release = null;
    pending?.();
  };
  const wrapped: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), typeof location === "undefined" ? TEST_DATABASE : location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const mine = generation;
    const isCreate = url.origin === TEST_DATABASE && url.pathname === "/rest/v1/rpc/create_checkin" && method === "POST";
    // 응답 유실 시험 중에만 공개 기록 ID를 비교한다. 본문은 보관하거나 출력하지 않는다.
    let requestId: string | null = null;
    if (isCreate && (armed || retryId !== null)) {
      try {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : input instanceof Request ? await input.clone().json() : null;
        requestId = typeof body?.p_id === "string" ? body.p_id : null;
      } catch { /* 비교할 수 없으면 미확인으로 표시한다. 요청은 정상 전달한다. */ }
      if (!armed && retryId !== null) {
        notify(requestId === null ? "재시도 요청 ID를 확인하지 못했습니다." : requestId === retryId
          ? "재시도 요청 ID가 최초 요청과 같습니다. DB 기록 수와 저장 완료도 확인하세요."
          : "재시도 요청 ID가 최초 요청과 다릅니다. 시험을 멈추고 결과를 확인하세요.");
        retryId = null;
      }
    }
    const writeTarget = holdWrite !== null && url.origin === TEST_DATABASE && url.pathname === `/rest/v1/rpc/${holdWrite}` && method === "POST";
    if (writeTarget) {
      holdWrite = null;
      const response = await original(input, init);
      if (!response.ok || mine !== generation) return response;
      await new Promise<void>(resolve => {
        release = resolve;
        notify("저장·수정·삭제 성공 응답을 보류했습니다. 같은 주소의 다른 탭에서 B로 전환하고, 이 탭의 B 화면을 확인한 뒤 보류 응답을 전달하세요.");
      });
      if (mine !== generation) return response;
      release = null;
      notify("보류한 쓰기 응답을 전달했습니다. 새 계정의 입력과 기록이 바뀌지 않는지 확인하세요.");
      return response;
    }
    if (holdList && url.origin === TEST_DATABASE && url.pathname === "/rest/v1/checkins" && method === "GET") {
      holdList = false;
      const response = await original(input, init);
      if (mine !== generation) return response;
      if (!response.ok) {
        notify("조회가 실패하여 지연 시험을 적용하지 않았습니다.");
        return response;
      }
      await new Promise<void>(resolve => {
        release = resolve;
        notify("조회 성공 응답을 보류했습니다. 다른 탭에서 A 로그아웃 후 B 로그인하고, 이 화면에 B 기록이 뜨면 보류 응답 전달을 누르세요.");
      });
      if (mine !== generation) return response;
      release = null;
      notify("보류한 이전 조회 응답을 전달했습니다. 이전 계정 기록이 나타나지 않는지 확인하세요.");
      return response;
    }
    const target = armed && url.origin === TEST_DATABASE && url.pathname === "/rest/v1/rpc/create_checkin" && method === "POST";
    if (!target) return original(input, init);
    armed = false;
    retryId = requestId;
    const response = await original(input, init);
    if (mine !== generation) return response;
    if (!response.ok) {
      retryId = null;
      notify("서버가 거절하여 응답 유실 시험은 적용되지 않았습니다. 다시 준비해 주세요.");
      return response;
    }
    notify(requestId === null
      ? "서버 성공 응답을 중단했습니다. 요청 ID는 확인하지 못했습니다. 입력 유지 확인 후 다시 저장하기를 누르세요."
      : "서버 성공 응답을 중단하고 최초 요청 ID를 비교용으로 보관했습니다. 입력 유지 확인 후 다시 저장하기를 한 번 누르세요.");
    throw new TypeError("Synthetic response loss");
  };
  return {
    fetch: wrapped,
    arm: () => { generation++; retryId = null; finishHold(); armed = true; holdList = false; holdWrite = null; },
    holdNextList: () => { generation++; retryId = null; finishHold(); holdList = true; armed = false; holdWrite = null; },
    holdNextWrite: (operation: "create_checkin" | "update_checkin" | "delete_checkin") => {
      generation++; retryId = null; finishHold(); holdWrite = operation; armed = false; holdList = false;
    },
    release: () => {
      const pending = release;
      if (!pending) {
        notify("전달할 보류 응답이 없습니다. 화면이 다시 열리거나 시험이 취소됐을 수 있어요. 이번 지연 시험은 완료로 기록하지 마세요.");
        return false;
      }
      release = null;
      pending();
      return true;
    },
    cancel: () => { generation++; retryId = null; armed = false; holdList = false; holdWrite = null; finishHold(); },
  };
}
