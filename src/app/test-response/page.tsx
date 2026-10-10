import { notFound } from "next/navigation";
import ResponseTest from "./response-test";
import { responseTestEnabled } from "@/lib/checkins/responseTest";

export const dynamic = "force-dynamic";

export default function ResponseTestPage() {
  if (!responseTestEnabled(process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  return <ResponseTest />;
}
