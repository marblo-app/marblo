import { describe, expect, it } from "vitest";
import {
  INSTRUCTION_REDACTED_MAX_CHARS,
  buildLedgerEvent,
  hashInstruction,
  redactInstructionForLedger,
} from "../../electron/mcp-server/ledger";

describe("redactInstructionForLedger", () => {
  it("masks secrets and PII before ledger display storage", () => {
    const raw = [
      "Deploy with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz",
      "Contact owner@example.com or +82 10 1234 5678",
      "Worktree /Users/alice/.marblo/worktrees/project123/task456/src/index.ts",
    ].join("\n");

    const redacted = redactInstructionForLedger(raw);

    expect(redacted).toContain("OPENAI_API_KEY=<REDACTED>");
    expect(redacted).toContain("<EMAIL>");
    expect(redacted).toContain("<PHONE>");
    expect(redacted).toContain("<WORKTREE_PATH>");
    expect(redacted).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("owner@example.com");
    expect(redacted).not.toContain("+82 10 1234 5678");
    expect(redacted).not.toContain("/Users/alice");
  });

  it("truncates display text without storing the full instruction", () => {
    const raw = "A".repeat(INSTRUCTION_REDACTED_MAX_CHARS + 500);

    const redacted = redactInstructionForLedger(raw);

    expect(redacted).not.toBeNull();
    expect(redacted?.length).toBeLessThanOrEqual(
      INSTRUCTION_REDACTED_MAX_CHARS,
    );
    expect(redacted).toContain("[truncated]");
    expect(redacted).not.toBe(raw);
  });

  it("stores no display text when residual unsafe text remains", () => {
    const raw =
      "Use Authorization: Bearer oauth_access_token_1234567890 for local testing";

    const redacted = redactInstructionForLedger(raw);

    expect(redacted).toBeNull();
  });
});

describe("buildLedgerEvent instruction display fields", () => {
  it("keeps instructionHash while storing only the redacted display text", () => {
    const instruction =
      "Fix auth for user@example.com using OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz";

    const event = buildLedgerEvent({
      projectId: "project123",
      agentId: "agent123",
      toolName: "dispatch_task",
      params: {},
      result: "ok",
      duration: 1,
      success: true,
      instruction,
    });

    expect(event.instructionHash).toBe(hashInstruction(instruction));
    expect(event.instructionRedacted).toContain("<EMAIL>");
    expect(event.instructionRedacted).toContain("OPENAI_API_KEY=<REDACTED>");
    expect(event.instructionRedacted).not.toContain("user@example.com");
    expect(event.instructionRedacted).not.toContain(
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
    );
  });
});
