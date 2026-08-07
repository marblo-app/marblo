/**
 * Mission Replay motion export — **narrative storyboard** (the product story
 * layer on top of `gif.ts`'s encoder).
 *
 * `gif.ts` (#741) shipped one shape: headline → stats → timeline. That reads
 * like a dashboard export. This module adds the shape that makes a Replay
 * legible as *ours*: Build → Orchestrate → Replay, with the cast of agents on
 * screen, several of them visibly in flight at once, and a ship beat at the
 * end. The differentiator is not the numbers — every tool can print numbers —
 * it's that a viewer sees **N agents on N models orchestrated into one merge**,
 * which is the thing only a live orchestrator can produce.
 *
 * ★비식별 경계 (this file is the only new payload reader, so the boundary is
 * enforceable by reading one file): the storyboard reads **only**
 *   - `payload.goal` / `templateId` / `durationMs` (via `buildReplayCardModel`)
 *   - `payload.stats.*` — counts only (tasks, agents, prs, filesChanged,
 *     linesAdded, linesDeleted)
 *   - `payload.cast[].{agentRef,vendor,spawnedModel,detectedModelId,role,tasksCompleted}`
 *     — `agentRef` is already the anonymized alias ("agent-1 · claude")
 *   - `payload.beats[].{title,lane}`
 * and **never** `beats[].detail`, `taskId`, `actorRef`, `prUrl`, or any other
 * free-text/identifier field. No diff bodies, no code, no terminal output, no
 * prompts — a diff may only ever appear as `filesChanged`/`linesAdded`/
 * `linesDeleted` counts (design §5 L1/L2). `beats[].title` is a
 * data-derived one-liner that redaction has already passed at this level; it
 * is the same string `gif.ts` has been drawing since #741.
 *
 * ★Theme: `REPLAY_STORY_THEME` extends the card's own tokens — the export
 * never inherits the app shell's dark-fixed theme (design §4 Phase 3 렌더 주의).
 *
 * ★No native binaries: this module is pure layout/draw math. Encoding stays in
 * `gif.ts` (gifenc / WebCodecs+mediabunny).
 */

import {
  buildReplayCardModel,
  REPLAY_CARD_HEIGHT,
  REPLAY_CARD_THEME,
  REPLAY_CARD_WIDTH,
  wrapLines,
  type ReplayCardDrawContext,
  type ReplayCardModel,
  type ReplayCardStat,
  type ReplayCardTheme,
} from "./card";
import type { RedactedReplay } from "../../../types/missionReplay";

export const REPLAY_STORY_WIDTH = REPLAY_CARD_WIDTH;
export const REPLAY_STORY_HEIGHT = REPLAY_CARD_HEIGHT;

/** Cast members drawn on screen. Beyond this the montage stops reading. */
export const REPLAY_STORY_MAX_CAST = 4;
/** Beats cycled through the in-flight scene. */
export const REPLAY_STORY_MAX_BEATS = 6;

// ---------------------------------------------------------------------------
// Theme — Marblo's own tokens. Superset of `ReplayCardTheme` so a card-theme
// override (tests/stories) still applies to the storyboard.
// ---------------------------------------------------------------------------

export interface ReplayStoryTheme extends ReplayCardTheme {
  /** Section chrome behind cast rows / stamp fill. */
  surface: string;
  /** The one loud color: hero stat, ship numbers, spotlight. */
  accent: string;
  /** Secondary accent for the in-flight rails. */
  accentAlt: string;
  /** Per-lane rail colors — the visual claim "these ran in parallel". */
  laneAgent: string;
  laneOrchestrator: string;
  laneHuman: string;
  laneSystem: string;
}

export const REPLAY_STORY_THEME: ReplayStoryTheme = {
  ...REPLAY_CARD_THEME,
  surface: "#141a2b",
  accent: "#a78bfa",
  accentAlt: "#7dd3fc",
  laneAgent: "#7dd3fc",
  laneOrchestrator: "#a78bfa",
  laneHuman: "#34d399",
  laneSystem: "#64748b",
};

/** The mark that makes an exported frame attributable at a glance. */
export const REPLAY_STORY_MARK = "MADE WITH MARBLO";

// ---------------------------------------------------------------------------
// Templates — what the user picks in `ReplayExportPanel`.
// ---------------------------------------------------------------------------

/**
 * Templates this module renders. `"stats"` (the #741 shape) is not one of them —
 * `gif.ts` routes it to its own drawer.
 *
 * ★`"mission"` is the **default share flow's** cut (미션 서사): 미션명 → 태스크
 * 분해(제목만) → 워크트리·오케 머지 → PR 의존성 순서 머지 → 1~2줄 결론. It is
 * deliberately **not** in `REPLAY_EXPORT_TEMPLATES` — that array is the legacy
 * multi-format export panel's menu, and the reduced flow offers exactly one
 * button, not a template picker.
 */
export type ReplayStoryTemplateId = "mission" | "story" | "cast";

/** Everything selectable in the export panel, including the legacy stat-card shape. */
export type ReplayExportTemplateId = ReplayStoryTemplateId | "stats";

export interface ReplayExportTemplate {
  id: ReplayExportTemplateId;
  label: string;
  description: string;
}

export const REPLAY_EXPORT_TEMPLATES: readonly ReplayExportTemplate[] = [
  {
    id: "story",
    label: "스토리 타임라인",
    description: "미션 → 오케스트레이션 → 병렬 진행 → ship → 완료 도장",
  },
  {
    id: "cast",
    label: "캐스트 몽타주",
    description: "에이전트 한 대씩 스포트라이트 — 누가 무엇으로 돌았나",
  },
  {
    id: "stats",
    label: "통계 카드",
    description: "헤드라인 → 통계 → 타임라인 (기존 shape)",
  },
];

export const REPLAY_EXPORT_DEFAULT_TEMPLATE: ReplayExportTemplateId = "story";

export function isReplayStoryTemplate(
  id: ReplayExportTemplateId,
): id is ReplayStoryTemplateId {
  return id === "mission" || id === "story" || id === "cast";
}

// ---------------------------------------------------------------------------
// Payload reading — same defensive posture as `card.ts`: `payload` is
// `unknown`, redaction may mask or drop any field, so every read falls back.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegativeInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  return n !== null && n >= 0 ? Math.floor(n) : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ReplayStoryBeat {
  title: string;
  lane: string | null;
}

/**
 * Reads `payload.beats[]`, capped to `max`.
 *
 * ★Only `title` and `lane` are read — `detail` (free text, usually classified
 * private) and every identifier field are deliberately not touched.
 */
export function buildReplayStoryBeats(
  redacted: RedactedReplay,
  max: number = REPLAY_STORY_MAX_BEATS,
): ReplayStoryBeat[] {
  const root = asRecord(redacted.payload) ?? {};
  const beatsRaw = root.beats;
  if (!Array.isArray(beatsRaw) || max <= 0) return [];

  const beats: ReplayStoryBeat[] = [];
  for (const entry of beatsRaw) {
    const rec = asRecord(entry);
    const title = asNonEmptyString(rec?.title);
    if (!title) continue;
    beats.push({ title, lane: asNonEmptyString(rec?.lane) });
    if (beats.length >= max) break;
  }
  return beats;
}

export interface ReplayStoryCastMember {
  /** Anonymous alias only — "agent-1", derived from the already-anonymized `agentRef`. */
  ref: string;
  vendor: string | null;
  /** `spawnedModel` if pinned, else the observed `detectedModelId`. */
  model: string | null;
  role: string | null;
  tasksCompleted: number | null;
}

/** "agent-1 · claude" → "agent-1". The alias is already anonymous; this just keeps the chip short. */
function shortRef(agentRef: string): string {
  const head = agentRef.split("·")[0]?.trim();
  return head && head.length > 0 ? head : agentRef;
}

/** Reads `payload.cast[]` — anonymous ref + vendor/model chips only. */
export function buildReplayStoryCast(
  redacted: RedactedReplay,
  max: number = REPLAY_STORY_MAX_CAST,
): ReplayStoryCastMember[] {
  const root = asRecord(redacted.payload) ?? {};
  const castRaw = root.cast;
  if (!Array.isArray(castRaw) || max <= 0) return [];

  const cast: ReplayStoryCastMember[] = [];
  for (const entry of castRaw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const agentRef = asNonEmptyString(rec.agentRef);
    const vendor = asNonEmptyString(rec.vendor);
    if (!agentRef && !vendor) continue;
    cast.push({
      ref: agentRef ? shortRef(agentRef) : `agent-${cast.length + 1}`,
      vendor,
      model:
        asNonEmptyString(rec.spawnedModel) ??
        asNonEmptyString(rec.detectedModelId),
      role: asNonEmptyString(rec.role),
      tasksCompleted: asNonNegativeInt(rec.tasksCompleted),
    });
    if (cast.length >= max) break;
  }
  return cast;
}

// ---------------------------------------------------------------------------
// Outline — the mission cut's own payload slice: task titles, PR numbers, and
// the dependency order they merged in. Same defensive posture as the readers
// above; still nothing but `title` (curated), an integer, and refs.
// ---------------------------------------------------------------------------

/** Outline rows drawn on screen. Beyond this the breakdown stops reading. */
export const REPLAY_STORY_MAX_OUTLINE = 5;
/** PR chips drawn in the merge scene. */
export const REPLAY_STORY_MAX_MERGE = 6;

export interface ReplayStoryOutlineTask {
  ref: string;
  title: string;
  prNumber: number | null;
  done: boolean;
  /** refs this row waited on — drawn as "← A" so the order is visibly *why*. */
  dependsOn: string[];
}

export interface ReplayStoryOutline {
  tasks: ReplayStoryOutlineTask[];
  mergeOrder: number[];
  hasDependencies: boolean;
  /** Rows the outline itself dropped upstream — surfaced, never swallowed. */
  truncated: number;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const str = asNonEmptyString(entry);
    if (str) out.push(str);
  }
  return out;
}

/**
 * Reads `payload.outline`.
 *
 * ★Only `ref`/`title`/`prNumber`/`done`/`dependsOn` — the exact shape
 * `lib/replay/missionOutline.ts` produced and redaction let through. There is
 * no PR **URL** in this payload to read even by accident (redaction's repoGate
 * drops it), which is the point: the frame can name `#831` without ever
 * knowing which repository it belongs to.
 */
export function buildReplayStoryOutline(
  redacted: RedactedReplay,
  maxTasks: number = REPLAY_STORY_MAX_OUTLINE,
  maxMerge: number = REPLAY_STORY_MAX_MERGE,
): ReplayStoryOutline {
  const root = asRecord(redacted.payload) ?? {};
  const outlineRaw = asRecord(root.outline);
  const tasksRaw = outlineRaw?.tasks;

  const tasks: ReplayStoryOutlineTask[] = [];
  if (Array.isArray(tasksRaw) && maxTasks > 0) {
    for (const entry of tasksRaw) {
      const rec = asRecord(entry);
      const title = asNonEmptyString(rec?.title);
      const ref = asNonEmptyString(rec?.ref);
      if (!title && !ref) continue;
      tasks.push({
        ref: ref ?? String.fromCharCode(65 + tasks.length),
        title: title ?? "",
        prNumber: asNonNegativeInt(rec?.prNumber),
        done: rec?.done === true,
        dependsOn: asStringArray(rec?.dependsOn),
      });
      if (tasks.length >= maxTasks) break;
    }
  }

  const mergeOrder: number[] = [];
  if (Array.isArray(outlineRaw?.mergeOrder)) {
    for (const entry of outlineRaw.mergeOrder as unknown[]) {
      const num = asNonNegativeInt(entry);
      if (num === null || mergeOrder.includes(num)) continue;
      mergeOrder.push(num);
      if (mergeOrder.length >= Math.max(0, maxMerge)) break;
    }
  }

  return {
    tasks,
    mergeOrder,
    hasDependencies:
      outlineRaw?.hasDependencies === true ||
      tasks.some((task) => task.dependsOn.length > 0),
    truncated: asNonNegativeInt(outlineRaw?.truncated) ?? 0,
  };
}

/** How many *distinct* models the payload can attest to — the "M models" half of the hero line. */
function countDistinctModels(castRaw: unknown): number | null {
  if (!Array.isArray(castRaw)) return null;
  const models = new Set<string>();
  const vendors = new Set<string>();
  for (const entry of castRaw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const model =
      asNonEmptyString(rec.spawnedModel) ??
      asNonEmptyString(rec.detectedModelId);
    if (model) models.add(model);
    const vendor = asNonEmptyString(rec.vendor);
    if (vendor) vendors.add(vendor);
  }
  const count = models.size > 0 ? models.size : vendors.size;
  return count > 0 ? count : null;
}

// ---------------------------------------------------------------------------
// Hero stat + ship metrics — the two "shareable" numbers blocks. Both are
// counts only; nothing here can carry a diff body or a path.
// ---------------------------------------------------------------------------

export interface ReplayStoryHero {
  agents: number | null;
  models: number | null;
  durationLabel: string | null;
  /** "3 AGENTS · 2 MODELS · SHIPPED IN 1H 30M" — the one line people screenshot. */
  line: string;
}

function buildHero(
  root: Record<string, unknown>,
  model: ReplayCardModel,
  castCount: number,
): ReplayStoryHero {
  const statsRaw = asRecord(root.stats);
  const agents = asNonNegativeInt(statsRaw?.agents) ?? (castCount || null);
  const models = countDistinctModels(root.cast);
  const durationLabel = model.durationLabel;

  const parts: string[] = [];
  if (agents !== null) parts.push(`${agents} AGENT${agents === 1 ? "" : "S"}`);
  if (models !== null) parts.push(`${models} MODEL${models === 1 ? "" : "S"}`);
  if (durationLabel) parts.push(`SHIPPED IN ${durationLabel.toUpperCase()}`);

  return {
    agents,
    models,
    durationLabel,
    line: parts.length > 0 ? parts.join(" · ") : "ORCHESTRATED WITH MARBLO",
  };
}

export interface ReplayStoryShip {
  prs: number | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  tasksDone: number | null;
  tasks: number | null;
  /** Non-identifying safety metrics, ready to draw as columns. */
  metrics: ReplayCardStat[];
  /** "12 / 12 tasks done" — null when the payload can't attest to it. */
  progressLabel: string | null;
}

function buildShip(root: Record<string, unknown>): ReplayStoryShip {
  const statsRaw = asRecord(root.stats);
  const prs = asNonNegativeInt(statsRaw?.prs);
  const filesChanged = asNonNegativeInt(statsRaw?.filesChanged);
  const linesAdded = asNonNegativeInt(statsRaw?.linesAdded);
  const linesDeleted = asNonNegativeInt(statsRaw?.linesDeleted);
  const tasksDone = asNonNegativeInt(statsRaw?.tasksDone);
  const tasks = asNonNegativeInt(statsRaw?.tasks);

  const metrics: ReplayCardStat[] = [];
  if (prs !== null) metrics.push({ label: "PRs", value: String(prs) });
  if (filesChanged !== null)
    metrics.push({ label: "files", value: String(filesChanged) });
  if (linesAdded !== null)
    metrics.push({ label: "lines +", value: `+${linesAdded}` });
  if (linesDeleted !== null)
    metrics.push({ label: "lines −", value: `−${linesDeleted}` });

  return {
    prs,
    filesChanged,
    linesAdded,
    linesDeleted,
    tasksDone,
    tasks,
    metrics,
    progressLabel:
      tasksDone !== null && tasks !== null
        ? `${tasksDone} / ${tasks} tasks done`
        : tasksDone !== null
          ? `${tasksDone} tasks done`
          : null,
  };
}

// ---------------------------------------------------------------------------
// Storyboard — scenes in narrative order, with their durations.
// ---------------------------------------------------------------------------

export type ReplayStorySceneKind =
  | "headline"
  | "cast"
  | "progress"
  | "ship"
  | "stamp"
  // ── mission cut ──────────────────────────────────────────────────────
  | "breakdown"
  | "worktree"
  | "merge"
  | "conclusion";

export interface ReplayStoryScene {
  kind: ReplayStorySceneKind;
  seconds: number;
  /** Chapter caption drawn top-left, e.g. "02 · ORCHESTRATE". */
  chapter: string;
}

const SCENE_CHAPTERS: Record<ReplayStorySceneKind, string> = {
  headline: "MISSION",
  cast: "ORCHESTRATE",
  progress: "IN FLIGHT",
  ship: "SHIP",
  stamp: "REPLAY",
  breakdown: "BREAKDOWN",
  worktree: "WORKTREES",
  merge: "MERGE",
  conclusion: "RESULT",
};

const SCENE_HEADINGS: Record<ReplayStorySceneKind, string> = {
  headline: "",
  cast: "ORCHESTRATED BY",
  progress: "RUNNING IN PARALLEL",
  // No heading — the scene's own "MERGED"/"DONE" says it, and "04 · SHIP"
  // already sits directly above.
  ship: "",
  stamp: "",
  breakdown: "태스크 분해",
  worktree: "워크트리별 작업 → 오케스트레이터 머지",
  merge: "의존성 순서대로 머지",
  conclusion: "",
};

/** Build → Orchestrate → Replay, weighted so the two shareable moments (parallel, ship) get the room. */
const STORY_SCENE_SECONDS: ReadonlyArray<[ReplayStorySceneKind, number]> = [
  ["headline", 2],
  ["cast", 2],
  ["progress", 3],
  ["ship", 1.5],
  ["stamp", 1.5],
];

/** Cast-first cut: the montage owns most of the runtime. */
const CAST_SCENE_SECONDS: ReadonlyArray<[ReplayStorySceneKind, number]> = [
  ["headline", 1.5],
  ["cast", 4],
  ["progress", 1.5],
  ["ship", 1],
  ["stamp", 1],
];

/**
 * ★Mission cut — the ticket's narrative, in its order:
 * 미션명 → 태스크 분해(제목만) → 워크트리별 작업·오케 머지 → PR 의존성 순서
 * 머지 → 1~2줄 결론. The breakdown and the merge get the room because those two
 * frames are the ones that carry information nobody can screenshot elsewhere.
 */
const MISSION_SCENE_SECONDS: ReadonlyArray<[ReplayStorySceneKind, number]> = [
  ["headline", 2],
  ["breakdown", 3],
  ["worktree", 2],
  ["merge", 2.5],
  ["conclusion", 2],
];

export interface ReplayStoryboard {
  templateId: ReplayStoryTemplateId;
  model: ReplayCardModel;
  hero: ReplayStoryHero;
  cast: ReplayStoryCastMember[];
  beats: ReplayStoryBeat[];
  ship: ReplayStoryShip;
  /** Mission cut's own slice — empty (but present) for the other templates. */
  outline: ReplayStoryOutline;
  /** 1~2 lines that close the mission cut. Data-derived, never boilerplate. */
  conclusion: string[];
  scenes: ReplayStoryScene[];
}

export interface BuildReplayStoryboardOptions {
  maxBeats?: number;
  maxCast?: number;
  maxOutline?: number;
}

/**
 * The closing sentence(s).
 *
 * ★Derived, so it cannot lie. "의존성 순서대로" is only claimed when the outline
 * actually carries dependency edges; "완료" is only claimed when every task the
 * outline knows about is done. An in-flight mission closes on "진행 중" with the
 * counts that are true right now — which is exactly why an unfinished mission is
 * still allowed to produce a GIF.
 */
export function buildReplayStoryConclusion(
  outline: ReplayStoryOutline,
  ship: ReplayStoryShip,
): string[] {
  const merged = outline.mergeOrder.length;
  const tasksDone = ship.tasksDone;
  const tasks = ship.tasks;
  const allDone =
    tasksDone !== null && tasks !== null && tasks > 0 && tasksDone >= tasks;

  const countPart =
    tasksDone !== null && tasks !== null
      ? `태스크 ${tasksDone}/${tasks}`
      : tasks !== null
        ? `태스크 ${tasks}건`
        : null;
  const prPart =
    merged > 0
      ? `PR ${merged}건 머지`
      : ship.prs !== null && ship.prs > 0
        ? `PR ${ship.prs}건`
        : null;

  const first = [countPart, prPart].filter(Boolean).join(" · ");
  const second = allDone
    ? outline.hasDependencies
      ? "의존성 순서대로 실행·머지 완료"
      : "병렬로 실행·머지 완료"
    : outline.hasDependencies
      ? "의존성 순서대로 진행 중"
      : "진행 중";

  return first ? [first, second] : [second];
}

/**
 * The single entry point from a `RedactedReplay` to a drawable storyboard.
 *
 * Everything downstream (`planReplayStoryboardFrames`,
 * `drawReplayStoryboardFrame`) works off this model and never re-reads the
 * payload — so the redaction boundary is exactly one function wide.
 */
export function buildReplayStoryboard(
  redacted: RedactedReplay,
  templateId: ReplayStoryTemplateId = "story",
  options: BuildReplayStoryboardOptions = {},
): ReplayStoryboard {
  const root = asRecord(redacted.payload) ?? {};
  const model = buildReplayCardModel(redacted);
  const cast = buildReplayStoryCast(
    redacted,
    options.maxCast ?? REPLAY_STORY_MAX_CAST,
  );
  const beats = buildReplayStoryBeats(
    redacted,
    options.maxBeats ?? REPLAY_STORY_MAX_BEATS,
  );

  const outline = buildReplayStoryOutline(
    redacted,
    options.maxOutline ?? REPLAY_STORY_MAX_OUTLINE,
  );

  const source =
    templateId === "mission"
      ? MISSION_SCENE_SECONDS
      : templateId === "cast"
        ? CAST_SCENE_SECONDS
        : STORY_SCENE_SECONDS;
  const scenes: ReplayStoryScene[] = source.map(([kind, seconds], index) => ({
    kind,
    seconds,
    chapter: `${String(index + 1).padStart(2, "0")} · ${SCENE_CHAPTERS[kind]}`,
  }));

  const ship = buildShip(root);
  return {
    templateId,
    model,
    hero: buildHero(root, model, cast.length),
    cast,
    beats,
    ship,
    outline,
    conclusion: buildReplayStoryConclusion(outline, ship),
    scenes,
  };
}

export function replayStoryboardDurationSeconds(
  storyboard: ReplayStoryboard,
  scale = 1,
): number {
  return storyboard.scenes.reduce(
    (total, scene) => total + scene.seconds * scale,
    0,
  );
}

// ---------------------------------------------------------------------------
// Frame plan — pure, deterministic, unit-testable without a canvas.
// ---------------------------------------------------------------------------

export const REPLAY_STORY_FPS = 10;

export interface ReplayStoryFrameOptions {
  fps?: number;
  /** Shrinks every scene proportionally. Used by tests to keep encodes cheap. */
  durationScale?: number;
}

export interface ReplayStoryFrame {
  index: number;
  tSeconds: number;
  sceneIndex: number;
  scene: ReplayStorySceneKind;
  /** 0..1 within the current scene. */
  progress: number;
  /** 0..1 across the whole storyboard — drives the bottom rail. */
  overallProgress: number;
  /** Beat under the playhead during the "progress" scene, else null. */
  beatIndex: number | null;
  /** Spotlit cast member during the "cast" scene, else null. */
  castIndex: number | null;
  /** Outline row under the playhead during "breakdown", else null. */
  outlineIndex: number | null;
  /** PR under the playhead during "merge", else null. */
  mergeIndex: number | null;
}

function sliceIndex(progress: number, count: number): number | null {
  if (count <= 0) return null;
  return Math.min(count - 1, Math.max(0, Math.floor(progress * count)));
}

/** Expands a storyboard into one frame per tick: scene, in-scene progress, and which beat/cast member is live. */
export function planReplayStoryboardFrames(
  storyboard: ReplayStoryboard,
  options: ReplayStoryFrameOptions = {},
): ReplayStoryFrame[] {
  const fps = options.fps ?? REPLAY_STORY_FPS;
  const scale = options.durationScale ?? 1;
  const scenes = storyboard.scenes.map((scene) => ({
    ...scene,
    seconds: Math.max(0, scene.seconds * scale),
  }));

  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
  const frameCount = Math.max(1, Math.round(totalSeconds * fps));

  const frames: ReplayStoryFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const tSeconds = index / fps;

    // Find the scene under the playhead. Clamps to the last scene so a
    // rounding overshoot at the tail can never fall off the storyboard.
    let sceneIndex = scenes.length - 1;
    let sceneStart = 0;
    let elapsed = 0;
    for (let i = 0; i < scenes.length; i += 1) {
      const end = elapsed + scenes[i].seconds;
      if (tSeconds < end || i === scenes.length - 1) {
        sceneIndex = i;
        sceneStart = elapsed;
        break;
      }
      elapsed = end;
    }

    const scene = scenes[sceneIndex];
    const progress =
      scene.seconds > 0
        ? Math.min(1, Math.max(0, (tSeconds - sceneStart) / scene.seconds))
        : 1;

    frames.push({
      index,
      tSeconds,
      sceneIndex,
      scene: scene.kind,
      progress,
      overallProgress:
        totalSeconds > 0 ? Math.min(1, tSeconds / totalSeconds) : 1,
      beatIndex:
        scene.kind === "progress"
          ? sliceIndex(progress, storyboard.beats.length)
          : null,
      castIndex:
        scene.kind === "cast"
          ? sliceIndex(progress, storyboard.cast.length)
          : null,
      outlineIndex:
        scene.kind === "breakdown"
          ? sliceIndex(progress, storyboard.outline.tasks.length)
          : null,
      mergeIndex:
        scene.kind === "merge"
          ? sliceIndex(progress, storyboard.outline.mergeOrder.length)
          : null,
    });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Drawing — same minimal duck-typed 2D context as `card.ts`, so the whole
// storyboard renders against a plain object in Node (no jsdom, no native
// canvas package). Rect + text only: no gradients, no images, no roundRect.
// ---------------------------------------------------------------------------

const PADDING = 64;
const CONTENT_WIDTH = REPLAY_STORY_WIDTH - PADDING * 2;
const DIVIDER_Y = 508;
const FOOTER_Y = 552;
const RAIL_Y = 486;

function setFont(
  ctx: ReplayCardDrawContext,
  weight: number,
  size: number,
): void {
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif`;
}

function laneColor(lane: string | null, theme: ReplayStoryTheme): string {
  switch (lane) {
    case "agent":
      return theme.laneAgent;
    case "orchestrator":
      return theme.laneOrchestrator;
    case "human":
      return theme.laneHuman;
    case "system":
      return theme.laneSystem;
    default:
      return theme.accentAlt;
  }
}

/** Chip text for one cast member: "claude · sonnet-5" / "claude" / the ref itself. */
export function formatCastChip(member: ReplayStoryCastMember): string {
  const parts = [member.vendor, member.model].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : "model unpinned";
}

/**
 * Draws one storyboard frame. Pure function of
 * (ctx, storyboard, frame, theme) — identical input, identical call sequence.
 */
export function drawReplayStoryboardFrame(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme = REPLAY_STORY_THEME,
): void {
  drawChrome(ctx, storyboard, frame, theme);

  switch (frame.scene) {
    case "headline":
      drawHeadlineScene(ctx, storyboard, frame, theme);
      break;
    case "cast":
      drawCastScene(ctx, storyboard, frame, theme);
      break;
    case "progress":
      drawProgressScene(ctx, storyboard, frame, theme);
      break;
    case "ship":
      drawShipScene(ctx, storyboard, frame, theme);
      break;
    case "stamp":
      drawStampScene(ctx, storyboard, frame, theme);
      break;
    case "breakdown":
      drawBreakdownScene(ctx, storyboard, frame, theme);
      break;
    case "worktree":
      drawWorktreeScene(ctx, storyboard, frame, theme);
      break;
    case "merge":
      drawMergeScene(ctx, storyboard, frame, theme);
      break;
    case "conclusion":
      drawConclusionScene(ctx, storyboard, frame, theme);
      break;
  }

  drawFooter(ctx, storyboard, theme);
}

function drawChrome(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, REPLAY_STORY_WIDTH, REPLAY_STORY_HEIGHT);

  ctx.fillStyle = theme.brand;
  ctx.fillRect(0, 0, REPLAY_STORY_WIDTH, 6);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  setFont(ctx, 600, 20);
  ctx.fillStyle = theme.subtitle;
  ctx.fillText(storyboard.model.eyebrow, PADDING, 92);

  // The mark — small, top-right, on every single frame. A cropped screenshot
  // of any moment still says where it came from.
  ctx.textAlign = "right";
  setFont(ctx, 700, 16);
  ctx.fillStyle = theme.brand;
  ctx.fillText(REPLAY_STORY_MARK, REPLAY_STORY_WIDTH - PADDING, 92);
  ctx.textAlign = "left";

  const scene = storyboard.scenes[frame.sceneIndex];
  if (scene) {
    setFont(ctx, 700, 18);
    ctx.fillStyle = theme.accent;
    ctx.fillText(scene.chapter, PADDING, 148);
  }

  const heading = SCENE_HEADINGS[frame.scene];
  if (heading) {
    setFont(ctx, 600, 22);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText(heading, PADDING, 190);
  }

  // Bottom rail — storyboard position. Makes a still frame read as "part of
  // a sequence" rather than a lone stat card.
  ctx.fillStyle = theme.divider;
  ctx.fillRect(PADDING, RAIL_Y, CONTENT_WIDTH, 4);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(
    PADDING,
    RAIL_Y,
    Math.max(2, Math.round(CONTENT_WIDTH * frame.overallProgress)),
    4,
  );
}

function drawFooter(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  theme: ReplayStoryTheme,
): void {
  ctx.fillStyle = theme.divider;
  ctx.fillRect(PADDING, DIVIDER_Y, CONTENT_WIDTH, 1);

  setFont(ctx, 500, 20);
  ctx.fillStyle = theme.footer;
  ctx.textAlign = "left";
  ctx.fillText(
    storyboard.model.castLabel ?? "Marblo Mission Replay",
    PADDING,
    FOOTER_Y,
  );

  ctx.textAlign = "right";
  ctx.fillStyle = theme.brand;
  ctx.fillText(
    storyboard.model.creditLabel,
    REPLAY_STORY_WIDTH - PADDING,
    FOOTER_Y,
  );
  ctx.textAlign = "left";
}

function drawHeadlineScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  setFont(ctx, 700, 52);
  ctx.fillStyle = theme.headline;
  const lines = wrapLines(ctx, storyboard.model.goal, CONTENT_WIDTH, 2);
  let y = 250;
  for (const line of lines) {
    ctx.fillText(line, PADDING, y);
    y += 62;
  }

  // Hero stat lands a beat after the goal — the eye reads the goal, then the
  // number that makes it interesting.
  if (frame.progress >= 0.25) {
    setFont(ctx, 700, 32);
    ctx.fillStyle = theme.accent;
    ctx.fillText(storyboard.hero.line, PADDING, y + 34);
  }

  const metaParts = [
    storyboard.model.templateLabel,
    storyboard.model.durationLabel,
  ].filter((part): part is string => Boolean(part));
  if (metaParts.length > 0) {
    setFont(ctx, 500, 22);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText(metaParts.join(" · "), PADDING, y + 84);
  }
}

function drawCastScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const { cast } = storyboard;

  if (cast.length === 0) {
    // No cast survived redaction — still say the interesting thing.
    setFont(ctx, 700, 44);
    ctx.fillStyle = theme.accent;
    ctx.fillText(storyboard.hero.line, PADDING, 300);
    return;
  }

  const rowHeight = 64;
  const top = 256;
  // In the montage template one member is spotlit at a time; in the story
  // template the roster builds up row by row.
  const spotlight = storyboard.templateId === "cast" ? frame.castIndex : null;

  for (let i = 0; i < cast.length; i += 1) {
    const revealAt = (i / cast.length) * 0.6;
    if (spotlight === null && frame.progress < revealAt) continue;

    const member = cast[i];
    const rowY = top + i * rowHeight;
    const isSpotlit = spotlight === i;

    if (isSpotlit) {
      ctx.fillStyle = theme.surface;
      ctx.fillRect(PADDING - 16, rowY - 34, CONTENT_WIDTH + 32, rowHeight - 8);
    }

    ctx.fillStyle = isSpotlit ? theme.accent : theme.laneAgent;
    ctx.fillRect(PADDING, rowY - 28, 5, 36);

    setFont(ctx, 700, 28);
    ctx.fillStyle = isSpotlit ? theme.headline : theme.statValue;
    ctx.fillText(member.ref, PADDING + 22, rowY);

    setFont(ctx, 500, 20);
    ctx.fillStyle = isSpotlit ? theme.accent : theme.subtitle;
    ctx.fillText(formatCastChip(member), PADDING + 240, rowY);

    if (member.tasksCompleted !== null) {
      ctx.textAlign = "right";
      setFont(ctx, 600, 20);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText(
        `${member.tasksCompleted} ${member.tasksCompleted === 1 ? "task" : "tasks"}`,
        REPLAY_STORY_WIDTH - PADDING,
        rowY,
      );
      ctx.textAlign = "left";
    }
  }
}

function drawProgressScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  // Rails — one per agent (or per beat lane when the cast is gone), each
  // labelled so the bars read as *named agents* rather than anonymous
  // progress. Their fills are staggered so several are visibly mid-flight at
  // the same instant: that simultaneity is the whole claim.
  const rails: Array<{ label: string; lane: string | null }> =
    storyboard.cast.length > 0
      ? storyboard.cast.map((member) => ({ label: member.ref, lane: "agent" }))
      : dedupeLanes(storyboard.beats).map((lane) => ({
          label: lane ?? "lane",
          lane,
        }));
  const railCount = Math.min(REPLAY_STORY_MAX_CAST, rails.length);
  const railTop = 244;
  const railLeft = PADDING + 140;
  const railWidth = REPLAY_STORY_WIDTH - PADDING - railLeft;

  for (let i = 0; i < railCount; i += 1) {
    const y = railTop + i * 28;

    setFont(ctx, 600, 18);
    ctx.fillStyle = theme.statLabel;
    ctx.fillText(rails[i].label, PADDING, y + 8);

    ctx.fillStyle = theme.divider;
    ctx.fillRect(railLeft, y, railWidth, 6);

    const fill = Math.min(1, Math.max(0, frame.progress * 1.35 - i * 0.12));
    if (fill > 0) {
      ctx.fillStyle = laneColor(rails[i].lane, theme);
      ctx.fillRect(railLeft, y, Math.round(railWidth * fill), 6);
    }
  }

  const beat =
    frame.beatIndex !== null ? storyboard.beats[frame.beatIndex] : undefined;

  setFont(ctx, 700, 38);
  ctx.fillStyle = theme.headline;
  const beatLines = wrapLines(
    ctx,
    beat?.title ?? "Agents in flight",
    CONTENT_WIDTH,
    2,
  );
  // ★Anchored from the bottom, not stacked after the rails: the rail count
  // (up to REPLAY_STORY_MAX_CAST) and the wrap (1–2 lines) both vary, and
  // stacking downward pushed a 2-line title under a 4-rail mission straight
  // through the divider into the footer.
  const BEAT_BLOCK_BOTTOM = 436;
  const BEAT_LINE_HEIGHT = 46;
  let y = BEAT_BLOCK_BOTTOM - (beatLines.length - 1) * BEAT_LINE_HEIGHT;
  for (const line of beatLines) {
    ctx.fillText(line, PADDING, y);
    y += BEAT_LINE_HEIGHT;
  }

  if (beat?.lane) {
    setFont(ctx, 600, 18);
    ctx.fillStyle = laneColor(beat.lane, theme);
    ctx.fillText(beat.lane.toUpperCase(), PADDING, BEAT_BLOCK_BOTTOM + 34);
  }

  if (storyboard.beats.length > 0 && frame.beatIndex !== null) {
    ctx.textAlign = "right";
    setFont(ctx, 600, 18);
    ctx.fillStyle = theme.statLabel;
    ctx.fillText(
      `${frame.beatIndex + 1} / ${storyboard.beats.length}`,
      REPLAY_STORY_WIDTH - PADDING,
      190,
    );
    ctx.textAlign = "left";
  }
}

function dedupeLanes(beats: ReplayStoryBeat[]): Array<string | null> {
  const seen = new Set<string>();
  const lanes: Array<string | null> = [];
  for (const beat of beats) {
    const key = beat.lane ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    lanes.push(beat.lane);
  }
  return lanes.length > 0 ? lanes : [null];
}

function drawShipScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const { ship } = storyboard;

  setFont(ctx, 700, 54);
  ctx.fillStyle = theme.headline;
  ctx.fillText(
    ship.prs !== null && ship.prs > 0 ? "MERGED" : "DONE",
    PADDING,
    250,
  );

  if (ship.progressLabel) {
    setFont(ctx, 500, 24);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText(ship.progressLabel, PADDING, 292);
  }

  // ★Safety metrics only — counts, never diff bodies. A viewer learns the
  // change's size, never its content.
  if (ship.metrics.length > 0 && frame.progress >= 0.2) {
    const columnWidth = CONTENT_WIDTH / ship.metrics.length;
    ctx.textAlign = "center";
    for (let i = 0; i < ship.metrics.length; i += 1) {
      const metric = ship.metrics[i];
      const center = PADDING + columnWidth * i + columnWidth / 2;

      setFont(ctx, 700, 52);
      ctx.fillStyle = theme.accentAlt;
      ctx.fillText(metric.value, center, 408);

      setFont(ctx, 500, 18);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText(metric.label.toUpperCase(), center, 438);
    }
    ctx.textAlign = "left";
  }
}

// ---------------------------------------------------------------------------
// Mission cut scenes. Everything drawn here comes from `storyboard.outline` —
// curated titles, integers, and refs. No free text can reach these frames.
// ---------------------------------------------------------------------------

/** "#831" — the only shape a PR takes in an exported frame. */
export function formatPrChip(prNumber: number | null): string | null {
  return prNumber === null ? null : `#${prNumber}`;
}

function drawBreakdownScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const rows = storyboard.outline.tasks;

  if (rows.length === 0) {
    setFont(ctx, 700, 40);
    ctx.fillStyle = theme.headline;
    ctx.fillText(storyboard.model.goal, PADDING, 300);
    setFont(ctx, 500, 22);
    ctx.fillStyle = theme.subtitle;
    ctx.fillText("태스크 분해 기록 없음", PADDING, 348);
    return;
  }

  const rowHeight = 56;
  const top = 254;
  for (let i = 0; i < rows.length; i += 1) {
    // Rows land one after another — the viewer sees the mission being cut up,
    // not a finished list fading in.
    const revealAt = (i / rows.length) * 0.7;
    if (frame.progress < revealAt) continue;

    const row = rows[i];
    const y = top + i * rowHeight;
    const live = frame.outlineIndex === i;

    if (live) {
      ctx.fillStyle = theme.surface;
      ctx.fillRect(PADDING - 16, y - 32, CONTENT_WIDTH + 32, rowHeight - 10);
    }

    ctx.fillStyle = row.done ? theme.accent : theme.laneSystem;
    ctx.fillRect(PADDING, y - 26, 5, 32);

    setFont(ctx, 700, 26);
    ctx.fillStyle = theme.accent;
    ctx.fillText(row.ref, PADDING + 20, y);

    // The title is the payload. It gets the width, and it wraps to one line
    // only — a breakdown frame that turns into a paragraph stops being one.
    setFont(ctx, 600, 26);
    ctx.fillStyle = live ? theme.headline : theme.statValue;
    const chip = formatPrChip(row.prNumber);
    const chipWidth = chip ? 96 : 0;
    const titleWidth = CONTENT_WIDTH - 64 - chipWidth;
    const [line] = wrapLines(ctx, row.title || "(제목 없음)", titleWidth, 1);
    ctx.fillText(line ?? "", PADDING + 64, y);

    if (chip) {
      ctx.textAlign = "right";
      setFont(ctx, 700, 22);
      ctx.fillStyle = row.done ? theme.accentAlt : theme.statLabel;
      ctx.fillText(chip, REPLAY_STORY_WIDTH - PADDING, y);
      ctx.textAlign = "left";
    }

    if (row.dependsOn.length > 0) {
      setFont(ctx, 600, 16);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText(`← ${row.dependsOn.join(", ")}`, PADDING + 64, y + 20);
    }
  }

  if (storyboard.outline.truncated > 0) {
    // ★Pinned to the heading line, not stacked under the last row: a full
    // roster (REPLAY_STORY_MAX_OUTLINE rows, each possibly with a dependency
    // line) already reaches the divider, and one more line below it would
    // print straight through the footer.
    ctx.textAlign = "right";
    setFont(ctx, 500, 18);
    ctx.fillStyle = theme.statLabel;
    ctx.fillText(
      `+${storyboard.outline.truncated} more`,
      REPLAY_STORY_WIDTH - PADDING,
      190,
    );
    ctx.textAlign = "left";
  }
}

/**
 * 워크트리별 작업 → 오케스트레이터 머지.
 *
 * One rail per outline row (that is what a worktree *is* here: one ticket, one
 * isolated tree), all of them converging into a single merge box. The claim the
 * frame makes — parallel trees, one merge — is the orchestrator's whole job.
 */
function drawWorktreeScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const rows = storyboard.outline.tasks;
  const railCount = Math.max(
    1,
    Math.min(REPLAY_STORY_MAX_OUTLINE, rows.length),
  );
  const railTop = 252;
  const railLeft = PADDING + 56;
  const mergeX = REPLAY_STORY_WIDTH - PADDING - 168;
  const railWidth = Math.max(40, mergeX - railLeft - 24);

  for (let i = 0; i < railCount; i += 1) {
    const y = railTop + i * 34;
    const row = rows[i];

    setFont(ctx, 700, 20);
    ctx.fillStyle = theme.accent;
    ctx.fillText(row?.ref ?? String.fromCharCode(65 + i), PADDING, y + 8);

    ctx.fillStyle = theme.divider;
    ctx.fillRect(railLeft, y, railWidth, 6);

    // Staggered so several trees are visibly mid-flight in the same instant.
    const fill = Math.min(1, Math.max(0, frame.progress * 1.5 - i * 0.1));
    if (fill > 0) {
      ctx.fillStyle = row?.done === false ? theme.laneSystem : theme.laneAgent;
      ctx.fillRect(railLeft, y, Math.round(railWidth * fill), 6);
    }
  }

  const boxTop = railTop - 22;
  const boxBottom = railTop + railCount * 34 - 8;
  if (frame.progress >= 0.55) {
    ctx.fillStyle = theme.surface;
    ctx.fillRect(mergeX, boxTop, 168, Math.max(48, boxBottom - boxTop));
    ctx.fillStyle = theme.laneOrchestrator;
    ctx.fillRect(mergeX, boxTop, 4, Math.max(48, boxBottom - boxTop));

    setFont(ctx, 700, 22);
    ctx.fillStyle = theme.headline;
    ctx.fillText("오케 머지", mergeX + 20, boxTop + 40);
  }

  setFont(ctx, 500, 22);
  ctx.fillStyle = theme.subtitle;
  ctx.fillText(
    `워크트리 ${railCount}개 · 격리 작업 후 머지`,
    PADDING,
    boxBottom + 52,
  );
}

/** PR #830 → #831 → #832, revealed one at a time, in dependency order. */
function drawMergeScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const prs = storyboard.outline.mergeOrder;

  if (prs.length === 0) {
    setFont(ctx, 700, 44);
    ctx.fillStyle = theme.headline;
    ctx.fillText(
      storyboard.ship.prs !== null && storyboard.ship.prs > 0
        ? "MERGED"
        : "머지된 PR 없음",
      PADDING,
      300,
    );
    return;
  }

  const chipWidth = Math.min(
    200,
    Math.floor((CONTENT_WIDTH - (prs.length - 1) * 24) / prs.length),
  );
  const chipHeight = 84;
  const chipTop = 268;

  for (let i = 0; i < prs.length; i += 1) {
    const revealed = frame.mergeIndex === null || i <= frame.mergeIndex;
    if (!revealed) continue;

    const x = PADDING + i * (chipWidth + 24);
    const live = frame.mergeIndex === i;

    ctx.fillStyle = theme.surface;
    ctx.fillRect(x, chipTop, chipWidth, chipHeight);
    ctx.fillStyle = live ? theme.accent : theme.laneAgent;
    ctx.fillRect(x, chipTop, chipWidth, 4);

    ctx.textAlign = "center";
    setFont(ctx, 700, 34);
    ctx.fillStyle = live ? theme.headline : theme.statValue;
    ctx.fillText(`#${prs[i]}`, x + chipWidth / 2, chipTop + 54);
    ctx.textAlign = "left";

    // The arrow between chips is the dependency claim made visual.
    if (i > 0) {
      setFont(ctx, 700, 24);
      ctx.fillStyle = theme.statLabel;
      ctx.fillText("→", x - 20, chipTop + 54);
    }
  }

  setFont(ctx, 600, 24);
  ctx.fillStyle = theme.accent;
  ctx.fillText(
    storyboard.outline.hasDependencies
      ? "의존성 순서대로 실행 → 머지"
      : "병렬 실행 → 머지",
    PADDING,
    chipTop + chipHeight + 62,
  );
}

/** The 1~2 line close. Bottom-anchored so one or two lines both sit right. */
function drawConclusionScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  setFont(ctx, 700, 44);
  ctx.fillStyle = theme.headline;
  const goalLines = wrapLines(ctx, storyboard.model.goal, CONTENT_WIDTH, 2);
  let y = 258;
  for (const line of goalLines) {
    ctx.fillText(line, PADDING, y);
    y += 54;
  }

  if (frame.progress >= 0.15) {
    const lines = storyboard.conclusion;
    let cy = y + 34;
    for (let i = 0; i < lines.length; i += 1) {
      setFont(ctx, i === 0 ? 700 : 600, i === 0 ? 34 : 28);
      ctx.fillStyle = i === 0 ? theme.accent : theme.subtitle;
      ctx.fillText(lines[i], PADDING, cy);
      cy += 44;
    }
  }

  ctx.textAlign = "right";
  setFont(ctx, 700, 18);
  ctx.fillStyle = theme.brand;
  ctx.fillText(REPLAY_STORY_MARK, REPLAY_STORY_WIDTH - PADDING, 466);
  ctx.textAlign = "left";
}

function drawStampScene(
  ctx: ReplayCardDrawContext,
  storyboard: ReplayStoryboard,
  frame: ReplayStoryFrame,
  theme: ReplayStoryTheme,
): void {
  const boxLeft = PADDING + 120;
  const boxRight = REPLAY_STORY_WIDTH - PADDING - 120;
  const boxTop = 214;
  const boxBottom = 428;
  const boxWidth = boxRight - boxLeft;

  if (frame.progress >= 0.12) {
    // Stamp frame drawn as four edges — fillRect only, so this stays
    // renderable against the duck-typed test context.
    ctx.fillStyle = theme.accent;
    ctx.fillRect(boxLeft, boxTop, boxWidth, 3);
    ctx.fillRect(boxLeft, boxBottom, boxWidth, 3);
    ctx.fillRect(boxLeft, boxTop, 3, boxBottom - boxTop);
    ctx.fillRect(boxRight - 3, boxTop, 3, boxBottom - boxTop);
  }

  ctx.textAlign = "center";
  const center = REPLAY_STORY_WIDTH / 2;

  setFont(ctx, 700, 54);
  ctx.fillStyle = theme.headline;
  ctx.fillText("MISSION COMPLETE", center, 306);

  setFont(ctx, 700, 26);
  ctx.fillStyle = theme.accent;
  ctx.fillText(storyboard.hero.line, center, 352);

  setFont(ctx, 600, 18);
  ctx.fillStyle = theme.statLabel;
  ctx.fillText(REPLAY_STORY_MARK, center, 396);

  ctx.textAlign = "left";
}
