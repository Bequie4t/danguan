// 이 플래그는 SDK 설치 패치와 함께 동작한다. 분리 테스트 클라이언트에만 설정한다.
// 권한·인증 성공을 만들어내지 않고, 다른 세션에 속한 이전 갱신 실패를 폐기한다.
export function enableTestRefreshGuard(auth: object): void {
  Object.defineProperty(auth, Symbol.for("danguan.test.refresh-subject-guard"), { value: true });
}
