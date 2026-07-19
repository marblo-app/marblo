/**
 * Ticket IuucvLemDFvbh4UYmL1o, acceptance criterion "project_id 가 조용히
 * 무시되는 경로가 0건임을 테스트로 고정".
 *
 * The unit tests next door prove the lock *decision* is right. This one proves
 * every tool that ADVERTISES a project_id argument actually routes through it —
 * the original bug was not a wrong decision, it was eight tools that declared
 * the parameter and then never consulted it. A decision test alone would have
 * stayed green through that entire bug.
 *
 * So this scans the registered tool surface itself. Adding a new tool with a
 * project_id parameter fails here until it declares a contract in
 * PROJECT_ID_TOOL_CONTRACTS and implements it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PROJECT_ID_TOOL_CONTRACTS } from "../../electron/mcp-server/tool-surface";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(here, "../../electron/mcp-server/tools.ts"),
  "utf8",
);

interface ToolBlock {
  name: string;
  body: string;
}

/** Split tools.ts into one block per registered tool. */
function parseToolBlocks(source: string): ToolBlock[] {
  const starts: Array<{ name: string; index: number }> = [];
  const re = /\n {2}auditedTool\(\s*\n\s*"([a-z_]+)",/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length),
  }));
}

const blocks = parseToolBlocks(SOURCE);

/**
 * Tools that accept a project_id from the caller — either as a top-level schema
 * field (`project_id: z.string()`, possibly wrapped across lines) or as a
 * per-item field on a payload array (`t.project_id` in create_tasks_bulk).
 */
const declaringTools = blocks
  .filter(
    (b) =>
      /\bproject_id:\s*z[\s.]/.test(b.body) || /\.project_id\b/.test(b.body),
  )
  .map((b) => b.name);

describe("tool surface parsing", () => {
  it("finds the full registered tool surface", () => {
    // Guards the regex itself: if registration formatting changes and this
    // parser silently matches nothing, every assertion below becomes vacuous.
    expect(blocks.length).toBeGreaterThanOrEqual(30);
    expect(blocks.map((b) => b.name)).toContain("get_all_tasks");
  });
});

describe("every project_id-taking tool declares a contract", () => {
  it("no tool accepts project_id without an entry in the registry", () => {
    const undeclared = declaringTools.filter(
      (name) => !(name in PROJECT_ID_TOOL_CONTRACTS),
    );
    expect(undeclared).toEqual([]);
  });

  it("the registry has no stale entries", () => {
    const stale = Object.keys(PROJECT_ID_TOOL_CONTRACTS).filter(
      (name) => !declaringTools.includes(name),
    );
    expect(stale).toEqual([]);
  });
});

describe("locked tools actually enforce the lock", () => {
  const locked = Object.entries(PROJECT_ID_TOOL_CONTRACTS)
    .filter(([, contract]) => contract === "locked")
    .map(([name]) => name);

  it.each(locked)("%s consults project_id via the lock", (name) => {
    const block = blocks.find((b) => b.name === name);
    expect(block, `tool ${name} not found in tools.ts`).toBeDefined();
    // Either it routes through enforceProjectLock, or it refuses with an
    // explicit ProjectLockError (add_pending_instruction validates the argument
    // against the task document, which is authoritative over the env default).
    expect(
      /enforceProjectLock\(|new ProjectLockError\(/.test(block!.body),
      `${name} declares project_id but never enforces the project lock`,
    ).toBe(true);
  });
});

describe("cross-project create tools honor the argument", () => {
  const creates = Object.entries(PROJECT_ID_TOOL_CONTRACTS)
    .filter(([, contract]) => contract === "cross-project-create")
    .map(([name]) => name);

  it.each(creates)("%s resolves project_id instead of dropping it", (name) => {
    const block = blocks.find((b) => b.name === name);
    expect(block).toBeDefined();
    expect(
      /resolveProjectForCreate\(|resolveTaskProject\(/.test(block!.body),
      `${name} declares project_id but never resolves it`,
    ).toBe(true);
  });
});

describe("the silently-ignoring resolver is gone", () => {
  it("no handler calls a resolver that drops project_id", () => {
    // The old resolveProject() returned MARBLO_PROJECT unconditionally. It is
    // replaced by resolveProjectForAudit(), which is intentionally still
    // default-wins but is confined to audit-log tagging.
    expect(SOURCE).not.toMatch(/[^a-zA-Z]resolveProject\(/);
  });

  it("the audit-only resolver is used exactly once, for audit logging", () => {
    const uses = SOURCE.match(/resolveProjectForAudit\(/g) ?? [];
    // One definition + one call site.
    expect(uses.length).toBe(2);
    expect(SOURCE).toMatch(/auditLog\(\{[\s\S]{0,200}projectId/);
  });
});
