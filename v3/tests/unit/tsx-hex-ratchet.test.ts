/**
 * D5 ratchet: hand-written #rrggbb literals in TSX files under src must not increase.
 *
 * Baseline measured at 2026-08-24 17:44:19 KST in this worktree:
 *   rg -o --glob '*.tsx' '#[0-9a-fA-F]{6}\b' src | wc -l
 *
 * This guard is intentionally a ratchet, not a cleanup PR. Reductions pass;
 * increases fail with locations so the next change uses the shared vocabulary
 * instead of raising the ceiling.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const V3 = path.resolve(__dirname, "../..");
const SRC = path.join(V3, "src");
const HEX_LITERAL = /#[0-9a-fA-F]{6}\b/g;
const MAX_TSX_HEX_LITERALS = 2391;

type Hit = {
  file: string;
  line: number;
  value: string;
};

function collectTsxHexLiterals(): Hit[] {
  const hits: Hit[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;

      fs.readFileSync(absolute, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(HEX_LITERAL)) {
            hits.push({
              file: path.relative(V3, absolute),
              line: index + 1,
              value: match[0],
            });
          }
        });
    }
  };

  walk(SRC);
  return hits;
}

function collectAddedTsxHexLiteralsFromGitDiff(): Hit[] {
  let diff = "";
  try {
    diff = execFileSync(
      "git",
      ["diff", "--unified=0", "--", "src/**/*.tsx"],
      { cwd: V3, encoding: "utf8" },
    );
  } catch {
    return [];
  }

  const hits: Hit[] = [];
  let file = "";
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      file = fileMatch[1];
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const match of line.matchAll(HEX_LITERAL)) {
        hits.push({ file, line: newLine, value: match[0] });
      }
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }

  return hits;
}

describe("D5 hex literal ratchet", () => {
  it("src/**/*.tsx #rrggbb count does not exceed the measured baseline", () => {
    const hits = collectTsxHexLiterals();
    const overage = hits.length - MAX_TSX_HEX_LITERALS;
    const changedHits = collectAddedTsxHexLiteralsFromGitDiff()
      .map((hit) => `${hit.file}:${hit.line} ${hit.value}`)
      .join("\n");
    const sample = hits
      .slice(-Math.max(0, Math.min(overage, 25)))
      .map((hit) => `${hit.file}:${hit.line} ${hit.value}`)
      .join("\n");

    expect(
      hits.length,
      [
        `TSX files under src have ${hits.length} #rrggbb literals; the D5 ratchet ceiling is ${MAX_TSX_HEX_LITERALS}.`,
        "Do not raise this ceiling for new UI work.",
        "Use the shared UI vocabulary in src/components/common/ui.tsx and the semantic tokens in src/index.css instead of adding hand-written hex.",
        changedHits ? `Added hex literals in this git diff:\n${changedHits}` : "",
        sample ? `Overage-sized sample from the full scan:\n${sample}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ).toBeLessThanOrEqual(MAX_TSX_HEX_LITERALS);
  });
});
