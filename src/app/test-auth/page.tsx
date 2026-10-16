import { notFound } from "next/navigation";
import { refreshTestEnabled } from "@/lib/account/refreshTest";
import AuthTest from "./auth-test";
export const dynamic = "force-dynamic";
export default function AuthTestPage() {
  if (!refreshTestEnabled(process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_TEST_AUTH_TRANSACTION_LOCK_ENABLED, process.env.TEST_BROWSER_AUTH_PREVIEW_ENABLED)) notFound();
  return <AuthTest />;
}
