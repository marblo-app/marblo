/**
 * Mission Replay share card — canvas-rendered PNG (design §4 Phase 3, scope
 * reduced by CEO gate §9.1: PNG card only, GIF/video/badge cut).
 *
 * ★Input is `RedactedReplay` only — the design's "no exporter accepts the
 * original MissionReplay" invariant (§4 Phase 3 완료 기준) is enforced by
 * this file only importing the redacted type, never `MissionReplay`.
 *
 * ★No native binaries (ffmpeg 등 금지 — mac 서명·공증 파이프라인 보호).
 * Rendering goes through `<canvas>` only, via a minimal duck-typed context
 * (`ReplayCardDrawContext`) so the layout logic stays testable under Node
 * without a DOM or a native `canvas` package.
 *
 * ★The card has its own theme tokens (`REPLAY_CARD_THEME`), independent of
 * the app shell's dark-fixed theme — how the card looks on X/LinkedIn has
 * nothing to do with how the app renders internally (design §4 Phase 3
 * 렌더 주의).
 *
 * PNG output carries no EXIF/text metadata: the Canvas PNG encoder
 * (`toBlob`/`convertToBlob`) never writes any, and nothing in this file
 * writes chunks by hand.
 */

import type { RedactedReplay } from "../../../types/missionReplay";

export const REPLAY_CARD_WIDTH = 1200;
export const REPLAY_CARD_HEIGHT = 630;

export interface ReplayCardTheme {
  background: string;
  headline: string;
  subtitle: string;
  statValue: string;
  statLabel: string;
  divider: string;
  footer: string;
  brand: string;
}

/** Self-contained — not derived from the app's Tailwind/dark tokens. */
export const REPLAY_CARD_THEME: ReplayCardTheme = {
  background: "#0b0f19",
  headline: "#f4f6fb",
  subtitle: "#8b93a7",
  statValue: "#7dd3fc",
  statLabel: "#6b7488",
  divider: "#232a3d",
  footer: "#8b93a7",
  brand: "#a78bfa",
};

export interface ReplayCardStat {
  label: string;
  value: string;
}

/** Pure view model — everything the drawer needs, nothing it has to parse. */
export interface ReplayCardModel {
  eyebrow: string;
  goal: string;
  templateLabel: string | null;
  durationLabel: string | null;
  stats: ReplayCardStat[];
  castLabel: string | null;
  creditLabel: string;
}

// ---------------------------------------------------------------------------
// Payload parsing — defensive by construction. `RedactedReplay.payload` is
// `unknown`: redaction may mask, relativize, or drop any field depending on
// level and content, so every read here has a fallback rather than asserting
// shape (design §2.2 RedactedReplay comment: only `serialized`/`payload` may
// cross the export boundary, and neither is guaranteed to mirror
// `publicationInput`'s shape 1:1).
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatDurationLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const CARD_STAT_FIELDS: ReadonlyArray<[string, string]> = [
  ["tasksDone", "tasks"],
  ["agents", "agents"],
  ["prs", "PRs"],
  ["filesChanged", "files"],
];

function buildStats(
  statsRaw: Record<string, unknown> | null,
): ReplayCardStat[] {
  if (!statsRaw) return [];
  const stats: ReplayCardStat[] = [];
  for (const [key, label] of CARD_STAT_FIELDS) {
    const n = asFiniteNumber(statsRaw[key]);
    if (n !== null) stats.push({ label, value: String(n) });
  }
  return stats;
}

function buildCastLabel(castRaw: unknown): string | null {
  if (!Array.isArray(castRaw)) return null;
  const vendors: string[] = [];
  const seen = new Set<string>();
  for (const entry of castRaw) {
    const vendor = asNonEmptyString(asRecord(entry)?.vendor);
    if (vendor && !seen.has(vendor)) {
      seen.add(vendor);
      vendors.push(vendor);
    }
  }
  return vendors.length > 0 ? vendors.join(" · ") : null;
}

function buildCreditLabel(root: Record<string, unknown>): string {
  const credits = asRecord(root.credits);
  const handle = asNonEmptyString(credits?.handle);
  if (credits?.mode === "credited" && handle) {
    return handle.startsWith("@") ? handle : `@${handle}`;
  }
  return "Shipped with Marblo";
}

/** The only place this file reads `RedactedReplay.payload` — everywhere else works off `ReplayCardModel`. */
export function buildReplayCardModel(
  redacted: RedactedReplay,
): ReplayCardModel {
  const root = asRecord(redacted.payload) ?? {};
  const statsRaw = asRecord(root.stats);
  // `durationMs` sits at the payload root, not under `stats`
  // (redactReplay.ts's `publicationInput` puts it there) — see also
  // `stats.durationMs` in `MissionReplay` itself, which is a different path.
  const durationMs = asFiniteNumber(root.durationMs);

  return {
    eyebrow: `MISSION REPLAY · ${redacted.level}`,
    goal: asNonEmptyString(root.goal) ?? "Mission Replay",
    templateLabel: asNonEmptyString(root.templateId),
    durationLabel: durationMs !== null ? formatDurationLabel(durationMs) : null,
    stats: buildStats(statsRaw),
    castLabel: buildCastLabel(root.cast),
    creditLabel: buildCreditLabel(root),
  };
}

// ---------------------------------------------------------------------------
// Drawing — a minimal duck-typed subset of CanvasRenderingContext2D. Kept
// deliberately small (no gradients, no images) so the whole draw path can be
// unit-tested against a plain object in Node, no jsdom/canvas package.
// ---------------------------------------------------------------------------

export interface ReplayCardDrawContext {
  fillStyle: string;
  font: string;
  textAlign: "left" | "right" | "center";
  textBaseline: "alphabetic" | "top" | "middle" | "bottom";
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
}

function setFont(
  ctx: ReplayCardDrawContext,
  weight: number,
  size: number,
): void {
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif`;
}

/** Greedy word-wrap into at most `maxLines`; overflow gets an ellipsis on the last line. */
export function wrapLines(
  ctx: ReplayCardDrawContext,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines <= 0) return [];

  const lines: string[] = [];
  let current = words[0];
  let consumed = 1;

  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      consumed += 1;
      continue;
    }
    lines.push(current);
    if (lines.length === maxLines) {
      current = "";
      break;
    }
    current = words[i];
    consumed += 1;
  }
  if (current) lines.push(current);

  const truncated = consumed < words.length || lines.length > maxLines;
  if (lines.length > maxLines) lines.length = maxLines;

  if (truncated && lines.length > 0) {
    const lastIndex = lines.length - 1;
    let last = lines[lastIndex].replace(/[.,;:]+$/, "");
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lastIndex] = last.length > 0 ? `${last}…` : "…";
  }

  return lines;
}

/** Draws the card. Pure function of (ctx, model, theme) — no I/O, no payload parsing. */
export function drawReplayCard(
  ctx: ReplayCardDrawContext,
  model: ReplayCardModel,
  theme: ReplayCardTheme = REPLAY_CARD_THEME,
): void {
  const width = REPLAY_CARD_WIDTH;
  const padding = 64;

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, REPLAY_CARD_HEIGHT);

  ctx.fillStyle = theme.brand;
  ctx.fillRect(0, 0, width, 6);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  setFont(ctx, 600, 20);
  ctx.fillStyle = theme.subtitle;
  ctx.fillText(model.eyebrow, padding, 92);

  setFont(ctx, 700, 52);
  ctx.fillStyle = theme.headline;
  const headlineLines = wrapLines(ctx, model.goal, width - padding * 2, 3);
  const headlineLineHeight = 62;
  let y = 172;
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

  if (model.stats.length > 0) {
    const statsTop = 420;
    const columnWidth = (width - padding * 2) / model.stats.length;
    ctx.textAlign = "center";
    for (let i = 0; i < model.stats.length; i += 1) {
      const stat = model.stats[i];
      const columnCenter = padding + columnWidth * i + columnWidth / 2;

      setFont(ctx, 700, 44);
      ctx.fillStyle = theme.statValue;
      ctx.fillText(stat.value, columnCenter, statsTop);

      setFont(ctx, 500, 18);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText(stat.label.toUpperCase(), columnCenter, statsTop + 28);
    }
    ctx.textAlign = "left";
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
// PNG rendering — the only part of this file that touches a real canvas.
// `createCanvas` is injectable so the full pipeline (model → draw → blob) is
// unit-testable in Node without jsdom or a native `canvas` package.
// ---------------------------------------------------------------------------

export interface ReplayCardCanvasLike {
  getContext(type: "2d"): ReplayCardDrawContext | null;
  toBlob?(
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ): void;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
}

export interface RenderReplayCardOptions {
  theme?: ReplayCardTheme;
  createCanvas?: () => ReplayCardCanvasLike;
}

function createDefaultCanvas(): ReplayCardCanvasLike {
  const canvas = document.createElement("canvas");
  canvas.width = REPLAY_CARD_WIDTH;
  canvas.height = REPLAY_CARD_HEIGHT;
  return canvas as unknown as ReplayCardCanvasLike;
}

/** Renders a `RedactedReplay` straight to a PNG `Blob`. No intermediate file, no native encoder. */
export async function renderReplayCardPng(
  redacted: RedactedReplay,
  options: RenderReplayCardOptions = {},
): Promise<Blob> {
  const model = buildReplayCardModel(redacted);
  const canvas = (options.createCanvas ?? createDefaultCanvas)();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Replay card: 2D canvas context unavailable");

  drawReplayCard(ctx, model, options.theme ?? REPLAY_CARD_THEME);

  if (canvas.convertToBlob) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  if (canvas.toBlob) {
    const toBlob = canvas.toBlob.bind(canvas);
    return new Promise<Blob>((resolve, reject) => {
      toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Replay card: PNG encoding failed"));
      }, "image/png");
    });
  }
  throw new Error(
    "Replay card: canvas supports neither toBlob nor convertToBlob",
  );
}

export function buildReplayCardFileName(model: ReplayCardModel): string {
  const slug = model.goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `marblo-replay-${slug || "mission"}.png`;
}
