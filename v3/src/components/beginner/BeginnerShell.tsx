import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import OrchestratorPanel from "../orchestrator/OrchestratorPanel";
import { VideoDemoModal } from "../onboarding/VideoDemoModal";
import { FundingGuideHost } from "../onboarding/FundingGuideHost";
import { OnrampGateHost } from "../onboarding/OnrampGateHost";
import { FirstSpawnGuide } from "../onboarding/FirstSpawnGuide";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useBeginnerAsk } from "../../hooks/useBeginnerAsk";
import { useBeginnerDetail } from "../../hooks/useBeginnerDetail";
import { useCliSetupEngine } from "../../hooks/useCliSetupEngine";
import {
  shouldPromote,
  shouldRenderOnboardingGuides,
  type PromotionTrigger,
} from "../../lib/beginnerMode";
import { findAgentPtySessionId } from "../../lib/agentTerminal";
import { getSessionIdForAgent } from "../../stores/agentSessionMap";
import { AgentInputWaitHost } from "../agents/AgentInputWaitHost";
import {
  BEGINNER_CHAT_TAB,
  BEGINNER_CURATED_TABS,
  type BeginnerCuratedTabId,
  type BeginnerTabId,
} from "../../lib/beginnerTabs";
import { normalizeProjectKind } from "../../lib/projectKind";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { useAgentStore } from "../../stores/agentStore";
import { useBeginnerModeStore } from "../../stores/beginnerModeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useTaskStore } from "../../stores/taskStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useUiStore } from "../../stores/uiStore";
import { connectFolder } from "../../services/cliSetupActions";
import telemetry from "../../services/telemetryService";
import { BeginnerAgentsPane } from "./BeginnerAgentsPane";
import { BeginnerAgentTerminalModal } from "./BeginnerAgentTerminalModal";
import { BeginnerConnectStep } from "./BeginnerConnectStep";
import { BeginnerLiveStrip } from "./BeginnerLiveStrip";
import { BeginnerOneClickModal } from "./BeginnerOneClickModal";
import { BeginnerPromotionModal } from "./BeginnerPromotionModal";
import { BeginnerTabBar } from "./BeginnerTabBar";
import { BeginnerTour } from "./BeginnerTour";
import { OnboardingPreviewBanner } from "./OnboardingPreviewBanner";
// ★큐레이트 탭 — 엑스퍼트 탭 컴포넌트를 **그대로** 태운다(재구현 0). 하네스만
// 얇은 래퍼를 거치는데, 그것도 props 를 안 주기 위한 것이다(아래 주석).
// 근거·비노출 목록은 lib/beginnerTabs.
import { GuideTab } from "../guide/GuideTab";
import { StartHereTab } from "../onboarding/StartHereTab";
import { CodeTab } from "../tabs/CodeTab";
import { AgentsTab } from "../tabs/AgentsTab";
import { WorktreeTab } from "../tabs/WorktreeTab";
import { HarnessStore } from "../harness/HarnessStore";
import { UsagePage } from "../usage/UsagePage";
import { SettingsPage } from "../settings/SettingsPage";
import { PrivacyConsentGate } from "../legal/PrivacyConsentGate";
import { TrainingConsentCard } from "../legal/TrainingConsentCard";
import { PrivacyClarificationNotice } from "../legal/PrivacyClarificationNotice";
import { Sidebar } from "../sidebar/Sidebar";
import {
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  SURFACE,
  SectionLabel,
} from "./beginnerUi";
import { TaskDetailModal } from "../board/TaskDetailModal";
import type { Agent } from "../../types/agent";

/**
 * 비기너 셸 — **가벼운 2페인 워크스페이스** (설계: v3/docs/BEGINNER-MODE-DESIGN.md).
 *
 * 사이드바·15개 탭·Activity·에이전트 터미널 열을 **렌더하지 않는다.**
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
 * 다만 **이 대화 탭 안에서의** 경계는 그대로다 — diff·티켓별 모델 지정은 여전히
 * 없다(미니 보드 카드는 `compact`, 오케 헤더는 `hideModelControls`). 워크트리는
 * 이 화면이 아니라 큐레이트 탭으로 닿는다(lib/beginnerTabs). 오케가 어떤
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

/**
 * ★하네스는 `onClose` 를 주면 **모달**로 그린다(HarnessStore.isModal). 탭 자리에
 * 모달 크롬이 서면 닫기 버튼이 탭 안에서 아무 데도 못 가므로, 엑스퍼트 탭바와
 * 똑같이 인라인으로 태운다 — WorkTabs.HarnessTabPanel 과 같은 래퍼다. 거기서
 * import 하지 않는 이유는 WorkTabs 가 보드·플로우 등 엑스퍼트 탭 **전부**를
 * 끌고 오기 때문이다(심플 셸이 태우지 않기로 한 그 화면들).
 */
function HarnessTabPanel() {
  return <HarnessStore />;
}

/** 큐레이트 탭 id → 엑스퍼트 컴포넌트. 일곱 다 props 가 없다. */
const CURATED_TAB_COMPONENTS: Record<BeginnerCuratedTabId, () => JSX.Element> =
  {
    startHere: StartHereTab,
    guide: GuideTab,
    code: CodeTab,
    // 에이전트 **관리**(정지·재시작·삭제) — 인라인 BeginnerAgentsPane 은 읽기
    // 전용 요약이라 이 화면을 대신하지 못한다.
    agents: AgentsTab,
    worktrees: WorktreeTab,
    usage: UsagePage,
    // ★심플 모드에서 GitHub·텔레그램·슬랙 연결의 진입점.
    harness: HarnessTabPanel,
    settings: SettingsPage,
  };

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
  // kind 는 데이터 속성·계측용. 심플 셸 탭 구성은 kind 와 무관(대화 기본) —
  // 여기서 분기해 탭을 바꾸지 않는다(BeginnerShell 핫스팟, union-safe).
  const projectKind = normalizeProjectKind(currentProject?.kind);
  // ★프리뷰 중에는 "폴더 없음" 으로 그린다 — 실제 프로젝트를 끊지 않고 폴더
  // 게이트(샘플 자동연결)를 재생하기 위한 것이다. 시뮬이 끝나면 실제 값으로.
  const hasFolder = setup.preview ? false : !!currentProject?.folderPath;

  const subscribeToTasks = useTaskStore((s) => s.subscribeToTasks);
  const subscribeToAgents = useAgentStore((s) => s.subscribeToAgents);
  const tasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);
  // 에이전트 탭/패널에는 **워커만**. 오케는 왼쪽 대화창(OrchestratorPanel)이
  // 전담한다 — 어드밴스드 AgentListPanel 과 같은 role 필터. 오케를 목록에 두면
  // "팀원 끄기" 대상처럼 보이고, 터미널 모달도 워커용 경로로 엉뚱하게 열린다.
  const workerAgents = useMemo(
    () => agents.filter((a) => a.role !== "orchestrator"),
    [agents]
  );
  // 에이전트 터미널의 PTY 세션 원장. 어드밴스드 에이전트 탭이 읽는 것과 **같은**
  // 스토어다 — 비기너가 여는 터미널은 그 탭이 여는 것과 같은 세션이어야 한다.
  const terminalSessions = useTerminalStore((s) => s.sessions);
  // 팀원 끄기(심플 모드) — 어드밴스드 목록의 닫기와 같은 초크포인트를 쓴다.
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const closeTerminalSession = useTerminalStore((s) => s.closeSession);

  const enteredAt = useBeginnerModeStore((s) => s.enteredAt);
  const entryReason = useBeginnerModeStore((s) => s.entryReason);
  const enteredReported = useBeginnerModeStore((s) => s.enteredReported);
  const markEnteredReported = useBeginnerModeStore(
    (s) => s.markEnteredReported
  );
  const firstCompletionAt = useBeginnerModeStore((s) => s.firstCompletionAt);
  const markFirstCompletion = useBeginnerModeStore(
    (s) => s.markFirstCompletion
  );
  const promotionShownAt = useBeginnerModeStore((s) => s.promotionShownAt);
  const markPromotionShown = useBeginnerModeStore((s) => s.markPromotionShown);
  const promote = useBeginnerModeStore((s) => s.promote);
  const fileTreeOpen = useSplitWorkspaceStore((s) => s.fileTreeOpen);
  const toggleFileTree = useSplitWorkspaceStore((s) => s.toggleFileTree);

  const ask = useBeginnerAsk();
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
  // 모달의 "직접 고를게요" 가 눌린 횟수 — 연결 화면이 택1 섹션으로 스크롤·강조할
  // 신호다. 0 은 "아직 안 눌렸다"(첫 렌더에 스크롤이 튀지 않는다).
  const [manualFocusSignal, setManualFocusSignal] = useState(0);
  const [promotion, setPromotion] = useState<PromotionTrigger | null>(null);

  // ★큐레이트 탭 — 기본은 언제나 대화다. 나머지는 **보조 진입**이라 여기 로컬
  // 상태로 든다: persist 하면 앱을 다시 켠 사람이 설정 화면에서 시작하게 되고,
  // 그건 채팅-퍼스트를 정확히 뒤집는다. 셸이 살아 있는 동안만 기억한다.
  const [tab, setTab] = useState<BeginnerTabId>(BEGINNER_CHAT_TAB);
  // 지연 마운트 + 계속 유지. 켠 적 없는 탭은 트리에 없고(부팅 비용 그대로),
  // 한 번 켜면 언마운트하지 않는다 — 대화 탭이 여기 함께 들어 있는 게 핵심이다.
  // ★오케 대화창은 실 PTY 다. 탭을 옮길 때마다 언마운트하면 그때마다 세션을
  // 다시 붙여야 하고, 스크롤백은 그 자리에서 사라진다. 그래서 전환은 언제나
  // display:none 이지 조건부 렌더가 아니다(xterm 의 ResizeObserver 는 폭이 0인
  // 동안 fit 을 건너뛰고, 되돌아오면 실제 치수로 한 번 맞춘다 — TerminalView).
  const [mountedTabs, setMountedTabs] = useState<Set<BeginnerTabId>>(
    () => new Set<BeginnerTabId>([BEGINNER_CHAT_TAB])
  );
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  // ★"설정의 이 섹션을 열어라" 래치(uiStore) — 업그레이드 모달 CTA 등이 세운다.
  // 지금까지 심플 셸에는 설정 탭이 없어서 이 요청이 **아무 데도 도착하지 못했다**
  // (래치만 남고 화면은 그대로). 어드밴스드 셸(WorkspaceShell:151)과 같은 배선을
  // 건다 — 세부 섹션 선택·래치 소거는 SettingsPage 가 마저 한다.
  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);
  useEffect(() => {
    if (pendingSettingsSection) setTab("settings");
  }, [pendingSettingsSection]);

  // ★탭 간 점프 래치(navigationStore) — 워크트리 탭을 심플에 들이면서 필요해졌다.
  // 그 탭의 버튼 둘("코드에서 보기" → `{type:"code"}`, "티켓 보기" →
  // `{type:"task"}`)은 스스로 화면을 바꾸지 않는다. **셸이** 탭을 옮겨 주고
  // 목적지가 래치를 소거하는 구조라(어드밴스드는 WorkspaceShell:166), 소비자가
  // 없는 심플에서는 눌러도 아무 일이 안 일어나는 죽은 버튼이 된다.
  //
  // 목적지 대응은 심플에 있는 것으로만 짠다:
  //   code·worktrees → 그 큐레이트 탭
  //   task → 보드가 없으므로 **비기너 티켓 상세 모달**(미니 보드 카드와 같은 곳)
  //   agent → 에이전트 탭. 소거는 AgentsTab 이 한다(스크롤·플래시가 그 안에 있고,
  //           구독이 데이터를 줄 때까지 기다린다) — 여기서 소거하면 그 효과가
  //           영영 안 뜬다.
  // mission·missionReplay 는 심플에 목적지가 없다. 소거하지 않고 그냥 둔다 —
  // 다음 requestJump 가 덮어쓰고, 승격하면 어드밴스드가 받는다.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "code") {
      setTab("code");
      consumeJump();
    } else if (pendingJump.type === "worktrees") {
      setTab("worktrees");
      consumeJump();
    } else if (pendingJump.type === "agent") {
      setTab("agents");
    } else if (pendingJump.type === "task") {
      // 구독 스냅샷에 아직 없으면 **소거하지 않고** 기다린다(AgentsTab 과 같은
      // 규칙). 여기서 지우면 구독이 1프레임 늦은 것만으로 클릭이 증발한다.
      const target = tasks.find((x) => x.id === pendingJump.id);
      if (!target) return;
      consumeJump();
      openTaskDetail(target);
    }
  }, [pendingJump, consumeJump, tasks, openTaskDetail]);

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
    [tasks]
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
      !!promotionShownAt
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
    [previewEnabled, setPreviewEnabled, promote]
  );

  // 에이전트 터미널 모달의 헤더가 쓰는 담당 티켓. 세션 짝짓기 규칙은 어드밴스드
  // 에이전트 탭과 공유한다 — `lib/agentTerminal`.
  const openAgentTask = useMemo(
    () =>
      openAgent?.currentTaskId
        ? tasks.find((x) => x.id === openAgent.currentTaskId) ?? null
        : null,
    [openAgent, tasks]
  );
  // 이름 매칭이 1순위(어드밴스드 목록과 동일). 맵에만 있고 라벨이 아직 안
  // 잡힌 국면은 getSessionIdForAgent 로 폴백 — 원장에 그 id 가 있을 때만.
  // (맵 기본값 `agent-${id}` 를 원장 확인 없이 넘기면 빈 상태 문구 대신
  // 유령 TerminalView 가 떠 "연결 중" 과 고장을 구분 못 한다.)
  const openAgentSessionId = useMemo(() => {
    if (!openAgent) return undefined;
    const byName = findAgentPtySessionId(terminalSessions, openAgent.name);
    if (byName) return byName;
    const mapped = getSessionIdForAgent(openAgent.id);
    return terminalSessions.some((s) => s.id === mapped) ? mapped : undefined;
  }, [openAgent, terminalSessions]);

  // 입력 대기 알림 → 그 에이전트의 터미널 모달. 알림은 agentId 만 들고 오므로
  // 여기서 구독 스냅샷과 맞춰 준다. 목록에 없으면(아직 구독 전·다른 프로젝트)
  // 아무것도 열지 않는다 — 빈 터미널 모달을 띄우는 것보다 낫다.
  const openAgentTerminalById = useCallback(
    (agentId: string) => {
      const target = agents.find((a) => a.id === agentId);
      if (target) openAgentTerminal(target);
    },
    [agents, openAgentTerminal]
  );

  // ★심플 모드에서 팀원 끄기 — 어드밴스드 에이전트 목록(AgentListPanel)의
  // 닫기와 **같은 순서**로 자원을 회수한다(새 경로를 만들지 않는다):
  //   deleteAgent = agent:stop → agent:remove → 문서 삭제 → ptyMirror 회수 →
  //   결정적 `agent-<id>` 세션 closeSession.
  // 그 다음, 이 화면이 터미널 모달에서 무는 **이름 매칭** 세션도 한 번 더
  // 회수한다 — 두 id 가 갈릴 수 있어서다(closeSession 은 멱등). 확인 모달과
  // "작업 중일 때만 묻는다" 판정은 패널이 `lib/agentEntryClose` 로 든다.
  const killAgent = useCallback(
    async (agent: Agent) => {
      const sessionId = findAgentPtySessionId(terminalSessions, agent.name);
      await deleteAgent(agent.id);
      if (sessionId) {
        await closeTerminalSession(sessionId).catch(() => {
          /* 이미 detach 된 세션 — 정리할 게 없다 */
        });
      }
    },
    [closeTerminalSession, deleteAgent, terminalSessions]
  );

  // 스스로 뜨는 온보딩 안내(M1 온램프 · M2 자금)를 지금 그려도 되는가 — 규칙은
  // 순수함수가 든다. 원클릭 모달과 데모 재생은 화면 전체를 쓰는 표면이라, 그
  // 위에 안내가 겹치면 두 지시가 동시에 서고 Esc 가 어느 쪽을 닫는지 알 수 없다.
  const guidesAllowed = shouldRenderOnboardingGuides({
    oneClickOpen: showOneClick,
    demoPlaying: showDemo,
  });

  // 안정적인 identity — 모달의 자동 닫힘 타이머가 이 콜백에 걸려 있다.
  const openOneClick = useCallback(() => setShowOneClick(true), []);
  const closeOneClick = useCallback(() => setShowOneClick(false), []);

  // ★"직접 고를게요" — 닫기 **더하기** 목적지로 데려가기(티켓 k22rGEgv).
  // 수동 선택 UI 는 이미 이 모달 아래(BeginnerConnectStep 의 택1 섹션)에 있지만
  // 스크롤 접힘 밑이라, 닫기만 하면 사용자는 방금 떠나온 원클릭 CTA 를 다시 본다
  // — 콜드 테스트에서 "아무 동작 없이 창만 닫힘" 으로 보고된 그 자리다. 카운터를
  // 올려 연결 화면이 그 섹션으로 스크롤·강조하게 한다(같은 버튼을 두 번 눌러도
  // 매번 반응해야 하므로 boolean 이 아니라 단조 증가값이다).
  const chooseManually = useCallback(() => {
    setShowOneClick(false);
    setManualFocusSignal((n) => n + 1);
  }, []);

  const closeDemo = useCallback(() => {
    // 데모의 CTA 는 "로그인 후 연결" 플래그를 세우는데, 우리는 이미 로그인 뒤
    // 연결 화면에 서 있다 — 다음 실행에 낡은 안내가 남지 않게 지운다.
    try {
      localStorage.removeItem("marblo.demo.connectPending");
    } catch {
      /* 프라이빗 모드 — 지울 게 없다 */
    }
    setShowDemo(false);
  }, []);

  return (
    <div
      className="flex h-screen flex-col bg-[#11111b] text-[#cdd6f4]"
      data-project-kind={projectKind}
    >
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
          {/* ★설정 버튼은 이제 **승격하지 않는다.** 종전엔 여기서 어드밴스드로
              올린 뒤 그쪽 settings 탭을 열었는데(막다른 버튼을 피하려던 것),
              설정 한 번 보려던 사람이 13탭짜리 화면에 떨어졌다 — 되돌아오는
              길은 그 설정 화면 안에 있고. 이제 심플 셸 안에서 같은
              `SettingsPage` 를 띄운다(큐레이트 탭). 승격은 오른쪽 버튼의 일로만
              남는다. */}
          <button
            type="button"
            data-testid="beginner-open-settings"
            title={t("beginner.topbar.settings")}
            onClick={() => setTab("settings")}
            className={BUTTON_GHOST}
          >
            {t("beginner.topbar.settings")}
          </button>
          {/* ★상시 전환 어포던스— 승격 모달(완료 3건 트리거)을 기다리지 않고
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

      {/* ── 경량 탭바 (대화 + 큐레이트 7) ──────────────────────────────────
          ★연결/폴더 게이트 중에도 그린다. 이 티켓의 출발점이 "심플 유저가
          도움말·설정에 닿을 길이 없다" 인데, 그게 가장 절실한 순간이 바로
          설치가 막힌 그 화면이다 — 가이드는 그때의 답이고, 언어·프라이버시
          토글은 설정 안에 있다. 게이트는 대화 탭 **안쪽**에 남는다. */}
      <BeginnerTabBar active={tab} onSelect={setTab} />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <Sidebar isOpen={fileTreeOpen} onToggle={toggleFileTree} />

        {/* 탭 전환 영역. 모든 탭은 절대배치로 겹쳐 두고 비활성만 display:none 이다
            — 위 mountedTabs 주석 참조(오케 PTY 를 살려 두기 위한 것). */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            className="absolute inset-0 flex flex-col overflow-hidden"
            style={{ display: tab === BEGINNER_CHAT_TAB ? undefined : "none" }}
          >
            {/* 위→아래 흐름(대화 → 일감 → 하단 2페인)은 그대로 두되, 폭 상한은
          68rem → 96rem 으로 연다. 68rem 은 한 열짜리 화면의 가독 폭이었는데,
          하단이 2분할이 된 지금 그 폭이면 오케 터미널이 좁아져 TUI 가 접힌다.
          상한 자체는 남긴다 — 27" 에서 카드가 끝까지 벌어지면 다시 성겨진다. */}
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              <div className="flex min-h-0 w-full flex-1 flex-col gap-2.5 overflow-hidden">
                {!cliReady ? (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <BeginnerConnectStep
                      onWatchDemo={() => setShowDemo(true)}
                      onOneClick={openOneClick}
                      manualFocusSignal={manualFocusSignal}
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
                            : "beginner.folder.title"
                        )}
                      </h1>
                      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-6 text-[#7f849c]">
                        {t(
                          sampleStatus === "preparing"
                            ? "beginner.folder.preparingBody"
                            : "beginner.folder.body"
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
                    {/* 상단: 마블로 Board(5단계 칸반+그래프) 그대로. 옛 3열 미니보드
                  제거. 오케 입력은 아래 실 PTY 패널 하나로 일원화. */}
                    <div
                      className="flex max-h-[48%] min-h-0 flex-[2_1_auto] flex-col overflow-hidden empty:hidden"
                      data-coach="beginner-live"
                    >
                      {/* ★카드 클릭 → TaskDetailModal(#971). compact 카드의
                        "바뀐 코드"·에이전트 칩도 셸이 목적지를 갖고 있을 때만. */}
                      <BeginnerLiveStrip
                        sentAt={ask.deliveredAt}
                        onResend={() => void ask.resend()}
                        resending={ask.sending}
                        onTaskClick={openTaskDetail}
                        showWorktreeDiff
                        onAgentClick={openAgentTerminal}
                      />
                    </div>

                    {/* ── ★하단 2분할: 오케 대화창 | 에이전트 ──────────────────────
                  좁은 창(<1024px)에서는 세로로 쌓는다 — 두 열을 억지로 유지하면
                  오케 터미널이 40컬럼 아래로 눌려 TUI 가 접힌다. */}
                    <div className="flex min-h-[18rem] flex-1 flex-col gap-2.5 overflow-hidden lg:flex-row">
                      <section
                        data-coach="beginner-chat"
                        className={`flex min-h-0 min-w-0 flex-[7_1_0%] flex-col overflow-visible ${SURFACE}`}
                      >
                        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#313244] px-4 py-2">
                          <SectionLabel>
                            {t("beginner.chat.title")}
                          </SectionLabel>
                          <span className="min-w-0 truncate text-[11px] text-[#585b70]">
                            {t("beginner.chat.hint")}
                          </span>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col overflow-visible">
                          {/* The rail consumes one line; the body opens upward
                            over the live content without resizing the PTY. */}
                          <div
                            data-testid="beginner-first-spawn-guide-anchor"
                            className="relative shrink-0 px-3 pt-2"
                          >
                            <FirstSpawnGuide />
                          </div>
                          {/* ★effort·버전 배지·세션 선택은 계속 감춘다(고급 손잡이).
                            모델만은 예외다(cmp95TVin) — showConnectedModelPicker 가
                            설치+인증된 하네스로만 목록을 좁힌다.
                            ★`min-h-0 flex-1` 래퍼가 필요하다 — OrchestratorPanel
                            의 fill 모드는 `h-full`(부모 100%)로 재는데, 위에
                            가이드 패널이 형제로 추가된 지금은 flex 가 남는
                            공간을 계산해 줘야 그 100%가 올바른 높이가 된다. */}
                          <div className="min-h-0 flex-1">
                            {/* ★showSessionRecovery(티켓 BzxAJXxqhHgYzy1Aq4IV):
                              오케가 멈췄을 때 이 셸에 남는 어포던스가 Start 하나
                              뿐이었다. Start 는 resolvePrevious 가 고른 세션을
                              말없이 이어받으므로, 엉뚱한 걸 물면 되돌릴 수단이
                              화면에 없다 — 어드밴스드로 도망칠 수도 없는 화면에서.
                              세션 id·KB 는 계속 감춘 채 "언제 나눈 대화인지" 로만
                              고르게 한다. */}
                            {/* ★gateBootOutput(티켓 fDceJJvz3eam2PMNOWyB): 이 패널은
                              오케 PTY 를 그대로 그리는 xterm 이라, 오케가 말하기
                              전엔 CLI 배너·YOLO mode·주입 프롬프트 전문·/var/folders
                              경로·get_agent_skill 반환 본문이 첫 화면이 됐다.
                              프롬프트로는 못 막는 자리(모델이 말하기 전의 원시
                              스트림)라 렌더러 write 경계에서 가른다 —
                              lib/orchestratorBootGate. 첫 발화 전엔 로딩 골격. */}
                            <OrchestratorPanel
                              fill
                              hideModelControls
                              showConnectedModelPicker
                              showSessionRecovery
                              gateBootOutput
                              onUserSubmit={ask.markTerminalSubmit}
                            />
                          </div>
                        </div>
                      </section>

                      {/* ★에이전트 열 — "누가 뭐하나". 세로 스택일 땐 높이를 묶어
                    오케가 화면 밖으로 밀리지 않게 한다. */}
                      <section
                        data-testid="beginner-agents-pane"
                        className={`flex max-h-[14rem] min-h-0 flex-col overflow-hidden lg:max-h-none lg:min-w-[16rem] lg:flex-[3_1_0%] ${SURFACE}`}
                      >
                        <BeginnerAgentsPane
                          agents={workerAgents}
                          tasks={tasks}
                          onTaskClick={openTaskDetail}
                          onAgentClick={openAgentTerminal}
                          onAgentKill={killAgent}
                        />
                      </section>
                    </div>
                  </>
                )}
              </div>
            </main>
          </div>

          {/* 큐레이트 일곱 — 엑스퍼트 탭 컴포넌트 그대로. 지연 마운트라 켠 적 없는
            탭은 여기 없다(각각 자기 구독·프로브를 들고 오므로 미리 태우지
            않는다). 스크롤은 엑스퍼트 탭바와 같은 규격으로 이 칸이 든다. */}
          {BEGINNER_CURATED_TABS.map((curated) => {
            if (!mountedTabs.has(curated)) return null;
            const Comp = CURATED_TAB_COMPONENTS[curated];
            return (
              <div
                key={curated}
                data-testid={`beginner-tabpanel-${curated}`}
                className="absolute inset-0 overflow-auto"
                style={{ display: tab === curated ? undefined : "none" }}
              >
                <Comp />
              </div>
            );
          })}
        </div>
      </div>

      {/* 첫 실행 코치마크 투어. 앵커(챗·첫요청·라이브·모드전환)가 실제로 그려진
          뒤에만 뜨고, 다른 오버레이와는 겹치지 않는다. 재노출 규칙은
          lib/coachmark 가 든다(완주/다시보지않기 = 끝, 그냥 닫으면 3회까지). */}
      <BeginnerTour
        ready={cliReady && hasFolder}
        blocked={
          // ★큐레이트 탭에 가 있는 동안은 멈춘다. 투어의 앵커(챗·첫요청·라이브·
          // 모드전환)는 전부 대화 탭 안에 있는데, 지금 그 탭은 사라진 게 아니라
          // display:none 이다 — 앵커는 조회되지만 치수가 0이라 코치마크가
          // 화면 구석에 붙는다(없으면 건너뛰는 규칙도 여기선 안 걸린다).
          tab !== BEGINNER_CHAT_TAB ||
          !!promotion ||
          showDemo ||
          showOneClick ||
          !!openTask ||
          !!openAgent
        }
      />

      {/* ★에이전트 입력 대기 알림 — 어드밴스드 셸(GlobalOverlays)과 **같은**
          컴포넌트다. 이 화면이야말로 이게 없으면 안 되는 쪽이다: 심플 모드는
          터미널을 아예 그리지 않으므로, 에이전트가 프롬프트 앞에서 멈추면
          사용자에게 남는 단서가 하나도 없다. 클릭하면 어드밴스드와 같은 PTY 를
          그리는 터미널 모달이 열린다. */}
      <AgentInputWaitHost onOpen={openAgentTerminalById} />

      {showOneClick && (
        <BeginnerOneClickModal
          onClose={closeOneClick}
          onManual={chooseManually}
        />
      )}

      {/* ★"로그인은 됐는데 아무 일도 안 일어나요" — 구독/크레딧이 없어 CLI 가 한
          턴도 못 도는 상태의 가이드(티켓 sVdwTsiGq6qZVAmSkwZB). 원클릭 모달이
          "연결됐어요" 를 띄우고 닫힌 **뒤에** 벌어지는 일이라 셸이 든다. 판정이
          없거나 정상이면 이 호스트는 아무것도 그리지 않는다.

          원클릭 모달과는 배타다(이 파일의 다른 모달들과 같은 규칙). 구독 없는
          계정은 프로브가 **빨리** 실패하므로, 가드가 없으면 원클릭 모달이 성공
          문구를 1.6초 보여주는 그 위에 이 모달이 겹쳐 뜬다 — 두 개가 겹치면
          Esc 한 번이 어느 쪽을 닫는지 알 수 없다. 원클릭은 인증되면 스스로
          닫히므로 이 안내는 곧바로 이어서 뜬다.

          ★데모 재생 중에도 뜨지 않는다(티켓 E3ywX1ftbVr5f1TrFsgp): 데모는 연결
          전에 여는 것이고 이 안내들도 연결이 없어서 뜨는 것이라 전제가 정확히
          겹쳐, 가드가 없으면 대본 위에 안내가 항상 덮인다. 규칙은
          lib/beginnerMode.shouldRenderOnboardingGuides 가 든다. */}
      {guidesAllowed && <FundingGuideHost />}

      {/* ★M1 — "여기까지는 무료로 볼 수 있어요"(온램프 #886 §5-A). 지금까지 이
          셸은 스폰 차단(`needsAuth`)을 해석하는 화면 목록에 아예 없어서, L0
          유저가 실행을 눌러도 화면에 **아무 일도** 일어나지 않았다.
          원클릭 모달과 배타인 이유는 위 자금 안내와 같다. M2(자금)와의 배타는
          호스트가 스스로 판정한다 — 두 모달이 서로 반대되는 지시를 준다. */}
      {guidesAllowed && (
        <OnrampGateHost variant="beginner" onConnect={openOneClick} />
      )}

      {/* 미니 보드/에이전트에서 연 티켓 상세 — 어드밴스드 보드와 같은 표준 모달.
          diff·수정 파일·activity note 가 같은 경로로 보여야 하므로 축소판을
          유지하지 않는다. */}
      {openTask && (
        <TaskDetailModal
          task={openTask}
          onClose={closeTaskDetail}
          // ★심플 모드엔 터미널 탭이 없다. "터미널 보기" 가 어드밴스드 경로
          // (openTerminalForSession)를 타면 모달만 닫히고 끝난다 — 여기서
          // BeginnerAgentTerminalModal 로 넘긴다(행 클릭·칩 클릭과 같은 도착지).
          onOpenAgentTerminal={openAgentTerminal}
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
        <VideoDemoModal surface="beginner_connect" onClose={closeDemo} />
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
