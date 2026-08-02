import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));

import {
  nextReplayShareStep,
  previousReplayShareStep,
  ReplayShareFlow,
  replayShareChannelMode,
  replayShareStepLabel,
} from "../../src/components/work-history/replay/ReplayShareFlow";
import type { MissionReplay } from "../../src/types/missionReplay";

function replay(): MissionReplay {
  return {
    replayVersion: 1,
    missionId: "mission-1",
    projectId: "project-1",
    goal: "Mission Replay 공유 흐름",
    templateId: "feature",
    launchedAt: new Date("2026-08-02T00:00:00Z"),
    completedAt: new Date("2026-08-02T01:00:00Z"),
    stats: {
      tasks: 1, tasksDone: 1, agents: 1, prs: 0, filesChanged: 0,
      linesAdded: 0, linesDeleted: 0, testsPassed: 1, riskFlags: 0,
      reportsScanned: 1, retries: 0, durationMs: 3600000, costTotal: null,
    },
    cast: [], beats: [], prUrls: [],
    provenance: {
      sources: {
        "mission.contextLog": "ok", task: "ok", "task.activity": "ok",
        audit_logs: "ok", projectAuditLog: "ok", merge_history: "ok",
      },
      generatedAt: new Date("2026-08-02T01:00:00Z"),
    },
  };
}

describe("ReplayShareFlow", () => {
  it("moves through the three bounded wizard steps", () => {
    expect(replayShareStepLabel(1)).toBe("형식 선택");
    expect(nextReplayShareStep(1)).toBe(2);
    expect(nextReplayShareStep(2)).toBe(3);
    expect(nextReplayShareStep(3)).toBe(3);
    expect(previousReplayShareStep(3)).toBe(2);
    expect(previousReplayShareStep(1)).toBe(1);
  });

  it("uses an automatic intent only for text/link and download-plus-compose for files", () => {
    expect(replayShareChannelMode("link")).toBe("intent");
    expect(replayShareChannelMode("image")).toBe("download-and-compose");
    expect(replayShareChannelMode("gif")).toBe("download-and-compose");
  });

  it("offers all formats and makes the OG-card benefit clear on the first step", () => {
    const markup = renderToStaticMarkup(createElement(ReplayShareFlow, {
      replay: replay(), canPublish: false, onClose: () => {},
    }));
    expect(markup).toContain("텍스트 · 링크");
    expect(markup).toContain("이미지 카드");
    expect(markup).toContain("GIF");
    expect(markup).toContain("OG 카드가 자동 미리보기됩니다");
  });
});
