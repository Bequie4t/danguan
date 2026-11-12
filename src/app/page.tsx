import Link from "next/link";
import Uli from "@/components/Uli";

// 1단계(디자인 기초): 새 색·글꼴·울이를 입힌 홈. 홈에서 바로 기록하기는 2단계에서 붙인다.
export default function Home() {
  return (
    <div className="space-y-8">
      <section className="flex items-center gap-4 rounded bg-tint-sky p-5">
        <div className="shrink-0">
          <Uli state="rest" size={112} decorative />
        </div>
        <div className="space-y-1">
          <p className="eyebrow">TODAY</p>
          <h1 className="text-2xl font-bold">지금 필요한 것부터 시작하세요.</h1>
          <p className="text-muted">매일 쓰지 않아도 괜찮아요. 남기고 싶을 때 한 번만 고르면 돼요.</p>
        </div>
      </section>

      <section aria-labelledby="daily" className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 id="daily" className="text-lg font-semibold">일상에서 도움받기</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/today" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">오늘 기록</p>
            <p className="mt-1 text-muted">지금 버거운 정도를 한 번 고르면 저장돼요.</p>
          </Link>
          <Link href="/records" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">내 기록</p>
            <p className="mt-1 text-muted">남긴 기록을 보고 고치거나 지울 수 있어요.</p>
          </Link>
        </div>
      </section>

      <section aria-labelledby="explore" className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 id="explore" className="text-lg font-semibold">내 마음 알아보기</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <p className="rounded border border-dashed border-line p-5 text-muted">
          진료처 찾기와 진료 준비는 다음 단계에서 열려요.
        </p>
      </section>

      <Link href="/help" className="block rounded bg-help-soft p-5 text-help">
        <span className="font-semibold">지금 많이 힘들다면</span>
        <span className="mt-1 block">바로 연결할 수 있는 상담 전화를 볼 수 있어요. 로그인하지 않아도 돼요.</span>
      </Link>
    </div>
  );
}
