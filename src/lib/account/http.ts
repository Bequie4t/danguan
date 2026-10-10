// Next.js 로컬 서버가 request.url의 호스트를 localhost로 정규화할 수 있다.
// 실제 수신 Host와 URL의 프로토콜을 대조한다. X-Forwarded-Host는 신뢰하지 않는다.
export function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url);
  const host = request.headers.get("host");
  if (host) {
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return false;
    expected.host = host;
  }
  return request.headers.get("origin") === expected.origin;
}
