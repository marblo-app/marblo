/**
 * @vitest-environment jsdom
 *
 * FirstSpawnGuide — connect 직후 오케스트레이터 창 위의 인라인 재진입 안내.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FirstSpawnGuide } from "../../src/components/onboarding/FirstSpawnGuide";
import { SLASH_COMMANDS } from "../../src/components/orchestrator/SlashCommandPopup";
import { useLocaleStore } from "../../src/lib/i18n";
import { en } from "../../src/locales/en";
import { ko } from "../../src/locales/ko";
import { useOrchestratorStore } from "../../src/stores/orchestratorStore";

const COLLAPSED_KEY = "marblo.firstSpawnGuide.collapsed";
const SEEN_KEY = "marblo.firstSpawnGuide.seen";
const RAIL_COMMANDS = [
  "/tf-add",
  "/tf-spawn-agents",
  "/tf-plan",
  "/tf-start",
];
const GUIDE_COMMANDS = [...RAIL_COMMANDS, "/tf-guide"];

function commandsIn(scope: ParentNode): (string | undefined)[] {
  return [...scope.querySelectorAll("[data-testid^='first-spawn-guide-cmd-']")].map(
    (element) => element.getAttribute("data-testid")?.replace("first-spawn-guide-cmd-", ""),
  );
}

function panelCommandsIn(scope: ParentNode): (string | undefined)[] {
  return [
    ...scope.querySelectorAll("[data-testid^='first-spawn-guide-panel-cmd-']"),
  ].map((element) =>
    element
      .getAttribute("data-testid")
      ?.replace("first-spawn-guide-panel-cmd-", ""),
  );
}

/**
 * Put the rail somewhere real in the viewport.
 *
 * jsdom reports a zero rect for everything, and the panel is placed against
 * the rail's viewport rect — so the upward-direction contract can only be
 * asserted with a rect that actually leaves room above.
 */
function stubRailRect(box: {
  top: number;
  bottom: number;
  left: number;
  right: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => box,
  } as DOMRect);
}

function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    },
  });
  return map;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installMemoryStorage();
  useLocaleStore.setState({ locale: "ko" });
  useOrchestratorStore.setState({ ptySessionId: null });
});

afterEach(() => {
  cleanup();
  storage.clear();
  vi.restoreAllMocks();
});

describe("FirstSpawnGuide", () => {
  it("작은 일·큰 일·도움말의 정확한 번들 명령만, 순서대로 표시한다", () => {
    render(createElement(FirstSpawnGuide));

    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));

    const commands = commandsIn(document);
    expect(commands).toEqual(GUIDE_COMMANDS);
    expect(GUIDE_COMMANDS.every((command) => SLASH_COMMANDS.some((item) => item.command === command))).toBe(true);
    expect(commands).not.toContain("/tf-spawn");
  });

  it("첫 진입은 접힌 한 줄이고, 펼침 선택을 다시 열어도 기억한다", () => {
    const firstRender = render(createElement(FirstSpawnGuide));

    const toggle = screen.getByTestId("first-spawn-guide-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(storage.get(COLLAPSED_KEY)).toBe("0");

    firstRender.unmount();
    render(createElement(FirstSpawnGuide));
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(storage.get(COLLAPSED_KEY)).toBe("1");
  });

  // ★계약: 펼침은 레일 "위쪽" 으로 열리고, 오케 터미널의 위치·높이는 그대로다.
  //
  // 그 계약을 `absolute + bottom-full` 로 구현했더니 사장님 화면에서 패널이
  // 잘렸다 — 절대위치 요소는 containing block 의 조상이 가진 overflow:hidden
  // 에 그대로 잘리는데, 이 레일은 두 셸 모두에서 클리핑 컨테이너 상단에 박혀
  // 있다(BeginnerShell 하단 2분할 행, WorkspaceShell 터미널 열 래퍼). 위쪽이
  // 통째로 잘리고 레일에 가장 가까운 마지막 줄만 남아 설명이 사라져 보였다.
  // 그래서 배치는 body 포탈 + position:fixed 다(lib/anchoredPopup 의 house
  // 해법). 여기서 고정하는 건 클래스 이름이 아니라 그 계약이다.
  it("펼친 본문은 body 포탈 + fixed 라 조상 overflow:hidden 에 잘리지 않고, 레일 위쪽으로 열린다", () => {
    stubRailRect({ top: 600, bottom: 628, left: 20, right: 420 });
    render(createElement(FirstSpawnGuide));

    const guide = screen.getByTestId("first-spawn-guide");
    const rail = screen.getByTestId("first-spawn-guide-rail");
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    const body = screen.getByTestId("first-spawn-guide-body");

    expect(guide.dataset.layout).toBe("upward-overlay");

    // 잘림 탈출: 패널은 guide 밖(=클리핑 조상 밖)에 있고 fixed 다.
    expect(body.parentElement).toBe(document.body);
    expect(guide.contains(body)).toBe(false);
    expect(body.style.position).toBe("fixed");

    // 위쪽: 레일 위에 여유가 있으면 up 으로 열고 bottom 으로 앵커한다.
    expect(body.dataset.direction).toBe("up");
    expect(body.style.bottom).toBe(`${window.innerHeight - 600 + 4}px`);
    expect(body.style.top).toBe("");

    // 오케 터미널 높이 불변: guide 의 정상 흐름 자식은 레일 하나뿐이다.
    expect(guide.children.length).toBe(1);
    expect(guide.firstElementChild).toBe(rail);
  });

  it("위쪽 공간이 정말 없으면 화면 밖으로 사라지는 대신 아래로 뒤집는다", () => {
    stubRailRect({ top: 8, bottom: 36, left: 20, right: 420 });
    render(createElement(FirstSpawnGuide));

    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    const body = screen.getByTestId("first-spawn-guide-body");

    expect(body.dataset.direction).toBe("down");
    expect(body.style.top).toBe("40px");
    expect(Number.parseInt(body.style.maxHeight, 10)).toBeGreaterThan(0);
  });

  it("바깥 클릭과 Escape로 펼친 패널을 닫는다", () => {
    render(createElement(FirstSpawnGuide));
    const toggle = screen.getByTestId("first-spawn-guide-toggle");

    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("칩 클릭은 보이는 명령 자체를 오케스트레이터에 삽입한다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    fireEvent.click(screen.getByTestId("first-spawn-guide-cmd-/tf-start"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-start");
    });
  });

  it("★접힌 상태에서도 실행 명령 넷이 바 위에 보이고, 덜 급한 안내는 펼침 안에 있다", () => {
    render(createElement(FirstSpawnGuide));

    const rail = screen.getByTestId("first-spawn-guide-rail");
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();

    // 명령어 문자열 자체가 접힌 상태에 노출된다 — 칩 순서도 작은일→큰일.
    expect(commandsIn(rail)).toEqual(RAIL_COMMANDS);
    for (const command of RAIL_COMMANDS) {
      expect(screen.getByTestId(`first-spawn-guide-cmd-${command}`).textContent).toContain(command);
    }

    // 한 줄 계약: 바는 줄바꿈하지 않는다. 폭이 모자라면 칩 줄이 가로로
    // 스크롤될 뿐, 칩 자체는 줄어들거나 잘리지 않는다.
    expect(rail.className).toContain("flex-nowrap");
    expect(rail.className).toContain("overflow-hidden");
    const chipRow = screen.getByTestId("first-spawn-guide-rail-commands");
    expect(chipRow.className).toContain("overflow-x-auto");
    for (const command of RAIL_COMMANDS) {
      const chip = screen.getByTestId(`first-spawn-guide-cmd-${command}`);
      expect(chip.className).toContain("shrink-0");
      expect(chip.className).toContain("whitespace-nowrap");
    }

    // 가장 덜 급한 '전체 목록 / tf-guide' 안내는 접힌 바에 없다.
    const allCommands = ko["onboarding.firstSpawn.allCommands"];
    expect(rail.textContent).not.toContain(allCommands);
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    expect(screen.getByTestId("first-spawn-guide-body").textContent).toContain(allCommands);
  });

  it("접힌 채로 칩을 눌러도 펼치지 않고 곧바로 오케에 삽입한다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-cmd-/tf-spawn-agents"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-spawn-agents");
    });
    expect(screen.getByTestId("first-spawn-guide-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("first-spawn-guide-body")).toBeNull();
  });

  it("처음 한 번만 펄스를 표시한다", () => {
    render(createElement(FirstSpawnGuide));
    expect(storage.get(SEEN_KEY)).toBe("1");
    expect(screen.getByTestId("first-spawn-guide-rail").className).toContain("shadow-[0_0_0_3px");
  });

  // ★★이 파일에서 가장 중요한 테스트다.
  //
  // 이 가이드는 "무엇을 쳐야 하는가" 를 가르치는 물건이고, 그 값의 대부분은
  // 명령어 네 글자가 아니라 "작은 일이면 이 경로, 큰 일이면 저 경로" 라는
  // 설명에 있다. 그런데 레일에 칩을 얹는 손질을 할 때마다 "명령은 이미
  // 보이니까" 라는 이유로 펼침 설명이 얇아졌고, 세 번 연속으로 사장님이
  // 같은 지적을 하셨다(#1050 에서 넣은 두 경로가 결국 푸터 한 줄만 남았다).
  //
  // 그래서 패널 내용을 여기에 못박는다. 두 경로 카드가 각각 배지 · 한 줄
  // 요약 · 단계별 설명을 갖고, 그 단계가 실제 번들 명령이며, 푸터가 붙어
  // 있어야 한다. 이 중 하나라도 지우면 이 테스트가 먼저 깨진다.
  it("★펼침 패널은 두 경로 설명을 통째로 담는다 — 배지·요약·단계별 한 줄·푸터", () => {
    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    const body = screen.getByTestId("first-spawn-guide-body");

    const expected = [
      {
        id: "small",
        badge: ko["onboarding.firstSpawn.small.badge"],
        desc: ko["onboarding.firstSpawn.small.desc"],
        steps: [
          ["/tf-add", ko["onboarding.firstSpawn.small.step1"]],
          ["/tf-spawn-agents", ko["onboarding.firstSpawn.small.step2"]],
        ],
      },
      {
        id: "big",
        badge: ko["onboarding.firstSpawn.big.badge"],
        desc: ko["onboarding.firstSpawn.big.desc"],
        steps: [
          ["/tf-plan", ko["onboarding.firstSpawn.big.step1"]],
          ["/tf-start", ko["onboarding.firstSpawn.big.step2"]],
        ],
      },
    ];

    for (const path of expected) {
      const card = screen.getByTestId(`first-spawn-guide-path-${path.id}`);
      expect(body.contains(card)).toBe(true);
      expect(card.textContent).toContain(path.badge);
      expect(card.textContent).toContain(path.desc);

      for (const [command, label] of path.steps) {
        const row = screen.getByTestId(
          `first-spawn-guide-panel-cmd-${command}`,
        );
        expect(card.contains(row)).toBe(true);
        expect(row.textContent).toContain(command);
        expect(row.textContent).toContain(label);
      }
    }

    // 푸터 — 전체 목록 + /tf-guide.
    expect(body.textContent).toContain(ko["onboarding.firstSpawn.allCommands"]);
    expect(body.textContent).toContain(ko["onboarding.firstSpawn.guideHint"]);
    expect(screen.getByTestId("first-spawn-guide-cmd-/tf-guide")).toBeTruthy();

    // 패널이 쓰는 명령은 레일 칩과 같은 넷, 같은 순서 — 전부 번들 안이다.
    // ★/tf-spawn 은 번들에 없다(slash-command-bundle-parity 가 잡는다).
    const panelCommands = panelCommandsIn(body);
    expect(panelCommands).toEqual(RAIL_COMMANDS);
    for (const command of panelCommands) {
      expect(SLASH_COMMANDS.some((item) => item.command === command)).toBe(true);
    }

    // ★/tf-start 는 티켓 생성과 스폰을 "한 번에" 한다 — 두 단계로 쪼개
    //   설명하면 안 된다. ko·en 양쪽 문구가 그 계약을 들고 있다.
    expect(ko["onboarding.firstSpawn.big.step2"]).toContain("한 번에");
    expect(en["onboarding.firstSpawn.big.step2"]).toContain("+");
    expect(en["onboarding.firstSpawn.big.desc"]).toContain("one shot");

    // en 에서도 설명이 비어 있지 않다(locale-parity 는 키만 본다).
    for (const key of [
      "onboarding.firstSpawn.small.badge",
      "onboarding.firstSpawn.small.desc",
      "onboarding.firstSpawn.big.badge",
      "onboarding.firstSpawn.big.desc",
      "onboarding.firstSpawn.allCommands",
      "onboarding.firstSpawn.guideHint",
    ] as const) {
      expect(en[key].trim().length).toBeGreaterThan(0);
      expect(ko[key].trim().length).toBeGreaterThan(0);
    }
  });

  it("펼침 안의 명령도 접힘 칩과 똑같이 오케에 삽입된다", async () => {
    const writeAndSubmit = vi.fn(async () => undefined);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { pty: { writeAndSubmit } },
    });
    useOrchestratorStore.setState({ ptySessionId: "orch-1" });

    render(createElement(FirstSpawnGuide));
    fireEvent.click(screen.getByTestId("first-spawn-guide-toggle"));
    fireEvent.click(screen.getByTestId("first-spawn-guide-panel-cmd-/tf-plan"));

    await vi.waitFor(() => {
      expect(writeAndSubmit).toHaveBeenCalledWith("orch-1", "/tf-plan");
    });
    // 설명을 읽던 자리에서 실행된다 — 패널이 닫히지 않는다.
    expect(screen.getByTestId("first-spawn-guide-body")).toBeTruthy();
  });
});
