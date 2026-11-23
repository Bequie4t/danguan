import type { Metadata } from "next";
import TodayMinimum from "@/components/TodayMinimum";

// 오늘 최소한 (PRD B2): 로그인 없이 쓴다. 이 기기에만 저장. 로그인·기록·Supabase 코드를 가져오지 않는다.
export const metadata: Metadata = { title: "오늘 최소한 · 404 blue" };
export const dynamic = "force-static";

export default function MinimumPage() {
  return <TodayMinimum />;
}
