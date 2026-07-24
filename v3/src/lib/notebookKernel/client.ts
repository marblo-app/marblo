// Renderer-side handle on the notebook kernel worker.
//
// The worker is created on the FIRST run, not on mount — opening a .ipynb must
// stay as cheap as opening a .md, and most notebook viewing never runs
// anything. Terminating the worker is also our "interrupt": a runaway cell has
// no other exit, since a real SIGINT needs cross-origin isolation.

import type { NotebookOutput } from "../notebook";
import type { KernelRequest, KernelResponse, KernelStatus } from "./protocol";
import { toErrorOutput } from "./protocol";

export interface RunResult {
  outputs: NotebookOutput[];
  failed: boolean;
}

type StatusListener = (status: KernelStatus) => void;

// A plain Omit over a union collapses to the keys they share, which would drop
// `code` from the run request. Distribute so each member keeps its own fields.
type RequestPayload = KernelRequest extends infer M
  ? M extends KernelRequest
    ? Omit<M, "id">
    : never
  : never;

export class NotebookKernel {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: RunResult) => void; reject: (e: Error) => void }
  >();
  private listeners = new Set<StatusListener>();
  private lastStatus: KernelStatus = { phase: "idle" };

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.lastStatus);
    return () => this.listeners.delete(listener);
  }

  get status(): KernelStatus {
    return this.lastStatus;
  }

  private emit(status: KernelStatus) {
    this.lastStatus = status;
    for (const listener of this.listeners) listener(status);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./kernel.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      const message = event.data;
      if (message.type === "status") {
        this.emit(message.status);
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.type === "result") {
        entry.resolve({ outputs: message.outputs, failed: message.failed });
      } else {
        entry.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      // A worker-level error (bad import, OOM) never resolves the in-flight
      // request on its own — fail every waiter rather than hang the UI.
      const error = new Error(event.message || "커널 워커가 종료되었습니다.");
      this.failAll(error);
      this.emit({ phase: "failed", detail: error.message });
    };
    this.worker = worker;
    return worker;
  }

  private failAll(error: Error) {
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
  }

  private request(message: RequestPayload): Promise<RunResult> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<RunResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id } as KernelRequest);
    });
  }

  /**
   * Runs one cell. Never rejects — a kernel failure comes back as an error
   * output so the cell shows it where the traceback would be.
   */
  async run(code: string): Promise<RunResult> {
    try {
      return await this.request({ type: "run", code });
    } catch (e) {
      return { outputs: [toErrorOutput("KernelError", e)], failed: true };
    }
  }

  /** Clears the shared namespace without paying for a fresh wasm boot. */
  async reset(): Promise<void> {
    try {
      await this.request({ type: "reset" });
    } catch {
      // A kernel that can't reset is already dead; restart() is the way out.
    }
  }

  /** Hard stop — the only way to escape an infinite loop in a cell. */
  restart() {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error("커널을 재시작했습니다."));
    this.emit({ phase: "idle" });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error("커널이 종료되었습니다."));
    this.listeners.clear();
  }
}
