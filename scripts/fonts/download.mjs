// 글꼴 파일을 한 번 내려받아 저장소에 넣는 개발용 스크립트. 빌드할 때는 실행하지 않는다.
// 빌드가 구글 글꼴 서버에 연결하지 않도록, 결과물(src/app/fonts/)을 커밋해 둔다.
//
// 사용법: node scripts/fonts/download.mjs
// 결과물 (src/app/fonts/):
//   files/*.woff2   — 글꼴 조각 (글자 범위별)
//   fonts.css       — @font-face 목록 (layout.tsx에서 불러온다)
//   licenses/*.txt  — SIL Open Font License 1.1 원문
//
// 안전장치
// - 새 결과물을 임시 폴더(src/app/.fonts-new-*)에 모두 받고, 필수 굵기·글자 범위·파일 형식·라이선스를
//   확인한 뒤에만 기존 결과물과 바꾼다. 도중에 실패하면 기존 파일은 그대로 남는다.
// - 교체는 "기존 → src/app/fonts.old-<번호>, 새것 → src/app/fonts, 백업 삭제" 순서다.
//   그 사이에 강제 종료되어 src/app/fonts가 없고 fonts.old-* 백업만 남았다면,
//   다음 실행이 백업을 자동으로 되돌리고 멈춘다. 손으로 되돌리려면: mv src/app/fonts.old-<번호> src/app/fonts
// - 어떤 경우든 git으로도 되돌릴 수 있다: git checkout -- src/app/fonts
// - 동시에 두 번 실행하면 나중 실행은 시작하지 않는다 (잠금 파일 src/app/.fonts.lock, 강제 종료로 남은 잠금은 자동 정리).
// - 라이선스는 SIL OFL 1.1 전문(정의·조건·종료·면책 조항)이 받아졌을 때만 인정한다.
//
// 한글 본문은 기기 기본 글꼴을 쓴다 (globals.css). 여기에 글꼴을 더할 때는 먼저 제작자 원본 라이선스에
// 예약 글꼴 이름(Reserved Font Name)이 있는지 확인한다. 웹용으로 나눈 조각은 수정본으로 볼 수 있다.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 시험용: 결과물 폴더와 서버 주소를 바꿔, 저장소 파일을 건드리지 않고 실패·복구 상황을 재현한다.
const OUT = path.resolve(process.env.FONTS_OUT_DIR ?? path.join(ROOT, "src/app/fonts"));
const PARENT = path.dirname(OUT);
const BASE = path.basename(OUT);
const CSS_ORIGIN = process.env.FONTS_CSS_ORIGIN ?? "https://fonts.googleapis.com";
const LICENSE_ORIGIN = process.env.FONTS_LICENSE_ORIGIN ?? "https://raw.githubusercontent.com";

// woff2 형식을 받으려면 최신 브라우저 UA가 필요하다.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FONTS = [
  {
    slug: "jost",
    family: "Jost",
    css: `${CSS_ORIGIN}/css2?family=Jost:wght@400;500&display=swap`,
    // 제작자 원본 라이선스 (예약 글꼴 이름 없음)
    license: `${LICENSE_ORIGIN}/indestructible-type/Jost/master/OFL.txt`,
    // 굵기마다 반드시 들어 있어야 하는 글자: 로고(404 blue)·영어 표제·전화번호
    weights: ["400", "500"],
    mustCover: "0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  },
];

async function get(url, as) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "text" ? res.text() : Buffer.from(await res.arrayBuffer());
}

function parseFaces(css) {
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1];
    const pick = (name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    const face = {
      style: pick("font-style"),
      weight: pick("font-weight"),
      range: pick("unicode-range"),
      url: body.match(/url\((https?:[^)]+)\)/)?.[1],
    };
    if (!face.style || !face.weight || !face.range || !face.url) throw new Error(`알 수 없는 @font-face: ${body}`);
    faces.push(face);
  }
  if (faces.length === 0) throw new Error("@font-face를 찾지 못함");
  return faces;
}

/** "U+0000-00FF, U+0131" 안에 코드포인트가 있는지 */
function rangeCovers(range, cp) {
  return range.split(",").some((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16));
    return cp >= a && cp <= (b ?? a);
  });
}

/** 필수 굵기마다 필수 글자가 모두 들어 있는지. 빠진 것을 문장으로 돌려준다. */
function missing(font, faces) {
  const problems = [];
  for (const weight of font.weights) {
    const ranges = faces.filter((f) => f.weight === weight && f.style === "normal").map((f) => f.range);
    if (ranges.length === 0) {
      problems.push(`${font.family} ${weight} 굵기가 없음`);
      continue;
    }
    const lacking = [...font.mustCover].filter((ch) => !ranges.some((r) => rangeCovers(r, ch.codePointAt(0))));
    if (lacking.length) problems.push(`${font.family} ${weight}에 없는 글자: ${lacking.join("")}`);
  }
  return problems;
}

/** 임시 폴더(tmp)에 결과물 전체를 만든다. 실패하면 예외. */
async function build(tmp) {
  const files = path.join(tmp, "files");
  const licenses = path.join(tmp, "licenses");
  await mkdir(files, { recursive: true });
  await mkdir(licenses, { recursive: true });

  const out = [
    "/* 자동 생성: node scripts/fonts/download.mjs — 직접 고치지 않는다. */",
    "/* 글꼴: SIL Open Font License 1.1 (licenses/ 폴더). 파일 출처: Google Fonts. */",
    "",
  ];
  const saved = new Map(); // 같은 파일(가변 글꼴의 여러 굵기)은 한 번만 저장
  for (const font of FONTS) {
    const faces = parseFaces(await get(font.css, "text"));
    const problems = missing(font, faces);
    if (problems.length) throw new Error(problems.join(" / "));
    for (const face of faces) {
      let name = saved.get(face.url);
      if (!name) {
        const data = await get(face.url);
        if (data.length < 100 || data.subarray(0, 4).toString("latin1") !== "wOF2") {
          throw new Error(`woff2가 아님: ${face.url}`);
        }
        name = `${font.slug}-${createHash("sha256").update(data).digest("hex").slice(0, 12)}.woff2`;
        await writeFile(path.join(files, name), data);
        saved.set(face.url, name);
      }
      out.push(
        "@font-face {",
        `  font-family: "${font.family}";`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        "  font-display: swap;",
        `  src: url("./files/${name}") format("woff2");`,
        `  unicode-range: ${face.range};`,
        "}",
      );
    }
    const license = await get(font.license, "text");
    if (!isFullOfl(license)) throw new Error(`라이선스 전문이 아님: ${font.license}`);
    await writeFile(path.join(licenses, `${font.slug}-OFL.txt`), license);
    console.log(`${font.family}: @font-face ${faces.length}개`);
  }
  await writeFile(path.join(tmp, "fonts.css"), out.join("\n") + "\n");
  return new Set(saved.values()).size; // 주소가 달라도 내용이 같으면 파일 하나
}

const exists = (p) => stat(p).then(() => true, () => false);

/** 지난 실행이 교체 도중 멈춰 결과물 폴더가 없고 백업만 남았으면 되돌린다. 되돌렸으면 true. */
async function recover() {
  const names = await readdir(PARENT);
  // 지난 실행이 남긴 임시 폴더는 지운다 (기존 결과물과 무관)
  for (const n of names.filter((n) => n.startsWith(`.${BASE}-new-`))) {
    await rm(path.join(PARENT, n), { recursive: true, force: true });
  }
  const backups = names.filter((n) => n.startsWith(`${BASE}.old-`)).sort();
  if (backups.length === 0) return false;
  if (await exists(OUT)) {
    throw new Error(`지난 실행의 백업이 남아 있어요: ${backups.join(", ")}. 확인 후 지워 주세요 (지금 결과물은 ${BASE}).`);
  }
  if (backups.length > 1) throw new Error(`백업이 여러 개예요: ${backups.join(", ")}. 하나를 골라 ${BASE}로 이름을 바꿔 주세요.`);
  await rename(path.join(PARENT, backups[0]), OUT);
  return true;
}

/**
 * SIL OFL 1.1 전문인지: 소개 문장 한 줄이 아니라 머리말·정의·허락과 조건·종료·면책 조항 제목이 모두 있어야 한다.
 * (제목 표기는 배포처마다 대소문자·밑줄이 달라 대소문자를 가리지 않는다)
 */
function isFullOfl(text) {
  const t = text.toUpperCase().replace(/\s+/g, " "); // 줄바꿈으로 나뉜 문구도 찾는다
  return (
    t.includes("SIL OPEN FONT LICENSE") &&
    t.includes("VERSION 1.1") &&
    ["PREAMBLE", "DEFINITIONS", "PERMISSION & CONDITIONS", "TERMINATION", "DISCLAIMER"].every((h) => t.includes(h))
  );
}

// 동시에 두 번 실행되지 않게 잠금 파일을 둔다. 다른 실행의 임시 폴더를 지우지 않기 위해서다.
const LOCK = path.join(PARENT, `.${BASE}.lock`);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // 다른 사용자 프로세스는 살아 있음
  }
};

/** 잠금을 얻으면 풀기 함수를, 다른 실행이 살아 있으면 예외를 돌려준다. 죽은 실행의 잠금은 치운다. */
async function lock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(LOCK, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return () => rm(LOCK, { force: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const pid = Number((await readFile(LOCK, "utf8").catch(() => "")).trim());
      if (pid && alive(pid)) throw new Error(`다른 실행(프로세스 ${pid})이 진행 중이에요. 끝난 뒤 다시 실행해 주세요.`);
      await rm(LOCK, { force: true }); // 강제 종료된 실행이 남긴 잠금
    }
  }
  throw new Error(`잠금 파일을 만들 수 없어요: ${LOCK}`);
}

async function main() {
  const unlock = await lock();
  try {
    await run();
  } finally {
    await unlock();
  }
}

async function run() {
  if (await recover()) {
    console.error(`지난 실행이 교체 도중 멈춰, 백업을 ${BASE}로 되돌렸어요. 다시 실행해 주세요.`);
    process.exitCode = 1;
    return;
  }
  // 같은 디스크 안에 임시 폴더를 만들어야 rename으로 한 번에 바꿀 수 있다.
  const tmp = await mkdtemp(path.join(PARENT, `.${BASE}-new-`));
  try {
    const count = await build(tmp);
    const written = (await readdir(path.join(tmp, "files"))).length;
    if (written !== count) throw new Error(`파일 수가 맞지 않음: ${written} / ${count}`);

    // 모두 받고 확인한 뒤에만 교체: 기존 → 백업, 새것 → 제자리, 백업 삭제
    const backup = path.join(PARENT, `${BASE}.old-${process.pid}`);
    const hadOld = await exists(OUT);
    if (hadOld) await rename(OUT, backup);
    try {
      await rename(tmp, OUT);
    } catch (err) {
      if (hadOld) await rename(backup, OUT);
      throw err;
    }
    if (hadOld) await rm(backup, { recursive: true, force: true });
    console.log(`파일 ${count}개 저장`);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    console.error(`실패 — 기존 글꼴 파일은 바꾸지 않았어요: ${err.message}`);
    process.exitCode = 1; // process.exit()는 잠금 풀기(finally)를 건너뛰므로 쓰지 않는다
  }
}

main().catch((err) => {
  console.error(`실패 — 기존 글꼴 파일은 바꾸지 않았어요: ${err.message}`);
  process.exit(1);
});
