import AuthScope from "@/components/AuthScope";
import AccountDeletion from "@/components/AccountDeletion";
import { deletionConfig } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return <AuthScope><AccountDeletion enabled={deletionConfig() !== null} /></AuthScope>;
}
