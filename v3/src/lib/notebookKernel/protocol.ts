// Wire types between the notebook kernel worker and the renderer, plus the
// pure helpers both sides use. Kept free of DOM/worker globals so the parsing
// rules are unit-testable in the node vitest suite.

import type { NotebookOutput } from "../notebook";

/** Where the kernel is in its (lazy) startup. */
export type KernelPhase =
  | "idle" // nothing loaded yet — first Run triggers startup
  | "loading-runtime" // downloading/instantiating the Pyodide wasm
  | "loading-packages" // pulling the wheels a cell's imports need
  | "ready"
  | "running"
  | "missing-assets" // src/public/pyodide was never vendored
  | "failed";

export interface KernelStatus {
  phase: KernelPhase;
  /** Human-readable detail, e.g. the package names being loaded. */
  detail?: string;
}

export type KernelRequest =
  | { type: "run"; id: number; code: string }
  | { type: "reset"; id: number };

/**
 * Machine-readable cause, so the renderer can localize the explanation and
 * offer the matching recovery UI.
 *
 * The worker deliberately does NOT translate: it is a separate module instance
 * with no access to the locale store (workers have no localStorage), so any
 * string it invents would be stuck in one language. It reports a code; the
 * renderer turns that into words.
 */
export type KernelErrorCode = "missing-assets";

export type KernelResponse =
  | { type: "status"; status: KernelStatus }
  | { type: "result"; id: number; outputs: NotebookOutput[]; failed: boolean }
  | {
      type: "error";
      id: number;
      message: string;
      code?: KernelErrorCode;
    };

/** The directory the vendored Pyodide runtime is served from. */
export const PYODIDE_BASE = "/pyodide/";

/**
 * The exact command that vendors the runtime, ready to paste into a shell at
 * the repo root. Single source of truth: the UI shows this string, the clipboard
 * button copies it, and `npm run dev` runs the same script via its pre-hook.
 */
export const PYODIDE_INSTALL_COMMAND = "cd v3 && npm run assets:pyodide";

/**
 * The bundled Hangul font, served from src/public/notebook-fonts/. Pyodide's
 * matplotlib carries DejaVu Sans only, which has no Hangul glyphs, so without
 * this every Korean chart label renders as a tofu box. See that directory's
 * README for the licence and why this font.
 */
export const NOTEBOOK_FONT_URL = "/notebook-fonts/Pretendard-Regular.otf";

/** Where the worker drops that font inside the kernel's own filesystem. */
export const KERNEL_FONT_PATH = "/marblo-fonts/Pretendard-Regular.otf";

/**
 * True when `bytes` opens with an sfnt signature (TrueType, CFF/OTF, or a
 * collection).
 *
 * The app's static server answers unknown paths with index.html and a 200, so
 * a successful fetch is not evidence the font is actually there — the same
 * trap assertAssetsPresent() works around for pyodide-lock.json. Handing that
 * HTML to matplotlib would surface as a puzzling font error instead of a clean
 * fallback to DejaVu.
 */
export function looksLikeFont(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const tag =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return (
    tag === 0x00010000 || // TrueType outlines
    tag === 0x4f54544f || // 'OTTO' — CFF outlines (what Pretendard ships)
    tag === 0x74727565 || // 'true'
    tag === 0x74746366 // 'ttcf' — TrueType collection
  );
}

/**
 * Validates what runner.py sent back. The worker hands us a JSON string built
 * in Python, so treat it as untrusted shape-wise: a malformed payload should
 * surface as a kernel error, never as a half-rendered cell.
 */
export function parseRunnerPayload(raw: string): {
  outputs: NotebookOutput[];
  failed: boolean;
} {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("커널이 예상치 못한 응답을 반환했습니다.");
  }
  const record = parsed as { outputs?: unknown; failed?: unknown };
  if (!Array.isArray(record.outputs)) {
    throw new Error("커널 응답에 outputs 가 없습니다.");
  }
  return {
    outputs: record.outputs.filter(isNotebookOutput),
    failed: record.failed === true,
  };
}

function isNotebookOutput(value: unknown): value is NotebookOutput {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "text" ||
    kind === "image" ||
    kind === "html" ||
    kind === "markdown" ||
    kind === "error"
  );
}

/**
 * Turns any thrown value into the error output a cell should display.
 * Kernel-level failures (worker died, assets missing) render in the same red
 * block as a Python traceback — one place for the user to look.
 */
export function toErrorOutput(ename: string, error: unknown): NotebookOutput {
  return {
    kind: "error",
    ename,
    evalue: error instanceof Error ? error.message : String(error),
    traceback: "",
  };
}
