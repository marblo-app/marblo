/**
 * Mission Replay **narrative storyboard** (`lib/replay/export/gifStoryboard.ts`)
 * — 계약:
 *   - `buildReplayStoryboard` reads only the non-identifying slice of
 *     `RedactedReplay.payload` (goal/stats counts/cast chips/beat titles+lanes)
 *     and **never** `detail`, `taskId`, `actorRef`, `prUrl`, or any other free
 *     text. This is the 비식별 경계 and it has its own describe block below.
 *   - The scene sequence is the product story: 미션 → 오케스트레이션 →
 *     병렬 진행 → ship → 완료 도장. Order is part of the contract; the
 *     per-template durations are not.
 *   - `planReplayStoryboardFrames` is pure timing: monotonic scenes, in-scene
 *     progress, and which beat/cast member is under the playhead.
 *   - `drawReplayStoryboardFrame` is a pure function of
 *     (ctx, storyboard, frame, theme) with the Marblo mark on every frame.
 *   - `gif.ts` routes templates: "story"/"cast" here, "stats" to the #741
 *     drawer — same input, same encoder, different cut.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildReplayStoryboard,
  buildReplayStoryBeats,
  buildReplayStoryCast,
  drawReplayStoryboardFrame,
  formatCastChip,
  isReplayStoryTemplate,
  planReplayStoryboardFrames,
  REPLAY_EXPORT_DEFAULT_TEMPLATE,
  REPLAY_EXPORT_TEMPLATES,
  REPLAY_STORY_HEIGHT,
  REPLAY_STORY_MARK,
  REPLAY_STORY_MAX_CAST,
  REPLAY_STORY_THEME,
  REPLAY_STORY_WIDTH,
  replayStoryboardDurationSeconds,
  type ReplayStoryFrame,
  type ReplayStorySceneKind,
} from "../../src/lib/replay/export/gifStoryboard";
import {
  buildReplayMotionRenderPlan,
  renderReplayMotionGif,
  type ReplayMotionCanvasLike,
} from "../../src/lib/replay/export/gif";
import { REPLAY_CARD_THEME } from "../../src/lib/replay/export/card";
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

/** A realistic redacted payload: three agents on two models, a merge, beats. */
const FULL_PAYLOAD = {
  goal: "Ship the mission replay storyboard",
  templateId: "feature",
  durationMs: 5_400_000,
  stats: {
    tasks: 6,
    tasksDone: 6,
    agents: 3,
    prs: 1,
    filesChanged: 9,
    linesAdded: 412,
    linesDeleted: 87,
  },
  cast: [
    {
      agentRef: "agent-1 · claude",
      vendor: "claude",
      spawnedModel: "opus-5",
      detectedModelId: "claude-opus-5",
      role: "frontend",
      tasksCompleted: 3,
    },
    {
      agentRef: "agent-2 · gpt",
      vendor: "gpt",
      spawnedModel: null,
      detectedModelId: "gpt-5.6",
      role: "backend",
      tasksCompleted: 2,
    },
    {
      agentRef: "agent-3 · claude",
      vendor: "claude",
      spawnedModel: "opus-5",
      detectedModelId: null,
      role: "review",
      tasksCompleted: 1,
    },
  ],
  beats: [
    { title: "Mission launched", lane: "orchestrator" },
    { title: "Task claimed by agent-1", lane: "agent" },
    { title: "Task claimed by agent-2", lane: "agent" },
    { title: "PR opened", lane: "agent" },
    { title: "Merged to main", lane: "human" },
  ],
  credits: { mode: "anonymous" },
};

function makeRecordingCtx() {
  const calls: string[] = [];
  const texts: string[] = [];
  const ctx = {
    fillStyle: "",
    font: "",
    textAlign: "left" as "left" | "right" | "center",
    textBaseline: "alphabetic" as const,
    fillRect: vi.fn((x: number, y: number, w: number, h: number) =>
      calls.push(`rect:${x},${y},${w},${h}`),
    ),
    fillText: vi.fn((text: string, x: number, y: number) => {
      calls.push(`text:${text}@${x},${y}`);
      texts.push(text);
    }),
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  return { ctx, calls, texts };
}

/** Every string this frame would paint onto the canvas. */
function drawnTexts(
  storyboard: ReturnType<typeof buildReplayStoryboard>,
  frame: ReplayStoryFrame,
): string[] {
  const { ctx, texts } = makeRecordingCtx();
  drawReplayStoryboardFrame(ctx, storyboard, frame);
  return texts;
}

/** Every string painted across the whole storyboard, at real fps. */
function allDrawnTexts(
  storyboard: ReturnType<typeof buildReplayStoryboard>,
): string[] {
  const texts: string[] = [];
  for (const frame of planReplayStoryboardFrames(storyboard)) {
    texts.push(...drawnTexts(storyboard, frame));
  }
  return texts;
}

// ---------------------------------------------------------------------------

describe("REPLAY_EXPORT_TEMPLATES", () => {
  it("offers the three scenario cuts the panel needs", () => {
    expect(REPLAY_EXPORT_TEMPLATES.map((t) => t.id)).toEqual([
      "story",
      "cast",
      "stats",
    ]);
  });

  it("defaults to the narrative cut, not the legacy stat card", () => {
    expect(REPLAY_EXPORT_DEFAULT_TEMPLATE).toBe("story");
  });

  it("classifies only the storyboard-drawn templates as story templates", () => {
    expect(isReplayStoryTemplate("story")).toBe(true);
    expect(isReplayStoryTemplate("cast")).toBe(true);
    expect(isReplayStoryTemplate("stats")).toBe(false);
  });
});

describe("buildReplayStoryboard — narrative scene sequence", () => {
  it("runs mission -> orchestrate -> in-flight -> ship -> stamp", () => {
    const storyboard = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));
    expect(storyboard.scenes.map((s) => s.kind)).toEqual([
      "headline",
      "cast",
      "progress",
      "ship",
      "stamp",
    ]);
  });

  it("numbers the chapters so a still frame reads as part of a sequence", () => {
    const storyboard = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));
    expect(storyboard.scenes.map((s) => s.chapter)).toEqual([
      "01 · MISSION",
      "02 · ORCHESTRATE",
      "03 · IN FLIGHT",
      "04 · SHIP",
      "05 · REPLAY",
    ]);
  });

  it("gives the cast montage the same scenes but weights the cast beat", () => {
    const story = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD), "story");
    const cast = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD), "cast");

    expect(cast.scenes.map((s) => s.kind)).toEqual(
      story.scenes.map((s) => s.kind),
    );
    const castSeconds = (b: typeof story) =>
      b.scenes.find((s) => s.kind === "cast")!.seconds;
    expect(castSeconds(cast)).toBeGreaterThan(castSeconds(story));
    // ...and the montage spends a *larger share* of its runtime on the cast.
    const share = (b: typeof story) =>
      castSeconds(b) / replayStoryboardDurationSeconds(b);
    expect(share(cast)).toBeGreaterThan(share(story));
  });

  it("keeps both templates inside a shareable runtime", () => {
    for (const template of ["story", "cast"] as const) {
      const seconds = replayStoryboardDurationSeconds(
        buildReplayStoryboard(makeRedacted(FULL_PAYLOAD), template),
      );
      expect(seconds).toBeGreaterThanOrEqual(6);
      expect(seconds).toBeLessThanOrEqual(12);
    }
  });
});

describe("buildReplayStoryboard — hero stat", () => {
  it("builds the 'N agents · M models · shipped in X' line", () => {
    const storyboard = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));
    expect(storyboard.hero.agents).toBe(3);
    // opus-5 (pinned twice) + gpt-5.6 (observed) = 2 distinct models
    expect(storyboard.hero.models).toBe(2);
    expect(storyboard.hero.line).toBe(
      "3 AGENTS · 2 MODELS · SHIPPED IN 1H 30M",
    );
  });

  it("singularizes a one-agent, one-model mission", () => {
    const storyboard = buildReplayStoryboard(
      makeRedacted({
        goal: "Solo run",
        durationMs: 60_000,
        stats: { agents: 1 },
        cast: [
          { agentRef: "agent-1", vendor: "claude", spawnedModel: "opus-5" },
        ],
      }),
    );
    expect(storyboard.hero.line).toBe("1 AGENT · 1 MODEL · SHIPPED IN 1M 0S");
  });

  it("falls back to the cast size when stats.agents was dropped", () => {
    const storyboard = buildReplayStoryboard(
      makeRedacted({
        goal: "x",
        cast: [
          { agentRef: "agent-1", vendor: "claude" },
          { agentRef: "agent-2", vendor: "gpt" },
        ],
      }),
    );
    expect(storyboard.hero.agents).toBe(2);
    // no pinned/detected model ids survived — distinct vendors stand in
    expect(storyboard.hero.models).toBe(2);
  });

  it("degrades to a brand line rather than an empty string", () => {
    const storyboard = buildReplayStoryboard(makeRedacted({}));
    expect(storyboard.hero.line).toBe("ORCHESTRATED WITH MARBLO");
  });
});

describe("buildReplayStoryCast", () => {
  it("keeps only the anonymous ref plus vendor/model chips", () => {
    const cast = buildReplayStoryCast(makeRedacted(FULL_PAYLOAD));
    expect(cast[0]).toEqual({
      ref: "agent-1",
      vendor: "claude",
      model: "opus-5",
      role: "frontend",
      tasksCompleted: 3,
    });
  });

  it("prefers the pinned spawnedModel, falling back to what was observed", () => {
    const cast = buildReplayStoryCast(makeRedacted(FULL_PAYLOAD));
    expect(cast[1].model).toBe("gpt-5.6");
    expect(cast[2].model).toBe("opus-5");
  });

  it("caps the roster so the montage stays readable", () => {
    const cast = buildReplayStoryCast(
      makeRedacted({
        cast: Array.from({ length: 12 }, (_, i) => ({
          agentRef: `agent-${i}`,
          vendor: "claude",
        })),
      }),
    );
    expect(cast).toHaveLength(REPLAY_STORY_MAX_CAST);
  });

  it("survives a payload where cast was masked away entirely", () => {
    expect(buildReplayStoryCast(makeRedacted(null))).toEqual([]);
    expect(buildReplayStoryCast(makeRedacted({ cast: "redacted" }))).toEqual(
      [],
    );
    expect(buildReplayStoryCast(makeRedacted({ cast: [null, 42] }))).toEqual(
      [],
    );
  });

  it("labels an unpinned model instead of printing an empty chip", () => {
    expect(
      formatCastChip({
        ref: "agent-1",
        vendor: null,
        model: null,
        role: null,
        tasksCompleted: null,
      }),
    ).toBe("model unpinned");
  });
});

describe("buildReplayStoryboard — ship metrics", () => {
  it("exposes the diff only as counts", () => {
    const { ship } = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));
    expect(ship.metrics).toEqual([
      { label: "PRs", value: "1" },
      { label: "files", value: "9" },
      { label: "lines +", value: "+412" },
      { label: "lines −", value: "−87" },
    ]);
    expect(ship.progressLabel).toBe("6 / 6 tasks done");
  });

  it("drops metrics the payload can't attest to instead of printing zeros", () => {
    const { ship } = buildReplayStoryboard(
      makeRedacted({ goal: "x", stats: { filesChanged: 4 } }),
    );
    expect(ship.metrics).toEqual([{ label: "files", value: "4" }]);
    expect(ship.progressLabel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ★비식별 경계 — the reason this module exists as one file.
// ---------------------------------------------------------------------------

describe("★비식별 경계", () => {
  /** Every string below is something that must never reach a shared GIF. */
  const LEAKY_PAYLOAD = {
    goal: "Fix the auth bug",
    durationMs: 60_000,
    stats: { agents: 1, filesChanged: 2, linesAdded: 10, linesDeleted: 1 },
    cast: [
      {
        agentRef: "agent-1 · claude",
        vendor: "claude",
        spawnedModel: "opus-5",
        tasksCompleted: 1,
      },
    ],
    beats: [
      {
        title: "Task claimed",
        lane: "agent",
        detail: "const API_KEY = 'sk-live-DO-NOT-SHIP';",
        taskId: "task-abc123",
        actorRef: "member-7",
        kind: "task.status_changed",
        source: "task.activity",
        ts: "2026-08-02T00:00:00.000Z",
        id: "beat-deadbeef",
      },
    ],
    prUrl: ["https://github.com/acme/private-repo/pull/12"],
    diff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n+const API_KEY = 'sk-live';",
  };

  const FORBIDDEN = [
    "sk-live",
    "API_KEY",
    "task-abc123",
    "member-7",
    "beat-deadbeef",
    "task.status_changed",
    "task.activity",
    "github.com",
    "private-repo",
    "--- a/src/auth.ts",
    "2026-08-02",
  ];

  it("never lifts a diff, code excerpt, or raw identifier into the storyboard", () => {
    const storyboard = buildReplayStoryboard(makeRedacted(LEAKY_PAYLOAD));
    const serialized = JSON.stringify(storyboard);
    for (const needle of FORBIDDEN) {
      expect(serialized).not.toContain(needle);
    }
  });

  it("never paints one onto a frame either — checked across every frame of both templates", () => {
    for (const template of ["story", "cast"] as const) {
      const painted = allDrawnTexts(
        buildReplayStoryboard(makeRedacted(LEAKY_PAYLOAD), template),
      ).join(" ");
      for (const needle of FORBIDDEN) {
        expect(painted).not.toContain(needle);
      }
    }
  });

  it("reads only title+lane off a beat", () => {
    expect(buildReplayStoryBeats(makeRedacted(LEAKY_PAYLOAD))[0]).toEqual({
      title: "Task claimed",
      lane: "agent",
    });
  });

  it("still shows the diff *size* — that is the whole non-identifying trade", () => {
    const painted = allDrawnTexts(
      buildReplayStoryboard(makeRedacted(LEAKY_PAYLOAD)),
    );
    expect(painted).toContain("+10");
    expect(painted).toContain("−1");
    expect(painted).toContain("2");
  });
});

// ---------------------------------------------------------------------------

describe("planReplayStoryboardFrames", () => {
  const storyboard = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));

  it("produces fps * duration frames", () => {
    const frames = planReplayStoryboardFrames(storyboard, { fps: 10 });
    expect(frames).toHaveLength(
      Math.round(replayStoryboardDurationSeconds(storyboard) * 10),
    );
  });

  it("never runs a scene backwards", () => {
    const order: Record<ReplayStorySceneKind, number> = {
      headline: 0,
      cast: 1,
      progress: 2,
      ship: 3,
      stamp: 4,
    };
    const frames = planReplayStoryboardFrames(storyboard);
    for (let i = 1; i < frames.length; i += 1) {
      expect(order[frames[i].scene]).toBeGreaterThanOrEqual(
        order[frames[i - 1].scene],
      );
      expect(frames[i].overallProgress).toBeGreaterThanOrEqual(
        frames[i - 1].overallProgress,
      );
    }
    expect(frames.every((f) => f.progress >= 0 && f.progress <= 1)).toBe(true);
  });

  it("visits every scene", () => {
    const seen = new Set(
      planReplayStoryboardFrames(storyboard).map((f) => f.scene),
    );
    expect([...seen].sort()).toEqual(
      ["cast", "headline", "progress", "ship", "stamp"].sort(),
    );
  });

  it("cycles every beat across the in-flight scene, and only there", () => {
    const frames = planReplayStoryboardFrames(storyboard);
    const inFlight = frames.filter((f) => f.scene === "progress");
    expect(new Set(inFlight.map((f) => f.beatIndex))).toEqual(
      new Set([0, 1, 2, 3, 4]),
    );
    expect(
      frames
        .filter((f) => f.scene !== "progress")
        .every((f) => f.beatIndex === null),
    ).toBe(true);
  });

  it("spotlights every cast member across the cast scene, and only there", () => {
    const frames = planReplayStoryboardFrames(storyboard);
    const castFrames = frames.filter((f) => f.scene === "cast");
    expect(new Set(castFrames.map((f) => f.castIndex))).toEqual(
      new Set([0, 1, 2]),
    );
    expect(
      frames
        .filter((f) => f.scene !== "cast")
        .every((f) => f.castIndex === null),
    ).toBe(true);
  });

  it("leaves beat/cast indices null when redaction left nothing to cycle", () => {
    const bare = buildReplayStoryboard(makeRedacted({ goal: "x" }));
    const frames = planReplayStoryboardFrames(bare);
    expect(frames.every((f) => f.beatIndex === null)).toBe(true);
    expect(frames.every((f) => f.castIndex === null)).toBe(true);
  });

  it("shrinks proportionally under durationScale but keeps the sequence", () => {
    const frames = planReplayStoryboardFrames(storyboard, {
      fps: 10,
      durationScale: 0.1,
    });
    expect(frames).toHaveLength(
      Math.round(replayStoryboardDurationSeconds(storyboard, 0.1) * 10),
    );
    expect(frames[0].scene).toBe("headline");
    expect(frames[frames.length - 1].scene).toBe("stamp");
  });

  it("never returns an empty plan, even at a degenerate scale", () => {
    expect(
      planReplayStoryboardFrames(storyboard, { fps: 1, durationScale: 0 })
        .length,
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("drawReplayStoryboardFrame", () => {
  const storyboard = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD));
  const frames = planReplayStoryboardFrames(storyboard);
  const frameOf = (scene: ReplayStorySceneKind, at = 0.5): ReplayStoryFrame => {
    const scoped = frames.filter((f) => f.scene === scene);
    return scoped[Math.floor(scoped.length * at)] ?? scoped[scoped.length - 1];
  };

  it("paints the background first, at full storyboard dimensions", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayStoryboardFrame(ctx, storyboard, frameOf("headline"));
    expect(calls[0]).toBe(
      `rect:0,0,${REPLAY_STORY_WIDTH},${REPLAY_STORY_HEIGHT}`,
    );
  });

  it("carries the Marblo mark on every single frame", () => {
    for (const frame of frames) {
      expect(drawnTexts(storyboard, frame)).toContain(REPLAY_STORY_MARK);
    }
  });

  it("carries the credit line on every single frame", () => {
    for (const frame of frames) {
      expect(drawnTexts(storyboard, frame)).toContain(
        storyboard.model.creditLabel,
      );
    }
  });

  it("shows the goal and the hero stat in the mission scene", () => {
    const texts = drawnTexts(storyboard, frameOf("headline", 0.9));
    expect(texts.some((t) => t.startsWith("Ship the mission"))).toBe(true);
    expect(texts).toContain(storyboard.hero.line);
  });

  it("shows the cast with vendor/model chips in the orchestrate scene", () => {
    const texts = drawnTexts(storyboard, frameOf("cast", 0.95));
    expect(texts).toContain("agent-1");
    expect(texts).toContain("claude · opus-5");
    expect(texts).toContain("gpt · gpt-5.6");
    expect(texts).toContain("ORCHESTRATED BY");
  });

  it("builds the roster up over the cast scene in the story cut", () => {
    const castFrames = frames.filter((f) => f.scene === "cast");
    const first = drawnTexts(storyboard, castFrames[0]);
    const last = drawnTexts(storyboard, castFrames[castFrames.length - 1]);
    expect(last.filter((t) => t.startsWith("agent-")).length).toBeGreaterThan(
      first.filter((t) => t.startsWith("agent-")).length,
    );
  });

  it("spotlights exactly one agent at a time in the montage cut", () => {
    const montage = buildReplayStoryboard(makeRedacted(FULL_PAYLOAD), "cast");
    const montageFrames = planReplayStoryboardFrames(montage).filter(
      (f) => f.scene === "cast",
    );
    // the spotlight backing plate is drawn once per frame, and it moves
    const plates = montageFrames.map((frame) => {
      const { ctx, calls } = makeRecordingCtx();
      drawReplayStoryboardFrame(ctx, montage, frame);
      return calls.filter((c) => c.startsWith("rect:48,"));
    });
    expect(plates.every((p) => p.length === 1)).toBe(true);
    expect(new Set(plates.map((p) => p[0])).size).toBe(montage.cast.length);
  });

  // 3 agents -> 3 labelled rail tracks, at x = PADDING + 140 = 204
  const RAIL_YS = [244, 272, 300];

  it("draws one labelled parallel rail per agent in the in-flight scene", () => {
    const frame = frameOf("progress", 0.6);
    const { ctx, calls } = makeRecordingCtx();
    drawReplayStoryboardFrame(ctx, storyboard, frame);
    for (const y of RAIL_YS) {
      expect(calls.some((c) => c.startsWith(`rect:204,${y},`))).toBe(true);
    }
    // the bars are named agents, not anonymous progress
    const texts = drawnTexts(storyboard, frame);
    expect(texts).toContain("agent-1");
    expect(texts).toContain("agent-2");
    expect(texts).toContain("agent-3");
  });

  it("advances several rails at once — that simultaneity is the claim", () => {
    const { ctx, calls } = makeRecordingCtx();
    drawReplayStoryboardFrame(ctx, storyboard, frameOf("progress", 0.6));
    const fills = RAIL_YS.map((y) => {
      const rects = calls
        .filter((c) => c.startsWith(`rect:204,${y},`))
        .map((c) => Number(c.split(",")[2]));
      // [track width, fill width] — the fill is the second, narrower rect
      return rects.length > 1 ? rects[1] : 0;
    });
    expect(fills.filter((w) => w > 0).length).toBeGreaterThan(1);
    // staggered, not identical — the rails must not look like one bar
    expect(new Set(fills).size).toBeGreaterThan(1);
  });

  it("shows the beat under the playhead, and not the others", () => {
    const texts = drawnTexts(storyboard, {
      ...frameOf("progress"),
      beatIndex: 3,
    });
    expect(texts).toContain("PR opened");
    expect(texts).not.toContain("Mission launched");
    expect(texts).toContain("4 / 5");
  });

  it("shows merge + safety metrics in the ship scene, never a diff body", () => {
    const texts = drawnTexts(storyboard, frameOf("ship", 0.8));
    expect(texts).toContain("MERGED");
    expect(texts).toContain("6 / 6 tasks done");
    expect(texts).toContain("+412");
    expect(texts).toContain("−87");
    expect(texts).toContain("FILES");
  });

  it("says DONE rather than MERGED when nothing was actually merged", () => {
    const noPr = buildReplayStoryboard(
      makeRedacted({
        ...FULL_PAYLOAD,
        stats: { ...FULL_PAYLOAD.stats, prs: 0 },
      }),
    );
    const shipFrame = planReplayStoryboardFrames(noPr).find(
      (f) => f.scene === "ship",
    )!;
    expect(drawnTexts(noPr, shipFrame)).toContain("DONE");
  });

  it("stamps the ending with the hero stat", () => {
    const texts = drawnTexts(storyboard, frameOf("stamp", 0.8));
    expect(texts).toContain("MISSION COMPLETE");
    expect(texts).toContain(storyboard.hero.line);
  });

  /**
   * Regression: the in-flight scene used to stack the beat title *after* the
   * rails, so a 4-agent mission with a 2-line title pushed the lane tag
   * through the divider and onto the footer. Both counts vary at runtime, so
   * the bound is asserted at the worst case rather than eyeballed.
   */
  it("keeps every scene's body above the footer divider, worst case", () => {
    const worstCase = {
      goal: "Ship the mission replay narrative storyboard export for social sharing",
      templateId: "feature",
      durationMs: 5_400_000,
      stats: {
        tasks: 12,
        tasksDone: 12,
        agents: 4,
        prs: 3,
        filesChanged: 128,
        linesAdded: 4120,
        linesDeleted: 870,
      },
      cast: [1, 2, 3, 4].map((i) => ({
        agentRef: `agent-${i} · claude`,
        vendor: "claude",
        spawnedModel: "claude-opus-5-20260101",
        tasksCompleted: i,
      })),
      beats: [
        {
          title:
            "Mission launched by the orchestrator across four parallel agents",
          lane: "orchestrator",
        },
        { title: "Task claimed by agent-1", lane: "agent" },
        { title: "Merged to main", lane: "human" },
      ],
    };

    const DIVIDER_Y = 508;
    for (const template of ["story", "cast"] as const) {
      const storyboard = buildReplayStoryboard(
        makeRedacted(worstCase),
        template,
      );
      for (const frame of planReplayStoryboardFrames(storyboard)) {
        const painted: Array<{ text: string; baseline: number }> = [];
        const ctx = {
          fillStyle: "",
          font: "",
          textAlign: "left" as "left" | "right" | "center",
          textBaseline: "alphabetic" as const,
          fillRect: vi.fn(),
          fillText: (text: string, _x: number, y: number) =>
            painted.push({ text, baseline: y }),
          measureText: (text: string) => {
            const size = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 20);
            return { width: text.length * size * 0.55 };
          },
        };
        drawReplayStoryboardFrame(ctx, storyboard, frame);

        // Everything except the two footer strings must clear the divider.
        const footerTexts = new Set([
          storyboard.model.castLabel ?? "Marblo Mission Replay",
          storyboard.model.creditLabel,
        ]);
        for (const { text, baseline } of painted) {
          if (footerTexts.has(text)) continue;
          expect(
            baseline,
            `"${text}" (${template}/${frame.scene}) crosses the footer divider`,
          ).toBeLessThan(DIVIDER_Y);
        }
      }
    }
  });

  it("is pure — identical input produces an identical call sequence", () => {
    const frame = frameOf("progress", 0.4);
    const first = makeRecordingCtx();
    const second = makeRecordingCtx();
    drawReplayStoryboardFrame(first.ctx, storyboard, frame);
    drawReplayStoryboardFrame(second.ctx, storyboard, frame);
    expect(first.calls).toEqual(second.calls);
  });

  it("leaves textAlign reset to left after every frame", () => {
    for (const frame of frames) {
      const { ctx } = makeRecordingCtx();
      drawReplayStoryboardFrame(ctx, storyboard, frame);
      expect(ctx.textAlign).toBe("left");
    }
  });

  it("renders an empty-cast mission without throwing, still saying something", () => {
    const bare = buildReplayStoryboard(makeRedacted({ goal: "Bare run" }));
    for (const frame of planReplayStoryboardFrames(bare)) {
      const { ctx } = makeRecordingCtx();
      expect(() => drawReplayStoryboardFrame(ctx, bare, frame)).not.toThrow();
    }
    const castFrame = planReplayStoryboardFrames(bare).find(
      (f) => f.scene === "cast",
    )!;
    expect(drawnTexts(bare, castFrame)).toContain(bare.hero.line);
  });

  it("uses its own brand theme, never the app shell's", () => {
    const { ctx, calls } = makeRecordingCtx();
    // sanity: the theme is a superset of the card's, so a card override applies
    expect(REPLAY_STORY_THEME.background).toBe(REPLAY_CARD_THEME.background);
    expect(REPLAY_STORY_THEME.accent).toBeDefined();
    drawReplayStoryboardFrame(ctx, storyboard, frameOf("headline"), {
      ...REPLAY_STORY_THEME,
      background: "#ff00ff",
    });
    expect(calls[0]).toContain("rect:0,0");
  });
});

// ---------------------------------------------------------------------------

describe("gif.ts template routing", () => {
  const redacted = makeRedacted(FULL_PAYLOAD);

  it("defaults to the storyboard, not the legacy stat card", () => {
    const plan = buildReplayMotionRenderPlan(redacted);
    expect(plan.template).toBe("story");
    const { ctx, texts } = makeRecordingCtx();
    // the stamp is the last frame and exists only in the storyboard cut
    plan.draw(ctx, plan.frames.length - 1);
    expect(texts).toContain("MISSION COMPLETE");
  });

  it("routes 'stats' to the #741 headline -> stats -> timeline cut", () => {
    const plan = buildReplayMotionRenderPlan(redacted, { template: "stats" });
    const seen = new Set<string>();
    for (let i = 0; i < plan.frames.length; i += 1) {
      const { ctx, texts } = makeRecordingCtx();
      plan.draw(ctx, i);
      texts.forEach((t) => seen.add(t));
    }
    expect(seen.has("MISSION STATS")).toBe(true);
    expect(seen.has("TIMELINE")).toBe(true);
    expect(seen.has("MISSION COMPLETE")).toBe(false);
  });

  it("gives each template a distinct cut of the same replay", () => {
    const cuts = (["story", "cast", "stats"] as const).map((template) => {
      const plan = buildReplayMotionRenderPlan(redacted, { template });
      const { ctx, calls } = makeRecordingCtx();
      plan.draw(ctx, Math.floor(plan.frames.length / 2));
      return calls.join("|");
    });
    expect(new Set(cuts).size).toBe(3);
  });

  it("keeps the storyboard timestamps monotonic for the muxer", () => {
    const plan = buildReplayMotionRenderPlan(redacted, { template: "cast" });
    for (let i = 1; i < plan.frames.length; i += 1) {
      expect(plan.frames[i].tSeconds).toBeGreaterThan(
        plan.frames[i - 1].tSeconds,
      );
    }
  });

  it("encodes a story-template GIF through the same pure-JS encoder", async () => {
    const pixelCount = REPLAY_STORY_WIDTH * REPLAY_STORY_HEIGHT;
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
    const canvas: ReplayMotionCanvasLike = { getContext: () => drawCtx };

    const blob = await renderReplayMotionGif(redacted, {
      template: "story",
      createCanvas: () => canvas,
      timing: { fps: 2, durationScale: 0.1 },
    });

    expect(blob.type).toBe("image/gif");
    expect(blob.size).toBeGreaterThan(0);
    expect(drawCtx.getImageData).toHaveBeenCalledTimes(
      buildReplayMotionRenderPlan(redacted, {
        template: "story",
        timing: { fps: 2, durationScale: 0.1 },
      }).frames.length,
    );
  }, 20_000);
});
