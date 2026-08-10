/**
 * @vitest-environment jsdom
 *
 * ★비기너 상세 오버레이 선택 — "누른 티켓은 **반드시** 열린다".
 *
 * 이 파일이 지키는 건 하나다: 미니 보드에서 카드를 눌렀는데 화면에 아무 일도
 * 안 일어나는 일은 없다.
 *
 * 왜 규칙으로 못박는가. 종전 셸은 클릭을 id 로만 받아 두고 구독 스냅샷에서
 * `tasks.find` 로 다시 찾았다. 그 재조회가 빗나가면 모달은 **조용히** 안 뜬다 —
 * 에러도, 빈 창도, 로그도 없다. 그래서 두 번이나 "눌러도 아무 일이 없다" 로
 * 보고됐는데 재현이 안 됐고(#880 은 "재현 불가" 로 남았다), 그 사이 프리뷰
 * 시연에서 같은 지문이 다시 나왔다. 재조회가 빗나갈 수 있는 경로는 한둘이
 * 아니다 — 데모/프리뷰처럼 스토어 밖에서 온 티켓, 구독을 다시 거는 사이의 빈
 * 스냅샷, 프로젝트 전환 직후. 하나씩 막는 대신 **클릭된 객체를 들고 있는 것**
 * 으로 경로 전체를 닫았고, 여기서 그 계약을 고정한다.
 *
 * 못박는 계약:
 *   ① 스토어에 있는 티켓 → 라이브 값이 이긴다(구독이 갱신되면 모달도 움직인다)
 *   ② ★스토어에 **없는** 티켓(데모/프리뷰) → 그래도 열린다
 *   ③ 열어 둔 티켓이 목록에서 사라져도 창은 남는다(내용이 증발하지 않는다)
 *   ④ 프로젝트가 바뀌면 닫힌다(남의 프로젝트 상세가 남지 않게)
 *   ⑤ 티켓 상세와 에이전트 터미널은 서로 배타
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useBeginnerDetail } from "../../src/hooks/useBeginnerDetail";
import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

function task(id: string, title: string, status: TaskStatus = "TODO"): Task {
  return {
    id,
    projectId: "p1",
    contextId: "board",
    title,
    description: "",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: null,
    claimedAt: null,
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const AGENT: Agent = {
  id: "a1",
  projectId: "p1",
  ownerId: "u1",
  name: "프론트-1",
  model: "claude",
  spawnedModel: "claude-fable-5",
  role: "frontend",
  status: "working",
  currentTaskId: "t1",
  command: "claude",
  skillFile: "",
  createdAt: new Date(0),
};

/** 데모/프리뷰 티켓 — 미니 보드 카드로는 보이지만 구독 스냅샷에는 없는 것. */
const DEMO = task("demo-1", "샘플: 시작 가이드 정리");

describe("useBeginnerDetail — 누른 티켓은 반드시 열린다", () => {
  it("스토어에 있는 티켓은 라이브 값이 이긴다 (제목이 바뀌면 모달도 바뀐다)", () => {
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) =>
        useBeginnerDetail({ tasks, agents: [AGENT], projectId: "p1" }),
      { initialProps: { tasks: [task("t1", "초안")] } },
    );

    act(() => result.current.openTaskDetail(task("t1", "초안")));
    expect(result.current.openTask?.title).toBe("초안");

    // 오케가 티켓을 진행시켰다 — 클릭 당시의 스냅샷이 아니라 새 값이 보여야 한다.
    rerender({ tasks: [task("t1", "초안 v2", "IN_PROGRESS")] });
    expect(result.current.openTask?.title).toBe("초안 v2");
    expect(result.current.openTask?.status).toBe("IN_PROGRESS");
  });

  it("★스토어에 없는 데모/프리뷰 티켓도 열린다 (재발 지점)", () => {
    const { result } = renderHook(() =>
      useBeginnerDetail({ tasks: [], agents: [], projectId: "p1" }),
    );

    act(() => result.current.openTaskDetail(DEMO));

    // 종전 구현(tasks.find)은 여기서 null 을 돌려주고 모달이 조용히 안 떴다.
    expect(result.current.openTask).not.toBeNull();
    expect(result.current.openTask?.id).toBe("demo-1");
    expect(result.current.openTask?.title).toBe("샘플: 시작 가이드 정리");
  });

  it("열어 둔 티켓이 목록에서 사라져도 창의 내용이 증발하지 않는다", () => {
    const { result, rerender } = renderHook(
      ({ tasks }: { tasks: Task[] }) =>
        useBeginnerDetail({ tasks, agents: [], projectId: "p1" }),
      { initialProps: { tasks: [task("t1", "초안")] } },
    );

    act(() => result.current.openTaskDetail(task("t1", "초안")));
    // 구독을 다시 거는 사이의 빈 스냅샷 — 화면이 깜빡 비는 그 한 프레임.
    rerender({ tasks: [] });

    expect(result.current.openTask?.id).toBe("t1");
  });

  it("닫으면 닫힌다 — 스냅샷이 남아 다시 뜨지 않는다", () => {
    const { result } = renderHook(() =>
      useBeginnerDetail({ tasks: [], agents: [], projectId: "p1" }),
    );

    act(() => result.current.openTaskDetail(DEMO));
    act(() => result.current.closeTaskDetail());

    expect(result.current.openTask).toBeNull();
  });

  it("프로젝트가 바뀌면 열린 상세는 닫힌다", () => {
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useBeginnerDetail({ tasks: [], agents: [AGENT], projectId }),
      { initialProps: { projectId: "p1" } },
    );

    act(() => result.current.openTaskDetail(DEMO));
    expect(result.current.openTask).not.toBeNull();

    rerender({ projectId: "p2" });
    expect(result.current.openTask).toBeNull();
    expect(result.current.openAgent).toBeNull();
  });
});

describe("useBeginnerDetail — 두 오버레이는 배타", () => {
  it("에이전트 터미널을 열면 티켓 상세는 닫힌다", () => {
    const { result } = renderHook(() =>
      useBeginnerDetail({ tasks: [], agents: [AGENT], projectId: "p1" }),
    );

    act(() => result.current.openTaskDetail(DEMO));
    act(() => result.current.openAgentTerminal(AGENT));

    expect(result.current.openAgent?.id).toBe("a1");
    expect(result.current.openTask).toBeNull();
  });

  it("티켓 상세를 열면 에이전트 터미널은 닫힌다", () => {
    const { result } = renderHook(() =>
      useBeginnerDetail({ tasks: [], agents: [AGENT], projectId: "p1" }),
    );

    act(() => result.current.openAgentTerminal(AGENT));
    act(() => result.current.openTaskDetail(DEMO));

    expect(result.current.openTask?.id).toBe("demo-1");
    expect(result.current.openAgent).toBeNull();
  });

  it("에이전트는 목록에서 빠지면 터미널이 닫힌다 (죽은 PTY 를 그리지 않는다)", () => {
    const { result, rerender } = renderHook(
      ({ agents }: { agents: Agent[] }) =>
        useBeginnerDetail({ tasks: [], agents, projectId: "p1" }),
      { initialProps: { agents: [AGENT] } },
    );

    act(() => result.current.openAgentTerminal(AGENT));
    rerender({ agents: [] });

    expect(result.current.openAgent).toBeNull();
  });
});
