// 저장 중·저장 실패 화면의 '떠나기 전 확인'은 도움 버튼 클릭에서만 건너뛴다 (CLAUDE.md 3장: 도움 버튼 약화 금지).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEAVE_OK_WINDOW_MS, installLeaveGuard, isLeaveOkClick } from "../src/lib/leave-guard";
import { SRC, walk } from "./helpers/import-graph";

// 가상 링크: closest()로 data-leave-ok 링크를 찾는 최소한의 모양
const link = (attrs: Record<string, string>) => {
  const el = {
    getAttribute: (k: string) => attrs[k] ?? null,
    closest: (sel: string) => (sel.includes("data-leave-ok") && "data-leave-ok" in attrs && "href" in attrs ? el : null),
  };
  return el as unknown as EventTarget;
};
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

test("도움 링크를 그냥 누르면(마우스·Enter) 통과, 조합키·가운데 버튼·새 창 링크·다른 링크는 아님", () => {
  const help = link({ href: "/help", "data-leave-ok": "" });
  assert.equal(isLeaveOkClick({ ...plain, target: help }), true);
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) assert.equal(isLeaveOkClick({ ...plain, [k]: true, target: help }), false, k);
  assert.equal(isLeaveOkClick({ ...plain, button: 1, target: help }), false);
  assert.equal(isLeaveOkClick({ ...plain, target: link({ href: "/help", "data-leave-ok": "", target: "_blank" }) }), false);
  assert.equal(isLeaveOkClick({ ...plain, target: link({ href: "/records" }) }), false);
  assert.equal(isLeaveOkClick({ ...plain, target: null }), false);
});

function fakeWindow() {
  const doc = new EventTarget();
  return Object.assign(new EventTarget(), { document: doc }) as unknown as Window;
}
const fire = (win: Window, extra: Record<string, unknown> = {}) => {
  const click = new Event("click");
  // Event의 target 등은 읽기 전용이라 인스턴스에 직접 정의한다 (가상 클릭)
  for (const [k, v] of Object.entries({ ...plain, ...extra })) Object.defineProperty(click, k, { value: v });
  win.document.dispatchEvent(click);
};
const leave = (win: Window) => {
  const e = new Event("beforeunload", { cancelable: true });
  win.dispatchEvent(e);
  return e.defaultPrevented; // true = 브라우저가 묻는다
};

test("확인 장치: 평소에는 묻고, 도움 링크 클릭 직후에는 묻지 않으며, 해제하면 묻지 않는다", (t) => {
  const win = fakeWindow();
  const off = installLeaveGuard(win);
  assert.equal(leave(win), true, "저장 중에는 떠나기 전에 물어야 함");
  fire(win, { target: link({ href: "/records" }) });
  assert.equal(leave(win), true, "다른 링크는 계속 물음");
  fire(win, { target: link({ href: "/help", "data-leave-ok": "" }) });
  assert.equal(leave(win), false, "도움 링크는 묻지 않고 이동");
  // 이동이 일어나지 않고 시간이 지나면 다시 묻는다
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + LEAVE_OK_WINDOW_MS + 1 });
  assert.equal(leave(win), true, "시간이 지나면 다시 물음");
  t.mock.timers.reset();
  off();
  assert.equal(leave(win), false, "해제 후에는 묻지 않음");
});

test("머리글 도움 버튼은 data-leave-ok 일반 링크이고, 도움 화면은 확인 장치 코드를 불러오지 않는다", () => {
  const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
  assert.match(layout, /<a\s+href="\/help"\s+data-leave-ok[\s\S]*?도움이 필요해요\s*<\/a>/);
  const form = readFileSync(join(SRC, "components", "CheckinForm.tsx"), "utf8");
  assert.match(form, /installLeaveGuard\(\)/);
  assert.ok(!/addEventListener\("beforeunload"/.test(form), "기록 화면이 예외 없는 확인을 따로 걸면 안 됨");
  const { files } = walk([join(SRC, "app", "help", "page.tsx")]);
  assert.ok(![...files.keys()].some((f) => f.endsWith("leave-guard.ts")));
});
