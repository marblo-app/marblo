/**
 * 티켓 x4EGDVAWLuy2sdPb9fEK — 워커 부트 프리픽스 다이어트.
 *
 * 이 다이어트의 유일한 진짜 리스크는 **조용한 능력 손실**이다: 스코핑이 너무
 * 세서 워커가 필요한 툴을 못 보면, 실패가 "툴 없음"이 아니라 "그 워커가 왜인지
 * 일을 못 끝냄"으로 나타난다. 그래서 여기서 고정하는 것은 절감량이 아니라
 * **안전 불변식**이다:
 *
 *   1. 화이트리스트의 모든 이름이 실제 등록된 툴이다(오타 = 조용한 무효 항목).
 *   2. 막힘 경로(ask_orchestrator)와 완료 보고 경로는 어떤 역할에서도 안 사라진다.
 *   3. 모르는 역할·역할 미상·오케스트레이터는 **전체 표면**을 받는다(fail-open).
 *   4. `MARBLO_TOOL_SURFACE=full` 이면 역할과 무관하게 전체다(즉시 롤백).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ROLE_EXTRA_MCP_TOOLS,
  SCOPED_WORKER_ROLES,
  WORKER_CORE_MCP_TOOLS,
  resolveToolSurface,
  toolsForWorkerRole,
} from "../../electron/mcp-server/tool-surface";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(here, "../../electron/mcp-server/tools.ts"),
  "utf8",
);

/** tools.ts 가 실제로 등록하는 툴 이름 전체. */
function registeredToolNames(): string[] {
  const re = /\n {2}auditedTool\(\s*\n\s*"([a-z_]+)",/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SOURCE)) !== null) names.push(m[1]);
  return names;
}

describe("worker tool surface — 화이트리스트 정합성", () => {
  const registered = new Set(registeredToolNames());

  it("등록된 툴을 파싱해낸다 (파서가 죽으면 아래 검사가 전부 공허해진다)", () => {
    expect(registered.size).toBeGreaterThan(30);
    expect(registered.has("ask_orchestrator")).toBe(true);
  });

  it("코어 화이트리스트의 모든 이름이 실재하는 툴이다", () => {
    const unknown = WORKER_CORE_MCP_TOOLS.filter((t) => !registered.has(t));
    expect(unknown).toEqual([]);
  });

  it("역할별 추가 화이트리스트의 모든 이름이 실재하는 툴이다", () => {
    const unknown = Object.entries(ROLE_EXTRA_MCP_TOOLS).flatMap(
      ([role, tools]) =>
        tools.filter((t) => !registered.has(t)).map((t) => `${role}:${t}`),
    );
    expect(unknown).toEqual([]);
  });

  it("스코핑은 실제로 표면을 줄인다 (줄지 않으면 절감이 0이다)", () => {
    const backend = toolsForWorkerRole("backend");
    expect(backend.size).toBeLessThan(registered.size / 2);
  });
});

describe("worker tool surface — 능력 회귀 가드", () => {
  // 이 툴들이 사라지면 워커가 (a) 막혀도 못 묻고 (b) 결과를 보고 못 한다.
  // 오케스트레이터는 그걸 "무응답 에이전트"로만 관측하게 된다.
  const NEVER_SCOPE_AWAY = [
    "ask_orchestrator",
    "update_task_status",
    "add_activity",
    "submit_for_review",
    "claim_task",
    "get_agent_skill",
    "get_task",
  ];

  for (const role of SCOPED_WORKER_ROLES) {
    it(`role=${role} 은 막힘/보고 경로를 전부 갖는다`, () => {
      const tools = toolsForWorkerRole(role);
      for (const t of NEVER_SCOPE_AWAY) expect(tools.has(t)).toBe(true);
    });
  }

  it("역할별 추가 툴은 코어에 더해질 뿐 빼지 않는다", () => {
    const merge = toolsForWorkerRole("merge");
    for (const t of WORKER_CORE_MCP_TOOLS) expect(merge.has(t)).toBe(true);
    expect(merge.has("merge_and_close")).toBe(true);
  });
});

describe("resolveToolSurface — fail-open 규율", () => {
  it("역할 미상이면 전체 표면", () => {
    const s = resolveToolSurface({});
    expect(s.mode).toBe("full");
    expect(s.allowed).toBeNull();
  });

  it("모르는 역할이면 전체 표면 (새 역할을 굶기지 않는다)", () => {
    const s = resolveToolSurface({ MARBLO_AGENT_ROLE: "qa" });
    expect(s.mode).toBe("full");
    expect(s.reason).toBe("role not in policy");
  });

  it("오케스트레이터 역할은 전체 표면", () => {
    expect(resolveToolSurface({ MARBLO_AGENT_ROLE: "orchestrator" }).mode).toBe(
      "full",
    );
    expect(resolveToolSurface({ MARBLO_AGENT_ROLE: "team_leader" }).mode).toBe(
      "full",
    );
  });

  it("orchestrator- agentId 는 역할이 워커로 잘못 붙어도 전체 표면", () => {
    const s = resolveToolSurface({
      MARBLO_AGENT_ROLE: "backend",
      MARBLO_AGENT_ID: "orchestrator-board-proj1",
    });
    expect(s.mode).toBe("full");
  });

  it("알려진 워커 역할만 스코핑된다", () => {
    const s = resolveToolSurface({ MARBLO_AGENT_ROLE: "backend" });
    expect(s.mode).toBe("scoped");
    expect(s.allowed?.has("dispatch_task")).toBe(false);
    expect(s.allowed?.has("ask_orchestrator")).toBe(true);
  });

  it("역할 이름은 대소문자·공백에 강건하다", () => {
    expect(resolveToolSurface({ MARBLO_AGENT_ROLE: " Backend " }).mode).toBe(
      "scoped",
    );
  });
});

describe("resolveToolSurface — 롤백 스위치", () => {
  it("MARBLO_TOOL_SURFACE=full 이면 워커도 전체 표면", () => {
    const s = resolveToolSurface({
      MARBLO_AGENT_ROLE: "backend",
      MARBLO_TOOL_SURFACE: "full",
    });
    expect(s.mode).toBe("full");
    expect(s.allowed).toBeNull();
  });

  it("MARBLO_TOOL_SURFACE=scoped 는 역할 미상이어도 강제 스코핑(A/B 실측용)", () => {
    const s = resolveToolSurface({ MARBLO_TOOL_SURFACE: "scoped" });
    expect(s.mode).toBe("scoped");
    expect(s.allowed?.has("ask_orchestrator")).toBe(true);
  });
});
