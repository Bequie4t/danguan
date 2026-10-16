import { TEST_DATABASE } from "../checkins/responseTest";

export type RefreshTestStage = "idle" | "armed" | "held" | "released" | "not_held" | "cancelled";
export function refreshTestEnabled(environment: string | undefined, database: string | undefined, enabled: string | undefined, browserAuth: string | undefined): boolean {
  return environment === "preview" && database === TEST_DATABASE && enabled === "true" && browserAuth === "true";
}

// Only the designated TEST refresh response is delayed. Bodies/credentials are never inspected.
export function createRefreshResponseTest(original: typeof fetch, notify: (stage: RefreshTestStage) => void) {
  let armed = false;
  let active = false;
  let generation = 0;
  let resume: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unblock = () => { clearTimeout(timer); timer = undefined; const resolve = resume; resume = null; resolve?.(); };
  const cancel = () => { if (!armed && !active && !resume) return; generation++; armed = false; unblock(); notify("cancelled"); };
  const wrapped: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    let url: URL;
    try { url = new URL(request?.url ?? String(input), TEST_DATABASE); }
    catch { return original(input, init); }
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const target = armed && url.origin === TEST_DATABASE && url.pathname === "/auth/v1/token"
      && url.searchParams.get("grant_type") === "refresh_token" && method === "POST";
    if (!target) return original(input, init);
    armed = false; active = true;
    const mine = generation;
    try {
      const response = await original(input, init);
      if (mine !== generation) return response;
      if (!response.ok) { notify("not_held"); return response; }
      await new Promise<void>(resolve => { resume = resolve; notify("held"); });
      return response;
    } catch (error) {
      if (mine === generation) notify("not_held");
      throw error;
    } finally { clearTimeout(timer); timer = undefined; active = false; }
  };
  return {
    fetch: wrapped,
    arm() { if (active || armed) return; armed = true; timer = setTimeout(cancel, 10_000); notify("armed"); },
    release() { if (!resume) { notify("not_held"); return; } unblock(); notify("released"); },
    cancel,
  };
}

export async function runRefreshTest(
  auth: Pick<import("@supabase/supabase-js").SupabaseClient["auth"], "getSession" | "getUser" | "refreshSession">,
  current: () => boolean, uid: string, beforeRefresh: () => void,
): Promise<"success" | "failed" | "changed"> {
  try {
    const snapshot = await auth.getSession();
    const session = snapshot.data.session;
    if (snapshot.error || !session?.refresh_token || session.user.id !== uid || !current()) return current() ? "failed" : "changed";
    const verified = await auth.getUser(session.access_token);
    if (verified.error || verified.data.user?.id !== uid || !current()) return current() ? "failed" : "changed";
    beforeRefresh();
    // Let SDK resolve the CURRENT session inside its own lock. Never forward a pre-lock token.
    const refreshed = await auth.refreshSession();
    return !current() ? "changed" : refreshed.error ? "failed" : "success";
  } catch { return current() ? "failed" : "changed"; }
}
