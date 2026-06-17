/**
 * Antigravity (agy) token-usage extraction.
 *
 * Unlike claude/codex/gemini, agy persists no plaintext usage — token counts
 * live only inside protobuf blobs in its conversation store. The current
 * format is SQLite (`~/.gemini/antigravity-cli/conversations/<UUID>.db`); the
 * legacy format is a flat protobuf file (`<UUID>.pb`). agy reuses the user's
 * own ~/.gemini (shared Google account), so per-agent attribution MUST go
 * through agentId → conversationUUID (marblo-agy-labels.json) and read only
 * that conversation's store.
 *
 * Reverse-engineered against agy CLI (gemini-3-flash), conversation store
 * schema v1:
 *   - `gen_metadata(idx, data, size)` — one protobuf blob per LLM generation
 *     (per turn). NOT cumulative; rows are summed.
 *   - The per-generation usage block is a submessage with fields
 *       {2: promptTokenCount, 3: candidatesTokenCount (incl. thoughts),
 *        9: thoughtsTokenCount, 10: responseTokenCount}  where 3 == 9 + 10.
 *     It appears twice (a mirror copy) with identical values — we take one.
 *   - Model id is a string field like "gemini-3-flash-…".
 *
 * Because the protobuf schema is private and shifts between agy versions, we
 * locate the usage block by SIGNATURE (the {2,3,9,10} quadruple with
 * 3 == 9 + 10) rather than a hardcoded field path — robust to wrapper changes.
 * No separate cached/cache-write counts are exposed, so those map to 0.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const AGY_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli");

/**
 * Resolve an agent's agy conversation UUID from marblo-agy-labels.json
 * (written by saveAgyConversationLabel). agy shares the user's ~/.gemini, so
 * this mapping is the ONLY safe attribution path: agentId → conversationUUID.
 * Read directly here (not via agent-config) to keep all agy logic self-contained.
 */
export function getAgyConversationUuid(agentId: string): string | null {
  try {
    const labels = JSON.parse(
      fs.readFileSync(path.join(AGY_DIR, "marblo-agy-labels.json"), "utf-8"),
    ) as Record<string, { conversationUuid?: string }>;
    return labels[agentId]?.conversationUuid ?? null;
  } catch {
    return null;
  }
}

export interface AgyStore {
  path: string;
  /** "db" = current SQLite format (full token capture); "pb" = legacy flat
   * protobuf (not decoded — caller marks the session "limited"). */
  format: "db" | "pb";
}

/**
 * Locate the conversation store for an agent, preferring the current `.db`
 * format over the legacy `.pb`. Returns null until the file exists (agy
 * writes it after the first turn) or if the agent has no mapped conversation.
 */
export function resolveAgyStore(agentId: string): AgyStore | null {
  const uuid = getAgyConversationUuid(agentId);
  if (!uuid) return null;
  const db = path.join(AGY_DIR, "conversations", `${uuid}.db`);
  if (fs.existsSync(db)) return { path: db, format: "db" };
  const pb = path.join(AGY_DIR, "conversations", `${uuid}.pb`);
  if (fs.existsSync(pb)) return { path: pb, format: "pb" };
  return null;
}

export interface AgyUsage {
  /** promptTokenCount — billable input (cache not separately reported). */
  input: number;
  /** candidatesTokenCount — billable output, reasoning/thoughts included. */
  output: number;
  /** Model id (e.g. "gemini-3-flash-…") or null if not found in the blob. */
  model: string | null;
}

interface DecodedField {
  path: string;
  kind: "varint" | "str" | "bytes";
  value: number | string;
}

/**
 * Read a base-128 varint. Uses multiplication (not <<) so values above 2^31
 * don't get truncated by JS 32-bit bitwise ops; values above 2^53 lose
 * precision but those are never token fields.
 */
function readVarint(b: Uint8Array, i: number): [number, number] {
  let result = 0;
  let shift = 1; // 2 ** (7 * k)
  for (;;) {
    const x = b[i];
    i++;
    result += (x & 0x7f) * shift;
    if ((x & 0x80) === 0) break;
    shift *= 128;
  }
  return [result, i];
}

/**
 * `protoc --decode_raw` equivalent: walk a protobuf message, recursing into
 * length-delimited fields that parse as sub-messages and otherwise treating
 * them as strings/bytes. Returns a flat list of leaf fields with dotted paths.
 */
function decodeProtobufRaw(
  buf: Uint8Array,
  depth = 0,
  out: DecodedField[] = [],
  path = "",
): DecodedField[] {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    let key: number;
    try {
      [key, i] = readVarint(buf, i);
    } catch {
      break;
    }
    const field = Math.floor(key / 8);
    const wt = key & 7;
    if (wt === 0) {
      let v: number;
      try {
        [v, i] = readVarint(buf, i);
      } catch {
        break;
      }
      out.push({ path: `${path}${field}`, kind: "varint", value: v });
    } else if (wt === 2) {
      let len: number;
      try {
        [len, i] = readVarint(buf, i);
      } catch {
        break;
      }
      if (len < 0 || i + len > n) break;
      const sub = buf.subarray(i, i + len);
      i += len;
      let consumed = false;
      if (len > 0 && depth < 7) {
        const child: DecodedField[] = [];
        try {
          decodeProtobufRaw(sub, depth + 1, child, `${path}${field}.`);
          if (child.length > 0) {
            out.push(...child);
            consumed = true;
          }
        } catch {
          consumed = false;
        }
      }
      if (!consumed) {
        const txt = tryUtf8(sub);
        out.push({
          path: `${path}${field}`,
          kind: txt !== null ? "str" : "bytes",
          value: txt !== null ? txt : `<${len}b>`,
        });
      }
    } else if (wt === 5) {
      i += 4; // fixed32
    } else if (wt === 1) {
      i += 8; // fixed64
    } else {
      break; // wiretype 3/4 (groups) / invalid — bail
    }
  }
  return out;
}

function tryUtf8(b: Uint8Array): string | null {
  try {
    const s = Buffer.from(b).toString("utf-8");
    // Printable iff round-trips and has no control chars (except whitespace).
    if (Buffer.from(s, "utf-8").length !== b.length) return null;
    // eslint-disable-next-line no-control-regex -- Protobuf text extraction must reject raw control bytes.
    if (/[\x00-\x08\x0e-\x1f]/.test(s)) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Extract token usage from a single `gen_metadata` protobuf blob. Returns null
 * when the blob carries no usage block (e.g. a trailing summary row).
 */
export function extractGenUsage(blob: Uint8Array): AgyUsage | null {
  const fields = decodeProtobufRaw(blob);

  // Group varints by their immediate parent path so we can match the usage
  // signature {2,3,9,10}.
  const groups = new Map<string, Map<number, number>>();
  for (const f of fields) {
    if (f.kind !== "varint") continue;
    const dot = f.path.lastIndexOf(".");
    if (dot < 0) continue;
    const parent = f.path.slice(0, dot);
    const last = Number(f.path.slice(dot + 1));
    if (!Number.isInteger(last)) continue;
    let g = groups.get(parent);
    if (!g) {
      g = new Map();
      groups.set(parent, g);
    }
    g.set(last, f.value as number);
  }

  let usage: AgyUsage | null = null;
  for (const g of groups.values()) {
    const f2 = g.get(2);
    const f3 = g.get(3);
    const f9 = g.get(9);
    const f10 = g.get(10);
    if (
      f2 !== undefined &&
      f3 !== undefined &&
      f9 !== undefined &&
      f10 !== undefined &&
      f3 === f9 + f10 &&
      f2 > 0 &&
      f3 > 0
    ) {
      // First match wins — the block is mirrored with identical values, so we
      // must not sum the copies.
      usage = { input: f2, output: f3, model: null };
      break;
    }
  }
  if (!usage) return null;

  // Model id: a bare "gemini-…"-style token (no spaces); prefer it over the
  // human display name ("Gemini 3.5 Flash (Medium)").
  for (const f of fields) {
    if (f.kind !== "str") continue;
    const s = f.value as string;
    if (/^gemini[-\w.]+$/i.test(s)) {
      usage.model = s;
      break;
    }
  }
  return usage;
}

export interface AgyDelta {
  input: number;
  output: number;
  model: string | null;
  /** Highest gen_metadata idx seen — the incremental watermark. */
  maxIdx: number;
}

/**
 * Sum usage from `gen_metadata` rows with idx > sinceIdx in a `.db` store.
 * Shells out to the system `sqlite3` (handles the WAL; no native dep, no
 * write). Returns a zero delta with maxIdx=sinceIdx on any failure — agy
 * format drift must never crash the tracker.
 */
export function readAgyDbDelta(dbPath: string, sinceIdx: number): AgyDelta {
  const result: AgyDelta = {
    input: 0,
    output: 0,
    model: null,
    maxIdx: sinceIdx,
  };
  let rows: string;
  try {
    rows = execFileSync(
      "sqlite3",
      [
        dbPath,
        `select idx || ':' || hex(data) from gen_metadata where idx > ${Math.floor(
          sinceIdx,
        )} order by idx;`,
      ],
      { encoding: "utf-8", timeout: 5000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return result;
  }
  for (const line of rows.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const idx = Number(line.slice(0, sep));
    const hex = line.slice(sep + 1).trim();
    if (!Number.isInteger(idx) || !hex) continue;
    if (idx > result.maxIdx) result.maxIdx = idx;
    let blob: Buffer;
    try {
      blob = Buffer.from(hex, "hex");
    } catch {
      continue;
    }
    const usage = extractGenUsage(blob);
    if (!usage) continue;
    result.input += usage.input;
    result.output += usage.output;
    if (usage.model) result.model = usage.model;
  }
  return result;
}
