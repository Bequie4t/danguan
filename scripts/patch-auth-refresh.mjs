// auth-js 2.117.3의 확인된 실패 경로만 수정한다. 다른 버전에서는 설치를 중단한다.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("@supabase/auth-js/package.json"));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (pkg.version !== "2.117.3") throw new Error("검토되지 않은 auth-js 버전: 갱신 패치 재검토 필요");
const marker = "// DANGUAN_TEST_REFRESH_SUBJECT_GUARD";
for (const kind of ["main", "module"]) {
  const path = resolve(root, "dist", kind, "GoTrueClient.js");
  const source = await readFile(path, "utf8");
  if (source.includes(marker)) continue;
  const get = kind === "main" ? "(0, helpers_1.getItemAsync)" : "getItemAsync";
  const error = kind === "main" ? "errors_1.AuthRefreshDiscardedError" : "AuthRefreshDiscardedError";
  const anchor = `const storedNow = (await ${get}(this.storage, this.storageKey));`;
  if (source.split(anchor).length !== 2) throw new Error("인증 SDK 패치 위치가 예상과 다름");
  const insertion = `${anchor}
                    ${marker}
                    if (this[Symbol.for("danguan.test.refresh-subject-guard")] === true &&
                        (!storedNow || storedNow.refresh_token !== refreshToken)) {
                        const discarded = { data: null, error: new ${error}() };
                        this.refreshingDeferred.resolve(discarded);
                        return discarded;
                    }`;
  await writeFile(path, source.replace(anchor, insertion));
}
console.log("분리 테스트용 auth-js 갱신 실패 보호 패치 확인");
