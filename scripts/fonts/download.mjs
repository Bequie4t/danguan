// 글꼴 파일을 한 번 내려받아 저장소에 넣는 개발용 스크립트. 빌드할 때는 실행하지 않는다.
// 빌드가 구글 글꼴 서버에 연결하지 않도록, 결과물(src/app/fonts/)을 커밋해 둔다.
//
// 사용법: node scripts/fonts/download.mjs
// 결과물:
//   src/app/fonts/files/*.woff2   — 글꼴 조각 (한글은 글자 범위별로 나뉘어 있어, 화면에 필요한 조각만 내려받는다)
//   src/app/fonts/fonts.css       — @font-face 목록 (layout.tsx에서 불러온다)
//   src/app/fonts/licenses/*.txt  — SIL Open Font License 1.1 원문
//
// 같은 글꼴·굵기를 다시 받으면 같은 결과가 나온다 (구글이 글꼴을 갱신하면 달라질 수 있다).
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "src/app/fonts");
const FILES = path.join(OUT, "files");
const LICENSES = path.join(OUT, "licenses");

// woff2 형식을 받으려면 최신 브라우저 UA가 필요하다.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FONTS = [
  {
    slug: "gothic-a1",
    family: "Gothic A1",
    css: "https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;500;700&display=swap",
    license: "https://raw.githubusercontent.com/google/fonts/main/ofl/gothica1/OFL.txt",
  },
  {
    slug: "jost",
    family: "Jost",
    css: "https://fonts.googleapis.com/css2?family=Jost:wght@400;500&display=swap",
    license: "https://raw.githubusercontent.com/google/fonts/main/ofl/jost/OFL.txt",
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
    const url = body.match(/url\((https:[^)]+)\)/)?.[1];
    const face = {
      style: pick("font-style"),
      weight: pick("font-weight"),
      range: pick("unicode-range"),
      url,
    };
    if (!face.style || !face.weight || !face.range || !url) throw new Error(`알 수 없는 @font-face: ${body}`);
    faces.push(face);
  }
  return faces;
}

async function main() {
  await rm(FILES, { recursive: true, force: true });
  await mkdir(FILES, { recursive: true });
  await mkdir(LICENSES, { recursive: true });

  const out = [
    "/* 자동 생성: node scripts/fonts/download.mjs — 직접 고치지 않는다. */",
    "/* 글꼴: SIL Open Font License 1.1 (licenses/ 폴더). 원본: Google Fonts. */",
    "",
  ];
  const saved = new Map(); // 같은 파일(가변 글꼴의 여러 굵기)은 한 번만 저장
  let total = 0;

  for (const font of FONTS) {
    const faces = parseFaces(await get(font.css, "text"));
    for (const face of faces) {
      let name = saved.get(face.url);
      if (!name) {
        const data = await get(face.url);
        const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
        name = `${font.slug}-${hash}.woff2`;
        await writeFile(path.join(FILES, name), data);
        saved.set(face.url, name);
        total += data.length;
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
    await writeFile(path.join(LICENSES, `${font.slug}-OFL.txt`), await get(font.license, "text"));
    console.log(`${font.family}: @font-face ${faces.length}개`);
  }

  await writeFile(path.join(OUT, "fonts.css"), out.join("\n") + "\n");
  const count = (await readdir(FILES)).length;
  console.log(`파일 ${count}개, ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
