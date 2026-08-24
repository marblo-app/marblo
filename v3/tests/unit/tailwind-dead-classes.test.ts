/**
 * `bg-gray-750` 은 존재하지 않는 색 단계였다 — 그 사실과 교체값을 **값으로** 고정한다.
 *
 * 티켓 huab99tGnogRGnylItev. Tailwind 기본 팔레트의 gray 스케일은
 * 50·100…900·950 이고 750 단계가 없다. `tailwind.config.js` 에도 정의가 없다.
 * 그래서 `bg-gray-750` 은 **CSS 규칙을 하나도 만들어 내지 않았고**, 그 클래스만으로
 * 배경을 칠하던 자리는 배경 없이, hover 로만 쓰던 자리는 무반응으로 렌더됐다.
 *
 * ★스크린샷 대신 이 테스트로 증명하는 이유: 사람 눈은 몇 px·몇 단계 색차를 못 잡고,
 * 창을 띄우는 검증은 사장님 작업을 방해한다(AGENTS.md "GUI 를 띄우는 검증 금지").
 * 여기서는 실제 Tailwind 컴파일러를 헤드리스로 돌려 **생성된 규칙 자체**를 본다.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import resolveConfig from "tailwindcss/resolveConfig";
import ts from "typescript";

const V3 = path.resolve(__dirname, "../..");
const SRC = path.join(V3, "src");
const CONFIG = path.join(V3, "tailwind.config.js");
const TOKEN_COLOR_BUCKETS = {
  backgroundColor: "bg",
  textColor: "text",
  borderColor: "border",
} as const;

type TokenColorBucket = keyof typeof TOKEN_COLOR_BUCKETS;
type TailwindConfigObject = {
  content?: unknown;
  theme?: {
    extend?: Partial<Record<TokenColorBucket, Record<string, unknown>>>;
  };
  plugins?: unknown;
};

/** 주어진 클래스들만 content 로 넣고 utilities 를 컴파일한다(브라우저 없음). */
async function compile(
  classes: string[],
  config: string | TailwindConfigObject = CONFIG,
): Promise<string> {
  const content = [{ raw: classes.join(" "), extension: "html" }];
  const configObject =
    typeof config === "string"
      ? (require(config) as TailwindConfigObject)
      : config;
  const tailwindConfig = { ...configObject, content };

  const res = await postcss([tailwindcss(tailwindConfig)]).process(
    "@tailwind utilities;",
    { from: undefined },
  );
  return res.css;
}

/** `.bg-x{...}` / `.hover\:bg-x:hover{...}` 규칙 본문만 정확히 뽑는다. */
function ruleFor(css: string, cls: string): string | null {
  const esc = cls.replace(/[/\\]/g, (m) => "\\\\" + m).replace(/:/g, "\\\\:");
  const re = new RegExp(`\\.${esc}(?::hover)?\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeClassName(cls: string): string {
  return cls.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

function ruleExists(css: string, cls: string): boolean {
  return css.includes(`.${escapeClassName(cls)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenColorValue(value: unknown): boolean {
  if (typeof value === "string") return value.includes("var(--");
  if (!isRecord(value)) return false;
  return Object.values(value).some(isTokenColorValue);
}

function tokenUtilityBases(config: TailwindConfigObject): Set<string> {
  const resolved = resolveConfig({ content: [], ...config }) as {
    theme?: Partial<Record<TokenColorBucket, unknown>>;
  };
  const bases = new Set<string>();

  for (const [bucket, prefix] of Object.entries(TOKEN_COLOR_BUCKETS) as Array<
    [TokenColorBucket, string]
  >) {
    const colors = resolved.theme?.[bucket];
    if (!isRecord(colors)) continue;

    for (const [name, value] of Object.entries(colors)) {
      if (isTokenColorValue(value)) bases.add(`${prefix}-${name}`);
    }
  }

  return bases;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

function stringFragments(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const fragments: string[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) {
      fragments.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      fragments.push(node.head.text);
      for (const span of node.templateSpans) {
        fragments.push(span.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return fragments;
}

function collectUsedTokenClasses(): Map<string, Set<string>> {
  const config = require(CONFIG) as TailwindConfigObject;
  const bases = tokenUtilityBases(config);
  const basePattern = Array.from(bases).sort().map(escapeRe).join("|");
  const classRe = new RegExp(
    `(?:[a-zA-Z0-9_-]+:)*(?:${basePattern})(?:/[0-9]+)?`,
    "g",
  );
  const hits = new Map<string, Set<string>>();

  for (const file of sourceFiles(SRC)) {
    const classes = new Set<string>();
    for (const fragment of stringFragments(file)) {
      for (const match of fragment.matchAll(classRe)) {
        classes.add(match[0]);
      }
    }
    if (classes.size > 0) hits.set(path.relative(V3, file), classes);
  }

  return hits;
}

function missingClasses(css: string, classes: string[]): string[] {
  return classes.filter((cls) => !ruleExists(css, cls));
}

function plainVarTokenConfig(): TailwindConfigObject {
  const raw = require(CONFIG) as TailwindConfigObject;
  const cfg = JSON.parse(JSON.stringify(raw)) as TailwindConfigObject;
  const extend = cfg.theme?.extend;
  if (!extend) throw new Error("tailwind config must have theme.extend");

  const toPlainVar = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const match = value.match(/^rgb\(var\(--(.+)-rgb\) \/ <alpha-value>\)$/);
    return match ? `var(--${match[1]})` : value;
  };

  for (const bucket of Object.keys(TOKEN_COLOR_BUCKETS) as TokenColorBucket[]) {
    const colors = extend[bucket];
    if (!colors) continue;
    extend[bucket] = Object.fromEntries(
      Object.entries(colors).map(([name, value]) => [name, toPlainVar(value)]),
    );
  }

  const borderColor = extend.borderColor;
  extend.borderColor = {
    subtle: borderColor?.subtle,
    default: borderColor?.default,
    strong: borderColor?.strong,
  };

  return cfg;
}

const PR_1186_TOKEN_CLASS_SAMPLE = [
  "border-default",
  "border-subtle",
  "text-danger",
  "text-secondary",
  "text-success",
  "text-warning",
  "bg-success/15",
  "bg-accent/20",
  "bg-warning/15",
  "bg-danger/10",
  "bg-success/5",
  "bg-surface-hover/20",
  "hover:bg-success/10",
  "hover:bg-accent/30",
  "border-success/50",
  "focus:border-accent",
];

describe("gray-750 은 정의되지 않은 색 단계다", () => {
  it("resolveConfig 의 gray 스케일에 750 이 없다", () => {
    const cfg = resolveConfig({ content: [], ...require(CONFIG) });
    const gray = cfg.theme?.colors?.gray as Record<string, string>;
    expect(gray, "gray 스케일이 있어야 한다").toBeTruthy();
    expect(Object.keys(gray)).not.toContain("750");
    // 인접 단계는 실재하고, 이 값들이 아래 교체값의 근거다.
    expect(gray["700"]).toBe("#374151");
    expect(gray["800"]).toBe("#1f2937");
  });

  it("bg-gray-750 / hover:bg-gray-750 은 규칙을 만들어 내지 않는다", async () => {
    const css = await compile(["bg-gray-750", "hover:bg-gray-750"]);
    expect(css).not.toContain("gray-750");
    expect(ruleFor(css, "bg-gray-750")).toBeNull();
    expect(ruleFor(css, "hover:bg-gray-750")).toBeNull();
  });

  it("교체값들은 실제로 규칙을 만들고, 800 < 700/50 < 700 순으로 밝아진다", async () => {
    const css = await compile([
      "bg-gray-800",
      "bg-gray-700/50",
      "bg-gray-700",
      "hover:bg-gray-700",
      "hover:bg-gray-700/50",
    ]);
    // 휴지 표면
    expect(ruleFor(css, "bg-gray-800")).toContain("rgb(31 41 55");
    // ★800 과 700 사이 — 원래 "750" 이라는 이름이 의도한 자리.
    expect(ruleFor(css, "bg-gray-700/50")).toBe(
      "background-color: rgb(55 65 81 / 0.5)",
    );
    expect(ruleFor(css, "bg-gray-700")).toContain("rgb(55 65 81");
    // hover 변형도 같은 값으로 실재한다(무반응이 아니다).
    expect(ruleFor(css, "hover:bg-gray-700")).toContain("rgb(55 65 81");
    expect(ruleFor(css, "hover:bg-gray-700/50")).toBe(
      "background-color: rgb(55 65 81 / 0.5)",
    );
  });
});

describe("디자인 토큰 클래스는 실제 CSS 규칙을 만들어야 한다", () => {
  it("v3/src 의 ts/tsx 에서 쓰인 토큰 클래스가 전부 생성된다", async () => {
    const usedByFile = collectUsedTokenClasses();
    const usedClasses = Array.from(
      new Set(
        Array.from(usedByFile.values()).flatMap((set) => Array.from(set)),
      ),
    ).sort();

    const css = await compile(usedClasses);
    const missing = missingClasses(css, usedClasses);
    const locations = missing.flatMap((cls) =>
      Array.from(usedByFile.entries())
        .filter(([, classes]) => classes.has(cls))
        .map(([file]) => `${cls} <- ${file}`),
    );

    expect(
      locations,
      `Tailwind 가 생성하지 않는 토큰 클래스:\n${locations.join("\n")}`,
    ).toEqual([]);
  });

  it("PR #1186 샘플 16개도 현재 config 에서는 전부 생성된다", async () => {
    const css = await compile(PR_1186_TOKEN_CLASS_SAMPLE);
    expect(missingClasses(css, PR_1186_TOKEN_CLASS_SAMPLE)).toEqual([]);
  });

  it("PR #1186 샘플은 예전 평문 var 토큰 config 에서 RED 가 된다", async () => {
    const css = await compile(
      PR_1186_TOKEN_CLASS_SAMPLE,
      plainVarTokenConfig(),
    );

    expect(missingClasses(css, PR_1186_TOKEN_CLASS_SAMPLE)).toEqual([
      "bg-success/15",
      "bg-accent/20",
      "bg-warning/15",
      "bg-danger/10",
      "bg-success/5",
      "bg-surface-hover/20",
      "hover:bg-success/10",
      "hover:bg-accent/30",
      "border-success/50",
      "focus:border-accent",
    ]);
  });
});

describe("회귀 가드", () => {
  it("v3/src 에 gray-750 이 남아 있지 않다", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(e.name)) {
          fs.readFileSync(p, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (line.includes("gray-750"))
                hits.push(`${path.relative(V3, p)}:${i + 1}`);
            });
        }
      }
    };
    walk(path.join(V3, "src"));
    expect(hits, `죽은 클래스가 다시 들어왔다:\n${hits.join("\n")}`).toEqual(
      [],
    );
  });
});
