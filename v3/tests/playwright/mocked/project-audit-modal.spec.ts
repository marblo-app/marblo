import { test, expect } from "../helpers/fixtures";

// 이 스위트는 격리 userData 를 안 쓴다 — 켠 파킹 플래그를 지우지 않으면 다음
// 실행(및 개발자 실프로필)까지 리플레이 대시보드가 켜진 채로 남는다.
test.afterEach(async ({ marblo }) => {
  try {
    await marblo.page.evaluate(() =>
      localStorage.removeItem("marblo.replayDashboard.enabled"),
    );
  } catch {
    /* 앱이 이미 닫혔으면 정리할 것도 없다 */
  }
});

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
      // "Replay 보기" CTA 는 리플레이 대시보드와 함께 파킹됐다(기본 OFF) —
      // 목적지가 없으면 죽은 버튼이라 같은 플래그로 내려간다. 이 스펙은 파킹된
      // 표면의 회귀 가드라 플래그를 명시적으로 켜고 돈다
      // (`lib/replayDashboardFlag`; 아래 reload 가 이 값을 적용한다).
      localStorage.setItem("marblo.replayDashboard.enabled", "1");
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
  // 관리자 뷰에서는 티켓이 카드 하나로 접혀 있고, 이벤트("상태 변경")는 펼쳐야
  // 보인다 — 캡처가 그대로라는 계약을 여기서 같이 지킨다.
  const card = marblo.page
    .getByTestId("audit-ticket")
    .filter({ hasText: taskTitle })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { expanded: false }).first().click();
  await expect(card.getByText("상태 변경").first()).toBeVisible();

  await card.getByRole("button", { name: "티켓 상세" }).click();

  await expect(
    marblo.page.getByRole("heading", { name: taskTitle }),
  ).toBeVisible();
  // ★모달로 스코프한다 — 같은 detail 이 뒤의 (펼쳐진) 티켓 카드 타임라인에도
  // 있어서, 전역으로 찾으면 strict mode 위반이 난다. 이 가드가 지키는 것은
  // 모달의 줄바꿈이다.
  const modalDetail = marblo.page
    .locator(".fixed.inset-0")
    .locator("span.whitespace-normal", { hasText: longTierDetail });
  await expect(modalDetail).toBeVisible();
  await expect(modalDetail).not.toHaveCSS("text-overflow", "ellipsis");
  await expect(
    marblo.page.locator(".fixed.inset-0").getByText("..."),
  ).toHaveCount(0);
  await expect(
    marblo.page.getByRole("button", { name: "Replay 보기" }),
  ).toBeVisible();

  await marblo.page.screenshot({
    path: "test-results/project-audit-modal-long-detail.png",
    fullPage: true,
  });
});

test("@mocked 프로젝트 감사로그는 worktree 단위 그룹에 보기 버튼과 아카이브 안내를 노출한다", async ({
  marblo,
}) => {
  const projectId = "test-audit-worktree-project";
  const liveTaskId = "audit-live-worktree-task";
  const archivedTaskId = "audit-archived-worktree-task";
  const liveTitle = "감사로그 라이브 워크트리 티켓";
  const archivedTitle = "감사로그 아카이브 워크트리 티켓";
  const liveBranch = "feature/audit-live-worktree-task";
  const now = "2026-08-05T04:10:00.000Z";

  await marblo.page.evaluate(
    ({
      projectId,
      liveTaskId,
      archivedTaskId,
      liveTitle,
      archivedTitle,
      liveBranch,
      now,
    }) => {
      const member = {
        id: "test-user-bypass",
        email: "owner@example.test",
        displayName: "테스트 오너",
        photoURL: "",
        createdAt: now,
      };
      const ledger = (
        id: string,
        taskId: string,
        createdAt: string,
        tier: string,
      ) => ({
        id,
        projectId,
        agentId: `agent-${taskId}`,
        toolName: "add_activity",
        params: { message: tier },
        result: "ok",
        duration: 12,
        success: true,
        createdAt,
        actorUid: "test-user-bypass",
        model: "codex",
        tier,
        taskId,
        kind: "action",
        worktreeId: `${projectId}/${taskId}`,
        seq: 1,
        prevHash: "prev",
        hash: "hash",
      });

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
            taskTitles: {
              [liveTaskId]: liveTitle,
              [archivedTaskId]: archivedTitle,
            },
            human: [
              {
                id: "archived-human-status",
                projectId,
                actorUid: "test-user-bypass",
                actorName: "테스트 오너",
                type: "task.status_changed",
                taskId: archivedTaskId,
                targetId: archivedTaskId,
                metadata: { from: "REVIEW", to: "DONE" },
                createdAt: "2026-08-05T04:06:00.000Z",
              },
            ],
            agent: [
              ledger(
                "live-note-2",
                liveTaskId,
                "2026-08-05T04:10:00.000Z",
                "라이브 워크트리 두 번째 진행",
              ),
              ledger(
                "live-note-1",
                liveTaskId,
                "2026-08-05T04:09:00.000Z",
                "라이브 워크트리 첫 번째 진행",
              ),
              ledger(
                "archived-note-2",
                archivedTaskId,
                "2026-08-05T04:08:00.000Z",
                "아카이브 워크트리 두 번째 진행",
              ),
              ledger(
                "archived-note-1",
                archivedTaskId,
                "2026-08-05T04:07:00.000Z",
                "아카이브 워크트리 첫 번째 진행",
              ),
            ],
          },
        }),
      );
      localStorage.setItem(
        "marblo:test:worktreeLightData",
        JSON.stringify([
          {
            projectId,
            repoRoot: "/tmp/marblo-audit-repo",
            baseRef: "main",
            worktrees: [
              {
                path: "/tmp/marblo-audit-repo",
                branch: "main",
                head: "base-head",
              },
              {
                path: `/tmp/marblo-audit-worktrees/${projectId}/${liveTaskId}`,
                branch: liveBranch,
                head: "live-head",
              },
            ],
          },
        ]),
      );
    },
    {
      projectId,
      liveTaskId,
      archivedTaskId,
      liveTitle,
      archivedTitle,
      liveBranch,
      now,
    },
  );
  await marblo.page.reload({ waitUntil: "domcontentloaded" });

  await expect(marblo.page.getByText("감사 로그")).toBeVisible({
    timeout: 8000,
  });
  await marblo.page.screenshot({
    path: "test-results/project-audit-worktree-before.png",
    fullPage: true,
  });

  await marblo.page.getByLabel("텔레그램·메모 포함").check();
  const liveCard = marblo.page
    .getByTestId("audit-ticket")
    .filter({ hasText: liveTitle })
    .first();
  const archivedCard = marblo.page
    .getByTestId("audit-ticket")
    .filter({ hasText: archivedTitle })
    .first();

  // 라이브 워크트리는 링크 클러스터의 "이 워크트리 보기"(브랜치 포함).
  await expect(liveCard.getByText(liveBranch).first()).toBeVisible();
  await expect(
    liveCard.getByRole("button", { name: /이 워크트리 보기/ }),
  ).toBeVisible();

  // 정리된 워크트리는 아카이브 안내로만 — raw worktreeId 는 줄에서 빠지고
  // tooltip 에만 남는다(원문을 버리지는 않는다).
  const archivedTag = archivedCard.getByText("아카이브됨");
  await expect(archivedTag).toBeVisible();
  await expect(archivedTag).toHaveAttribute(
    "title",
    new RegExp(`${projectId}/${archivedTaskId}`),
  );
  await expect(
    archivedCard.getByRole("button", { name: /이 워크트리 보기/ }),
  ).toHaveCount(0);

  // 펼치면 접힌 메모 묶음이 그대로 보인다(캡처 불변).
  await archivedCard.getByRole("button", { expanded: false }).first().click();
  await expect(archivedCard.getByText("메모 묶음")).toBeVisible();

  await archivedCard.getByRole("button", { name: "티켓 상세" }).click();
  await expect(
    marblo.page.getByRole("heading", { name: archivedTitle }),
  ).toBeVisible();
  await expect(
    marblo.page.getByRole("button", { name: /아카이브됨/ }),
  ).toBeDisabled();

  await marblo.page.screenshot({
    path: "test-results/project-audit-worktree-after.png",
    fullPage: true,
  });
});
