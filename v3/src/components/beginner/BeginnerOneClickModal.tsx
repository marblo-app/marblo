import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import TerminalView from "../terminal/TerminalView";
import { CommandBox } from "../onboarding/CliSetupRows";
import {
  bulkInstallOutcome,
  canLaunchSignIn,
  oneClickInstallRows,
  oneClickPhase,
  LOGIN_CMD,
  type OneClickPhase,
} from "../../lib/oneClickSetup";
import {
  SUBSCRIPTION_CHOICES,
  defaultOrchestratorModel,
  initialSubscriptionPick,
  nextLoginTarget,
  pendingLoginModels,
} from "../../lib/loginPrompt";
import {
  DOCS_URL,
  ROWS,
  UPDATE_CMD,
  cliLabel,
  type CliModel,
} from "../../stores/cliSetupStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";
import telemetry from "../../services/telemetryService";
import { BeginnerSubscriptionPick } from "./BeginnerSubscriptionPick";
import { PreviewTerminal } from "./PreviewTerminal";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "./beginnerUi";

/**
 * 비기너 모드의 **원클릭 설치 + 자동 사인인** 모달 (티켓 1F0D8hH5).
 *
 * ★재구현이 아니다. 판단·부수효과는 전부 #870 이 공용으로 뽑아 둔 것을 그대로
 * 쓴다:
 *   - 무엇을 설치할지 / 얼마나 됐는지 : `cliSetupStore.runInstallAll` + `bulkInstall`
 *   - 어느 CLI 를 먼저 사인인할지     : `oneClickSetup.signInRows` (오케 후보 우선)
 *   - 터미널 스폰 + 로그인 명령 주입   : `cliSetupActions.oneClickSignIn` → `launchLogin`
 *   - 인증 성립 감지                  : `useCliSetupEngine` 의 자동 재확인 폴
 * 이 파일이 새로 드는 것은 **국면 하나**다(`oneClickPhase`): 시작하기 탭에서는
 * 두 패널이 체크리스트의 다른 단계에 나란히 서 있어 사용자가 스스로 ①→② 로
 * 내려갔지만, 비기너에게는 그 체크리스트 자체가 없다. 그래서 설치가 끝나면
 * 사인인이 **스스로** 이어져야 하고, 그 이음매를 그리는 규칙이 필요하다.
 *
 * ★터미널을 모달 **안**에 임베드하는 것이 이 화면의 핵심이다. `launchLogin` 은
 * 실 PTY 세션에 `claude login` 을 타이핑하고, CLI 는 거기에 인증 URL 과 승인
 * 프롬프트를 인쇄한다. 비기너 셸에는 터미널 열이 없으므로 그 출력이 안 보이면
 * 로그인은 그 자리에서 끝난다.
 *
 * 실패는 조용히 지나가지 않는다: 설치가 전부 실패하면(`blocked`) 수동 명령과
 * 공식 문서를 그대로 띄우고, 어느 국면에서든 "직접 고르기" 로 빠져나갈 수 있다.
 *
 * ★칸이 하나 늘었다 — **구독 선택**(티켓 LLHMclpKaIAJbsiHzGoG). 종전에는 설치가
 * 끝나는 즉시 오케 후보 **하나**(claude 우선)의 로그인 창을 자동으로 띄웠는데,
 * 그 하나가 그 사용자가 가진 구독이 아니면 승인할 것이 아무것도 없었다. 화면은
 * "브라우저에서 승인만 하시면 됩니다" 를 계속 띄우고 사용자는 멈춘다 — 콜드테스트가
 * 지목한 이탈 지점이다. 이제 설치 뒤에 **가진 구독을 묻고**, 고른 것마다 로그인
 * 터미널을 **차례로** 띄우며, 그 결과를 기본 오케 하네스로 저장한다.
 *
 * ★순차인 것이 계약이다. 셋을 동시에 띄우면 브라우저 승인 탭이 셋 열리고 어느
 * 터미널이 무엇을 기다리는지 알 수 없다(`oneClickSignIn` 이 원래 하나만 띄우던
 * 이유 그대로). 대상 선정은 `lib/loginPrompt.nextLoginTarget` 이 하고, 앞의 것이
 * 인증되면 다음이 스스로 올라온다.
 *
 * ★이미 로그인된 CLI 는 큐에서 아예 빠진다(`pendingLoginModels`). 오케 후보가
 * 이미 인증돼 있으면 그보다 앞서 `ready` 가 서서 이 모달은 곧장 `done` 이므로,
 * 이미 다 된 사람에게 질문 자체가 뜨지 않는다.
 */

/** 국면별 진행 인디케이터 — 지금 어디쯤인지 세 칸으로만 말한다. */
const STEPS: Array<{
  key: "install" | "subscription" | "auth";
  done: OneClickPhase[];
}> = [
  {
    key: "install",
    done: ["choose_subscription", "sign_in", "awaiting_auth", "done"],
  },
  { key: "subscription", done: ["sign_in", "awaiting_auth", "done"] },
  { key: "auth", done: ["done"] },
];

const STEP_LABEL = {
  install: "beginner.oneClick.step.install",
  subscription: "beginner.oneClick.step.subscription",
  auth: "beginner.oneClick.step.auth",
} as const;

export interface BeginnerOneClickModalProps {
  onClose: () => void;
  /** 인증까지 끝났을 때 — 셸이 다음 국면(폴더/챗)으로 넘어간다. */
  onReady?: () => void;
  /**
   * "직접 고를게요" — 자동 경로를 버리고 **수동 선택 화면으로 데려다 준다**.
   *
   * ★`onClose` 와 갈라 두는 것이 이 프롭의 전부다(티켓 k22rGEgv). 예전엔 이
   * 버튼이 `onClose` 를 그대로 불렀는데, 수동 선택 UI(BeginnerConnectStep 의
   * '직접 고르기' 택1 카드)는 원래부터 이 모달 **아래**에 깔려 있으므로 화면은
   * 사실 "이동" 을 했다 — 다만 그 섹션이 온램프 카드와 원클릭 CTA 아래, 스크롤
   * 접힘 **밑**에 있어서 닫는 순간 사용자가 보는 건 방금 떠나온 그 CTA 카드였다.
   * 콜드 테스트에서 "눌러도 아무 동작 없이 창만 닫힌다" 로 보고된 것이 이것이다.
   * 그래서 고칠 것은 목적지가 아니라 **도착을 보이게 하는 일**이고, 그 스크롤·
   * 강조는 연결 화면을 소유한 셸만 할 수 있다.
   *
   * 안 주면 종전대로 닫기만 한다 — 이 모달을 다른 자리에서 재사용할 때 수동
   * 화면이 없을 수도 있어서다.
   */
  onManual?: () => void;
}

export function BeginnerOneClickModal({
  onClose,
  onReady,
  onManual,
}: BeginnerOneClickModalProps) {
  const { t } = useTranslation();

  // ★값·액션은 전부 이 뷰모델에서 온다 — 실제 흐름과 온보딩 프리뷰(시연)가
  // 여기서 갈린다. 화면 자체는 두 경우에 **똑같이** 그려진다: 시연의 목적이
  // "신규 유저가 보는 그 화면" 을 보는 것이라, 프리뷰용 UI 분기를 두면 안 된다
  // (유일한 예외가 아래 터미널 자리 — 실 PTY 를 띄울 수 없다).
  const setup = useOnboardingSetup();
  const ready = setup.ready;
  const results = setup.results;
  const bulk = setup.bulk;
  const installErrors = setup.installErrors;
  const previewStage = useOnboardingPreviewStore((s) => s.stage);

  const [started, setStarted] = useState(false);
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null);
  const [loginModel, setLoginModel] = useState<CliModel | null>(null);
  // ★`null` = 아직 안 물었다(구독 질문이 떠 있다). 빈 배열이 아니라 null 인 것이
  // 중요하다 — "고른 게 없다" 와 "아직 안 골랐다" 는 다른 국면이다.
  const [picked, setPicked] = useState<CliModel[] | null>(null);
  const [draftPick, setDraftPick] = useState<CliModel[] | null>(null);
  // 사용자가 "이건 나중에 할게요" 를 누른 것 — 인증되지 않았는데도 큐에서 빼야
  // 하는 유일한 경우다.
  const [skipped, setSkipped] = useState<CliModel[]>([]);
  // 터미널 스폰 자체가 실패한 CLI. 큐를 멈추지 않고 다음으로 넘어가되 수동 로그인
  // 명령을 남긴다 — 스폰 실패는 조용히 지나갈 일이 아니다.
  const [launchFailed, setLaunchFailed] = useState<CliModel[]>([]);
  // 이 흐름에서 이미 로그인 터미널을 띄워 본 CLI. 같은 대상에 두 번 스폰하지 않는
  // 유일한 가드다 — 브라우저 승인이 끝날 때까지 그 행은 계속 미인증이라, 이게
  // 없으면 프로브 폴 주기마다 같은 로그인이 새 터미널로 다시 뜬다.
  const attemptedRef = useRef<Set<CliModel>>(new Set());
  // ★액션은 ref 로 잡는다. 뷰모델은 프로브 결과가 갱신될 때마다 새 객체가 되는데,
  // 그걸 `start`/로그인 이펙트의 의존성에 넣으면 "설치를 시작한 그 호출이
  // 만든 상태 변화" 가 곧바로 이펙트를 재실행시켜 **설치 패스가 두 번 돈다**
  // (`started` 가드는 setState 반영보다 늦다).
  const actionsRef = useRef({
    installAll: setup.installAll,
    login: setup.login,
    setDefaultOrchestrator: setup.setDefaultOrchestrator,
    readResults: setup.readResults,
    recheck: setup.recheck,
  });
  actionsRef.current = {
    installAll: setup.installAll,
    login: setup.login,
    setDefaultOrchestrator: setup.setDefaultOrchestrator,
    readResults: setup.readResults,
    recheck: setup.recheck,
  };

  // 고른 것 중 아직 로그인해야 하는 CLI — **이미 인증된 것은 여기서 빠진다**
  // (사장님 케이스: 전부 로그인돼 있으면 이 배열이 빈다).
  const pendingLogins = useMemo(
    () => (picked ? pendingLoginModels(ROWS, picked, results) : []),
    [picked, results]
  );
  // 지금 로그인 터미널을 띄울 대상 하나. 한 번에 하나가 이 큐의 계약이다.
  const loginTarget = useMemo(
    () => (picked ? nextLoginTarget(ROWS, picked, results, skipped) : null),
    [picked, results, skipped]
  );

  const flow = useMemo(
    () => ({
      started,
      ready,
      bulk,
      signInTargets: picked === null ? SUBSCRIPTION_CHOICES.length : pendingLogins.length,
      loginLaunched: loginSessionId !== null,
      subscriptionPicked: picked !== null,
      // ★`done` 을 붙잡는 값. 오케 후보 하나가 인증되면 `ready` 는 서지만, 구독을
      // 둘 골랐다면 두 번째 로그인은 아직 진행 중이다. 건너뛴 것은 세지 않는다 —
      // 사용자가 이미 "나중에" 라고 답한 것을 붙잡고 있으면 흐름이 안 끝난다.
      pendingLogins: loginTarget ? pendingLogins.length : 0,
    }),
    [
      started,
      ready,
      bulk,
      loginSessionId,
      picked,
      loginTarget,
      pendingLogins.length,
    ]
  );
  const phase = oneClickPhase(flow);

  /**
   * 고른 로그인은 다 끝났는데 게이트가 아직 안 열렸다.
   *
   * ★오케를 띄울 수 있는 것은 아직 Claude/Codex 뿐이다(#579 `ORCHESTRATOR_CLI_IDS`).
   * 그래서 SuperGrok 만 고른 사람은 로그인을 성공해도 셸의 연결 게이트를 못 넘는다 —
   * 이 티켓의 범위 밖(오케 후보 집합은 스폰·자동기동·게이트가 함께 읽는 값이라
   * 여기서 늘릴 수 없다)이라, **감추지 않고** 말한 뒤 다시 고를 문을 준다. 이걸
   * 안 그리면 "설치가 끝났어요, 로그인 창을 띄우는 중…" 이 영원히 떠 있는 화면이
   * 된다(띄울 것이 없는데도).
   */
  const queueExhausted =
    picked !== null && loginTarget === null && !ready && phase !== "blocked";

  // 이펙트·콜백이 **지금 값**을 읽어야 하는 자리들. 의존성에 넣으면 프로브 폴이
  // 돌 때마다 이펙트가 재실행되는 값들이라 ref 로 잡는다.
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const skippedRef = useRef(skipped);
  skippedRef.current = skipped;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  /**
   * 기본 오케 하네스 저장(요구 (3)). 같은 값을 두 번 쓰지 않는다 — IPC 낭비이자,
   * 설정이 깜빡이는 것으로 보인다.
   *
   * 판정은 `lib/loginPrompt.defaultOrchestratorModel` 이 한다: 고른 것 중 **이미
   * 인증된** 것이 먼저고(지금 당장 오케를 태울 수 있는 유일한 칸), 없으면 첫 번째.
   */
  const defaultOrchRef = useRef<CliModel | null>(null);
  const applyDefaultOrchestrator = useCallback(
    (chosen: readonly CliModel[], probe: typeof results) => {
      const model = defaultOrchestratorModel(ROWS, chosen, probe);
      if (!model || model === defaultOrchRef.current) return;
      defaultOrchRef.current = model;
      actionsRef.current.setDefaultOrchestrator(model);
    },
    []
  );

  // ── ① 시작하자마자 설치 ────────────────────────────────────────────────
  // 모달이 열렸다는 것 자체가 "모두 설치 + 자동 로그인" 을 누른 것이다 —
  // 모달 안에서 같은 결정을 한 번 더 묻지 않는다.
  const start = useCallback(() => {
    if (started) return;
    setStarted(true);
  }, [started, ready]);

  useEffect(() => {
    start();
  }, [start]);

  // ── ② 설치가 끝나면 "어떤 구독 가지고 계세요?" ──────────────────────────
  // 체크박스의 기본값은 **이미 로그인된 것**뿐이다(가진 게 증명된 것). 나머지는
  // 비워 둔다 — 안 가진 구독을 기본 체크로 밀면 있지도 않은 계정의 로그인
  // 터미널이 뜬다. 질문이 화면에 선 뒤에는 다시 계산하지 않는다(사용자가 방금
  // 푼 체크가 폴 주기마다 되살아나는 것을 막는다).
  const askingSubscription = phase === "choose_subscription";
  useEffect(() => {
    if (!askingSubscription) return;
    setDraftPick((prev) =>
      prev === null
        ? initialSubscriptionPick(ROWS, actionsRef.current.readResults())
        : prev
    );
  }, [askingSubscription]);

  // 도달 계측 — 화면당 한 번. #932 `spawn_blocked reason=needs_auth` 와 조인되는
  // 분모다("막힌 사람" 중 몇이 이 화면까지 왔나).
  const shownRef = useRef(false);
  useEffect(() => {
    if (!askingSubscription || shownRef.current) return;
    shownRef.current = true;
    telemetry.loginPrompt("shown", {
      choices: SUBSCRIPTION_CHOICES.length,
      alreadySignedIn: initialSubscriptionPick(
        ROWS,
        actionsRef.current.readResults()
      ).length,
    });
  }, [askingSubscription]);

  const togglePick = useCallback((model: CliModel) => {
    setDraftPick((prev) => {
      const set = new Set(prev ?? []);
      if (set.has(model)) set.delete(model);
      else set.add(model);
      // ★순서를 선택지 순서로 정규화한다(claude → codex → grok). 이 순서가 곧
      // 로그인 큐의 순서이자 기본 오케의 우선순위이고, 그 우선순위는 오케 후보
      // 순서(#579 ORCHESTRATOR_CLI_IDS)와 같아야 한다 — 체크한 순서대로 두면
      // grok 을 먼저 누른 사람의 기본 오케가 grok 이 된다.
      return SUBSCRIPTION_CHOICES.filter((m) => set.has(m));
    });
  }, []);

  // ── ③ 고른 것을 확정한다 — 여기서 기본 오케가 정해진다 ──────────────────
  const confirmPick = useCallback(() => {
    const chosen = draftPick ?? [];
    if (chosen.length === 0) return;
    setPicked(chosen);
    telemetry.cliSetupStep("install", "enter");
    actionsRef.current.installAll(
      ROWS.filter((row) => chosen.includes(row.model))
    );
    telemetry.loginPrompt("picked", {
      models: chosen,
      count: chosen.length,
    });
    telemetry.cliSetupStep("auth", "enter");
    // 기본 오케는 **지금** 정한다. 로그인이 끝나기를 기다리면 그 사이의 첫 스폰이
    // 예전 기본값(claude)으로 나가고, 그게 그 사용자가 안 가진 구독이면 곧장
    // needs_auth 로 막힌다 — 이 티켓이 고치려는 바로 그 벽이다.
    applyDefaultOrchestrator(chosen, actionsRef.current.readResults());
  }, [draftPick, applyDefaultOrchestrator]);

  const fallbackAll = useCallback(() => {
    const chosen = [...SUBSCRIPTION_CHOICES];
    setDraftPick(chosen);
    setPicked(chosen);
    telemetry.cliSetupStep("install", "enter");
    actionsRef.current.installAll(
      ROWS.filter((row) => chosen.includes(row.model))
    );
    telemetry.loginPrompt("picked", {
      models: chosen,
      count: chosen.length,
    });
    telemetry.cliSetupStep("auth", "enter");
    applyDefaultOrchestrator(chosen, actionsRef.current.readResults());
  }, [applyDefaultOrchestrator]);

  // ── ④ 고른 CLI 를 **차례로** 로그인시킨다 ────────────────────────────────
  // 동시에 셋을 띄우면 브라우저 승인 탭이 셋 열리고 어느 터미널이 무엇을
  // 기다리는지 알 수 없다. 앞의 것이 인증되면 `pendingLoginModels` 에서 빠지고
  // 다음 대상이 스스로 올라온다 — 큐가 저절로 굴러간다.
  useEffect(() => {
    if (!loginTarget) return;
    if (!canLaunchSignIn(flow)) return;
    if (attemptedRef.current.has(loginTarget)) return;
    const model = loginTarget;
    attemptedRef.current.add(model);
    telemetry.loginPrompt("launched", { model });
    // 스폰 실패 — 큐를 여기서 멈추지 않는다. 수동 명령을 남기고 다음 대상으로
    // 넘어간다(가진 구독이 둘인데 하나가 실패했다고 나머지까지 못 하게 만들
    // 이유는 없다). 던져서 실패하는 경우도 같은 자리로 모은다: 삼키면 화면이
    // 아무 말 없이 그 CLI 에서 멈춘다.
    const failed = () => {
      setLaunchFailed((prev) =>
        prev.includes(model) ? prev : [...prev, model]
      );
      setSkipped((prev) => (prev.includes(model) ? prev : [...prev, model]));
    };
    void actionsRef.current
      .login(model)
      .then((sessionId) => {
        if (!sessionId) return failed();
        setLoginModel(model);
        setLoginSessionId(sessionId);
      })
      .catch(failed);
  }, [loginTarget, flow]);

  // ── ⑤ 큐가 진행되는 동안의 자체 폴 ──────────────────────────────────────
  // ★엔진의 자동 재확인 폴은 **오케 후보 하나**가 인증되면 멈춘다(`requiredReady`).
  // 사용자가 그 뒤에 이어서 grok 로그인을 하고 있으면 아무도 프로브를 다시 돌리지
  // 않아 화면이 영영 "승인 기다리는 중" 에 머문다. 그 공백만 메운다 — 엔진 폴이
  // 도는 동안에는 쉰다(둘이 함께 돌면 프로브가 두 배로 나간다).
  const loginRunning = setup.loginRunning;
  useEffect(() => {
    if (!loginTarget || !loginSessionId || setup.preview) return;
    if (loginRunning) return;
    let ticks = 0;
    const MAX_TICKS = 120; // ~6분 백스톱 — 그 뒤로는 수동 "다시 확인" 이 남는다
    const timer = window.setInterval(() => {
      if (++ticks > MAX_TICKS) {
        window.clearInterval(timer);
        return;
      }
      actionsRef.current.recheck();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loginTarget, loginSessionId, loginRunning, setup.preview]);

  // ── ⑥ 인증되면 알린다 ──────────────────────────────────────────────────
  // 셸은 `cliReady` 로 스스로 다음 국면을 그리지만, 성공 문구를 한 박자 보여준
  // 뒤 모달을 닫아야 "무슨 일이 일어났는지" 가 화면에 남는다.
  //
  // ★`phase === "done"` 을 본다(`ready` 가 아니라). `ready` 는 오케 후보 하나가
  // 인증되면 서므로, 구독을 둘 고른 사람은 첫 인증 순간 모달이 닫히면서 두 번째
  // 로그인 터미널을 화면에서 통째로 잃는다.
  //
  // ★콜백은 ref 로 잡는다. 호출부가 `onClose={() => …}` 로 넘기면 셸이 리렌더될
  // 때마다(티켓 구독·프로브 폴이 계속 돈다) 이 이펙트가 재실행되고, 그 cleanup 이
  // 방금 건 타이머를 지운다 — 클린룸에서 실제로 그랬다: 모달이 "연결됐어요" 에서
  // 영영 닫히지 않았다.
  const cbRef = useRef({ onClose, onReady });
  cbRef.current = { onClose, onReady };
  const doneReportedRef = useRef(false);
  useEffect(() => {
    if (phase !== "done") return;
    if (!doneReportedRef.current) {
      doneReportedRef.current = true;
      telemetry.loginPrompt("done", {
        picked: pickedRef.current ?? [],
        skipped: skippedRef.current.length,
      });
    }
    const timer = window.setTimeout(() => {
      cbRef.current.onReady?.();
      cbRef.current.onClose();
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  // 큐가 끝나면 기본 오케를 한 번 더 본다 — 확정 시점에는 아무것도 인증돼 있지
  // 않아 "첫 번째" 로 정했지만, 그게 실패·건너뛰기로 빠지고 다른 것이 인증됐다면
  // 실제로 도는 CLI 를 기본값으로 삼는 편이 맞다.
  useEffect(() => {
    if (!picked || loginTarget) return;
    applyDefaultOrchestrator(picked, results);
  }, [picked, loginTarget, results, applyDefaultOrchestrator]);

  // ★이탈 계측 — 로그인이 남았는데 화면을 닫은 사람. 이 화면의 실패율이자,
  // 콜드테스트가 지목한 이탈 구간의 직접 지표다.
  const close = useCallback(() => {
    if (phaseRef.current !== "done") {
      telemetry.loginPrompt("dismissed", {
        phase: phaseRef.current,
        picked: pickedRef.current ?? [],
      });
    }
    cbRef.current.onClose();
  }, []);

  const retry = useCallback(() => {
    attemptedRef.current.clear();
    setLoginSessionId(null);
    setLoginModel(null);
    setLaunchFailed([]);
    setSkipped([]);
    actionsRef.current.installAll();
  }, []);

  /** "다른 구독도 고를게요" — 질문 화면으로 되돌아간다. */
  const repick = useCallback(() => {
    setPicked(null);
    setLoginSessionId(null);
    setLoginModel(null);
  }, []);

  const skipCurrent = useCallback(() => {
    if (!loginTarget) return;
    setSkipped((prev) =>
      prev.includes(loginTarget) ? prev : [...prev, loginTarget]
    );
    setLoginSessionId(null);
    setLoginModel(null);
  }, [loginTarget]);

  const failedRows = useMemo(
    () =>
      oneClickInstallRows(ROWS).filter(
        (r) => results[r.id]?.installed !== true
      ),
    [results]
  );
  const firstFailed = failedRows[0];
  const selectedRows = useMemo(
    () =>
      (picked ?? []).flatMap((model) => {
        const row = ROWS.find((r) => r.model === model);
        return row ? [row] : [];
      }),
    [picked]
  );

  const bulkTotal = bulk?.total ?? 0;
  const bulkDone = bulk?.done ?? 0;
  // 진행률은 설치 국면에서만 의미가 있다. 사인인 이후에는 100% 로 고정해
  // 막대가 되감기지 않게 한다(되감기는 "뭔가 잘못됐다" 로 읽힌다).
  const installPct =
    phase === "installing"
      ? bulkTotal > 0
        ? Math.round((bulkDone / bulkTotal) * 100)
        : 10
      : 100;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        data-testid="beginner-oneclick-modal"
        data-phase={phase}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#313244] bg-[#181825] shadow-2xl"
      >
        {/* ── 헤더: 무엇이 진행 중인지 한 줄 ───────────────────────────── */}
        <div className="flex items-start gap-3 border-b border-[#313244] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[#cdd6f4]">
              {t("beginner.oneClick.title")}
            </h2>
            <p
              data-testid="beginner-oneclick-status"
              className="mt-1 text-xs leading-5 text-[#a6adc8]"
            >
              {t(
                phase === "done"
                  ? "beginner.oneClick.status.done"
                  : phase === "blocked"
                  ? "beginner.oneClick.status.blocked"
                  : phase === "choose_subscription"
                  ? "beginner.oneClick.status.chooseSubscription"
                  : queueExhausted
                  ? "beginner.login.exhausted"
                  : phase === "awaiting_auth"
                  ? "beginner.oneClick.status.awaitingAuth"
                  : phase === "sign_in"
                  ? "beginner.oneClick.status.signIn"
                  : "beginner.oneClick.status.installing"
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="beginner-oneclick-close"
            onClick={close}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-[#7f849c] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
            aria-label={t("beginner.oneClick.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* ── 세 칸 진행 인디케이터: 설치 → 구독 → 로그인 ─────────────── */}
          <ol className="flex items-center gap-2">
            {STEPS.map((step, i) => {
              const isDone = step.done.includes(phase);
              const isCurrent =
                !isDone &&
                (step.key === "install"
                  ? phase === "installing" || phase === "blocked"
                  : step.key === "subscription"
                  ? phase === "choose_subscription"
                  : phase === "sign_in" || phase === "awaiting_auth");
              return (
                <li
                  key={step.key}
                  data-testid={`beginner-oneclick-step-${step.key}`}
                  data-state={isDone ? "done" : isCurrent ? "current" : "todo"}
                  className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                    isDone
                      ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                      : isCurrent
                      ? "border-[#89b4fa]/50 bg-[#89b4fa]/10 text-[#cdd6f4]"
                      : "border-[#313244] bg-[#11111b] text-[#6c7086]"
                  }`}
                >
                  <span className="font-semibold">{isDone ? "✓" : i + 1}</span>
                  <span className="min-w-0 truncate">
                    {t(STEP_LABEL[step.key])}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* 설치 진행 막대 — 몇 개 중 몇 개인지 숫자로도 남긴다. */}
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-[#313244]">
              <div
                data-testid="beginner-oneclick-progress"
                className="h-full rounded-full bg-[#89b4fa] transition-all duration-500"
                style={{ width: `${installPct}%` }}
              />
            </div>
            {phase === "installing" && bulkTotal > 0 && (
              <p className="mt-1.5 text-[11px] tabular-nums text-[#7f849c]">
                {t("beginner.oneClick.installProgress", {
                  done: bulkDone,
                  total: bulkTotal,
                })}
              </p>
            )}
            {selectedRows.length > 0 && phase !== "choose_subscription" && (
              <div
                data-testid="beginner-oneclick-cli-progress-list"
                className="mt-3 space-y-2"
              >
                {selectedRows.map((row) => {
                  const installing = setup.installing === row.id;
                  const installed = results[row.id]?.installed === true;
                  const failed =
                    !installing &&
                    !installed &&
                    !!bulk &&
                    !bulk.running &&
                    bulk.failedIds.includes(row.id);
                  const pct = installing || installed ? 100 : failed ? 100 : 0;
                  return (
                    <div
                      key={row.id}
                      data-testid={`beginner-oneclick-cli-progress-${row.model}`}
                      data-state={
                        installing
                          ? "installing"
                          : installed
                          ? "done"
                          : failed
                          ? "failed"
                          : "pending"
                      }
                      className="rounded-md border border-[#313244] bg-[#11111b] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-[#cdd6f4]">
                          {cliLabel(row.model)}
                        </span>
                        <span
                          className={
                            failed
                              ? "text-[#f38ba8]"
                              : installed
                              ? "text-[#a6e3a1]"
                              : installing
                              ? "text-[#89b4fa]"
                              : "text-[#7f849c]"
                          }
                        >
                          {failed
                            ? t("beginner.oneClick.cliProgress.failed")
                            : installed
                            ? t("beginner.oneClick.cliProgress.done")
                            : installing
                            ? t("beginner.oneClick.cliProgress.installing")
                            : t("beginner.oneClick.cliProgress.pending")}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#313244]">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            failed
                              ? "bg-[#f38ba8]"
                              : installed
                              ? "bg-[#a6e3a1]"
                              : "bg-[#89b4fa]"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {bulk &&
              !bulk.running &&
              bulk.total > 0 &&
              bulkInstallOutcome(bulk) === "partial" && (
                // 부분 실패는 흐름을 멈추지 않는다 — 성공한 CLI 로 계속 간다.
                <p
                  data-testid="beginner-oneclick-partial"
                  className="mt-1.5 text-[11px] text-[#f9e2af]"
                >
                  {t("beginner.oneClick.partial", {
                    failed: bulk.failedIds.length,
                    total: bulk.total,
                  })}
                </p>
              )}
          </div>

          {/* ── ★구독 선택: "어떤 구독 가지고 계세요?" ───────────────────
              자동설치와 로그인 사이의 질문 하나. 이게 없을 때 신규 유저는 자기가
              가진 것과 다른 CLI 의 로그인 창 앞에서 멈췄다. */}
          {phase === "choose_subscription" && (
            <BeginnerSubscriptionPick
              results={results}
              selected={draftPick ?? []}
              onToggle={togglePick}
              onConfirm={confirmPick}
              onFallbackAll={fallbackAll}
            />
          )}

          {/* ── ★로그인 큐: "아래 터미널에서 로그인 진행해주세요" ─────────
              고른 CLI 를 하나씩. 진행률은 "몇 개 중 몇 개" 로만 말한다 —
              지금 무엇을 기다리는지가 이 화면의 유일한 질문이라서다. */}
          {/* ★`loginTarget` 도 함께 본다: 마지막 대상이 인증되면 세션 id 는 아직
              남아 있는데 기다릴 것은 없다 — 그 상태로 "로그인 진행해주세요" 를
              띄우면 이미 끝난 로그인을 다시 하라는 말이 된다. */}
          {loginSessionId && loginTarget && phase !== "done" && (
            <div className="mt-4">
              <p
                data-testid="beginner-login-queue-title"
                className="text-sm font-semibold text-[#cdd6f4]"
              >
                {t("beginner.login.queueTitle")}
              </p>
              <div className="mb-2 mt-1 flex flex-wrap items-baseline gap-x-2">
                <p className="min-w-0 flex-1 text-xs leading-5 text-[#a6adc8]">
                  {t("beginner.login.queueBody", {
                    cli: loginModel ? cliLabel(loginModel) : "CLI",
                  })}
                </p>
                {picked && picked.length > 1 && (
                  <span
                    data-testid="beginner-login-queue-progress"
                    className="shrink-0 text-[11px] tabular-nums text-[#7f849c]"
                  >
                    {t("beginner.login.queueProgress", {
                      done: picked.length - pendingLogins.length,
                      total: picked.length,
                    })}
                  </span>
                )}
              </div>
              {/* ★`relative` 가 필수다. TerminalView 는 `absolute inset-0` 으로
                  그려지므로 **positioned 조상**이 없으면 이 박스를 뚫고 나가
                  가장 가까운 positioned 조상(여기서는 fixed 오버레이 = 창 전체)을
                  덮는다 — 클린룸 스크린샷에서 창 전체가 터미널로 뒤덮였다. */}
              <div
                data-testid="beginner-oneclick-terminal"
                className="relative h-64 overflow-hidden rounded-md border border-[#45475a] bg-[#11111b] p-2"
              >
                {/* 프리뷰(시연)에서는 실 PTY 세션이 없다 — 같은 자리에 로그인
                    대본을 재생한다. 이것이 프리뷰의 유일한 UI 분기다. */}
                {setup.preview ? (
                  <PreviewTerminal
                    model={loginModel ?? "claude"}
                    stage={previewStage}
                  />
                ) : (
                  <TerminalView sessionId={loginSessionId} isActive />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 text-[11px] leading-5 text-[#7f849c]">
                  {t("beginner.oneClick.stuck")}
                </p>
                {/* 막힌 로그인 하나가 나머지를 붙잡지 않게 한다 — 건너뛴 것은
                    큐에서 빠지고 다음 CLI 가 곧바로 올라온다. */}
                <button
                  type="button"
                  data-testid="beginner-login-skip"
                  onClick={skipCurrent}
                  className="shrink-0 text-[11px] text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
                >
                  {t("beginner.login.skip")}
                </button>
              </div>
            </div>
          )}

          {/* 로그인 터미널 스폰 자체가 실패한 CLI — 수동 로그인 명령을 남긴다.
              큐는 이미 다음으로 넘어갔다(하나가 실패했다고 나머지를 막지 않는다). */}
          {launchFailed.length > 0 && phase !== "done" && (
            <div
              data-testid="beginner-login-launch-failed"
              className="mt-4 rounded-md border border-[#f9e2af]/30 bg-[#f9e2af]/5 p-3"
            >
              {launchFailed.map((model) => (
                <div key={model} className="mt-1 first:mt-0">
                  <p className="text-[11px] leading-5 text-[#f9e2af]">
                    {t("beginner.login.launchFail", { cli: cliLabel(model) })}
                  </p>
                  <CommandBox cmd={LOGIN_CMD[model]} />
                </div>
              ))}
            </div>
          )}

          {/* ── 막힘: 설치가 전부 실패했다 → 수동 명령 + 공식 문서 ──────── */}
          {phase === "blocked" && (
            <div
              data-testid="beginner-oneclick-blocked"
              className="mt-4 rounded-md border border-[#f38ba8]/30 bg-[#f38ba8]/5 p-3"
            >
              <p className="text-xs font-medium text-[#f38ba8]">
                {t("beginner.oneClick.blocked.title")}
              </p>
              {firstFailed && installErrors[firstFailed.id] && (
                <p className="mt-1 break-words text-[11px] leading-5 text-[#a6adc8]">
                  {installErrors[firstFailed.id]}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-5 text-[#a6adc8]">
                {t("beginner.oneClick.blocked.body")}
              </p>
              {firstFailed && (
                <>
                  <CommandBox cmd={UPDATE_CMD[firstFailed.model]} />
                  <a
                    href={DOCS_URL[firstFailed.model]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-xs text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
                  >
                    {t("beginner.oneClick.blocked.docs")} ↗
                  </a>
                </>
              )}
            </div>
          )}

          {/* ── 완료 ──────────────────────────────────────────────────── */}
          {phase === "done" && (
            <div
              data-testid="beginner-oneclick-done"
              className="mt-4 rounded-md border border-[#a6e3a1]/30 bg-[#a6e3a1]/10 px-3 py-2.5 text-sm text-[#a6e3a1]"
            >
              ✓ {t("beginner.oneClick.done")}
              {defaultOrchRef.current && (
                <span
                  data-testid="beginner-login-default-set"
                  className="mt-1 block text-[11px] text-[#a6e3a1]/80"
                >
                  {t("beginner.login.defaultSet", {
                    cli: cliLabel(defaultOrchRef.current),
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── 하단: 빠져나갈 길은 항상 열어 둔다 ─────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#313244] px-5 py-3">
          {phase === "blocked" && (
            <button
              type="button"
              data-testid="beginner-oneclick-retry"
              onClick={retry}
              className={BUTTON_PRIMARY}
            >
              {t("beginner.oneClick.retry")}
            </button>
          )}
          {/* 고른 것을 다 끝냈는데 게이트가 아직 안 열렸다 = 오케 후보(Claude/
              Codex)를 하나도 안 골랐다는 뜻이다(#579 는 그 둘만 센다). 다시
              고르러 갈 문을 준다 — 여기서 닫히면 사용자는 왜 안 되는지 모른다. */}
          {queueExhausted && (
            <button
              type="button"
              data-testid="beginner-login-repick"
              onClick={repick}
              className={BUTTON_PRIMARY}
            >
              {t("beginner.login.title")}
            </button>
          )}
          {/* ★"직접 고를게요" 는 닫기가 **아니다** — 수동 선택 화면으로 데려다
              준다(onManual). 둘을 같은 핸들러로 묶어 두면 창만 사라지고 사용자는
              같은 자리에 남는다(k22rGEgv 콜드 테스트). 위의 ✕ 는 그대로 닫기다. */}
          <button
            type="button"
            data-testid="beginner-oneclick-manual"
            onClick={onManual ?? onClose}
            className={BUTTON_GHOST}
          >
            {t("beginner.oneClick.manual")}
          </button>
          <span className="ml-auto text-[11px] text-[#585b70]">
            {t("beginner.oneClick.footerHint")}
          </span>
        </div>
      </div>
    </div>
  );
}
