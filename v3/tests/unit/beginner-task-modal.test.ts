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
 * ★그런데 그 선이 한 번 잘못 그어졌었다(티켓 8s7W0hgy). "덜어낸다" 를 정보까지
 * 덜어내는 것으로 읽어서, 카드를 눌러도 목표·변경·접근·완료 기준·손대는 곳·
 * 선행 일감·진행 기록이 **하나도** 안 나왔다 — 사장님이 보신 건 제목 한 줄과
 * '물어보기' 버튼뿐인 창이었다. 선은 정보가 아니라 **손잡이**에 그어야 한다.
 *
 * 그래서 여기서 못박는 건 셋이다:
 *   ① 유저가 알아야 할 셋(무슨 일 / 어디까지 / 누가)은 **있다**
 *   ② ★보드 상세가 보여주던 정보(목표·변경·완료기준·범위·선행일감·진행기록)도
 *      **다 있다** — 정보량은 표준과 동등하다
 *   ③ 승격 후에 배울 손잡이들(워크트리·diff·PR·모델·상태머신)은 **없다**
 * 그리고 유일한 액션이 "말로 시킨다"(대화창 프리필)로 남아 있는지도 함께 본다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// 진행 기록은 실 firestore 구독이다 — 여기서는 무엇을 그리는지만 본다.
const activityFeed = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("../../src/services/activityService", () => ({
  subscribeToActivities: vi.fn(
    (_taskId: string, cb: (list: unknown[]) => void) => {
      cb(activityFeed.list);
      return () => {};
    },
  ),
}));

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

function mount(
  t: Task,
  onAsk = vi.fn(),
  onClose = vi.fn(),
  tasks: Task[] = [t],
) {
  useLocaleStore.setState({ locale: "ko" });
  const view = render(
    createElement(BeginnerTaskModal, {
      task: t,
      agents: [owner],
      tasks,
      onAsk,
      onClose,
    }),
  );
  return { ...view, onAsk, onClose };
}

beforeEach(() => {
  activityFeed.list = [];
});
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
    // ★scope(손대는 곳)는 이 목록에서 빠졌다 — 8s7W0hgy 이후 상세의 일부다.
    // 여기 남은 것들과 성격이 다르다: 워크트리·diff·PR·모델은 **손잡이**이고,
    // scope 는 "무엇이 바뀌나" 라는 정보다.
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

  it("★보드 상세와 같은 정보 — 목표·변경·완료기준·제약이 다 나온다", () => {
    const { container } = mount(
      task("IN_PROGRESS", {
        goal: "심플모드 티켓 상세를 표준과 동등하게",
        changes: ["BeginnerTaskModal 에 상세 섹션 추가", "lib/taskBody 공유"],
        acceptance: ["티켓 클릭 → 상세가 다 보인다", "tsc --noEmit 통과"],
        notes: ["렌더러 전용 — HMR 로 반영된다"],
      }),
    );
    const text = container.textContent ?? "";

    for (const heading of [
      ko["board.section.goal"],
      ko["board.section.changes"],
      ko["board.section.acceptance"],
      ko["board.section.notes"],
    ]) {
      expect(text).toContain(heading);
    }
    expect(screen.getByTestId("beginner-task-modal-goal").textContent).toBe(
      "심플모드 티켓 상세를 표준과 동등하게",
    );
    expect(
      screen.getByTestId("beginner-task-modal-changes").children,
    ).toHaveLength(2);
    expect(
      screen.getByTestId("beginner-task-modal-acceptance").children,
    ).toHaveLength(2);
    expect(text).toContain("렌더러 전용 — HMR 로 반영된다");
  });

  it("구조화 섹션이 없으면 요청 내용(description)으로 떨어진다 — 보드와 같은 규칙", () => {
    mount(task("TODO"));

    expect(
      screen.getByTestId("beginner-task-modal-description").textContent,
    ).toBe("README 를 읽고 시작 가이드를 정리한다");
    expect(screen.queryByTestId("beginner-task-modal-goal")).toBeNull();
  });

  it("★손대는 곳(scope)과 먼저 끝나야 하는 일(dependsOn)을 보여준다", () => {
    const dep = task("DONE", { id: "t0", title: "설계 문서 정리" });
    const main = task("TODO", {
      dependsOn: ["t0", "t-unknown"],
      dependsOnCompleted: false,
    });
    const { container } = mount(main, vi.fn(), vi.fn(), [dep, main]);

    expect(container.textContent).toContain(ko["beginner.taskDetail.scope"]);
    expect(screen.getByTestId("beginner-task-modal-scope").textContent).toBe(
      "v3/src/components",
    );

    // 선행 일감은 id 조각이 아니라 **제목**으로. 목록 밖 티켓만 짧은 id 로 떨어진다.
    const deps = screen.getByTestId("beginner-task-modal-depends");
    expect(deps.textContent).toContain("설계 문서 정리");
    expect(deps.textContent).toContain("t-unknow");
    expect(
      screen.getByTestId("beginner-task-modal-depends-state").textContent,
    ).toBe(ko["beginner.taskDetail.depsWaiting"]);
  });

  it("★진행 기록(활동로그)을 그린다 — 없으면 없다고 말한다", () => {
    mount(task("IN_PROGRESS"));
    expect(
      screen.getByTestId("beginner-task-modal-activity-empty").textContent,
    ).toBe(ko["beginner.taskDetail.activityEmpty"]);
    cleanup();

    activityFeed.list = [
      {
        id: "ac1",
        taskId: "t1",
        agentId: "프론트-1",
        message: "상세 섹션 구현 완료",
        createdAt: new Date(Date.now() - 5 * 60_000),
      },
    ];
    mount(task("IN_PROGRESS"));

    const log = screen.getByTestId("beginner-task-modal-activity");
    expect(log.textContent).toContain("상세 섹션 구현 완료");
    expect(log.textContent).toContain("프론트-1");
    // 절대 시각이 아니라 "방금인가, 어제인가".
    expect(log.textContent).toContain(
      ko["beginner.taskDetail.time.minutesAgo"].replace("{n}", "5"),
    );
  });

  it("★상세가 들어와도 '물어보기' 는 그대로다 — 상세와 공존한다", () => {
    const { onAsk } = mount(
      task("IN_PROGRESS", { goal: "목표 한 줄", scope: ["v3/src"] }),
    );

    // 정보(목표·범위)와 액션(프리필)이 한 창에 같이 있다.
    expect(screen.getByTestId("beginner-task-modal-goal")).toBeTruthy();
    expect(screen.getByTestId("beginner-task-modal-scope")).toBeTruthy();
    fireEvent.click(screen.getByTestId("beginner-task-modal-ask"));
    expect(onAsk).toHaveBeenCalledWith(
      ko["beginner.taskDetail.askProgress"].replace("{title}", "가이드 초안"),
    );
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
