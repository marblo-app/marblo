import { describe, expect, it } from "vitest";
import { AgentConfigGenerator } from "../../electron/agent-config";

/**
 * Codex resume contract, pinned against the REAL AgentConfigGenerator.
 *
 * These assert on the argv actually handed to node-pty rather than on a
 * hand-written fake of getLaunchConfig — a mocked launch config would stay
 * green even if the real builder stopped emitting `codex resume` at all,
 * which is precisely the regression this ticket is about.
 *
 * Contract verified live against codex-cli 0.144.5 (see ticket
 * yiKSOMILEE2gwf3ZsuZV):
 *   codex resume --last          → resumes this CODEX_HOME's last session;
 *                                  boots a fresh session on an empty home.
 *   codex resume <unknown-uuid>  → exits 1, "No saved session found with ID".
 * So an unknown concrete id is FATAL while --last degrades gracefully. Codex
 * must therefore never be handed a Claude session uuid.
 */
describe("Codex resume args (real buildCLICommand)", () => {
  const generator = new AgentConfigGenerator();

  function codexArgs(resumeSessionId?: string): string[] {
    return generator.getLaunchConfig(
      {
        id: "orchestrator-test-project",
        model: "gpt",
        role: "orchestrator",
        command: "codex",
      },
      process.cwd(),
      undefined,
      "test-project",
      resumeSessionId,
    ).args;
  }

  it("emits `codex resume --last` for the 'latest' sentinel", () => {
    const args = codexArgs("latest");
    // `resume` is a SUBCOMMAND — it must precede the global -c overrides.
    expect(args[0]).toBe("resume");
    expect(args[1]).toBe("--last");
    expect(args.indexOf("resume")).toBeLessThan(args.indexOf("-c"));
  });

  it("passes a concrete session id as the positional resume arg", () => {
    const args = codexArgs("019f67fa-5377-75a3-8928-7f576c6fddb5");
    expect(args[0]).toBe("resume");
    expect(args[1]).toBe("019f67fa-5377-75a3-8928-7f576c6fddb5");
    expect(args).not.toContain("--last");
  });

  it("emits no resume subcommand for a fresh launch", () => {
    expect(codexArgs("new")).not.toContain("resume");
    expect(codexArgs(undefined)).not.toContain("resume");
  });

  it("never emits the Claude --resume flag for codex", () => {
    // Guards against the Claude convention leaking onto the codex path.
    expect(codexArgs("latest")).not.toContain("--resume");
  });

  it("reports no saved session for an agent whose isolated home is empty", () => {
    // The gate that keeps `--last` off a never-run agent. A random id has no
    // codex-home-<id> dir, so this must be false.
    expect(
      generator.hasSavedSession("agent-that-never-ran-9f3a2b1c", "gpt"),
    ).toBe(false);
  });
});
