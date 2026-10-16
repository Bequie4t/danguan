// 처리 로직은 인증·관리자 클라이언트를 주입해 가상 계정으로 시험한다.
export interface AccountUser { id: string; email: string | null }
export interface DeleteDependencies {
  verify(token: string): Promise<AccountUser | null>;
  reauthenticate(email: string, password: string): Promise<{ uid: string; token: string } | null>;
  revoke(token: string, scope: "global" | "local"): Promise<boolean>;
  remove(uid: string): Promise<boolean>;
}
export type DeleteResult = "deleted" | "signed_out" | "account_changed" | "wrong_password" | "unavailable" | "revoke_failed" | "delete_failed" | "uncertain";

export async function deleteOwnAccount(
  dependencies: DeleteDependencies,
  input: { token: string; expectedUid: string; password: string },
): Promise<DeleteResult> {
  let freshToken: string | null = null;
  let destructiveRequestStarted = false;
  try {
    const user = await dependencies.verify(input.token);
    if (!user) return "signed_out";
    if (user.id !== input.expectedUid) return "account_changed";
    if (!user.email) return "unavailable";
    const fresh = await dependencies.reauthenticate(user.email, input.password);
    if (!fresh) return "wrong_password";
    freshToken = fresh.token;
    if (fresh.uid !== user.id) return "account_changed";
    const current = await dependencies.verify(input.token);
    if (!current) return "signed_out";
    if (current.id !== user.id) return "account_changed";
    if (!await dependencies.revoke(fresh.token, "global")) return "revoke_failed";
    freshToken = null;
    destructiveRequestStarted = true;
    return await dependencies.remove(user.id) ? "deleted" : "delete_failed";
  } catch {
    // 삭제 요청 뒤의 통신 오류는 결과가 불확실하다. 원문 오류·비밀값은 출력하지 않는다.
    return destructiveRequestStarted ? "uncertain" : "unavailable";
  } finally {
    if (freshToken) {
      try { await dependencies.revoke(freshToken, "local"); } catch { /* 원문 출력 없음 */ }
    }
  }
}
