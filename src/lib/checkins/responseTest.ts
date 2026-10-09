// 미리보기 전용 시험. 인증 정보나 요청 본문을 수집하지 않는다.
export const TEST_DATABASE = "https://wxqmqksqjmfflzghozuq.supabase.co";

export function responseTestEnabled(environment: string | undefined, database: string | undefined): boolean {
  return environment === "preview" && database === TEST_DATABASE;
}

export function createResponseLossTest(original: typeof fetch, notify: (message: string) => void) {
  let armed = false;
  const wrapped: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), typeof location === "undefined" ? TEST_DATABASE : location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const target = armed && url.origin === TEST_DATABASE && url.pathname === "/rest/v1/rpc/create_checkin" && method === "POST";
    if (!target) return original(input, init);
    armed = false;
    const response = await original(input, init);
    if (!response.ok) {
      notify("서버가 거절하여 응답 유실 시험은 적용되지 않았습니다. 다시 준비해 주세요.");
      return response;
    }
    notify("서버 성공 응답을 확인하고 화면 전달을 중단했습니다. 입력 유지 확인 후 다시 저장하기를 누르세요.");
    throw new TypeError("Synthetic response loss");
  };
  return {
    fetch: wrapped,
    arm: () => { armed = true; },
    cancel: () => { armed = false; },
  };
}
