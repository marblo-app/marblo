import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useOrchestratorStore } from "../stores/orchestratorStore";
import {
  cleanupLegacyOrchestratorDocs,
  upsertOrchestratorAgentDoc,
} from "../services/orchestratorAgentDoc";

/**
 * - Stops the orchestrator when project/folder changes or unmounts.
 * - Auto-reconnects to the latest orchestrator session on mount
 *   (e.g., after page reload or session restore).
 */
export function useOrchestratorAutoLaunch() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);
  const clear = useOrchestratorStore((s) => s.clear);
  const prevKeyRef = useRef<string | null>(null);
  const autoConnectRef = useRef(false);

  // Teardown on project/folder change
  useEffect(() => {
    const projectId = currentProject?.id;
    const key = projectId && rootPath ? `${projectId}:${rootPath}` : null;

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
  }, [currentProject?.id, rootPath, clear]);

  // Auto-reconnect: separate effect so status changes don't trigger cleanup
  const setSession = useOrchestratorStore((s) => s.setSession);
  const setStatus = useOrchestratorStore((s) => s.setStatus);

  useEffect(() => {
    if (autoConnectRef.current || !currentProject?.id || !rootPath) return;
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
            rootPath,
          );
        const resumeId = priorId ?? "new";

        setStatus("starting");
        const result = await window.electronAPI.orchestratorSession.launch(
          projectId,
          rootPath,
          resumeId,
        );
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
  }, [currentProject?.id, rootPath, setSession, setStatus]);
}
