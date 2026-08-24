import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import {
  BLOCK as BEGINNER_BLOCK,
  BUTTON_GHOST as BEGINNER_BUTTON_GHOST,
  BUTTON_PRIMARY as BEGINNER_BUTTON_PRIMARY,
  INSET as BEGINNER_INSET,
  SURFACE as BEGINNER_SURFACE,
  emphasize as beginnerEmphasize,
} from "../../src/components/beginner/beginnerUi";
import {
  BLOCK,
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  INSET,
  SURFACE,
  emphasize,
} from "../../src/components/common/ui";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const indexCssPath = path.resolve(testDir, "../../src/index.css");

type CssTokenName =
  | "--surface-panel"
  | "--surface-raised"
  | "--surface-hover"
  | "--border-subtle"
  | "--border-default"
  | "--border-strong"
  | "--text-primary"
  | "--text-on-accent"
  | "--accent"
  | "--accent-hover";

type ParityCase = {
  label: string;
  legacyBeginnerHex: `#${string}`;
  token: CssTokenName;
  className: string;
  source: string;
};

function readRootTokens(): Record<CssTokenName, `#${string}`> {
  const css = fs.readFileSync(indexCssPath, "utf8");
  const entries = Array.from(
    css.matchAll(/^\s+(--[\w-]+):\s*(#[0-9a-f]{6});$/gim),
  ).map(([, name, hex]) => [name, hex.toLowerCase()]);

  return Object.fromEntries(entries) as Record<CssTokenName, `#${string}`>;
}

function readEmphasizeStrongClassName(): string {
  const [node] = emphasize("**token**");

  if (!isValidElement<{ className?: string }>(node)) {
    throw new Error("emphasize did not return a React element for bold text");
  }

  return node.props.className ?? "";
}

const parityCases: ParityCase[] = [
  {
    label: "SURFACE border",
    legacyBeginnerHex: "#313244",
    token: "--border-subtle",
    className: "border-subtle",
    source: SURFACE,
  },
  {
    label: "SURFACE background",
    legacyBeginnerHex: "#181825",
    token: "--surface-panel",
    className: "bg-surface-panel",
    source: SURFACE,
  },
  {
    label: "INSET border",
    legacyBeginnerHex: "#313244",
    token: "--border-subtle",
    className: "border-subtle",
    source: INSET,
  },
  {
    label: "INSET background",
    legacyBeginnerHex: "#1e1e2e",
    token: "--surface-raised",
    className: "bg-surface-raised",
    source: INSET,
  },
  {
    label: "BUTTON_GHOST border",
    legacyBeginnerHex: "#45475a",
    token: "--border-default",
    className: "border-default",
    source: BUTTON_GHOST,
  },
  {
    label: "BUTTON_GHOST text",
    legacyBeginnerHex: "#cdd6f4",
    token: "--text-primary",
    className: "text-primary",
    source: BUTTON_GHOST,
  },
  {
    label: "BUTTON_GHOST hover border",
    legacyBeginnerHex: "#585b70",
    token: "--border-strong",
    className: "hover:border-strong",
    source: BUTTON_GHOST,
  },
  {
    label: "BUTTON_GHOST hover background",
    legacyBeginnerHex: "#313244",
    token: "--surface-hover",
    className: "hover:bg-surface-hover",
    source: BUTTON_GHOST,
  },
  {
    label: "BUTTON_PRIMARY background",
    legacyBeginnerHex: "#89b4fa",
    token: "--accent",
    className: "bg-accent",
    source: BUTTON_PRIMARY,
  },
  {
    label: "BUTTON_PRIMARY text",
    legacyBeginnerHex: "#1e1e2e",
    token: "--text-on-accent",
    className: "text-on-accent",
    source: BUTTON_PRIMARY,
  },
  {
    label: "BUTTON_PRIMARY hover background",
    legacyBeginnerHex: "#74c7ec",
    token: "--accent-hover",
    className: "hover:bg-accent-hover",
    source: BUTTON_PRIMARY,
  },
  {
    label: "emphasize strong text",
    legacyBeginnerHex: "#cdd6f4",
    token: "--text-primary",
    className: "text-primary",
    source: readEmphasizeStrongClassName(),
  },
];

describe("beginnerUi -> common/ui token parity", () => {
  it("maps every legacy beginner hex to the same index.css token value", () => {
    const tokens = readRootTokens();

    expect(
      parityCases.map(({ label, legacyBeginnerHex, token }) => ({
        label,
        legacyBeginnerHex,
        token,
        tokenHex: tokens[token],
      })),
    ).toEqual(
      parityCases.map(({ label, legacyBeginnerHex, token }) => ({
        label,
        legacyBeginnerHex,
        token,
        tokenHex: legacyBeginnerHex,
      })),
    );
  });

  it("uses the token classes that were value-checked above", () => {
    for (const { label, className, source } of parityCases) {
      expect(source.split(/\s+/), label).toContain(className);
    }
  });

  it("keeps beginnerUi as a re-export shim for existing callers", () => {
    expect(BEGINNER_SURFACE).toBe(SURFACE);
    expect(BEGINNER_INSET).toBe(INSET);
    expect(BEGINNER_BLOCK).toBe(BLOCK);
    expect(BEGINNER_BUTTON_GHOST).toBe(BUTTON_GHOST);
    expect(BEGINNER_BUTTON_PRIMARY).toBe(BUTTON_PRIMARY);
    expect(beginnerEmphasize).toBe(emphasize);
  });
});
