// 글꼴을 저장소의 파일로 제공하는지 확인한다.
// 빌드가 구글 글꼴 서버에 연결하면, 그쪽 일시 오류로 빌드·배포가 실패할 수 있다 (2026-11 운영 빌드에서 실제로 발생).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { ROOT, SRC, listFiles } from "./helpers/import-graph";

const FONTS = join(SRC, "app", "fonts");
const css = readFileSync(join(FONTS, "fonts.css"), "utf8");
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

test("어떤 코드도 next/font/google을 쓰지 않는다 (빌드 중 구글 서버 연결 없음)", () => {
  const hits = listFiles(SRC)
    .filter((f) => /\.(tsx?|jsx?|mjs|css)$/.test(f))
    .filter((f) => /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(hits, []);
});

test("layout이 글꼴 CSS를 불러온다", () => {
  const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");
  assert.match(layout, /import\s+["']\.\/fonts\/fonts\.css["']/);
});

test("모든 @font-face가 저장소 안의 woff2 파일을 가리키고, 글자 범위와 swap이 있다", () => {
  assert.ok(faces.length > 0);
  for (const body of faces) {
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

test("필요한 글꼴·굵기가 모두 있다 (Gothic A1 400·500·700, Jost 400·500)", () => {
  const have = new Set(
    faces.map((b) => `${b.match(/font-family:\s*"([^"]+)"/)?.[1]} ${b.match(/font-weight:\s*(\d+)/)?.[1]}`),
  );
  for (const want of ["Gothic A1 400", "Gothic A1 500", "Gothic A1 700", "Jost 400", "Jost 500"]) {
    assert.ok(have.has(want), `없음: ${want}`);
  }
});

test("한글 글자 범위(가~힣)가 Gothic A1 조각에 들어 있다", () => {
  // '가'(U+AC00)와 '힣'(U+D7A3)이 400 굵기의 어떤 조각에 포함되는지 확인
  const ranges = faces
    .filter((b) => /"Gothic A1"/.test(b) && /font-weight:\s*400/.test(b))
    .flatMap((b) => b.match(/unicode-range:\s*([^;]+);/)![1].split(",").map((r) => r.trim()));
  const covers = (cp: number) =>
    ranges.some((r) => {
      const [a, b] = r.replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16));
      return cp >= a && cp <= (b ?? a);
    });
  for (const ch of "가힣안녕기록도움") assert.ok(covers(ch.codePointAt(0)!), `조각 없음: ${ch}`);
});

test("글꼴 이름이 globals.css 변수와 같다", () => {
  const globals = readFileSync(join(SRC, "app", "globals.css"), "utf8");
  assert.match(globals, /--font-gothic:\s*"Gothic A1";/);
  assert.match(globals, /--font-jost:\s*"Jost";/);
});

test("글꼴 사용 허락서(SIL OFL 1.1)가 함께 있다", () => {
  for (const name of ["gothic-a1-OFL.txt", "jost-OFL.txt"]) {
    const text = readFileSync(join(FONTS, "licenses", name), "utf8");
    assert.match(text, /SIL Open Font License, Version 1\.1/);
  }
});
