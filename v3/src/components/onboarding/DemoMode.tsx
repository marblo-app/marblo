import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import telemetry from "../../services/telemetryService";

/**
 * 인증 전 샘플 데모 (Demo Mode P3, ticket qQLGS3NW).
 *
 * 미인증 상태(로그인 화면)에서 마블로의 핵심 순간 — "오케스트레이터가 하나의
 * 요청을 여러 티켓으로 분해하고, 각 티켓에 에이전트를 배정해 병렬로 처리하는
 * 장면" — 을 스크립티드 재생으로 보여준다. ★실제 CLI 스폰·LLM 호출·과금은
 * 전혀 없다: 모든 진행은 setTimeout 기반 타임라인이며 아래 데이터는 전부
 * 하드코딩된 샘플이다(네트워크·electronAPI 접근 없음).
 *
 * 종료 시 CTA("이제 내 계정을 연결해 실제로 실행하기")로 연결 마법사
 * (CliSetupGate)의 진입점으로 유도한다. 데모는 로그인 이전이라 위저드를 직접
 * 열 수 없으므로, CTA 는 재사용 플래그(DEMO_CONNECT_PENDING_KEY)를 세우고
 * 로그인 화면으로 복귀한다 — 로그인 성공 후 Layout 이 그 플래그를 보고 기존
 * `marblo:open-cli-setup` 이벤트를 디스패치해 위저드를 연다(재구현 없음).
 *
 * 계측: 진입(demoStarted) · 완주(demoCompleted) · CTA클릭(demoCtaClick).
 */

/** CTA 클릭 시 세워지는 플래그. 로그인 성공 후 Layout 이 소비하여 연결 마법사를
 *  연다. telemetryService 가 아니라 여기·Layout 이 공유하는 순수 스토리지 키. */
export const DEMO_CONNECT_PENDING_KEY = "marblo.demoConnectPending";

interface DemoModeProps {
  /** 데모를 연 화면(계측 surface). LoginPage 는 "auth_screen". */
  surface: string;
  /** 닫기(CTA 아님) — 로그인 화면으로 그냥 복귀. */
  onClose: () => void;
  /** CTA("계정 연결하고 실행") — 플래그는 이 컴포넌트가 세우고, 이후 처리(로그인
   *  화면 복귀)는 부모가 onClose 와 동일하게 수행한다. */
  onConnect: () => void;
}

type AgentKind = "claude" | "codex";

interface SubtaskDef {
  id: string;
  titleKey:
    | "onboarding.demo.sub.frontend"
    | "onboarding.demo.sub.backend"
    | "onboarding.demo.sub.test";
  roleKey:
    | "onboarding.demo.role.frontend"
    | "onboarding.demo.role.backend"
    | "onboarding.demo.role.test";
  agent: AgentKind;
  /** 이 카드가 '완료'로 넘어가는 step 임계값. */
  doneAtStep: number;
}

// 스크립트된 하위 작업(샘플, 고정). 요청 "랜딩 페이지 만들기" 를 3개로 분해.
const SUBTASKS: SubtaskDef[] = [
  {
    id: "s1",
    titleKey: "onboarding.demo.sub.frontend",
    roleKey: "onboarding.demo.role.frontend",
    agent: "claude",
    doneAtStep: 5,
  },
  {
    id: "s2",
    titleKey: "onboarding.demo.sub.backend",
    roleKey: "onboarding.demo.role.backend",
    agent: "codex",
    doneAtStep: 6,
  },
  {
    id: "s3",
    titleKey: "onboarding.demo.sub.test",
    roleKey: "onboarding.demo.role.test",
    agent: "claude",
    doneAtStep: 7,
  },
];

// 마지막 step = 완료/CTA 노출. step 0..FINAL_STEP.
const FINAL_STEP = 8;
// 각 step 진입 후 다음 step 까지의 지연(ms). index i = step i 재생 시간.
const STEP_DELAYS = [1100, 1400, 1500, 1600, 1500, 900, 900, 1200];

interface LogLine {
  atStep: number;
  kind: "user" | "orch" | AgentKind;
  key:
    | "onboarding.demo.msg.user"
    | "onboarding.demo.msg.analyze"
    | "onboarding.demo.msg.decompose"
    | "onboarding.demo.msg.assign"
    | "onboarding.demo.msg.claudeStart"
    | "onboarding.demo.msg.codexStart"
    | "onboarding.demo.msg.working"
    | "onboarding.demo.msg.done";
}

const LOG: LogLine[] = [
  { atStep: 0, kind: "user", key: "onboarding.demo.msg.user" },
  { atStep: 1, kind: "orch", key: "onboarding.demo.msg.analyze" },
  { atStep: 2, kind: "orch", key: "onboarding.demo.msg.decompose" },
  { atStep: 3, kind: "orch", key: "onboarding.demo.msg.assign" },
  { atStep: 3, kind: "claude", key: "onboarding.demo.msg.claudeStart" },
  { atStep: 3, kind: "codex", key: "onboarding.demo.msg.codexStart" },
  { atStep: 4, kind: "orch", key: "onboarding.demo.msg.working" },
  { atStep: 7, kind: "orch", key: "onboarding.demo.msg.done" },
];

function agentLabel(agent: AgentKind): string {
  return agent === "claude" ? "Claude" : "Codex";
}

function agentClasses(agent: AgentKind): string {
  return agent === "claude"
    ? "bg-orange-500/15 text-orange-300 ring-orange-500/30"
    : "bg-sky-500/15 text-sky-300 ring-sky-500/30";
}

type Column = "todo" | "doing" | "done";

function columnFor(sub: SubtaskDef, step: number): Column | null {
  if (step < 2) return null;
  if (step === 2) return "todo";
  if (step >= sub.doneAtStep) return "done";
  return "doing";
}

export function DemoMode({ surface, onClose, onConnect }: DemoModeProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach((h) => clearTimeout(h));
    timers.current = [];
  }, []);

  const markCompleted = useCallback((reason: string) => {
    if (completedRef.current) return;
    completedRef.current = true;
    telemetry.demoCompleted(reason);
  }, []);

  // 데모 진입 계측 — 마운트 1회.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    telemetry.demoStarted(surface);
  }, [surface]);

  // 타임라인 재생: step 0 부터 STEP_DELAYS 누적 지연으로 다음 step 을 예약한다.
  // 실제 작업이 아니라 순수 setTimeout — 스폰/네트워크 없음. 재생이 FINAL_STEP 에
  // 도달하면 완주(played)로 기록. Reduced-motion 은 지연을 크게 압축한다.
  const play = useCallback(() => {
    clearTimers();
    let acc = 0;
    for (let next = 1; next <= FINAL_STEP; next++) {
      acc += prefersReducedMotion ? 150 : STEP_DELAYS[next - 1];
      const target = next;
      timers.current.push(
        setTimeout(() => {
          setStep(target);
          if (target === FINAL_STEP) markCompleted("played");
        }, acc),
      );
    }
  }, [clearTimers, markCompleted, prefersReducedMotion]);

  useEffect(() => {
    play();
    return clearTimers;
  }, [play, clearTimers]);

  // 로그가 늘어날 때 오케 패널 하단으로 스크롤.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [step]);

  const skip = useCallback(() => {
    clearTimers();
    setStep(FINAL_STEP);
    markCompleted("skipped");
  }, [clearTimers, markCompleted]);

  const replay = useCallback(() => {
    completedRef.current = false;
    setStep(0);
    play();
  }, [play]);

  const handleConnect = useCallback(() => {
    // 완주 이벤트가 아직이면(사용자가 재생 중 CTA 를 못 누르므로 보통은 완주 후지만
    // 방어적으로) 완주도 함께 기록. 그다음 CTA 클릭 계측 → 재사용 플래그 → 부모.
    markCompleted("played");
    telemetry.demoCtaClick();
    try {
      localStorage.setItem(DEMO_CONNECT_PENDING_KEY, "1");
    } catch {
      /* 프라이빗 모드 — 플래그 없이도 로그인 후 첫-실행 위저드는 뜬다(폴백) */
    }
    onConnect();
  }, [markCompleted, onConnect]);

  const done = step >= FINAL_STEP;
  const progressPct = Math.round(
    (Math.min(step, FINAL_STEP) / FINAL_STEP) * 100,
  );
  const visibleLog = LOG.filter((l) => l.atStep <= step);

  const statusKey =
    step >= 7
      ? "onboarding.demo.status.done"
      : step >= 3
        ? "onboarding.demo.status.running"
        : step >= 1
          ? "onboarding.demo.status.analyzing"
          : "onboarding.demo.status.queued";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.demo.title")}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-slate-100 shadow-2xl ring-1 ring-white/10">
        {/* 헤더 — DEMO 배지 + 제목 + 닫기 */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <span className="rounded-md bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30">
            {t("onboarding.demo.badge")}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">
              {t("onboarding.demo.title")}
            </h2>
            <p className="truncate text-xs text-slate-400">
              {t("onboarding.demo.disclaimer")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("onboarding.demo.close")}
            className="ml-auto rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* 본문 — 좌: 오케 로그, 우: 미니 칸반 보드 */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-white/10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          {/* 오케스트레이터 패널 */}
          <div className="flex min-h-0 flex-col bg-slate-900">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/30">
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2a2 2 0 0 1 2 2v1.06a6.5 6.5 0 0 1 3.88 3.88H19a2 2 0 1 1 0 4h-1.12A6.5 6.5 0 0 1 14 16.94V18a2 2 0 1 1-4 0v-1.06a6.5 6.5 0 0 1-3.88-3.88H5a2 2 0 1 1 0-4h1.12A6.5 6.5 0 0 1 10 5.06V4a2 2 0 0 1 2-2Z" />
                </svg>
              </span>
              <span className="text-xs font-semibold text-slate-200">
                {t("onboarding.demo.orchestrator")}
              </span>
              {step >= 1 && !done && (
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span
                    className={`h-1.5 w-1.5 rounded-full bg-emerald-400 ${
                      prefersReducedMotion ? "" : "animate-pulse"
                    }`}
                  />
                  {t("onboarding.demo.thinking")}
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {visibleLog.map((line, i) => (
                <LogBubble key={`${line.atStep}-${i}`} line={line} t={t} />
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 미니 칸반 보드 */}
          <div className="flex min-h-0 flex-col bg-slate-950">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-200">
                {t("onboarding.demo.board")}
              </span>
              {step >= 1 && (
                <span className="ml-auto flex items-center gap-2 rounded-md bg-white/5 px-2 py-1 text-[11px] text-slate-300 ring-1 ring-white/10">
                  <span className="truncate font-medium text-slate-100">
                    {t("onboarding.demo.request")}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">{t(statusKey)}</span>
                </span>
              )}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto p-3">
              {(["todo", "doing", "done"] as Column[]).map((col) => (
                <div key={col} className="flex min-w-0 flex-col gap-2">
                  <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>{t(`onboarding.demo.col.${col}` as ColKey)}</span>
                    <span>
                      {
                        SUBTASKS.filter((s) => columnFor(s, step) === col)
                          .length
                      }
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {SUBTASKS.filter((s) => columnFor(s, step) === col).map(
                      (s) => (
                        <SubtaskCard
                          key={s.id}
                          sub={s}
                          column={col}
                          reduceMotion={prefersReducedMotion}
                          t={t}
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 푸터 — 진행바 + 컨트롤/CTA */}
        <div className="border-t border-white/10 px-5 py-3">
          <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-indigo-400 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {done ? (
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleConnect}
                className="order-1 flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 sm:order-2"
              >
                {t("onboarding.demo.cta")}
              </button>
              <button
                type="button"
                onClick={replay}
                className="order-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/5 sm:order-1"
              >
                {t("onboarding.demo.replay")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {t("onboarding.demo.playing")}
              </span>
              <button
                type="button"
                onClick={skip}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
              >
                {t("onboarding.demo.skip")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;
type ColKey =
  | "onboarding.demo.col.todo"
  | "onboarding.demo.col.doing"
  | "onboarding.demo.col.done";

function LogBubble({ line, t }: { line: LogLine; t: TFn }) {
  const text = t(line.key);
  if (line.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-500/90 px-3 py-2 text-xs leading-relaxed text-white">
          {text}
        </div>
      </div>
    );
  }
  if (line.kind === "orch") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2 text-xs leading-relaxed text-slate-200 ring-1 ring-white/10">
          {text}
        </div>
      </div>
    );
  }
  // 에이전트 라인
  const agent = line.kind;
  return (
    <div className="flex items-start gap-2 pl-2">
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ${agentClasses(
          agent,
        )}`}
      >
        {agentLabel(agent)}
      </span>
      <span className="text-xs leading-relaxed text-slate-400">{text}</span>
    </div>
  );
}

function SubtaskCard({
  sub,
  column,
  reduceMotion,
  t,
}: {
  sub: SubtaskDef;
  column: Column;
  reduceMotion: boolean;
  t: TFn;
}) {
  const working = column === "doing";
  const doneCol = column === "done";
  return (
    <div
      className={`rounded-lg border p-2.5 text-left transition ${
        doneCol
          ? "border-emerald-500/30 bg-emerald-500/5"
          : working
            ? "border-indigo-400/40 bg-indigo-500/10"
            : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {t(sub.roleKey)}
        </span>
        {doneCol && (
          <svg
            className="ml-auto h-3.5 w-3.5 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {working && (
          <span
            className={`ml-auto h-1.5 w-1.5 rounded-full bg-indigo-400 ${
              reduceMotion ? "" : "animate-pulse"
            }`}
          />
        )}
      </div>
      <p className="mb-2 text-xs font-medium leading-snug text-slate-100">
        {t(sub.titleKey)}
      </p>
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${agentClasses(
          sub.agent,
        )}`}
      >
        {agentLabel(sub.agent)}
        {working && (
          <span className="text-[9px] font-normal opacity-80">
            {t("onboarding.demo.agentWorking")}
          </span>
        )}
      </span>
    </div>
  );
}

export default DemoMode;
