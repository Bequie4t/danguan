import type { Metadata, Viewport } from "next";
import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "당우안",
  description: "기록 부담은 적게, 진료 준비와 일상 도움은 쉽게",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          본문으로 건너뛰기
        </a>
        <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              당우안
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
              {/* 도움 버튼: 로그인·저장 상태와 상관없이 항상 표시 */}
              <Link
                href="/help"
                className="rounded-full bg-help-soft px-3.5 py-2 text-[0.95rem] font-semibold text-help hover:opacity-90"
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
