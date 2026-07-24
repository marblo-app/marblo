import { useCallback, useEffect, useRef, useState } from "react";
import { NotebookKernel } from "../lib/notebookKernel/client";
import type { RunResult } from "../lib/notebookKernel/client";
import type { KernelStatus } from "../lib/notebookKernel/protocol";

export interface UseNotebookKernel {
  status: KernelStatus;
  /** id of the cell currently executing, or null. */
  runningCellId: string | null;
  runCell: (cellId: string, code: string) => Promise<RunResult>;
  restart: () => void;
}

/**
 * Owns one Pyodide kernel for the lifetime of the mounted notebook view.
 *
 * The kernel itself stays lazy — this hook only allocates the object, so no
 * wasm is fetched until the user actually presses Run. Cells are serialized:
 * a notebook kernel has one namespace, so two cells running at once would
 * interleave state unpredictably.
 */
export function useNotebookKernel(): UseNotebookKernel {
  const kernelRef = useRef<NotebookKernel | null>(null);
  if (!kernelRef.current) kernelRef.current = new NotebookKernel();
  const kernel = kernelRef.current;

  const [status, setStatus] = useState<KernelStatus>(kernel.status);
  const [runningCellId, setRunningCellId] = useState<string | null>(null);
  // Serializes runs without re-rendering on every queue change.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => kernel.onStatus(setStatus), [kernel]);

  useEffect(() => {
    return () => {
      kernel.dispose();
    };
  }, [kernel]);

  const runCell = useCallback(
    (cellId: string, code: string): Promise<RunResult> => {
      const next = queue.current.then(async () => {
        setRunningCellId(cellId);
        try {
          return await kernel.run(code);
        } finally {
          setRunningCellId(null);
        }
      });
      // Keep the chain alive even if one run rejects (it shouldn't — run()
      // swallows failures into an error output — but a broken chain would
      // silently wedge every later cell).
      queue.current = next.catch(() => undefined);
      return next;
    },
    [kernel],
  );

  const restart = useCallback(() => {
    kernel.restart();
    setRunningCellId(null);
    queue.current = Promise.resolve();
  }, [kernel]);

  return { status, runningCellId, runCell, restart };
}
