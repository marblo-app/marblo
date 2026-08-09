/**
 * SSE framing, shared by the usage extractor and the message assembler.
 *
 * Both of them read the *same* relayed byte stream for different purposes, so
 * the framing lives in one place. The two hard requirements:
 *   - chunk boundaries fall anywhere, including mid-line and mid-UTF-8-sequence
 *     (a Korean character split across two TCP segments must not corrupt), and
 *   - a malformed event is skipped, never thrown. By the time we parse, the
 *     relay has already forwarded those bytes to the client; an exception here
 *     would fail an otherwise-successful request for an accounting reason.
 */

import { StringDecoder } from "node:string_decoder";

export class SseEventReader {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";

  /** Feed bytes; returns whatever complete `data:` events they finished. */
  push(chunk: Buffer | string): unknown[] {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (text.length === 0) return [];
    this.pending += text;

    const events: unknown[] = [];
    let newlineAt = this.pending.indexOf("\n");
    while (newlineAt !== -1) {
      const line = this.pending.slice(0, newlineAt);
      this.pending = this.pending.slice(newlineAt + 1);
      const event = parseLine(line);
      if (event !== undefined) events.push(event);
      newlineAt = this.pending.indexOf("\n");
    }
    return events;
  }

  /** Flush the decoder plus a trailing line that arrived without a newline. */
  finish(): unknown[] {
    const tail = this.decoder.end();
    if (tail.length > 0) this.pending += tail;
    if (this.pending.length === 0) return [];
    const line = this.pending;
    this.pending = "";
    const event = parseLine(line);
    return event === undefined ? [] : [event];
  }
}

/**
 * `event:` lines are ignored: every Anthropic payload carries its own `type`,
 * so the event name is redundant and trusting the payload keeps the two in sync.
 */
function parseLine(rawLine: string): unknown | undefined {
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (!line.startsWith("data:")) return undefined;
  const payload = line.slice("data:".length).trim();
  if (payload.length === 0 || payload === "[DONE]") return undefined;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}
