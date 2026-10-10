import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">지금 필요한 것부터 시작하세요.</h1>
        <p className="text-muted">매일 쓰지 않아도 괜찮아요. 남기고 싶을 때 한 번만 고르면 돼요.</p>
      </div>

      <section aria-labelledby="daily" className="space-y-3">
        <h2 id="daily" className="text-lg font-semibold">일상에서 도움받기</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/today" className="rounded-2xl border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">오늘 기록</p>
            <p className="mt-1 text-muted">지금 버거운 정도를 한 번 고르면 저장돼요.</p>
          </Link>
          <Link href="/records" className="rounded-2xl border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">내 기록</p>
            <p className="mt-1 text-muted">남긴 기록을 보고 고치거나 지울 수 있어요.</p>
          </Link>
        </div>
      </section>

      <section aria-labelledby="explore" className="space-y-2">
        <h2 id="explore" className="text-lg font-semibold">내 마음 알아보기</h2>
        <p className="rounded-2xl border border-dashed border-line p-5 text-muted">
          진료처 찾기와 진료 준비는 다음 단계에서 열려요.
        </p>
      </section>

      <Link href="/help" className="block rounded-2xl bg-help-soft p-5 text-help">
        <span className="font-semibold">지금 많이 힘들다면</span>
        <span className="mt-1 block">바로 연결할 수 있는 상담 전화를 볼 수 있어요. 로그인하지 않아도 돼요.</span>
      </Link>
    </div>
  );
}
