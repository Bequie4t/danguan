import { TEST_DATABASE } from "../checkins/responseTest";

// 서버 쿠키 갱신을 생략하는 인증 방식은 승인된 분리 Preview에만 적용한다.
export function browserOnlyPageAuth(environment: string | undefined, database: string | undefined, enabled: string | undefined, path: string): boolean {
  return environment === "preview" && database === TEST_DATABASE && enabled === "true"
    && !path.startsWith("/auth/") && !path.startsWith("/api/");
}
