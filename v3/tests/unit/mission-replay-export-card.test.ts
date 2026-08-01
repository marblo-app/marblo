/**
 * Mission Replay share card (`lib/replay/export/card.ts`) — 계약:
 *   - `buildReplayCardModel` 은 `RedactedReplay.payload`(unknown)를 방어적으로
 *     읽는다: 필드가 비어있거나/타입이 다르거나/통째로 dropped 여도 죽지 않고
 *     안전한 기본값으로 떨어진다.
 *   - `wrapLines` 는 maxLines 를 넘지 않고, 넘치면 마지막 줄에 ellipsis 를 남긴다.
 *   - `drawReplayCard` 는 순수 함수다 — 같은 입력엔 같은 draw call 시퀀스.
 *   - `renderReplayCardPng` 는 주입된 fake canvas 로 model→draw→blob 전체
 *     파이프라인을 Node 환경(jsdom/canvas 없이)에서 검증한다.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildReplayCardFileName,
  buildReplayCardModel,
  drawReplayCard,
  REPLAY_CARD_HEIGHT,
  REPLAY_CARD_THEME,
  REPLAY_CARD_WIDTH,
  renderReplayCardPng,
  wrapLines,
  type ReplayCardCanvasLike,
  type ReplayCardDrawContext,
} from "../../src/lib/replay/export/card";
import { redactReplay } from "../../src/lib/replay/redactReplay";
import type {
  MissionReplay,
  RedactedReplay,
} from "../../src/types/missionReplay";

function makeRedacted(
  payload: unknown,
  overrides: Partial<RedactedReplay> = {},
): RedactedReplay {
  return {
    level: "L2",
    payload,
    serialized: JSON.stringify(payload, null, 2),
    removed: [],
    verified: true,
    ...overrides,
  };
}

const FULL_REPLAY: MissionReplay = {
  replayVersion: 1,
  missionId: "mission-1234567890123456",
  projectId: "project-1234567890123456",
  goal: "Ship the replay export card",
  templateId: "feature",
  launchedAt: new Date("2026-08-01T09:00:00Z"),
  completedAt: new Date("2026-08-01T09:42:00Z"),
  stats: {
    tasks: 5,
    tasksDone: 4,
    agents: 2,
    prs: 1,
    filesChanged: 12,
    linesAdded: 200,
    linesDeleted: 40,
    testsPassed: 3,
    riskFlags: 0,
    reportsScanned: 4,
    retries: 1,
    durationMs: 42 * 60_000,
    costTotal: 3.1,
  },
  cast: [
    {
      agentRef: "agent-1 · claude",
      vendor: "claude",
      spawnedModel: "sonnet",
      detectedModelId: null,
      role: "frontend",
      tasksCompleted: 2,
      beats: 6,
    },
    {
      agentRef: "agent-2 · codex",
      vendor: "codex",
      spawnedModel: null,
      detectedModelId: null,
      role: "backend",
      tasksCompleted: 2,
      beats: 4,
    },
  ],
  beats: [],
  prUrls: ["https://github.com/example/public/pull/9"],
  provenance: {
    sources: {
      "mission.contextLog": "ok",
      task: "ok",
      "task.activity": "ok",
      audit_logs: "ok",
      projectAuditLog: "empty",
      merge_history: "ok",
    },
    generatedAt: new Date("2026-08-01T09:42:00Z"),
  },
};

describe("buildReplayCardModel", () => {
  it("reads a real redactReplay() L2 payload end-to-end", () => {
    const redacted = redactReplay(FULL_REPLAY, {
      level: "L2",
      publicRepos: ["https://github.com/example/public/pull/9"],
    });
    expect(redacted.verified).toBe(true);

    const model = buildReplayCardModel(redacted);
    expect(model.goal).toBe(FULL_REPLAY.goal);
    expect(model.templateLabel).toBe("feature");
    expect(model.durationLabel).toBe("42m 0s");
    expect(model.stats).toEqual([
      { label: "tasks", value: "4" },
      { label: "agents", value: "2" },
      { label: "PRs", value: "1" },
      { label: "files", value: "12" },
    ]);
    expect(model.castLabel).toBe("claude · codex");
    expect(model.creditLabel).toBe("Shipped with Marblo");
    expect(model.eyebrow).toBe("MISSION REPLAY · L2");
  });

  it("honors an opted-in credit handle", () => {
    const redacted = makeRedacted({
      goal: "Ship it",
      credits: { mode: "credited", handle: "melocream" },
    });
    expect(buildReplayCardModel(redacted).creditLabel).toBe("@melocream");
  });

  it("keeps an already-prefixed handle as-is", () => {
    const redacted = makeRedacted({
      credits: { mode: "credited", handle: "@melocream" },
    });
    expect(buildReplayCardModel(redacted).creditLabel).toBe("@melocream");
  });

  it("falls back to defaults when the payload is missing entirely", () => {
    const redacted = makeRedacted(null);
    const model = buildReplayCardModel(redacted);
    expect(model.goal).toBe("Mission Replay");
    expect(model.templateLabel).toBeNull();
    expect(model.durationLabel).toBeNull();
    expect(model.stats).toEqual([]);
    expect(model.castLabel).toBeNull();
    expect(model.creditLabel).toBe("Shipped with Marblo");
  });

  it("falls back when the payload is not an object (e.g. an array or scalar)", () => {
    expect(buildReplayCardModel(makeRedacted([1, 2, 3])).goal).toBe(
      "Mission Replay",
    );
    expect(buildReplayCardModel(makeRedacted("just a string")).goal).toBe(
      "Mission Replay",
    );
  });

  it("ignores wrong-typed fields instead of throwing", () => {
    const redacted = makeRedacted({
      goal: 12345,
      templateId: { nested: true },
      stats: "not-an-object",
      cast: "not-an-array",
      credits: "not-an-object",
    });
    const model = buildReplayCardModel(redacted);
    expect(model.goal).toBe("Mission Replay");
    expect(model.templateLabel).toBeNull();
    expect(model.stats).toEqual([]);
    expect(model.castLabel).toBeNull();
    expect(model.creditLabel).toBe("Shipped with Marblo");
  });

  it("skips individual stat fields that were dropped or non-numeric, keeping the rest", () => {
    const redacted = makeRedacted({
      stats: { tasksDone: 3, agents: "redacted", filesChanged: 9 },
    });
    expect(buildReplayCardModel(redacted).stats).toEqual([
      { label: "tasks", value: "3" },
      { label: "files", value: "9" },
    ]);
  });

  it("dedupes cast vendors and drops entries without a usable vendor", () => {
    const redacted = makeRedacted({
      cast: [
        { vendor: "claude" },
        { vendor: "claude" },
        { vendor: "codex" },
        { vendor: 42 },
        {},
      ],
    });
    expect(buildReplayCardModel(redacted).castLabel).toBe("claude · codex");
  });
});

describe("wrapLines", () => {
  const fakeCtx: ReplayCardDrawContext = {
    fillStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    // deterministic width: 10px per character, so wrap math is verifiable by hand
    measureText: (text: string) => ({ width: text.length * 10 }),
  };

  it("returns a single line when the text fits", () => {
    expect(wrapLines(fakeCtx, "short goal", 1000, 3)).toEqual(["short goal"]);
  });

  it("returns [] for empty input", () => {
    expect(wrapLines(fakeCtx, "   ", 1000, 3)).toEqual([]);
  });

  it("wraps across multiple lines within the width budget", () => {
    // each word here is 4 chars ("aaaa") = 40px; maxWidth 90 fits 2 words/line
    const text = "aaaa bbbb cccc dddd";
    expect(wrapLines(fakeCtx, text, 90, 3)).toEqual(["aaaa bbbb", "cccc dddd"]);
  });

  it("truncates with an ellipsis when the text exceeds maxLines", () => {
    const text = "aaaa bbbb cccc dddd eeee ffff";
    const lines = wrapLines(fakeCtx, text, 90, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("never exceeds maxLines even for very long single-word chunks", () => {
    const text = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const lines = wrapLines(fakeCtx, text, 50, 1);
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});

describe("drawReplayCard", () => {
  function makeRecordingCtx() {
    const calls: string[] = [];
    const ctx: ReplayCardDrawContext = {
      fillStyle: "",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      fillRect: vi.fn((x, y, w, h) => calls.push(`rect:${x},${y},${w},${h}`)),
      fillText: vi.fn((text, x, y) => calls.push(`text:${text}@${x},${y}`)),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    return { ctx, calls };
  }

  const model = {
    eyebrow: "MISSION REPLAY · L2",
    goal: "Ship the replay export card",
    templateLabel: "feature",
    durationLabel: "42m 0s",
    stats: [
      { label: "tasks", value: "4" },
      { label: "agents", value: "2" },
    ],
    castLabel: "claude · codex",
    creditLabel: "Shipped with Marblo",
  };

  it("draws the background at full card dimensions first", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayCard(ctx, model);
    expect(calls[0]).toBe(
      `rect:0,0,${REPLAY_CARD_WIDTH},${REPLAY_CARD_HEIGHT}`,
    );
  });

  it("renders every stat value and label", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayCard(ctx, model);
    expect(calls.some((c) => c.includes("text:4@"))).toBe(true);
    expect(calls.some((c) => c.includes("text:TASKS@"))).toBe(true);
    expect(calls.some((c) => c.includes("text:2@"))).toBe(true);
    expect(calls.some((c) => c.includes("text:AGENTS@"))).toBe(true);
  });

  it("renders the credit label and falls back cast label when absent", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayCard(ctx, { ...model, castLabel: null });
    expect(calls.some((c) => c.includes("text:Marblo Mission Replay@"))).toBe(
      true,
    );
    expect(calls.some((c) => c.includes("text:Shipped with Marblo@"))).toBe(
      true,
    );
  });

  it("leaves textAlign reset to left after drawing right/center-aligned text", () => {
    const { ctx } = makeRecordingCtx();
    drawReplayCard(ctx, model);
    expect(ctx.textAlign).toBe("left");
  });

  it("is pure — identical input produces an identical call sequence", () => {
    const first = makeRecordingCtx();
    const second = makeRecordingCtx();
    drawReplayCard(first.ctx, model, REPLAY_CARD_THEME);
    drawReplayCard(second.ctx, model, REPLAY_CARD_THEME);
    expect(first.calls).toEqual(second.calls);
  });
});

describe("renderReplayCardPng", () => {
  function makeFakeCanvas(
    behavior: "toBlob" | "convertToBlob" | "neither" | "null-context",
  ): ReplayCardCanvasLike {
    const drawCtx: ReplayCardDrawContext = {
      fillStyle: "",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    const fakeBlob = { type: "image/png" } as Blob;
    const canvas: ReplayCardCanvasLike = {
      getContext: () => (behavior === "null-context" ? null : drawCtx),
    };
    if (behavior === "toBlob") {
      canvas.toBlob = (cb) => cb(fakeBlob);
    }
    if (behavior === "convertToBlob") {
      canvas.convertToBlob = async () => fakeBlob;
    }
    return canvas;
  }

  it("renders via convertToBlob when available", async () => {
    const canvas = makeFakeCanvas("convertToBlob");
    const blob = await renderReplayCardPng(makeRedacted({ goal: "x" }), {
      createCanvas: () => canvas,
    });
    expect(blob).toBeDefined();
  });

  it("falls back to toBlob when convertToBlob is unavailable", async () => {
    const canvas = makeFakeCanvas("toBlob");
    const blob = await renderReplayCardPng(makeRedacted({ goal: "x" }), {
      createCanvas: () => canvas,
    });
    expect(blob).toBeDefined();
  });

  it("rejects when the canvas has no 2d context", async () => {
    const canvas = makeFakeCanvas("null-context");
    await expect(
      renderReplayCardPng(makeRedacted({ goal: "x" }), {
        createCanvas: () => canvas,
      }),
    ).rejects.toThrow("2D canvas context unavailable");
  });

  it("rejects when the canvas supports neither blob export method", async () => {
    const canvas = makeFakeCanvas("neither");
    await expect(
      renderReplayCardPng(makeRedacted({ goal: "x" }), {
        createCanvas: () => canvas,
      }),
    ).rejects.toThrow("neither toBlob nor convertToBlob");
  });

  it("propagates PNG encoding failure from toBlob(null)", async () => {
    const drawCtx: ReplayCardDrawContext = {
      fillStyle: "",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    const canvas: ReplayCardCanvasLike = {
      getContext: () => drawCtx,
      toBlob: (cb) => cb(null),
    };
    await expect(
      renderReplayCardPng(makeRedacted({ goal: "x" }), {
        createCanvas: () => canvas,
      }),
    ).rejects.toThrow("PNG encoding failed");
  });
});

describe("buildReplayCardFileName", () => {
  it("slugifies the goal", () => {
    const model = buildReplayCardModel(
      makeRedacted({ goal: "Ship the Replay Export Card!" }),
    );
    expect(buildReplayCardFileName(model)).toBe(
      "marblo-replay-ship-the-replay-export-card.png",
    );
  });

  it("falls back to a generic name when the goal has no slug-able characters", () => {
    const model = buildReplayCardModel(makeRedacted({ goal: "★★★" }));
    expect(buildReplayCardFileName(model)).toBe("marblo-replay-mission.png");
  });
});
