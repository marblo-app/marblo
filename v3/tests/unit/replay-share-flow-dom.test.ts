/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));

const publishReplayMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/publicReplayService", () => ({
  PUBLIC_REPLAYS_COLLECTION: "publicReplays",
  getMissionPublication: vi.fn(async () => null),
  publicReplayUrl: (replayId: string) =>
    `https://marblo.app/ko/replay/${replayId}`,
  publishReplay: publishReplayMock,
  unpublishReplay: vi.fn(),
}));

import { ReplayShareFlow } from "../../src/components/work-history/replay/ReplayShareFlow";
import {
  PUBLIC_REPLAYS_COLLECTION,
  publishReplay,
} from "../../src/services/publicReplayService";
import type { MissionReplay } from "../../src/types/missionReplay";

function replay(): MissionReplay {
  return {
    replayVersion: 1,
    missionId: "mission-1",
    projectId: "project-1",
    goal: "Replay 공유 E2E",
    templateId: "feature",
    launchedAt: new Date("2026-08-02T00:00:00Z"),
    completedAt: new Date("2026-08-02T01:00:00Z"),
    stats: {
      tasks: 1,
      tasksDone: 1,
      agents: 1,
      prs: 1,
      filesChanged: 2,
      linesAdded: 10,
      linesDeleted: 1,
      testsPassed: 1,
      riskFlags: 0,
      reportsScanned: 1,
      retries: 0,
      durationMs: 3_600_000,
      costTotal: null,
    },
    cast: [],
    beats: [],
    prUrls: ["https://github.com/acme/app/pull/1"],
    provenance: {
      sources: {
        "mission.contextLog": "ok",
        task: "ok",
        "task.activity": "ok",
        audit_logs: "ok",
        projectAuditLog: "ok",
        merge_history: "ok",
      },
      generatedAt: new Date("2026-08-02T01:00:00Z"),
    },
  };
}

afterEach(() => {
  cleanup();
  publishReplayMock.mockReset();
});

describe("ReplayShareFlow DOM pipeline", () => {
  it("completed replay can publish a publicReplays URL and reach SNS intents", async () => {
    publishReplayMock.mockResolvedValue({
      replayId: "r123",
      level: "L2",
      url: "https://marblo.app/ko/replay/r123",
      publishedAt: new Date("2026-08-02T01:05:00Z"),
    });

    render(
      createElement(ReplayShareFlow, {
        replay: replay(),
        canPublish: true,
        publisherUid: "user-1",
        onClose: () => {},
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "다음: 생성" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "공개 URL 발행" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "공개 URL 만들기" }),
    );

    await waitFor(() => expect(publishReplay).toHaveBeenCalledTimes(1));
    expect(PUBLIC_REPLAYS_COLLECTION).toBe("publicReplays");
    expect(publishReplayMock.mock.calls[0][0]).toMatchObject({
      publisherUid: "user-1",
      replay: { missionId: "mission-1", projectId: "project-1" },
      redacted: { level: "L2", verified: true },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "다음: 채널 선택" }),
    );

    const xShare = await screen.findByRole("link", { name: "X 공유" });
    expect(xShare.getAttribute("href")).toContain(
      "https%3A%2F%2Fmarblo.app%2Fko%2Freplay%2Fr123",
    );
    expect(screen.getByRole("link", { name: "LinkedIn 공유" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Threads 공유" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "링크 복사" })).toBeTruthy();
  });
});
