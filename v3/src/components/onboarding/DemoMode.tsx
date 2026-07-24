import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import telemetry from "../../services/telemetryService";
import { DemoPlayer } from "./demoPlayer";
import {
  DEMO_ACTS,
  DEMO_ACT_COUNT,
  agentIsClaude,
  columnFor,
  delaysForAct,
  isScheduled,
  reducedMotionDelaysForAct,
  statusKeyFor,
  type AgentKind,
  type Column,
  type DemoAct,
  type DemoLogLine,
  type DemoTaskDef,
} from "./demoScript";

/**
 * 인증 전 샘플 데모 (Demo Mode P3, ticket qQLGS3NW · 2막 확장 ATLPpGxY).
 *
 * 미인증 상태(로그인 화면)와 '시작하기' 탭에서 마블로의 핵심 순간을 스크립티드
 * 재생으로 보여준다. 2막 구성이다:
 *   1막 — 사용자가 PRD 를 쓰고 `/tf-start` 로 프로젝트를 연다 → 오케가 PRD 를
 *          읽고 티켓으로 분해 → 에이전트 배정 → 병렬 진행 → 완료.
 *   2막 — 그다음부터의 추가 임무: `/tf-add` 뒤에 프롬프트를 이어 쓰면 돌아가던
 *          보드 위에 새 티켓이 얹히고 의존성/예약까지 잡힌다.
 * 대사에 실제 슬래시커맨드 문자열을 그대로 노출해 데모가 사용법 교육을 겸한다.
 *
 * ★실제 CLI 스폰·LLM 호출·과금은 전혀 없다: 진행은 setTimeout 스크립트이고
 * 데이터는 전부 하드코딩된 샘플이다(네트워크·electronAPI 접근 없음). 이 불변식은
 * tests/unit/onboarding-demo-script.test.ts 의 소스 스캔 가드가 지킨다.
 *
 * 이 파일은 **화면만** 담당한다 — 대본·타이밍은 demoScript.ts, 재생 엔진(일시정지·
 * 재개·수동진행)은 demoPlayer.ts 에 있고 거기서 유닛테스트된다.
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

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

function agentLabel(agent: AgentKind): string {
  return agentIsClaude(agent) ? "Claude" : "Codex";
}

function agentClasses(agent: AgentKind): string {
  return agentIsClaude(agent)
    ? "bg-orange-500/15 text-orange-300 ring-orange-500/30"
    : "bg-sky-500/15 text-sky-300 ring-sky-500/30";
}

export function DemoMode({ surface, onClose, onConnect }: DemoModeProps) {
  const { t } = useTranslation();
  const [actIndex, setActIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [actFinished, setActFinished] = useState(false);
  /** 같은 막을 다시 재생시키기 위한 트리거(actIndex 가 안 바뀌어도 effect 재실행). */
  const [replayNonce, setReplayNonce] = useState(0);

  const playerRef = useRef<DemoPlayer | null>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const act: DemoAct = DEMO_ACTS[actIndex];
  const isLastAct = actIndex === DEMO_ACT_COUNT - 1;

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
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

  // 막이 바뀔 때마다(그리고 '다시 보기' 때마다) 재생 엔진을 새로 건다.
  // 지연표는 대본에서 계산된 값 — reduced-motion 이면 압축 경로(150ms/step).
  useEffect(() => {
    const delays = prefersReducedMotion
      ? reducedMotionDelaysForAct(act)
      : delaysForAct(act);
    const player = new DemoPlayer(delays, {
      onStep: setStep,
      onActFinished: (reason) => {
        setActFinished(true);
        // 완주 계측은 1막 끝(= 기존 데모의 마지막 장면에 해당)에서만 쏜다.
        // 2막은 그 뒤에 붙은 확장이라, 여기서 또 쏘면 기존 퍼널 수치의 의미가
        // 바뀐다. completedRef 가 중복 발화를 막는다.
        if (actIndex === 0) markCompleted(reason);
      },
    });
    playerRef.current = player;
    setActFinished(false);
    setPaused(false);
    player.start();
    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [act, actIndex, prefersReducedMotion, markCompleted, replayNonce]);

  // 로그가 늘어날 때 오케 패널 하단으로 스크롤.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [step, actIndex]);

  const togglePause = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.finished) return;
    if (player.paused) {
      player.resume();
      setPaused(false);
    } else {
      player.pause();
      setPaused(true);
    }
  }, []);

  const stepForward = useCallback(() => {
    playerRef.current?.next();
  }, []);

  const skipAct = useCallback(() => {
    playerRef.current?.skipToEnd();
  }, []);

  const goToNextAct = useCallback(() => {
    setActIndex((i) => Math.min(i + 1, DEMO_ACT_COUNT - 1));
  }, []);

  const replay = useCallback(() => {
    completedRef.current = false;
    setActIndex(0);
    setReplayNonce((n) => n + 1);
  }, []);

  const handleConnect = useCallback(() => {
    // 완주 이벤트가 아직이면(예: 1막 도중 CTA) 방어적으로 함께 기록.
    // 그다음 CTA 클릭 계측 → 재사용 플래그 → 부모.
    markCompleted("played");
    telemetry.demoCtaClick();
    try {
      localStorage.setItem(DEMO_CONNECT_PENDING_KEY, "1");
    } catch {
      /* 프라이빗 모드 — 플래그 없이도 로그인 후 첫-실행 위저드는 뜬다(폴백) */
    }
    onConnect();
  }, [markCompleted, onConnect]);

  const visibleLog = act.log.filter((line) => line.atStep <= step);
  const statusKey = statusKeyFor(act, step);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.demo.title")}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-900 text-slate-100 shadow-2xl ring-1 ring-white/10">
        {/* 헤더 — DEMO 배지 + 막 이름 + 닫기 */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <span className="rounded-md bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/30">
            {t("onboarding.demo.badge")}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">
              {t(act.nameKey)}
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
              {step >= 1 && !actFinished && !paused && (
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
                <LogBubble
                  key={`${act.id}-${line.atStep}-${i}`}
                  line={line}
                  t={t}
                />
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
                    {t(act.requestKey)}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-400">{t(statusKey)}</span>
                </span>
              )}
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto p-3">
              {(["todo", "doing", "done"] as Column[]).map((col) => {
                const cards = act.tasks.filter(
                  (task) => columnFor(task, step) === col,
                );
                return (
                  <div key={col} className="flex min-w-0 flex-col gap-2">
                    <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <span>{t(`onboarding.demo.col.${col}` as ColKey)}</span>
                      <span>{cards.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {cards.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          column={col}
                          scheduled={isScheduled(task, step)}
                          reduceMotion={prefersReducedMotion}
                          t={t}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 푸터 — 막 인디케이터 + 진행바 + 재생 제어 / CTA */}
        <div className="border-t border-white/10 px-5 py-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-semibold text-slate-300 ring-1 ring-white/10">
              {t("onboarding.demo.act.indicator", {
                current: actIndex + 1,
                total: DEMO_ACT_COUNT,
              })}
            </span>
            <span className="truncate">{t(act.nameKey)}</span>
          </div>
          <ActProgress actIndex={actIndex} step={step} />
          {actFinished ? (
            <ActEndControls
              isLastAct={isLastAct}
              onNextAct={goToNextAct}
              onReplay={replay}
              onConnect={handleConnect}
              t={t}
            />
          ) : (
            <PlaybackControls
              paused={paused}
              onTogglePause={togglePause}
              onStepForward={stepForward}
              onSkipAct={skipAct}
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type ColKey =
  | "onboarding.demo.col.todo"
  | "onboarding.demo.col.doing"
  | "onboarding.demo.col.done";

/** 막별로 나뉜 진행바 — 어디쯤인지와 함께 "아직 한 막 남았다" 를 같이 보여준다. */
function ActProgress({ actIndex, step }: { actIndex: number; step: number }) {
  return (
    <div className="mb-3 flex w-full gap-1">
      {DEMO_ACTS.map((a, i) => {
        const pct =
          i < actIndex
            ? 100
            : i === actIndex
              ? Math.round((Math.min(step, a.finalStep) / a.finalStep) * 100)
              : 0;
        return (
          <div
            key={a.id}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
            style={{ flexGrow: a.finalStep }}
          >
            <div
              className="h-full rounded-full bg-indigo-400 transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 재생 중 컨트롤 — 일시정지/재개 · 수동 다음 단계 · 이 막 건너뛰기. */
function PlaybackControls({
  paused,
  onTogglePause,
  onStepForward,
  onSkipAct,
  t,
}: {
  paused: boolean;
  onTogglePause: () => void;
  onStepForward: () => void;
  onSkipAct: () => void;
  t: TFn;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onTogglePause}
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/5"
      >
        {paused ? t("onboarding.demo.resume") : t("onboarding.demo.pause")}
      </button>
      <button
        type="button"
        onClick={onStepForward}
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/5"
      >
        {t("onboarding.demo.nextStep")} →
      </button>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
        {paused ? t("onboarding.demo.paused") : t("onboarding.demo.playing")}
      </span>
      <button
        type="button"
        onClick={onSkipAct}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
      >
        {t("onboarding.demo.skip")}
      </button>
    </div>
  );
}

/** 막이 끝났을 때 — 1막이면 다음 막으로, 마지막 막이면 연결 CTA 로. */
function ActEndControls({
  isLastAct,
  onNextAct,
  onReplay,
  onConnect,
  t,
}: {
  isLastAct: boolean;
  onNextAct: () => void;
  onReplay: () => void;
  onConnect: () => void;
  t: TFn;
}) {
  if (!isLastAct) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-400">{t("onboarding.demo.actDone")}</p>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onNextAct}
            className="order-1 flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 sm:order-2"
          >
            {t("onboarding.demo.nextAct")} →
          </button>
          <button
            type="button"
            onClick={onReplay}
            className="order-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/5 sm:order-1"
          >
            {t("onboarding.demo.replay")}
          </button>
        </div>
        {/* 2막을 안 보고 바로 전환하려는 사람을 막지 않는다. */}
        <button
          type="button"
          onClick={onConnect}
          className="self-center text-xs font-medium text-indigo-300 underline decoration-dotted transition hover:text-indigo-200"
        >
          {t("onboarding.demo.cta")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onConnect}
        className="order-1 flex-1 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 sm:order-2"
      >
        {t("onboarding.demo.cta")}
      </button>
      <button
        type="button"
        onClick={onReplay}
        className="order-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/5 sm:order-1"
      >
        {t("onboarding.demo.replay")}
      </button>
    </div>
  );
}

function LogBubble({ line, t }: { line: DemoLogLine; t: TFn }) {
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
  // 사용자가 실제로 친 슬래시커맨드 — 모노 칩으로 그대로 노출해 사용법을 가르친다.
  if (line.kind === "command") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-lg bg-slate-800 px-3 py-2 font-mono text-[11px] leading-relaxed text-emerald-300 ring-1 ring-emerald-400/25">
          {text}
        </div>
      </div>
    );
  }
  if (line.kind === "hint") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[90%] text-right text-[11px] leading-relaxed text-slate-500">
          {text}
        </p>
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

function TaskCard({
  task,
  column,
  scheduled,
  reduceMotion,
  t,
}: {
  task: DemoTaskDef;
  column: Column;
  scheduled: boolean;
  reduceMotion: boolean;
  t: TFn;
}) {
  const working = column === "doing";
  const doneCol = column === "done";
  return (
    <div
      className={`rounded-lg border p-2.5 text-left transition ${
        doneCol
          ? task.carriedOver
            ? "border-white/10 bg-white/[0.02] opacity-70"
            : "border-emerald-500/30 bg-emerald-500/5"
          : working
            ? "border-indigo-400/40 bg-indigo-500/10"
            : scheduled
              ? "border-amber-400/30 bg-amber-400/5"
              : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {t(task.roleKey)}
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
        {t(task.titleKey)}
      </p>
      {task.carriedOver && doneCol ? (
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-white/10">
          {t("onboarding.demo.carriedOver")}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${agentClasses(
              task.agent,
            )}`}
          >
            {agentLabel(task.agent)}
            {working && (
              <span className="text-[9px] font-normal opacity-80">
                {t("onboarding.demo.agentWorking")}
              </span>
            )}
          </span>
          {scheduled && (
            <span
              className="inline-flex items-center rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-400/30"
              title={t("onboarding.demo.blockedBy")}
            >
              {t("onboarding.demo.scheduled")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default DemoMode;
