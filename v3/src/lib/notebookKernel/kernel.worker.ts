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
import {
  KERNEL_FONT_PATH,
  NOTEBOOK_FONT_URL,
  PYODIDE_BASE,
  looksLikeFont,
  parseRunnerPayload,
} from "./protocol";
import type {
  KernelErrorCode,
  KernelRequest,
  KernelResponse,
  KernelStatus,
} from "./protocol";

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
  /** Emscripten's in-memory filesystem — how host bytes reach the interpreter. */
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
}

const post = (message: KernelResponse) => self.postMessage(message);
const status = (s: KernelStatus) => post({ type: "status", status: s });

let pyodidePromise: Promise<PyodideApi> | null = null;

/**
 * Carries a machine-readable cause across the worker boundary. `message` stays
 * English-only and diagnostic — the renderer replaces it with a localized,
 * actionable one keyed off `code` (see NotebookKernel.describe).
 */
class KernelError extends Error {
  constructor(
    message: string,
    readonly code: KernelErrorCode,
  ) {
    super(message);
  }
}

/** Fails fast, with a cause the UI can act on, when the runtime is absent. */
async function assertAssetsPresent(): Promise<void> {
  let response: Response;
  try {
    // no-store: the answer changes the moment the developer runs the vendoring
    // script, and Retry has to see that — a cached "missing" would make the
    // button look broken right after the fix landed.
    response = await fetch(`${PYODIDE_BASE}pyodide-lock.json`, {
      cache: "no-store",
    });
  } catch (e) {
    // The dev server not serving /pyodide/ at all is the same user-visible
    // situation as the directory being empty: nothing was ever vendored.
    throw new KernelError(
      `pyodide-lock.json unreachable: ${e instanceof Error ? e.message : String(e)}`,
      "missing-assets",
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
    throw new KernelError(
      "pyodide-lock.json missing or not a lock file",
      "missing-assets",
    );
  }
}

/**
 * Stages the bundled Hangul font inside the kernel filesystem and tells
 * runner.py where it landed. Throws on any problem — the caller downgrades
 * that to a warning, because Korean labels rendering as boxes is a far smaller
 * bug than the notebook refusing to run at all.
 */
async function installKoreanFont(pyodide: PyodideApi): Promise<void> {
  const response = await fetch(NOTEBOOK_FONT_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!looksLikeFont(bytes)) {
    throw new Error(`${NOTEBOOK_FONT_URL} 응답이 폰트 파일이 아닙니다.`);
  }
  pyodide.FS.mkdirTree(
    KERNEL_FONT_PATH.slice(0, KERNEL_FONT_PATH.lastIndexOf("/")),
  );
  pyodide.FS.writeFile(KERNEL_FONT_PATH, bytes);
  // JSON.stringify of an ASCII path is also a valid Python string literal.
  pyodide.runPython(`__marblo_set_font(${JSON.stringify(KERNEL_FONT_PATH)})`);
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
    try {
      await installKoreanFont(pyodide);
    } catch (e) {
      // Charts fall back to DejaVu (tofu for Hangul), everything else is
      // unaffected. Never fail kernel startup over a font.
      console.warn("[notebook] 한글 폰트 등록 실패:", e);
    }
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
    const code = e instanceof KernelError ? e.code : undefined;
    status({
      phase: code === "missing-assets" ? "missing-assets" : "failed",
      // Missing assets get their whole explanation from the renderer, which can
      // translate it; a generic failure has nothing better than its own message.
      detail: code === "missing-assets" ? undefined : message,
    });
    post({ type: "error", id, message, code });
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
