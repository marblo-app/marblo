import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { WIZARD_STEPS, type WizardStep } from "../../lib/cliSetupGate";
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
import telemetry from "../../services/telemetryService";
import {
  connectFolder,
  createFirstTicket,
  seedSamplePrd,
  type ActionResult,
  type FirstTicketResult,
} from "../../services/cliSetupActions";
import { CliRowCard } from "./CliSetupRows";
import { FirstTicketResultNote } from "./FirstTicketResultNote";
import { VendorModelsSection } from "./VendorModelsSection";
import { DemoMode, DEMO_CONNECT_PENDING_KEY } from "./DemoMode";
import { DEMO_TOTAL_SECONDS } from "./demoScript";

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

  const live = useMemo(
    () => ({ requiredInstalled, requiredReady: ready, hasProject }),
    [requiredInstalled, ready, hasProject],
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
    if (requiredInstalled || ready) markDone("install");
    if (ready) markDone("auth");
    if (hasProject) markDone("prd");
  }, [requiredInstalled, ready, hasProject, markDone]);

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
      localStorage.removeItem(DEMO_CONNECT_PENDING_KEY);
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
      <div className="mx-auto max-w-2xl">
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
              onClick={openDemo}
              className="rounded-md border border-[#45475a] px-2.5 py-1 text-xs font-medium text-[#cdd6f4] transition-colors hover:bg-[#313244]"
            >
              ▶{" "}
              {t("onboarding.startHere.watchDemo", {
                seconds: DEMO_TOTAL_SECONDS,
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

        {complete && (
          <div className="mb-4 rounded-lg border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-4 py-3">
            <p className="text-sm font-semibold text-[#a6e3a1]">
              🎉 {t("onboarding.startHere.allDone.title")}
            </p>
            <p className="mt-1 text-xs text-[#a6adc8]">
              {t("onboarding.startHere.allDone.body")}
            </p>
          </div>
        )}

        {/* ── The checklist. Nothing here ever disappears. ───────────────── */}
        <div className="space-y-2.5">
          {views.map((view, i) => {
            const isOpen = view.id === openStep;
            return (
              <section
                key={view.id}
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
                        {t(`onboarding.cliGate.step.${view.id}` as MessageKey)}
                      </span>
                      <StatusChip status={view.status} skipped={view.skipped} />
                    </span>
                    {/* 왜 필요한지 — 한 줄 */}
                    <span className="mt-1 block text-xs text-[#7f849c]">
                      {t(`onboarding.startHere.why.${view.id}` as MessageKey)}
                    </span>
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t border-[#313244] px-4 py-4">
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
        <DemoMode
          surface="start_here_tab"
          onClose={closeDemo}
          onConnect={closeDemo}
        />
      )}
    </div>
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
          <div className="rounded-md border border-[#89b4fa]/25 bg-[#89b4fa]/5 px-3 py-2.5 text-xs text-[#a6adc8]">
            {t("onboarding.cliGate.install.costNote")}
          </div>
        )}
        {ROWS.map((row) => (
          <CliRowCard key={row.id} row={row} phase={step} />
        ))}
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
      {ticketMsg && <FirstTicketResultNote result={ticketMsg} />}
    </>
  );
}
