import { useEffect, useState } from "react";
import { AuthProvider } from "./auth";
import { LanguageFirstRun } from "./components/onboarding/LanguageFirstRun";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./auth";
import { Layout } from "./components/Layout";
import { WorkspaceShell } from "./components/workspace/WorkspaceShell";
import { useWorkspaceModeStore } from "./stores/workspaceModeStore";
import { DetachedLayout, type DetachedView } from "./components/DetachedLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BrandLoader } from "./components/BrandLoader";
import { useProjectStore } from "./stores/projectStore";
import { useSubscriptionStore } from "./stores/subscriptionStore";
import {
  logTelemetry,
  setTelemetryEnabled,
  type TelemetryEvent,
} from "./services/telemetryService";
import telemetry from "./services/telemetryService";
import { t, hasChosenLocale } from "./lib/i18n";

// First-party telemetry is ON by default for de-identified operational metrics.
// VITE_DISABLE_TELEMETRY=1 is the hard kill-switch: it force-disables here too,
// overriding any runtime preference, and keeps Cloud Function calls
// (logTelemetryBatch/logHeartbeat) from ever firing.
if (import.meta.env.VITE_DISABLE_TELEMETRY === "1") {
  setTelemetryEnabled(false, { persist: false });
  console.warn(
    "[DIAG] Telemetry DISABLED — no logTelemetryBatch/logHeartbeat calls"
  );
}

// Performance monitor: log long tasks that block the main thread.
// `attribution` reveals what was running (script src, container element).
// `event` entryType (interactionId) helps identify INP spikes specifically.
if (typeof PerformanceObserver !== "undefined") {
  type AttributedEntry = PerformanceEntry & {
    attribution?: Array<{
      name?: string;
      containerType?: string;
      containerName?: string;
      containerId?: string;
      containerSrc?: string;
    }>;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as AttributedEntry[]) {
        if (entry.duration <= 50) continue;
        const a = entry.attribution?.[0];
        const attr = a
          ? `type=${a.containerType ?? "?"} name=${a.containerName ?? "?"} id=${
              a.containerId ?? "?"
            } src=${a.containerSrc ?? "?"}`
          : "no-attribution";
        console.warn(`[LONGTASK] ${entry.duration.toFixed(0)}ms — ${attr}`);
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* not supported */
  }

  // Track slow keystroke INP — AGGREGATED to avoid Heisenbug (per-event console.warn
  // with DevTools open is itself slow ~5-15ms, which inflates INP and creates a
  // feedback loop). Buffer entries and log a 5-second summary instead.
  type InpEntry = {
    duration: number;
    inputDelay: number;
    processing: number;
    presentation: number;
  };
  const inpBuffer: InpEntry[] = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & {
          interactionId?: number;
          processingStart?: number;
          processingEnd?: number;
          target?: Element | null;
        }
      >) {
        if (entry.duration <= 100) continue;
        if (entry.entryType !== "event") continue;
        if (
          entry.name !== "keydown" &&
          entry.name !== "keyup" &&
          entry.name !== "input"
        )
          continue;
        const inputDelay = (entry.processingStart ?? 0) - entry.startTime;
        const processing =
          (entry.processingEnd ?? 0) - (entry.processingStart ?? 0);
        const presentation = entry.duration - inputDelay - processing;
        inpBuffer.push({
          duration: entry.duration,
          inputDelay,
          processing,
          presentation,
        });
      }
    }).observe({
      type: "event",
      durationThreshold: 100,
      buffered: true,
    } as PerformanceObserverInit);
  } catch {
    /* not supported */
  }

  setInterval(() => {
    if (inpBuffer.length === 0) return;
    const samples = inpBuffer.splice(0, inpBuffer.length);
    const dur = samples.map((s) => s.duration).sort((a, b) => a - b);
    const inDel = samples.map((s) => s.inputDelay).sort((a, b) => a - b);
    const p50 = dur[Math.floor(dur.length / 2)];
    const p95 = dur[Math.floor(dur.length * 0.95)] ?? dur[dur.length - 1];
    const max = dur[dur.length - 1];
    const avgInDel = (inDel.reduce((a, b) => a + b, 0) / inDel.length).toFixed(
      0
    );
    console.warn(
      `[INP-5s] count=${samples.length} p50=${p50?.toFixed(
        0
      )}ms p95=${p95?.toFixed(0)}ms max=${max?.toFixed(
        0
      )}ms | avgInputDelay=${avgInDel}ms`
    );
  }, 5000);

  // Main-thread saturation sampler: schedule a 100ms timeout and measure actual drift.
  // If main thread is idle, drift is ~0ms. If busy, drift reflects accumulated busy work.
  // Logs drifts >30ms — 30+ in idle state means baseline noise we should hunt down.
  let lastSched = performance.now();
  const tick = () => {
    const now = performance.now();
    const drift = now - lastSched - 100;
    if (drift > 30) {
      console.warn(
        `[MAIN-BUSY] ${drift.toFixed(0)}ms drift (target 100ms, actual ${(
          now - lastSched
        ).toFixed(0)}ms)`
      );
    }
    lastSched = now;
    setTimeout(tick, 100);
  };
  setTimeout(tick, 100);

  // IPC channel frequency monitor — identifies channels flooding the renderer.
  // Each broadcasted IPC event is a task on the renderer's main thread; high-frequency
  // channels accumulate input delay even when individual handlers are fast.
  // Logs every 1s when total > 5 events/sec.
  if (window.electronAPI?.on) {
    const channels = [
      "fs:change",
      "cost:update",
      "agent:syncStatus",
      "agent:statusChanged",
      "agent:restartAttempt",
      "agent:restartFailed",
      "agent:spawned",
      "agent:deleted",
      "telemetry:event",
      "orchestrator:statusChanged",
      "flow:event",
      "system:wake",
      "terminal:new",
    ];
    const counts = new Map<string, number>(channels.map((c) => [c, 0]));
    let windowStart = performance.now();
    for (const ch of channels) {
      window.electronAPI.on(ch, () => {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      });
    }
    setInterval(() => {
      const now = performance.now();
      const elapsed = now - windowStart;
      windowStart = now;
      const parts: string[] = [];
      let total = 0;
      for (const [ch, n] of counts) {
        if (n > 0) {
          parts.push(`${ch}=${n}`);
          total += n;
        }
        counts.set(ch, 0);
      }
      if (total > 5) {
        console.warn(
          `[IPC-FREQ] ${(elapsed / 1000).toFixed(
            1
          )}s window | total=${total} | ${parts.join(" ")}`
        );
      }
    }, 1000);
  }
}

// Detached pop-out windows are opened with `?detached=board|code` (see main's
// createDetachedWindow). The query is fixed for a window's lifetime, so reading
// location.search on each render is cheap and stable.
function resolveDetachedView(): DetachedView | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("detached");
  return v === "board" || v === "code" || v === "history" ? v : null;
}

function AppContent() {
  const { user, loading } = useAuth();
  const subscribeToProjects = useProjectStore((s) => s.subscribeToProjects);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const setAutoSelectFirstProject = useProjectStore(
    (s) => s.setAutoSelectFirstProject
  );
  const subscribeToSubscription = useSubscriptionStore(
    (s) => s.subscribeToSubscription
  );
  const workspaceMode = useWorkspaceModeStore((s) => s.enabled);

  // DIAGNOSTIC TEST: Firebase realtime listeners suspected of causing typing
  // input delay (React reconciliation triggered by snapshot updates competing
  // with input handlers on main thread). Toggle via env var to compare.
  const FIREBASE_LISTENERS_ENABLED =
    import.meta.env.VITE_DISABLE_FB_LISTENERS !== "1";
  useEffect(() => {
    if (!user) return;
    // Optional-chained: if the preload bridge failed to attach, degrade
    // gracefully (treat as not-a-new-window) instead of throwing and
    // white-screening the app. Matches every other electronAPI access here.
    const isNewWindow = window.electronAPI?.window?.isNewWindow() ?? false;
    // Don't auto-grab project[0] for an explicitly-opened new window. Whether
    // the window shows the folder picker or reconnects to its previous project
    // (after a sleep/wake renderer reload) is decided by useSessionRestore —
    // which also owns clearing, so we must NOT clear here or we'd clobber a
    // pending reconnect.
    setAutoSelectFirstProject(!isNewWindow);

    if (!FIREBASE_LISTENERS_ENABLED) {
      console.warn(
        "[DIAG] Firebase listeners DISABLED via VITE_DISABLE_FB_LISTENERS=1 — projects/subscription will not sync"
      );
      return;
    }

    const unsubProjects = subscribeToProjects(user.uid);
    const unsubSubscription = subscribeToSubscription(user.uid);

    return () => {
      unsubProjects();
      unsubSubscription();
    };
  }, [
    user?.uid,
    subscribeToProjects,
    subscribeToSubscription,
    setAutoSelectFirstProject,
    FIREBASE_LISTENERS_ENABLED,
  ]);

  // Track session start/end
  useEffect(() => {
    if (!user) return;
    const sessionStart = Date.now();
    telemetry.sessionStarted();
    return () => {
      telemetry.sessionEnded(Date.now() - sessionStart);
      telemetry.flush();
    };
  }, [user?.uid]);

  // Bridge main process telemetry events to Firestore
  useEffect(() => {
    const api = (
      window as unknown as {
        electronAPI?: {
          telemetry?: {
            onEvent: (cb: (data: Record<string, unknown>) => void) => void;
            offEvent: () => void;
          };
        };
      }
    ).electronAPI;
    if (api?.telemetry) {
      // Remove any stale listeners first to prevent duplicates
      api.telemetry.offEvent();
      api.telemetry.onEvent((data) => {
        logTelemetry(data as { event: TelemetryEvent; [key: string]: unknown });
      });
      return () => {
        api.telemetry!.offEvent();
      };
    }
  }, []);

  if (loading) {
    return <BrandLoader label={t("common.loading")} />;
  }

  if (!user) {
    return <LoginPage />;
  }

  // Cold-start gate: the renderer can mount before the first projects snapshot
  // has settled, which would flash an empty board ("No Projects") until a manual
  // refresh. Hold a loading state until the projects store has hydrated. Skipped
  // when Firebase listeners are disabled (diagnostic) — otherwise we'd hang here
  // forever since nothing would ever flip projectsHydrated.
  if (FIREBASE_LISTENERS_ENABLED && !projectsHydrated) {
    return <BrandLoader label={t("common.loadingProjects")} />;
  }

  const detachedView = resolveDetachedView();
  if (detachedView) {
    return <DetachedLayout view={detachedView} />;
  }

  // Opt-in Workspace shell (default OFF). When OFF this is exactly <Layout />
  // as before — no behavioral change. Detached pop-out windows above always
  // use the legacy DetachedLayout regardless of this flag.
  if (workspaceMode) {
    return <WorkspaceShell />;
  }
  return <Layout />;
}

function App() {
  // First-run language picker: shown once, before anything else (even login),
  // when the user has never made an explicit choice. Detached pop-out windows
  // skip it — they inherit the main window's already-persisted locale.
  const [needsLocaleChoice, setNeedsLocaleChoice] = useState(
    () => resolveDetachedView() === null && !hasChosenLocale()
  );

  return (
    <ErrorBoundary>
      <AuthProvider>
        {needsLocaleChoice && (
          <LanguageFirstRun onComplete={() => setNeedsLocaleChoice(false)} />
        )}
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
