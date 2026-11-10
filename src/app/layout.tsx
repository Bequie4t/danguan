import type { Metadata, Viewport } from "next";
import { Gothic_A1, Jost } from "next/font/google";
import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import "./globals.css";

// 글꼴은 빌드할 때 내려받아 이 사이트에서 직접 제공한다.
// 그래서 방문할 때 구글 서버로 요청이 가지 않는다.
const gothic = Gothic_A1({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-gothic",
});

const jost = Jost({
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jost",
});

export const metadata: Metadata = {
  title: "404 blue",
  description: "당신의 우울은 안녕하신가요 — 기록 부담은 적게, 진료 준비와 일상 도움은 쉽게",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${gothic.variable} ${jost.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          본문으로 건너뛰기
        </a>
        <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <Link href="/" className="flex flex-col leading-tight" aria-label="404 blue 홈">
              <span className="font-label text-xl font-medium tracking-wide">
                404 <span className="text-brand">blue</span>
              </span>
              <span className="text-[0.625rem] tracking-wider text-muted">당신의 우울은 안녕하신가요</span>
            </Link>
            <nav aria-label="주요 화면" className="flex items-center gap-1 text-[0.95rem]">
              <Link href="/today" className="rounded-lg px-2.5 py-2 hover:bg-accent-soft">
                오늘 기록
              </Link>
              <Link href="/records" className="rounded-lg px-2.5 py-2 hover:bg-accent-soft">
                내 기록
              </Link>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <AccountMenu />
              {/* 도움 버튼: 로그인·저장 상태와 상관없이 항상 표시. 가장 진한 색으로 눈에 띄게 둔다. */}
              <Link
                href="/help"
                className="flex min-h-11 items-center rounded-full bg-help-strong px-4 text-[0.95rem] font-semibold text-help-strong-fg hover:opacity-90"
              >
                도움이 필요해요
              </Link>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-6">
          {children}
        </main>
      </body>
    </html>
  );
}
