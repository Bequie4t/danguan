import type { Metadata } from "next";
import AskBuilder from "@/components/AskBuilder";

// 부탁하기: 로그인 없이 쓴다. 저장·전송하지 않으므로 로그인·저장 코드를 가져오지 않는다
// (tests/ask.test.ts의 독립성 시험으로 확인). 미들웨어도 거치지 않는다.
export const metadata: Metadata = { title: "부탁하기 · 404 blue" };
export const dynamic = "force-static";

export default function AskPage() {
  return <AskBuilder />;
}
