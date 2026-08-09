/**
 * The probe payload — what "the same prefix" means, concretely.
 *
 * A cacheable prefix has to clear the vendor's minimum (1024 tokens for Opus /
 * Sonnet, 2048 for Haiku); below that, `cache_control` is silently ignored and
 * the probe would measure nothing while looking like it worked. So the filler is
 * sized well past that and is fully deterministic — no timestamps, no random —
 * because two calls in a lane must produce byte-identical bytes.
 *
 * The shape mirrors a real agent turn rather than a toy prompt: a tool block, a
 * long system block, then a short user message *after* the cache breakpoint.
 * That is the layout our workload actually has (99% input, #885 §3), and it is
 * the layout whose bytes a careless proxy would reorder.
 */

/** Deterministic filler. Same salt in, same bytes out, every time. */
export function buildFiller(salt: string, paragraphs: number): string {
  const lines: string[] = [];
  for (let i = 0; i < paragraphs; i += 1) {
    lines.push(
      `Section ${i} [${salt}]: The metering proxy relays request bytes without ` +
        `transforming them, because the vendor's prompt cache is keyed on the ` +
        `exact input prefix and a single altered byte forces a full re-prefill ` +
        `of every cached token in that prefix. This paragraph exists only to ` +
        `push the cacheable prefix past the vendor's minimum cacheable length ` +
        `so that the cache_control breakpoint is honoured rather than ignored.`,
    );
  }
  return lines.join("\n\n");
}

export interface ProbePayloadOptions {
  model: string;
  /** Distinguishes lanes so one lane cannot warm the other lane's cache. */
  salt: string;
  stream: boolean;
  maxTokens?: number;
  paragraphs?: number;
}

/**
 * Build the probe body and serialize it once.
 *
 * ★ Returns the Buffer, not the object: callers must send these exact bytes.
 * Re-stringifying the object per call would be a different (if equivalent)
 * byte sequence risk, which is the very failure mode under test.
 */
export function buildCacheProbeBody(options: ProbePayloadOptions): {
  bytes: Buffer;
  approxPrefixChars: number;
} {
  const paragraphs = options.paragraphs ?? 24;
  const filler = buildFiller(options.salt, paragraphs);

  const payload = {
    model: options.model,
    max_tokens: options.maxTokens ?? 16,
    stream: options.stream,
    system: [
      {
        type: "text",
        text: "You are a terse assistant used by an automated cache probe.",
      },
      {
        type: "text",
        text: filler,
        // ★ The breakpoint. Everything above it is the cacheable prefix.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: "Reply with exactly the word OK and nothing else.",
      },
    ],
  };

  return {
    bytes: Buffer.from(JSON.stringify(payload), "utf8"),
    approxPrefixChars: filler.length,
  };
}

/** Tool definition used by the G-P2 tool-loop probe. */
export const PROBE_TOOL = {
  name: "lookup_build_status",
  description:
    "Look up the build status for a named service. Call this before answering questions about builds.",
  input_schema: {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Service name, e.g. 'credit-proxy'",
      },
    },
    required: ["service"],
  },
} as const;

export interface ToolLoopPayloadOptions {
  model: string;
  salt: string;
  stream: boolean;
  maxTokens?: number;
  /** Full conversation so far, including tool_result turns. */
  messages: unknown[];
}

export function buildToolLoopBody(options: ToolLoopPayloadOptions): Buffer {
  const payload = {
    model: options.model,
    max_tokens: options.maxTokens ?? 512,
    stream: options.stream,
    tools: [PROBE_TOOL],
    system: [
      {
        type: "text",
        text:
          `You are a build assistant [${options.salt}]. When asked about a build, ` +
          `you must call lookup_build_status before answering, then answer in one sentence.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: options.messages,
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}
