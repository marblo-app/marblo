import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import {
  cleanupLegacyOrchestratorDocs,
  upsertOrchestratorAgentDoc,
} from "../services/orchestratorAgentDoc";

/**
 * - Stops the orchestrator when project/folder changes or unmounts.
 * - Auto-reconnects to the latest orchestrator session on mount
 *   (e.g., after page reload or session restore).
 *
 * The orchestrator lifecycle is bound to the project's FIXED root
 * (currentProject.folderPath), NOT to editorStore.rootPath (the path the
 * editor/file-tree is currently viewing). Merely opening a worktree for
 * inspection moves rootPath (WorktreeTab/TaskCard), and keying off it would
 * tear down and relaunch the running orchestrator in a different
 * claudeProjectDir — destroying its conversation context. Keying off
 * folderPath keeps the orchestrator stable across worktree browsing while
 * still tearing down on a genuine project switch.
 */
export function useOrchestratorAutoLaunch() {
  const currentProject = useProjectStore((s) => s.currentProject);
  // Project fixed root — see header comment. Falls back to null when the
  // project has no folder bound (orchestrator can't run without a root).
  const fixedRoot = currentProject?.folderPath ?? null;
  const clear = useOrchestratorStore((s) => s.clear);
  const prevKeyRef = useRef<string | null>(null);
  const autoConnectRef = useRef(false);

  // Teardown on project/folder change
  useEffect(() => {
    const projectId = currentProject?.id;
    const key = projectId && fixedRoot ? `${projectId}:${fixedRoot}` : null;

    if (prevKeyRef.current && prevKeyRef.current !== key) {
      window.electronAPI.orchestratorSession.stop().catch(() => {});
      clear();
      autoConnectRef.current = false;
    }
    prevKeyRef.current = key;

    return () => {
      window.electronAPI.orchestratorSession.stop().catch(() => {});
      clear();
    };
  }, [currentProject?.id, fixedRoot, clear]);

  // Auto-reconnect: separate effect so status changes don't trigger cleanup
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setStatus = useOrchestratorStore((s) => s.setStatus);

  useEffect(() => {
    if (autoConnectRef.current || !currentProject?.id || !fixedRoot) return;
    autoConnectRef.current = true;

    const projectId = currentProject.id;

    const tryAutoConnect = async () => {
      // One-time legacy cleanup: drop the per-launch orchestrator-<timestamp>
      // docs that accumulated before the stable-ID migration. Best-effort —
      // a failure here must not block auto-reconnect.
      cleanupLegacyOrchestratorDocs(projectId).catch(() => undefined);

      try {
        // Resolve the prior orchestrator session via label OR content
        // signature (works even when marblo-labels.json is missing, which is
        // the common case). Fall back to "new" only when there is genuinely
        // no prior orchestrator session.
        const priorId =
          await window.electronAPI.orchestratorSession.resolvePrevious(
            fixedRoot,
          );
        const resumeId = priorId ?? "new";

        setStatus("starting");
        const result = await window.electronAPI.orchestratorSession.launch(
          projectId,
          fixedRoot,
          resumeId,
        );
        // Blocked on CLI auth — surface the setup gate rather than auto-looping
        // a spawn that will keep hitting the login prompt.
        if (result?.needsAuth) {
          setStatus("stopped");
          window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
          return;
        }
        if (result) {
          setSession(result.sessionId, result.ptySessionId);
          setStatus("running");
          // Mirror the manual-Start path: upsert the canonical orchestrator
          // agent doc so the Activity feed's agentId filter accepts events
          // emitted by this auto-reconnected session.
          upsertOrchestratorAgentDoc(projectId, "working").catch(
            () => undefined,
          );
          console.debug(
            priorId
              ? `[Orchestrator] Auto-reconnected: ${priorId}`
              : `[Orchestrator] Auto-started fresh session (no prior session)`,
          );
        }
      } catch {
        // No previous session or launch failed — user starts manually
        setStatus("stopped");
      }
    };

    tryAutoConnect();
  }, [currentProject?.id, fixedRoot, setSession, setStatus]);
}
