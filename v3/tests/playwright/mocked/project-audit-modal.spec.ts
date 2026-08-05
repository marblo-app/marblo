import { test, expect } from "../helpers/fixtures";

test("@mocked 프로젝트 감사로그 티켓 상세는 긴 detail 전체와 Replay CTA를 노출한다", async ({
  marblo,
}) => {
  const projectId = "test-audit-project";
  const taskId = "audit-long-detail-task";
  const taskTitle = "감사로그 긴 상세 회귀 티켓";
  const longTierDetail =
    "긴 상세 텍스트 회귀 가드 #758 #768 - " +
    Array.from(
      { length: 28 },
      (_, i) => `segment-${String(i + 1).padStart(2, "0")}`,
    ).join(" / ") +
    " - 끝까지 보여야 하는 마지막 문장";
  const createdAtIso = "2026-08-05T03:21:00.000Z";

  await marblo.page.evaluate(
    ({ projectId, taskId, taskTitle, longTierDetail, createdAtIso }) => {
      const now = createdAtIso;
      const member = {
        id: "test-user-bypass",
        email: "owner@example.test",
        displayName: "테스트 오너",
        photoURL: "",
        createdAt: now,
      };

      localStorage.setItem("marblo:locale", "ko");
      localStorage.removeItem("marblo.firstRun.inProgress");
      localStorage.setItem(
        "marblo:test:projectAuditHarness",
        JSON.stringify({ projectId, members: [member] }),
      );
      localStorage.setItem(
        "marblo:test:projectAuditData",
        JSON.stringify({
          [projectId]: {
            taskTitles: { [taskId]: taskTitle },
            human: [
              {
                id: "human-status-1",
                projectId,
                actorUid: "test-user-bypass",
                actorName: "테스트 오너",
                type: "task.status_changed",
                taskId,
                targetId: taskId,
                metadata: { from: "REVIEW", to: "DONE" },
                createdAt: "2026-08-05T03:20:59.000Z",
              },
            ],
            agent: [
              {
                id: "ledger-status-1",
                projectId,
                agentId: "agent-codex-audit",
                toolName: "update_task_status",
                params: { status: "DONE" },
                result: "ok",
                duration: 42,
                success: true,
                createdAt: now,
                actorUid: "test-user-bypass",
                model: "codex",
                tier: longTierDetail,
                taskId,
                kind: "action",
                worktreeId: `${projectId}/${taskId}`,
                seq: 7,
                prevHash: "prev",
                hash: "hash",
              },
            ],
          },
        }),
      );
      localStorage.setItem(
        "marblo:test:replayMissions",
        JSON.stringify({
          [projectId]: [
            {
              id: "mission-completed-audit",
              projectId,
              goal: "감사로그 상세 Replay 검증",
              templateId: "feature",
              status: "completed",
              ownerOrchestratorSessionId: "orch-audit",
              steps: [],
              currentStepIndex: 0,
              taskIds: [taskId],
              contextLog: [],
              launchedAt: now,
              lastActivityAt: now,
              completedAt: now,
            },
          ],
        }),
      );
    },
    { projectId, taskId, taskTitle, longTierDetail, createdAtIso },
  );
  await marblo.page.reload({ waitUntil: "domcontentloaded" });

  await expect(marblo.page.getByText("감사 로그")).toBeVisible({
    timeout: 8000,
  });
  await expect(
    marblo.page.locator("li", { hasText: "상태 변경" }).first(),
  ).toBeVisible();
  await expect(marblo.page.getByText(taskTitle).first()).toBeVisible();

  await marblo.page.getByRole("button", { name: taskTitle }).first().click();

  await expect(
    marblo.page.getByRole("heading", { name: taskTitle }),
  ).toBeVisible();
  const modalDetail = marblo.page.locator("span.whitespace-normal", {
    hasText: longTierDetail,
  });
  await expect(modalDetail).toBeVisible();
  await expect(modalDetail).not.toHaveCSS("text-overflow", "ellipsis");
  await expect(marblo.page.getByText("...")).toHaveCount(0);
  await expect(
    marblo.page.getByRole("button", { name: "Replay 보기" }),
  ).toBeVisible();

  await marblo.page.screenshot({
    path: "test-results/project-audit-modal-long-detail.png",
    fullPage: true,
  });
});
