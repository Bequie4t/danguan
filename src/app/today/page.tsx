import AuthScope from "@/components/AuthScope";
import CheckinForm from "@/components/CheckinForm";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  return (
    <AuthScope>
      <CheckinForm />
    </AuthScope>
  );
}
