/**
 * 감사 로그 **관리자 뷰** mocked E2E 의 공용 시드.
 *
 * 한 벌만 두는 이유: before/after 스크린샷과 회귀 단언이 **같은 데이터**를 봐야
 * 비교가 성립한다. 시나리오가 두 벌이면 "화면이 좋아진 것"과 "데이터가 달라진
 * 것"이 섞인다.
 *
 * 시드는 관리자 뷰가 답해야 하는 세 질문을 전부 밟는다:
 *   - 문제 우선 : 실패 티켓 · 실패한 툴 호출 · 고아 클레임
 *   - 워크로드  : 오너 + 멤버 + 미귀속
 *   - 묶음/링크 : 미션 2티켓(하나는 PR·라이브 워크트리, 하나는 아카이브) + 보드
 */

export const AUDIT_ADMIN_PROJECT_ID = "test-audit-admin-project";

export const AUDIT_ADMIN_IDS = {
  missionId: "mission-payments",
  /** 미션 · DONE · PR 있음 · 워크트리는 정리됨(아카이브 안내가 떠야 한다). */
  doneTaskId: "audit-admin-task-done",
  /** 미션 · FAILED · 실패한 툴 호출 1건 → critical. */
  failedTaskId: "audit-admin-task-failed",
  /** 보드 · IN_PROGRESS · 죽은 에이전트가 물고 있음 → 고아 클레임. */
  orphanTaskId: "audit-admin-task-orphan",
  /** 보드 · DONE · 조용한 티켓(문제 없음). */
  quietTaskId: "audit-admin-task-quiet",
  ownerUid: "test-user-bypass",
  memberUid: "member-dev-uid",
  liveAgentId: "agent-alive-codex",
  deadAgentId: "agent-dead-grok",
  prUrl: "https://github.com/melocream/marblo/pull/791",
} as const;

const OWNER = {
  id: AUDIT_ADMIN_IDS.ownerUid,
  email: "owner@example.test",
  displayName: "테스트 오너",
  photoURL: "",
  createdAt: "2026-08-05T09:00:00.000Z",
};

const MEMBER = {
  id: AUDIT_ADMIN_IDS.memberUid,
  email: "dev@example.test",
  displayName: "김개발",
  photoURL: "",
  createdAt: "2026-08-05T09:00:00.000Z",
};

/** 시드가 쓰는 기준 시각. 정체 판정(6시간)을 넘기려고 오래된 행도 하나 둔다. */
const AT = (iso: string) => iso;

function ledger(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    projectId: AUDIT_ADMIN_PROJECT_ID,
    params: {},
    result: "ok",
    duration: 20,
    success: true,
    kind: "action",
    seq: 1,
    prevHash: "prev",
    hash: "hash",
    actorUid: AUDIT_ADMIN_IDS.ownerUid,
    ...partial,
  };
}

/**
 * localStorage 에 넣을 시드 전체. 렌더러 안에서 돌아야 하므로
 * `page.evaluate` 로 넘길 수 있는 순수 JSON 만 담는다.
 */
export function auditAdminSeed() {
  const {
    missionId,
    doneTaskId,
    failedTaskId,
    orphanTaskId,
    quietTaskId,
    ownerUid,
    memberUid,
    liveAgentId,
    deadAgentId,
    prUrl,
  } = AUDIT_ADMIN_IDS;

  return {
    projectId: AUDIT_ADMIN_PROJECT_ID,
    members: [OWNER, MEMBER],
    liveAgentId,
    deadAgentId,
    orphanTaskId,
    auditData: {
      [AUDIT_ADMIN_PROJECT_ID]: {
        // 옛 harness 호환 축약형도 같이 준다 — 관리자 뷰 이전 빌드(=before
        // 스크린샷)는 이쪽만 읽는다.
        taskTitles: {
          [doneTaskId]: "결제 API 리팩터",
          [failedTaskId]: "결제 UI 연결",
          [orphanTaskId]: "감사로그 관리자 뷰",
          [quietTaskId]: "문서 오탈자 정리",
        },
        tasks: [
          {
            id: doneTaskId,
            title: "결제 API 리팩터",
            status: "DONE",
            contextId: missionId,
            prUrl,
            claimedBy: liveAgentId,
          },
          {
            id: failedTaskId,
            title: "결제 UI 연결",
            status: "FAILED",
            contextId: missionId,
            prUrl: "",
            claimedBy: liveAgentId,
          },
          {
            id: orphanTaskId,
            title: "감사로그 관리자 뷰",
            status: "IN_PROGRESS",
            contextId: "board",
            prUrl: "",
            claimedBy: deadAgentId,
          },
          {
            id: quietTaskId,
            title: "문서 오탈자 정리",
            status: "DONE",
            contextId: "board",
            prUrl: "",
            claimedBy: liveAgentId,
          },
        ],
        missions: [
          {
            id: missionId,
            projectId: AUDIT_ADMIN_PROJECT_ID,
            goal: "결제 플로우 리팩터",
            status: "active",
            taskIds: [doneTaskId, failedTaskId],
            projection: { statusCounts: { DONE: 1, FAILED: 1 } },
          },
        ],
        human: [
          {
            id: "human-status-done",
            projectId: AUDIT_ADMIN_PROJECT_ID,
            actorUid: ownerUid,
            actorName: "테스트 오너",
            type: "task.status_changed",
            taskId: doneTaskId,
            targetId: doneTaskId,
            metadata: { from: "REVIEW", to: "DONE" },
            createdAt: AT("2026-08-05T12:40:00.000Z"),
          },
          {
            id: "human-spawn",
            projectId: AUDIT_ADMIN_PROJECT_ID,
            actorUid: memberUid,
            actorName: "김개발",
            type: "agent.spawned",
            taskId: failedTaskId,
            targetId: failedTaskId,
            metadata: {
              agentName: "codex-1",
              model: "codex",
              role: "frontend",
            },
            createdAt: AT("2026-08-05T12:20:00.000Z"),
          },
        ],
        agent: [
          // ── 미션 · DONE 티켓: created → claimed → submitted (한 카드로 접힌다)
          ledger({
            id: "l-done-submit",
            toolName: "submit_for_review",
            params: {
              task_id: doneTaskId,
              summary: {
                problem: "완료된 작업의 감사 상세가 부족했습니다.",
                changes: "저장된 툴 인자와 결과를 접이식으로 노출했습니다.",
                verification: "렌더러 타입체크와 mocked Playwright로 검증했습니다.",
              },
              OPENAI_API_KEY: "sk-testtesttesttesttesttesttesttest",
              reportPath: "/Users/alice/private/marblo/report.txt",
            },
            result:
              "submitted by owner@example.test with sk-testtesttesttesttesttesttesttest",
            instructionRedacted:
              "instructionRedacted(프롬프트): <EMAIL> 계정으로 <USER_HOME>/private 리포트를 확인하고 <API_KEY> 없이 감사 상세를 보강",
            taskId: doneTaskId,
            model: "codex",
            tier: "standard",
            worktreeId: `${AUDIT_ADMIN_PROJECT_ID}/${doneTaskId}`,
            createdAt: AT("2026-08-05T12:39:00.000Z"),
          }),
          ledger({
            id: "l-done-claim",
            toolName: "claim_task",
            taskId: doneTaskId,
            model: "codex",
            worktreeId: `${AUDIT_ADMIN_PROJECT_ID}/${doneTaskId}`,
            createdAt: AT("2026-08-05T12:10:00.000Z"),
          }),
          ledger({
            id: "l-done-create",
            toolName: "create_task",
            taskId: doneTaskId,
            model: null,
            createdAt: AT("2026-08-05T12:00:00.000Z"),
          }),
          // ── 미션 · FAILED 티켓: 실패한 상태 전이 1건
          ledger({
            id: "l-failed-status",
            toolName: "update_task_status",
            params: { status: "FAILED" },
            taskId: failedTaskId,
            model: "grok",
            success: false,
            result: "error",
            createdAt: AT("2026-08-05T12:30:00.000Z"),
          }),
          ledger({
            id: "l-failed-note",
            toolName: "add_activity",
            params: {
              message:
                "마지막 activity: owner@example.test 경로 /Users/alice/secret 를 확인했고 해결 요약을 남김",
            },
            taskId: failedTaskId,
            model: "grok",
            tier: "빌드가 안 붙어 진행 불가",
            createdAt: AT("2026-08-05T12:25:00.000Z"),
          }),
          // ── 보드 · 고아 클레임 티켓: 라이브 워크트리 근거를 남긴다
          ledger({
            id: "l-orphan-dispatch",
            toolName: "dispatch_task",
            taskId: orphanTaskId,
            model: "grok",
            worktreeId: `${AUDIT_ADMIN_PROJECT_ID}/${orphanTaskId}`,
            createdAt: AT("2026-08-05T11:50:00.000Z"),
          }),
          // ── 보드 · 조용한 티켓 + 귀속 불가 행(원장 확장 이전 문서 흉내)
          ledger({
            id: "l-quiet-done",
            toolName: "update_task_status",
            params: { status: "DONE" },
            taskId: quietTaskId,
            model: "claude",
            createdAt: AT("2026-08-05T11:30:00.000Z"),
          }),
          ledger({
            id: "l-quiet-unattributed",
            toolName: "get_all_tasks",
            taskId: quietTaskId,
            model: null,
            actorUid: null,
            createdAt: AT("2026-08-05T11:20:00.000Z"),
          }),
        ],
      },
    },
    /** 라이브 워크트리는 고아 티켓만. DONE 티켓 것은 정리돼 아카이브로 떨어진다. */
    worktreeLight: [
      {
        projectId: AUDIT_ADMIN_PROJECT_ID,
        repoRoot: "/tmp/marblo-audit-admin-repo",
        baseRef: "main",
        worktrees: [
          {
            path: "/tmp/marblo-audit-admin-repo",
            branch: "main",
            head: "base-head",
          },
          {
            path: `/tmp/marblo-audit-admin-worktrees/${AUDIT_ADMIN_PROJECT_ID}/${orphanTaskId}`,
            branch: `feature/${orphanTaskId}`,
            head: "orphan-head",
          },
        ],
      },
    ],
  };
}
