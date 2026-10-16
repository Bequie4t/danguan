import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "../supabase/env";
import { deletionAllowed } from "./config";
import type { DeleteDependencies } from "./delete";

// 이번 구현은 승인된 분리 테스트 Preview에서만 활성화한다. 운영에서는 키가 있어도 차단한다.
export function deletionConfig() {
  const env = supabaseEnv();
  const key = process.env.SUPABASE_ACCOUNT_DELETE_KEY;
  if (!env || !key || !deletionAllowed(process.env.VERCEL_ENV, env.url, process.env.ACCOUNT_DELETE_PREVIEW_ENABLED, key)) return null;
  return { ...env, adminKey: key };
}

export function deletionDependencies(config: NonNullable<ReturnType<typeof deletionConfig>>): DeleteDependencies {
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const verifier = createClient(config.url, config.key, options);
  const admin = createClient(config.url, config.adminKey, options);
  return {
    async verify(token) {
      const { data, error } = await verifier.auth.getUser(token);
      if (error && ![400, 401, 403, 404].includes(error.status ?? 0)) throw new Error("verification_unavailable");
      if (data.user?.factors?.some(factor => factor.status === "verified")) throw new Error("mfa_deletion_not_enabled");
      return !error && data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    },
    async reauthenticate(email, password) {
      const isolated = createClient(config.url, config.key, options);
      const { data, error } = await isolated.auth.signInWithPassword({ email, password });
      if (error && error.code !== "invalid_credentials") throw new Error("reauthentication_unavailable");
      return !error && data.user && data.session ? { uid: data.user.id, token: data.session.access_token } : null;
    },
    async revoke(token, scope) { return !(await admin.auth.admin.signOut(token, scope)).error; },
    async remove(uid) {
      const { error } = await admin.auth.admin.deleteUser(uid, false);
      if (error) throw new Error("delete_result_unconfirmed");
      return true;
    },
  };
}
