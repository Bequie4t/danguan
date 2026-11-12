import type { Metadata } from "next";
import BookingScript from "@/components/BookingScript";

// 예약 대본 (5단계): 로그인 없이 쓸 수 있다. 로그인·기록·Supabase 코드를 가져오지 않는다.
export const metadata: Metadata = { title: "병원 예약 대본 · 404 blue" };
export const dynamic = "force-static";

export default function BookingPage() {
  return <BookingScript />;
}
