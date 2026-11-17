// 나눠서 공개: 예약 대본은 법률 검토 전까지 운영에서만 숨긴다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BOOKING_REVIEWED, bookingOpen } from "../src/lib/launch";

test("검토 전: 운영에서는 숨기고, 미리보기·로컬에서는 보인다", () => {
  assert.equal(bookingOpen("production", false), false);
  assert.equal(bookingOpen("preview", false), true);
  assert.equal(bookingOpen("development", false), true);
  assert.equal(bookingOpen(undefined, false), true);
});

test("검토 후: 어디서나 보인다", () => {
  assert.equal(bookingOpen("production", true), true);
});

test("지금 설정은 '검토 전'이다 (법률 검토가 끝나기 전에 운영에서 열리지 않게)", () => {
  assert.equal(BOOKING_REVIEWED, false);
  assert.equal(bookingOpen("production"), false);
});
