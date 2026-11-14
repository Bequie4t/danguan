// 브라우저 시험의 "서버로 나간 요청" 제외 기준 (scripts/browser/requests.mjs)
// 이 사이트의 정적 파일을 그 종류로 불러온 GET만 제외하고, 글꼴·정적 파일처럼 보이는 데이터 요청은 잡아야 한다.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error 시험 도구용 .mjs (형식 선언 없음)
import { isOwnFontRequest, isOwnStaticRequest } from "../scripts/browser/requests.mjs";

const BASE = "http://127.0.0.1:3300";
const req = (url: string, method = "GET", resourceType = "font") => ({
  url: () => url,
  method: () => method,
  resourceType: () => resourceType,
});
const FONT = `${BASE}/_next/static/media/jost-7726a5cd6f3c.c925c607.woff2`;

test("제외: 같은 출처의 글꼴 파일을 브라우저가 글꼴로 불러온 GET", () => {
  assert.equal(isOwnFontRequest(req(FONT), BASE), true);
  assert.equal(isOwnStaticRequest(req(FONT), BASE), true);
});

test("잡음: 글꼴 경로라도 POST·fetch·쿼리·해시·다른 출처·다른 포트", () => {
  for (const r of [
    req(FONT, "POST", "font"),
    req(FONT, "POST", "fetch"),
    req(FONT, "GET", "fetch"),
    req(FONT, "GET", "xhr"),
    req(`${FONT}?card=1`),
    req(`${FONT}#x`),
    req(FONT.replace(BASE, "https://evil.test")),
    req(FONT.replace("3300", "3301")),
    req(`${BASE}/_next/static/media/../../api/x.woff2`),
    req(`${BASE}/api/x.woff2`),
    req("not a url"),
  ]) {
    assert.equal(isOwnFontRequest(r, BASE), false, `${r.method()} ${r.resourceType()} ${r.url()}`);
    assert.equal(isOwnStaticRequest(r, BASE), false, `${r.method()} ${r.resourceType()} ${r.url()}`);
  }
});

test("정적 파일: 확장자와 브라우저 자원 종류가 맞을 때만 제외", () => {
  const js = `${BASE}/_next/static/chunks/app/page-07b046e43acf8553.js`;
  const css = `${BASE}/_next/static/css/bece14489e39edf5.css`;
  assert.equal(isOwnStaticRequest(req(js, "GET", "script"), BASE), true);
  assert.equal(isOwnStaticRequest(req(css, "GET", "stylesheet"), BASE), true);
  assert.equal(isOwnStaticRequest(req(js, "GET", "fetch"), BASE), false);
  assert.equal(isOwnStaticRequest(req(css, "GET", "script"), BASE), false);
  assert.equal(isOwnStaticRequest(req(js, "POST", "script"), BASE), false);
  // 글꼴 전용 판정은 media 바로 아래 파일만 (하위 폴더는 정적 파일 판정에서만 허용)
  assert.equal(isOwnFontRequest(req(`${BASE}/_next/static/media/sub/x.woff2`), BASE), false);
  // 글꼴 전용 판정은 스크립트·스타일을 제외하지 않는다
  assert.equal(isOwnFontRequest(req(js, "GET", "script"), BASE), false);
  // 정적 경로가 아닌 /_next/ 요청(예: 데이터·이미지 처리)은 제외하지 않는다
  assert.equal(isOwnStaticRequest(req(`${BASE}/_next/data/x.json`, "GET", "fetch"), BASE), false);
  assert.equal(isOwnStaticRequest(req(`${BASE}/_next/image?url=x`, "GET", "image"), BASE), false);
});
