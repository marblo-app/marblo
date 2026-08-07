import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import OrchestratorPanel from "../orchestrator/OrchestratorPanel";
import { DemoMode, DEMO_CONNECT_PENDING_KEY } from "../onboarding/DemoMode";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useBeginnerAsk } from "../../hooks/useBeginnerAsk";
import { useCliSetupEngine } from "../../hooks/useCliSetupEngine";
import { shouldPromote, type PromotionTrigger } from "../../lib/beginnerMode";
import { useAgentStore } from "../../stores/agentStore";
import { useBeginnerModeStore } from "../../stores/beginnerModeStore";
import { useCliSetupStore } from "../../stores/cliSetupStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useTaskStore } from "../../stores/taskStore";
import { connectFolder } from "../../services/cliSetupActions";
import telemetry from "../../services/telemetryService";
import { BeginnerConnectStep } from "./BeginnerConnectStep";
import { BeginnerFirstAsk } from "./BeginnerFirstAsk";
import { BeginnerLiveStrip } from "./BeginnerLiveStrip";
import { BeginnerPromotionModal } from "./BeginnerPromotionModal";
import { BeginnerTour } from "./BeginnerTour";

/**
 * 비기너 셸 — 오케챗 하나만 있는 화면 (설계: v3/docs/BEGINNER-MODE-DESIGN.md).
 *
 * 사이드바·15개 탭·보드·워크트리·Activity·에이전트 터미널 열을 **렌더하지 않는다.**
 * 상태를 지우는 게 아니라 그리지 않을 뿐이라, 승격하면 워크스페이스 셸이 자기
 * persist 값 그대로 복원된다.
 *
 * ★풀스크린 오케챗은 `OrchestratorPanel fill` **그대로**다. 오케는 이미 실 PTY 를
 * 태운 대화창이므로 새 챗 프로토콜을 만들지 않는다(PTY 재배선 0).
 *
 * ★`useAppLifecycle()` 은 여기서도 동일하게 마운트해야 한다 — 오케 자동기동·
 * 에이전트 재접속·세션 복원·비용 기록이 전부 그 훅에 있어서, 빼면 비기너 유저의
 * 오케가 아예 안 뜬다. `useCliSetupEngine` 도 창당 정확히 한 번 필요하다(프로브·
 * 자동설치·로그인 자동재확인·`marblo:cli-auth-ready`). 워크스페이스 셸의
 * CliSetupHost 와 동시에 마운트되는 일은 없다 — 셸은 둘 중 하나만 뜬다.
 */
export function BeginnerShell() {
  const { t } = useTranslation();

  // 워크스페이스 셸과 같은 라이프사이클. 여기서 구조분해한 값은 안 쓰지만 훅
  // 자체의 부수효과(오케 자동기동 등)가 목적이다.
  useAppLifecycle();

  // 이 셸에는 CliSetupHost(배너)가 없다. 엔진은 여기서 한 번만 돌리고, "설정이
  // 필요하다" 는 요청은 아래 연결 게이트가 `ready` 로 직접 판정하므로 핸들러는
  // 의도적으로 no-op 이다(모달도 배너도 띄우지 않는다).
  const noop = useCallback(() => {}, []);
  useCliSetupEngine({ openAt: noop });

  const cliReady = useCliSetupStore((s) => s.ready);
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id ?? "";
  const hasFolder = !!currentProject?.folderPath;

  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);

  const enteredAt = useBeginnerModeStore((s) => s.enteredAt);
  const entryReason = useBeginnerModeStore((s) => s.entryReason);
  const enteredReported = useBeginnerModeStore((s) => s.enteredReported);
  const markEnteredReported = useBeginnerModeStore(
    (s) => s.markEnteredReported,
  );
  const firstCompletionAt = useBeginnerModeStore((s) => s.firstCompletionAt);
  const markFirstCompletion = useBeginnerModeStore(
    (s) => s.markFirstCompletion,
  );
  const promotionShownAt = useBeginnerModeStore((s) => s.promotionShownAt);
  const markPromotionShown = useBeginnerModeStore((s) => s.markPromotionShown);
  const promote = useBeginnerModeStore((s) => s.promote);

  const ask = useBeginnerAsk();
  const [showDemo, setShowDemo] = useState(false);
  const [promotion, setPromotion] = useState<PromotionTrigger | null>(null);

  // 보드가 없으므로 티켓/에이전트 구독을 이 셸이 직접 든다 — 인라인 라이브의
  // 유일한 데이터원이다.
  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToTasks(projectId);
    return () => unsub();
  }, [projectId, subscribeToTasks]);

  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeToAgents(projectId);
    return () => unsub();
  }, [projectId, subscribeToAgents]);

  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "DONE").length,
    [tasks],
  );

  // 진입 계측 — 세션당 한 번. 사유는 스토어가 판정한다(최초판정/재시작/설정복귀):
  // 재시작을 신규 설치로 계상하면 비기너 진입 수가 세션 수만큼 부풀어 퍼널
  // 분모가 망가진다.
  useEffect(() => {
    if (enteredReported) return;
    markEnteredReported();
    telemetry.beginnerEntered(entryReason);
  }, [enteredReported, markEnteredReported, entryReason]);

  // ★첫 완료 계측 — 설치당 한 번. 스토어가 멱등성을 보장하고(이미 기록됐으면
  // null), 경과는 클라가 계산해 싣는다(서버 timestamp 는 수신시각이라 단계
  // 지연을 못 구한다 — 진단 §3).
  useEffect(() => {
    if (firstCompletionAt || completedTasks === 0) return;
    const durationMs = markFirstCompletion();
    if (durationMs !== null) telemetry.beginnerFirstCompletion(durationMs);
  }, [completedTasks, firstCompletionAt, markFirstCompletion]);

  // 승격 트리거. mergedTasks 는 아직 0 이 흐른다(설계 §9 F1: merge_history 구독이
  // App.tsx 안에 있고 스토어가 없어, 여기서 끌어오면 두 번째 구독이 생긴다).
  // 완료 건수·사용 일수 트리거가 그 자리를 메운다.
  useEffect(() => {
    if (promotionShownAt || promotion) return;
    const trigger = shouldPromote(
      {
        completedTasks,
        mergedTasks: 0,
        elapsedMs: enteredAt ? Date.now() - enteredAt : 0,
      },
      !!promotionShownAt,
    );
    if (trigger) {
      setPromotion(trigger);
      markPromotionShown();
    }
  }, [
    completedTasks,
    enteredAt,
    promotionShownAt,
    promotion,
    markPromotionShown,
  ]);

  const goAdvanced = useCallback(
    (trigger: PromotionTrigger | "manual") => {
      telemetry.beginnerPromoted(trigger, trigger === "manual");
      setPromotion(null);
      promote(trigger);
    },
    [promote],
  );

  const closeDemo = useCallback(() => {
    // 데모의 CTA 는 "로그인 후 연결" 플래그를 세우는데, 우리는 이미 로그인 뒤
    // 연결 화면에 서 있다 — 다음 실행에 낡은 안내가 남지 않게 지운다.
    try {
      localStorage.removeItem(DEMO_CONNECT_PENDING_KEY);
    } catch {
      /* 프라이빗 모드 — 지울 게 없다 */
    }
    setShowDemo(false);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#11111b] text-[#cdd6f4]">
      {/* ── 최소 상단바. 프로젝트 스위처·비용·탭은 일부러 없다. ────────────── */}
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-[#313244] bg-[#181825] px-4 py-2">
        <span className="text-sm font-semibold text-[#cdd6f4]">Marblo</span>
        <span className="min-w-0 flex-1 truncate text-xs text-[#7f849c]">
          {currentProject?.name || t("beginner.topbar.noFolder")}
        </span>
        <button
          type="button"
          data-testid="beginner-open-folder"
          onClick={connectFolder}
          className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
        >
          {hasFolder
            ? t("beginner.topbar.changeFolder")
            : t("beginner.topbar.openFolder")}
        </button>
        <button
          type="button"
          data-testid="beginner-open-settings"
          title={t("beginner.topbar.advancedHint")}
          onClick={() => {
            // 설정은 어드밴스드 셸의 탭이다. 비기너에 설정 화면을 복제하는 대신
            // 승격시키고 그 탭을 열어 준다 — 막다른 버튼을 만들지 않는다.
            useSplitWorkspaceStore.getState().setActiveTab("settings");
            goAdvanced("manual");
          }}
          className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
        >
          {t("beginner.topbar.settings")}
        </button>
        {/* ★상시 전환 어포던스 — 승격 모달(완료 3건 트리거)을 기다리지 않고
            언제든 개발(어드밴스드) 모드로 넘어간다. 그래서 눈에 띄는 강조색이다:
            "숨겨진 화면이 따로 있다" 는 사실 자체가 첫 화면에서 보여야 한다. */}
        <button
          type="button"
          data-testid="beginner-go-advanced"
          data-coach="beginner-advanced"
          title={t("beginner.topbar.advancedHint")}
          onClick={() => goAdvanced("manual")}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#89b4fa]/50 bg-[#89b4fa]/10 px-2.5 py-1 text-xs font-medium text-[#89b4fa] transition-colors hover:border-[#89b4fa] hover:bg-[#89b4fa]/20"
        >
          <span aria-hidden className="font-mono text-[10px]">
            {"</>"}
          </span>
          {t("beginner.topbar.advanced")}
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        {!cliReady ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <BeginnerConnectStep onWatchDemo={() => setShowDemo(true)} />
          </div>
        ) : !hasFolder ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <section
              data-testid="beginner-folder-gate"
              className="mx-auto w-full max-w-2xl rounded-lg border border-[#313244] bg-[#181825] p-6 text-center"
            >
              <h1 className="text-lg font-semibold text-[#cdd6f4]">
                {t("beginner.folder.title")}
              </h1>
              <p className="mt-1.5 text-sm leading-6 text-[#a6adc8]">
                {t("beginner.folder.body")}
              </p>
              <button
                type="button"
                onClick={connectFolder}
                className="mt-4 rounded-md bg-[#89b4fa] px-4 py-2 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec]"
              >
                {t("beginner.folder.cta")}
              </button>
            </section>
          </div>
        ) : (
          <>
            {/* 첫 요청 — 전달되면 스스로 접혀 확인 한 줄만 남긴다(중복 주입 차단).
                data-coach: 코치마크 투어의 앵커(BeginnerTour.COACH_ANCHORS). */}
            <div className="flex-shrink-0" data-coach="beginner-ask">
              <BeginnerFirstAsk ask={ask} />
            </div>

            {/* ★S4: 진행상황을 별도 탭이 아니라 챗 바로 위에 그린다. */}
            <div className="flex-shrink-0" data-coach="beginner-live">
              <BeginnerLiveStrip
                sentAt={ask.deliveredAt}
                onResend={() => void ask.resend()}
                resending={ask.sending}
              />
            </div>

            {/* 풀스크린 오케챗 — 실 PTY 그대로. */}
            <section
              data-coach="beginner-chat"
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#313244] bg-[#181825]"
            >
              <div className="flex flex-shrink-0 items-baseline gap-2 border-b border-[#313244] px-3 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7f849c]">
                  {t("beginner.chat.title")}
                </span>
                <span className="truncate text-[11px] text-[#585b70]">
                  {t("beginner.chat.hint")}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <OrchestratorPanel fill />
              </div>
            </section>
          </>
        )}
      </main>

      {/* 첫 실행 코치마크 투어. 앵커(챗·첫요청·라이브·모드전환)가 실제로 그려진
          뒤에만 뜨고, 다른 오버레이와는 겹치지 않는다. 재노출 규칙은
          lib/coachmark 가 든다(완주/다시보지않기 = 끝, 그냥 닫으면 3회까지). */}
      <BeginnerTour
        ready={cliReady && hasFolder}
        blocked={!!promotion || showDemo}
      />

      {promotion && (
        <BeginnerPromotionModal
          trigger={promotion}
          completedTasks={completedTasks}
          onPromote={() => goAdvanced(promotion)}
          onLater={() => setPromotion(null)}
        />
      )}

      {showDemo && (
        <DemoMode
          surface="beginner_connect"
          onClose={closeDemo}
          onConnect={closeDemo}
        />
      )}
    </div>
  );
}
