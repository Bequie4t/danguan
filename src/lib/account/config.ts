import { TEST_DATABASE } from "../checkins/responseTest";

export function deletionAllowed(environment: string | undefined, database: string | undefined, enabled: string | undefined, key: string | undefined): boolean {
  if (environment !== "preview" || database !== TEST_DATABASE || enabled !== "true" || !key) return false;
  if (key.startsWith("sb_secret_")) return key.length > 20;
  try {
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return claims.role === "service_role" && claims.ref === "wxqmqksqjmfflzghozuq";
  } catch { return false; }
}
