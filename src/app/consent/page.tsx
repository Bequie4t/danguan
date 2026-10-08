import ConsentForm from "@/components/ConsentForm";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <ConsentForm next={safeNext(sp.next)} />;
}
