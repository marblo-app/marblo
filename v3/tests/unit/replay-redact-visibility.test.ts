import { describe, expect, it } from "vitest";
import { redactReplay } from "../../src/lib/replay/redactReplay";
import { ReplayVisibilityPanel } from "../../src/components/work-history/replay/ReplayVisibilityPanel";
import { RedactionPreview } from "../../src/components/work-history/replay/RedactionPreview";
import type { MissionReplay } from "../../src/types/missionReplay";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const replay: MissionReplay = {
  replayVersion: 1,
  missionId: "mission-1234567890123456",
  projectId: "project-1234567890123456",
  goal: "Ship the replay redaction boundary",
  templateId: "feature",
  launchedAt: new Date("2026-08-01T09:00:00Z"),
  completedAt: new Date("2026-08-01T09:12:00Z"),
  stats: {
    tasks: 2, tasksDone: 2, agents: 1, prs: 1, filesChanged: 3,
    linesAdded: 20, linesDeleted: 4, testsPassed: 2, riskFlags: 0,
    reportsScanned: 2, retries: 0, durationMs: 720000, costTotal: 4.2,
  },
  cast: [{ agentRef: "agent-1 · codex", vendor: "codex", spawnedModel: null, detectedModelId: null, role: "frontend", tasksCompleted: 2, beats: 4 }],
  beats: [{ id: "beat-1", ts: new Date("2026-08-01T09:01:00Z"), lane: "agent", source: "task", kind: "task.completed", taskId: "task-1234567890123456", agentRef: "agent-1 · codex", actorRef: null, title: "Completed", detail: "terminal output must not leave the app", sensitivity: "detail" }],
  prUrls: ["https://github.com/example/public/pull/1"],
  provenance: { sources: { "mission.contextLog": "ok", task: "ok", "task.activity": "ok", audit_logs: "empty", projectAuditLog: "empty", merge_history: "ok" }, generatedAt: new Date("2026-08-01T09:12:00Z") },
};

describe("Mission Replay redaction boundary", () => {
  it("uses one serialized payload for preview and future publication", () => {
    const redacted = redactReplay(replay, { level: "L2" });
    expect(redacted.verified).toBe(true);
    expect(redacted.serialized).toBe(JSON.stringify(redacted.payload, null, 2));
    expect(redacted.serialized).not.toContain("terminal output must not leave the app");
    expect(redacted.serialized).not.toContain("4.2");
    expect(redacted.removed.length).toBeGreaterThan(0);
    expect(renderToStaticMarkup(createElement(RedactionPreview, { redacted }))).toContain(redacted.serialized.replaceAll('"', "&quot;"));
  });

  it("renders CEO defaults without an outward-facing action", () => {
    const markup = renderToStaticMarkup(createElement(ReplayVisibilityPanel));
    expect(markup).toContain('value="L2"');
    expect(markup).toContain('value="L0"');
    expect(markup).toContain("기본 OFF");
    expect(markup).toContain("기본 익명");
    expect(markup).toContain("완료 미션만");
    expect(markup).not.toMatch(/공유|발행/);
  });
});
