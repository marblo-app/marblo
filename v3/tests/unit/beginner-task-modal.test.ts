/**
 * @vitest-environment jsdom
 *
 * ★비기너 티켓 상세 — "미니 보드가 눌린다" 의 도착지.
 *
 * 카드를 누를 수 있게 만든 순간 새 위험이 생긴다: 손쉬운 구현은 어드밴스드
 * `TaskDetailModal` 을 그대로 띄우는 것이고, 그러면 워크트리 pill·diff 진입·PR
 * 링크·모델 스탬프가 한꺼번에 쏟아져 심플 모드가 그 자리에서 무너진다. 비기너
 * 화면의 차별점이 정확히 그것들을 **안 보여주는 것**이라서다.
 *
 * 그래서 여기서 못박는 건 두 가지다:
 *   ① 유저가 알아야 할 셋(무슨 일 / 어디까지 / 누가)은 **있다**
 *   ② 승격 후에 배울 것들(워크트리·diff·PR·모델)은 **없다**
 * 그리고 유일한 액션이 "말로 시킨다"(대화창 프리필)로 남아 있는지도 함께 본다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { BeginnerTaskModal } from "../../src/components/beginner/BeginnerTaskModal";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import type { Agent } from "../../src/types/agent";
import type { Task, TaskStatus } from "../../src/types/task";

function task(status: TaskStatus, extra: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    contextId: "",
    title: "가이드 초안",
    description: "README 를 읽고 시작 가이드를 정리한다",
    status,
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "a1",
    claimedAt: null,
    scope: ["v3/src/components"],
    comment: "",
    prUrl: "https://github.com/x/y/pull/1",
    hasPmFeedback: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...extra,
  };
}

const owner: Agent = {
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

function mount(t: Task, onAsk = vi.fn(), onClose = vi.fn()) {
  useLocaleStore.setState({ locale: "ko" });
  const view = render(
    createElement(BeginnerTaskModal, {
      task: t,
      agents: [owner],
      onAsk,
      onClose,
    }),
  );
  return { ...view, onAsk, onClose };
}

afterEach(() => cleanup());

describe("비기너 티켓 상세", () => {
  it("무슨 일 / 어디까지 / 누가 — 셋을 말한다", () => {
    const { container } = mount(task("IN_PROGRESS"));

    expect(container.textContent).toContain("가이드 초안");
    expect(container.textContent).toContain(
      "README 를 읽고 시작 가이드를 정리한다",
    );
    expect(screen.getByTestId("beginner-task-modal-status").textContent).toBe(
      ko["beginner.board.doing"],
    );
    expect(screen.getByTestId("beginner-task-modal-owner").textContent).toBe(
      ko["beginner.taskDetail.owner"].replace("{name}", "프론트-1"),
    );
  });

  it("★워크트리·diff·PR·모델·상태머신 이름은 없다", () => {
    const { container } = mount(task("REVIEW"));
    const text = container.textContent ?? "";

    expect(text).not.toContain("PR");
    expect(text).not.toContain("pull/1");
    expect(text).not.toContain("claude");
    expect(text).not.toContain("REVIEW");
    expect(text).not.toContain("v3/src/components");
    // REVIEW 는 상태머신의 이름이라 "진행 중" 으로 접혀야 한다.
    expect(screen.getByTestId("beginner-task-modal-status").textContent).toBe(
      ko["beginner.board.doing"],
    );
  });

  it("★막힌 티켓은 막혔다고 말하고, 물어볼 문장도 그에 맞게 바뀐다", () => {
    const { container, onAsk, onClose } = mount(task("BLOCKED"));

    expect(container.textContent).toContain(ko["board.taskCard.stuck"]);
    expect(screen.getByTestId("beginner-task-modal-ask").textContent).toBe(
      ko["beginner.taskDetail.askStuckCta"],
    );

    fireEvent.click(screen.getByTestId("beginner-task-modal-ask"));
    expect(onAsk).toHaveBeenCalledWith(
      ko["beginner.taskDetail.askStuck"].replace("{title}", "가이드 초안"),
    );
    // 프리필 후에는 닫힌다 — 유저의 시선이 대화창으로 넘어가야 한다.
    expect(onClose).toHaveBeenCalled();
  });

  it("★보내지는 않는다 — 문장을 채워 줄 뿐이다", () => {
    const { onAsk } = mount(task("DONE"));

    expect(screen.getByTestId("beginner-task-modal-ask").textContent).toBe(
      ko["beginner.taskDetail.askDoneCta"],
    );
    fireEvent.click(screen.getByTestId("beginner-task-modal-ask"));
    // 계약은 "채운다" 다. 대신 보내면 유저는 무엇이 나갔는지 모른 채 오케가 움직인다.
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("아직 아무도 안 붙은 티켓은 그렇게 말한다", () => {
    const { onClose } = mount(task("TODO", { id: "t9", claimedBy: null }));

    expect(screen.getByTestId("beginner-task-modal-owner").textContent).toBe(
      ko["beginner.taskDetail.noOwner"],
    );

    // Esc 로 닫힌다.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
