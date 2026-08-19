import fs from "fs";
import { describe, expect, it } from "vitest";
import {
  AgentConfigGenerator,
  generateEnglishRoleSkillContent,
} from "../../electron/agent-config";

describe("English role skill generation", () => {
  it("generates backend role instructions in English while preserving MCP protocol tool names", () => {
    const content = generateEnglishRoleSkillContent("backend");

    expect(content).toContain("# Backend Agent Skill (v3)");
    expect(content).toContain("Keep user-facing conversation in the user's locale");
    expect(content).toContain("submit_for_review");
    expect(content).toContain("update_task_status");
    expect(content).toContain("add_activity");
    expect(content).toContain("ask_orchestrator");
    expect(content).not.toContain("태스크");
    expect(content).not.toContain("사용자에게 직접 묻지");
  });

  it("generateSkillFile writes and returns the English runtime skill copy", () => {
    const generator = new AgentConfigGenerator();
    const skillPath = generator.generateSkillFile(
      "unit-agent-english",
      "backend",
      process.cwd(),
    );

    const content = fs.readFileSync(skillPath, "utf-8");
    expect(content).toContain("# Backend Agent Skill (v3)");
    expect(content).toContain("Task claimed. Starting work.");
    expect(content).toContain("submit_for_review(task_id)");
    expect(content).not.toContain("# Backend Agent 스킬");

    generator.cleanup("unit-agent-english");
  });
});
