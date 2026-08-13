import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import OrchestratorPanel from "../orchestrator/OrchestratorPanel";
import { DemoMode, DEMO_CONNECT_PENDING_KEY } from "../onboarding/DemoMode";
import { FundingGuideHost } from "../onboarding/FundingGuideHost";
import { OnrampGateHost } from "../onboarding/OnrampGateHost";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useBeginnerAsk } from "../../hooks/useBeginnerAsk";
import { useBeginnerDetail } from "../../hooks/useBeginnerDetail";
import { useCliSetupEngine } from "../../hooks/useCliSetupEngine";
import {
  beginnerComposerMode,
  shouldPromote,
  type PromotionTrigger,
} from "../../lib/beginnerMode";
import { findAgentPtySessionId } from "../../lib/agentTerminal";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { useAgentStore } from "../../stores/agentStore";
import { useBeginnerModeStore } from "../../stores/beginnerModeStore";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { connectFolder } from "../../services/cliSetupActions";
import telemetry from "../../services/telemetryService";
import { BeginnerAgentsPane } from "./BeginnerAgentsPane";
import { BeginnerAgentTerminalModal } from "./BeginnerAgentTerminalModal";
import { BeginnerChatBar } from "./BeginnerChatBar";
import { BeginnerConnectStep } from "./BeginnerConnectStep";
import { BeginnerLiveStrip } from "./BeginnerLiveStrip";
import { BeginnerOneClickModal } from "./BeginnerOneClickModal";
import { BeginnerPromotionModal } from "./BeginnerPromotionModal";
import { BeginnerTaskModal } from "./BeginnerTaskModal";
import { BeginnerTour } from "./BeginnerTour";
import { OnboardingPreviewBanner } from "./OnboardingPreviewBanner";
import { PrivacyConsentGate } from "../legal/PrivacyConsentGate";
import { TrainingConsentCard } from "../legal/TrainingConsentCard";
import { PrivacyClarificationNotice } from "../legal/PrivacyClarificationNotice";
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  SURFACE,
  SectionLabel,
} from "./beginnerUi";

/**
 * 비기너 셸 — **가벼운 2페인 워크스페이스** (설계: v3/docs/BEGINNER-MODE-DESIGN.md).
 *
 * 사이드바·15개 탭·워크트리·Activity·에이전트 터미널 열을 **렌더하지 않는다.**
 * 상태를 지우는 게 아니라 그리지 않을 뿐이라, 승격하면 워크스페이스 셸이 자기
 * persist 값 그대로 복원된다.
 *
 * ★레이아웃이 한 번 바뀌었다(시연 피드백). 종전은 "큰 챗 하나 + 위에 얹힌 작은
 * 스트립" 이었는데, 실제로 써 보니 세 가지가 걸렸다:
 *
 *   ① 상단 입력이 **일회성**이었다 — 첫 요청이 전달되면 입력칸째 사라져서, 오케에게
 *      이어서 말할 곳이 없었다. 사장님은 그 자리를 "오케 터미널과 연결된 대화창"
 *      으로 생각하고 계셨다. → `BeginnerChatBar`(항상 살아 있는 컴포저).
 *   ② 미니 보드가 눌리지 않았다 → 카드 클릭 → `BeginnerTaskModal`.
 *   ③ 오케 영역이 낮았고, "누가 뭐하나" 는 도넛 요약 한 덩이가 전부였다
 *      → 하단을 **가로 2분할**로 키운다: 왼쪽 오케 대화창 / 오른쪽 에이전트.
 *
 * 그래서 이 화면은 이제 '채팅 + 작은 스트립' 이 아니라 가벼운 워크스페이스다.
 * 다만 어드밴스드와의 경계는 그대로다 — 워크트리·diff·티켓별 모델 지정은 여전히
 * 없다(미니 보드 카드는 `compact`, 오케 헤더는 `hideModelControls`). 오케가 어떤
 * 모델로 뜰지 자체는 예외다(티켓 cmp95TVin64IIlOiFlAC) — `showConnectedModelPicker`
 * 가 연결·인증된 하네스만 남긴 단순 드롭다운 하나로 되살린다.
 *
 * ★오케 대화창은 `OrchestratorPanel fill` **그대로**다. 오케는 이미 실 PTY 를
 * 태운 대화창이므로 새 챗 프로토콜을 만들지 않는다(PTY 재배선 0). 상단 컴포저도
 * 같은 라우팅(`useBeginnerAsk` → `routeInstructionToOrchestrator`)을 타므로, 두
 * 입력칸은 같은 곳으로 흘러간다.
 *
 * ★`useAppLifecycle()` 은 여기서도 동일하게 마운트해야 한다 — 오케 자동기동·
 * 에이전트 재접속·세션 복원·비용 기록이 전부 그 훅에 있어서, 빼면 비기너 유저의
 * 오케가 아예 안 뜬다. `useCliSetupEngine` 도 창당 정확히 한 번 필요하다(프로브·
 * 자동설치·로그인 자동재확인·`marblo:cli-auth-ready`). 워크스페이스 셸의
 * CliSetupHost 와 동시에 마운트되는 일은 없다 — 셸은 둘 중 하나만 뜬다.
 */
/**
 * CLI 설정 엔진을 도는 **자리**. 컴포넌트로 뽑은 이유는 딱 하나 — 온보딩
 * 프리뷰(시연)일 때 이 훅을 아예 마운트하지 않기 위해서다.
 *
 * 엔진의 첫 이펙트는 프로브에 이어 **백그라운드 자동설치**를 돈다. 프리뷰의 계약이
 * "실제 설치·인증을 건드리지 않는다" 이므로, 시연을 켠 것 때문에 진짜 셸
 * 인스톨러가 도는 일은 없어야 한다. 훅은 조건부로 부를 수 없으니 마운트를
 * 조건부로 만든다.
 *
 * 프리뷰를 끄면 이 자리가 다시 서고(혹은 어드밴스드 셸의 CliSetupHost 가 선다)
 * 엔진이 평소대로 한 번 돈다 — 창당 하나라는 규칙은 그대로다.
 */
function CliSetupEngineHost() {
  // "설정이 필요하다" 는 요청은 연결 게이트가 `ready` 로 직접 판정하므로 핸들러는
  // 의도적으로 no-op 이다(모달도 배너도 띄우지 않는다).
  const noop = useCallback(() => {}, []);
  useCliSetupEngine({ openAt: noop });
  return null;
}

export function BeginnerShell() {
  const { t } = useTranslation();

  // 워크스페이스 셸과 같은 라이프사이클. 여기서 구조분해한 값은 안 쓰지만 훅
  // 자체의 부수효과(오케 자동기동 등)가 목적이다.
  useAppLifecycle();

  // ★온보딩 게이트가 읽는 값은 뷰모델 하나로 모은다 — 실제 상태와 온보딩
  // 프리뷰(개발/시연용 fresh-user 시뮬)가 여기서 갈린다. 프리뷰 시뮬이 끝나면
  // (`done`) 이 값들은 다시 실제 상태로 흘러가므로, 토글을 끄는 걸 잊어도
  // 사용자가 가짜 화면에 갇히지 않는다.
  const setup = useOnboardingSetup();
  // ★프리뷰는 **개발/시연 도구**다. 이 셸에 들어와 있다는 사실 자체가 계측되면
  // 안 된다: 프리뷰를 켜는 사람은 이미 어드밴스드 유저라, 비기너 진입/첫완료/
  // 승격 이벤트가 퍼널의 분모·분자를 그대로 오염시킨다.
  const previewEnabled = useOnboardingPreviewStore((s) => s.enabled);
  const setPreviewEnabled = useOnboardingPreviewStore((s) => s.setEnabled);
  const cliReady = setup.ready;
  // 첫 실행 샘플 폴더 자동 연결(#872)의 진행 상태 — 폴더 게이트가 이걸 읽어
  // "준비 중" 을 그린다(아래 렌더 주석 참조).
  const sampleStatus = setup.sampleStatus;
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id ?? "";
  // ★프리뷰 중에는 "폴더 없음" 으로 그린다 — 실제 프로젝트를 끊지 않고 폴더
  // 게이트(샘플 자동연결)를 재생하기 위한 것이다. 시뮬이 끝나면 실제 값으로.
  const hasFolder = setup.preview ? false : !!currentProject?.folderPath;

  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);
  // 에이전트 터미널의 PTY 세션 원장. 어드밴스드 에이전트 탭이 읽는 것과 **같은**
  // 스토어다 — 비기너가 여는 터미널은 그 탭이 여는 것과 같은 세션이어야 한다.
  const terminalSessions = useTerminalStore((s) => s.sessions);

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
  // ★대화창 입력 문자열을 셸이 든다. 미니 보드/에이전트 패널의 "오케에게
  // 물어보기" 가 이 칸을 채우기 때문이다 — 상태가 컴포저 안에 갇혀 있으면 그
  // 프리필이 닿지 못한다.
  const [draft, setDraft] = useState("");
  // ★미니 보드/에이전트에서 연 상세 오버레이. 선택 상태와 재조회 규칙은 훅이
  // 든다(`useBeginnerDetail`) — 셸이 직접 들고 있던 시절에는 회귀 테스트가 그
  // 로직을 손으로 베낄 수밖에 없었고, 베낀 쪽만 맞아도 테스트는 초록이었다.
  const detail = useBeginnerDetail({ tasks, agents, projectId });
  const {
    openTask,
    openAgent,
    openTaskDetail,
    closeTaskDetail,
    openAgentTerminal,
    closeAgentTerminal,
  } = detail;
  const [showDemo, setShowDemo] = useState(false);
  // ★원클릭 모달을 **셸**이 든다. 연결 게이트 안에 두면 인증이 성립하는 순간
  // 게이트가 폴더 게이트로 갈아치워지면서 모달째 언마운트돼, "연결됐어요" 가
  // 뜨자마자 사라진다(시연에서 화면이 뚝 끊기는 자리).
  const [showOneClick, setShowOneClick] = useState(false);
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
    if (previewEnabled || enteredReported) return;
    markEnteredReported();
    telemetry.beginnerEntered(entryReason);
  }, [previewEnabled, enteredReported, markEnteredReported, entryReason]);

  // ★첫 완료 계측 — 설치당 한 번. 스토어가 멱등성을 보장하고(이미 기록됐으면
  // null), 경과는 클라가 계산해 싣는다(서버 timestamp 는 수신시각이라 단계
  // 지연을 못 구한다 — 진단 §3).
  useEffect(() => {
    if (previewEnabled || firstCompletionAt || completedTasks === 0) return;
    const durationMs = markFirstCompletion();
    if (durationMs !== null) telemetry.beginnerFirstCompletion(durationMs);
  }, [previewEnabled, completedTasks, firstCompletionAt, markFirstCompletion]);

  // 승격 트리거. mergedTasks 는 아직 0 이 흐른다(설계 §9 F1: merge_history 구독이
  // App.tsx 안에 있고 스토어가 없어, 여기서 끌어오면 두 번째 구독이 생긴다).
  // 완료 건수·사용 일수 트리거가 그 자리를 메운다.
  useEffect(() => {
    if (previewEnabled || promotionShownAt || promotion) return;
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
    previewEnabled,
    completedTasks,
    enteredAt,
    promotionShownAt,
    promotion,
    markPromotionShown,
  ]);

  const goAdvanced = useCallback(
    (trigger: PromotionTrigger | "manual") => {
      // ★프리뷰 중의 "개발 모드로" 는 **승격이 아니라 프리뷰 종료**다. 프리뷰를
      // 켠 사람은 이미 어드밴스드라, 여기서 promote 를 부르면 비기너 기록과
      // 승격 계측만 더럽히고 정작 화면은 (App 이 프리뷰를 보고 있으므로) 안
      // 바뀐다.
      if (previewEnabled) {
        setPromotion(null);
        setPreviewEnabled(false);
        return;
      }
      telemetry.beginnerPromoted(trigger, trigger === "manual");
      setPromotion(null);
      promote(trigger);
    },
    [previewEnabled, setPreviewEnabled, promote],
  );

  // 에이전트 터미널 모달의 헤더가 쓰는 담당 티켓. 세션 짝짓기 규칙은 어드밴스드
  // 에이전트 탭과 공유한다 — `lib/agentTerminal`.
  const openAgentTask = useMemo(
    () =>
      openAgent?.currentTaskId
        ? (tasks.find((x) => x.id === openAgent.currentTaskId) ?? null)
        : null,
    [openAgent, tasks],
  );
  const openAgentSessionId = useMemo(
    () =>
      openAgent
        ? findAgentPtySessionId(terminalSessions, openAgent.name)
        : undefined,
    [openAgent, terminalSessions],
  );

  // 티켓 상세의 "오케에게 물어보기" — 문장을 대화창에 **채우기만** 한다. 대신
  // 보내 주면 유저가 무엇이 나갔는지 모른 채 오케가 움직이고, 문장을 고칠 기회도
  // 없다. 심플 모드라도 마지막 한 번은 유저가 누르는 게 맞다.
  // ★대화가 시작된 뒤 상단 컴포저는 접혀 있는데, 이 프리필이 그것을 되살린다
  // (규칙: shouldShowBeginnerComposer 의 draft 예외). 프리필이 갈 곳이 아래
  // 오케 PTY 에는 없어서다 — 터미널에 남의 문장을 몰래 타이핑할 수는 없다.
  const askAboutTask = useCallback((message: string) => setDraft(message), []);
  const dismissComposer = useCallback(() => setDraft(""), []);

  // ★상단 컴포저를 지금 그릴 것인가, 어떤 얼굴로 — 규칙은 순수함수가 든다
  // (lib/beginnerMode). 첫 마디 전에는 여기가 대화창, 그 뒤로는 아래 오케
  // 대화창 하나뿐이고, 티켓 프리필만 예외로 잠깐 되살린다.
  const composerMode = beginnerComposerMode({
    sentCount: ask.sentCount,
    totalTasks: tasks.length,
    draft,
  });

  // 안정적인 identity — 모달의 자동 닫힘 타이머가 이 콜백에 걸려 있다.
  const openOneClick = useCallback(() => setShowOneClick(true), []);
  const closeOneClick = useCallback(() => setShowOneClick(false), []);

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
      {/* 이 셸에는 CliSetupHost(배너)가 없다 — 엔진은 여기서 한 번만 돈다.
          프리뷰 중에는 아예 마운트하지 않는다(위 주석: 자동설치 금지). */}
      {!previewEnabled && <CliSetupEngineHost />}

      {/* 온보딩 프리뷰(개발/시연)가 켜져 있을 때만 뜨는 띠 — 지금 보이는 화면이
          시뮬이라는 사실과 그 자리에서의 탈출구를 항상 들고 있는다. */}
      <OnboardingPreviewBanner />

      {/* ── 최소 상단바. 프로젝트 스위처·비용·탭은 일부러 없다. ──────────────
          ★어드밴스드 셸의 `Header` 와 같은 규격이다: h-12, 창 드래그 영역,
          왼쪽 아이덴티티 / 오른쪽 액션. 예전엔 높이도(py-2) 버튼 높이도 제각각인
          한 줄에 넷이 나란히 서서 무엇이 주 액션인지 읽히지 않았다. */}
      <header
        className="flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-[#313244] bg-[#181825] px-4"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="shrink-0 text-sm font-semibold tracking-tight text-[#cdd6f4]">
          Marblo
        </span>

        {/* 폴더는 "상태 + 바꾸기" 를 한 칩으로 합친다 — 이름 텍스트와 버튼이
            따로 서서 폭을 먹던 자리다. */}
        <div
          className="flex min-w-0 flex-1 items-center"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* ★프리뷰 중에는 네이티브 폴더 피커를 열지 않는다 — 여기서 폴더를
              고르면 진짜 프로젝트가 바뀐다(프리뷰의 계약은 '실제 상태 미변경'). */}
          <button
            type="button"
            data-testid="beginner-open-folder"
            onClick={setup.preview ? undefined : connectFolder}
            disabled={setup.preview}
            title={
              setup.preview
                ? t("beginner.preview.folderLocked")
                : hasFolder
                  ? t("beginner.topbar.changeFolder")
                  : t("beginner.topbar.openFolder")
            }
            className="inline-flex h-7 min-w-0 max-w-[22rem] items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-[#a6adc8] transition-colors hover:border-[#313244] hover:bg-[#313244]/60 hover:text-[#cdd6f4] disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent"
          >
            <span aria-hidden className="shrink-0 text-[#6c7086]">
              ▸
            </span>
            <span className="truncate">
              {setup.preview
                ? t("beginner.preview.sampleFolder")
                : currentProject?.name || t("beginner.topbar.noFolder")}
            </span>
          </button>
        </div>

        <div
          className="flex shrink-0 items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
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
            className={BUTTON_GHOST}
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
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2.5 text-xs font-medium text-[#89b4fa] transition-colors hover:border-[#89b4fa] hover:bg-[#89b4fa]/20"
          >
            <span aria-hidden className="font-mono text-[10px]">
              {"</>"}
            </span>
            {t("beginner.topbar.advanced")}
          </button>
        </div>
      </header>

      {/* 위→아래 흐름(대화 → 일감 → 하단 2페인)은 그대로 두되, 폭 상한은
          68rem → 96rem 으로 연다. 68rem 은 한 열짜리 화면의 가독 폭이었는데,
          하단이 2분할이 된 지금 그 폭이면 오케 터미널이 좁아져 TUI 가 접힌다.
          상한 자체는 남긴다 — 27" 에서 카드가 끝까지 벌어지면 다시 성겨진다. */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="mx-auto flex min-h-0 w-full max-w-[96rem] flex-1 flex-col gap-2.5 overflow-hidden">
          {!cliReady ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <BeginnerConnectStep
                onWatchDemo={() => setShowDemo(true)}
                onOneClick={openOneClick}
              />
            </div>
          ) : !hasFolder ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <section
                data-testid="beginner-folder-gate"
                data-sample-status={sampleStatus}
                className={`mx-auto w-full max-w-xl ${SURFACE} px-6 py-7 text-center`}
              >
                {/* ★자동 연결(#872)이 도는 중에는 "폴더를 골라 주세요" 를 그리지
                    않는다. 1~2초 뒤 스스로 붙을 폴더인데 그 사이 유저가 네이티브
                    피커를 열면, 자동 연결이 뒤늦게 도착해 화면이 튄다. */}
                <h1 className="text-lg font-semibold leading-7 text-[#cdd6f4]">
                  {t(
                    sampleStatus === "preparing"
                      ? "beginner.folder.preparingTitle"
                      : "beginner.folder.title",
                  )}
                </h1>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-[#7f849c]">
                  {t(
                    sampleStatus === "preparing"
                      ? "beginner.folder.preparingBody"
                      : "beginner.folder.body",
                  )}
                </p>
                {sampleStatus === "preparing" ? (
                  <div
                    data-testid="beginner-folder-preparing"
                    className="mx-auto mt-5 h-1.5 w-48 overflow-hidden rounded-full bg-[#313244]"
                  >
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-[#89b4fa]" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={connectFolder}
                    className={`mt-5 ${BUTTON_PRIMARY}`}
                  >
                    {t("beginner.folder.cta")}
                  </button>
                )}
                {sampleStatus === "failed" && (
                  <p className="mt-3 text-xs leading-5 text-[#f9e2af]">
                    {t("beginner.folder.sampleFailed")}
                  </p>
                )}
              </section>
            </div>
          ) : (
            <>
              {/* ★첫 대화창 — 첫 마디가 오케에게 닿으면 접힌다. 아래 오케
                  대화창(실 PTY)과 입력칸이 둘이면 유저는 매번 "어디에 쓰냐" 를
                  고르게 되고, 그건 심플 모드가 없애려던 종류의 선택이다.
                  티켓 상세의 "물어보기" 가 문장을 채워 주면 다시 나타난다.
                  data-coach: 코치마크 투어의 앵커(BeginnerTour.COACH_ANCHORS).
                  ★접혀 있으면 앵커도 함께 사라지는데, 코치마크는 없는 앵커의
                  스텝을 알아서 건너뛴다(CoachmarkOverlay.resolveSteps). */}
              {composerMode !== "hidden" && (
                <div className="flex-shrink-0" data-coach="beginner-ask">
                  <BeginnerChatBar
                    ask={ask}
                    draft={draft}
                    onDraftChange={setDraft}
                    mode={composerMode}
                    // 첫 국면(이 칸이 화면의 목적)에는 치우기를 주지 않는다.
                    onDismiss={
                      composerMode === "followUp" ? dismissComposer : undefined
                    }
                  />
                </div>
              )}

              {/* ★S4: 진행상황을 별도 탭이 아니라 대화창 바로 아래에 그린다.
                  ★높이 상한(34%)은 하단 2페인을 지키기 위한 것이다. 티켓이 대여섯
                  건 쌓이면 미니 보드는 얼마든지 자라는데, 그걸 그대로 두면 예전처럼
                  오케 영역이 아래로 밀려 납작해진다(시연 피드백 ③). 넘치는 만큼은
                  이 칸 안에서 스크롤한다. */}
              <div
                className="min-h-0 shrink overflow-y-auto max-h-[34%]"
                data-coach="beginner-live"
              >
                <BeginnerLiveStrip
                  sentAt={ask.deliveredAt}
                  onResend={() => void ask.resend()}
                  resending={ask.sending}
                  onTaskClick={openTaskDetail}
                />
              </div>

              {/* ── ★하단 2분할: 오케 대화창 | 에이전트 ──────────────────────
                  좁은 창(<1024px)에서는 세로로 쌓는다 — 두 열을 억지로 유지하면
                  오케 터미널이 40컬럼 아래로 눌려 TUI 가 접힌다. */}
              <div className="flex min-h-[18rem] flex-1 flex-col gap-2.5 overflow-hidden lg:flex-row">
                <section
                  data-coach="beginner-chat"
                  className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${SURFACE}`}
                >
                  <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#313244] px-4 py-2">
                    <SectionLabel>{t("beginner.chat.title")}</SectionLabel>
                    <span className="min-w-0 truncate text-[11px] text-[#585b70]">
                      {t("beginner.chat.hint")}
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {/* ★effort·버전 배지·세션 선택은 계속 감춘다(고급 손잡이).
                        모델만은 예외다(티켓 cmp95TVin64IIlOiFlAC) — 표준 오케 헤더에
                        있던 걸 심플에만 없애 둔 게 비대칭이었다. `showConnectedModelPicker`
                        가 목록을 설치+인증이 확인된 하네스로만 좁혀서, 고르는 순간 스폰이
                        막히는 선택지를 애초에 보여주지 않는다(비기너 화면엔 그 실패를
                        설명할 자리가 없다). */}
                    <OrchestratorPanel
                      fill
                      hideModelControls
                      showConnectedModelPicker
                    />
                  </div>
                </section>

                {/* ★에이전트 열 — "누가 뭐하나". 세로 스택일 땐 높이를 묶어
                    오케가 화면 밖으로 밀리지 않게 한다. */}
                <section
                  data-testid="beginner-agents-pane"
                  className={`flex max-h-[14rem] min-h-0 flex-col overflow-hidden lg:max-h-none lg:w-[19rem] lg:shrink-0 ${SURFACE}`}
                >
                  <BeginnerAgentsPane
                    agents={agents}
                    tasks={tasks}
                    onTaskClick={openTaskDetail}
                    onAgentClick={openAgentTerminal}
                  />
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      {/* 첫 실행 코치마크 투어. 앵커(챗·첫요청·라이브·모드전환)가 실제로 그려진
          뒤에만 뜨고, 다른 오버레이와는 겹치지 않는다. 재노출 규칙은
          lib/coachmark 가 든다(완주/다시보지않기 = 끝, 그냥 닫으면 3회까지). */}
      <BeginnerTour
        ready={cliReady && hasFolder}
        blocked={
          !!promotion || showDemo || showOneClick || !!openTask || !!openAgent
        }
      />

      {showOneClick && <BeginnerOneClickModal onClose={closeOneClick} />}

      {/* ★"로그인은 됐는데 아무 일도 안 일어나요" — 구독/크레딧이 없어 CLI 가 한
          턴도 못 도는 상태의 가이드(티켓 sVdwTsiGq6qZVAmSkwZB). 원클릭 모달이
          "연결됐어요" 를 띄우고 닫힌 **뒤에** 벌어지는 일이라 셸이 든다. 판정이
          없거나 정상이면 이 호스트는 아무것도 그리지 않는다.

          원클릭 모달과는 배타다(이 파일의 다른 모달들과 같은 규칙). 구독 없는
          계정은 프로브가 **빨리** 실패하므로, 가드가 없으면 원클릭 모달이 성공
          문구를 1.6초 보여주는 그 위에 이 모달이 겹쳐 뜬다 — 두 개가 겹치면
          Esc 한 번이 어느 쪽을 닫는지 알 수 없다. 원클릭은 인증되면 스스로
          닫히므로 이 안내는 곧바로 이어서 뜬다. */}
      {!showOneClick && <FundingGuideHost />}

      {/* ★M1 — "여기까지는 무료로 볼 수 있어요"(온램프 #886 §5-A). 지금까지 이
          셸은 스폰 차단(`needsAuth`)을 해석하는 화면 목록에 아예 없어서, L0
          유저가 실행을 눌러도 화면에 **아무 일도** 일어나지 않았다.
          원클릭 모달과 배타인 이유는 위 자금 안내와 같다. M2(자금)와의 배타는
          호스트가 스스로 판정한다 — 두 모달이 서로 반대되는 지시를 준다. */}
      {!showOneClick && (
        <OnrampGateHost variant="beginner" onConnect={openOneClick} />
      )}

      {/* 미니 보드/에이전트에서 연 티켓 상세 — 비기너 판. 정보는 보드 상세와
          같고(목표·변경·완료기준·범위·선행 일감·진행 기록), 워크트리·diff·PR·
          모델·상태머신 손잡이만 빠진다. `tasks` 는 선행 일감을 id 가 아니라
          제목으로 그리기 위한 것. */}
      {openTask && (
        <BeginnerTaskModal
          task={openTask}
          agents={agents}
          tasks={tasks}
          onAsk={askAboutTask}
          onClose={closeTaskDetail}
        />
      )}

      {/* ★에이전트 패널에서 연 터미널 — 어드밴스드와 같은 PTY, 같은 TerminalView. */}
      {openAgent && (
        <BeginnerAgentTerminalModal
          agent={openAgent}
          task={openAgentTask}
          sessionId={openAgentSessionId}
          onClose={closeAgentTerminal}
        />
      )}

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

      {/* ★동의 게이트 — 심플 모드에도 있어야 한다(ticket QFNrT4Z4dG9nGoRYmTlr).
          이 게이트는 모달만 띄우는 컴포넌트가 아니라 **동의 파이프라인 자체**다:
            ① 가입 전 FirstRunFlow 가 로컬에 park 한 동의 답을 uid 가 생기는
               순간 Firestore 로 flush 하고,
            ② 동의 레코드를 읽어 store 를 채우며,
            ③ 그 값으로 Sentry·1차 텔레메트리 게이트를 구동한다.
          심플 셸은 GlobalOverlays 를 마운트하지 않으므로 지금까지 이 셋이 전부
          돌지 않았다 — 심플로 시작한 사용자의 동의가 서버에 기록되지 않고(park 만
          남아 있다가 승격 후에야 flush), 그 사이 동의 상태를 읽는 어떤 화면도
          "모름" 으로 남는다. 어드밴스드와 같은 컴포넌트를 그대로 건다(셸이
          배타적이라 이중 마운트는 없다). */}
      <PrivacyConsentGate />

      {/* ★학습데이터 기여 옵트인 — 어드밴스드 셸(GlobalOverlays)과 **같은**
          컴포넌트다. 심플 모드는 GlobalOverlays 를 마운트하지 않으므로 여기서
          직접 건다. 동의 표면이 한쪽 모드에만 있으면 "심플로 시작한 사람은
          평생 못 본다" 가 되고, 그건 동의 설계로서 결함이다.
          자기 판정으로만 뜨는 비차단 코너 카드라 위 모달들과 겹치지 않는다
          (PIPA 모달이 떠 있는 동안·연결 전에는 스스로 렌더하지 않는다). */}
      <TrainingConsentCard />

      {/* ★처리방침 1회성 명확화 고지 — 어드밴스드 셸(GlobalOverlays)과 **같은**
          컴포넌트다. 고지 표면이 한쪽 모드에만 있으면 "심플로 쓰는 사람은 못
          본다" 가 되고, 고지로서 결함이다. 동의를 받지 않는 배너라 위 모달들과
          경쟁하지 않는다(PIPA 모달이 떠 있는 동안은 스스로 렌더하지 않는다). */}
      <PrivacyClarificationNotice />
    </div>
  );
}
