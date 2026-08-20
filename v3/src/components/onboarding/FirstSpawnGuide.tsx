import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { useOrchestratorStore } from "../../stores/orchestratorStore";
import { SLASH_COMMANDS } from "../orchestrator/SlashCommandPopup";

/**
 * 첫 스폰 가이드 — 오케 터미널 경계의 얇은 재진입 바와 위쪽 오버레이.
 *
 * ★바는 정상 흐름에 남겨 재진입 경로를 제공하지만, 펼친 본문은 바의 위쪽에
 * absolute로 띄운다. 그래서 안내를 열고 닫아도 아래 오케 터미널의 위치와
 * 높이가 바뀌지 않는다.
 *
 * ★닫으면 사라지지 않는다 — 접기만 한다(collapsed, localStorage 로 유지).
 * 이게 "나중에 다시 찾을 재진입 경로" 요구를 공짜로 만족한다: 탭을 새로
 * 만들 필요 없이, 접힌 채로도 항상 같은 자리에 있다.
 *
 * ★시선 유도는 최초 1회 펄스뿐이다. 본 적이 있으면(SEEN_KEY) 조용하다 —
 * 반복 강조는 진짜 에러가 있는 자리처럼 읽힌다.
 *
 * 안내의 명령은 현재 번들에 있는 것만 허용한다. 클릭하면 설명 프롬프트가 아닌
 * 보이는 명령어 자체를 오케스트레이터에 삽입하므로, 사용자가 학습한 행동과 실제
 * 실행이 어긋나지 않는다. SlashCommandPopup 은 이번 티켓의 스코프 밖이라
 * import 만 하고 절대 수정하지 않는다.
 */

const SEEN_KEY = "marblo.firstSpawnGuide.seen";
const COLLAPSED_KEY = "marblo.firstSpawnGuide.collapsed";
const BUNDLED_COMMANDS = new Set(SLASH_COMMANDS.map(({ command }) => command));

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* 프라이빗 모드 — 이번 세션만 기억한다 */
  }
}

function readCollapsed(): boolean {
  try {
    // A missing value is a first visit, and first visits start compact. "0" is
    // deliberately persisted too, so an explicit expand choice survives restart.
    return localStorage.getItem(COLLAPSED_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    /* 프라이빗 모드 — 이번 세션만 기억한다 */
  }
}

type GuideCommand =
  | "/tf-add"
  | "/tf-spawn-agents"
  | "/tf-plan"
  | "/tf-start"
  | "/tf-guide";

interface GuideStep {
  command: GuideCommand;
  labelKey: MessageKey;
}

interface GuidePath {
  id: "small" | "big";
  badgeKey: MessageKey;
  descKey: MessageKey;
  steps: GuideStep[];
}

const PATHS: GuidePath[] = [
  {
    id: "small",
    badgeKey: "onboarding.firstSpawn.small.badge",
    descKey: "onboarding.firstSpawn.small.desc",
    steps: [
      { command: "/tf-add", labelKey: "onboarding.firstSpawn.small.step1" },
      {
        command: "/tf-spawn-agents",
        labelKey: "onboarding.firstSpawn.small.step2",
      },
    ],
  },
  {
    id: "big",
    badgeKey: "onboarding.firstSpawn.big.badge",
    descKey: "onboarding.firstSpawn.big.desc",
    steps: [
      { command: "/tf-plan", labelKey: "onboarding.firstSpawn.big.step1" },
      { command: "/tf-start", labelKey: "onboarding.firstSpawn.big.step2" },
    ],
  },
];

export function FirstSpawnGuide() {
  const { t } = useTranslation();
  const ptySessionId = useOrchestratorStore((s) => s.ptySessionId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [pulse, setPulse] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!collapsed || readFlag(SEEN_KEY)) return;
    writeFlag(SEEN_KEY, true);
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 2400);
    return () => window.clearTimeout(timer);
    // The initial compact rail is the only state that may call for attention.
    // This intentionally runs once; reopening the rail must stay quiet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (collapsed) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (guideRef.current?.contains(event.target as Node)) return;
      setCollapsed(true);
      writeCollapsed(true);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCollapsed(true);
      writeCollapsed(true);
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [collapsed]);

  const runCommand = useCallback(
    async (command: GuideCommand) => {
      // Keep the panel safe if the command bundle changes before this guide.
      if (!BUNDLED_COMMANDS.has(command)) return;

      if (ptySessionId) {
        try {
          // Insert the exact command displayed on the chip. A natural-language
          // expansion would make the "what should I type?" guide misleading.
          await window.electronAPI.pty.writeAndSubmit(ptySessionId, command);
          setFeedback(`${command}:sent`);
        } catch {
          try {
            await navigator.clipboard.writeText(command);
            setFeedback(`${command}:copied`);
          } catch {
            // Both delivery routes are unavailable; leave the guide usable.
          }
        }
      } else {
        try {
          await navigator.clipboard.writeText(command);
          setFeedback(`${command}:copied`);
        } catch {
          /* 클립보드 차단 — 칩은 그냥 비활성 반응 없이 둔다 */
        }
      }
      window.setTimeout(() => setFeedback(null), 1800);
    },
    [ptySessionId],
  );

  return (
    <div
      ref={guideRef}
      data-testid="first-spawn-guide"
      data-layout="upward-overlay"
      className={`relative shrink-0 ${collapsed ? "z-10" : "z-30"}`}
    >
      <div
        data-testid="first-spawn-guide-rail"
        className={`rounded-lg border bg-[#181825] transition-shadow ${
        pulse
          ? "border-[#89b4fa] shadow-[0_0_0_3px_rgba(137,180,250,0.35)]"
          : "border-[#313244]"
        }`}
      >
      <button
        type="button"
        data-testid="first-spawn-guide-toggle"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="first-spawn-guide-body"
        title={t(
          collapsed
            ? "onboarding.firstSpawn.expand"
            : "onboarding.firstSpawn.collapse",
        )}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
      >
        {collapsed ? (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-[#7f849c]"
            aria-hidden
          />
        ) : (
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-[#7f849c]"
            aria-hidden
          />
        )}
        <span className="truncate text-xs font-semibold text-[#cdd6f4]">
          {t("onboarding.firstSpawn.title")}
        </span>
      </button>
      </div>

      {!collapsed && (
        <div
          id="first-spawn-guide-body"
          data-testid="first-spawn-guide-body"
          className="absolute inset-x-0 bottom-full z-30 mb-1 space-y-2 rounded-lg border border-[#313244] bg-[#181825] px-3 py-2.5 shadow-xl"
        >
          {PATHS.map((path) => (
            <div
              key={path.id}
              className="rounded-md border border-[#45475a] bg-[#11111b] px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-[#89b4fa]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#89b4fa]">
                  {t(path.badgeKey)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[#a6adc8]">
                  {t(path.descKey)}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {path.steps.map((step) => {
                  const state =
                    feedback === `${step.command}:sent`
                      ? "sent"
                      : feedback === `${step.command}:copied`
                        ? "copied"
                        : null;
                  return (
                    <button
                      key={step.command}
                      type="button"
                      data-testid={`first-spawn-guide-cmd-${step.command}`}
                      onClick={() => void runCommand(step.command)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded border border-[#313244] bg-[#181825] px-2 py-1 text-left transition-colors hover:border-[#585b70] hover:bg-[#313244]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-[#a6e3a1]">
                          {step.command}
                        </span>
                        <span className="block text-[10px] leading-tight text-[#7f849c]">
                          {t(step.labelKey)}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] text-[#585b70]">
                        {state === "sent"
                          ? t("onboarding.firstSpawn.sent")
                          : state === "copied"
                            ? t("onboarding.cliGate.copied")
                            : ptySessionId
                              ? t("onboarding.firstSpawn.send")
                              : t("onboarding.cliGate.copy")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <p className="text-[11px] leading-5 text-[#7f849c]">
            {t("onboarding.firstSpawn.allCommands")}{" "}
            {t("onboarding.firstSpawn.guideHint")}{" "}
            <button
              type="button"
              data-testid="first-spawn-guide-cmd-/tf-guide"
              onClick={() => void runCommand("/tf-guide")}
              className="font-mono text-[#89b4fa] underline decoration-dotted hover:text-[#74c7ec]"
            >
              /tf-guide
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
