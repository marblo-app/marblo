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

  // Track slow keystroke INP specifically — log if a key event takes >100ms to next paint.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { interactionId?: number; processingStart?: number; processingEnd?: number; target?: Element | null }>) {
        if (entry.duration <= 100) continue;
        if (entry.entryType !== 'event') continue;
        if (entry.name !== 'keydown' && entry.name !== 'keyup' && entry.name !== 'input') continue;
        const inputDelay = (entry.processingStart ?? 0) - entry.startTime;
        const processing = (entry.processingEnd ?? 0) - (entry.processingStart ?? 0);
        const presentationDelay = entry.duration - inputDelay - processing;
        const targetTag = entry.target?.tagName ?? '?';
        const targetClass = (entry.target as HTMLElement | null)?.className ?? '';
        console.warn(
          `[INP-SLOW] ${entry.name} ${entry.duration.toFixed(0)}ms = inputDelay ${inputDelay.toFixed(0)} + processing ${processing.toFixed(0)} + presentation ${presentationDelay.toFixed(0)} | target=<${targetTag} class="${targetClass.toString().slice(0, 60)}">`,
        );
      }
    }).observe({ type: 'event', durationThreshold: 100, buffered: true } as PerformanceObserverInit);
  } catch { /* not supported */ }

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
