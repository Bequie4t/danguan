import type { SupabaseClient } from "@supabase/supabase-js";
import { CONSENT_KEY, CONSENT_POLICY_VERSION } from "@/lib/checkins/model";

export type ConsentState = "granted" | "missing" | "error";

export async function getStorageConsent(supabase: SupabaseClient): Promise<ConsentState> {
  try {
    const { data, error } = await supabase
      .from("consents")
      .select("id")
      .eq("consent_key", CONSENT_KEY)
      .is("withdrawn_at", null)
      .limit(1);
    if (error) return "error";
    return data && data.length > 0 ? "granted" : "missing";
  } catch {
    return "error";
  }
}

export async function grantStorageConsent(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("consents")
      .insert({ consent_key: CONSENT_KEY, policy_version: CONSENT_POLICY_VERSION });
    return !error;
  } catch {
    return false;
  }
}
