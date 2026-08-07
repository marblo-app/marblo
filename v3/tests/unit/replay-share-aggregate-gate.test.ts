/**
 * @vitest-environment jsdom
 *
 * Aggregate Share root-cause regression:
 * `getMissionPublication` hang must NOT block Card PNG / GIF generation.
 * Lightweight replay from DONE tasks must produce a downloadable asset.
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

const getMissionPublicationMock = vi.hoisted(() =>
  vi.fn(() => new Promise(() => {})),
);
const renderReplayCardPngMock = vi.hoisted(() =>
  vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
);
const renderReplayMotionGifMock = vi.hoisted(() =>
  vi.fn(async () => new Blob(["gif-bytes"], { type: "image/gif" })),
);

vi.mock("../../src/services/publicReplayService", () => ({
  PUBLIC_REPLAYS_COLLECTION: "publicReplays",
  getMissionPublication: getMissionPublicationMock,
  publicReplayUrl: (id: string) => `https://marblo.app/ko/replay/${id}`,
  publishReplay: vi.fn(),
  unpublishReplay: vi.fn(),
}));

vi.mock("../../src/lib/replay/export/card", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/replay/export/card")
  >("../../src/lib/replay/export/card");
  return { ...actual, renderReplayCardPng: renderReplayCardPngMock };
});

vi.mock("../../src/lib/replay/export/gif", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/lib/replay/export/gif")
  >("../../src/lib/replay/export/gif");
  return { ...actual, renderReplayMotionGif: renderReplayMotionGifMock };
});

const { buildLightweightReplayFromCompletedTasks } = await import(
  "../../src/hooks/useMissionReplay"
);
const { redactReplay } = await import("../../src/lib/replay/redactReplay");
const { ReplayShareFlow } = await import(
  "../../src/components/work-history/replay/ReplayShareFlow"
);
import type { Task } from "../../src/types/task";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "ticket-hero",
    projectId: "mock-replay-project",
    contextId: null as unknown as string,
    title: "집계 공유 진입 배선",
    description: "",
    status: "DONE",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-frontend",
    claimedAt: new Date("2026-08-01T09:10:00Z"),
    scope: [],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date("2026-08-01T09:05:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

function lightweightReplay() {
  const built = buildLightweightReplayFromCompletedTasks({
    projectId: "mock-replay-project",
    tasks: [
      makeTask(),
      makeTask({
        id: "ticket-cast",
        title: "ReplayCast 시각 스트립",
        claimedBy: "agent-ui",
        updatedAt: new Date("2026-08-01T10:20:00Z"),
      }),
    ],
    now: new Date("2026-08-01T12:00:00Z"),
  });
  if (!built) throw new Error("expected lightweight replay");
  return built.replay;
}

afterEach(() => {
  cleanup();
  getMissionPublicationMock.mockReset();
  getMissionPublicationMock.mockImplementation(() => new Promise(() => {}));
  renderReplayCardPngMock.mockClear();
  renderReplayMotionGifMock.mockClear();
  vi.unstubAllGlobals();
});

describe("aggregate Share generate gate", () => {
  it("lightweight aggregate replay verifies at L2 (redactAndVerify ok)", () => {
    const redacted = redactReplay(lightweightReplay(), { level: "L2" });
    expect(redacted.verified).toBe(true);
    expect(redacted.payload).not.toBeNull();
  });

  it("Card PNG generate stays enabled even when getMissionPublication hangs", async () => {
    const createObjectURL = vi.fn(() => "blob:replay-card-aggregate");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    render(
      createElement(ReplayShareFlow, {
        replay: lightweightReplay(),
        canPublish: true,
        publisherUid: "user-1",
        onClose: () => {},
        defaultFormat: "image",
      }),
    );

    const generateBtn = await screen.findByTestId("replay-share-generate");
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("replay-share-asset-hint")).toBeTruthy();

    fireEvent.click(generateBtn);

    await waitFor(() =>
      expect(renderReplayCardPngMock).toHaveBeenCalledTimes(1),
    );
    expect(renderReplayCardPngMock.mock.calls[0][0]).toMatchObject({
      level: "L2",
      verified: true,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /다운로드/ })).toBeTruthy(),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: /다운로드/ }) as HTMLButtonElement)
        .textContent ?? "",
    ).toMatch(/\.png|Replay|완료|mission/i);
  });

  it("GIF generate also ignores publication hang", async () => {
    const createObjectURL = vi.fn(() => "blob:replay-gif-aggregate");
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });

    render(
      createElement(ReplayShareFlow, {
        replay: lightweightReplay(),
        canPublish: false,
        onClose: () => {},
        defaultFormat: "gif",
      }),
    );

    const generateBtn = await screen.findByTestId("replay-share-generate");
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(generateBtn);

    await waitFor(() =>
      expect(renderReplayMotionGifMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /다운로드/ })).toBeTruthy(),
    );
  });

  it("link format still waits for publication and explains the block", async () => {
    render(
      createElement(ReplayShareFlow, {
        replay: lightweightReplay(),
        canPublish: true,
        publisherUid: "user-1",
        onClose: () => {},
        defaultFormat: "link",
      }),
    );

    const generateBtn = await screen.findByTestId("replay-share-generate");
    expect((generateBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("replay-share-publication-loading")).toBeTruthy();
    const blocked = screen.getByTestId("replay-share-generate-blocked");
    expect(blocked.textContent ?? "").toMatch(/공개 URL/);
  });
});
