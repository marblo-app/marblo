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

const ready = await waitForVite();
if (!ready) {
  console.warn(`[dev-electron] vite(:${PORT}) 미응답 — 그래도 electron 기동 시도`);
}

const child = spawn(electron, [".", "--remote-debugging-port=9222"], {
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 0));
