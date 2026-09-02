#!/usr/bin/env node
/*
 * predev 헬스체크 — dev 기동 직전에 postinstall 자가복구(electron 설치,
 * node-pty spawn-helper 실행비트)가 실제로 반영됐는지 확인한다.
 *
 * postinstall.mjs 는 best-effort(항상 exit 0)라 "안 돌았다/실패했다"를 스스로
 * 알릴 방법이 없다. 어긋난 채로 dev 를 띄우면 pty.fork → posix_spawnp 가
 * EACCES 로 실패해 오케/에이전트 PTY 가 런타임에 조용히 즉사한다. 그보다
 * 기동 자체를 막고 복구 명령을 안내하는 편이 낫다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RECOVER = "node scripts/postinstall.mjs";

const problems = [];

// ── 1) electron 설치 존재 ────────────────────────────────────────────────────
const electronDist = path.join(ROOT, "node_modules", "electron", "dist");
if (!fs.existsSync(electronDist)) {
  problems.push(
    `electron 설치가 없습니다: ${path.relative(ROOT, electronDist)} 가 존재하지 않습니다.`
  );
}

// ── 2) node-pty spawn-helper 실행권한 (darwin 전용) ─────────────────────────
if (process.platform === "darwin") {
  const spawnHelper = path.join(
    ROOT,
    "node_modules",
    "node-pty",
    "prebuilds",
    `darwin-${process.arch}`,
    "spawn-helper"
  );
  if (!fs.existsSync(spawnHelper)) {
    problems.push(
      `node-pty spawn-helper 가 없습니다: ${path.relative(ROOT, spawnHelper)}`
    );
  } else {
    const mode = fs.statSync(spawnHelper).mode;
    const executable = (mode & 0o111) !== 0;
    if (!executable) {
      problems.push(
        `node-pty spawn-helper 에 실행비트가 없습니다 (mode ${(mode & 0o777).toString(8)}): ` +
          `${path.relative(ROOT, spawnHelper)}\n` +
          `  → pty.fork 가 posix_spawnp 에서 EACCES 로 실패해 오케/에이전트 PTY 가 즉사합니다.`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("[predev-health] dev 기동을 막았습니다 — 아래 문제를 먼저 해결하세요:\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n복구: ${RECOVER}`);
  console.error("복구 후 다시 npm run dev 를 실행하세요.");
  process.exit(1);
}

console.log("[predev-health] ok");
