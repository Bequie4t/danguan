import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingScript from "@/components/BookingScript";
import { bookingOpen } from "@/lib/launch";

// 예약 대본 (5단계): 로그인 없이 쓸 수 있다. 로그인·기록·Supabase 코드를 가져오지 않는다.
// 법률 검토 전까지 운영 사이트에서는 없는 화면(404)으로 둔다 (src/lib/launch).
export const metadata: Metadata = { title: "병원 예약 대본 · 404 blue" };
export const dynamic = "force-static";

export default function BookingPage() {
  if (!bookingOpen(process.env.VERCEL_ENV)) notFound();
  return <BookingScript />;
}
