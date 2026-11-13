// 글꼴 제공 방식을 확인한다.
// - 빌드가 구글 글꼴 서버에 연결하지 않는다 (2026-11 운영 빌드가 그쪽 오류로 실패한 적 있음).
// - 한글 본문은 기기 기본 글꼴을 쓴다. Gothic A1은 제작자 원본 라이선스가 이름을 예약해 두어,
//   웹용으로 나눈 조각을 같은 이름으로 재배포하지 않는다 (2026-11-13 결정).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ROOT, SRC, listFiles } from "./helpers/import-graph";

const FONTS = join(SRC, "app", "fonts");
const css = readFileSync(join(FONTS, "fonts.css"), "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const globals = readFileSync(join(SRC, "app", "globals.css"), "utf8");

test("어떤 코드도 next/font/google·구글 글꼴 주소를 쓰지 않는다 (빌드 중 구글 서버 연결 없음)", () => {
  const hits = listFiles(SRC)
    .filter((f) => /\.(tsx?|jsx?|mjs|css)$/.test(f))
    .filter((f) => /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test("Gothic A1을 어디에서도 쓰지 않는다", () => {
  const hits = listFiles(SRC)
    .filter((f) => /\.(tsx?|jsx?|mjs|css)$/.test(f) || f.includes(`${join("app", "fonts")}`))
    .filter((f) => /gothic[\s_-]?a1/i.test(f) || (!f.endsWith(".woff2") && /gothic[\s_-]?a1/i.test(readFileSync(f, "utf8"))))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test("한글 본문은 기기 기본 글꼴 목록을 쓴다", () => {
  const body = globals.match(/--font-body:\s*([^;]+);/)?.[1] ?? "";
  for (const name of ["system-ui", '"Apple SD Gothic Neo"', '"Malgun Gothic"', "sans-serif"]) {
    assert.ok(body.includes(name), `없음: ${name}`);
  }
  assert.match(globals, /body\s*\{[^}]*font-family:\s*var\(--font-body\);/);
  assert.match(globals, /--font-jost:\s*"Jost";/);
});

test("layout이 글꼴 CSS를 불러온다", () => {
  const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
  assert.match(layout, /import\s+["']\.\/fonts\/fonts\.css["']/);
});

test("모든 @font-face가 저장소 안의 woff2 파일을 가리키고, 글자 범위와 swap이 있다", () => {
  assert.ok(faces.length > 0);
  for (const body of faces) {
    assert.match(body, /font-family:\s*"Jost";/);
    const url = body.match(/url\("([^"]+)"\)/)?.[1];
    assert.ok(url && url.startsWith("./files/") && url.endsWith(".woff2"), `잘못된 주소: ${url}`);
    assert.ok(existsSync(join(FONTS, url)), `파일 없음: ${url}`);
    assert.match(body, /unicode-range:\s*U\+/);
    assert.match(body, /font-display:\s*swap;/);
  }
});

test("files/ 폴더에 쓰이지 않는 파일이 없다", () => {
  const used = new Set(faces.map((b) => b.match(/url\("\.\/files\/([^"]+)"\)/)?.[1]));
  const unused = readdirSync(join(FONTS, "files")).filter((n) => !used.has(n));
  assert.deepEqual(unused, []);
});

test("Jost 400·500이 있다", () => {
  const weights = new Set(faces.map((b) => b.match(/font-weight:\s*(\d+)/)?.[1]));
  assert.ok(weights.has("400") && weights.has("500"));
});

test("Jost 사용 허락서(SIL OFL 1.1, 예약 글꼴 이름 없음)가 함께 있다", () => {
  const text = readFileSync(join(FONTS, "licenses", "jost-OFL.txt"), "utf8");
  assert.match(text, /SIL Open Font License, Version 1\.1/);
  assert.doesNotMatch(text.split("SIL OPEN FONT LICENSE")[0], /Reserved Font Name/i);
  assert.deepEqual(readdirSync(join(FONTS, "licenses")), ["jost-OFL.txt"]);
});

test("다운로드 스크립트가 실패하면 기존 글꼴 파일을 그대로 둔다", () => {
  const snapshot = () =>
    listFiles(FONTS)
      .map((f) => `${relative(FONTS, f)} ${createHash("sha256").update(readFileSync(f)).digest("hex")}`)
      .sort();
  const before = snapshot();
  // 닿지 않는 주소로 바꿔 내려받기를 실패시킨다 (네트워크 없이도 실패함)
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "fonts", "download.mjs")], {
    env: { ...process.env, FONTS_CSS_ORIGIN: "http://127.0.0.1:9", FONTS_LICENSE_ORIGIN: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /기존 글꼴 파일은 바꾸지 않았어요/);
  assert.deepEqual(snapshot(), before);
  // 임시 폴더도 남기지 않는다
  assert.deepEqual(readdirSync(join(SRC, "app")).filter((n) => n.startsWith(".fonts-")), []);
});
