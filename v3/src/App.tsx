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
