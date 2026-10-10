import ConsentForm from "@/components/ConsentForm";
import AuthScope from "@/components/AuthScope";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <AuthScope><ConsentForm next={safeNext(sp.next)} /></AuthScope>;
}
