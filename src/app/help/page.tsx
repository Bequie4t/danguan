import type { Metadata } from "next";
import { CONTACTS, HELP_CHECKED_ON, LOCAL_CENTER, type HelpSource } from "./contacts";

export const metadata: Metadata = { title: "도움 받기 · 당우안" };
export const dynamic = "force-static";

function formatKoreanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function Sources({ sources }: { sources: HelpSource[] }) {
  return (
    <p className="mt-2 text-xs text-muted">
      출처:{" "}
      {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && " · "}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {s.label}
          </a>
        </span>
      ))}
    </p>
  );
}

export default function HelpPage() {
  const checked = formatKoreanDate(HELP_CHECKED_ON);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">지금 바로 연결할 수 있는 곳</h1>
        <p className="text-muted">
          로그인하지 않아도 이 화면은 열려요. 번호를 누르면 전화 앱으로 넘어가고, 번호를 보고 직접 걸 수도 있어요.
        </p>
      </div>

      <section aria-labelledby="offline-help" className="space-y-2 rounded-2xl border border-line p-4">
        <h2 id="offline-help" className="font-semibold">인터넷이 없을 때를 대비하기</h2>
        <p className="text-sm text-muted">
          연락처 안내 파일을 미리 저장하면 인터넷 없이 읽을 수 있어요. 저장하지 않은 도움 화면은 오프라인에서 열리지 않을 수 있어요.
          전화 연결에는 통신망이 필요하고, 출처 링크는 인터넷이 필요해요.
        </p>
        <a href="/help/contact-card" download="danguan-help-contacts.txt" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 py-2 hover:bg-help-soft">
          연락처 안내 파일 저장
        </a>
      </section>

      <ul className="space-y-3">
        {CONTACTS.map((c) => (
          <li key={c.number} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{c.name}</p>
                <p className="text-sm text-muted">{c.detail}</p>
              </div>
              <a
                href={`tel:${c.tel}`}
                className="inline-flex min-h-14 items-center rounded-xl bg-help px-5 text-xl font-bold tracking-wide text-white select-all dark:text-[#1a0f11]"
                aria-label={`${c.name} ${c.number}로 전화 걸기`}
              >
                {c.number}
              </a>
            </div>
            <Sources sources={c.sources} />
          </li>
        ))}
      </ul>

      <section className="rounded-2xl bg-help-soft p-4 text-[0.98rem]">
        <h2 className="font-semibold">{LOCAL_CENTER.title}</h2>
        <p className="mt-1">{LOCAL_CENTER.body}</p>
        <Sources sources={LOCAL_CENTER.sources} />
      </section>

      <div className="space-y-1 text-sm text-muted">
        <p>
          위 연락처와 안내는 {checked}에 공식 기관 누리집을 기준으로 확인했어요. 운영 방식은 바뀔 수 있어요.
        </p>
        <p>
          이 화면은 상태를 판단하거나 안전을 보장하지 않아요. 위험하다고 느끼면 망설이지 말고 위 번호로 연락해 주세요.
        </p>
      </div>
    </div>
  );
}
