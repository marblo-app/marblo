#!/usr/bin/env node
/*
 * dist-mcp 자기완결(self-contained) 번들.
 *
 * 배경: build:mcp 는 tsc 로 electron/mcp-server → dist-mcp/*.js 를 컴파일만 했다.
 * 이 산출물은 `import { McpServer } from "@modelcontextprotocol/sdk/..."` 같은
 * bare specifier 를 그대로 남긴다. dev 에서는 dist-mcp/index.js 가 상위
 * v3/node_modules 로 해석되어 동작하지만, 패키지 앱에서는 dist-mcp 가 asar 밖
 * extraResource(Contents/Resources/dist-mcp)로 복사되고 그 옆엔 node_modules 가
 * 없다. app.asar 안의 node_modules 는 ESM bare import 가 뚫지 못해
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'
 * 로 MCP 서버가 부팅 즉사 → 오케/에이전트 claude 가 "Failed to reconnect to
 * marblo: -32000". (#339 는 index.js 경로만 고쳤고, 그 다음 레이어인 런타임
 * 의존성 동봉이 빠져 있었다. 티켓 8xcs6lldq7VDbWDJ9sNj.)
 *
 * 해결: tsc 직후 esbuild 로 dist-mcp/index.js 와 그 의존성(@modelcontextprotocol
 * /sdk · firebase · zod)을 단일 파일로 인라인해 런타임 node_modules 를 아예
 * 불필요하게 만든다. 포맷은 ESM 유지 — (1) tools.ts 의 import.meta.url(SKILLS_DIR
 * fallback) 이 CJS 에서 빈 값이 되는 것을 피하고, (2) createRequire banner 로
 * firebase 의 transitive dep @grpc/grpc-js 가 쓰는 CJS require() 를 실 require 로
 * 연결한다(ESM 기본 __require 는 "Dynamic require ... not supported" 로 던짐).
 *
 * 네이티브 의존성은 없다(@modelcontextprotocol/sdk · firebase · zod · node
 * builtin 뿐) → external 지정 불필요, 단일 파일로 완전 자립.
 */
import { build } from "esbuild";
import { renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distMcpDir = fileURLToPath(new URL("../dist-mcp/", import.meta.url));
async function bundleMcpEntry(filename) {
  const entry = path.join(distMcpDir, filename);
  // 입력==출력 을 피하려 임시 파일로 뽑은 뒤 원자적으로 교체한다.
  const tmp = path.join(distMcpDir, `${filename}.bundle.mjs`);

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: tmp,
    // ESM 번들 안의 CJS 의존성(@grpc/grpc-js 등)이 부르는 require() 를 실제 require
    // 로 연결. 이게 없으면 esbuild 의 __require shim 이 런타임에 throw 한다.
    banner: {
      js: "import{createRequire as ___marbloCreateRequire}from'module';const require=___marbloCreateRequire(import.meta.url);",
    },
    logLevel: "warning",
  });

  renameSync(tmp, entry);
  // tsc 가 남긴 개별 소스맵은 번들과 어긋나므로 제거(번들은 맵 없이 출력).
  try {
    rmSync(path.join(distMcpDir, `${filename}.map`), { force: true });
  } catch {
    /* best-effort */
  }
}

await bundleMcpEntry("index.js");
await bundleMcpEntry("cli-fallback.js");

console.log(
  "[bundle-mcp] dist-mcp/index.js + cli-fallback.js self-contained ESM 번들 완료",
);
