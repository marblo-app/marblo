#!/usr/bin/env node
/*
 * dist-electron/preload.js 자기완결(self-contained) 번들.
 *
 * ── 왜 필요한가 (티켓 zTwKGyaveJYHEno7G7os) ────────────────────────────────
 * Electron 20+ 는 preload 를 **sandbox** 에서 돌린다(우리는 sandbox 를 끄지
 * 않았고, 끌 생각도 없다). sandbox preload 의 require 는 electron 과 일부
 * node builtin 만 해석하는 축소판이라 node_modules 패키지를 못 읽는다.
 * 그래서 tsc 단독 산출물의
 *
 *     require("@sentry/electron/preload")
 *
 * 는 실행되는 순간 `Error: module not found: @sentry/electron/preload` 로
 * 죽는다. 실측(main.ts 와 동일한 webPreferences 로 프로브):
 *
 *     PROBE RESULT {"sandboxed":true,"sentryIpc":"undefined",...}
 *
 * 즉 렌더러↔메인 Sentry 브릿지(window.__SENTRY_IPC__)가 **한 번도 설치된 적이
 * 없었다.** try/catch 가 에러를 삼켜 무증상이었을 뿐이다 — #583 이전의 "배선은
 * 됐는데 init 은 한 번도 안 됐다" 와 정확히 같은 은폐 구조.
 *
 * PR #583 이 sentry-main.ts 의 ipcMode 를 Classic 으로 고정했는데, Classic 은
 * 평범한 ipcMain/ipcRenderer 채널을 쓰고 **그 채널을 까는 주체가 바로 이
 * preload require** 다. 둘은 한 쌍이라 이 번들 없이는 Classic 전환이 반쪽이다.
 * (contextIsolation:true + 커스텀 preload 조합이라 SDK 자동주입도 불가 —
 * 이 require 가 유일한 경로다.)
 *
 * 해결: esbuild 로 의존성을 산출물에 인라인해 런타임 require 자체를 없앤다.
 * `electron` 만 external — sandbox preload 도 그건 해석할 수 있다.
 *
 * ── DSN 미설정 = 완전 no-op (회귀 금지 불변식) ────────────────────────────
 * 렌더러(src/lib/telemetry/sentry.ts)와 메인(electron/sentry-main.ts)은 DSN 이
 * 없으면 SDK 를 import 조차 안 한다. preload 도 같아야 한다. 번들러는 그냥
 * 두면 DSN 과 무관하게 SDK 를 인라인하므로, 빌드시 DSN 유무를
 * `__SENTRY_PRELOAD_ENABLED__` define 으로 구워 넣어 esbuild 가 dead-code 를
 * 제거하게 한다. 실측 산출물 크기: DSN on 2.4kb(브릿지 인라인) / off 136b
 * (SDK 코드 0바이트, 완전 부재).
 *
 * ── 침묵 방지 ──────────────────────────────────────────────────────────────
 * 이 버그의 본질은 "조용히 안 된다" 였다. 그래서 번들 직후 산출물을 직접 열어
 * 기대와 다르면 **빌드를 실패시킨다**(verifyArtifact). DSN 을 켜고 릴리스를
 * 굽는데 브릿지가 빠지는 상황은 이제 exit 1 이지 무증상이 아니다.
 *
 * ── tsc 와의 관계 ──────────────────────────────────────────────────────────
 * tsc 는 여전히 preload.ts 를 타입체크하고 dist-electron/preload.js 로 emit
 * 한다. 이 스크립트는 그 **뒤에** 돌아 같은 경로를 번들본으로 덮어쓴다.
 * 순서는 package.json 에서 `tsc && node scripts/bundle-preload.mjs` 로 보장.
 * 출력 경로를 tsc 와 같게 유지한 건 의도적이다 — 번들 스텝이 빠진 빌드는
 * "preload 파일 자체가 없어 window.electronAPI 가 undefined → 화이트스크린"
 * (#405 부류의 치명적 실패) 대신 "Sentry 만 빠진 정상 앱" 으로 degrade 한다.
 *
 * dev 주의: `tsc --watch` 가 preload.ts 변경을 감지하면 이 번들본을 tsc 원본
 * 으로 되돌린다. 그 상태의 preload 는 `__SENTRY_PRELOAD_ENABLED__` 가
 * undefined 이므로 preload.ts 가 "번들 안 됨" 경고를 콘솔에 찍는다(침묵 아님).
 * 되살리려면 dev 를 재시작하면 된다 — electron 메인 프로세스는 어차피
 * tsc --watch 로 자동 재시작되지 않으므로 기존 dev 제약과 동일하다.
 */
import { build } from "esbuild";
import { readFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ENTRY = join(ROOT, "electron", "preload.ts");
const OUTFILE = join(ROOT, "dist-electron", "preload.js");
const TMP = `${OUTFILE}.bundle.tmp`;

/** Minimal .env parser — KEY=VALUE, `#` comments, optional quotes, `export `. */
function parseEnvFile(path) {
  const out = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7) : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!key) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Resolve VITE_SENTRY_DSN exactly the way `vite build` would, so the preload's
 * on/off state can never disagree with the renderer's (which reads the value
 * through `import.meta.env`). Precedence, lowest → highest:
 *   .env < .env.local < .env.[mode] < .env.[mode].local < real process env
 */
export function resolveDsn(root = ROOT, mode = undefined, env = process.env) {
  mode = mode || env.VITE_MODE || env.NODE_ENV || "production";
  const resolved = {};
  for (const name of [
    ".env",
    ".env.local",
    `.env.${mode}`,
    `.env.${mode}.local`,
  ]) {
    const path = join(root, name);
    if (existsSync(path)) Object.assign(resolved, parseEnvFile(path));
  }
  if (env.VITE_SENTRY_DSN) resolved.VITE_SENTRY_DSN = env.VITE_SENTRY_DSN;
  const dsn = resolved.VITE_SENTRY_DSN;
  // Treat placeholders (.env.example ships `<your-dsn>` style values) as unset.
  if (!dsn || /^(your[-_]|<|xxx+$|changeme$|placeholder$)/i.test(dsn))
    return null;
  return dsn;
}

// The string the @sentry/electron preload bridge inlines. Its presence in the
// artifact is our proof that the bridge did (or did not) get bundled.
const BRIDGE_MARKER = "__SENTRY_IPC__";

/**
 * Read the emitted bundle back and assert it matches the intent. This is the
 * anti-silence guard: a release built WITH a DSN but WITHOUT the bridge is the
 * exact failure this ticket exists to kill, so it must break the build.
 */
export function verifyBundle(code, sentryEnabled) {
  const hasBridge = code.includes(BRIDGE_MARKER);
  // Sanity: the bundle is worthless if it lost the main API surface.
  if (!code.includes("exposeInMainWorld")) {
    throw new Error(
      "[bundle-preload] 산출물에 contextBridge.exposeInMainWorld 가 없다 — 번들이 깨졌다.",
    );
  }
  // No unresolved bare requires may survive; sandbox preload cannot serve them.
  const bareRequire = code.match(/require\("(?!electron"|node:)[^"]+"\)/);
  if (bareRequire) {
    throw new Error(
      `[bundle-preload] 산출물에 미해결 require 가 남았다: ${bareRequire[0]} — sandbox preload 에서 죽는다.`,
    );
  }
  if (sentryEnabled && !hasBridge) {
    throw new Error(
      "[bundle-preload] DSN 이 설정됐는데 Sentry 브릿지가 번들에 없다 — 릴리스가 조용히 깨진다.",
    );
  }
  if (!sentryEnabled && hasBridge) {
    throw new Error(
      "[bundle-preload] DSN 이 없는데 Sentry SDK 가 번들에 들어갔다 — no-op 불변식 위반.",
    );
  }
  return { bytes: code.length, hasBridge };
}

async function main() {
  const sentryEnabled = resolveDsn(ROOT, process.argv[2]) !== null;

  await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: "node",
    format: "cjs",
    // Electron 33 ships Node 20.
    target: "node20",
    outfile: TMP,
    // `electron` is the one module a sandboxed preload's require CAN resolve —
    // it must stay a runtime require, never be inlined.
    external: ["electron"],
    // Baked build-time switch. preload.ts guards on `typeof` first, so the
    // un-bundled tsc output (where this identifier does not exist) degrades to
    // a warning instead of a ReferenceError that would abort the module before
    // exposeInMainWorld and white-screen the app (#405).
    define: { __SENTRY_PRELOAD_ENABLED__: sentryEnabled ? "true" : "false" },
    logLevel: "warning",
  });

  renameSync(TMP, OUTFILE);
  // tsc's per-file source map no longer matches the bundle.
  rmSync(`${OUTFILE}.map`, { force: true });

  const code = readFileSync(OUTFILE, "utf8");
  const { hasBridge } = verifyBundle(code, sentryEnabled);

  // NEVER log the DSN itself — presence only.
  console.log(
    `[bundle-preload] dist-electron/preload.js 번들 완료 ` +
      `(${code.length}B, VITE_SENTRY_DSN ${sentryEnabled ? "설정됨" : "미설정"}, ` +
      `Sentry 브릿지 ${hasBridge ? "포함" : "제외(no-op)"})`,
  );
}

// Only build when run as a script; importing this module (unit tests) must not
// touch dist-electron.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
