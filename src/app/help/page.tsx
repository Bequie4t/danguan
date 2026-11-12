import type { Metadata } from "next";
import { CONTACTS, HELP_CHECKED_ON, LOCAL_CENTER, type HelpContact, type HelpSource } from "./contacts";

// 도움 화면 (3단계 새 디자인)
//  - 로그인·기록 저장·Supabase 코드를 가져오지 않는다 (tests/help-independence.test.ts로 확인).
//  - 109를 가장 크게, 그다음 1577-0199, 119·112는 나란히. 카드 전체가 전화 걸기 버튼.
//  - 연락처 문구·출처·확인 날짜는 contacts.ts 그대로 쓴다 (화면에서 바꾸거나 줄이지 않는다).
//  - 울이·장식 그림을 넣지 않는다. 번호가 가장 잘 보이게 둔다.
export const metadata: Metadata = { title: "도움 받기 · 404 blue" };
export const dynamic = "force-static";

const PRIMARY = "109";
const SECONDARY = "1577-0199";

function formatKoreanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function CallCard({ contact, kind }: { contact: HelpContact; kind: "primary" | "secondary" | "plain" }) {
  const look =
    kind === "primary"
      ? "bg-help-strong text-help-strong-fg p-4 min-[340px]:p-5 sm:p-6"
      : kind === "secondary"
        ? "bg-tint-sky text-fg p-4 min-[340px]:p-5"
        : "border border-line bg-surface text-fg p-4";
  // 좁은 화면(200% 확대 등)에서도 번호가 잘리지 않게 화면 폭에 따라 조금 줄인다. 109는 항상 가장 크다.
  const numberSize =
    kind === "primary"
      ? "text-[clamp(2.5rem,14vw,3rem)]"
      : kind === "secondary"
        ? "text-[clamp(1.25rem,8vw,1.875rem)]"
        : "text-[clamp(1.5rem,8vw,1.875rem)]";
  const detailColor = kind === "primary" ? "text-help-strong-fg/85" : "text-muted";
  return (
    <a
      href={`tel:${contact.tel}`}
      aria-label={`${contact.name} ${contact.number}로 전화 걸기. ${contact.detail}`}
      data-help-number={contact.number}
      className={`flex h-full min-h-14 rounded no-underline ${look} ${focusRing} ${
        kind === "plain" ? "flex-col gap-1.5" : "flex-wrap items-center justify-between gap-x-4 gap-y-2"
      }`}
    >
      {kind === "plain" ? (
        <>
          <span className={`font-label font-medium leading-none tracking-wide ${numberSize}`}>{contact.number}</span>
          <span className="font-semibold">{contact.name}</span>
          <span className={`text-sm leading-relaxed ${detailColor}`}>{contact.detail}</span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
            <span className="text-base font-bold">{contact.name}</span>
            <span className={`text-sm leading-relaxed ${detailColor}`}>{contact.detail}</span>
          </span>
          <span className={`font-label font-medium leading-none tracking-wide ${numberSize}`}>{contact.number}</span>
        </>
      )}
    </a>
  );
}

function SourceLinks({ sources }: { sources: HelpSource[] }) {
  return (
    <>
      {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && " · "}
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {s.label}
          </a>
        </span>
      ))}
    </>
  );
}

export default function HelpPage() {
  const checked = formatKoreanDate(HELP_CHECKED_ON);
  const primary = CONTACTS.find((c) => c.number === PRIMARY);
  const secondary = CONTACTS.find((c) => c.number === SECONDARY);
  const others = CONTACTS.filter((c) => c !== primary && c !== secondary);
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <span className="eyebrow">HELP NOW</span>
        <h1 className="text-2xl leading-snug font-bold">
          지금 바로
          <br />
          이야기할 수 있는 곳
        </h1>
        <p className="text-muted">
          로그인하지 않아도 이 화면은 열려요. 번호를 누르면 전화 앱으로 넘어가고, 번호를 보고 직접 걸 수도 있어요.
        </p>
      </div>

      <ul aria-label="전화로 연결할 수 있는 곳" className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-2">
        {primary && (
          <li className="min-[340px]:col-span-2">
            <CallCard contact={primary} kind="primary" />
          </li>
        )}
        {secondary && (
          <li className="min-[340px]:col-span-2">
            <CallCard contact={secondary} kind="secondary" />
          </li>
        )}
        {others.map((c) => (
          <li key={c.number}>
            <CallCard contact={c} kind="plain" />
          </li>
        ))}
      </ul>

      <section aria-labelledby="local-center" className="space-y-1.5 border-y border-line py-4">
        <h2 id="local-center" className="font-bold">
          {LOCAL_CENTER.title}
        </h2>
        <p className="text-[0.95rem] leading-relaxed">{LOCAL_CENTER.body}</p>
      </section>

      <section aria-labelledby="offline-help" className="space-y-3">
        <h2 id="offline-help" className="font-bold">
          인터넷이 없을 때를 대비하기
        </h2>
        <a
          href="/help/contact-card"
          download="danguan-help-contacts.txt"
          className={`flex min-h-12 w-full items-center justify-center rounded-full border border-fg px-5 text-center font-medium hover:bg-tint-sky ${focusRing}`}
        >
          인터넷 없이 볼 수 있게 연락처 저장
        </a>
        <p className="text-sm leading-relaxed text-muted">
          연락처 안내 파일을 미리 저장하면 인터넷 없이 읽을 수 있어요. 저장하지 않은 도움 화면은 오프라인에서 열리지 않을 수 있어요.
          전화 연결에는 통신망이 필요하고, 출처 링크는 인터넷이 필요해요.
        </p>
      </section>

      <section aria-labelledby="help-sources" className="space-y-2 text-sm text-muted">
        <h2 id="help-sources" className="font-semibold text-fg">
          확인한 곳
        </h2>
        <ul className="space-y-1.5">
          {CONTACTS.map((c) => (
            <li key={c.number}>
              {c.name} {c.number}: <SourceLinks sources={c.sources} />
            </li>
          ))}
          <li>
            정신건강복지센터: <SourceLinks sources={LOCAL_CENTER.sources} />
          </li>
        </ul>
        <p>위 연락처와 안내는 {checked}에 공식 기관 누리집을 기준으로 확인했어요. 운영 방식은 바뀔 수 있어요.</p>
        <p>이 화면은 상태를 판단하거나 안전을 보장하지 않아요. 위험하다고 느끼면 망설이지 말고 위 번호로 연락해 주세요.</p>
      </section>
    </div>
  );
}
