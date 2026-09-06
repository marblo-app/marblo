import { describe, it, expect } from "vitest";
import {
  formatActivity,
  type FormattedActivity,
  type TranslateFn,
} from "../../src/services/activityFormatters";
import type { ActivityEntry } from "../../src/services/activityStreamService";
import { ko, type MessageKey } from "../../src/locales/ko";

/**
 * `formatActivity(entry, t)` 는 번역기를 인자로 받는다(모듈 레벨 `t()` 를 쓰면
 * 로케일 토글에 재렌더가 안 붙어서). 테스트는 실제 ko 테이블로 만든 번역기를
 * 주입하되 `lib/i18n` 의 스토어는 타지 않는다 — 그쪽 초기 로케일이
 * `navigator.language`/localStorage 파생이라 머신·환경에 따라 ko/en 이 갈리기
 * 때문. 여기서 만든 번역기는 항상 ko 테이블을 본다.
 *
 * 없는 키는 조용히 key 문자열로 폴백하지 않고 throw — 포매터가 오타난 키를
 * 쓰면 "헤드라인이 키 이름 그대로" 라는 조용한 회귀 대신 즉시 실패한다.
 */
const t: TranslateFn = (key, vars) => {
  const raw = (ko as Record<string, string | undefined>)[key];
  if (raw === undefined) throw new Error(`unknown message key: ${key}`);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
};

/**
 * 헤드라인 단언 — 영어 리터럴 대신 "어떤 키를 어떤 보간값으로 썼는가" 를
 * 고정한다. 문구 카피 편집엔 안 깨지고, 키/보간이 틀어지면 깨진다.
 * 미치환 `{placeholder}` 가 남아 사용자에게 노출되는 경우도 함께 잡는다.
 */
function expectHeadline(
  out: FormattedActivity,
  key: MessageKey,
  vars?: Record<string, string | number>,
) {
  expect(out.headline).toBe(t(key, vars));
  expect(out.headline).not.toMatch(/\{\w+\}/);
}

/** body 가 있을 때만 " — " 로 잇는 포매터의 joinWithDash 와 같은 규약. */
function dash(prefix: string, body: string): string {
  return body ? `${prefix} — ${body}` : prefix;
}

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: "x",
    type: "other",
    toolName: "noop",
    agentId: "agent-1",
    projectId: "p",
    params: {},
    result: "",
    duration: 0,
    success: true,
    createdAt: new Date(),
    ...over,
  };
}

describe("formatActivity", () => {
  it("task:created — title 으로 헤드라인 구성", () => {
    const out = formatActivity(
      entry({
        type: "task:created",
        toolName: "create_task",
        params: { title: "백엔드 API" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskCreated", {
      title: "백엔드 API",
    });
  });

  it("task:claimed — agent + title", () => {
    const out = formatActivity(
      entry({
        type: "task:claimed",
        toolName: "claim_task",
        agentId: "backend-1",
        params: { title: "API 작업" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskClaimed", {
      agent: "backend-1",
      title: "API 작업",
    });
  });

  it("task:completed — DONE 상태", () => {
    const out = formatActivity(
      entry({
        type: "task:completed",
        toolName: "update_task_status",
        params: { title: "마이그레이션", status: "DONE" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskCompleted", {
      title: "마이그레이션",
    });
  });

  it("task:blocked — reason 포함", () => {
    const out = formatActivity(
      entry({
        type: "task:blocked",
        toolName: "update_task_status",
        params: { title: "Step A", status: "BLOCKED", reason: "DB lock" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskBlocked", {
      title: "Step A",
      reason: "DB lock",
    });
  });

  it("agent:spawned — name + role + initial_prompt 첫줄 → 헤드라인", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: {
          name: "backend-auth",
          role: "backend",
          model: "claude",
          initial_prompt:
            "JWT 인증 미들웨어 작성\n\n자세한 요구사항: ... (긴 내용 생략)",
        },
        result:
          "Agent spawned successfully!\n  Name: backend-auth\n  Model: claude\n  Role: backend\n  Agent ID: agent-abc123\n  PTY Session: pty-1",
      }),
      t,
    );
    // initial_prompt 는 첫 줄만 — 뒤의 긴 본문은 헤드라인에 안 샌다.
    expectHeadline(out, "activity.headline.agentSpawnedWithTask", {
      name: "backend-auth (backend)",
      task: "JWT 인증 미들웨어 작성",
    });
  });

  it("agent:spawned — initial_prompt 없으면 task 부분 생략", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: { name: "frontend-1", role: "frontend", model: "gemini" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.agentSpawned", {
      name: "frontend-1 (frontend)",
    });
  });

  it("agent:spawned — spawnedModel 이 있으면 모델 상세는 실제 모델을 먼저 보여준다", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: {
          name: "reviewer",
          role: "frontend",
          model: "gpt",
          spawnedModel: "solar-pro4@high",
        },
      }),
      t,
    );

    expect(out.details).toContainEqual({
      label: t("activity.label.model"),
      value: "solar-pro4@high · gpt",
    });
  });

  it("agent:spawned — MCP result 의 Spawned model 도 모델 상세에 쓴다", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: { name: "reviewer", role: "frontend", model: "gpt" },
        result:
          "Agent spawned successfully!\n  Name: reviewer\n  Model: gpt\n  Spawned model: solar-pro4@high\n  Role: frontend",
      }),
      t,
    );

    expect(out.details).toContainEqual({
      label: t("activity.label.model"),
      value: "solar-pro4@high · gpt",
    });
  });

  it("agent:spawned — name 없으면 result 의 Agent ID 로 폴백", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: { role: "test" },
        result: "Agent spawned successfully!\n  Agent ID: agent-xyz789",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.agentSpawned", {
      name: "agent-xyz789 (test)",
    });
  });

  it("mission:step — result(이미 정제된 한국어) 그대로 사용", () => {
    const out = formatActivity(
      entry({
        type: "mission:step",
        toolName: "mission.step.started",
        result: "Step 2 · skill_name",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.mission", {
      body: "Step 2 · skill_name",
    });
  });

  it("mission:state — result 그대로", () => {
    const out = formatActivity(
      entry({
        type: "mission:state",
        toolName: "mission.mission.paused",
        result: "Paused · user-input",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.mission", {
      body: "Paused · user-input",
    });
  });

  it("activity:note — message 본문", () => {
    const out = formatActivity(
      entry({
        type: "activity:note",
        toolName: "add_activity",
        agentId: "backend-2",
        params: { message: "DB 마이그레이션 시작" },
      }),
      t,
    );
    expect(out.headline).toBe(
      dash(
        t("activity.headline.notePrefix", { agent: "backend-2" }),
        "DB 마이그레이션 시작",
      ),
    );
  });

  it("error — failed tool 이름 + reason", () => {
    const out = formatActivity(
      entry({
        type: "error",
        toolName: "create_task",
        success: false,
        result: "validation failed: title required",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.error", {
      tool: "create_task",
      result: "validation failed: title required",
    });
  });

  it("title 누락 시 fallback title", () => {
    const out = formatActivity(
      entry({ type: "task:created", toolName: "create_task", params: {} }),
      t,
    );
    expectHeadline(out, "activity.headline.taskCreated", {
      title: t("activity.fallback.title"),
    });
  });

  it("raw result 를 절대 headline 으로 노출하지 않음 (other 타입)", () => {
    const out = formatActivity(
      entry({
        type: "other",
        toolName: "unknown_tool",
        result: "# Orchestrator Agent 스킬 본문...".repeat(20),
      }),
      t,
    );
    expect(out.headline).toBe(""); // 빈 헤드라인 → 카드 미렌더
  });

  it("task:progress — IN_PROGRESS / submit_for_review 경로", () => {
    const out = formatActivity(
      entry({
        type: "task:progress",
        toolName: "submit_for_review",
        params: { title: "API 리팩터" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskProgress", {
      title: "API 리팩터",
    });
  });

  it("mission:note — agent 가 supervisor 노트로 남긴 항목", () => {
    const out = formatActivity(
      entry({
        type: "mission:note",
        toolName: "mission.supervisor.note",
        agentId: "mission:abc12345",
        result: "스텝 2 재시도 결정",
      }),
      t,
    );
    expect(out.headline).toBe(
      dash(
        t("activity.headline.missionNotePrefix", { agent: "mission:abc12345" }),
        "스텝 2 재시도 결정",
      ),
    );
  });

  it("pm:feedback — 피드백 카드 헤드라인", () => {
    const out = formatActivity(
      entry({
        type: "pm:feedback",
        toolName: "acknowledge_feedback",
        params: { title: "백엔드 API 작업" },
      }),
      t,
    );
    expectHeadline(out, "activity.headline.pmFeedback", {
      title: "백엔드 API 작업",
    });
  });

  // ── 프로덕션 경로: 실제 tool schema 에 title 없을 때 result 에서 추출 ──

  it("task:completed — params 에 title 없으면 update_task_status result 에서 추출", () => {
    const out = formatActivity(
      entry({
        type: "task:completed",
        toolName: "update_task_status",
        params: { task_id: "abc12345-0000", status: "DONE" },
        result: "Task '백엔드 마이그레이션' status updated to DONE.",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskCompleted", {
      title: "백엔드 마이그레이션",
    });
  });

  it("task:claimed — claim_task result 의 'Successfully claimed task:' 패턴 추출", () => {
    const out = formatActivity(
      entry({
        type: "task:claimed",
        toolName: "claim_task",
        agentId: "backend-3",
        params: { task_id: "def67890" },
        result:
          "Successfully claimed task: 프론트엔드 리팩터\nID: def67890\nStatus: CLAIMED",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskClaimed", {
      agent: "backend-3",
      title: "프론트엔드 리팩터",
    });
  });

  it("task:progress — title 도 result 도 못찾으면 task_id 8자 폴백", () => {
    const out = formatActivity(
      entry({
        type: "task:progress",
        toolName: "submit_for_review",
        params: { task_id: "ef0e9f11-816a-4ac1" },
        result: "(empty/non-matching)",
      }),
      t,
    );
    expectHeadline(out, "activity.headline.taskProgress", {
      title: "task ef0e9f11",
    });
  });

  it("activity:note — 빈 message 일 때 trailing dash 안 남기고 fallback 문구", () => {
    const out = formatActivity(
      entry({
        type: "activity:note",
        toolName: "add_activity",
        agentId: "backend-4",
        params: {},
      }),
      t,
    );
    expect(out.headline).toBe(
      dash(
        t("activity.headline.notePrefix", { agent: "backend-4" }),
        t("activity.fallback.noteMessage"),
      ),
    );
  });

  it("mission:note — 빈 body 폴백", () => {
    const out = formatActivity(
      entry({
        type: "mission:note",
        toolName: "mission.supervisor.note",
        agentId: "mission:xyz98765",
        result: "",
      }),
      t,
    );
    expect(out.headline).toBe(
      dash(
        t("activity.headline.missionNotePrefix", { agent: "mission:xyz98765" }),
        t("activity.fallback.noteMessage"),
      ),
    );
  });

  // ── details: raw payload 누출 방지 (화이트리스트 KV 만) ──

  it("details — agent:spawned 는 사람친화 필드만 포함, raw JSON 노출 없음", () => {
    const out = formatActivity(
      entry({
        type: "agent:spawned",
        toolName: "spawn_agent",
        params: {
          name: "backend-auth",
          role: "backend",
          model: "claude",
          initial_prompt: "JWT 인증 미들웨어 작성",
          cwd: "/some/internal/path",
        },
        result:
          "Agent spawned successfully!\n  Name: backend-auth\n  Agent ID: agent-abc",
      }),
      t,
    );
    const labels = out.details.map((d) => d.label);
    expect(labels).toEqual([
      t("activity.label.name"),
      t("activity.label.agentId"),
      t("activity.label.role"),
      t("activity.label.model"),
      t("activity.label.task"),
    ]);
    expect(
      out.details.find((d) => d.label === t("activity.label.task"))?.value,
    ).toBe("JWT 인증 미들웨어 작성");
    // 화이트리스트 외 필드 (cwd) 는 details 에 안 나옴
    expect(labels).not.toContain("cwd");
    expect(out.details.map((d) => d.value)).not.toContain(
      "/some/internal/path",
    );
  });

  it("details — activity:note 는 Agent + Message 만, task_id 누출 없음", () => {
    const out = formatActivity(
      entry({
        type: "activity:note",
        toolName: "add_activity",
        agentId: "backend-2",
        params: {
          task_id: "abc12345-0000",
          message: "마이그레이션 시작",
          agent_id: "backend-2",
        },
      }),
      t,
    );
    const labels = out.details.map((d) => d.label);
    expect(labels).toEqual([
      t("activity.label.agent"),
      t("activity.label.message"),
    ]);
    expect(out.details.map((d) => d.value)).not.toContain("abc12345-0000");
  });

  it("details — other 는 빈 배열 → 디테일 영역 미렌더", () => {
    const out = formatActivity(
      entry({
        type: "other",
        toolName: "get_agent_skill",
        result: "# Orchestrator skill 본문 ".repeat(50),
      }),
      t,
    );
    expect(out.details).toEqual([]);
  });

  it("details — task:created 는 description 있을 때만 포함", () => {
    const withDesc = formatActivity(
      entry({
        type: "task:created",
        toolName: "create_task",
        params: { title: "API", role: "backend", description: "OAuth flow" },
      }),
      t,
    );
    expect(withDesc.details.map((d) => d.label)).toEqual([
      t("activity.label.title"),
      t("activity.label.role"),
      t("activity.label.description"),
    ]);

    const withoutDesc = formatActivity(
      entry({
        type: "task:created",
        toolName: "create_task",
        params: { title: "API" },
      }),
      t,
    );
    expect(withoutDesc.details.map((d) => d.label)).toEqual([
      t("activity.label.title"),
    ]);
  });

  it("details — error 는 Tool + Message 만", () => {
    const out = formatActivity(
      entry({
        type: "error",
        toolName: "create_task",
        success: false,
        result: "validation failed: title required",
      }),
      t,
    );
    expect(out.details).toEqual([
      { label: t("activity.label.tool"), value: "create_task" },
      {
        label: t("activity.label.message"),
        value: "validation failed: title required",
      },
    ]);
  });

  it("★번역기가 실제로 쓰인다 — 주입한 t 의 결과가 헤드라인/라벨에 그대로 반영", () => {
    // 포매터가 몰래 모듈 레벨 t() 로 되돌아가면(로케일 토글 무반응 회귀) 이
    // 단언이 깨진다: 여기 t 는 키를 그대로 돌려주는 identity 번역기다.
    const identity: TranslateFn = (key) => key;
    const out = formatActivity(
      entry({
        type: "task:created",
        toolName: "create_task",
        params: { title: "API", role: "backend" },
      }),
      identity,
    );
    expect(out.headline).toBe("activity.headline.taskCreated");
    expect(out.details.map((d) => d.label)).toEqual([
      "activity.label.title",
      "activity.label.role",
    ]);
  });
});
