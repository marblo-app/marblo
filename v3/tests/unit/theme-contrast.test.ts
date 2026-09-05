/**
 * WCAG contrast gate for the semantic color tokens
 * (ticket qy4VXeWbDTOtlzxxpnzs, Stage 1).
 *
 * Parses src/index.css directly rather than duplicating the palette, so the
 * values asserted here are the values that ship — a token edit that hurts
 * readability fails the build instead of shipping.
 *
 * The bar is set per role, and applied to BOTH themes so light is not held to
 * a standard dark never had to meet:
 *   - body text (primary/secondary)      >= 4.5   WCAG AA, normal text
 *   - status + accent (carry meaning)    >= 4.5   an error must be readable
 *   - muted (metadata, non-essential)    >= 3.0   AA large-text bar
 *   - text-on-accent over accent         >= 4.5
 *
 * Measured against the three primary surfaces (app/panel/raised).
 * surface-hover is excluded: it is a transient state, and today's dark
 * palette already misses 4.5 there (text-muted 2.57). Holding light to a bar
 * dark fails would be dishonest. See the PR body's "still not right" list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAW_CSS = readFileSync(
  fileURLToPath(new URL("../../src/index.css", import.meta.url)),
  "utf8",
);

// Comments in this file discuss the very selectors we search for, so strip
// them before matching or we parse a prose paragraph as a rule block.
const CSS = RAW_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

type Rgb = [number, number, number];

/** Pull the `--*-rgb: r g b;` declarations out of one selector's block. */
function parseTokens(selectorPattern: RegExp): Record<string, Rgb> {
  const match = selectorPattern.exec(CSS);
  if (!match)
    throw new Error(`selector not found in index.css: ${selectorPattern}`);
  const open = CSS.indexOf("{", match.index);
  const close = CSS.indexOf("}", open);
  if (open === -1 || close === -1)
    throw new Error(`malformed block for selector: ${selectorPattern}`);
  const body = CSS.slice(open + 1, close);

  const out: Record<string, Rgb> = {};
  const re = /--([a-z-]+)-rgb:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const chan = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/** WCAG 2.1 contrast ratio, 1..21. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = parseTokens(/:root\s*,\s*\[data-theme="dark"\]\s*\{/);
const LIGHT = parseTokens(/\[data-theme="light"\]\s*\{/);

const SURFACES = ["surface-app", "surface-panel", "surface-raised"] as const;
const BODY_TEXT = ["text-primary", "text-secondary"] as const;
const STATUS = [
  "accent",
  "accent-hover",
  "success",
  "warning",
  "danger",
] as const;

const THEMES: Array<[string, Record<string, Rgb>]> = [
  ["dark", DARK],
  ["light", LIGHT],
];

const ALL_TOKENS = [
  "surface-app",
  "surface-panel",
  "surface-raised",
  "surface-hover",
  "border-subtle",
  "border-default",
  "border-strong",
  "text-primary",
  "text-secondary",
  "text-muted",
  "text-on-accent",
  "accent",
  "accent-hover",
  "success",
  "warning",
  "danger",
] as const;

describe("token palettes", () => {
  it("both themes define every token", () => {
    for (const [name, tokens] of THEMES) {
      for (const token of ALL_TOKENS) {
        expect(
          tokens[token],
          `${name} is missing --${token}-rgb`,
        ).toBeDefined();
      }
      expect(Object.keys(tokens).sort()).toEqual([...ALL_TOKENS].sort());
    }
  });

  it("every channel is a legal 0-255 byte", () => {
    for (const [name, tokens] of THEMES) {
      for (const [token, rgb] of Object.entries(tokens)) {
        for (const c of rgb) {
          expect(
            c >= 0 && c <= 255,
            `${name} --${token}-rgb has out-of-range channel ${c}`,
          ).toBe(true);
        }
      }
    }
  });

  it("the two themes are actually different", () => {
    for (const token of ALL_TOKENS) {
      expect(
        LIGHT[token],
        `--${token}-rgb is identical in both themes — light was not defined`,
      ).not.toEqual(DARK[token]);
    }
  });
});

describe.each(THEMES)("%s theme contrast", (themeName, tokens) => {
  it.each(BODY_TEXT)("%s clears AA 4.5:1 on every primary surface", (fg) => {
    for (const bg of SURFACES) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      expect(
        ratio,
        `${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, need >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(STATUS)("%s clears AA 4.5:1 on every primary surface", (fg) => {
    for (const bg of SURFACES) {
      const ratio = contrast(tokens[fg], tokens[bg]);
      expect(
        ratio,
        `${themeName}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, need >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("text-muted clears the 3:1 large-text bar on every primary surface", () => {
    for (const bg of SURFACES) {
      const ratio = contrast(tokens["text-muted"], tokens[bg]);
      expect(
        ratio,
        `${themeName}: text-muted on ${bg} is ${ratio.toFixed(2)}:1, need >= 3.0`,
      ).toBeGreaterThanOrEqual(3.0);
    }
  });

  it("text-on-accent is readable over accent and accent-hover", () => {
    for (const bg of ["accent", "accent-hover"] as const) {
      const ratio = contrast(tokens["text-on-accent"], tokens[bg]);
      expect(
        ratio,
        `${themeName}: text-on-accent on ${bg} is ${ratio.toFixed(2)}:1, need >= 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves the text hierarchy primary > secondary > muted", () => {
    const bg = tokens["surface-raised"];
    const primary = contrast(tokens["text-primary"], bg);
    const secondary = contrast(tokens["text-secondary"], bg);
    const muted = contrast(tokens["text-muted"], bg);
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(muted);
  });

  it("keeps the elevation ladder monotonic app -> panel -> raised", () => {
    // Dark rises toward light, light rises toward white. Either way the three
    // surfaces must stay distinguishable and ordered, or cards stop reading
    // as cards.
    const l = SURFACES.map((s) => luminance(tokens[s]));
    expect(l[0]).toBeLessThan(l[1]);
    expect(l[1]).toBeLessThan(l[2]);
  });

  it("hover is distinguishable from the raised surface it covers", () => {
    const ratio = contrast(tokens["surface-hover"], tokens["surface-raised"]);
    expect(
      ratio,
      `${themeName}: surface-hover vs surface-raised is ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(1.1);
  });

  it("borders are visible against the surfaces they separate", () => {
    // Not the 3:1 WCAG non-text bar — today's dark borders sit at 1.80 and
    // raising them is a visual redesign, not a theming change. This asserts
    // light is at least no worse than dark's floor. Tracked in the PR body.
    for (const border of ["border-default", "border-strong"] as const) {
      const ratio = contrast(tokens[border], tokens["surface-raised"]);
      expect(
        ratio,
        `${themeName}: ${border} vs surface-raised is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(1.4);
    }
  });
});
