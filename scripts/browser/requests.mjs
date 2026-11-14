// 브라우저 시험에서 "서버로 나간 요청" 검사에 쓰는 공통 기준.
// 이 사이트가 직접 제공하는 정적 파일(글꼴·스크립트·스타일)만 제외하고, 나머지는 모두 요청으로 센다.
// 제외 조건을 모두 만족해야 한다: 같은 출처 · GET · 브라우저가 분류한 자원 종류 · 쿼리·해시 없는 정적 경로.
// 그래서 같은 경로의 .woff2라도 POST이거나 fetch로 보낸 요청(글꼴처럼 보이는 데이터 요청)은 잡힌다.

const FONT_PATH = /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2$/;
const STATIC_PATH = /^\/_next\/static\/[A-Za-z0-9._/-]+\.(js|css|woff2)$/;
const KIND_BY_EXT = { woff2: "font", js: "script", css: "stylesheet" };

/** @param {{url(): string, method(): string, resourceType(): string}} req @param {string} base 예: http://127.0.0.1:3000 */
function sameOriginPlainGet(req, base) {
  let u;
  try {
    u = new URL(req.url());
  } catch {
    return null;
  }
  if (u.origin !== new URL(base).origin) return null;
  if (req.method() !== "GET") return null;
  if (u.search || u.hash) return null;
  return u;
}

/** 이 사이트가 제공하는 글꼴 파일을 브라우저가 글꼴로 불러온 요청인가 */
export function isOwnFontRequest(req, base) {
  const u = sameOriginPlainGet(req, base);
  return !!u && req.resourceType() === "font" && FONT_PATH.test(u.pathname);
}

/** 이 사이트가 제공하는 정적 파일(글꼴·스크립트·스타일)을 그 종류로 불러온 요청인가 */
export function isOwnStaticRequest(req, base) {
  const u = sameOriginPlainGet(req, base);
  if (!u) return false;
  const m = u.pathname.match(STATIC_PATH);
  return !!m && req.resourceType() === KIND_BY_EXT[m[1]];
}
