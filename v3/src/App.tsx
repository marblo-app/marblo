import { useEffect } from 'react';
import { AuthProvider } from './auth';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './auth';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useProjectStore } from './stores/projectStore';
import { useSubscriptionStore } from './stores/subscriptionStore';
import { logTelemetry, type TelemetryEvent } from './services/telemetryService';
import telemetry from './services/telemetryService';

// Performance monitor: log long tasks that block the main thread.
// `attribution` reveals what was running (script src, container element).
// `event` entryType (interactionId) helps identify INP spikes specifically.
if (typeof PerformanceObserver !== 'undefined') {
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
          ? `type=${a.containerType ?? '?'} name=${a.containerName ?? '?'} id=${a.containerId ?? '?'} src=${a.containerSrc ?? '?'}`
          : 'no-attribution';
        console.warn(`[LONGTASK] ${entry.duration.toFixed(0)}ms — ${attr}`);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* not supported */ }

  // Track slow keystroke INP — AGGREGATED to avoid Heisenbug (per-event console.warn
  // with DevTools open is itself slow ~5-15ms, which inflates INP and creates a
  // feedback loop). Buffer entries and log a 5-second summary instead.
  type InpEntry = { duration: number; inputDelay: number; processing: number; presentation: number };
  const inpBuffer: InpEntry[] = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { interactionId?: number; processingStart?: number; processingEnd?: number; target?: Element | null }>) {
        if (entry.duration <= 100) continue;
        if (entry.entryType !== 'event') continue;
        if (entry.name !== 'keydown' && entry.name !== 'keyup' && entry.name !== 'input') continue;
        const inputDelay = (entry.processingStart ?? 0) - entry.startTime;
        const processing = (entry.processingEnd ?? 0) - (entry.processingStart ?? 0);
        const presentation = entry.duration - inputDelay - processing;
        inpBuffer.push({ duration: entry.duration, inputDelay, processing, presentation });
      }
    }).observe({ type: 'event', durationThreshold: 100, buffered: true } as PerformanceObserverInit);
  } catch { /* not supported */ }

  setInterval(() => {
    if (inpBuffer.length === 0) return;
    const samples = inpBuffer.splice(0, inpBuffer.length);
    const dur = samples.map((s) => s.duration).sort((a, b) => a - b);
    const inDel = samples.map((s) => s.inputDelay).sort((a, b) => a - b);
    const p50 = dur[Math.floor(dur.length / 2)];
    const p95 = dur[Math.floor(dur.length * 0.95)] ?? dur[dur.length - 1];
    const max = dur[dur.length - 1];
    const avgInDel = (inDel.reduce((a, b) => a + b, 0) / inDel.length).toFixed(0);
    console.warn(
      `[INP-5s] count=${samples.length} p50=${p50?.toFixed(0)}ms p95=${p95?.toFixed(0)}ms max=${max?.toFixed(0)}ms | avgInputDelay=${avgInDel}ms`,
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
      console.warn(`[MAIN-BUSY] ${drift.toFixed(0)}ms drift (target 100ms, actual ${(now - lastSched).toFixed(0)}ms)`);
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
      'fs:change',
      'cost:update',
      'agent:syncStatus',
      'agent:statusChanged',
      'agent:restartAttempt',
      'agent:restartFailed',
      'agent:spawned',
      'agent:deleted',
      'telemetry:event',
      'orchestrator:statusChanged',
      'flow:event',
      'system:wake',
      'terminal:new',
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
        console.warn(`[IPC-FREQ] ${(elapsed / 1000).toFixed(1)}s window | total=${total} | ${parts.join(' ')}`);
      }
    }, 1000);
  }
}

function AppContent() {
  const { user, loading } = useAuth();
  const subscribeToProjects = useProjectStore((s) => s.subscribeToProjects);
  const subscribeToSubscription = useSubscriptionStore((s) => s.subscribeToSubscription);

  // Initialize Firestore subscriptions after auth
  useEffect(() => {
    if (!user) return;

    const unsubProjects = subscribeToProjects(user.uid);
    const unsubSubscription = subscribeToSubscription(user.uid);

    return () => {
      unsubProjects();
      unsubSubscription();
    };
  }, [user?.uid, subscribeToProjects, subscribeToSubscription]);

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
    const api = (window as unknown as { electronAPI?: { telemetry?: { onEvent: (cb: (data: Record<string, unknown>) => void) => void; offEvent: () => void } } }).electronAPI;
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
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
          <p className="mt-3 text-sm text-gray-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <Layout />;
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
