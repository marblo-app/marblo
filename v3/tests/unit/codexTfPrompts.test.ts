import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { AgentConfigGenerator } from "../../electron/agent-config";

describe("Codex /tf prompt installation", () => {
  it("generates Marblo tf prompts in the per-agent CODEX_HOME", () => {
    const agentId = `test-codex-tf-${Date.now()}`;
    const generator = new AgentConfigGenerator();

    try {
      const cfg = generator.getLaunchConfig(
        { id: agentId, model: "gpt", role: "backend", command: "codex" },
        process.cwd(),
        "work on the task",
        "marblo-test-project",
      );

      const codexHome = cfg.env.CODEX_HOME;
      expect(codexHome).toBeTruthy();
      expect(
        fs.existsSync(path.join(codexHome, "prompts", "tf-start.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(codexHome, "prompts", "tf-status.md")),
      ).toBe(true);

      const startPrompt = fs.readFileSync(
        path.join(codexHome, "prompts", "tf-start.md"),
        "utf-8",
      );
      // frontmatter + Codex 전용 헤더. 헤더 문구는 codexTfPromptOverride 의
      // `# Marblo /${name} for Codex` 에서 온다.
      expect(startPrompt).toContain("description:");
      expect(startPrompt).toContain("# Marblo /tf-start for Codex");
      expect(startPrompt).toContain("create_tasks_bulk");
      expect(startPrompt).toContain("$ARGUMENTS");
    } finally {
      generator.cleanup(agentId);
      fs.rmSync(
        path.join(os.tmpdir(), "marblo-agent-configs", `codex-home-${agentId}`),
        {
          recursive: true,
          force: true,
        },
      );
    }
  });
});
