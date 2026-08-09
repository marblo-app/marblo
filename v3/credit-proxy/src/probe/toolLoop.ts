/**
 * ★ G-P2 — the tool-loop driver.
 *
 * A passthrough proxy that streams bytes correctly can still fail the thing we
 * actually sell: a multi-turn agent session. This driver runs the real loop —
 * model asks for a tool, we answer with a `tool_result`, the model continues —
 * and reports whether it terminated cleanly.
 *
 * It is shared by the live probe CLI and by the mock-upstream E2E test, so the
 * loop that runs without a key is the same code that will run with one.
 */

import { evaluateToolLoop, type ToolLoopResult } from "../gate";
import type { ContentBlock } from "../messageAssembler";
import type { ResponseObservation } from "../types";
import { callMessages } from "./client";
import { buildToolLoopBody } from "./payload";

export interface ToolLoopOptions {
  baseUrl: string;
  apiKey: string;
  direct: boolean;
  model: string;
  stream: boolean;
  maxTurns?: number;
  salt?: string;
}

export interface ToolLoopRun {
  result: ToolLoopResult;
  observations: ResponseObservation[];
  /** Set if any streamed tool_use input failed to reassemble — a relay defect. */
  malformedToolInputs: number;
  turns: Array<{
    status: number;
    stopReason: string | null;
    blockTypes: string[];
    toolNames: string[];
    ttfbMs: number;
  }>;
}

/** Canned tool backend. The point of the gate is the round-trip, not the answer. */
function answerTool(name: string, input: unknown): string {
  const service =
    typeof input === "object" && input !== null
      ? String((input as Record<string, unknown>).service ?? "unknown")
      : "unknown";
  return JSON.stringify({
    tool: name,
    service,
    status: "green",
    lastBuild: "2026-08-09T00:00:00Z",
  });
}

export async function driveToolLoop(
  options: ToolLoopOptions,
): Promise<ToolLoopRun> {
  const maxTurns = options.maxTurns ?? 6;
  const salt = options.salt ?? "marblo-l2-poc-toolloop";

  const messages: unknown[] = [
    {
      role: "user",
      content:
        "What is the build status of the credit-proxy service? Use your tool, then answer in one sentence.",
    },
  ];

  const observations: ResponseObservation[] = [];
  const turns: ToolLoopRun["turns"] = [];
  let malformedToolInputs = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const bodyBytes = buildToolLoopBody({
      model: options.model,
      salt,
      stream: options.stream,
      messages,
    });

    const call = await callMessages({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      direct: options.direct,
      bodyBytes,
      stream: options.stream,
    });

    if (call.status !== 200 || call.message === null) {
      throw new Error(
        `tool loop turn ${turn} failed: HTTP ${call.status} ${
          call.errorBody ?? ""
        }`,
      );
    }

    observations.push(call.observation);
    malformedToolInputs += call.message.malformedToolInputs;

    const content = call.message.content;
    const toolUses = content.filter(
      (block): block is ContentBlock => block.type === "tool_use",
    );

    turns.push({
      status: call.status,
      stopReason: call.message.stopReason,
      blockTypes: content.map((b) => String(b.type)),
      toolNames: toolUses.map((b) => String(b.name)),
      ttfbMs: call.ttfbMs,
    });

    messages.push({ role: "assistant", content });

    if (toolUses.length === 0) break;

    messages.push({
      role: "user",
      content: toolUses.map((block) => ({
        type: "tool_result",
        tool_use_id: String(block.id),
        content: answerTool(String(block.name), block.input),
      })),
    });
  }

  return {
    result: evaluateToolLoop({ observations, streamed: options.stream }),
    observations,
    malformedToolInputs,
    turns,
  };
}
