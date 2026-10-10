/** 로그인 후 이동할 주소는 이 사이트 안의 경로만 허용한다. */
export function safeNext(value: string | null | undefined, fallback = "/today"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
