/// <reference lib="webworker" />
// Pyodide kernel for the Code tab's notebook view.
//
// Runs in a worker for two reasons: a `while True:` in a cell must not freeze
// the app (the worker can be terminated), and the wasm instantiation + wheel
// loading would otherwise block the UI thread for seconds.
//
// Everything is loaded from PYODIDE_BASE on the app's own origin — the runtime,
// the stdlib and the wheels are all vendored by scripts/fetch-pyodide-assets.mjs.
// No CDN is contacted at runtime.

import runnerSource from "./runner.py?raw";
import { PYODIDE_BASE, parseRunnerPayload } from "./protocol";
import type { KernelRequest, KernelResponse, KernelStatus } from "./protocol";

// Minimal surface of the Pyodide API we use — the real types live in the
// pyodide package, but this worker loads the runtime at runtime (not via a
// bundled import), so it types the handful of members it touches.
interface PyodideApi {
  runPython(code: string): unknown;
  loadPackagesFromImports(
    code: string,
    options?: { messageCallback?: (msg: string) => void },
  ): Promise<void>;
  globals: { get(name: string): ((arg: string) => string) | undefined };
}

const post = (message: KernelResponse) => self.postMessage(message);
const status = (s: KernelStatus) => post({ type: "status", status: s });

let pyodidePromise: Promise<PyodideApi> | null = null;

/** Fails fast with a clear message when the vendored runtime is absent. */
async function assertAssetsPresent(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${PYODIDE_BASE}pyodide-lock.json`);
  } catch (e) {
    throw new Error(
      `Pyodide 자산을 읽을 수 없습니다 (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  // The app's static server answers unknown paths with index.html + 200, so a
  // status check alone is not enough — the body has to actually be the lock.
  const text = await response.text();
  try {
    const lock: unknown = JSON.parse(text);
    if (
      typeof lock !== "object" ||
      lock === null ||
      !("packages" in (lock as Record<string, unknown>))
    ) {
      throw new Error("shape");
    }
  } catch {
    throw new Error(
      "Pyodide 자산이 설치되어 있지 않습니다. `node scripts/fetch-pyodide-assets.mjs` 를 실행하세요.",
    );
  }
}

async function getPyodide(): Promise<PyodideApi> {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = (async () => {
    await assertAssetsPresent();
    status({ phase: "loading-runtime", detail: "Python 런타임 로드 중" });
    // @vite-ignore: this URL is served verbatim from public/, so the bundler
    // must not try to resolve or transform Pyodide's loader.
    const loaderUrl = new URL(
      `${PYODIDE_BASE}pyodide.mjs`,
      self.location.origin,
    ).href;
    const module = (await import(/* @vite-ignore */ loaderUrl)) as {
      loadPyodide: (options: {
        indexURL: string;
        stdout?: (text: string) => void;
      }) => Promise<PyodideApi>;
    };
    const pyodide = await module.loadPyodide({
      indexURL: new URL(PYODIDE_BASE, self.location.origin).href,
    });
    // AGG, not the interactive backend: a worker has no document, so figures
    // are rendered off-screen and captured as PNGs by runner.py.
    pyodide.runPython("import os\nos.environ['MPLBACKEND'] = 'AGG'");
    pyodide.runPython(runnerSource);
    return pyodide;
  })();
  pyodidePromise.catch(() => {
    // Let the next Run retry from scratch instead of caching the failure.
    pyodidePromise = null;
  });
  return pyodidePromise;
}

async function run(id: number, code: string): Promise<void> {
  let pyodide: PyodideApi;
  try {
    pyodide = await getPyodide();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    status({
      phase: message.includes("자산") ? "missing-assets" : "failed",
      detail: message,
    });
    post({ type: "error", id, message });
    return;
  }

  try {
    // Only the wheels this cell's imports actually need — a cell that just
    // prints never pays for pandas.
    status({ phase: "loading-packages", detail: "패키지 확인 중" });
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (detail) =>
        status({ phase: "loading-packages", detail }),
    });

    status({ phase: "running" });
    const runner = pyodide.globals.get("__marblo_run");
    if (!runner) throw new Error("커널 러너가 초기화되지 않았습니다.");
    const payload = runner(code);
    post({ type: "result", id, ...parseRunnerPayload(payload) });
    status({ phase: "ready" });
  } catch (e) {
    post({
      type: "error",
      id,
      message: e instanceof Error ? e.message : String(e),
    });
    status({ phase: "ready" });
  }
}

self.onmessage = (event: MessageEvent<KernelRequest>) => {
  const message = event.data;
  if (message.type === "run") {
    void run(message.id, message.code);
    return;
  }
  if (message.type === "reset") {
    void (async () => {
      try {
        const pyodide = await getPyodide();
        pyodide.runPython("__marblo_reset()");
        post({ type: "result", id: message.id, outputs: [], failed: false });
        status({ phase: "ready" });
      } catch (e) {
        post({
          type: "error",
          id: message.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }
};
