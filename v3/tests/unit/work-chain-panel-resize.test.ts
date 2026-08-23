import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { panelHeightForPointer } from "../../src/components/orchestrator/workChainPanelResize";

describe("WorkChainPanel bottom resize", () => {
  it("grows when dragged down and shrinks when dragged up", () => {
    expect(panelHeightForPointer(116, 400, 440)).toBe(156);
    expect(panelHeightForPointer(116, 400, 360)).toBe(96);
  });

  it("keeps the resize handle rendered when the panel is collapsed", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        process.cwd().endsWith("/v3")
          ? "src/components/orchestrator/WorkChainPanel.tsx"
          : "v3/src/components/orchestrator/WorkChainPanel.tsx",
      ),
      "utf8",
    );
    expect(source).toContain('data-testid="work-chain-resize-handle"');
    expect(source).not.toMatch(
      /\{expanded && \(\s*<div\s+data-testid="work-chain-resize-handle"/s,
    );
  });
});
