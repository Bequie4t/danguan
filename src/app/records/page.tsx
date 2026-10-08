import AuthScope from "@/components/AuthScope";
import RecordList from "@/components/RecordList";

export const dynamic = "force-dynamic";

export default function RecordsPage() {
  return (
    <AuthScope>
      <RecordList />
    </AuthScope>
  );
}
