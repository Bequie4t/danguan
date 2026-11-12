import type { Metadata } from "next";
import HardDayCard from "@/components/HardDayCard";

// 힘든 날 카드 (6단계): 로그인 없이 쓴다. 이 기기에만 저장. 로그인·기록·Supabase 코드를 가져오지 않는다.
export const metadata: Metadata = { title: "힘든 날 카드 · 404 blue" };
export const dynamic = "force-static";

export default function HardDayPage() {
  return <HardDayCard />;
}
