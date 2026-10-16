import { redirect } from "next/navigation";
import CallbackConfirmation from "@/components/CallbackConfirmation";
import { browserOnlyPageAuth } from "@/lib/account/browserAuthConfig";
export const dynamic = "force-dynamic";
export default function CallbackCompletePage() {
  if (!browserOnlyPageAuth(process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.TEST_BROWSER_AUTH_PREVIEW_ENABLED, "/auth/complete")) redirect("/login?error=link");
  return <CallbackConfirmation />;
}
