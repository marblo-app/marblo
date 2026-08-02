/**
 * Mission Replay motion export (`lib/replay/export/gif.ts`) — 계약:
 *   - `buildReplayMotionBeats` reads `RedactedReplay.payload.beats[]`
 *     defensively (same posture as `card.ts`'s payload readers), capped.
 *   - `planReplayMotionFrames` is a pure timing plan: headline → stats →
 *     timeline segments in order, 5-10s total, beat cycling inside the
 *     timeline segment.
 *   - `drawReplayMotionFrame` is a pure function of (ctx, model, beats, frame,
 *     theme) — segment-conditional draw calls, same call sequence for the
 *     same input.
 *   - `renderReplayMotionGif` pipes canvas pixel readback through injected
 *     `gifenc`-shaped calls (Node-testable, no real DOM/canvas package).
 *   - `renderReplayMotionWebm` pipes canvas frames through an injected muxer
 *     shaped like `mediabunny`'s `Output`/`CanvasSource` (Node-testable,
 *     no real WebCodecs).
 *   - `isReplayMotionWebmSupported` is a `VideoEncoder`-presence check with
 *     no fallback encoder.
 *
 * ★This file pins the **`"stats"` template** — the original #741 cut. The
 * default is now the narrative storyboard, so the two encoder tests below pass
 * `template: "stats"` explicitly (the storyboard's timing knob is
 * `durationScale`, not the per-segment seconds this file exercises). The
 * storyboard cut and the routing between them live in
 * `mission-replay-export-storyboard.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildReplayMotionBeats,
  buildReplayMotionFileName,
  drawReplayMotionFrame,
  isReplayMotionWebmSupported,
  planReplayMotionFrames,
  REPLAY_MOTION_DEFAULT_DURATION_SECONDS,
  REPLAY_MOTION_HEIGHT,
  REPLAY_MOTION_MAX_BEATS,
  REPLAY_MOTION_WIDTH,
  renderReplayMotionGif,
  renderReplayMotionWebm,
  type ReplayMotionCanvasLike,
  type ReplayMotionMuxerLike,
} from "../../src/lib/replay/export/gif";
import {
  buildReplayCardModel,
  type ReplayCardDrawContext,
} from "../../src/lib/replay/export/card";
import type { RedactedReplay } from "../../src/types/missionReplay";

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

describe("buildReplayMotionBeats", () => {
  it("reads titled beats in order", () => {
    const redacted = makeRedacted({
      beats: [
        { title: "Task claimed", lane: "agent" },
        { title: "PR opened", lane: "human" },
      ],
    });
    expect(buildReplayMotionBeats(redacted)).toEqual([
      { title: "Task claimed", lane: "agent" },
      { title: "PR opened", lane: "human" },
    ]);
  });

  it("skips beats without a usable title", () => {
    const redacted = makeRedacted({
      beats: [{ lane: "agent" }, { title: "" }, { title: 42 }, { title: "ok" }],
    });
    expect(buildReplayMotionBeats(redacted)).toEqual([
      { title: "ok", lane: null },
    ]);
  });

  it("falls back to [] when payload/beats is missing or malformed", () => {
    expect(buildReplayMotionBeats(makeRedacted(null))).toEqual([]);
    expect(buildReplayMotionBeats(makeRedacted({}))).toEqual([]);
    expect(buildReplayMotionBeats(makeRedacted({ beats: "nope" }))).toEqual([]);
  });

  it("caps at REPLAY_MOTION_MAX_BEATS by default", () => {
    const beats = Array.from({ length: 20 }, (_, i) => ({
      title: `beat-${i}`,
    }));
    const result = buildReplayMotionBeats(makeRedacted({ beats }));
    expect(result).toHaveLength(REPLAY_MOTION_MAX_BEATS);
    expect(result[0]).toEqual({ title: "beat-0", lane: null });
  });

  it("honors a custom max", () => {
    const beats = Array.from({ length: 5 }, (_, i) => ({ title: `b${i}` }));
    expect(buildReplayMotionBeats(makeRedacted({ beats }), 2)).toHaveLength(2);
    expect(buildReplayMotionBeats(makeRedacted({ beats }), 0)).toEqual([]);
  });
});

describe("planReplayMotionFrames", () => {
  it("defaults to a 5-10s plan", () => {
    expect(REPLAY_MOTION_DEFAULT_DURATION_SECONDS).toBeGreaterThanOrEqual(5);
    expect(REPLAY_MOTION_DEFAULT_DURATION_SECONDS).toBeLessThanOrEqual(10);
  });

  it("produces fps * total-seconds frames for the default timing", () => {
    const frames = planReplayMotionFrames(3);
    expect(frames).toHaveLength(
      Math.round(REPLAY_MOTION_DEFAULT_DURATION_SECONDS * 10),
    );
    expect(frames[0]).toMatchObject({
      index: 0,
      tSeconds: 0,
      segment: "headline",
    });
  });

  it("orders segments headline -> stats -> timeline", () => {
    const frames = planReplayMotionFrames(2, {
      fps: 10,
      headlineSeconds: 1,
      statsSeconds: 1,
      timelineSeconds: 1,
    });
    const segments = frames.map((f) => f.segment);
    const firstStats = segments.indexOf("stats");
    const firstTimeline = segments.indexOf("timeline");
    expect(segments[0]).toBe("headline");
    expect(firstStats).toBeGreaterThan(0);
    expect(firstTimeline).toBeGreaterThan(firstStats);
    // once a later segment starts, it never reverts to an earlier one
    for (let i = 1; i < segments.length; i += 1) {
      const order = { headline: 0, stats: 1, timeline: 2 };
      expect(order[segments[i]]).toBeGreaterThanOrEqual(order[segments[i - 1]]);
    }
  });

  it("cycles beatIndex evenly across the timeline segment", () => {
    const frames = planReplayMotionFrames(3, {
      fps: 10,
      headlineSeconds: 0,
      statsSeconds: 0,
      timelineSeconds: 3,
    });
    const beatIndices = frames.map((f) => f.beatIndex);
    expect(beatIndices[0]).toBe(0);
    // each beat gets 1s = 10 frames; frame 15 (t=1.5s) should be beat 1
    expect(
      frames.find((f) => Math.abs(f.tSeconds - 1.5) < 1e-9)?.beatIndex,
    ).toBe(1);
    expect(beatIndices[beatIndices.length - 1]).toBe(2);
    expect(
      Math.max(...beatIndices.filter((b): b is number => b !== null)),
    ).toBe(2);
  });

  it("leaves beatIndex null throughout the timeline segment when there are no beats", () => {
    const frames = planReplayMotionFrames(0, {
      fps: 10,
      headlineSeconds: 0.5,
      statsSeconds: 0.5,
      timelineSeconds: 0.5,
    });
    const timelineFrames = frames.filter((f) => f.segment === "timeline");
    expect(timelineFrames.length).toBeGreaterThan(0);
    expect(timelineFrames.every((f) => f.beatIndex === null)).toBe(true);
  });

  it("never returns an empty plan even for a degenerate (near-zero) duration", () => {
    const frames = planReplayMotionFrames(0, {
      fps: 1,
      headlineSeconds: 0,
      statsSeconds: 0,
      timelineSeconds: 0,
    });
    expect(frames.length).toBeGreaterThanOrEqual(1);
  });
});

describe("drawReplayMotionFrame", () => {
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

  const model = buildReplayCardModel(
    makeRedacted({
      goal: "Ship the replay motion export",
      templateId: "feature",
      durationMs: 90_000,
      stats: { tasksDone: 4, agents: 2 },
      cast: [{ vendor: "claude" }],
    }),
  );
  const beats = [
    { title: "Task claimed by agent-1", lane: "agent" },
    { title: "PR opened", lane: "human" },
  ];

  it("draws the background first, at full motion dimensions", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayMotionFrame(ctx, model, beats, {
      index: 0,
      tSeconds: 0,
      segment: "headline",
      beatIndex: null,
    });
    expect(calls[0]).toBe(
      `rect:0,0,${REPLAY_MOTION_WIDTH},${REPLAY_MOTION_HEIGHT}`,
    );
  });

  it("draws the goal headline only during the headline segment", () => {
    const headline = makeRecordingCtx();
    drawReplayMotionFrame(headline.ctx, model, beats, {
      index: 0,
      tSeconds: 0,
      segment: "headline",
      beatIndex: null,
    });
    expect(headline.calls.some((c) => c.startsWith("text:Ship the"))).toBe(
      true,
    );

    const stats = makeRecordingCtx();
    drawReplayMotionFrame(stats.ctx, model, beats, {
      index: 0,
      tSeconds: 3,
      segment: "stats",
      beatIndex: null,
    });
    expect(stats.calls.some((c) => c.startsWith("text:Ship the"))).toBe(false);
  });

  it("draws stat values only during the stats segment", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayMotionFrame(ctx, model, beats, {
      index: 0,
      tSeconds: 3,
      segment: "stats",
      beatIndex: null,
    });
    expect(calls.some((c) => c.includes("text:4@"))).toBe(true);
    expect(calls.some((c) => c.includes("text:TASKS@"))).toBe(true);
  });

  it("draws the current beat's title during the timeline segment", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayMotionFrame(ctx, model, beats, {
      index: 0,
      tSeconds: 6,
      segment: "timeline",
      beatIndex: 1,
    });
    expect(calls.some((c) => c.includes("text:PR opened@"))).toBe(true);
    expect(calls.some((c) => c.includes("text:Task claimed"))).toBe(false);
  });

  it("falls back to a static credit line during the timeline segment when there are no beats", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayMotionFrame(ctx, model, [], {
      index: 0,
      tSeconds: 6,
      segment: "timeline",
      beatIndex: null,
    });
    expect(calls.some((c) => c.includes("text:Mission Replay@"))).toBe(true);
  });

  it("always draws the credit footer regardless of segment", () => {
    for (const segment of ["headline", "stats", "timeline"] as const) {
      const { ctx, calls } = makeRecordingCtx();
      drawReplayMotionFrame(ctx, model, beats, {
        index: 0,
        tSeconds: 0,
        segment,
        beatIndex: segment === "timeline" ? 0 : null,
      });
      expect(calls.some((c) => c.includes("text:Shipped with Marblo@"))).toBe(
        true,
      );
    }
  });

  it("is pure — identical input produces an identical call sequence", () => {
    const frame = {
      index: 5,
      tSeconds: 5,
      segment: "timeline" as const,
      beatIndex: 0,
    };
    const first = makeRecordingCtx();
    const second = makeRecordingCtx();
    drawReplayMotionFrame(first.ctx, model, beats, frame);
    drawReplayMotionFrame(second.ctx, model, beats, frame);
    expect(first.calls).toEqual(second.calls);
  });

  it("leaves textAlign reset to left after drawing", () => {
    const { ctx } = makeRecordingCtx();
    drawReplayMotionFrame(ctx, model, beats, {
      index: 0,
      tSeconds: 3,
      segment: "stats",
      beatIndex: null,
    });
    expect(ctx.textAlign).toBe("left");
  });
});

describe("renderReplayMotionGif", () => {
  function makeFakeMotionCanvas(): ReplayMotionCanvasLike {
    const pixelCount = REPLAY_MOTION_WIDTH * REPLAY_MOTION_HEIGHT;
    const data = new Uint8ClampedArray(pixelCount * 4);
    const drawCtx = {
      fillStyle: "",
      font: "",
      textAlign: "left" as const,
      textBaseline: "alphabetic" as const,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
      getImageData: vi.fn(() => ({ data })),
    };
    return { getContext: () => drawCtx };
  }

  const FAST_TIMING = {
    fps: 2,
    headlineSeconds: 0.5,
    statsSeconds: 0.5,
    timelineSeconds: 0.5,
  };

  it("produces a GIF blob with one encoded frame per planned frame", async () => {
    const canvas = makeFakeMotionCanvas();
    const redacted = makeRedacted({ goal: "Ship it", beats: [] });
    const expectedFrameCount = planReplayMotionFrames(0, FAST_TIMING).length;

    const blob = await renderReplayMotionGif(redacted, {
      template: "stats",
      createCanvas: () => canvas,
      timing: FAST_TIMING,
    });

    expect(blob.type).toBe("image/gif");
    expect(blob.size).toBeGreaterThan(0);
    const ctx = canvas.getContext("2d");
    expect(ctx?.getImageData).toHaveBeenCalledTimes(expectedFrameCount);
  }, 20_000);

  it("throws when the canvas has no 2D context", async () => {
    const canvas: ReplayMotionCanvasLike = { getContext: () => null };
    await expect(
      renderReplayMotionGif(makeRedacted({ goal: "x" }), {
        createCanvas: () => canvas,
        timing: FAST_TIMING,
      }),
    ).rejects.toThrow(/2D canvas context unavailable/);
  });
});

describe("renderReplayMotionWebm", () => {
  function makeFakeMuxer(buffer: ArrayBuffer | null) {
    const add = vi.fn(async () => {});
    const close = vi.fn();
    const start = vi.fn(async () => {});
    const finalize = vi.fn(async () => {});
    const muxer: ReplayMotionMuxerLike = {
      output: { start, finalize, target: { buffer } },
      videoSource: { add, close },
    };
    return { muxer, add, close, start, finalize };
  }

  const FAST_TIMING = {
    fps: 2,
    headlineSeconds: 0.5,
    statsSeconds: 0.5,
    timelineSeconds: 0.5,
  };

  it("draws + adds exactly one video sample per planned frame, then finalizes", async () => {
    const fakeBuffer = new ArrayBuffer(16);
    const { muxer, add, close, start, finalize } = makeFakeMuxer(fakeBuffer);
    const drawCtx = {
      fillStyle: "",
      font: "",
      textAlign: "left" as const,
      textBaseline: "alphabetic" as const,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    const fakeCanvas = {
      getContext: () => drawCtx,
    } as unknown as HTMLCanvasElement;

    const expectedFrameCount = planReplayMotionFrames(0, FAST_TIMING).length;

    const blob = await renderReplayMotionWebm(
      makeRedacted({ goal: "x", beats: [] }),
      {
        template: "stats",
        timing: FAST_TIMING,
        createCanvas: () => fakeCanvas,
        createMuxer: () => muxer,
      },
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(expectedFrameCount);
    expect(close).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBe(fakeBuffer.byteLength);
  });

  it("throws when the muxer finalizes without producing a buffer", async () => {
    const { muxer } = makeFakeMuxer(null);
    const drawCtx = {
      fillStyle: "",
      font: "",
      textAlign: "left" as const,
      textBaseline: "alphabetic" as const,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
    };
    const fakeCanvas = {
      getContext: () => drawCtx,
    } as unknown as HTMLCanvasElement;

    await expect(
      renderReplayMotionWebm(makeRedacted({ goal: "x" }), {
        timing: FAST_TIMING,
        createCanvas: () => fakeCanvas,
        createMuxer: () => muxer,
      }),
    ).rejects.toThrow(/produced no output/);
  });

  it("throws when the canvas has no 2D context", async () => {
    const fakeCanvas = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    await expect(
      renderReplayMotionWebm(makeRedacted({ goal: "x" }), {
        createCanvas: () => fakeCanvas,
        createMuxer: () => makeFakeMuxer(new ArrayBuffer(4)).muxer,
      }),
    ).rejects.toThrow(/2D canvas context unavailable/);
  });
});

describe("isReplayMotionWebmSupported", () => {
  it("is false in this Node test environment (no WebCodecs VideoEncoder)", () => {
    expect(isReplayMotionWebmSupported()).toBe(false);
  });
});

describe("buildReplayMotionFileName", () => {
  it("slugifies the goal and appends the requested extension", () => {
    const model = buildReplayCardModel(
      makeRedacted({ goal: "Ship The Replay Export!" }),
    );
    expect(buildReplayMotionFileName(model, "gif")).toBe(
      "marblo-replay-ship-the-replay-export.gif",
    );
    expect(buildReplayMotionFileName(model, "webm")).toBe(
      "marblo-replay-ship-the-replay-export.webm",
    );
  });

  it("falls back to 'mission' when the goal has no slugifiable characters", () => {
    const model = buildReplayCardModel(makeRedacted({ goal: "!!!" }));
    expect(buildReplayMotionFileName(model, "gif")).toBe(
      "marblo-replay-mission.gif",
    );
  });
});
