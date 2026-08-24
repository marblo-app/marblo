import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import { placeAnchoredPopup } from "../../lib/anchoredPopup";
import type { MessageKey } from "../../locales/ko";
import { useOrchestratorStore } from "../../stores/orchestratorStore";
import {
  refusalMessageKey,
  writeAndSubmitAccepted,
} from "../../utils/ptyWriteAndSubmit";
import { SLASH_COMMANDS } from "../orchestrator/SlashCommandPopup";

/**
 * 첫 스폰 가이드 — 오케 터미널 경계의 얇은 재진입 바와 위쪽 팝업.
 *
 * ★접힌 바 자체가 실행 명령을 들고 있다. 첫 시작 가이드의 값은 "무엇을
 * 쳐야 하는가" 이므로, 그 네 개(/tf-add · /tf-spawn-agents · /tf-plan ·
 * /tf-start)는 접힌 상태에서도 바 위에 칩으로 보이고, 펼치지 않고 바로
 * 눌러 오케에 삽입된다.
 *
 * ★펼침은 명령을 감추는 서랍이 아니라 "언제 어느 경로를 쓰나" 를 설명하는
 * 계층이다. 그래서 패널에는 두 경로가 통째로 들어간다 — 작은 일(/tf-add →
 * /tf-spawn-agents)과 큰 일(/tf-plan → /tf-start)이 각각 무엇을 하는지
 * 한 줄씩, 그리고 전체 목록·/tf-guide 푸터. 명령이 접힌 바에도 보인다는
 * 이유로 이 설명을 덜어내면 가이드는 "칩 네 개" 로 쪼그라든다(그렇게 세 번
 * 반복됐다). 이 패널의 내용은 유닛으로 고정돼 있다 —
 * tests/unit/first-spawn-guide.test.ts.
 *
 * ★패널 안의 명령도 접힌 칩과 똑같이 눌러서 오케에 삽입된다. 설명을 읽은
 * 자리에서 바로 실행되지 않으면, 읽고 나서 다시 접고 칩을 찾아야 한다.
 *
 * ★배치: body 포탈 + position:fixed, 레일의 뷰포트 rect 기준으로 위쪽.
 * `absolute + bottom-full` 로는 안 된다 — 절대위치 요소는 containing
 * block(이 컴포넌트)의 조상이 가진 overflow:hidden 에 그대로 잘리는데,
 * 이 레일은 두 셸 모두에서 클리핑 컨테이너 상단에 박혀 있다(BeginnerShell
 * 의 하단 2분할 행, WorkspaceShell 의 터미널 열 래퍼 + 스플릿 래퍼). 그
 * 결과 위로 뜬 패널은 위쪽이 통째로 잘리고 레일에 가장 가까운 마지막 줄만
 * 남아, 설명이 "사라진" 것처럼 보였다. 오케 세션 피커가 같은 이유로 사라진
 * 적이 있고, lib/anchoredPopup.ts 가 그때 만든 house 해법이다. fixed 는
 * containing block 이 뷰포트라 조상 overflow 를 전부 벗어난다.
 *
 * ★포탈이어도 "오케 터미널 높이 불변" 계약은 그대로다 — 오히려 더 강해진다.
 * 레일만 정상 흐름에 남고 패널은 흐름 밖이라, 열고 닫아도 아래 PTY 는
 * 리사이즈되지 않는다.
 *
 * ★바는 한 줄을 넘지 않는다 — 칩은 shrink-0 으로 항상 온전히 보이고,
 * 줄어드는 쪽은 제목이다(가장 덜 급한 정보부터 접힌다).
 *
 * ★닫으면 사라지지 않는다 — 접기만 한다(collapsed, localStorage 로 유지).
 * 이게 "나중에 다시 찾을 재진입 경로" 요구를 공짜로 만족한다.
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

/** 두 경로 카드 + 푸터의 대략 높이. 뒤집기 판정에만 쓰는 추정치다. */
const PANEL_EST_HEIGHT = 208;
/** 레일이 극단적으로 좁아져도(MIN_RATIO 0.2) 문장이 읽히는 최소 폭. */
const PANEL_MIN_WIDTH = 260;

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
      // ★/tf-start 는 태스크 생성과 스폰을 한 번에 한다. 두 단계로 쪼개
      //   설명하지 말 것 — 로케일 문구가 그 계약을 들고 있다.
      { command: "/tf-start", labelKey: "onboarding.firstSpawn.big.step2" },
    ],
  },
];

interface AnchorBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function sameBox(a: AnchorBox | null, b: AnchorBox): boolean {
  return (
    a !== null &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.right === b.right
  );
}

export function FirstSpawnGuide() {
  const { t } = useTranslation();
  const ptySessionId = useOrchestratorStore((s) => s.ptySessionId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [pulse, setPulse] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<AnchorBox | null>(null);
  const guideRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  // Track the rail's viewport rect while open. The terminal column is
  // drag-resizable and the window is resizable, so a rect measured once at
  // open time goes stale; re-measuring keeps the panel glued to the rail.
  useEffect(() => {
    if (collapsed) {
      setAnchor(null);
      return;
    }

    const measure = () => {
      const rail = railRef.current;
      if (!rail) return;
      const { top, bottom, left, right } = rail.getBoundingClientRect();
      const next = { top, bottom, left, right };
      setAnchor((prev) => (sameBox(prev, next) ? prev : next));
    };

    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (observer && railRef.current) observer.observe(railRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [collapsed]);

  useEffect(() => {
    if (collapsed) return;

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      // The panel is portalled to <body>, so it is NOT inside guideRef —
      // it needs its own containment check or every click inside the guide
      // would close it.
      if (guideRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
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
          const result = await window.electronAPI.pty.writeAndSubmit(
            ptySessionId,
            command,
          );
          if (writeAndSubmitAccepted(result)) {
            setFeedback(`${command}:sent`);
          } else {
            const refusedKey = refusalMessageKey(result);
            if (refusedKey && result?.refusal) {
              setFeedback(`${command}:blocked:${result.refusal}`);
            } else {
              await navigator.clipboard.writeText(command);
              setFeedback(`${command}:copied`);
            }
          }
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
    [ptySessionId]
  );

  const actionLabel = ptySessionId
    ? t("onboarding.firstSpawn.send")
    : t("onboarding.cliGate.copy");

  const feedbackFor = (command: GuideCommand) => {
    if (feedback === `${command}:sent`) return "sent";
    if (feedback === `${command}:copied`) return "copied";
    if (feedback === `${command}:blocked:composer-occupied`) {
      return "blocked-composer-occupied";
    }
    if (feedback === `${command}:blocked:awaiting-choice`) {
      return "blocked-awaiting-choice";
    }
    return null;
  };

  const placement = anchor
    ? placeAnchoredPopup(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        Math.max(PANEL_MIN_WIDTH, anchor.right - anchor.left),
        PANEL_EST_HEIGHT,
        "left",
        // ★위쪽이 기본이다 — 레일 바로 아래가 오케 터미널이라, 아래로 열면
        //   지금 읽어야 할 대화창을 덮는다. 위쪽이 정말 좁을 때만 뒤집힌다.
        "up"
      )
    : null;

  const panelStyle: CSSProperties | null = placement && {
    position: "fixed",
    left: placement.left,
    width: placement.width,
    maxHeight: placement.maxHeight,
    ...(placement.top === undefined
      ? { bottom: placement.bottom }
      : { top: placement.top }),
  };

  const panel = !collapsed && panelStyle && (
    <div
      ref={panelRef}
      id="first-spawn-guide-body"
      data-testid="first-spawn-guide-body"
      data-direction={placement?.top === undefined ? "up" : "down"}
      style={panelStyle}
      className="z-[60] space-y-2 overflow-y-auto rounded-lg border border-[#313244] bg-[#181825] px-3 py-2.5 shadow-xl"
    >
      {/* ★두 경로 설명이 이 패널의 본체다. 최초 구현(#1050)과 같은 수준으로
          "작은 일 / 큰 일 각각 무엇을, 어떤 순서로" 를 담는다. */}
      {PATHS.map((path) => (
        <div
          key={path.id}
          data-testid={`first-spawn-guide-path-${path.id}`}
          className="rounded-md border border-[#45475a] bg-[#11111b] px-2.5 py-2"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-[#89b4fa]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#89b4fa]">
              {t(path.badgeKey)}
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-4 text-[#a6adc8]">
              {t(path.descKey)}
            </span>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {path.steps.map((step) => {
              const state = feedbackFor(step.command);
              return (
                <li key={step.command}>
                  {/* ★패널 안의 명령도 접힌 칩과 동일하게 PTY 에 삽입된다. */}
                  <button
                    type="button"
                    data-testid={`first-spawn-guide-panel-cmd-${step.command}`}
                    onClick={() => void runCommand(step.command)}
                    title={`${t(step.labelKey)} — ${actionLabel}`}
                    className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-[#313244]"
                  >
                    <code className="shrink-0 font-mono text-[11px] leading-4 text-[#a6e3a1]">
                      {step.command}
                    </code>
                    <span className="min-w-0 flex-1 text-[11px] leading-4 text-[#7f849c]">
                      {t(step.labelKey)}
                    </span>
                    <span className="shrink-0 text-[10px] leading-4 text-[#585b70]">
                      {state === "sent"
                        ? t("onboarding.firstSpawn.sent")
                        : state === "blocked-composer-occupied"
                        ? t("terminal.feedback.refused.composerOccupied")
                        : state === "blocked-awaiting-choice"
                        ? t("terminal.feedback.refused.awaitingChoice")
                        : state === "copied"
                        ? t("onboarding.cliGate.copied")
                        : actionLabel}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* 가장 덜 급한 정보 — 접힌 바가 아니라 여기에 있어야 한다. */}
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
  );

  return (
    <div
      ref={guideRef}
      data-testid="first-spawn-guide"
      data-layout="upward-overlay"
      className="relative shrink-0"
    >
      <div
        ref={railRef}
        data-testid="first-spawn-guide-rail"
        className={`flex w-full flex-nowrap items-center gap-2 overflow-hidden rounded-lg border bg-[#181825] px-2 py-1.5 transition-shadow ${
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
              : "onboarding.firstSpawn.collapse"
          )}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
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

        {/* ★칩은 접힘·펼침과 무관하게 늘 여기 있다. 폭 경쟁에서 지는 쪽은
            제목이다 — 토글이 flex-1(basis 0)이라 좁아지면 제목부터 말줄임
            되고, 칩 줄은 shrink-0 이라 명령어 문자열이 온전히 남는다.
            터미널 열은 MIN_RATIO(0.2)까지 좁아질 수 있어서, 칩만으로도
            폭을 넘는 극단에서는 max-w-full 로 잘라 내는 대신 칩 줄이
            가로로 스크롤된다 — 한 줄 계약을 지키면서 어떤 명령도 영구히
            가려지지 않게 하는 마지막 안전장치다. */}
        <div
          data-testid="first-spawn-guide-rail-commands"
          role="group"
          aria-label={t("onboarding.firstSpawn.commandsLabel")}
          className="flex max-w-full shrink-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {PATHS.map((path, index) => (
            <Fragment key={path.id}>
              {index > 0 && (
                <span className="px-0.5 text-[10px] text-[#45475a]" aria-hidden>
                  ·
                </span>
              )}
              {path.steps.map((step) => {
                const state = feedbackFor(step.command);
                return (
                  <button
                    key={step.command}
                    type="button"
                    data-testid={`first-spawn-guide-cmd-${step.command}`}
                    onClick={() => void runCommand(step.command)}
                    title={`${t(path.badgeKey)} · ${t(
                      step.labelKey
                    )} — ${actionLabel}`}
                    className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
                      state
                        ? "border-[#a6e3a1] bg-[#a6e3a1]/10 text-[#a6e3a1]"
                        : "border-[#313244] bg-[#11111b] text-[#89b4fa] hover:border-[#585b70] hover:bg-[#313244] hover:text-[#b4befe]"
                    }`}
                  >
                    {step.command}
                    {state && (
                      <span className="ml-1 text-[10px]">
                        {state === "sent"
                          ? t("onboarding.firstSpawn.sent")
                          : state === "blocked-composer-occupied"
                          ? t("terminal.feedback.refused.composerOccupied")
                          : state === "blocked-awaiting-choice"
                          ? t("terminal.feedback.refused.awaitingChoice")
                          : t("onboarding.cliGate.copied")}
                      </span>
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {panel && createPortal(panel, document.body)}
    </div>
  );
}
