import { useCallback, useRef, useState } from "react";
import { useTranslation } from "../lib/i18n";
import { useProjectStore } from "../stores/projectStore";
import { useAuth } from "./useAuth";
import {
  routeInstructionToOrchestrator,
  type RouteResult,
} from "../services/orchestratorInstructionService";
import { formatDiffComment, type DiffCommentRange } from "../lib/diffComment";

/**
 * Single send path for "comment on this code → orchestrator", shared by both
 * diff surfaces (see `lib/diffComment` for why there are two).
 *
 * No new IPC: this wraps `routeInstructionToOrchestrator`, the local-PTY-first
 * / Firestore-queue-fallback routing DiffSurface already used.
 *
 * `send` is referentially stable so imperative callers (DiffSurface registers
 * its Monaco handlers once) can hold it without re-registering; the routing
 * context is read through a ref that is refreshed on every render.
 */
export function useOrchestratorDiffComment() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const { user } = useAuth();
  const [toast, setToast] = useState<string | null>(null);

  const ctxRef = useRef({
    projectId: currentProject?.id ?? "",
    userId: user?.uid as string | undefined,
    userName: user?.displayName ?? "User",
  });
  ctxRef.current = {
    projectId: currentProject?.id ?? "",
    userId: user?.uid,
    userName: user?.displayName ?? "User",
  };

  const tRef = useRef(t);
  tRef.current = t;

  const send = useCallback(
    async (range: DiffCommentRange, comment: string): Promise<RouteResult> => {
      const body = comment.trim();
      if (!body) return "failed";

      const { projectId, userId, userName } = ctxRef.current;
      let result: RouteResult = "failed";
      if (projectId) {
        result = await routeInstructionToOrchestrator({
          projectId,
          message: formatDiffComment(range, body),
          fromUserId: userId,
          fromUserName: userName,
        });
      }

      const toastKey =
        result === "local"
          ? "diff.comment.sentLocal"
          : result === "queued"
            ? "diff.comment.sentQueued"
            : "diff.comment.sentFailed";
      setToast(tRef.current(toastKey));
      window.setTimeout(() => setToast(null), 3500);
      return result;
    },
    [],
  );

  return { send, toast };
}
