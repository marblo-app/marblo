import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import TerminalView from "../terminal/TerminalView";
import { CommandBox } from "../onboarding/CliSetupRows";
import {
  oneClickInstallRows,
  pendingInstallRows,
} from "../../lib/oneClickSetup";
import {
  DOCS_URL,
  ROWS,
  UPDATE_CMD,
  type CliModel,
  type CliRow,
} from "../../stores/cliSetupStore";
import { useOnboardingSetup } from "../../hooks/useOnboardingSetup";
import { useOnboardingPreviewStore } from "../../stores/onboardingPreviewStore";
import telemetry from "../../services/telemetryService";
import { OnrampDecomposeCard } from "../onboarding/OnrampDecomposeCard";
import { PreviewTerminal } from "./PreviewTerminal";
import { BUTTON_GHOST, BUTTON_PRIMARY, emphasize } from "./beginnerUi";

/**
 * 비기너 진입 게이트 — **하나만** 연결하면 통과.
 *
 * 판정은 기존 규칙 그대로다: `ORCHESTRATOR_CLI_IDS` 중 하나라도
 * installed && authenticated 이면 준비 완료(#579 `.some`). 둘 다 요구하지 않는다 —
 * 하나만 있어도 오케를 태울 수 있다는 게 코드의 규칙이고, 이 화면은 그걸 문구로도
 * 못박는다. 통과 판정 자체는 부모(BeginnerShell)가 `cliSetupStore.ready` 로 읽고,
 * 여기서는 "어느 쪽을 연결할까" 만 묻는다.
 *
 * ★주 경로는 **원클릭 모달**이다(티켓 1F0D8hH5): "모두 설치 + 자동 로그인" 한 번이
 * 미설치 CLI 를 일괄 설치하고, 끝나는 대로 오케 후보 하나의 로그인 터미널을
 * 스스로 띄운다. 신규 유저가 내려야 할 결정이 0 이 되는 지점이라 이게 먼저 서고,
 * 아래 택1 카드는 "직접 고르고 싶은 사람" 용 폴백으로 내려간다. 두 경로 모두
 * #870 이 뽑은 공용 로직(`lib/oneClickSetup` · `services/cliSetupActions`)을 쓴다 —
 * 이 파일에는 설치·로그인 규칙의 사본이 없다.
 *
 * ★인라인 터미널이 핵심이다. `launchLogin` 은 실 터미널 세션을 띄우고
 * `claude login` / `codex login` 을 타이핑하는데, 비기너 셸에는 터미널 열이 없다.
 * CLI 가 인쇄하는 인증 URL·키 입력 프롬프트를 유저가 못 보면 로그인은 그 자리에서
 * 끝난다 — 그래서 그 세션을 이 카드 **안에** 임베드한다.
 *
 * 인증 성립 감지는 `useCliSetupEngine` 의 자동 재확인 폴(`loginRunning`)이 한다.
 * 수동 "다시 확인" 은 폴백으로 남긴다.
 *
 * BYOM(벤더 키) 경로는 여기 넣지 않는다: 비기너의 정의가 선택지를 줄이는 것이라
 * 택1 카드 2장이 상한이고, BYOM 은 어드밴스드의 시작하기 탭에서 계속 지원된다.
 */
const CHOICES: Array<{
  row: CliRow;
  nameKey: "beginner.connect.claudeName" | "beginner.connect.codexName";
  descKey: "beginner.connect.claudeDesc" | "beginner.connect.codexDesc";
}> = [
  {
    row: ROWS.find((r) => r.model === "claude")!,
    nameKey: "beginner.connect.claudeName",
    descKey: "beginner.connect.claudeDesc",
  },
  {
    row: ROWS.find((r) => r.model === "codex")!,
    nameKey: "beginner.connect.codexName",
    descKey: "beginner.connect.codexDesc",
  },
];

export function BeginnerConnectStep({
  onWatchDemo,
  onOneClick,
}: {
  onWatchDemo: () => void;
  /**
   * 원클릭 모달을 연다. ★모달 자체는 **셸**이 든다 — 인증이 성립하는 순간 셸이
   * 이 연결 게이트를 폴더 게이트로 갈아치우므로, 모달이 여기 달려 있으면 성공
   * 표시가 뜨자마자 통째로 언마운트된다(화면이 뚝 끊긴다). 다른 오버레이(투어·
   * 승격·데모)와 같은 층에 두는 게 이 셸의 규칙이기도 하다.
   */
  onOneClick: () => void;
}) {
  const { t } = useTranslation();
  // ★값은 전부 이 뷰모델에서 온다 — 실제 흐름과 온보딩 프리뷰(시연)가 여기서
  // 갈린다(hooks/useOnboardingSetup). 프리뷰일 때는 설치 IPC 도 PTY 스폰도
  // 일어나지 않는다.
  const setup = useOnboardingSetup();
  const states = setup.states;
  const results = setup.results;
  const installErrors = setup.installErrors;
  const installingId = setup.installing;
  const previewStage = useOnboardingPreviewStore((s) => s.stage);

  const [picked, setPicked] = useState<CliModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null);

  const connect = useCallback(
    async (row: CliRow) => {
      if (busy) return;
      setBusy(true);
      setPicked(row.model);
      telemetry.cliSetupStep("auth", "enter");
      try {
        // 아직 안 깔렸으면 먼저 깐다. 백그라운드 자동설치(useCliSetupEngine)가
        // 돌고 있을 수도 있지만, 유저가 지금 이 카드를 눌렀다는 건 그게 아직
        // 안 끝났다는 뜻이라 여기서 명시적으로 기다린다.
        if (!setup.readResults()[row.id]?.installed) {
          await setup.installOne(row);
        }
        // 로그인 명령은 `launchLogin` 안의 `loginCommandFor` 가 정한다(프로브의
        // action 이 실은 **설치** 명령이거나 에러 문자열일 때의 폴백이 거기 있다).
        // 예전엔 여기서 `${model} login` 을 직접 조립했는데, 그건 그 규칙의 두
        // 번째 사본이었다 — codex 예외를 여기서만 손보다 어긋나기 딱 좋은 자리다.
        const sessionId = await setup.login(
          row.model,
          setup.results[row.id]?.action,
        );
        setLoginSessionId(sessionId);
      } catch {
        // 설치·스폰 실패 — 아래 수동 안내(UPDATE_CMD + 공식문서)가 폴백이 된다.
      } finally {
        setBusy(false);
      }
    },
    [busy, setup],
  );

  const anyChecking = ROWS.some((r) => states[r.id]?.checking);
  // 아직 아무 프로브도 안 끝났다 — 이 순간의 "설치 안 됨" 은 사실이 아니라
  // "아직 모른다" 다. 버튼을 그리되 확인 중임을 말해 준다.
  const probing = useMemo(
    () => CHOICES.every(({ row }) => !results[row.id]),
    [results],
  );
  const pendingInstalls = useMemo(
    () => pendingInstallRows(oneClickInstallRows(ROWS), results).length,
    [results],
  );
  // 픽한 행의 설치 실패 — 예전에는 catch 가 삼키고 아무것도 안 그렸다.
  const pickedRow = CHOICES.find((c) => c.row.model === picked)?.row;
  const pickedError = pickedRow ? installErrors[pickedRow.id] : "";

  return (
    <section
      data-testid="beginner-connect"
      className="mx-auto w-full max-w-2xl rounded-lg border border-[#313244] bg-[#181825] p-6"
    >
      <h1 className="text-lg font-semibold text-[#cdd6f4]">
        {t("beginner.connect.title")}
      </h1>
      {/* ★문구에 `**둘 중 하나만**` 강조가 들어 있다 — 별표가 그대로 보이지
          않게 <strong> 으로 쪼개 그린다(beginnerUi.emphasize). */}
      <p
        data-testid="beginner-connect-subtitle"
        className="mt-1.5 text-sm leading-6 text-[#a6adc8]"
      >
        {emphasize(t("beginner.connect.subtitle"))}
      </p>

      {/* ── ★L0: 연결 **전에** 먼저 값을 준다 (온램프 사다리 #886 §4) ─────
          사다리의 0층은 "내 말이 진짜 티켓이 된다" 이고, 그건 계정 없이도 된다.
          그래서 연결 카드보다 **위**에 선다 — 자격증명을 요구하기 전에 한 번은
          제품이 무엇인지 보여준다는 게 이 설계의 순서다(불변식 I2 는 그다음
          문을 항상 원가 0인 L1 으로 가리킨다).

          ★프리뷰(시연)에서는 그리지 않는다: 이 카드는 실제 Firestore 티켓을
          만들고, 프리뷰의 계약은 "실제 상태를 건드리지 않는다" 이다. */}
      {!setup.preview && (
        <div className="mt-5">
          <OnrampDecomposeCard surface="beginner_connect" />
        </div>
      )}

      {/* ── ★주 경로: 원클릭 ─────────────────────────────────────────────
          한 번 누르면 설치 → 로그인까지 이어진다. 아래 택1 카드는 이걸
          거절한 사람을 위한 길이라 시각적으로도 한 단 낮춘다. */}
      <div
        data-testid="beginner-oneclick-cta-card"
        className="mt-5 rounded-lg border border-[#89b4fa]/30 bg-[#89b4fa]/5 p-4"
      >
        <p className="text-sm font-semibold text-[#cdd6f4]">
          {t("beginner.oneClick.ctaTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-[#a6adc8]">
          {t("beginner.oneClick.ctaBody")}
        </p>
        <button
          type="button"
          data-testid="beginner-oneclick-cta"
          onClick={onOneClick}
          disabled={busy}
          className={`mt-3 ${BUTTON_PRIMARY}`}
        >
          {t("beginner.oneClick.cta")}
        </button>
        <p className="mt-2 text-[11px] text-[#7f849c]">
          {probing
            ? t("beginner.connect.checking")
            : pendingInstalls > 0
              ? t("beginner.oneClick.ctaPending", { count: pendingInstalls })
              : t("beginner.oneClick.ctaNothingToInstall")}
        </p>
      </div>

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6c7086]">
        {t("beginner.connect.pickYourself")}
      </p>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {CHOICES.map(({ row, nameKey, descKey }) => {
          const state = states[row.id];
          const ready = !!state?.installed && !!state?.authenticated;
          const isPicked = picked === row.model;
          const installing = installingId === row.id;
          return (
            <div
              key={row.id}
              data-testid={`beginner-connect-${row.model}`}
              className={`rounded-lg border p-4 transition-colors ${
                ready
                  ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/5"
                  : isPicked
                    ? "border-[#89b4fa]/50 bg-[#11111b]"
                    : "border-[#45475a] bg-[#11111b]"
              }`}
            >
              <p className="text-sm font-semibold text-[#cdd6f4]">
                {t(nameKey)}
              </p>
              <p className="mt-1 min-h-[2.5rem] text-xs leading-5 text-[#7f849c]">
                {t(descKey)}
              </p>
              {ready ? (
                <p className="mt-2 text-xs font-medium text-[#a6e3a1]">
                  ✓ {t("beginner.connect.ready")}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect(row)}
                  disabled={busy}
                  className="mt-2 w-full rounded-md border border-[#45475a] px-3 py-2 text-xs font-medium text-[#cdd6f4] transition-colors hover:border-[#585b70] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {installing
                    ? t("beginner.connect.installing")
                    : isPicked && busy
                      ? t("beginner.connect.connecting")
                      : t("beginner.connect.cta")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 택1 경로의 설치 실패 — 수동 명령 + 공식 문서로 넘긴다. */}
      {pickedRow && pickedError && (
        <div
          data-testid="beginner-connect-install-error"
          className="mt-4 rounded-md border border-[#f38ba8]/30 bg-[#f38ba8]/5 p-3"
        >
          <p className="text-xs font-medium text-[#f38ba8]">
            {t("beginner.connect.installFail")}
          </p>
          <p className="mt-1 break-words text-[11px] leading-5 text-[#a6adc8]">
            {pickedError}
          </p>
          <CommandBox cmd={UPDATE_CMD[pickedRow.model]} />
          <a
            href={DOCS_URL[pickedRow.model]}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-xs text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
          >
            {t("beginner.connect.officialDocs")} ↗
          </a>
        </div>
      )}

      {/* 인증이 진행되는 실 터미널 — 숨기면 유저가 인증 URL 을 못 본다. */}
      {loginSessionId && (
        <div className="mt-5">
          <p className="mb-2 text-xs text-[#a6adc8]">
            {t("beginner.connect.terminalHint")}
          </p>
          {/* ★`relative` 가 필수다(선재 버그). TerminalView 는 `absolute inset-0`
              이라 positioned 조상이 없으면 이 박스를 뚫고 나가 화면 전체를
              덮는다 — 로그인 터미널이 뜨는 순간 앱이 통째로 사라져 보였다. */}
          <div
            data-testid="beginner-connect-terminal"
            className="relative h-64 overflow-hidden rounded-md border border-[#45475a] bg-[#11111b] p-2"
          >
            {/* 프리뷰(시연)에서는 실 PTY 를 띄우지 않는다 — 같은 자리에 대본을
                재생한다(부수효과 0). 규격은 실물과 같게 둔다. */}
            {setup.preview ? (
              <PreviewTerminal
                model={picked ?? "claude"}
                stage={previewStage}
              />
            ) : (
              <TerminalView sessionId={loginSessionId} isActive />
            )}
          </div>
          <p className="mt-2 text-[11px] text-[#7f849c]">
            {t("beginner.connect.stuck")}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="beginner-connect-recheck"
          onClick={setup.recheck}
          disabled={anyChecking}
          className={BUTTON_GHOST}
        >
          {anyChecking
            ? t("beginner.connect.checking")
            : t("beginner.connect.recheck")}
        </button>
        <button type="button" onClick={onWatchDemo} className={BUTTON_GHOST}>
          ▶ {t("beginner.connect.watchDemo")}
        </button>
      </div>
    </section>
  );
}
