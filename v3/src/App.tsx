import { useEffect, useMemo, useState } from "react";
import { AuthProvider } from "./auth";
import { FirstRunFlow } from "./components/onboarding/FirstRunFlow";
import { isFirstRunFlowPending } from "./lib/firstRunFlow";
import { notifyInstallAttribution } from "./services/installAttribution";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./auth";
import { Layout } from "./components/Layout";
import { WorkspaceShell } from "./components/workspace/WorkspaceShell";
import { BeginnerShell } from "./components/beginner/BeginnerShell";
import { useWorkspaceModeStore } from "./stores/workspaceModeStore";
import { useBeginnerModeStore } from "./stores/beginnerModeStore";
import { useOnboardingPreviewStore } from "./stores/onboardingPreviewStore";
import { DetachedLayout, type DetachedView } from "./components/DetachedLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BrandLoader } from "./components/BrandLoader";
import { ProjectAuditPanel } from "./components/project/ProjectAuditPanel";
import { useProjectStore } from "./stores/projectStore";
import { useSubscriptionStore } from "./stores/subscriptionStore";
import { useAgentStore } from "./stores/agentStore";
import { useWorktreeStore } from "./stores/worktreeStore";
import { subscribeToMergeHistory } from "./services/mergeHistoryService";
import {
  pickMergeOutcomesToForward,
  pickMergedTaskCompletionCandidates,
  shouldMarkMergedTaskDone,
  enrichMergePayload,
} from "./services/mergeHistoryKgForwarder";
import {
  getTask,
  getTaskDispatchMeta,
  updateTaskStatus,
} from "./services/taskService";
import { getMemberRole } from "./services/teamService";
import { canMergeAsRole } from "./lib/teamRoles";
import { buildBusyTaskIds } from "./lib/archiveSignals";
import {
  logTelemetry,
  setTelemetryEnabled,
  stampFirstRunAt,
  type TelemetryEvent,
} from "./services/telemetryService";
import telemetry from "./services/telemetryService";
import { recordRoutingShadow } from "./services/routingShadowService";
import { t } from "./lib/i18n";
import type { User } from "./types/user";

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

const PERFORMANCE_DEBUG_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_PERFORMANCE_DEBUG === "1";

// Performance monitor: log long tasks that block the main thread.
// `attribution` reveals what was running (script src, container element).
// `event` entryType (interactionId) helps identify INP spikes specifically.
if (PERFORMANCE_DEBUG_ENABLED && typeof PerformanceObserver !== "undefined") {
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
  const projects = useProjectStore((s) => s.projects);
  const workspaceMode = useWorkspaceModeStore((s) => s.enabled);
  const beginnerMode = useBeginnerModeStore((s) => s.state) === "beginner";
  // 온보딩 프리뷰(설정 → 개발용 토글): 이미 설치·인증이 끝난 유저에게 fresh
  // 유저의 최초 연결단계를 다시 보여주는 시연 모드. 그 화면은 비기너 셸에만
  // 있으므로 여기서 셸을 갈아끼운다 — 비기너 기록(persist)은 건드리지 않는다.
  const onboardingPreview = useOnboardingPreviewStore((s) => s.enabled);

  // Stable membership key: the projects array is a fresh reference on every
  // snapshot, so we key the KG-forwarding effect on the sorted project ids to
  // re-subscribe only when membership actually changes (not on every re-render).
  const memberProjectIdsKey = useMemo(
    () =>
      projects
        .map((p) => p.id)
        .filter(Boolean)
        .sort()
        .join(","),
    [projects]
  );

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

  // KG v1 feedback loop (spec #559 §7): keep the machine-local routing graph
  // fed by EVERY merge. gh/GitHub merges land in merge_history server-side
  // (#566) but never touch the main-process app-merge path — so the renderer
  // (the authenticated project member allowed to read member-scoped
  // merge_history, cf #406/L2; main runs anonymous and can't) subscribes and
  // forwards each new merge to main, which folds it into routing-graph.json.
  useEffect(() => {
    if (!user) return;
    if (!FIREBASE_LISTENERS_ENABLED) return;
    const projectIds = memberProjectIdsKey
      ? memberProjectIdsKey.split(",")
      : [];
    if (projectIds.length === 0) return;
    const kg = window.electronAPI?.kg;
    // Per-session dedup; the graph's persistent `seen` guard handles the rest.
    const forwarded = new Set<string>();
    const completed = new Set<string>();
    const uid = user.uid;
    // 머지 role-gate: merged→DONE 화해(머지성 write)는 owner/admin 클라이언트만
    // 수행한다. member 클라이언트가 시도해도 Firestore 룰(REVIEW→DONE 게이트)이
    // 거부하지만, 여기서 걸러 불필요한 permission-denied 를 만들지 않는다.
    // 판정 실패는 fail-closed(member 취급) — admin 클라이언트가 대신 화해한다.
    const mergeRoleCache = new Map<string, Promise<boolean>>();
    const canMergeInProject = (projectId: string): Promise<boolean> => {
      let cached = mergeRoleCache.get(projectId);
      if (!cached) {
        cached = getMemberRole(projectId, uid)
          .then(canMergeAsRole)
          .catch(() => false);
        mergeRoleCache.set(projectId, cached);
      }
      return cached;
    };
    const unsub = subscribeToMergeHistory(
      (entries) => {
        if (kg) {
          for (const base of pickMergeOutcomesToForward(entries, forwarded)) {
            // Enrich with the task's dispatchMeta (role/taskType/complexity/
            // model) BEFORE forwarding: the anonymous main process can't read
            // member-scoped `tasks` (#406/L2), so without this the merge folds
            // seen-only and the cell never learns. Async + best-effort — on any
            // failure we still forward the base payload (taskType←changeType).
            void (async () => {
              let payload = base;
              try {
                const meta = await getTaskDispatchMeta(base.taskId);
                payload = enrichMergePayload(base, meta);
              } catch {
                // fall through with base — main still learns taskType/changeType
              }
              try {
                kg.recordMergeOutcome(payload);
              } catch {
                // best-effort: a bridge/IPC failure must never break the app
              }
            })();
          }
        }
        for (const candidate of pickMergedTaskCompletionCandidates(
          entries,
          completed
        )) {
          void (async () => {
            try {
              const task = await getTask(candidate.taskId);
              if (
                !shouldMarkMergedTaskDone(task, {
                  worktrees: useWorktreeStore.getState().worktrees,
                  busyTaskIds: buildBusyTaskIds(
                    useAgentStore.getState().agents
                  ),
                })
              ) {
                return;
              }
              if (!task || !(await canMergeInProject(task.projectId))) {
                return;
              }
              await updateTaskStatus(candidate.taskId, "DONE");
            } catch {
              // best-effort: merge_history reconciliation must not break the app
            }
          })();
        }
      },
      { projectIds, maxResults: 200 }
    );
    return () => unsub();
  }, [user?.uid, memberProjectIdsKey, FIREBASE_LISTENERS_ENABLED]);

  // ★무료→유료 전환을 무료 여정 상관키(익명 clientId)에 귀속(티켓 pWSnJeQN).
  //
  // 결제는 웹(포트원)에서 일어나 앱을 거치지 않으므로 앱이 결제 이벤트를 볼 방법은
  // 없다. 대신 이 설치의 계정이 유료 플랜이 된 **사실**을 구독 스토어에서 관측해
  // 설치 축 여정(app:first_run → … )에 결제를 잇는다. 판정은 lib/entitlement 의
  // 단일 규칙(getPlan)에 위임한다 — status 단독으로 보면 해지 즉시 free 로 떨어져
  // 잔여 기간이 소멸하는 그 버그를 여기서 되풀이하지 않는다.
  //
  // 설치당 1회 발신이라 스토어가 여러 번 스냅샷을 줘도 한 건만 나간다.
  const entitledPlan = useSubscriptionStore((s) => s.getPlan());
  useEffect(() => {
    if (!user) return;
    if (!entitledPlan || entitledPlan === "free") return;
    telemetry.subscriptionActiveObserved(entitledPlan);
  }, [user?.uid, entitledPlan]);

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
        // ★"첫 대화" 만 예외 경로다. 어느 PTY 가 오케인지는 메인만 알고(감지=메인),
        // 설치당 1회 마커는 localStorage 라 렌더러에만 있다(접기=여기). 그래서
        // 메인은 제출될 때마다 보내고, 첫 건만 실제로 발신된다.
        if (data.event === "onboarding:first_conversation") {
          telemetry.firstConversationObserved(
            data.metadata as Record<string, unknown> | undefined
          );
          return;
        }
        // ★멀티에이전트 계측도 같은 분업이다(티켓 pWSnJeQN): 동시성은 메인만
        // 알고(감지=메인 AgentManager), 설치당 1회 마커와 first_run 시계는
        // localStorage 라 렌더러에만 있다(접기·시간계산=여기).
        // ★10분 시계의 앵커(티켓 Tw6m14gR). 스폰 게이트 통과는 메인만 아는
        // 사실이고(판정이 거기 있다), 설치당 1회 마커는 렌더러에만 있다 —
        // 메인이 통과할 때마다 보내고 여기서 첫 건만 실제로 발신된다.
        if (data.event === "onboarding:model_connected") {
          telemetry.modelConnectedObserved(
            "spawn_gate",
            data.metadata as Record<string, unknown> | undefined
          );
          return;
        }
        // ★라우팅 shadow(티켓 6LH4Y1GC7xeWA94pW3Ar). 이 이름은 **BigQuery 로
        // 가는 이벤트가 아니다** — 메인이 "클라우드에 물어봐 달라" 고 넘긴
        // 요청이다. 서비스가 왕복을 마친 뒤 비교 결과를 `routing:shadow` 라는
        // 다른 이름으로 정식 텔레메트리 경로에 올린다.
        // ★행동 변경 0: 스폰은 이미 로컬 결정대로 끝났고, 여기서 무슨 일이
        // 일어나든(실패 포함) 되돌아가지 않는다.
        if (data.event === "routing:shadow_request") {
          void recordRoutingShadow(data.shadow);
          return;
        }
        if (data.event === "onboarding:multi_agent_active") {
          telemetry.multiAgentActiveObserved(
            data.metadata as Record<string, unknown> | undefined
          );
          return;
        }
        if (data.event === "onboarding:multi_agent_success") {
          telemetry.multiAgentSuccessObserved(
            data.metadata as Record<string, unknown> | undefined,
            {
              taskId: typeof data.taskId === "string" ? data.taskId : undefined,
              projectId:
                typeof data.projectId === "string" ? data.projectId : undefined,
            }
          );
          return;
        }
        logTelemetry(data as { event: TelemetryEvent; [key: string]: unknown });
      });
      return () => {
        api.telemetry!.offEvent();
      };
    }
  }, []);

  const auditHarness = testProjectAuditHarness();
  if (auditHarness) {
    return (
      <div className="h-screen overflow-auto bg-gray-900 p-4 text-gray-100">
        <div className="mx-auto max-w-4xl">
          <ProjectAuditPanel
            projectId={auditHarness.projectId}
            members={auditHarness.members}
          />
        </div>
      </div>
    );
  }

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

  // 비기너 모드 — 깨끗한 신규 설치만 여기로 온다(lib/beginnerMode 의 보수적
  // 판정: 이전 사용 마커가 하나라도 있으면 advanced). 워크스페이스 셸 **위에**
  // 얹히는 한 층이라, 승격하면 아래 분기를 그대로 통과해 기존 셸이 뜬다.
  // detached 팝아웃은 위에서 먼저 걸린다 — 보조 창은 비기너 셸을 그릴 이유가 없다.
  // 프리뷰는 어드밴스드 유저를 **일시적으로** 이 셸에 세운다(끄면 곧장 원위치).
  // detached 팝아웃은 위에서 이미 걸러졌다 — 보조 창까지 시연 화면이 되면
  // 원래 보려던 터미널/diff 가 사라진다.
  if (beginnerMode || onboardingPreview) {
    return <BeginnerShell />;
  }

  // Workspace shell — 프로덕션에선 **항상** 이쪽이다(설정 토글 제거,
  // stores/workspaceModeStore 참고). 아래 <Layout /> 은 죽은 코드가 아니라
  // 테스트 하네스(MARBLO_TEST_BYPASS_AUTH + localStorage "0")에서만 도달하는
  // 레거시 경로다 — cleanroom first-run 의 두 시나리오와 Layout 전용 온보딩
  // 표면(CliSetupGate·TabBar)이 아직 여기 걸려 있어 함께 남겨 둔다.
  // detached 팝아웃 창은 이 플래그와 무관하게 위에서 DetachedLayout 으로 빠진다.
  if (workspaceMode) {
    return <WorkspaceShell />;
  }
  return <Layout />;
}

function testProjectAuditHarness(): {
  projectId: string;
  members: User[];
} | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  try {
    const raw = localStorage.getItem("marblo:test:projectAuditHarness");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      projectId?: unknown;
      members?: unknown;
    };
    if (
      typeof parsed.projectId !== "string" ||
      !Array.isArray(parsed.members)
    ) {
      return null;
    }
    return { projectId: parsed.projectId, members: parsed.members as User[] };
  } catch {
    return null;
  }
}

// One-shot marker: has this install ever emitted app:first_run? Persisted so
// the event fires exactly once for the life of the install (a proxy for
// "download → first launch"), not on every cold start. Clearing storage mints
// a new clientId anyway, so re-firing then is the correct behavior.
const FIRST_RUN_KEY = "marblo.telemetry.firstRunSent";

function markFirstRunIfNeeded() {
  // Detached pop-out windows are not a first launch — they piggyback the main
  // window's session. Never count them.
  if (resolveDetachedView() !== null) return;
  try {
    if (localStorage.getItem(FIRST_RUN_KEY) === "true") return;
    localStorage.setItem(FIRST_RUN_KEY, "true");
  } catch {
    // Storage unavailable — skip rather than risk emitting on every boot.
    return;
  }
  // ★"10분 안에 첫 multi-agent 성공" 의 시계 시작점(티켓 pWSnJeQN). 서버
  // timestamp 는 수신시각이고 로그인-이전 이벤트는 나중에 한꺼번에 flush 되므로
  // 서버에서는 이 지연을 계산할 수 없다 — 로컬에 epoch-ms 를 찍어 둔다.
  stampFirstRunAt();
  // Queued now; flushes on the next successful login (flush is auth-gated).
  // Reconciles at magnitude against GA4 download clicks — see churn analysis §5-1.
  const platform =
    (typeof navigator !== "undefined" && navigator.platform) || "unknown";
  telemetry.appFirstRun(platform);
}

function App() {
  // First-run flow (language → privacy consent): shown once, before anything
  // else (even login), as one continuous sequence. Both steps are mandatory
  // gates; running them back-to-back here is what closes F5 — consent used to
  // be derived from a post-login Firestore read and landed ~5s later, on top
  // of a screen the user was already using. Detached pop-out windows skip it —
  // they inherit the main window's already-persisted locale and consent.
  const [firstRunPending, setFirstRunPending] = useState(
    () => resolveDetachedView() === null && isFirstRunFlowPending()
  );

  // Fire the install's first-launch marker once, at the very first app mount
  // (before login). See markFirstRunIfNeeded for the auth-gated flush caveat.
  useEffect(() => {
    markFirstRunIfNeeded();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        {firstRunPending && (
          // `relative z-[100]` creates a stacking context above the app shell.
          // The consent step carries z-50 internally (it used to be rendered
          // from inside Layout); without this wrapper it would tie with
          // AppContent's own z-50 elements and lose on DOM order, since the
          // flow is painted before AppContent.
          <div className="relative z-[100]">
            <FirstRunFlow
              onComplete={() => {
                setFirstRunPending(false);
                // ★익명 어트리뷰션 링크백(티켓 rPVkmOKG). 동의 화면을 통과한
                // 직후에만, 설치당 1회, 기본 브라우저로 환영 페이지를 연다 —
                // 그 페이지가 자기 GA4 쿠키를 읽어 "이 유입 → 이 설치" 를 uid
                // 없이 잇는다. 옵트아웃 상태면 열리지 않는다.
                notifyInstallAttribution();
              }}
            />
          </div>
        )}
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
