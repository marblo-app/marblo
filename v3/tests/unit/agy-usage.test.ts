import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { describe, expect, it } from "vitest";
import { extractGenUsage } from "../../electron/agy-usage";

// Real gen_metadata blobs captured from an antigravity .db conversation store
// (gemini-3-flash). Format: "idx:HEX" per line. gen[0]/gen[1] carry usage;
// gen[28] is the trailing summary row with no usage block.
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "agy-gen-metadata.txt",
);

function loadBlobs(): Map<number, Buffer> {
  const map = new Map<number, Buffer>();
  for (const line of readFileSync(fixturePath, "utf-8").split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const idx = Number(line.slice(0, sep));
    const hex = line.slice(sep + 1).trim();
    if (!hex) continue;
    map.set(idx, Buffer.from(hex, "hex"));
  }
  return map;
}

describe("extractGenUsage", () => {
  const blobs = loadBlobs();

  it("extracts prompt/candidate tokens and model from gen[0]", () => {
    const u = extractGenUsage(blobs.get(0)!);
    expect(u).not.toBeNull();
    expect(u!.input).toBe(16874);
    expect(u!.output).toBe(899); // candidates = thoughts(773) + response(126)
    expect(u!.model).toMatch(/^gemini-3-flash/i);
  });

  it("extracts usage from gen[1] (different per-turn values)", () => {
    const u = extractGenUsage(blobs.get(1)!);
    expect(u).not.toBeNull();
    expect(u!.input).toBe(19918);
    expect(u!.output).toBe(362);
  });

  it("returns null for the trailing summary row (gen[28], no usage block)", () => {
    const u = extractGenUsage(blobs.get(28)!);
    expect(u).toBeNull();
  });

  it("does not double-count the mirrored usage block", () => {
    // The usage block is duplicated inside the blob; the result must equal a
    // single copy, not the sum of both.
    const u = extractGenUsage(blobs.get(0)!);
    expect(u!.input).toBe(16874);
    expect(u!.input).not.toBe(16874 * 2);
  });

  it("tolerates garbage without throwing", () => {
    expect(extractGenUsage(Buffer.from([0xff, 0xff, 0xff, 0x00]))).toBeNull();
    expect(extractGenUsage(Buffer.alloc(0))).toBeNull();
  });
});
