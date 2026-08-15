/**
 * @vitest-environment jsdom
 *
 * ★비기너 에이전트 터미널 — "누가 뭐하나" 의 다음 질문에 답하는 화면.
 *
 * 재시연에서 사장님이 에이전트를 누르셨는데 아무 일도 없었다. 미니 패널(#879)이
 * 상태 점과 담당 티켓까지 보여 주고서 "그래서 지금 뭘 하고 있는데?" 에 답하지
 * 않으면, 이 패널도 눌리지 않던 미니 보드처럼 그림으로 읽힌다.
 *
 * 여기서 못박는 건 셋이다:
 *   ① 행을 누르면 그 **에이전트**가 열린다 (터미널)
 *   ② 티켓 줄을 누르면 그 **티켓**이 열린다 — 행 클릭이 함께 터지지 않는다
 *      (한 행에 목적지가 둘이라, stopPropagation 이 빠지면 둘 다 열린다)
 *   ③ 터미널은 어드밴스드와 **같은 PTY 세션**을 문다 — 짝짓기 규칙은
 *      `lib/agentTerminal` 하나이고, 못 찾으면 빈 화면 대신 이유를 말한다
 *
 * 실제 xterm 은 태우지 않는다(jsdom 에 캔버스도 PTY 도 없다). 계약의 경계는
 * "TerminalView 에 어떤 sessionId 가 갔는가" 이므로 그걸 스텁으로 관측한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("../../src/components/terminal/TerminalView", () => ({
  default: ({ sessionId }: { sessionId: string }) =>
    createElement("div", {
      "data-testid": "stub-terminal",
      "data-session-id": sessionId,
    }),
}));

import { BeginnerAgentsPane } from "../../src/components/beginner/BeginnerAgentsPane";
import { BeginnerAgentTerminalModal } from "../../src/components/beginner/BeginnerAgentTerminalModal";
import { findAgentPtySessionId } from "../../src/lib/agentTerminal";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import type { Agent } from "../../src/types/agent";
import type { Task } from "../../src/types/task";

function agent(name: string, extra: Partial<Agent> = {}): Agent {
  return {
    id: `agent-${name}`,
    projectId: "p1",
    ownerId: "u1",
    name,
    model: "claude",
    spawnedModel: "claude-fable-5",
    role: "frontend",
    status: "working",
    currentTaskId: null,
    command: "claude",
    skillFile: "",
    createdAt: new Date(0),
    ...extra,
  };
}

function task(id: string, title: string): Task {
  return {
    id,
    projectId: "p1",
    contextId: "",
    title,
    description: "",
    status: "IN_PROGRESS",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-프론트-1",
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

afterEach(() => cleanup());

// ── 짝짓기 규칙 (어드밴스드 에이전트 탭과 공유) ─────────────────────────────
describe("에이전트 → PTY 세션 짝짓기", () => {
  it("attachSession 이 붙이는 라벨 형식을 모두 받는다", () => {
    const sessions = [
      { id: "s1", name: "Agent: 백엔드-1", isAgent: true },
      { id: "s2", name: "🟣 프론트-1", isAgent: true },
      { id: "s3", name: "🟢 테스트-1", isAgent: true },
    ];
    expect(findAgentPtySessionId(sessions, "백엔드-1")).toBe("s1");
    expect(findAgentPtySessionId(sessions, "프론트-1")).toBe("s2");
    expect(findAgentPtySessionId(sessions, "테스트-1")).toBe("s3");
  });

  it("유저가 연 일반 터미널은 에이전트 세션이 아니다", () => {
    const sessions = [{ id: "s9", name: "Terminal 1 프론트-1" }];
    expect(findAgentPtySessionId(sessions, "프론트-1")).toBeUndefined();
  });

  it("아직 안 붙었으면 undefined — 호출부가 빈 상태를 그린다", () => {
    expect(findAgentPtySessionId([], "프론트-1")).toBeUndefined();
    expect(
      findAgentPtySessionId(
        [{ id: "s1", name: "🟣 프론트-1", isAgent: true }],
        "",
      ),
    ).toBeUndefined();
  });
});

// ── 패널의 두 목적지 ────────────────────────────────────────────────────────
describe("비기너 에이전트 패널 — 행 클릭", () => {
  it("★행을 누르면 그 에이전트의 터미널이 열린다 (지금까지는 아무 일도 없었다)", () => {
    useLocaleStore.setState({ locale: "ko" });
    const onAgentClick = vi.fn();
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("프론트-1")],
        tasks: [],
        onAgentClick,
      }),
    );

    fireEvent.click(screen.getByTestId("beginner-agent-row"));
    expect(onAgentClick).toHaveBeenCalledTimes(1);
    expect(onAgentClick.mock.calls[0][0].name).toBe("프론트-1");
  });

  it("★티켓 줄은 티켓으로만 간다 — 행 클릭이 함께 터지지 않는다", () => {
    useLocaleStore.setState({ locale: "ko" });
    const onAgentClick = vi.fn();
    const onTaskClick = vi.fn();
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("프론트-1", { currentTaskId: "t1" })],
        tasks: [task("t1", "가이드 초안")],
        onAgentClick,
        onTaskClick,
      }),
    );

    fireEvent.click(screen.getByTestId("beginner-agent-task"));
    expect(onTaskClick).toHaveBeenCalledTimes(1);
    // stopPropagation 이 빠지면 여기서 터미널까지 함께 열린다.
    expect(onAgentClick).not.toHaveBeenCalled();
  });

  it("핸들러가 없으면 행은 눌리지 않는다 — 커서도 붙지 않는다", () => {
    useLocaleStore.setState({ locale: "ko" });
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("프론트-1")],
        tasks: [],
      }),
    );
    expect(screen.getByTestId("beginner-agent-row").className).not.toContain(
      "cursor-pointer",
    );
    expect(screen.queryByTestId("beginner-agent-open-terminal")).toBeNull();
  });

  it("★오케스트레이터(role)는 리스트에 안 나온다 — 워커만", () => {
    useLocaleStore.setState({ locale: "ko" });
    render(
      createElement(BeginnerAgentsPane, {
        agents: [
          agent("오케", { role: "orchestrator", id: "orch-1" }),
          agent("프론트-1", { id: "a1" }),
          agent("백엔드-1", { id: "a2", role: "backend" }),
        ],
        tasks: [],
        onAgentClick: vi.fn(),
      }),
    );

    const rows = screen.getAllByTestId("beginner-agent-row");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent).join("\n")).toContain("프론트-1");
    expect(rows.map((r) => r.textContent).join("\n")).toContain("백엔드-1");
    expect(rows.map((r) => r.textContent).join("\n")).not.toContain("오케");
    // 카운트 배지도 워커만.
    expect(screen.getByTestId("beginner-agents-count").textContent).toContain(
      "2",
    );
  });

  it("오케만 있으면 빈 상태 — 팀원 0명으로 읽힌다", () => {
    useLocaleStore.setState({ locale: "ko" });
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("오케", { role: "orchestrator" })],
        tasks: [],
      }),
    );
    expect(screen.queryByTestId("beginner-agent-row")).toBeNull();
    expect(screen.getByTestId("beginner-agents-empty")).toBeTruthy();
  });
});

// ── 행 액션 (작업 화면 · 끄기) ──────────────────────────────────────────────
/**
 * ★심플 모드에는 어드밴스드의 에이전트 목록이 없다 — 그래서 한 번 붙은 팀원을
 * **끌 방법이 아예 없었다**(사장님 테스트). 여기서 못박는 건 셋이다:
 *
 *   ① 작업 화면 버튼 = 행 클릭과 **같은** 터미널 경로 (두 번 열리지 않는다)
 *   ② X 는 행 클릭을 삼킨다 — 끄면서 터미널이 함께 열리면 안 된다
 *   ③ 확인 모달 판정은 `lib/agentEntryClose` 하나다: 작업 중(working)만 묻고,
 *      idle/stopped 는 바로 끈다(정리하려는 사람에게 모달을 되던지지 않는다)
 */
describe("비기너 에이전트 패널 — 행 액션", () => {
  function mountRow(
    props: Partial<Parameters<typeof BeginnerAgentsPane>[0]> = {},
    agentProps: Partial<Agent> = {},
  ) {
    useLocaleStore.setState({ locale: "ko" });
    const onAgentClick = vi.fn();
    const onAgentKill = vi.fn();
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("프론트-1", agentProps)],
        tasks: [],
        onAgentClick,
        onAgentKill,
        ...props,
      }),
    );
    return { onAgentClick, onAgentKill };
  }

  it("작업 화면 버튼은 행 클릭과 같은 터미널 경로로 간다 (한 번만)", () => {
    const { onAgentClick } = mountRow();
    fireEvent.click(screen.getByTestId("beginner-agent-open-terminal"));
    expect(onAgentClick).toHaveBeenCalledTimes(1);
    expect(onAgentClick.mock.calls[0][0].name).toBe("프론트-1");
  });

  it("★작업 중인 팀원의 X 는 먼저 묻는다 — 확인 전에는 끄지 않는다", async () => {
    const { onAgentKill } = mountRow({}, { status: "working" });
    fireEvent.click(screen.getByTestId("beginner-agent-kill"));

    expect(onAgentKill).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("beginner-agent-kill-confirm").textContent,
    ).toContain("프론트-1");

    fireEvent.click(screen.getByText(ko["agents.close.confirm"]));
    await waitFor(() => expect(onAgentKill).toHaveBeenCalledTimes(1));
    expect(onAgentKill.mock.calls[0][0].name).toBe("프론트-1");
    expect(screen.queryByTestId("beginner-agent-kill-confirm")).toBeNull();
  });

  it("확인 모달에서 취소하면 아무것도 끄지 않는다", () => {
    const { onAgentKill } = mountRow({}, { status: "working" });
    fireEvent.click(screen.getByTestId("beginner-agent-kill"));
    fireEvent.click(screen.getByText(ko["agents.close.cancel"]));
    expect(onAgentKill).not.toHaveBeenCalled();
    expect(screen.queryByTestId("beginner-agent-kill-confirm")).toBeNull();
  });

  it.each(["idle", "stopped", "error"] as const)(
    "%s 팀원은 확인 없이 바로 꺼진다",
    async (status) => {
      const { onAgentKill } = mountRow({}, { status });
      fireEvent.click(screen.getByTestId("beginner-agent-kill"));
      await waitFor(() => expect(onAgentKill).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("beginner-agent-kill-confirm")).toBeNull();
    },
  );

  it("★X 는 행 클릭을 삼킨다 — 끄면서 터미널이 함께 열리지 않는다", async () => {
    const { onAgentClick, onAgentKill } = mountRow({}, { status: "idle" });
    fireEvent.click(screen.getByTestId("beginner-agent-kill"));
    await waitFor(() => expect(onAgentKill).toHaveBeenCalledTimes(1));
    expect(onAgentClick).not.toHaveBeenCalled();
  });

  it("핸들러가 없으면 그 버튼은 그려지지 않는다 — 없는 문을 그리지 않는다", () => {
    useLocaleStore.setState({ locale: "ko" });
    render(
      createElement(BeginnerAgentsPane, {
        agents: [agent("프론트-1")],
        tasks: [],
      }),
    );
    expect(screen.queryByTestId("beginner-agent-kill")).toBeNull();
    expect(screen.queryByTestId("beginner-agent-open-terminal")).toBeNull();
  });
});

// ── 터미널 모달 ─────────────────────────────────────────────────────────────
describe("비기너 에이전트 터미널 모달", () => {
  function mount(
    props: Partial<Parameters<typeof BeginnerAgentTerminalModal>[0]> = {},
  ) {
    useLocaleStore.setState({ locale: "ko" });
    const onClose = vi.fn();
    const view = render(
      createElement(BeginnerAgentTerminalModal, {
        agent: agent("프론트-1", { currentTaskId: "t1" }),
        task: task("t1", "가이드 초안"),
        sessionId: "s2",
        onClose,
        ...props,
      }),
    );
    return { ...view, onClose };
  }

  it("★어드밴스드와 같은 PTY 세션을 그대로 문다", () => {
    mount();
    expect(screen.getByTestId("stub-terminal").dataset.sessionId).toBe("s2");
  });

  it("누구의 무슨 일인지 헤더가 말한다 — 로그만 덜렁 열지 않는다", () => {
    const { container } = mount();
    expect(container.textContent).toContain("프론트-1");
    expect(container.textContent).toContain("가이드 초안");
  });

  it("★모델명·하네스 버전은 여기서도 안 보인다 (비기너 경계)", () => {
    const { container } = mount();
    expect(container.textContent).not.toContain("claude-fable-5");
    expect(container.textContent).not.toContain("claude");
  });

  it("★세션을 못 찾으면 빈 화면이 아니라 이유를 말한다", () => {
    mount({ sessionId: undefined });
    expect(screen.queryByTestId("stub-terminal")).toBeNull();
    expect(
      screen.getByTestId("beginner-agent-terminal-empty").textContent,
    ).toBe(ko["beginner.agents.terminalEmpty"]);
  });

  it("Esc 와 닫기 버튼으로 닫힌다", () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByTestId("beginner-agent-terminal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
