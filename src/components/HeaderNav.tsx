"use client";

// 머리글의 화면 이동 링크 (로고·오늘 기록·내 기록).
//  - 일반 <a>를 쓴다: next/link는 홈·로그인 코드 묶음을 함께 참조해 도움 화면이 그 코드를 내려받게 만든다.
//  - 지금 보고 있는 화면의 링크를 다시 누르면 새로 열지 않는다 (작성 중인 입력이 사라지지 않도록).
//    대신 화면 맨 위로만 올린다. 새 탭·창으로 여는 조합키는 브라우저에 맡긴다.
//  - 도움 버튼은 여기 두지 않는다 (layout.tsx에서 항상 그대로 표시).
import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";

/** 이 링크가 지금 보고 있는 화면인지. 쿼리·해시와 끝의 / 는 무시한다. */
export function isCurrentPage(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const norm = (p: string) => (p.split(/[?#]/)[0].replace(/\/+$/, "") || "/");
  return norm(pathname) === norm(href);
}

/** 같은 화면 링크를 눌렀을 때 새로 열지 않을지 (조합키·가운데 클릭은 브라우저 기본 동작) */
export function shouldStay(pathname: string | null, href: string, e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  return isCurrentPage(pathname, href);
}

function NavLink({ href, className, children, label }: { href: string; className: string; children: React.ReactNode; label?: string }) {
  const pathname = usePathname();
  const current = isCurrentPage(pathname, href);
  return (
    <a
      href={href}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={(e) => {
        if (!shouldStay(pathname, href, e)) return;
        e.preventDefault();
        window.scrollTo({ top: 0 });
      }}
      className={className}
    >
      {children}
    </a>
  );
}

const item = "rounded-lg px-2.5 py-2 hover:bg-accent-soft aria-[current=page]:font-bold aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8";

export function HomeLink({ children }: { children: React.ReactNode }) {
  return (
    <NavLink href="/" label="404 blue 홈" className="flex flex-col leading-tight">
      {children}
    </NavLink>
  );
}

export default function HeaderNav() {
  return (
    <nav aria-label="주요 화면" className="flex items-center gap-1 text-[0.95rem]">
      <NavLink href="/today" className={item}>
        오늘 기록
      </NavLink>
      <NavLink href="/records" className={item}>
        내 기록
      </NavLink>
    </nav>
  );
}
