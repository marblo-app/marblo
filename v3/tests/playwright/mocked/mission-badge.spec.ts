import { test, expect } from "../helpers/fixtures";

/**
 * Tier 2 회귀: 미션 task(contextId = raw missionId)가 칸반 카드에 lane(⛙)이
 * 아니라 전용 🎯 Mission 뱃지 + 담당 에이전트 모델 아이콘으로 렌더되는지.
 */
test("@mocked 미션 task 는 🎯 Mission 뱃지로 렌더된다 (⛙ Lane 아님)", async ({
  marblo,
}) => {
  await marblo.openMockKanban();

  await marblo.page.evaluate(() => {
    const tw = (
      window as unknown as {
        __marbloTest?: {
          stores: {
            task: {
              getState: () => { tasks: Array<{ projectId?: string; [key: string]: unknown }> };
              setState: (s: { tasks: Array<Record<string, unknown>> }) => void;
            };
            agent: {
              getState: () => { agents: Array<Record<string, unknown>> };
              setState: (s: { agents: Array<Record<string, unknown>> }) => void;
            };
          };
        };
      }
    ).__marbloTest;
    if (!tw) throw new Error("__marbloTest hatch 미노출");
    const taskStore = tw.stores.task;
    const agentStore = tw.stores.agent;
    const existing = taskStore.getState().tasks;
    const projectId = existing[0]?.projectId ?? "mock-project";
    const now = new Date();
    const missionTask = {
      id: "mission-task-1",
      projectId,
      contextId: "mission-demo-1",
      title: "결제 플로우 추가",
      description: "",
      status: "IN_PROGRESS",
      role: "frontend",
      priority: 3,
      dependsOn: [],
      dependsOnCompleted: true,
      claimedBy: "agent-claude-1",
      claimedAt: now,
      scope: [],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
      createdAt: now,
      updatedAt: now,
    };
    taskStore.setState({ tasks: [...existing, missionTask] });
    const agents = agentStore.getState().agents ?? [];
    agentStore.setState({
      agents: [
        ...agents,
        {
          id: "agent-claude-1",
          name: "agent-claude-1",
          model: "claude",
          status: "working",
          ownerId: "owner-1",
          projectId,
        },
      ],
    });
  });

  await expect(
    marblo.page.locator('text="결제 플로우 추가"').first(),
    "미션 task 카드가 보드에 안 보임"
  ).toBeVisible({ timeout: 8000 });

  await expect(
    marblo.page.getByText("🎯 Mission").first(),
    "미션 카드에 🎯 Mission 뱃지가 안 보임"
  ).toBeVisible();

  await expect(
    marblo.page.getByText("🟣").first(),
    "미션 카드에 claude 모델 아이콘(🟣)이 안 보임"
  ).toBeVisible();

  await expect(
    marblo.page.locator("text=/⛙/"),
    "미션 task 가 lane(⛙) 뱃지로 잘못 렌더됨"
  ).toHaveCount(0);
});
