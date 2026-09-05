#!/usr/bin/env node

// "머지됐다 ≠ 배포됐다"(docs/wiki/50-operations/reach-user-not-merged.md) 를
// 서버 축에도 적용한다. Gen1 Cloud Functions 는 Cloud Run 의 K_REVISION 같은
// 배포 메타데이터를 주지 않고, `firebase.json` 의 `ignore: [".git"]` 때문에
// 배포 아티팩트에는 `.git` 도 없다 — 그래서 런타임에서 커밋을 읽을 방법이
// 없다. 유일한 창구는 **predeploy 시점**(로컬, `.git` 이 있다)에 커밋을
// 소스 파일로 구워 넣는 것이다.
//
// ★이 스크립트는 절대 실패하지 않는다 — git 이 없거나 워크트리라 `.git` 이
//   달라도(`.marblo/worktrees/...`) `npm run build` 전체를 막으면 안 된다.
//   실패하면 "unknown" 으로 채운 파일을 대신 쓴다.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_FILE = resolve(FUNCTIONS_DIR, "src", "buildInfo.generated.ts");

function gitValue(args) {
  try {
    return execFileSync("git", args, {
      cwd: FUNCTIONS_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const commitSha = gitValue(["rev-parse", "HEAD"]) ?? "unknown";
const commitShaShort = gitValue(["rev-parse", "--short", "HEAD"]) ?? "unknown";
const commitDateIso =
  gitValue(["log", "-1", "--format=%cI", "HEAD"]) ?? "unknown";
const builtAtIso = new Date().toISOString();

const contents = `// ★생성 파일 — 손으로 고치지 않는다. \`npm run build\`(predeploy) 가
// scripts/generate-build-info.mjs 로 매번 새로 쓴다. .gitignore 대상.
export const BUILD_COMMIT_SHA = ${JSON.stringify(commitSha)};
export const BUILD_COMMIT_SHA_SHORT = ${JSON.stringify(commitShaShort)};
export const BUILD_COMMIT_DATE_ISO = ${JSON.stringify(commitDateIso)};
export const BUILT_AT_ISO = ${JSON.stringify(builtAtIso)};
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, contents, "utf8");
console.log(
  `[generate-build-info] ${commitShaShort} (${commitDateIso}), built ${builtAtIso}`,
);
