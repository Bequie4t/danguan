import type { Metadata } from "next";
import AuthScope from "@/components/AuthScope";
import VisitMemo from "@/components/VisitMemo";

// 진료 준비 메모: 로그인한 사람의 기록으로만 만든다. 개인 기록 화면이므로 캐시하지 않는다 (미들웨어).
export const metadata: Metadata = { title: "진료 준비 메모 · 404 blue" };
export const dynamic = "force-dynamic";

export default function VisitPage() {
  return (
    <AuthScope>
      <VisitMemo />
    </AuthScope>
  );
}
