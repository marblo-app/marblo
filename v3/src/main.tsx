import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useAgentStore } from "./stores/agentStore";
import { useProjectStore } from "./stores/projectStore";

// Test hatch — Playwright e2e fixture 가 zustand store 를 직접 manipulate 할
// 수 있도록 window.__marbloTest 에 노출. main process 가
// MARBLO_TEST_BYPASS_AUTH=1 로 launch 됐을 때만 활성화 (production 미노출).
if (window.electronAPI?.testMode?.bypassAuth) {
  (window as unknown as { __marbloTest?: unknown }).__marbloTest = {
    stores: {
      agent: useAgentStore,
      project: useProjectStore,
    },
  };
  console.log("[TestHatch] window.__marbloTest exposed (bypassAuth mode)");
}

// Prevent Vite HMR from full-page reloading after sleep/wake
// When Mac sleeps, Vite WS disconnects. On wake, Vite reconnects and
// triggers a full reload if it detects stale modules — this kills all
// Zustand state (rootPath, agents, orchestrator). Suppress it.
if (import.meta.hot) {
  let wasDisconnected = false;
  import.meta.hot.on("vite:ws:disconnect", () => {
    wasDisconnected = true;
    console.log("[HMR] WebSocket disconnected (likely sleep)");
  });
  import.meta.hot.on("vite:ws:connect", () => {
    if (wasDisconnected) {
      console.log(
        "[HMR] WebSocket reconnected after disconnect — state preserved",
      );
      wasDisconnected = false;
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
