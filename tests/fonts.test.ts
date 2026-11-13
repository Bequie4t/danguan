// 글꼴 제공 방식을 확인한다.
// - 빌드가 구글 글꼴 서버에 연결하지 않는다 (2026-11 운영 빌드가 그쪽 오류로 실패한 적 있음).
// - 한글 본문은 기기 기본 글꼴을 쓴다. Gothic A1은 제작자 원본 라이선스가 이름을 예약해 두어,
//   웹용으로 나눈 조각을 같은 이름으로 재배포하지 않는다 (2026-11-13 결정).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
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

// ── 다운로드 스크립트: 저장소 파일 대신 임시 폴더 사본과 모의 서버로 실행한다 ──

const SCRIPT = join(ROOT, "scripts", "fonts", "download.mjs");
const LATIN = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const WOFF2 = Buffer.concat([Buffer.from("wOF2", "latin1"), Buffer.alloc(200, 1)]);
// 모의 서버가 돌려줄 라이선스: 저장소의 Jost OFL 전문
const OFL = readFileSync(join(FONTS, "licenses", "jost-OFL.txt"), "utf8");
const OFL_INTRO_ONLY = "This Font Software is licensed under the SIL Open Font License, Version 1.1.";

/** 모의 글꼴 서버. weights: CSS에 넣을 굵기, range: 글자 범위, fail: 실패시킬 경로 앞부분 */
async function mockServer(opts: { weights: readonly string[]; range?: string; fail?: string; license?: string }) {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (opts.fail && url.startsWith(opts.fail)) return res.writeHead(500).end();
    if (url.startsWith("/css2")) {
      const { port } = server.address() as AddressInfo;
      const css = opts.weights
        .map((w) => `@font-face {\n  font-family: 'Jost';\n  font-style: normal;\n  font-weight: ${w};\n  font-display: swap;\n  src: url(http://127.0.0.1:${port}/f/${w}.woff2) format('woff2');\n  unicode-range: ${opts.range ?? LATIN};\n}`)
        .join("\n");
      return res.writeHead(200, { "content-type": "text/css" }).end(css);
    }
    if (url.startsWith("/f/")) return res.writeHead(200).end(WOFF2);
    if (url.endsWith("OFL.txt")) return res.writeHead(200).end(opts.license ?? OFL);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

/** 현재 글꼴 폴더 사본이 든 임시 폴더 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "danguan-fonts-"));
  cpSync(FONTS, join(dir, "fonts"), { recursive: true });
  return { dir, out: join(dir, "fonts"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function run(out: string, origin: string) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, FONTS_OUT_DIR: out, FONTS_CSS_ORIGIN: origin, FONTS_LICENSE_ORIGIN: origin },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const snapshot = (dir: string) =>
  listFiles(dir)
    .map((f) => `${relative(dir, f)} ${createHash("sha256").update(readFileSync(f)).digest("hex")}`)
    .sort();

test("다운로드: 정상 응답이면 교체하고, 임시·백업 폴더를 남기지 않는다", async () => {
  const box = sandbox();
  const srv = await mockServer({ weights: ["400", "500"] });
  try {
    const r = await run(box.out, srv.origin);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(box.out, "fonts.css"), "utf8"), /font-weight: 500;/);
    assert.deepEqual(readdirSync(box.dir), ["fonts"]);
  } finally {
    srv.close();
    box.cleanup();
  }
});

for (const [name, opts, why] of [
  ["서버 오류(CSS)", { weights: ["400", "500"], fail: "/css2" }, /500 http/],
  ["서버 오류(라이선스)", { weights: ["400", "500"], fail: "/indestructible-type" }, /500 http/],
  ["500 굵기가 빠진 정상 응답", { weights: ["400"] }, /Jost 500 굵기가 없음/],
  ["숫자가 빠진 글자 범위", { weights: ["400", "500"], range: "U+0041-005A, U+0061-007A" }, /없는 글자: 0123456789/],
  ["라이선스 소개 문장 한 줄뿐인 응답", { weights: ["400", "500"], license: OFL_INTRO_ONLY }, /라이선스 전문이 아님/],
] as const) {
  test(`다운로드: ${name}이면 실패하고 기존 파일을 그대로 둔다`, async () => {
    const box = sandbox();
    const srv = await mockServer(opts);
    try {
      const before = snapshot(box.out);
      const r = await run(box.out, srv.origin);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /기존 글꼴 파일은 바꾸지 않았어요/);
      assert.match(r.stderr, why);
      assert.deepEqual(snapshot(box.out), before);
      assert.deepEqual(readdirSync(box.dir), ["fonts"]);
    } finally {
      srv.close();
      box.cleanup();
    }
  });
}

test("다운로드: 교체 도중 멈춰 백업만 남았으면 다음 실행이 백업을 되돌리고 멈춘다", async () => {
  const box = sandbox();
  const srv = await mockServer({ weights: ["400", "500"] });
  try {
    const before = snapshot(box.out);
    renameSync(box.out, join(box.dir, "fonts.old-12345")); // 강제 종료 상황 재현
    const r = await run(box.out, srv.origin);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /백업을 fonts로 되돌렸어요/);
    assert.deepEqual(snapshot(box.out), before);
    assert.deepEqual(readdirSync(box.dir), ["fonts"]);
  } finally {
    srv.close();
    box.cleanup();
  }
});

test("다운로드: 다른 실행이 진행 중이면 시작하지 않고, 그 실행의 임시 폴더도 건드리지 않는다", async () => {
  const box = sandbox();
  const srv = await mockServer({ weights: ["400", "500"] });
  try {
    const before = snapshot(box.out);
    // 살아 있는 다른 실행을 흉내: 잠금 파일에 지금 살아 있는 프로세스(이 시험) 번호, 진행 중인 임시 폴더
    writeFileSync(join(box.dir, ".fonts.lock"), String(process.pid));
    mkdirSync(join(box.dir, ".fonts-new-other"));
    const r = await run(box.out, srv.origin);
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`다른 실행\\(프로세스 ${process.pid}\\)이 진행 중`));
    assert.deepEqual(snapshot(box.out), before);
    assert.deepEqual(readdirSync(box.dir).sort(), [".fonts-new-other", ".fonts.lock", "fonts"]);
    assert.equal(readFileSync(join(box.dir, ".fonts.lock"), "utf8"), String(process.pid));
  } finally {
    srv.close();
    box.cleanup();
  }
});

test("다운로드: 강제 종료로 남은 잠금(이미 끝난 프로세스)은 치우고 진행한다", async () => {
  const box = sandbox();
  const srv = await mockServer({ weights: ["400", "500"] });
  try {
    // 끝난 프로세스 번호를 얻기: 바로 끝나는 자식 프로세스
    const dead = await new Promise<number>((resolve) => {
      const c = spawn(process.execPath, ["-e", ""]);
      c.on("close", () => resolve(c.pid!));
    });
    writeFileSync(join(box.dir, ".fonts.lock"), String(dead));
    const r = await run(box.out, srv.origin);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(box.dir), ["fonts"]);
  } finally {
    srv.close();
    box.cleanup();
  }
});

test("저장소 글꼴 폴더 옆에 남은 임시·백업 폴더가 없다", () => {
  assert.deepEqual(readdirSync(join(SRC, "app")).filter((n) => /^\.fonts-new-|^fonts\.old-|^\.fonts\.lock$/.test(n)), []);
});
