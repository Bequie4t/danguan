import { NavigatorLockAcquireTimeoutError, type AuthClient } from "@supabase/supabase-js";
import { TEST_DATABASE } from "../checkins/responseTest";

export function authTransactionsEnabled(database: string | undefined, enabled: string | undefined): boolean {
  return database === TEST_DATABASE && enabled === "true";
}
export class AuthTransactionTimeout extends NavigatorLockAcquireTimeoutError {
  constructor() { super("auth_transaction_wait_failed"); this.name = "AuthTransactionTimeout"; }
}
// SDK navigatorLock의 시간 초과 시 잠금 강탈 경로를 사용하지 않는다.
// 대기만 제한하고, 실행 중인 인증 작업의 잠금을 빼앗지 않는다.
export async function strictAuthLock<T>(name: string, timeout: number, work: () => Promise<T>, locks: LockManager | null | undefined = typeof navigator === "undefined" ? undefined : navigator.locks): Promise<T> {
  if (!locks) throw new Error("auth_transaction_lock_unavailable");
  if (timeout === 0) return locks.request(name, { mode: "exclusive", ifAvailable: true }, lock => {
    if (!lock) throw new AuthTransactionTimeout();
    return work();
  });
  const abort = new AbortController();
  const wait = timeout > 0 ? Math.min(timeout, 15000) : 5000;
  const timer = setTimeout(() => abort.abort(), wait);
  try {
    return await locks.request(name, { mode: "exclusive", signal: abort.signal }, async () => {
      clearTimeout(timer);
      return work();
    });
  } catch (error) {
    if (abort.signal.aborted) throw new AuthTransactionTimeout();
    throw error;
  } finally { clearTimeout(timer); }
}
export function withAuthTransaction<T>(base: string, work: () => Promise<T>, locks?: LockManager): Promise<T> {
  return strictAuthLock(`lock:${base}`, 5000, work, locks);
}
// password sign-in/sign-up do not acquire the SDK custom lock themselves.
// Initialize BEFORE taking the outer lock to avoid waiting for initialization inside it.
export async function authWriteTransaction<T>(auth: InstanceType<typeof AuthClient>, base: string, work: () => Promise<T>, locks?: LockManager): Promise<T> {
  const initialized = await auth.initialize();
  if (initialized.error) throw new Error("auth_transaction_initialization_failed");
  return withAuthTransaction(base, work, locks);
}
