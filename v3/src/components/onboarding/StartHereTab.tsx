import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  GitBranch,
  PlayCircle,
  Terminal,
  UserCheck,
} from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  WIZARD_STEPS,
  authSatisfied,
  installSatisfied,
  type WizardStep,
} from "../../lib/cliSetupGate";
import {
  isOnboardingComplete,
  resumeStep,
  stepViews,
  type StepStatus,
} from "../../lib/onboardingProgress";
import { ROWS, useCliSetupStore } from "../../stores/cliSetupStore";
import { useOnboardingProgressStore } from "../../stores/onboardingProgressStore";
import { useProjectStore } from "../../stores/projectStore";
import { useStepPrdSuccess } from "../../hooks/useCliSetupEngine";
import { useByomOptions } from "../../hooks/useByomOptions";
import telemetry from "../../services/telemetryService";
import {
  connectFolder,
  createFirstTicket,
  seedSamplePrd,
  type ActionResult,
  type FirstTicketResult,
} from "../../services/cliSetupActions";
import {
  CliRowCard,
  InstallAllPanel,
  OneClickSignInPanel,
} from "./CliSetupRows";
import { ByomStartSection } from "./ByomStartSection";
import { FirstTicketResultNote } from "./FirstTicketResultNote";
import { VendorModelsSection } from "./VendorModelsSection";
import {
  ORCHESTRATION_DEMO_DISPLAY_SECONDS,
  ORCHESTRATION_DEMO_PLAYBACK_RATE,
  ORCHESTRATION_DEMO_POSTER_SRC,
  ORCHESTRATION_DEMO_VIDEO_SRC,
  VideoDemoModal,
} from "./VideoDemoModal";

/**
 * "시작하기" — onboarding as a first-class TAB (ticket ZdgQMxW7).
 *
 * The activation wizard used to be a modal. Dismiss it and everything was
 * gone: no way back to the remaining steps, no record of how far you got, and
 * the aha-moment (first ticket) was never reached. That is the single biggest
 * activation leak, so onboarding now lives in the leading right-pane tab.
 *
 * ★ Nothing is reimplemented. The probe / auto-install / version engine
 * (cliSetupStore + useCliSetupEngine), the step actions (cliSetupActions:
 * sign-in, folder connect, PRD seed, first-ticket routing), the per-CLI row UI
 * (CliSetupRows) and the pure step rules (lib/cliSetupGate: WIZARD_STEPS,
 * canAdvanceWizard) are the exact same modules the legacy modal uses — this
 * file only re-lays them out as a resumable checklist.
 *
 * ── 유실 없는 진행 ───────────────────────────────────────────────────────────
 *  - Progress is persisted (lib/onboardingProgress + onboardingProgressStore)
 *    and merged with LIVE probe truth, so a step satisfied outside the app
 *    (installed by hand, already signed in) is never asked for again.
 *  - Re-entry resumes at the step you were on, not at step ①.
 *  - Skipping is allowed but never hides anything: a skipped step keeps its
 *    place in the list, flagged "건너뜀", and stays reachable forever.
 *  - Every step carries a one-line WHY and a "막혔을 때" fallback (npm install
 *    failed → official docs; sign-in → only ONE of Claude/Codex is needed).
 *  - The last step drives all the way to the first ticket — the value moment.
 */

const STEP_ICON: Record<WizardStep, string> = {
  install: "⬇",
  auth: "🔑",
  prd: "📄",
  firstTicket: "🎫",
};

const QUICK_GUIDE_STEPS = ["install", "terminal", "auth", "spawn"] as const;

const QUICK_GUIDE_ICON = {
  install: CheckCircle2,
  terminal: Terminal,
  auth: UserCheck,
  spawn: PlayCircle,
} satisfies Record<(typeof QUICK_GUIDE_STEPS)[number], typeof CheckCircle2>;

export function StartHereTab() {
  const { t } = useTranslation();

  const progress = useOnboardingProgressStore((s) => s.progress);
  const markDone = useOnboardingProgressStore((s) => s.markDone);
  const markSkipped = useOnboardingProgressStore((s) => s.markSkipped);
  const setCurrent = useOnboardingProgressStore((s) => s.setCurrent);
  const setDismissed = useOnboardingProgressStore((s) => s.setDismissed);

  const ready = useCliSetupStore((s) => s.ready);
  const states = useCliSetupStore((s) => s.states);
  const probeAll = useCliSetupStore((s) => s.probeAll);
  const refreshVersions = useCliSetupStore((s) => s.refreshVersions);
  const requiredInstalled = useCliSetupStore((s) => s.requiredInstalled());
  const hasProject = useProjectStore((s) => !!s.currentProject?.folderPath);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<ActionResult | null>(null);
  const [sendingTicket, setSendingTicket] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<FirstTicketResult | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  // BYOM 축(F4) — 벤더 키/CLI 만으로 ①②단계를 만족했는가. Claude/Codex 계정이
  // 하나도 없는 사용자는 이 축이 없으면 ②단계에서 영구히 멈춘다.
  const { gate: byom } = useByomOptions();

  const live = useMemo(
    () => ({
      requiredInstalled,
      requiredReady: ready,
      hasProject,
      byomInstalled: byom.installed,
      byomReady: byom.ready,
    }),
    [requiredInstalled, ready, hasProject, byom.installed, byom.ready],
  );

  const views = useMemo(() => stepViews(progress, live), [progress, live]);
  const resume = useMemo(() => resumeStep(progress, live), [progress, live]);
  const complete = useMemo(
    () => isOnboardingComplete(progress, live),
    [progress, live],
  );

  // Which step's body is expanded. Starts at the resume point; the user can
  // open any step (including finished ones) without losing their place.
  const [openStep, setOpenStep] = useState<WizardStep>(resume);
  // Follow the resume point while the user hasn't manually picked a step this
  // session — e.g. sign-in completing in a terminal should move them along.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!pinned) setOpenStep(resume);
  }, [resume, pinned]);

  // Persist live-derived completions so the cold-start landing rule (which can
  // only read storage, before any probe has run) knows onboarding is finished.
  useEffect(() => {
    // ★BYOM 축을 포함한 판정으로 기록한다(effectiveDone 과 같은 식). 벤더 경로로
    // 넘긴 단계가 저장되지 않으면 콜드 시작 착지 규칙이 매번 "미완료" 로 읽는다.
    if (installSatisfied(live)) markDone("install");
    if (authSatisfied(live)) markDone("auth");
    if (live.hasProject) markDone("prd");
  }, [live, markDone]);

  useStepPrdSuccess(openStep === "prd", hasProject);

  const selectStep = useCallback(
    (step: WizardStep) => {
      setPinned(true);
      setOpenStep(step);
      setCurrent(step);
      telemetry.cliSetupStep(step, "enter");
    },
    [setCurrent],
  );

  const skipStep = useCallback(
    (step: WizardStep) => {
      markSkipped(step);
      // Skipping install/auth is the same "couldn't connect the CLI" drop-off
      // the modal's dismiss reported — same cli_auth vocabulary so both funnels
      // join orchestratorBlocked on one axis. Later steps have no such reason.
      if (step === "install" || step === "auth") {
        telemetry.cliSetupStep(step, "fail", "cli_auth");
      }
      const idx = WIZARD_STEPS.indexOf(step);
      const next = WIZARD_STEPS[idx + 1];
      if (next) selectStep(next);
    },
    [markSkipped, selectStep],
  );

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setSeedMsg(null);
    try {
      setSeedMsg(await seedSamplePrd());
    } finally {
      setSeeding(false);
    }
  }, []);

  const handleFirstTicket = useCallback(async () => {
    setSendingTicket(true);
    setTicketMsg(null);
    try {
      const res = await createFirstTicket();
      setTicketMsg(res);
      // ★res.ok 는 "오케가 실제로 받았다"(delivery === "delivered") 일 때만 참이다.
      // queued(오케 미기동, 큐에만 적재)를 완료로 찍으면 온보딩이 끝난 것처럼 보여
      // 유저가 아무 일도 안 일어난 화면에 갇힌다 — 단계를 남겨 두고 안내한다.
      if (res.ok) markDone("firstTicket");
    } finally {
      setSendingTicket(false);
    }
  }, [markDone]);

  const openDemo = useCallback(() => setShowDemo(true), []);
  const closeDemo = useCallback(() => {
    // The demo's CTA sets a "connect after login" flag meant for the pre-auth
    // login screen. We're already past login and the user is standing in the
    // setup tab, so clear it rather than leave a stale prompt for next launch.
    try {
      localStorage.removeItem("marblo.demo.connectPending");
    } catch {
      /* private mode — nothing to clear */
    }
    setShowDemo(false);
  }, []);

  const doneCount = views.filter((v) => v.status === "done").length;
  const anyChecking = ROWS.some((r) => states[r.id]?.checking);

  return (
    // WorkTabs already gives each tab an `overflow-auto` box — only grow here.
    <div className="min-h-full bg-gray-900 px-6 py-6 text-[#cdd6f4]">
      <div className="mx-auto max-w-5xl">
        {/* ── Header: what this is, how far along, and the always-on demo ── */}
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-[#cdd6f4]">
            {t("onboarding.startHere.title")}
          </h1>
          <p className="mt-1 text-sm text-[#a6adc8]">
            {t("onboarding.startHere.subtitle")}
          </p>

          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#313244]">
              <div
                className="h-full rounded-full bg-[#a6e3a1] transition-all duration-500"
                style={{
                  width: `${(doneCount / WIZARD_STEPS.length) * 100}%`,
                }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium text-[#a6adc8]">
              {t("onboarding.startHere.progress", {
                done: doneCount,
                total: WIZARD_STEPS.length,
              })}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#7f849c]">
              {t("onboarding.startHere.demoLead")}
            </span>
            <button
              type="button"
              data-testid="start-here-header-demo-cta"
              onClick={openDemo}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#89b4fa]/55 bg-[#89b4fa]/15 px-3 py-1.5 text-xs font-semibold text-[#cdd6f4] shadow-sm shadow-[#89b4fa]/10 transition-colors hover:bg-[#89b4fa]/25"
            >
              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {t("onboarding.startHere.watchDemo", {
                seconds: ORCHESTRATION_DEMO_DISPLAY_SECONDS,
              })}
            </button>
            <button
              type="button"
              onClick={() => {
                void probeAll();
                refreshVersions();
              }}
              disabled={anyChecking}
              className="rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
            >
              {anyChecking
                ? t("onboarding.cliGate.checking")
                : t("onboarding.cliGate.recheck")}
            </button>
          </div>
        </div>

        <ValuePreview onWatchDemo={openDemo} />

        {/* 권장: 깃 리포 연결 → 티켓별 독립 워크트리 (YTpcEK5Ow5LIldkJJzQc).
            BeginnerShell 은 건드리지 않는다 — 시작하기 탭 본문만. */}
        <WorktreeRecommendNote />

        {complete && (
          <div className="mb-4 rounded-lg border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#a6e3a1]">
                  🎉 {t("onboarding.startHere.allDone.title")}
                </p>
                <p className="mt-1 text-xs text-[#a6adc8]">
                  {t("onboarding.startHere.allDone.body")}
                </p>
              </div>
              <button
                type="button"
                data-testid="start-here-complete-watch-demo"
                onClick={openDemo}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#89b4fa]/50 bg-[#89b4fa]/15 px-3 py-2 text-xs font-semibold text-[#cdd6f4] transition-colors hover:bg-[#89b4fa]/25"
              >
                <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t("onboarding.startHere.watchDemo", {
                  seconds: ORCHESTRATION_DEMO_DISPLAY_SECONDS,
                })}
              </button>
            </div>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── The checklist. Nothing here ever disappears. ─────────────── */}
          <div className="space-y-2.5">
            {views.map((view, i) => {
              const isOpen = view.id === openStep;
              return (
                <section
                  key={view.id}
                  data-testid={`start-here-step-${view.id}`}
                  className={`rounded-lg border transition-colors ${
                    isOpen
                      ? "border-[#89b4fa]/50 bg-[#181825]"
                      : "border-[#313244] bg-[#181825]/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectStep(view.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                  >
                    <StepBadge status={view.status} index={i} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#cdd6f4]">
                          {STEP_ICON[view.id]}{" "}
                          {t(
                            `onboarding.cliGate.step.${view.id}` as MessageKey,
                          )}
                        </span>
                        <StatusChip
                          status={view.status}
                          skipped={view.skipped}
                        />
                      </span>
                      {/* 왜 필요한지 — 한 줄 */}
                      <span className="mt-1 block text-xs text-[#7f849c]">
                        {t(`onboarding.startHere.why.${view.id}` as MessageKey)}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div
                      data-testid={`start-here-step-body-${view.id}`}
                      className="space-y-3 border-t border-[#313244] px-4 py-4"
                    >
                      <StepBody
                        step={view.id}
                        hasProject={hasProject}
                        seeding={seeding}
                        seedMsg={seedMsg}
                        onSeed={() => void handleSeed()}
                        sendingTicket={sendingTicket}
                        ticketMsg={ticketMsg}
                        onFirstTicket={() => void handleFirstTicket()}
                      />

                      {/* 막혔을 때의 대안 — 항상 보이게 둔다. */}
                      <p className="rounded-md border border-[#f9e2af]/25 bg-[#f9e2af]/5 px-3 py-2 text-xs text-[#a6adc8]">
                        <span className="font-medium text-[#f9e2af]">
                          {t("onboarding.startHere.stuckLabel")}
                        </span>{" "}
                        {t(`onboarding.startHere.alt.${view.id}` as MessageKey)}
                      </p>

                      {view.status !== "done" && (
                        <button
                          type="button"
                          onClick={() => skipStep(view.id)}
                          className="text-xs text-[#7f849c] underline decoration-dotted transition-colors hover:text-[#cdd6f4]"
                        >
                          {t("onboarding.startHere.skipStep")}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <ActivationGuide />
        </div>

        {/* 벤더 확장 — 체크리스트 **뒤**에 둔다. ①~④는 첫 티켓까지 가는 최단
            경로고, 다른 벤더는 그 뒤에 오는 선택이다. 온보딩이 끝나면 펴진 상태로
            보여 "다음에 해볼 것" 이 된다. */}
        <VendorModelsSection onboardingComplete={complete} />

        {/* Landing opt-out. The steps stay right here either way — this only
            stops the shell from opening on this tab. */}
        <div className="mt-5 flex items-center gap-3">
          {progress.dismissed ? (
            <button
              type="button"
              onClick={() => setDismissed(false)}
              className="text-xs text-[#7f849c] underline decoration-dotted hover:text-[#cdd6f4]"
            >
              {t("onboarding.startHere.reenableLanding")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs text-[#7f849c] underline decoration-dotted hover:text-[#cdd6f4]"
            >
              {t("onboarding.startHere.dontLand")}
            </button>
          )}
          <span className="text-xs text-[#585b70]">
            {t("onboarding.startHere.dontLandHint")}
          </span>
        </div>
      </div>

      {showDemo && (
        <VideoDemoModal surface="start_here_tab" onClose={closeDemo} />
      )}
    </div>
  );
}

/** 시작하기 권장사항 — 깃 리포 연결 시 독립 워크트리 자동. */
function WorktreeRecommendNote() {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="start-here-worktree-recommend"
      className="mb-4 rounded-lg border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <GitBranch
          className="mt-0.5 h-4 w-4 shrink-0 text-[#f9e2af]"
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[#f9e2af]/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#f9e2af]">
              {t("onboarding.startHere.worktreeRecommend.badge")}
            </span>
            <p className="text-sm font-semibold text-[#cdd6f4]">
              {t("onboarding.startHere.worktreeRecommend.title")}
            </p>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
            {t("onboarding.startHere.worktreeRecommend.body")}
          </p>
        </div>
      </div>
    </aside>
  );
}

function ValuePreview({ onWatchDemo }: { onWatchDemo: () => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // playbackRate 는 JSX 속성으로 못 준다(알 수 없는 DOM 속성이라 조용히 무시됨).
    // src 재로드/재생 재시작마다 1.0 으로 리셋되므로 loadedmetadata 에도 재적용한다.
    const applyRate = () => {
      el.playbackRate = ORCHESTRATION_DEMO_PLAYBACK_RATE;
    };
    applyRate();
    el.addEventListener("loadedmetadata", applyRate);
    return () => el.removeEventListener("loadedmetadata", applyRate);
  }, []);

  return (
    <section
      data-testid="start-here-value-preview"
      className="mb-4 grid overflow-hidden rounded-lg border border-[#89b4fa]/35 bg-[#181825] shadow-[0_0_0_1px_rgba(137,180,250,0.08)] md:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]"
    >
      <div className="bg-black">
        <video
          ref={videoRef}
          data-testid="start-here-orchestration-video"
          className="aspect-video h-full w-full object-cover"
          src={ORCHESTRATION_DEMO_VIDEO_SRC}
          poster={ORCHESTRATION_DEMO_POSTER_SRC}
          controls
          muted
          playsInline
          preload="metadata"
        />
      </div>
      <div className="flex flex-col justify-between gap-4 border-t border-[#313244] p-4 md:border-l md:border-t-0">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#89b4fa]">
            {t("onboarding.startHere.value.kicker", {
              seconds: ORCHESTRATION_DEMO_DISPLAY_SECONDS,
            })}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[#cdd6f4]">
            {t("onboarding.startHere.value.title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#a6adc8]">
            {t("onboarding.startHere.value.body", {
              seconds: ORCHESTRATION_DEMO_DISPLAY_SECONDS,
            })}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="start-here-demo-cta"
            onClick={onWatchDemo}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#89b4fa] px-4 py-2.5 text-sm font-bold text-[#1e1e2e] shadow-md shadow-[#89b4fa]/25 transition-colors hover:bg-[#74c7ec] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#89b4fa]"
          >
            <PlayCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t("onboarding.startHere.value.playVideo", {
              seconds: ORCHESTRATION_DEMO_DISPLAY_SECONDS,
            })}
          </button>
          <span className="text-center text-[11px] leading-4 text-[#7f849c] sm:text-left">
            {t("onboarding.startHere.value.zeroCost")}
          </span>
        </div>
      </div>
    </section>
  );
}

function ActivationGuide() {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="start-here-activation-guide"
      className="space-y-3 rounded-lg border border-[#313244] bg-[#181825]/80 p-4"
    >
      <div>
        <p className="text-[11px] font-semibold uppercase text-[#f9e2af]">
          {t("onboarding.startHere.activation.kicker")}
        </p>
        <h2 className="mt-1 text-base font-semibold text-[#cdd6f4]">
          {t("onboarding.startHere.activation.title")}
        </h2>
        <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
          {t("onboarding.startHere.activation.body")}
        </p>
      </div>

      <div
        data-testid="start-here-terminal-flow"
        className="rounded-md border border-[#45475a] bg-[#11111b] p-3"
      >
        <div className="mb-2 flex items-center justify-between border-b border-[#313244] pb-2">
          <div className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-[#89b4fa]" aria-hidden />
            <span className="text-xs font-medium text-[#cdd6f4]">
              {t("onboarding.startHere.activation.terminalTitle")}
            </span>
          </div>
          <span className="rounded bg-[#a6e3a1]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#a6e3a1]">
            {t("onboarding.startHere.activation.autoCreated")}
          </span>
        </div>
        <div className="space-y-1 font-mono text-[11px] leading-5">
          <p className="text-[#a6e3a1]">$ claude login</p>
          <p className="text-[#7f849c]">
            {t("onboarding.startHere.activation.browserAuth")}
          </p>
          <p className="text-[#a6e3a1]">$ codex login</p>
          <p className="text-[#89b4fa]">
            {t("onboarding.startHere.activation.detected")}
          </p>
        </div>
      </div>

      <ol className="space-y-2">
        {QUICK_GUIDE_STEPS.map((step, index) => {
          const Icon = QUICK_GUIDE_ICON[step];
          return (
            <li key={step} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#313244] text-[#cdd6f4]">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[#cdd6f4]">
                  {index + 1}.{" "}
                  {t(
                    `onboarding.startHere.activation.step.${step}.title` as MessageKey,
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-[#7f849c]">
                  {t(
                    `onboarding.startHere.activation.step.${step}.body` as MessageKey,
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function StepBadge({ status, index }: { status: StepStatus; index: number }) {
  const cls =
    status === "done"
      ? "bg-[#a6e3a1] text-[#1e1e2e]"
      : status === "current"
        ? "bg-[#89b4fa] text-[#1e1e2e]"
        : "bg-[#313244] text-[#7f849c]";
  return (
    <span
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${cls}`}
    >
      {status === "done" ? "✓" : index + 1}
    </span>
  );
}

function StatusChip({
  status,
  skipped,
}: {
  status: StepStatus;
  skipped: boolean;
}) {
  const { t } = useTranslation();
  if (status === "done") {
    return (
      <span className="rounded bg-[#a6e3a1]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#a6e3a1]">
        {t("onboarding.startHere.badge.done")}
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="rounded bg-[#89b4fa]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#89b4fa]">
        {t("onboarding.startHere.badge.current")}
      </span>
    );
  }
  return (
    <span className="rounded bg-[#585b70]/30 px-1.5 py-0.5 text-[10px] font-medium text-[#a6adc8]">
      {skipped
        ? t("onboarding.startHere.badge.skipped")
        : t("onboarding.startHere.badge.remaining")}
    </span>
  );
}

interface StepBodyProps {
  step: WizardStep;
  hasProject: boolean;
  seeding: boolean;
  seedMsg: ActionResult | null;
  onSeed: () => void;
  sendingTicket: boolean;
  ticketMsg: FirstTicketResult | null;
  onFirstTicket: () => void;
}

/** The per-step controls — the same actions the legacy modal renders. */
function StepBody({
  step,
  hasProject,
  seeding,
  seedMsg,
  onSeed,
  sendingTicket,
  ticketMsg,
  onFirstTicket,
}: StepBodyProps) {
  const { t } = useTranslation();

  if (step === "install" || step === "auth") {
    return (
      <>
        <p className="text-xs text-[#a6adc8]">
          {t(`onboarding.cliGate.${step}.body` as MessageKey)}
        </p>
        {step === "install" && (
          <>
            <div className="rounded-md border border-[#89b4fa]/25 bg-[#89b4fa]/5 px-3 py-2.5 text-xs text-[#a6adc8]">
              {t("onboarding.cliGate.install.costNote")}
            </div>
            {/* ★원클릭: 미설치 CLI 를 한 번에. 개별 행 버튼은 그대로 남는다
                (실패한 한 행만 다시 시도하는 길). */}
            <InstallAllPanel />
          </>
        )}
        {/* ★원클릭 사인인: 터미널 자동생성 + 로그인 명령 자동주입 → 브라우저 승인만. */}
        {step === "auth" && <OneClickSignInPanel />}
        {ROWS.map((row) => (
          <CliRowCard key={row.id} row={row} phase={step} />
        ))}
        {/* ②단계의 대안 — Claude·Codex 계정이 둘 다 없어도 시작하는 길(F4).
            ①단계에는 두지 않는다: 저 CLI 들은 어차피 자동 설치되고, 벤더 선택은
            "무슨 계정으로 붙을까" 라는 ②단계의 질문이다. */}
        {step === "auth" && (
          <>
            <p className="rounded-md border border-[#45475a] bg-[#11111b]/35 px-3 py-2 text-xs text-[#a6adc8]">
              {t("onboarding.cliGate.subscription.byomBridge")}
            </p>
            <ByomStartSection />
          </>
        )}
      </>
    );
  }

  if (step === "prd") {
    return (
      <>
        <p className="text-xs text-[#a6adc8]">
          {t("onboarding.cliGate.prd.body")}
        </p>
        {!hasProject ? (
          <>
            <button
              onClick={connectFolder}
              className="w-full rounded-md bg-[#89b4fa] px-3 py-2 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
            >
              {t("onboarding.cliGate.project.connectFolder")}
            </button>
            <p className="text-xs text-[#7f849c]">
              {t("onboarding.cliGate.project.hint")}
            </p>
            <p className="text-xs text-[#7f849c]">
              {t("onboarding.cliGate.project.localFolderHint")}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-3 py-2.5 text-sm text-[#a6e3a1]">
              <span>✓ {t("onboarding.cliGate.project.connected")}</span>
              <span className="text-[#a6adc8]">·</span>
              <span className="text-[#a6adc8]">
                {t("onboarding.cliGate.project.launching")}
              </span>
            </div>
            <button
              onClick={onSeed}
              disabled={seeding}
              className="w-full rounded-md border border-[#45475a] px-3 py-2 text-sm font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
            >
              {seeding
                ? t("onboarding.cliGate.project.seeding")
                : t("onboarding.cliGate.project.seedPrd")}
            </button>
            {seedMsg && (
              <p
                className={`text-xs ${
                  seedMsg.ok ? "text-[#a6e3a1]" : "text-[#f38ba8]"
                }`}
              >
                {seedMsg.text}
              </p>
            )}
          </>
        )}
      </>
    );
  }

  // firstTicket — the value moment.
  return (
    <>
      <p className="text-xs text-[#a6adc8]">
        {t("onboarding.cliGate.firstTicket.body")}
      </p>
      <button
        onClick={onFirstTicket}
        disabled={sendingTicket || !hasProject}
        className="w-full rounded-md bg-[#a6e3a1] px-3 py-2.5 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#94e2d5] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sendingTicket
          ? t("onboarding.cliGate.firstTicket.creating")
          : t("onboarding.cliGate.firstTicket.create")}
      </button>
      {!hasProject && (
        <p className="text-xs text-[#f9e2af]">
          {t("onboarding.cliGate.firstTicket.needProject")}
        </p>
      )}
      {ticketMsg && (
        <FirstTicketResultNote
          result={ticketMsg}
          onRetry={onFirstTicket}
          retrying={sendingTicket}
        />
      )}
    </>
  );
}
