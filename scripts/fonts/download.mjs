// 글꼴 파일을 한 번 내려받아 저장소에 넣는 개발용 스크립트. 빌드할 때는 실행하지 않는다.
// 빌드가 구글 글꼴 서버에 연결하지 않도록, 결과물(src/app/fonts/)을 커밋해 둔다.
//
// 사용법: node scripts/fonts/download.mjs
// 결과물 (src/app/fonts/):
//   files/*.woff2   — 글꼴 조각 (글자 범위별)
//   fonts.css       — @font-face 목록 (layout.tsx에서 불러온다)
//   licenses/*.txt  — SIL Open Font License 1.1 원문
//
// 안전장치: 새 결과물을 임시 폴더에 모두 받고 확인한 뒤에만 기존 결과물과 바꾼다.
// 도중에 실패하면 기존 파일은 그대로 남는다.
//
// 한글 본문은 기기 기본 글꼴을 쓴다 (globals.css). 여기에 글꼴을 더할 때는 먼저 제작자 원본 라이선스에
// 예약 글꼴 이름(Reserved Font Name)이 있는지 확인한다. 웹용으로 나눈 조각은 수정본으로 볼 수 있다.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = path.join(ROOT, "src/app");
const OUT = path.join(APP, "fonts");

// 시험용: 다른 서버 주소로 바꿔 실패 상황을 재현할 수 있다.
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
      url: body.match(/url\((https:[^)]+)\)/)?.[1],
    };
    if (!face.style || !face.weight || !face.range || !face.url) throw new Error(`알 수 없는 @font-face: ${body}`);
    faces.push(face);
  }
  if (faces.length === 0) throw new Error("@font-face를 찾지 못함");
  return faces;
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
    if (!license.includes("SIL Open Font License")) throw new Error(`라이선스 원문이 아님: ${font.license}`);
    await writeFile(path.join(licenses, `${font.slug}-OFL.txt`), license);
    console.log(`${font.family}: @font-face ${faces.length}개`);
  }
  await writeFile(path.join(tmp, "fonts.css"), out.join("\n") + "\n");
  return saved.size;
}

async function main() {
  // 같은 디스크 안에 임시 폴더를 만들어야 rename으로 한 번에 바꿀 수 있다.
  const tmp = await mkdtemp(path.join(APP, ".fonts-new-"));
  try {
    const count = await build(tmp);
    const written = (await readdir(path.join(tmp, "files"))).length;
    if (written !== count) throw new Error(`파일 수가 맞지 않음: ${written} / ${count}`);

    // 모두 받은 뒤에만 교체: 기존 → 백업, 새것 → 제자리, 백업 삭제
    const backup = `${OUT}.old-${process.pid}`;
    const hadOld = await stat(OUT).then(() => true, () => false);
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
    process.exit(1);
  }
}

main();
