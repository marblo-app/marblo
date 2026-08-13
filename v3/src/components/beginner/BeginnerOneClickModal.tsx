import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import TerminalView from "../terminal/TerminalView";
import { CommandBox } from "../onboarding/CliSetupRows";
import {
  bulkInstallOutcome,
  oneClickInstallRows,
  oneClickPhase,
  shouldAutoSignIn,
  signInRows,
  type OneClickPhase,
} from "../../lib/oneClickSetup";
import {
  DOCS_URL,
  ORCHESTRATOR_CLI_IDS,
  ROWS,
  UPDATE_CMD,
  cliLabel,
  type CliModel,
} from "../../stores/cliSetupStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";
import telemetry from "../../services/telemetryService";
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
 */

/** 국면별 진행 인디케이터 — 지금 어디쯤인지 두 칸으로만 말한다. */
const STEPS: Array<{ key: "install" | "auth"; done: OneClickPhase[] }> = [
  { key: "install", done: ["sign_in", "awaiting_auth", "done"] },
  { key: "auth", done: ["done"] },
];

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
  const autoSignInRef = useRef(false);
  // ★액션은 ref 로 잡는다. 뷰모델은 프로브 결과가 갱신될 때마다 새 객체가 되는데,
  // 그걸 `start`/자동사인인 이펙트의 의존성에 넣으면 "설치를 시작한 그 호출이
  // 만든 상태 변화" 가 곧바로 이펙트를 재실행시켜 **설치 패스가 두 번 돈다**
  // (`started` 가드는 setState 반영보다 늦다).
  const actionsRef = useRef({
    installAll: setup.installAll,
    signIn: setup.signIn,
  });
  actionsRef.current = { installAll: setup.installAll, signIn: setup.signIn };

  const targets = useMemo(
    () => signInRows(ROWS, results, ORCHESTRATOR_CLI_IDS),
    [results],
  );

  const flow = useMemo(
    () => ({
      started,
      ready,
      bulk,
      signInTargets: targets.length,
      loginLaunched: loginSessionId !== null,
    }),
    [started, ready, bulk, targets.length, loginSessionId],
  );
  const phase = oneClickPhase(flow);

  // ── ① 시작하자마자 설치 ────────────────────────────────────────────────
  // 모달이 열렸다는 것 자체가 "모두 설치 + 자동 로그인" 을 누른 것이다 —
  // 모달 안에서 같은 결정을 한 번 더 묻지 않는다.
  const start = useCallback(() => {
    if (started) return;
    // 이미 준비된 사용자(다른 창에서 먼저 로그인 등)에게 설치 패스를 돌리지
    // 않는다 — 할 일이 없는데 셸 인스톨러가 도는 것으로 보인다.
    if (ready) return;
    setStarted(true);
    telemetry.cliSetupStep("install", "enter");
    actionsRef.current.installAll();
  }, [started, ready]);

  useEffect(() => {
    start();
  }, [start]);

  // ── ② 설치가 끝나면 사인인이 스스로 시작된다 ────────────────────────────
  // 이 자동 전이가 "원클릭" 의 실체다. 한 번만 띄운다(autoSignInRef): 대상 행은
  // 브라우저 승인이 끝날 때까지 미인증으로 남아 있으므로, 가드가 없으면 같은
  // 로그인을 폴 주기마다 새 터미널로 다시 띄운다.
  useEffect(() => {
    if (autoSignInRef.current) return;
    if (!shouldAutoSignIn(flow)) return;
    autoSignInRef.current = true;
    telemetry.cliSetupStep("auth", "enter");
    const model = actionsRef.current.signIn((sessionId) =>
      setLoginSessionId(sessionId),
    );
    if (model) {
      setLoginModel(model);
    } else {
      // 대상이 있다고 판정했는데 스폰이 실패했다 — 다음 렌더에서 다시 시도할 수
      // 있게 가드를 풀어 준다(수동 재시도 버튼도 같은 경로다).
      autoSignInRef.current = false;
    }
  }, [flow]);

  // ── ③ 인증되면 알린다 ──────────────────────────────────────────────────
  // 셸은 `cliReady` 로 스스로 다음 국면을 그리지만, 성공 문구를 한 박자 보여준
  // 뒤 모달을 닫아야 "무슨 일이 일어났는지" 가 화면에 남는다.
  //
  // ★콜백은 ref 로 잡고 의존성은 `ready` 하나다. 호출부가 `onClose={() => …}` 로
  // 넘기면 셸이 리렌더될 때마다(티켓 구독·프로브 폴이 계속 돈다) 이 이펙트가
  // 재실행되고, 그 cleanup 이 방금 건 타이머를 지운다 — 클린룸에서 실제로
  // 그랬다: 모달이 "연결됐어요" 에서 영영 닫히지 않았다.
  const cbRef = useRef({ onClose, onReady });
  cbRef.current = { onClose, onReady };
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      cbRef.current.onReady?.();
      cbRef.current.onClose();
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const retry = useCallback(() => {
    autoSignInRef.current = false;
    setLoginSessionId(null);
    setLoginModel(null);
    actionsRef.current.installAll();
  }, []);

  const failedRows = useMemo(
    () =>
      oneClickInstallRows(ROWS).filter(
        (r) => results[r.id]?.installed !== true,
      ),
    [results],
  );
  const firstFailed = failedRows[0];

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
                    : phase === "awaiting_auth"
                      ? "beginner.oneClick.status.awaitingAuth"
                      : phase === "sign_in"
                        ? "beginner.oneClick.status.signIn"
                        : "beginner.oneClick.status.installing",
              )}
            </p>
          </div>
          <button
            type="button"
            data-testid="beginner-oneclick-close"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-[#7f849c] transition-colors hover:bg-[#313244] hover:text-[#cdd6f4]"
            aria-label={t("beginner.oneClick.close")}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* ── 두 칸 진행 인디케이터 ─────────────────────────────────── */}
          <ol className="flex items-center gap-2">
            {STEPS.map((step, i) => {
              const isDone = step.done.includes(phase);
              const isCurrent =
                !isDone &&
                (i === 0
                  ? phase === "installing" || phase === "blocked"
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
                    {t(
                      step.key === "install"
                        ? "beginner.oneClick.step.install"
                        : "beginner.oneClick.step.auth",
                    )}
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

          {/* ── 사인인 국면: 실 터미널을 그대로 보여준다 ───────────────── */}
          {loginSessionId && phase !== "done" && (
            <div className="mt-4">
              <p className="mb-2 text-xs leading-5 text-[#a6adc8]">
                {t("beginner.oneClick.terminalHint", {
                  cli: loginModel ? cliLabel(loginModel) : "CLI",
                })}
              </p>
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
              <p className="mt-2 text-[11px] leading-5 text-[#7f849c]">
                {t("beginner.oneClick.stuck")}
              </p>
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
