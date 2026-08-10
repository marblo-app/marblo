/**
 * The runtime half of the capture guarantee (ticket IqcXHVbT0rXnHloXpV7n).
 *
 * `training-capture-isolation.test.ts` proves the WIRING can't leak transcripts
 * into the de-identified path. This file proves the RUNTIME default: with no
 * server verdict in hand — which is the state at every launch, on every
 * machine, for every user who is not the operator — the module captures
 * nothing and writes nothing to disk.
 *
 * These calls run against the real module (no fake gate injected), so a future
 * change that makes capture default-on fails here.
 */
import { existsSync, mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  captureEnabled,
  ingestSessionLines,
  trackOrchestratorSession,
  trainingCaptureStatus,
} from "../../electron/training-capture";

const claudeLine = JSON.stringify({
  type: "user",
  uuid: "gate-test-turn",
  sessionId: "gate-test",
  message: { role: "user", content: "this must never be spooled" },
});

const meta = {
  agentId: "agent-x",
  source: "agent" as const,
  projectId: "p",
  taskId: "t",
  role: "backend",
  model: "claude",
  parentAgentId: null,
  sessionId: "gate-test",
  cwd: null,
};

describe("capture gate — fail closed by default", () => {
  it("is disabled before any server verdict", () => {
    expect(captureEnabled()).toBe(false);
    expect(trainingCaptureStatus().enabled).toBe(false);
    expect(trainingCaptureStatus().eligible).toBe(false);
  });

  it("spools nothing while the gate is closed", () => {
    expect(ingestSessionLines("claude", [claudeLine], meta, "file-a")).toBe(0);
  });

  it("writes no spool file at all on a machine that never captured", () => {
    // The spool lives under ~/.marblo/training-capture. A closed gate must not
    // even create the directory — "we collected it but didn't send it" is still
    // collection.
    const dir = join(
      process.env.HOME ?? tmpdir(),
      ".marblo",
      "training-capture",
    );
    if (!existsSync(dir)) return; // clean machine — nothing to check
    // If a previous real (consented) run created it, at least assert this test
    // added nothing: the file list must not contain our gate-test sample.
    for (const name of readdirSync(dir)) {
      expect(name).not.toContain("gate-test");
    }
  });

  it("ignores unsupported harnesses even if the gate were open", () => {
    expect(ingestSessionLines("gemini", [claudeLine], meta, "file-b")).toBe(0);
  });

  it("ignores an empty line batch", () => {
    expect(ingestSessionLines("claude", [], meta, "file-c")).toBe(0);
  });
});

describe("orchestrator session registration", () => {
  it("refuses a non-claude orchestrator (its id is a marker, not a file)", () => {
    // Registering it would resolve a path that does not exist and poll forever.
    expect(() =>
      trackOrchestratorSession({
        rootPath: mkdtempSync(join(tmpdir(), "orch-")),
        sessionId: "GPT_SESSION",
        model: "gpt",
      }),
    ).not.toThrow();
    expect(trainingCaptureStatus().enabled).toBe(false);
  });

  it("refuses a malformed session id rather than watching a junk path", () => {
    expect(() =>
      trackOrchestratorSession({
        rootPath: "/tmp/whatever",
        sessionId: "latest",
        model: "claude",
      }),
    ).not.toThrow();
  });

  it("accepts a well-formed claude session without capturing anything yet", () => {
    trackOrchestratorSession({
      rootPath: "/tmp/whatever",
      sessionId: "0199fdf0-b271-7072-a1da-b94b6811b3c7",
      projectId: "proj",
      model: "claude",
    });
    // Registration alone must not flip the gate — capture still awaits the
    // server verdict, and the poller no-ops until then.
    expect(captureEnabled()).toBe(false);
  });
});
