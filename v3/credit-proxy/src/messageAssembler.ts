/**
 * Reconstructs a complete assistant message from the SSE stream.
 *
 * The tool-loop gate (G-P2, §11) cannot be judged from usage alone — to send the
 * next turn we need the assistant's actual `tool_use` block, with its `id` and
 * its `input` reassembled from `input_json_delta` fragments. That reassembly is
 * also the sharpest test of the relay: if any chunk were dropped, reordered or
 * re-framed, the concatenated `partial_json` would not parse and the loop would
 * stall. A clean parse across the whole stream is direct evidence the SSE
 * passthrough is lossless.
 */

import { SseEventReader } from "./sse";
import { applyEvent } from "./usage";
import { emptyObservation, type ResponseObservation } from "./types";

export type ContentBlock = Record<string, unknown>;

export interface AssembledMessage {
  id: string | null;
  role: string;
  model: string | null;
  content: ContentBlock[];
  stopReason: string | null;
  observation: ResponseObservation;
  /** Blocks whose accumulated `partial_json` failed to parse — must be empty. */
  malformedToolInputs: number;
}

interface PendingBlock {
  block: ContentBlock;
  text: string;
  partialJson: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export class SseMessageAssembler {
  private readonly reader = new SseEventReader();
  private readonly observation = emptyObservation();
  private readonly blocks = new Map<number, PendingBlock>();
  private id: string | null = null;
  private role = "assistant";
  private model: string | null = null;
  private malformedToolInputs = 0;

  push(chunk: Buffer | string): void {
    for (const event of this.reader.push(chunk)) {
      this.consume(event);
    }
  }

  private consume(event: unknown): void {
    applyEvent(this.observation, event);

    const record = asRecord(event);
    if (!record) return;

    switch (record.type) {
      case "message_start": {
        const message = asRecord(record.message);
        if (!message) break;
        if (typeof message.id === "string") this.id = message.id;
        if (typeof message.role === "string") this.role = message.role;
        if (typeof message.model === "string") this.model = message.model;
        break;
      }
      case "content_block_start": {
        const index = typeof record.index === "number" ? record.index : -1;
        const block = asRecord(record.content_block);
        if (index < 0 || !block) break;
        this.blocks.set(index, {
          block: { ...block },
          text: typeof block.text === "string" ? block.text : "",
          partialJson: "",
        });
        break;
      }
      case "content_block_delta": {
        const index = typeof record.index === "number" ? record.index : -1;
        const pending = this.blocks.get(index);
        const delta = asRecord(record.delta);
        if (!pending || !delta) break;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          pending.text += delta.text;
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          pending.partialJson += delta.partial_json;
        } else if (
          delta.type === "thinking_delta" &&
          typeof delta.thinking === "string"
        ) {
          pending.text += delta.thinking;
        }
        break;
      }
      default:
        break;
    }
  }

  finish(): AssembledMessage {
    for (const event of this.reader.finish()) {
      this.consume(event);
    }

    const content: ContentBlock[] = [];
    for (const index of [...this.blocks.keys()].sort((a, b) => a - b)) {
      const pending = this.blocks.get(index);
      if (!pending) continue;
      const block = pending.block;

      if (block.type === "text") {
        block.text = pending.text;
      } else if (block.type === "thinking") {
        block.thinking = pending.text;
      } else if (block.type === "tool_use") {
        if (pending.partialJson.length === 0) {
          // A tool call with no arguments streams zero deltas; `{}` is correct.
          block.input = block.input ?? {};
        } else {
          try {
            block.input = JSON.parse(pending.partialJson) as unknown;
          } catch {
            this.malformedToolInputs += 1;
            block.input = {};
          }
        }
      }
      content.push(block);
    }

    return {
      id: this.id,
      role: this.role,
      model: this.model,
      content,
      stopReason: this.observation.stopReason,
      observation: this.observation,
      malformedToolInputs: this.malformedToolInputs,
    };
  }
}

/** Same shape, from a non-streaming response body. */
export function assembleFromJson(body: string): AssembledMessage {
  const observation = emptyObservation();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(body));
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      id: null,
      role: "assistant",
      model: null,
      content: [],
      stopReason: null,
      observation,
      malformedToolInputs: 0,
    };
  }

  const content: ContentBlock[] = Array.isArray(parsed.content)
    ? (parsed.content.filter((b) => asRecord(b) !== null) as ContentBlock[])
    : [];

  for (const block of content) {
    if (typeof block.type === "string") {
      observation.contentBlockTypes.push(block.type);
    }
  }
  applyEvent(observation, {
    type: "message_delta",
    delta: { stop_reason: parsed.stop_reason },
    usage: parsed.usage,
  });

  return {
    id: typeof parsed.id === "string" ? parsed.id : null,
    role: typeof parsed.role === "string" ? parsed.role : "assistant",
    model: typeof parsed.model === "string" ? parsed.model : null,
    content,
    stopReason: observation.stopReason,
    observation,
    malformedToolInputs: 0,
  };
}
