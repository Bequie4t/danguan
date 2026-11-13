// 페이지를 떠나기 전 확인(beforeunload)의 예외: 도움 링크.
//
// 기록을 저장하는 중이거나 저장에 실패한 화면은 창을 닫거나 다른 곳으로 갈 때 브라우저가 묻는다.
// 하지만 '도움이 필요해요'처럼 data-leave-ok 표시가 있는 링크는 묻지 않고 바로 이동해야 한다
// (CLAUDE.md 3장: 도움 버튼을 약화하지 않는다). 확인창에서 '취소'를 누르면 도움 화면으로 못 가기 때문이다.
//
// 링크 자체에는 코드가 없다 (layout의 일반 <a>에 data-leave-ok 속성만). 도움 화면은 이 파일을 불러오지 않는다.
// 확인을 거는 화면이 클릭을 먼저(캡처 단계에서) 보고, 그 직후의 beforeunload만 통과시킨다.

/** 클릭 직후 이 시간 안에 시작된 이동만 통과시킨다 (이동이 일어나지 않으면 확인이 다시 켜짐) */
export const LEAVE_OK_WINDOW_MS = 3000;

type ClickLike = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"> & {
  target: EventTarget | null;
};

/** 이 클릭이 지금 창에서 도움 링크로 이동하는 클릭인지. 새 탭·새 창 조합키는 지금 창을 떠나지 않으므로 제외. */
export function isLeaveOkClick(e: ClickLike): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const el = e.target as { closest?: (s: string) => Element | null } | null;
  const link = el?.closest?.("a[data-leave-ok][href]");
  if (!link) return false;
  return (link.getAttribute("target") ?? "_self") === "_self";
}

/**
 * 저장 중·저장 실패일 때 떠나기 전 확인을 건다. 도움 링크 클릭 직후에는 확인하지 않는다.
 * 돌려준 함수로 해제한다.
 */
export function installLeaveGuard(win: Window = window): () => void {
  let okAt = -Infinity;
  const onClick = (e: MouseEvent) => {
    if (isLeaveOkClick(e)) okAt = Date.now();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (Date.now() - okAt < LEAVE_OK_WINDOW_MS) return; // 도움 화면으로는 묻지 않고 이동
    e.preventDefault();
    e.returnValue = "";
  };
  win.document.addEventListener("click", onClick, true);
  win.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    win.document.removeEventListener("click", onClick, true);
    win.removeEventListener("beforeunload", onBeforeUnload);
  };
}
