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

export type KernelResponse =
  | { type: "status"; status: KernelStatus }
  | { type: "result"; id: number; outputs: NotebookOutput[]; failed: boolean }
  | { type: "error"; id: number; message: string };

/** The directory the vendored Pyodide runtime is served from. */
export const PYODIDE_BASE = "/pyodide/";

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
