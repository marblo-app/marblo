import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWikiGraph,
  ingestWiki,
  lintWiki,
  queryWiki,
  readWiki,
  type WikiDocSource,
} from "../../electron/mcp-server/wiki-maintenance";

const tempDirs: string[] = [];

async function tempWiki(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "marblo-wiki-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("wiki maintenance graph/query/lint", () => {
  const docs: WikiDocSource[] = [
    {
      path: "index.md",
      content: "# Index\n\n[[Architecture]]\n[API](docs/api.md)\n",
    },
    {
      path: "Architecture.md",
      content: "Prefers quiet dashboards. See [[docs/api]].",
    },
    { path: "docs/api.md", content: "Back to [[index]]." },
    { path: "orphan.md", content: "No links." },
  ];

  it("builds resolved links, backlinks, and orphan ids", () => {
    const graph = buildWikiGraph(docs);

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(
      ["Architecture", "docs/api", "index", "orphan"].sort(),
    );
    expect(
      graph.edges.map((edge) => `${edge.from}->${edge.to}`).sort(),
    ).toEqual(
      [
        "Architecture->docs/api",
        "docs/api->index",
        "index->Architecture",
        "index->docs/api",
      ].sort(),
    );
    expect(graph.backlinks.get("docs/api")?.sort()).toEqual(
      ["Architecture", "index"].sort(),
    );
    expect(graph.orphanIds.has("orphan")).toBe(true);
  });

  it("queries ranked markdown matches", () => {
    const matches = queryWiki(docs, "quiet dashboards");

    expect(matches[0].path).toBe("Architecture.md");
    expect(matches[0].snippet).toContain("quiet dashboards");
  });

  it("lints missing hubs and orphans", () => {
    const result = lintWiki([{ path: "solo.md", content: "" }]);

    expect(result.issues.map((issue) => issue.code).sort()).toEqual([
      "missing-index",
      "missing-log",
      "orphan",
    ]);
  });
});

describe("ingestWiki", () => {
  it("maintains index.md/log.md and appends assistant memory", async () => {
    const root = await tempWiki();
    await writeFile(join(root, "Architecture.md"), "[[docs/api]]", "utf8");
    await writeFile(join(root, "docs.md"), "ignored", "utf8");
    await writeFile(join(root, "log.md"), "# Log\n\nold entry\n", "utf8");

    const result = await ingestWiki({
      rootPath: root,
      assistantMemoryAppend: "- Prefers concise morning briefings.",
      now: new Date("2026-08-13T00:00:00.000Z"),
    });

    expect(result.written).toEqual(["index.md", "log.md", "MEMORY.md"]);
    const index = await readFile(join(root, "index.md"), "utf8");
    expect(index).toContain("<!-- marblo-wiki:auto:start -->");
    expect(index).toContain("[[Architecture]]");

    const log = await readFile(join(root, "log.md"), "utf8");
    expect(log).toContain("2026-08-13T00:00:00.000Z");
    expect(log).toContain("old entry");

    const memory = await readFile(join(root, "MEMORY.md"), "utf8");
    expect(memory).toContain("Prefers concise morning briefings.");

    const wiki = await readWiki(root);
    expect(wiki.docs.map((doc) => doc.path).sort()).toEqual(
      ["Architecture.md", "MEMORY.md", "docs.md", "index.md", "log.md"].sort(),
    );
  });
});
