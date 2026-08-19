/**
 * ── 워커 부트 프리픽스 다이어트 · A1 (역할별 tools/list 스코핑) ──────────────
 *
 * 근거는 `v3/docs/token-efficiency-levers-2026-08-09.md` (#900) §3.4 실측이다.
 * marblo MCP 의 `tools/list` 직렬화는 44개 툴 40.8KB(~11.7K 토큰)이고, 그게
 * **매 요청** 워커 프리픽스에 실려 재전송된다. Claude 워커의 재전송 증폭이
 * 실측 50배이므로 프리픽스 1토큰은 세션당 50토큰이다. 그런데 그 44개 중
 * 워커 역할이 실제로 호출하는 것은 10여 개고, 나머지(dispatch/spawn/create/
 * merge/mission/worktree/telegram/flow…)는 오케스트레이터 전용이다.
 *
 * 그래서 `MARBLO_AGENT_ROLE` 이 **알려진 워커 역할일 때만** 그 역할이 쓰는
 * 툴만 등록한다. 나머지 경우는 전부 종전대로 전체 노출이다.
 *
 * ★설계 원칙 — fail-open. 스코핑은 "이 세션이 워커임을 확실히 알 때"만 켠다:
 *   · `MARBLO_AGENT_ROLE` 미설정(외부 Claude Code 세션, 전역 등록 MCP, 레거시
 *     스폰 경로) → 전체 노출.
 *   · 오케/리더 역할, `orchestrator-` 로 시작하는 agentId → 전체 노출.
 *   · 모르는 역할 이름 → 전체 노출. (모르는 역할을 굶기면 능력 손실이 조용히
 *     난다. 이 다이어트의 유일한 진짜 리스크가 그것이라 기본값을 안전 쪽에 둔다.)
 *
 * ★즉시 롤백 — `MARBLO_TOOL_SURFACE=full` 이면 역할과 무관하게 전체를 노출한다
 *   (`scoped` 는 반대로 강제 스코핑, 테스트/실측용). 앱 env 한 줄이면 되돌아간다.
 */

/** 워커 역할이 역할과 무관하게 **항상** 갖는 툴. 티켓 수명주기 + 보고 + 막힘 경로. */
export const WORKER_CORE_MCP_TOOLS = [
  // 역할 스킬 로드 — 자율 루프 1단계.
  "get_agent_skill",
  // 태스크 수명주기 (TODO → CLAIMED → IN_PROGRESS → REVIEW).
  "get_available_tasks",
  "claim_task",
  "update_task_status",
  "submit_for_review",
  // 읽기 — 배정된 티켓 본문/이력/의존성. 리뷰 task 분기가 남의 티켓을 읽는
  // 경로이기도 하므로 get_task/get_task_activities 는 반드시 남긴다.
  "get_task",
  "get_task_activities",
  "get_task_dependencies",
  "search_tasks",
  // 보고 · 피드백.
  "add_activity",
  "check_feedback",
  "acknowledge_feedback",
  // ★막힘 경로는 절대 스코핑하지 않는다. 이걸 빼면 워커가 막혔을 때 조용히
  //   추측으로 진행한다 — 다이어트가 만들 수 있는 최악의 회귀다.
  "ask_orchestrator",
  // 역할 스킬이 명시적으로 호출을 지시하는 툴.
  "request_model_escalation",
] as const;

/**
 * 로컬 tool-use 모델(30B+) 전용 최소 표면.
 *
 * 이 프로파일은 역할 자율 루프를 온전히 수행시키려는 것이 아니라, 이미 배정된
 * 한 턴을 끝내고 오케스트레이터에 상태를 되돌리는 데 필요한 보고/막힘 경로만
 * 남긴다. 실측상 로컬 중소형도 frontier용 40여 개 스키마와 긴 완료규약을 같이 받으면
 * superpowers 같은 무관 스킬/툴 경로를 헤매므로, 로컬은 별도 explicit override 를
 * 쓴다. Frontier/일반 워커의 역할별 scoped 표면은 그대로 유지한다.
 */
export const LOCAL_TOOL_USE_MCP_TOOLS = [
  "submit_for_review",
  "update_task_status",
  "add_activity",
  "ask_orchestrator",
] as const;

/**
 * 역할별 추가 툴. 코어에 없지만 그 역할의 정상 업무에 필요한 것만.
 * (없는 역할은 코어만 갖는다 — backend/frontend/test/flutter 가 그렇다.)
 */
export const ROLE_EXTRA_MCP_TOOLS: Readonly<Record<string, readonly string[]>> =
  {
    // backend: 로컬 지식 위키 MCP 도구 구현/검증 경로.
    backend: [
      "wiki_ingest",
      "wiki_query",
      "wiki_lint",
      "calendar_create",
      "calendar_patch",
      "gmail_draft",
      "gmail_send",
      "notion_write",
      "drive_write",
    ],
    // 랜딩 역할: PR 머지 + 티켓/워크트리 클로즈아웃이 본업이다.
    merge: ["merge_and_close", "get_worktree_audit", "list_worktree_audit"],
    // devops: 플릿 상태 조회(배포/정리 판단 근거).
    devops: ["get_agents", "get_ledger_spool_status"],
  };

/** 전체 표면을 유지하는 역할(오케스트레이터급). 워커 화이트리스트를 적용하지 않는다. */
export const FULL_TOOL_SURFACE_ROLES = new Set([
  "orchestrator",
  "team_leader",
  "teamleader",
  "pm",
  "planner",
  "lead",
]);

/**
 * 스코핑 대상이 되는(=알려진) 워커 역할. 여기 없는 역할은 fail-open.
 *
 * 이 레포에서 실제로 스폰되는 역할만 넣는다(`v3/skills/*_agent.md` + agent-config
 * 의 `ROLE_MCP_WHITELIST`). 새 역할을 추가할 때 여기 넣는 것을 잊으면 손해는
 * "절감을 못 본다"뿐이고, 잘못 넣으면 손해는 "능력을 잃는다"다 — 비대칭이 크므로
 * 목록은 관측된 역할로만 유지한다.
 */
export const SCOPED_WORKER_ROLES = new Set([
  "backend",
  "frontend",
  "test",
  "devops",
  "merge",
  "flutter",
]);

export type ToolSurfaceMode = "full" | "scoped";

export interface ToolSurface {
  mode: ToolSurfaceMode;
  /** 스코핑된 경우 노출할 툴 이름 집합. `full` 이면 null(=전부). */
  allowed: Set<string> | null;
  /** 정규화된 역할("" = 미상). */
  role: string;
  /** 왜 이 모드가 됐는지 — 부트 배너/디버깅용. */
  reason: string;
}

type SurfaceEnv = Record<string, string | undefined>;

/** 역할 하나가 갖는 툴 집합(코어 + 역할 추가분). 순수 — 테스트에서 직접 쓴다. */
export function toolsForWorkerRole(role: string): Set<string> {
  const normalized = (role || "").trim().toLowerCase();
  return new Set<string>([
    ...WORKER_CORE_MCP_TOOLS,
    ...(ROLE_EXTRA_MCP_TOOLS[normalized] ?? []),
  ]);
}

/**
 * 이 MCP 프로세스가 노출할 툴 표면을 결정한다.
 *
 * MCP 서버는 에이전트당 1 프로세스라 부팅 시 한 번 계산하면 된다.
 */
export function resolveToolSurface(env: SurfaceEnv = process.env): ToolSurface {
  const role = (env.MARBLO_AGENT_ROLE || "").trim().toLowerCase();
  const override = (env.MARBLO_TOOL_SURFACE || "").trim().toLowerCase();
  const agentId = env.MARBLO_AGENT_ID || "";

  if (override === "full") {
    return { mode: "full", allowed: null, role, reason: "override=full" };
  }
  if (override === "local-light") {
    return {
      mode: "scoped",
      allowed: new Set<string>(LOCAL_TOOL_USE_MCP_TOOLS),
      role,
      reason: "override=local-light",
    };
  }
  if (override === "scoped") {
    // 강제 스코핑. 역할을 모르면 코어만 — 실측 A/B 전용 경로다.
    return {
      mode: "scoped",
      allowed: toolsForWorkerRole(role),
      role,
      reason: "override=scoped",
    };
  }

  if (agentId.startsWith("orchestrator-")) {
    return {
      mode: "full",
      allowed: null,
      role,
      reason: "orchestrator agentId",
    };
  }
  if (!role) {
    return { mode: "full", allowed: null, role, reason: "role unknown" };
  }
  if (FULL_TOOL_SURFACE_ROLES.has(role)) {
    return { mode: "full", allowed: null, role, reason: "orchestrator role" };
  }
  if (!SCOPED_WORKER_ROLES.has(role)) {
    return { mode: "full", allowed: null, role, reason: "role not in policy" };
  }

  return {
    mode: "scoped",
    allowed: toolsForWorkerRole(role),
    role,
    reason: "worker role",
  };
}

export const CODEX_ORCH_REQUIRED_MCP_TOOLS = [
  "get_agent_skill",
  "get_all_tasks",
  "create_task",
  "create_tasks_bulk",
  "dispatch_task",
  "add_activity",
  "update_task_status",
  "get_agents",
  // Merge-time closeout. Listed here so the Codex orchestrator is told the tool
  // exists at boot: without it the orch falls back to `gh pr merge` alone and
  // the ticket + worktree are never closed out (ticket pn2m5cVx).
  "merge_and_close",
] as const;

export const CODEX_ORCH_REQUIRED_MCP_TOOL_COUNT =
  CODEX_ORCH_REQUIRED_MCP_TOOLS.length;

/**
 * What a tool promises to do with a `project_id` argument.
 *
 * Ticket IuucvLemDFvbh4UYmL1o: every read/query tool accepted `project_id` and
 * silently threw it away, so the orchestrator constitution's "pass project_id
 * and verify the result" procedure was not a real guarantee. There are now
 * exactly two honest contracts, and `project-lock-surface.test.ts` fails if a
 * tool declares `project_id` without picking one:
 *
 *   • "locked"  — the argument is honored, but a project other than the bound
 *     session project is refused with an actionable ProjectLockError. Never
 *     answers for a different project than the caller named.
 *   • "cross-project-create" — W7 writes that may deliberately file into another
 *     project. They already honor the argument (resolveProjectForCreate) and
 *     warn on any fallback, so they were never a silent-ignore path.
 *
 * There is deliberately no "ignored" contract. Accepting an argument and not
 * using it is the one behavior this registry exists to prevent.
 */
export type ProjectIdContract = "locked" | "cross-project-create";

export const PROJECT_ID_TOOL_CONTRACTS: Readonly<
  Record<string, ProjectIdContract>
> = {
  get_all_tasks: "locked",
  get_available_tasks: "locked",
  check_feedback: "locked",
  search_tasks: "locked",
  get_agents: "locked",
  create_flow: "locked",
  get_flows: "locked",
  add_pending_instruction: "locked",
  get_pending_instructions: "locked",
  get_open_questions: "locked",
  get_routing_effectiveness: "locked",
  get_model_guidance: "locked",
  list_worktree_audit: "locked",
  get_worktree_audit: "locked",
  create_task: "cross-project-create",
  create_tasks_bulk: "cross-project-create",
};
