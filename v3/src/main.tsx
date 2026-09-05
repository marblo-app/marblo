import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initTheme } from "./lib/theme";
import { useAgentStore } from "./stores/agentStore";
import { useProjectStore } from "./stores/projectStore";
import { useOrchestratorStore } from "./stores/orchestratorStore";
import { useTaskStore } from "./stores/taskStore";
import { usePaneStore } from "./stores/paneStore";
import { useSplitWorkspaceStore } from "./stores/splitWorkspaceStore";
import { useEditorStore } from "./stores/editorStore";
import { useBeginnerModeStore } from "./stores/beginnerModeStore";

// Test hatch — Playwright e2e fixture 가 zustand store 를 직접 manipulate 할
// 수 있도록 window.__marbloTest 에 노출. main process 가
// MARBLO_TEST_BYPASS_AUTH=1 로 launch 됐을 때만 활성화 (production 미노출).
//
// Tier 2 mock fixture 가 이 hatch 를 통해 OrchestratorPanel 을 dummy PTY 와
// 함께 자동 mount — 진짜 LLM (claude) spawn 없이 PTY 흐름 + xterm 회귀 시나리오
// 검증 가능.
if (window.electronAPI?.testMode?.bypassAuth) {
  (window as unknown as { __marbloTest?: unknown }).__marbloTest = {
    stores: {
      agent: useAgentStore,
      project: useProjectStore,
      orchestrator: useOrchestratorStore,
      task: useTaskStore,
      pane: usePaneStore,
      splitWorkspace: useSplitWorkspaceStore,
      editor: useEditorStore,
      beginnerMode: useBeginnerModeStore,
    },
  };
  console.debug("[TestHatch] window.__marbloTest exposed (bypassAuth mode)");
}

// Prevent Vite HMR from full-page reloading after sleep/wake
// When Mac sleeps, Vite WS disconnects. On wake, Vite reconnects and
// triggers a full reload if it detects stale modules — this kills all
// Zustand state (rootPath, agents, orchestrator). Suppress it.
if (import.meta.hot) {
  let wasDisconnected = false;
  import.meta.hot.on("vite:ws:disconnect", () => {
    wasDisconnected = true;
    console.debug("[HMR] WebSocket disconnected (likely sleep)");
  });
  import.meta.hot.on("vite:ws:connect", () => {
    if (wasDisconnected) {
      console.debug(
        "[HMR] WebSocket reconnected after disconnect — state preserved",
      );
      wasDisconnected = false;
    }
  });
}

// Stamp <html data-theme> before first paint so there is no flash of the
// wrong theme, and start following the OS for users on "auto". Resolves to
// "dark" for everyone today (DEFAULT_THEME_CHOICE) — this is the mechanism
// landing ahead of the token migration, not a behavior change.
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
