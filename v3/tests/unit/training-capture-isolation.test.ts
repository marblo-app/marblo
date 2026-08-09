/**
 * Training-data capture: row contract + the isolation invariant
 * (ticket IqcXHVbT0rXnHloXpV7n).
 *
 * The invariant is the point of the whole ticket: raw prompt/completion text
 * may reach the admin-scoped training store and NOTHING else. The always-on
 * telemetry path (electron/telemetry.ts → renderer logTelemetry → BigQuery
 * `events`) is 비식별 and must stay that way.
 *
 * That is a wiring property, not a runtime one, so it is tested as a wiring
 * property: the modules are read and their imports/identifiers asserted. A
 * future edit that hands a transcript to the telemetry path — the exact drift
 * that would leak code and PII into a de-identified table — fails here.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_CHARS,
  MAX_THINKING_CHARS,
  MAX_TOOL_CALLS,
  MAX_TOOL_IO_CHARS,
  buildTrainingSample,
  type TrainingCaptureMeta,
} from "../../electron/training-sample";
import type { TranscriptTurn } from "../../electron/session-transcripts";

const electronDir = join(__dirname, "..", "..", "electron");
const srcDir = join(__dirname, "..", "..", "src");
/**
 * Read a module with its comments removed. These modules document the boundary
 * they must not cross, so the prose legitimately names `logTelemetry` and
 * `marblo_telemetry` — matching against raw source would fail on the very
 * comments that explain the rule. The assertions below are about CODE.
 */
const read = (...parts: string[]): string =>
  readFileSync(join(...parts), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const meta: TrainingCaptureMeta = {
  agentId: "agent-1",
  source: "agent",
  projectId: "proj-1",
  taskId: "task-1",
  role: "backend",
  model: "claude",
  parentAgentId: null,
  sessionId: "sess-1",
  cwd: "/repo",
  appVersion: "3.1.0",
};

const turn = (overrides: Partial<TranscriptTurn> = {}): TranscriptTurn => ({
  turnKey: "t1",
  role: "assistant",
  text: "hello",
  thinking: "",
  toolCalls: [],
  toolResults: [],
  model: "claude-opus-5",
  timestamp: "2026-08-09T00:00:00.000Z",
  sessionId: null,
  parentKey: null,
  isSidechain: false,
  ...overrides,
});

describe("buildTrainingSample", () => {
  it("joins the sample to the board (taskId/agentId/project) and the run", () => {
    const s = buildTrainingSample(
      turn(),
      "claude",
      meta,
      "2026-08-09T01:00:00Z",
    );
    expect(s).toMatchObject({
      sampleId: "sess-1:t1",
      taskId: "task-1",
      agentId: "agent-1",
      projectId: "proj-1",
      role: "backend",
      harness: "claude",
      source: "agent",
      appVersion: "3.1.0",
    });
  });

  it("prefers the model the session file recorded over the launch guess", () => {
    const s = buildTrainingSample(turn(), "claude", meta, "now");
    expect(s.model).toBe("claude-opus-5");
    const unknown = buildTrainingSample(
      turn({ model: null }),
      "claude",
      meta,
      "now",
    );
    expect(unknown.model).toBe("claude");
  });

  it("caps huge text but records the TRUE length and flags truncation", () => {
    const long = "x".repeat(MAX_TEXT_CHARS + 1_000);
    const s = buildTrainingSample(turn({ text: long }), "claude", meta, "now");
    expect(s.text.length).toBe(MAX_TEXT_CHARS);
    expect(s.textChars).toBe(long.length);
    expect(s.truncated).toBe(true);
  });

  it("caps thinking separately from text", () => {
    const s = buildTrainingSample(
      turn({ thinking: "t".repeat(MAX_THINKING_CHARS + 10) }),
      "claude",
      meta,
      "now",
    );
    expect(s.thinking.length).toBe(MAX_THINKING_CHARS);
    expect(s.truncated).toBe(true);
  });

  it("previews tool IO rather than storing whole file dumps", () => {
    const s = buildTrainingSample(
      turn({
        toolCalls: [
          { name: "Read", input: "f".repeat(MAX_TOOL_IO_CHARS + 500) },
        ],
        toolResults: ["r".repeat(MAX_TOOL_IO_CHARS + 500)],
      }),
      "claude",
      meta,
      "now",
    );
    const calls = JSON.parse(s.toolCalls!) as { input: string }[];
    expect(calls[0].input.length).toBe(MAX_TOOL_IO_CHARS);
    const results = JSON.parse(s.toolResults!) as string[];
    expect(results[0].length).toBe(MAX_TOOL_IO_CHARS);
  });

  it("flags truncation when a turn exceeds the tool-call ceiling", () => {
    const many = Array.from({ length: MAX_TOOL_CALLS + 3 }, (_, i) => ({
      name: `T${i}`,
      input: null,
    }));
    const s = buildTrainingSample(
      turn({ toolCalls: many }),
      "claude",
      meta,
      "n",
    );
    expect(JSON.parse(s.toolCalls!)).toHaveLength(MAX_TOOL_CALLS);
    expect(s.truncated).toBe(true);
  });

  it("survives unserializable tool input instead of throwing at the agent", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const s = buildTrainingSample(
      turn({ toolCalls: [{ name: "Weird", input: circular }] }),
      "claude",
      meta,
      "now",
    );
    expect(JSON.parse(s.toolCalls!)).toEqual([{ name: "Weird", input: "" }]);
  });

  it("leaves toolCalls/toolResults null when the turn used no tools", () => {
    const s = buildTrainingSample(turn(), "claude", meta, "now");
    expect(s.toolCalls).toBeNull();
    expect(s.toolResults).toBeNull();
  });
});

describe("isolation from the de-identified telemetry path", () => {
  it("the telemetry modules never import the capture path", () => {
    for (const file of [
      read(electronDir, "telemetry.ts"),
      read(srcDir, "services", "telemetryService.ts"),
    ]) {
      expect(file).not.toMatch(
        /training-capture|training-sample|session-transcripts/,
      );
    }
  });

  it("the capture path never imports the telemetry path", () => {
    for (const file of [
      read(electronDir, "training-capture.ts"),
      read(electronDir, "training-sample.ts"),
      read(electronDir, "session-transcripts.ts"),
    ]) {
      expect(file).not.toMatch(/from "\.\/telemetry"/);
      expect(file).not.toMatch(/mainTelemetry|logTelemetry|sendTelemetry/);
    }
  });

  it("capture writes to its own BigQuery dataset, not marblo_telemetry", () => {
    const server = read(
      __dirname,
      "..",
      "..",
      "functions",
      "src",
      "trainingCapture.ts",
    );
    expect(server).toMatch(/TRAINING_DATASET = "marblo_training"/);
    expect(server).not.toMatch(/marblo_telemetry/);
  });

  it("raw transcript text never crosses the preload bridge", () => {
    // The renderer may read booleans and counts; if a `text`/`sample` field
    // ever appears on this bridge, transcripts would sit in the same process
    // as the de-identified telemetry queue.
    const preload = read(electronDir, "preload.ts");
    const trainingBlock = preload.slice(
      preload.indexOf("training: {"),
      preload.indexOf("training: {") + 600,
    );
    expect(trainingBlock).toContain("captureStatus");
    expect(trainingBlock).not.toMatch(/samples|transcript|\btext\b/);
  });

  it("the capture gate is fail-closed in code, not just by convention", () => {
    const capture = read(electronDir, "training-capture.ts");
    // Ingest and upload both consult captureEnabled(), which is only true on
    // an affirmative server verdict.
    expect(capture).toMatch(/if \(!captureEnabled\(\)\) return 0;/);
    expect(capture).toMatch(/if \(!captureEnabled\(\)\) return;/);
    expect(capture).toMatch(/return gate\?\.effective === true;/);
  });
});
