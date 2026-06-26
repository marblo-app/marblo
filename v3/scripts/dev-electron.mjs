#!/usr/bin/env node
/*
 * 크로스플랫폼 dev electron 런처.
 * 기존 dev 스크립트는 `sleep 2 && electron .` 였으나 윈도우 cmd 에는 sleep 이
 * 없어 즉시 실패 → concurrently -k 가 vite/tsc 까지 죽였다. 인라인 `node -e`
 * 도 화살표함수의 `>` 가 cmd 리다이렉트로 먹혀 깨진다. 그래서 셸 의존 없는
 * 별도 파일로 분리: vite dev 서버 포트(5173)가 열릴 때까지 폴링 후 electron 기동.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import electron from "electron"; // 패키지 default export = electron 실행파일 경로

// 윈도우에서 vite 는 localhost 를 IPv6(::1) 로만 바인딩하므로 IPv4/IPv6 둘 다 찌른다.
const HOSTS = ["::1", "127.0.0.1"];
const PORT = 5173; // vite.config.ts server.port 와 일치
const TIMEOUT_MS = 30000;
const POLL_MS = 300;

function probe(host) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: PORT });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

async function waitForVite() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const results = await Promise.all(HOSTS.map(probe));
    if (results.some(Boolean)) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return false; // 타임아웃이어도 기동은 시도 (electron 쪽에서 재시도)
}

// dist-electron/main.js 가 더 이상 안 바뀔 때까지(= tsc 빌드 emit 완료) 대기.
// dev 스크립트는 `tsc --watch` 와 이 런처를 concurrently 로 병렬 실행한다. tsc 의
// 부팅 시 컴파일이 dist-electron/*.js 를 다시 써내리는 동안 electron 이 그 파일을
// require 하면 torn read → "X is not a function"(예: scheduleHarnessUpdates) 로
// 죽는다. main.js mtime 이 STABLE_MS 동안 안 변할 때만 기동해 모든 파일이 끝까지
// 쓰였음을 보장한다. (electron tsconfig 의 incremental 이 재emit 을 대부분 막지만,
// 이 가드는 그와 무관하게 torn read 를 닫는 안전망이다.)
const MAIN_JS = path.resolve("dist-electron", "main.js");
const STABLE_MS = 700;
const STABLE_TIMEOUT_MS = 30000;

async function waitForStableBuild() {
  const deadline = Date.now() + STABLE_TIMEOUT_MS;
  let lastMtime = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    let mtime = -1;
    try {
      mtime = fs.statSync(MAIN_JS).mtimeMs;
    } catch {
      /* 아직 emit 안 됨 */
    }
    if (mtime < 0) {
      stableSince = Date.now(); // 아직 안정성 판단 불가
    } else if (mtime !== lastMtime) {
      lastMtime = mtime;
      stableSince = Date.now(); // 쓰기 발생 → 안정 윈도우 리셋
    } else if (Date.now() - stableSince >= STABLE_MS) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const ready = await waitForVite();
if (!ready) {
  console.warn(`[dev-electron] vite(:${PORT}) 미응답 — 그래도 electron 기동 시도`);
}

const built = await waitForStableBuild();
if (!built) {
  console.warn(
    `[dev-electron] dist-electron 빌드 안정화 대기 타임아웃 — 그래도 기동 시도`,
  );
}

const child = spawn(electron, [".", "--remote-debugging-port=9222"], {
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 0));
