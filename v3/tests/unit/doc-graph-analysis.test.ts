/**
 * 문서 관계 그래프 분석기 회귀.
 *
 * 위키링크·마크다운 링크 파싱, 타깃 해석, 고아/백링크, 태스크 그래프 레이아웃
 * 어댑터가 깨지면 사이드바 Graph 탭이 점만 그리거나 잘못된 문서를 연다.
 */
import { describe, expect, it } from "vitest";
import {
  buildDocGraph,
  collectFolderPrefixesFromPaths,
  collectMarkdownPaths,
  collectTopLevelFolders,
  docIdFromPath,
  docNodeRadius,
  extractMarkdownLinks,
  extractWikilinks,
  filterDocSources,
  isUnderFolderPrefix,
  joinProjectPath,
  layoutDocGraph,
  resolveDocTarget,
  stripCodeForLinkScan,
  toProjectRelative,
  type DocSource,
} from "../../src/lib/docGraphAnalysis";
import { createTaskGraphSimulation, warmUp } from "../../src/lib/taskGraphForce";

describe("extractWikilinks / extractMarkdownLinks", () => {
  it("parses [[wikilinks]] with alias and heading", () => {
    const content = `
See [[Architecture]] and [[docs/api|API]] plus [[Guide#install]].
`;
    expect(extractWikilinks(content)).toEqual([
      "Architecture",
      "docs/api",
      "Guide",
    ]);
  });

  it("parses markdown links and skips images / external URLs / anchors", () => {
    const content = `
[local](./notes/foo.md) ![img](pic.png) [web](https://x.com) [frag](#section)
[other](bar.md "title")
`;
    expect(extractMarkdownLinks(content)).toEqual([
      "./notes/foo.md",
      "bar.md",
    ]);
  });

  it("ignores links inside fenced and inline code", () => {
    const content = [
      "Real [[Keep]]",
      "```",
      "[[IgnoreFence]]",
      "[ignore](x.md)",
      "```",
      "Also `[[IgnoreInline]]` and `[nope](y.md)` mid sentence.",
      "And [[AlsoKeep]]",
    ].join("\n");
    expect(extractWikilinks(content)).toEqual(["Keep", "AlsoKeep"]);
    expect(extractMarkdownLinks(content)).toEqual([]);
  });
});

describe("resolveDocTarget", () => {
  const known = new Set(["docs/arch", "docs/api", "notes/foo", "index"]);

  it("resolves by id, relative path, and unique basename", () => {
    expect(resolveDocTarget("docs/arch", "index.md", known)).toBe("docs/arch");
    expect(resolveDocTarget("./api.md", "docs/x.md", known)).toBe("docs/api");
    expect(resolveDocTarget("foo", "index.md", known)).toBe("notes/foo");
  });

  it("returns null for missing or ambiguous basenames", () => {
    const ambigKnown = new Set(["a/dup", "b/dup", "solo"]);
    expect(resolveDocTarget("missing", "index.md", ambigKnown)).toBeNull();
    expect(resolveDocTarget("dup", "index.md", ambigKnown)).toBeNull();
  });
});

describe("buildDocGraph", () => {
  const wiki: DocSource[] = [
    {
      path: "index.md",
      content: "# Wiki\n- [[Architecture]]\n- [[log]]\n- [API](docs/api.md)\n",
    },
    {
      path: "Architecture.md",
      content: "See [[index]] and [[docs/api]].\nOrphan mention [[Missing]].\n",
    },
    {
      path: "docs/api.md",
      content: "Back to [[index]].\n",
    },
    {
      path: "log.md",
      content: "Timeline only.\n",
    },
    {
      path: "orphan.md",
      content: "No links here.\n",
    },
  ];

  it("builds nodes, directed edges, backlinks, and orphans", () => {
    const g = buildDocGraph(wiki);
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      ["Architecture", "docs/api", "index", "log", "orphan"].sort(),
    );

    expect(g.nodes.find((n) => n.id === "index")?.special).toBe("index");
    expect(g.nodes.find((n) => n.id === "log")?.special).toBe("log");

    // index → Architecture, log, docs/api
    const fromIndex = g.edges.filter((e) => e.from === "index").map((e) => e.to);
    expect(fromIndex.sort()).toEqual(["Architecture", "docs/api", "log"].sort());

    // Architecture → index, docs/api (Missing dropped)
    const fromArch = g.edges
      .filter((e) => e.from === "Architecture")
      .map((e) => e.to)
      .sort();
    expect(fromArch).toEqual(["docs/api", "index"]);

    // backlinks to index: Architecture, docs/api
    expect(g.backlinks.get("index")?.sort()).toEqual(
      ["Architecture", "docs/api"].sort(),
    );

    expect(g.orphanIds.has("orphan")).toBe(true);
    // log is linked FROM index so not orphan
    expect(g.orphanIds.has("log")).toBe(false);
  });

  it("prefers wikilink kind when both forms point to same target", () => {
    const g = buildDocGraph([
      {
        path: "a.md",
        content: "[[b]] and [b](b.md)\n",
      },
      { path: "b.md", content: "" },
    ]);
    const edges = g.edges.filter((e) => e.from === "a" && e.to === "b");
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("wikilink");
  });

  it("adapts to task graph layout + force sim without NaNs", () => {
    const g = buildDocGraph(wiki);
    const layout = layoutDocGraph(g);
    expect(layout.nodes.length).toBe(g.nodes.length);
    expect(layout.edges.length).toBe(g.edges.length);

    const radii = new Map(
      g.nodes.map((n) => [n.id, docNodeRadius(n, !g.orphanIds.has(n.id))]),
    );
    const sim = createTaskGraphSimulation(layout, {
      radiusOf: (id) => radii.get(id) ?? 12,
    });
    warmUp(sim, 40);
    for (const node of sim.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // orphan radius smaller than hub
    const orphanR = radii.get("orphan")!;
    const indexR = radii.get("index")!;
    expect(orphanR).toBeLessThan(indexR);
  });
});

describe("collectMarkdownPaths", () => {
  it("flattens md files and respects maxFiles", () => {
    const tree = [
      {
        name: "docs",
        path: "docs",
        type: "directory",
        children: [
          { name: "a.md", path: "docs/a.md", type: "file" },
          { name: "b.ts", path: "docs/b.ts", type: "file" },
          { name: "c.markdown", path: "docs/c.markdown", type: "file" },
        ],
      },
      { name: "README.md", path: "README.md", type: "file" },
    ];
    const all = collectMarkdownPaths(tree);
    expect(all.sort()).toEqual(
      ["README.md", "docs/a.md", "docs/c.markdown"].sort(),
    );
    expect(collectMarkdownPaths(tree, { maxFiles: 1 })).toHaveLength(1);
  });
});

describe("docIdFromPath / stripCodeForLinkScan", () => {
  it("strips md extensions and normalizes slashes", () => {
    expect(docIdFromPath("docs\\Foo.MD")).toBe("docs/Foo");
    expect(docIdFromPath("./bar.md")).toBe("bar");
  });

  it("stripCode removes fences", () => {
    const stripped = stripCodeForLinkScan("a\n```\n[[x]]\n```\nb");
    expect(stripped).not.toContain("[[x]]");
  });
});

describe("toProjectRelative / joinProjectPath", () => {
  it("strips root prefix for absolute tree paths", () => {
    expect(
      toProjectRelative("/Users/me/proj", "/Users/me/proj/docs/a.md"),
    ).toBe("docs/a.md");
    expect(toProjectRelative("/Users/me/proj", "docs/a.md")).toBe("docs/a.md");
  });

  it("rejoins with platform-ish separators for openFile", () => {
    expect(joinProjectPath("/Users/me/proj", "docs/a.md")).toBe(
      "/Users/me/proj/docs/a.md",
    );
    expect(joinProjectPath("C:\\Users\\me\\proj", "docs/a.md")).toBe(
      "C:\\Users\\me\\proj\\docs\\a.md",
    );
  });
});

describe("folder scope filter", () => {
  const mixed: DocSource[] = [
    {
      path: "docs/guide.md",
      content: "See [[docs/api]] and [[README]] and [[lectures/intro]].\n",
    },
    {
      path: "docs/api.md",
      content: "Back to [[docs/guide]].\n",
    },
    {
      path: "lectures/intro.md",
      content: "Course start. Links [[docs/guide]].\n",
    },
    {
      path: "README.md",
      content: "Root readme.\n",
    },
    {
      path: "docs/orphan.md",
      content: "Alone in docs.\n",
    },
  ];

  it("isUnderFolderPrefix matches prefix and nested paths only", () => {
    expect(isUnderFolderPrefix("docs/a.md", "docs")).toBe(true);
    expect(isUnderFolderPrefix("docs", "docs")).toBe(true);
    expect(isUnderFolderPrefix("docs-extra/a.md", "docs")).toBe(false);
    expect(isUnderFolderPrefix("README.md", "docs")).toBe(false);
    expect(isUnderFolderPrefix("docs/a.md", "")).toBe(true);
  });

  it("collectTopLevelFolders + collectFolderPrefixesFromPaths", () => {
    const tree = [
      {
        name: "docs",
        path: "/proj/docs",
        type: "directory",
        children: [],
      },
      {
        name: "강의",
        path: "/proj/강의",
        type: "directory",
        children: [],
      },
      { name: "README.md", path: "/proj/README.md", type: "file" },
      {
        name: ".git",
        path: "/proj/.git",
        type: "directory",
        children: [],
      },
    ];
    expect(collectTopLevelFolders(tree, "/proj")).toEqual(["docs", "강의"]);
    expect(
      collectFolderPrefixesFromPaths([
        "docs/a.md",
        "docs/b.md",
        "lectures/x.md",
        "README.md",
      ]),
    ).toEqual(["docs", "lectures"]);
  });

  it("exclude mode keeps only prefix docs; orphan/backlink use subset", () => {
    const g = buildDocGraph(mixed, {
      folderPrefix: "docs",
      externalLinks: "exclude",
    });
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["docs/api", "docs/guide", "docs/orphan"].sort());

    // README · lectures 링크는 스코프 밖이라 간선 제외
    const fromGuide = g.edges
      .filter((e) => e.from === "docs/guide")
      .map((e) => e.to)
      .sort();
    expect(fromGuide).toEqual(["docs/api"]);

    expect(g.backlinks.get("docs/guide")).toEqual(["docs/api"]);
    expect(g.orphanIds.has("docs/orphan")).toBe(true);
    expect(g.orphanIds.has("docs/guide")).toBe(false);
    expect(g.nodes.every((n) => !n.isBoundary)).toBe(true);
  });

  it("boundary mode adds outside targets as boundary nodes", () => {
    const g = buildDocGraph(mixed, {
      folderPrefix: "docs",
      externalLinks: "boundary",
    });
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      ["README", "docs/api", "docs/guide", "docs/orphan", "lectures/intro"].sort(),
    );

    const boundary = g.nodes.filter((n) => n.isBoundary).map((n) => n.id).sort();
    expect(boundary).toEqual(["README", "lectures/intro"].sort());

    const fromGuide = g.edges
      .filter((e) => e.from === "docs/guide")
      .map((e) => e.to)
      .sort();
    expect(fromGuide).toEqual(
      ["README", "docs/api", "lectures/intro"].sort(),
    );

    // 경계 노드 본문은 스텁 — lectures→docs 역링크는 생기지 않음
    expect(
      g.edges.some((e) => e.from === "lectures/intro"),
    ).toBe(false);

    // README 는 진입만 있어 orphan 아님
    expect(g.orphanIds.has("README")).toBe(false);
    expect(g.orphanIds.has("docs/orphan")).toBe(true);
  });

  it("empty prefix keeps full graph (전체)", () => {
    const all = buildDocGraph(mixed);
    const scoped = buildDocGraph(mixed, { folderPrefix: "" });
    expect(scoped.nodes.map((n) => n.id).sort()).toEqual(
      all.nodes.map((n) => n.id).sort(),
    );
    expect(scoped.edges.length).toBe(all.edges.length);
  });

  it("filterDocSources exclude/boundary match buildDocGraph node sets", () => {
    const excluded = filterDocSources(mixed, {
      folderPrefix: "docs",
      externalLinks: "exclude",
    });
    expect(excluded.map((s) => s.path).sort()).toEqual(
      ["docs/api.md", "docs/guide.md", "docs/orphan.md"].sort(),
    );

    const boundary = filterDocSources(mixed, {
      folderPrefix: "docs",
      externalLinks: "boundary",
    });
    expect(boundary.map((s) => s.path).sort()).toEqual(
      [
        "README.md",
        "docs/api.md",
        "docs/guide.md",
        "docs/orphan.md",
        "lectures/intro.md",
      ].sort(),
    );
    // 경계 스텁은 본문 비움
    expect(boundary.find((s) => s.path === "README.md")?.content).toBe("");
    expect(boundary.find((s) => s.path === "docs/guide.md")?.content).toContain(
      "docs/api",
    );
  });
});
