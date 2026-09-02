#!/usr/bin/env node
/*
 * 자가복구 postinstall — node 버전(특히 v24+)에서 깨지는 네이티브 설치를
 * install 마다 점검·복구해 재발을 막는다. 모두 best-effort: 어떤 단계가
 * 실패해도 install 전체를 abort 시키지 않는다(항상 exit 0).
 *
 * 배경(2026-06-23, node v26.3.0):
 *   1) electron 의 extract-zip 압축해제가 조용히 truncate → dist/version·path.txt
 *      누락 → "Electron failed to install correctly". 캐시 zip 자체는 멀쩡하므로
 *      system unzip 으로 재추출하면 복구된다.
 *   2) node-pty 의 macOS prebuild spawn-helper 가 실행비트(+x) 없이 풀려
 *      pty.fork → posix_spawnp 가 실패 → 오케/에이전트 PTY 즉사.
 *   3) electron-rebuild 가 yargs ESM 로 크래시 → `&&` 체인이 postinstall 을
 *      통째로 중단시켜 위 가드들이 실행조차 못 함. 유일 네이티브인 node-pty 는
 *      N-API prebuild 라 rebuild 불요 → electron-rebuild 실패는 무해, tolerant 처리.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const log = (m) => console.log(`[postinstall] ${m}`);
const warn = (m) => console.warn(`[postinstall] ${m}`);

// ── 1) electron-rebuild (tolerant) ──────────────────────────────────────────
// 지원 node(20–22)에선 정상 수행, 비호환 node(24+)에선 실패하지만 install 을
// 막지 않는다. node-pty(유일 네이티브)는 prebuild 로 동작하므로 안전하다.
function runElectronRebuild() {
  const bin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron-rebuild.cmd" : "electron-rebuild"
  );
  if (!fs.existsSync(bin)) {
    warn("electron-rebuild not found — skip");
    return;
  }
  try {
    execFileSync(bin, { stdio: "inherit" });
    log("electron-rebuild ok");
  } catch (err) {
    warn(
      `electron-rebuild failed (무시함 — node-pty 는 prebuild 라 불요): ${err.message}`
    );
  }
}

// ── 2) electron 설치 자가복구 ────────────────────────────────────────────────
const ELECTRON_DIR = path.join(ROOT, "node_modules", "electron");

function electronPlatformPath() {
  switch (process.platform) {
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    default:
      return "electron";
  }
}

function electronVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ELECTRON_DIR, "package.json"), "utf8")
    );
    return pkg.version;
  } catch {
    return null;
  }
}

function electronHealthy(version) {
  try {
    const distVer = fs
      .readFileSync(path.join(ELECTRON_DIR, "dist", "version"), "utf8")
      .trim()
      .replace(/^v/, "");
    if (distVer !== version) return false;
    const rel = fs.readFileSync(path.join(ELECTRON_DIR, "path.txt"), "utf8");
    return fs.existsSync(path.join(ELECTRON_DIR, "dist", rel));
  } catch {
    return false;
  }
}

function electronCacheZip(version) {
  const name = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const home = os.homedir();
  const dirs = [];
  if (process.env.electron_config_cache)
    dirs.push(process.env.electron_config_cache);
  if (process.platform === "darwin")
    dirs.push(path.join(home, "Library", "Caches", "electron"));
  else if (process.platform === "win32")
    dirs.push(
      path.join(
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
        "electron",
        "Cache"
      )
    );
  else
    dirs.push(
      path.join(
        process.env.XDG_CACHE_HOME || path.join(home, ".cache"),
        "electron"
      )
    );
  return dirs.map((d) => path.join(d, name)).find((p) => fs.existsSync(p));
}

function extractZip(zip, dest) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dest], { stdio: "inherit" });
  }
}

function repairElectron() {
  const version = electronVersion();
  if (!version) {
    warn("electron package 없음 — repair skip");
    return;
  }
  if (electronHealthy(version)) return; // 정상 → 무동작

  warn(`electron 설치 손상 감지 (v${version}) — 캐시에서 재추출 시도`);
  const zip = electronCacheZip(version);
  if (!zip) {
    warn(
      "캐시 zip 없음 — 지원 node(20–22)로 `npm install` 하면 정상 다운로드/추출됨"
    );
    return;
  }
  const dist = path.join(ELECTRON_DIR, "dist");
  try {
    if (fs.existsSync(dist))
      fs.renameSync(dist, `${dist}.broken-${process.pid}`);
    fs.mkdirSync(dist, { recursive: true });
    extractZip(zip, dist);
    // zip 에 electron.d.ts 가 들어있으면 패키지 루트로 올린다(설치본 규약)
    const dts = path.join(dist, "electron.d.ts");
    if (fs.existsSync(dts))
      fs.renameSync(dts, path.join(ELECTRON_DIR, "electron.d.ts"));
    fs.writeFileSync(
      path.join(ELECTRON_DIR, "path.txt"),
      electronPlatformPath()
    );
    if (electronHealthy(version))
      log(`electron 재추출 복구 완료 (v${version})`);
    else warn("재추출 후에도 비정상 — 수동 점검 필요");
  } catch (err) {
    warn(`electron 재추출 실패: ${err.message}`);
  }
}

// ── 3) node-pty spawn-helper 실행권한 보장 ───────────────────────────────────
function fixPtyPerms() {
  const prebuilds = path.join(ROOT, "node_modules", "node-pty", "prebuilds");
  for (const p of ["darwin-arm64", "darwin-x64"]) {
    const file = path.join(prebuilds, p, "spawn-helper");
    try {
      if (!fs.existsSync(file)) continue;
      fs.chmodSync(file, 0o755);
      log(`chmod +x ${path.relative(ROOT, file)}`);
    } catch (err) {
      warn(`spawn-helper skip ${file}: ${err.message}`);
    }
  }
}

// ── 4) 실행 마커 ─────────────────────────────────────────────────────────────
// postinstall 은 best-effort(항상 exit 0)라 "안 돌았다"를 스스로 알릴 방법이
// 없다. 완주하면 마커를 남겨 predev 헬스체크·수동 점검이 실행 사실을 확인할
// 수 있게 한다.
function writeMarker() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
    );
    const marker = {
      version: pkg.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ranAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(ROOT, "node_modules", ".marblo-postinstall-ok"),
      JSON.stringify(marker, null, 2) + "\n"
    );
    log(`marker written: node_modules/.marblo-postinstall-ok (v${pkg.version})`);
  } catch (err) {
    warn(`marker write failed: ${err.message}`);
  }
}

// 각 단계를 개별 try/catch 로 감싼다 — 단계 내부 로직이 다시 예외를 흘려도
// 뒤 단계(특히 fixPtyPerms/writeMarker)가 실행되지 않는 일이 없도록 한다.
for (const step of [runElectronRebuild, repairElectron, fixPtyPerms]) {
  try {
    step();
  } catch (err) {
    warn(`${step.name} 에서 처리되지 않은 예외 (무시하고 계속): ${err.message}`);
  }
}
writeMarker();
