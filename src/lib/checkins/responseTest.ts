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
  let release: (() => void) | null = null;
  const wrapped: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), typeof location === "undefined" ? TEST_DATABASE : location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const mine = generation;
    const writeTarget = holdWrite !== null && url.origin === TEST_DATABASE && url.pathname === `/rest/v1/rpc/${holdWrite}` && method === "POST";
    if (writeTarget) {
      holdWrite = null;
      const response = await original(input, init);
      if (!response.ok || mine !== generation) return response;
      await new Promise<void>(resolve => {
        release = resolve;
        notify("저장·수정·삭제 성공 응답을 보류했습니다. 같은 주소의 다른 탭에서 B로 전환하고, 이 탭의 B 화면을 확인한 뒤 보류 응답을 전달하세요.");
      });
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
      release = null;
      notify("보류한 이전 조회 응답을 전달했습니다. 이전 계정 기록이 나타나지 않는지 확인하세요.");
      return response;
    }
    const target = armed && url.origin === TEST_DATABASE && url.pathname === "/rest/v1/rpc/create_checkin" && method === "POST";
    if (!target) return original(input, init);
    armed = false;
    const response = await original(input, init);
    if (mine !== generation) return response;
    if (!response.ok) {
      notify("서버가 거절하여 응답 유실 시험은 적용되지 않았습니다. 다시 준비해 주세요.");
      return response;
    }
    notify("서버 성공 응답을 확인하고 화면 전달을 중단했습니다. 입력 유지 확인 후 다시 저장하기를 누르세요.");
    throw new TypeError("Synthetic response loss");
  };
  return {
    fetch: wrapped,
    arm: () => { generation++; release?.(); armed = true; holdList = false; holdWrite = null; },
    holdNextList: () => { generation++; release?.(); holdList = true; armed = false; holdWrite = null; },
    holdNextWrite: (operation: "create_checkin" | "update_checkin" | "delete_checkin") => {
      generation++; release?.(); holdWrite = operation; armed = false; holdList = false;
    },
    release: () => { release?.(); },
    cancel: () => { generation++; armed = false; holdList = false; holdWrite = null; release?.(); },
  };
}
