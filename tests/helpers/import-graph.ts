// 시험 도우미: 파일에서 시작해 import를 끝까지 따라가, 로그인·기록·Supabase 코드에 닿는지 찾는다.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const SRC = join(ROOT, "src");

/** 이 경로(또는 패키지)에 닿으면 실패 */
export const FORBIDDEN: { test: (spec: string, file: string | null) => boolean; why: string }[] = [
  { test: (s) => s.startsWith("@supabase/"), why: "Supabase 라이브러리" },
  { test: (_s, f) => !!f && f.startsWith(join(SRC, "lib", "supabase")), why: "Supabase 설정" },
  { test: (_s, f) => !!f && f.startsWith(join(SRC, "lib", "checkins")), why: "기록 저장 코드" },
  { test: (_s, f) => !!f && f.startsWith(join(SRC, "lib", "session")), why: "로그인 세션 코드" },
  { test: (_s, f) => !!f && f.startsWith(join(SRC, "lib", "consent")), why: "동의 저장 코드" },
  { test: (_s, f) => !!f && /[\\/]components[\\/](AuthScope|AccountMenu|HomeCheckin|CheckinForm|RecordList|RecordItem|ConsentForm|LoginForm)\./.test(f), why: "로그인·기록 화면 부품" },
];

export function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  if (!base) return null; // 외부 패키지
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  throw new Error(`해석할 수 없는 import: ${spec} (${relative(ROOT, from)})`);
}

function importsOf(file: string, staticOnly = false): string[] {
  const code = readFileSync(file, "utf8");
  const specs = new Set<string>();
  for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/g)) specs.add(m[1]);
  if (!staticOnly) for (const m of code.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
  for (const m of code.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) specs.add(m[1]);
  return [...specs];
}

/** 시작 파일들에서 닿는 모든 (파일 또는 패키지) 목록과 경로 */
export function walk(starts: string[], staticOnly = false) {
  const seen = new Map<string, string[]>(); // 파일 → 그 파일까지의 경로
  const packages: { spec: string; via: string[] }[] = [];
  const queue = starts.map((f) => ({ file: f, via: [relative(ROOT, f)] }));
  while (queue.length) {
    const { file, via } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, via);
    for (const spec of importsOf(file, staticOnly)) {
      const target = resolveSpec(spec, file);
      if (target) queue.push({ file: target, via: [...via, relative(ROOT, target)] });
      else packages.push({ spec, via });
    }
  }
  return { files: seen, packages };
}


/** 금지 모듈에 닿은 경로 목록 (빈 배열이면 통과) */
export function violations(starts: string[], staticOnly = false): string[] {
  const { files, packages } = walk(starts, staticOnly);
  const out: string[] = [];
  for (const [file, via] of files) for (const r of FORBIDDEN) if (r.test("", file)) out.push(`${r.why}: ${via.join(" → ")}`);
  for (const { spec, via } of packages) for (const r of FORBIDDEN) if (r.test(spec, null)) out.push(`${r.why}(${spec}): ${via.join(" → ")}`);
  return out;
}
