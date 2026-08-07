import { useCallback, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import TerminalView from "../terminal/TerminalView";
import { launchLogin } from "../../services/cliSetupActions";
import {
  ROWS,
  useCliSetupStore,
  type CliModel,
  type CliRow,
} from "../../stores/cliSetupStore";
import { useTerminalStore } from "../../stores/terminalStore";
import telemetry from "../../services/telemetryService";

/**
 * 비기너 진입 게이트 — **하나만** 연결하면 통과.
 *
 * 판정은 기존 규칙 그대로다: `ORCHESTRATOR_CLI_IDS` 중 하나라도
 * installed && authenticated 이면 준비 완료(#579 `.some`). 둘 다 요구하지 않는다 —
 * 하나만 있어도 오케를 태울 수 있다는 게 코드의 규칙이고, 이 화면은 그걸 문구로도
 * 못박는다. 통과 판정 자체는 부모(BeginnerShell)가 `cliSetupStore.ready` 로 읽고,
 * 여기서는 "어느 쪽을 연결할까" 만 묻는다.
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
}: {
  onWatchDemo: () => void;
}) {
  const { t } = useTranslation();
  const states = useCliSetupStore((s) => s.states);
  const installingId = useCliSetupStore((s) => s.installing);
  const runInstall = useCliSetupStore((s) => s.runInstall);
  const probeAll = useCliSetupStore((s) => s.probeAll);

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
        if (!useCliSetupStore.getState().results[row.id]?.installed) {
          await runInstall(row);
        }
        const cmd =
          useCliSetupStore.getState().results[row.id]?.action ||
          `${row.model === "codex" ? "codex" : row.model} login`;
        await launchLogin(row.model, cmd);
        // launchLogin 은 세션 id 를 돌려주지 않는다(모달·탭은 전역 터미널 패널을
        // 쓰므로 필요가 없었다). 방금 만든 세션이 곧 active 이므로 거기서 집는다.
        setLoginSessionId(useTerminalStore.getState().activeSessionId);
      } catch {
        // 설치·스폰 실패 — 아래 수동 안내(UPDATE_CMD)가 그대로 폴백이 된다.
      } finally {
        setBusy(false);
      }
    },
    [busy, runInstall],
  );

  const anyChecking = ROWS.some((r) => states[r.id]?.checking);

  return (
    <section
      data-testid="beginner-connect"
      className="mx-auto w-full max-w-2xl rounded-lg border border-[#313244] bg-[#181825] p-6"
    >
      <h1 className="text-lg font-semibold text-[#cdd6f4]">
        {t("beginner.connect.title")}
      </h1>
      <p className="mt-1.5 text-sm leading-6 text-[#a6adc8]">
        {t("beginner.connect.subtitle")}
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
                  className="mt-2 w-full rounded-md bg-[#89b4fa] px-3 py-2 text-xs font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* 인증이 진행되는 실 터미널 — 숨기면 유저가 인증 URL 을 못 본다. */}
      {loginSessionId && (
        <div className="mt-5">
          <p className="mb-2 text-xs text-[#a6adc8]">
            {t("beginner.connect.terminalHint")}
          </p>
          <div
            data-testid="beginner-connect-terminal"
            className="h-64 overflow-hidden rounded-md border border-[#45475a] bg-[#11111b] p-2"
          >
            <TerminalView sessionId={loginSessionId} isActive />
          </div>
          <p className="mt-2 text-[11px] text-[#7f849c]">
            {t("beginner.connect.stuck")}
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void probeAll()}
          disabled={anyChecking}
          className="rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-60"
        >
          {anyChecking
            ? t("beginner.connect.checking")
            : t("beginner.connect.recheck")}
        </button>
        <button
          type="button"
          onClick={onWatchDemo}
          className="rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
        >
          ▶ {t("beginner.connect.watchDemo")}
        </button>
      </div>
    </section>
  );
}
