import Link from "next/link";
import HomeCheckin from "@/components/HomeCheckin";

// 홈: 위쪽에서 버거움을 한 번 눌러 바로 남긴다(HomeCheckin). 아래는 다른 화면으로 가는 길.
export default function Home() {
  return (
    <div className="space-y-8">
      <HomeCheckin />

      <section aria-labelledby="daily" className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 id="daily" className="text-lg font-semibold">일상에서 도움받기</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/today" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">자세히 기록하기</p>
            <p className="mt-1 text-muted">생활 항목·메모·지난 일 돌아보기를 함께 남겨요.</p>
          </Link>
          <Link href="/records" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">내 기록</p>
            <p className="mt-1 text-muted">남긴 기록을 보고 고치거나 지울 수 있어요.</p>
          </Link>
          <a href="/hardday" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">힘든 날 카드</p>
            <p className="mt-1 text-muted">괜찮은 날 먹을 것·부탁 문장을 적어 두고, 힘든 날 꺼내 써요. 이 기기에만 저장해요.</p>
          </a>
          <a href="/ask" className="rounded border border-line bg-surface p-5 hover:border-accent">
            <p className="text-lg font-semibold">부탁하기</p>
            <p className="mt-1 text-muted">“도와줘” 대신 할 일 하나를 건네는 문장을 만들어요. 보내는 건 내가 직접 해요.</p>
          </a>
        </div>
      </section>

      <section aria-labelledby="explore" className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 id="explore" className="text-lg font-semibold">내 마음 알아보기</h2>
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </div>
        <a href="/booking" className="block rounded border border-line bg-surface p-5 hover:border-accent">
          <p className="text-lg font-semibold">병원 예약 대본</p>
          <p className="mt-1 text-muted">예약 전화에서 할 말을 순서대로 만들어요. 비용·진료 기록 걱정도 함께 풀어 봐요.</p>
        </a>
        <p className="rounded border border-dashed border-line p-5 text-muted">진료 준비(한 장 요약)는 다음 단계에서 열려요.</p>
      </section>

      <Link href="/help" className="block rounded bg-help-soft p-5 text-help">
        <span className="font-semibold">지금 많이 힘들다면</span>
        <span className="mt-1 block">바로 연결할 수 있는 상담 전화를 볼 수 있어요. 로그인하지 않아도 돼요.</span>
      </Link>
    </div>
  );
}
