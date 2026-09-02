#!/usr/bin/env node
/*
 * 크로스플랫폼 dev electron 런처.
 * 기존 dev 스크립트는 `sleep 2 && electron .` 였으나 윈도우 cmd 에는 sleep 이
 * 없어 즉시 실패 → concurrently -k 가 vite/tsc 까지 죽였다. 인라인 `node -e`
 * 도 화살표함수의 `>` 가 cmd 리다이렉트로 먹혀 깨진다. 그래서 셸 의존 없는
 * 별도 파일로 분리: vite dev 서버 포트가 열릴 때까지 폴링 후 electron 기동.
 *
 * 포트/호스트/origin 은 electron/dev-server-origin.ts 하나에서만 정의되고, 이
 * 런처는 그 컴파일 산출물(dist-electron/dev-server-origin.js)을 읽는다 — electron
 * 이 loadURL 하는 값과 물리적으로 같은 출처다 (티켓 L1LQjuQhRiW2hIoBkOAs).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import electron from "electron"; // 패키지 default export = electron 실행파일 경로

const TIMEOUT_MS = 30000;
const POLL_MS = 300;

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

// ★순서 주의: 먼저 빌드 안정화를 기다린다. dev 포트/origin 상수는 electron 이
// 실제로 쓰는 것과 **같은 컴파일 산출물**(dist-electron/dev-server-origin.js)에서
// 읽어야 하기 때문이다. 여기서 포트를 따로 하드코딩하면 언젠가 vite.config.ts /
// main.ts 와 갈라져 origin 이 나뉜다 (티켓 L1LQjuQhRiW2hIoBkOAs).
const built = await waitForStableBuild();
if (!built) {
  console.warn(
    `[dev-electron] dist-electron 빌드 안정화 대기 타임아웃 — 그래도 기동 시도`,
  );
}

const ORIGIN_MODULE = path.resolve("dist-electron", "dev-server-origin.js");
let devOrigin;
try {
  const mod = await import(pathToFileURL(ORIGIN_MODULE).href);
  // tsc 는 CommonJS 로 emit 한다. node ESM 로더가 named export 를 뽑아주지만
  // 못 뽑는 경우를 대비해 default(module.exports) 로 폴백한다.
  devOrigin = typeof mod.devServerUrl === "function" ? mod : mod.default;
  if (typeof devOrigin?.waitForDevServer !== "function") {
    throw new Error("dev-server-origin 모듈에서 waitForDevServer 를 찾지 못했습니다");
  }
} catch (e) {
  console.error(
    `[dev-electron] ${ORIGIN_MODULE} 를 읽지 못했습니다 — dist-electron 빌드가 없거나 오래된 상태입니다.\n` +
      `조치: npm run dev 를 다시 실행하거나 \`npx tsc -p electron/tsconfig.json\` 로 먼저 빌드하세요.\n` +
      `원인: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}

const { ok, host } = await devOrigin.waitForDevServer({
  timeoutMs: TIMEOUT_MS,
  pollMs: POLL_MS,
});
if (!ok) {
  // ★조용히 기동하지 않는다. 예전엔 경고만 찍고 electron 을 띄웠는데, 그러면
  // 빈 창이 뜨고 원인이 안 보인다. 여기서 명확히 실패시킨다.
  console.error(devOrigin.devServerUnavailableMessage(devOrigin.DEV_SERVER_PORT, TIMEOUT_MS));
  process.exit(1);
}
console.log(
  `[dev-electron] vite 확인(${host}) → 렌더러 origin ${devOrigin.devServerOrigin()} 로 기동`,
);

const child = spawn(electron, [".", "--remote-debugging-port=9222"], {
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 0));
