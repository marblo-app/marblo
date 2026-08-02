/**
 * Mission Replay motion export — animated GIF + WebM, canvas-rendered
 * (design §4 Phase 3, brought forward from the CEO-cut PNG-only scope: see
 * `docs/MISSION-REPLAY-DESIGN.md` §9.1 for the original cut and this
 * ticket's footer for why it's back in scope now).
 *
 * ★Input is `RedactedReplay` only — same invariant as `card.ts` (§4 Phase 3
 * 완료 기준): no exporter in this file ever imports `MissionReplay`.
 *
 * ★No native binaries (ffmpeg 등 금지 — mac 서명·공증 파이프라인 보호). Both
 * outputs go through Chromium-native APIs only:
 *   - GIF: `<canvas>` pixel readback → `gifenc` (pure JS, zero deps, no
 *     native encoder — this satisfies "GIF는 순수 JS 인코더").
 *   - WebM: `<canvas>` frames → WebCodecs `VideoEncoder` (via `mediabunny`,
 *     a zero-dependency pure-TS muxer — WebCodecs itself only emits encoded
 *     chunks, not a container, so a muxer is required to produce a playable
 *     file; mediabunny does no native/ffmpeg work, it only packs bytes).
 *
 * ★Reuses the P3 share card's canvas render (`card.ts`): `buildReplayCardModel`
 * for headline/stats/cast/credit, `wrapLines` for headline wrapping, and
 * `REPLAY_CARD_THEME`/`ReplayCardDrawContext` so the motion export shares the
 * card's own theme tokens — never the app's dark-fixed shell theme (design §4
 * Phase 3 렌더 주의: "익스포트 캔버스는 앱 테마를 상속하지 말고 자체 테마
 * 토큰을 갖는다").
 *
 * ★Templates. This file owns encoding; *what* gets drawn is a template choice:
 *   - `"story"` (default) / `"cast"` → `gifStoryboard.ts`, the narrative cut
 *     (mission → orchestrate → parallel in-flight → ship → stamp). This is the
 *     shape that reads as "several agents on several models shipped this".
 *   - `"stats"` → the original #741 shape kept intact below
 *     (`planReplayMotionFrames` + `drawReplayMotionFrame`): headline → stats →
 *     timeline.
 * Both paths take the identical `RedactedReplay` input and go through the
 * identical encoder; only the frame plan and the drawer differ.
 */

import { applyPalette, GIFEncoder, quantize } from "gifenc";
import {
  BufferTarget,
  CanvasSource,
  Output,
  QUALITY_MEDIUM,
  WebMOutputFormat,
} from "mediabunny";
import {
  buildReplayCardModel,
  REPLAY_CARD_HEIGHT,
  REPLAY_CARD_THEME,
  REPLAY_CARD_WIDTH,
  wrapLines,
  type ReplayCardDrawContext,
  type ReplayCardModel,
  type ReplayCardTheme,
} from "./card";
import {
  buildReplayStoryBeats,
  buildReplayStoryboard,
  drawReplayStoryboardFrame,
  isReplayStoryTemplate,
  planReplayStoryboardFrames,
  REPLAY_EXPORT_DEFAULT_TEMPLATE,
  REPLAY_STORY_MAX_BEATS,
  REPLAY_STORY_THEME,
  type ReplayExportTemplateId,
  type ReplayStoryBeat,
  type ReplayStoryTheme,
} from "./gifStoryboard";
import type { RedactedReplay } from "../../../types/missionReplay";

export const REPLAY_MOTION_WIDTH = REPLAY_CARD_WIDTH;
export const REPLAY_MOTION_HEIGHT = REPLAY_CARD_HEIGHT;
export const REPLAY_MOTION_FPS = 10;
export const REPLAY_MOTION_MAX_BEATS = REPLAY_STORY_MAX_BEATS;

// ---------------------------------------------------------------------------
// Beats — the one piece of the motion export the static card doesn't need.
// The reader itself lives in `gifStoryboard.ts`: both templates need the same
// `{title, lane}`-only view of `payload.beats[]`, and keeping exactly one
// payload reader is what makes the 비식별 boundary auditable by reading one
// file. Re-exported here so the `"stats"` template's call sites are unchanged.
// ---------------------------------------------------------------------------

export type ReplayMotionBeat = ReplayStoryBeat;
export const buildReplayMotionBeats = buildReplayStoryBeats;

// ---------------------------------------------------------------------------
// Timing plan — pure, deterministic, unit-testable without a canvas. Three
// segments in sequence: headline → stat tiles → timeline beats (ticket
// footer's required order), 5-10s total.
// ---------------------------------------------------------------------------

export type ReplayMotionSegmentKind = "headline" | "stats" | "timeline";

export interface ReplayMotionTimingOptions {
  fps?: number;
  headlineSeconds?: number;
  statsSeconds?: number;
  timelineSeconds?: number;
  /**
   * Storyboard templates only — shrinks every scene proportionally. The
   * `"stats"` template has explicit per-segment seconds instead, so it ignores
   * this. Exists so tests can encode a whole storyboard in a few frames.
   */
  durationScale?: number;
}

export interface ReplayMotionFrame {
  index: number;
  tSeconds: number;
  segment: ReplayMotionSegmentKind;
  /** Set only for "timeline" frames when there's at least one beat to show. */
  beatIndex: number | null;
}

const DEFAULT_HEADLINE_SECONDS = 2.5;
const DEFAULT_STATS_SECONDS = 2.5;
const DEFAULT_TIMELINE_SECONDS = 3;

/** Total duration of the default timing plan, in seconds — kept inside the 5-10s ticket range. */
export const REPLAY_MOTION_DEFAULT_DURATION_SECONDS =
  DEFAULT_HEADLINE_SECONDS + DEFAULT_STATS_SECONDS + DEFAULT_TIMELINE_SECONDS;

/** Pure frame plan: given a beat count and timing knobs, returns every frame's timestamp + segment + beat index. */
export function planReplayMotionFrames(
  beatCount: number,
  options: ReplayMotionTimingOptions = {},
): ReplayMotionFrame[] {
  const fps = options.fps ?? REPLAY_MOTION_FPS;
  const headlineSeconds = options.headlineSeconds ?? DEFAULT_HEADLINE_SECONDS;
  const statsSeconds = options.statsSeconds ?? DEFAULT_STATS_SECONDS;
  const timelineSeconds = options.timelineSeconds ?? DEFAULT_TIMELINE_SECONDS;

  const headlineEnd = headlineSeconds;
  const statsEnd = headlineEnd + statsSeconds;
  const totalSeconds = statsEnd + timelineSeconds;
  const frameCount = Math.max(1, Math.round(totalSeconds * fps));
  const beatSlot =
    beatCount > 0 ? timelineSeconds / beatCount : timelineSeconds;

  const frames: ReplayMotionFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const tSeconds = index / fps;
    let segment: ReplayMotionSegmentKind;
    let beatIndex: number | null = null;

    if (tSeconds < headlineEnd) {
      segment = "headline";
    } else if (tSeconds < statsEnd) {
      segment = "stats";
    } else {
      segment = "timeline";
      if (beatCount > 0) {
        beatIndex = Math.min(
          beatCount - 1,
          Math.floor((tSeconds - statsEnd) / beatSlot),
        );
      }
    }

    frames.push({ index, tSeconds, segment, beatIndex });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Drawing — segment-conditional; reuses `card.ts`'s draw-context shape and
// wrapping helper so a real 2D canvas context satisfies it structurally.
// ---------------------------------------------------------------------------

function setFont(
  ctx: ReplayCardDrawContext,
  weight: number,
  size: number,
): void {
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif`;
}

/** Draws one frame of the motion export. Pure function of (ctx, model, beats, frame, theme). */
export function drawReplayMotionFrame(
  ctx: ReplayCardDrawContext,
  model: ReplayCardModel,
  beats: ReplayMotionBeat[],
  frame: ReplayMotionFrame,
  theme: ReplayCardTheme = REPLAY_CARD_THEME,
): void {
  const width = REPLAY_MOTION_WIDTH;
  const height = REPLAY_MOTION_HEIGHT;
  const padding = 64;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = theme.brand;
  ctx.fillRect(0, 0, width, 6);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  setFont(ctx, 600, 20);
  ctx.fillStyle = theme.subtitle;
  ctx.fillText(model.eyebrow, padding, 92);

  if (frame.segment === "headline") {
    setFont(ctx, 700, 52);
    ctx.fillStyle = theme.headline;
    const headlineLines = wrapLines(ctx, model.goal, width - padding * 2, 3);
    const headlineLineHeight = 62;
    let y = 220;
    for (const line of headlineLines) {
      ctx.fillText(line, padding, y);
      y += headlineLineHeight;
    }

    const metaParts = [model.templateLabel, model.durationLabel].filter(
      (part): part is string => Boolean(part),
    );
    if (metaParts.length > 0) {
      setFont(ctx, 500, 24);
      ctx.fillStyle = theme.subtitle;
      ctx.fillText(metaParts.join(" · "), padding, y + 12);
    }
  } else if (frame.segment === "stats") {
    setFont(ctx, 600, 22);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText("MISSION STATS", padding, 180);

    if (model.stats.length > 0) {
      const statsTop = 380;
      const columnWidth = (width - padding * 2) / model.stats.length;
      ctx.textAlign = "center";
      for (let i = 0; i < model.stats.length; i += 1) {
        const stat = model.stats[i];
        const columnCenter = padding + columnWidth * i + columnWidth / 2;

        setFont(ctx, 700, 64);
        ctx.fillStyle = theme.statValue;
        ctx.fillText(stat.value, columnCenter, statsTop);

        setFont(ctx, 500, 20);
        ctx.fillStyle = theme.statLabel;
        ctx.fillText(stat.label.toUpperCase(), columnCenter, statsTop + 32);
      }
      ctx.textAlign = "left";
    }
  } else {
    setFont(ctx, 600, 22);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText("TIMELINE", padding, 220);

    const beat = frame.beatIndex !== null ? beats[frame.beatIndex] : undefined;
    setFont(ctx, 700, 40);
    ctx.fillStyle = theme.headline;
    const beatLines = wrapLines(
      ctx,
      beat?.title ?? "Mission Replay",
      width - padding * 2,
      3,
    );
    let y = 280;
    for (const line of beatLines) {
      ctx.fillText(line, padding, y);
      y += 50;
    }

    if (beat?.lane) {
      setFont(ctx, 500, 20);
      ctx.fillStyle = theme.subtitle;
      ctx.fillText(beat.lane.toUpperCase(), padding, y + 12);
    }

    if (beats.length > 0 && frame.beatIndex !== null) {
      setFont(ctx, 500, 18);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText(
        `${frame.beatIndex + 1} / ${beats.length}`,
        width - padding,
        220,
      );
    }
  }

  ctx.fillStyle = theme.divider;
  ctx.fillRect(padding, 508, width - padding * 2, 1);

  const footerY = 552;
  setFont(ctx, 500, 20);
  ctx.fillStyle = theme.footer;
  ctx.fillText(model.castLabel ?? "Marblo Mission Replay", padding, footerY);

  ctx.textAlign = "right";
  ctx.fillStyle = theme.brand;
  ctx.fillText(model.creditLabel, width - padding, footerY);
  ctx.textAlign = "left";
}

// ---------------------------------------------------------------------------
// Template routing — the one place that decides "which frames, drawn how".
// Both encoders below consume a `ReplayMotionRenderPlan` and know nothing
// about templates, so adding a template never touches encoding.
// ---------------------------------------------------------------------------

export interface ReplayMotionRenderPlan {
  template: ReplayExportTemplateId;
  fps: number;
  /** One entry per frame; `tSeconds` is what the WebM muxer timestamps with. */
  frames: ReadonlyArray<{ tSeconds: number }>;
  /** Draws frame `index` onto `ctx`. Closed over the already-built view model. */
  draw(ctx: ReplayCardDrawContext, index: number): void;
}

export interface ReplayMotionTemplateOptions {
  template?: ReplayExportTemplateId;
  theme?: ReplayCardTheme;
  timing?: ReplayMotionTimingOptions;
}

/**
 * Builds the frame plan + drawer for a template. Storyboard templates get the
 * narrative cut; `"stats"` keeps the original #741 headline→stats→timeline cut.
 *
 * Note both branches read the same `RedactedReplay` and nothing else — the
 * template choice can widen the *story*, never the data.
 */
export function buildReplayMotionRenderPlan(
  redacted: RedactedReplay,
  options: ReplayMotionTemplateOptions = {},
): ReplayMotionRenderPlan {
  const template = options.template ?? REPLAY_EXPORT_DEFAULT_TEMPLATE;
  const fps = options.timing?.fps ?? REPLAY_MOTION_FPS;

  if (isReplayStoryTemplate(template)) {
    const storyboard = buildReplayStoryboard(redacted, template);
    const frames = planReplayStoryboardFrames(storyboard, {
      fps,
      durationScale: options.timing?.durationScale,
    });
    // A card-theme override still applies — the storyboard theme is a superset.
    const theme: ReplayStoryTheme = {
      ...REPLAY_STORY_THEME,
      ...(options.theme ?? {}),
    };
    return {
      template,
      fps,
      frames,
      draw: (ctx, index) =>
        drawReplayStoryboardFrame(ctx, storyboard, frames[index], theme),
    };
  }

  const model = buildReplayCardModel(redacted);
  const beats = buildReplayMotionBeats(redacted);
  const theme = options.theme ?? REPLAY_CARD_THEME;
  const frames = planReplayMotionFrames(beats.length, options.timing);
  return {
    template,
    fps,
    frames,
    draw: (ctx, index) =>
      drawReplayMotionFrame(ctx, model, beats, frames[index], theme),
  };
}

// ---------------------------------------------------------------------------
// GIF encoding — canvas pixel readback → gifenc (pure JS, no native encoder).
// `createCanvas` is injectable so the pipeline is unit-testable in Node
// without a real DOM (same pattern as `card.ts`'s `renderReplayCardPng`).
// ---------------------------------------------------------------------------

export interface ReplayMotionCanvasContext extends ReplayCardDrawContext {
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { data: Uint8ClampedArray | Uint8Array };
}

export interface ReplayMotionCanvasLike {
  getContext(type: "2d"): ReplayMotionCanvasContext | null;
}

export interface RenderReplayMotionGifOptions extends ReplayMotionTemplateOptions {
  createCanvas?: () => ReplayMotionCanvasLike;
}

function createDefaultMotionCanvas(): ReplayMotionCanvasLike {
  const canvas = document.createElement("canvas");
  canvas.width = REPLAY_MOTION_WIDTH;
  canvas.height = REPLAY_MOTION_HEIGHT;
  return canvas as unknown as ReplayMotionCanvasLike;
}

function toRgbaUint8(data: Uint8ClampedArray | Uint8Array): Uint8Array {
  return data instanceof Uint8ClampedArray
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : data;
}

/** Renders a `RedactedReplay` to an animated GIF `Blob`. Pure JS encoder (`gifenc`), no native dependency. */
export async function renderReplayMotionGif(
  redacted: RedactedReplay,
  options: RenderReplayMotionGifOptions = {},
): Promise<Blob> {
  const plan = buildReplayMotionRenderPlan(redacted, options);

  const canvas = (options.createCanvas ?? createDefaultMotionCanvas)();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Replay motion: 2D canvas context unavailable");

  const encoder = GIFEncoder();
  const delayMs = Math.round(1000 / plan.fps);

  for (let index = 0; index < plan.frames.length; index += 1) {
    plan.draw(ctx, index);
    const imageData = ctx.getImageData(
      0,
      0,
      REPLAY_MOTION_WIDTH,
      REPLAY_MOTION_HEIGHT,
    );
    const rgba = toRgbaUint8(imageData.data);
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    encoder.writeFrame(indexed, REPLAY_MOTION_WIDTH, REPLAY_MOTION_HEIGHT, {
      palette,
      delay: delayMs,
      repeat: 0,
    });
  }

  encoder.finish();
  return new Blob([new Uint8Array(encoder.bytes())], { type: "image/gif" });
}

// ---------------------------------------------------------------------------
// WebM encoding — canvas frames → WebCodecs VideoEncoder, muxed by
// `mediabunny` (zero-dependency, pure TS; only packs the encoder's chunks
// into a WebM container — no native/ffmpeg work). `createCanvas` and
// `createMuxer` are injectable for the same Node-testability reason as the
// GIF path above; the default muxer is the only part of this file that
// touches real WebCodecs/mediabunny classes.
// ---------------------------------------------------------------------------

export interface ReplayMotionMuxerLike {
  output: {
    start(): Promise<void>;
    finalize(): Promise<void>;
    target: { buffer: ArrayBuffer | null };
  };
  videoSource: {
    add(timestamp: number, duration?: number): Promise<void>;
    close(): void;
  };
}

export interface RenderReplayMotionWebmOptions extends ReplayMotionTemplateOptions {
  createCanvas?: () => HTMLCanvasElement | OffscreenCanvas;
  createMuxer?: (
    canvas: HTMLCanvasElement | OffscreenCanvas,
  ) => ReplayMotionMuxerLike;
}

function createDefaultRealCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = REPLAY_MOTION_WIDTH;
  canvas.height = REPLAY_MOTION_HEIGHT;
  return canvas;
}

function createDefaultMuxer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): ReplayMotionMuxerLike {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const videoSource = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: QUALITY_MEDIUM,
  });
  output.addVideoTrack(videoSource);
  return { output, videoSource };
}

/** Renders a `RedactedReplay` to a WebM `Blob` via WebCodecs. No native binary — Chromium's own encoder + a pure-JS muxer. */
export async function renderReplayMotionWebm(
  redacted: RedactedReplay,
  options: RenderReplayMotionWebmOptions = {},
): Promise<Blob> {
  const plan = buildReplayMotionRenderPlan(redacted, options);

  const canvas = (options.createCanvas ?? createDefaultRealCanvas)();
  const ctx = canvas.getContext("2d") as ReplayCardDrawContext | null;
  if (!ctx) throw new Error("Replay motion: 2D canvas context unavailable");

  const { output, videoSource } = (options.createMuxer ?? createDefaultMuxer)(
    canvas,
  );

  await output.start();
  const frameDuration = 1 / plan.fps;
  for (let index = 0; index < plan.frames.length; index += 1) {
    plan.draw(ctx, index);
    await videoSource.add(plan.frames[index].tSeconds, frameDuration);
  }
  videoSource.close();
  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) {
    throw new Error("Replay motion: webm encoding produced no output");
  }
  return new Blob([buffer], { type: "video/webm" });
}

/** True when this runtime can encode WebM via WebCodecs (Chromium/Electron only — no polyfill, no fallback encoder). */
export function isReplayMotionWebmSupported(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !==
      "undefined"
  );
}

/**
 * `marblo-replay-<goal-slug>[-<template>].<ext>`. The template suffix is
 * omitted when no template is given, so existing callers keep their filenames;
 * the panel passes one so two cuts of the same mission don't collide in the
 * downloads folder.
 */
export function buildReplayMotionFileName(
  model: ReplayCardModel,
  extension: "gif" | "webm",
  template?: ReplayExportTemplateId,
): string {
  const slug = model.goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = template ? `-${template}` : "";
  return `marblo-replay-${slug || "mission"}${suffix}.${extension}`;
}
