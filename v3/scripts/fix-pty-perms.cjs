#!/usr/bin/env node
// node-pty 의 macOS prebuild 보조 바이너리(spawn-helper)는 npm install 과정에서
// 실행 비트(+x)가 누락된 채 풀리는 경우가 있다. 이러면 node-pty 의 pty.fork →
// posix_spawnp 가 "posix_spawnp failed" 로 던지고, 그 PTY 를 쓰는 오케스트레이터/
// 에이전트 터미널이 즉시 죽어 빨간 Error 로 떨어진다. electron-rebuild 는 prebuild
// 방식 node-pty 의 helper 실행 비트를 복구하지 않으므로, install 마다 여기서 보장한다.
//
// 크로스플랫폼 안전: 파일이 없으면(=linux/win prebuild 또는 source 빌드) 조용히 스킵.
const fs = require("fs");
const path = require("path");

const prebuilds = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "node-pty",
  "prebuilds"
);

const targets = ["darwin-arm64", "darwin-x64"].map((p) =>
  path.join(prebuilds, p, "spawn-helper")
);

for (const file of targets) {
  try {
    if (!fs.existsSync(file)) continue;
    fs.chmodSync(file, 0o755);
    console.log(
      `[fix-pty-perms] chmod +x ${path.relative(process.cwd(), file)}`
    );
  } catch (err) {
    // best-effort — 권한 복구 실패가 install 전체를 막지 않도록 한다.
    console.warn(`[fix-pty-perms] skip ${file}: ${err.message}`);
  }
}
